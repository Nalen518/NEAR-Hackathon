//! Shark & Co. company contract (API-CONTRACT §3, SRD §5 and §8). Holds all customer money, runs the
//! job state machine and pays everyone. Integers only: USDC is U128 base units (6 dp), shares are bps.
//!
//! This first slice covers method 1 payments, award + escrow, deliveries, reviews posted by the
//! registered reviewer account, revisions, refunds, complaints, strikes and finalize.
//! shortcut: reviews come from the reviewer's own account, not an OutLayer callback; switch `on_review`
//! to the OutLayer `request_execution` callback when Owl runs in the TEE (O-03, O-13).
use near_sdk::json_types::U128;
use near_sdk::serde_json::{self, json};
use near_sdk::store::{IterableMap, LookupMap};
use near_sdk::{
    AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise, PromiseError, PromiseOrValue, PublicKey, env, ext_contract,
    near, require,
};

const GAS_FT_TRANSFER: Gas = Gas::from_tgas(10);
const GAS_CALLBACK: Gas = Gas::from_tgas(10);
const GAS_STORAGE: Gas = Gas::from_tgas(15);
/** NEP-145 minimum for registering an account on the USDC token (API §1.2 `register`) */
const STORAGE_DEPOSIT: NearToken = NearToken::from_yoctonear(1_250_000_000_000_000_000_000);
const DAY_SECS: u64 = 86_400;
const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);
const BPS: u128 = 10_000;
const QUOTE_DOMAIN: &str = "sharkco:quote:v2|";

#[ext_contract(ext_ft)]
#[allow(dead_code)]
trait FungibleToken {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
    fn storage_deposit(&mut self, account_id: Option<AccountId>, registration_only: Option<bool>);
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum JobType {
    Extract,
    Summary,
    Thread,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "snake_case")]
pub enum JobState {
    Paid,
    Awarded,
    Review,
    Revision,
    /// Second review failed: the worker has `dispute_window_secs` to dispute (FR-44)
    Failed,
    DisputeReview,
    /// Refunded now, worker fee held in escrow until a second review or the timeout (FR-46)
    Unresolved,
    Delivered,
    ComplaintReview,
    Finalized,
    RefundDue,
    Refunded,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct TypeConfig {
    pub band_min: U128,
    pub band_max: U128,
}

/// SRD §8.4. Each job snapshots the parts it needs at creation (FR-73).
#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Config {
    pub extract: TypeConfig,
    pub summary: TypeConfig,
    pub thread: TypeConfig,
    pub worker_cap_bps: u16,
    pub review_fee: U128,
    pub referral_bps: u16,
    pub owner_bps: u16,
    pub daily_budget: U128,
    pub strike_threshold: u8,
    pub suspend_threshold: u8,
    pub max_unresolved_open: u8,
    pub work_deadline_secs: u64,
    pub review_deadline_secs: u64,
    pub dispute_window_secs: u64,
    pub unresolved_timeout_secs: u64,
    pub complaint_window_secs: u64,
    pub job_timeout_secs: u64,
}

impl Config {
    fn band(&self, t: JobType) -> &TypeConfig {
        match t {
            JobType::Extract => &self.extract,
            JobType::Summary => &self.summary,
            JobType::Thread => &self.thread,
        }
    }
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Worker {
    pub id: AccountId,
    pub types: Vec<JobType>,
    /// Per type, in `types` order.
    pub min_fees: Vec<U128>,
    pub jobs: u32,
    pub first_pass: u32,
    pub final_fails: u32,
    pub disputes_won: u32,
    pub disputes_lost: u32,
    pub disputes_unresolved: u32,
    pub unresolved_open: u8,
    pub late: u32,
    pub suspended: bool,
}

impl Worker {
    fn min_fee(&self, t: JobType) -> Option<u128> {
        self.types.iter().position(|x| *x == t).map(|i| self.min_fees[i].0)
    }
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Reviewer {
    pub id: AccountId,
    pub reviews: u32,
    pub overturned: u32,
    pub suspended: bool,
}

/// The signed quote (API §1.2). Fields in alphabetical order so serde writes canonical JSON
/// (keys sorted, no spaces): Shark signs exactly these bytes.
#[near(serializers = [json])]
#[derive(Clone)]
pub struct Quote {
    pub brief_hash: String,
    pub expires_at: u64,
    pub input_hash: String,
    pub job_type: JobType,
    pub network: String,
    pub payer: AccountId,
    pub price: U128,
    pub quote_id: String,
    pub referrer: Option<AccountId>,
}

#[near(serializers = [json])]
pub struct PayMsg {
    pub quote: Quote,
    /// "ed25519:<base58 64 bytes>"
    pub sig: String,
}

#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Job {
    pub id: u64,
    pub quote_id: String,
    pub payer: AccountId,
    pub job_type: JobType,
    pub price: U128,
    pub input_hash: String,
    pub brief_hash: String,
    pub referrer: Option<AccountId>,
    pub state: JobState,
    pub paid_at: u64,
    pub worker: Option<AccountId>,
    pub worker_fee: U128,
    pub escrowed: bool,
    pub bid_hash: Option<String>,
    pub reason_hash: Option<String>,
    pub round: u8,
    pub delivery_hash: Option<String>,
    pub work_deadline: u64,
    pub awarded_at: Option<u64>,
    pub delivered_at: Option<u64>,
    pub reviewed_at: Option<u64>,
    pub complaint_until: Option<u64>,
    pub complaint_hash: Option<String>,
    pub codes: Vec<String>,
    /// Owl's full reasons text, stored by Shark under this hash
    pub reasons_hash: Option<String>,
    /// End of the dispute window after a second failed review
    pub dispute_until: Option<u64>,
    /// When the second review was requested (the dispute, FR-45)
    pub review_requested_at: Option<u64>,
    pub unresolved_since: Option<u64>,
    /// The refund is paid but the worker fee stays in escrow (Unresolved)
    pub held: bool,
    /// The first worker was late and the job went back to auction (FR-35); it may happen once
    pub reauctioned: bool,
    /// The late worker, who may not win the re-auction
    pub excluded: Option<AccountId>,
    // snapshots (FR-73)
    pub review_fee: U128,
    pub referral_bps: u16,
    pub owner_bps: u16,
    pub complaint_window_secs: u64,
    pub job_timeout_secs: u64,
}

/// Owl's result (API §2.4 output).
#[near(serializers = [json])]
pub struct ReviewResult {
    pub mode: String,
    pub pass: bool,
    pub codes: Vec<String>,
    pub reasons_hash: String,
}

/// A payout whose transfer failed. The money is still in the contract; anyone may retry it (`retry_owed`).
#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Owed {
    pub id: u64,
    pub job: u64,
    pub to: AccountId,
    pub amount: U128,
    pub kind: String,
}

#[near(serializers = [json])]
pub struct Roles {
    pub owner: AccountId,
    pub guardian: AccountId,
    pub shark: AccountId,
    pub shark_wallet: AccountId,
    pub usdc: AccountId,
    pub network: String,
}

#[near(serializers = [json])]
pub struct Stats {
    pub jobs: u64,
    pub strikes: u8,
    pub reserve: U128,
    pub owner_accrued: U128,
    pub accounted: U128,
    pub open_jobs: u64,
    pub owed_open: u64,
}

#[derive(BorshStorageKey)]
#[near]
enum Key {
    Jobs,
    Workers,
    UsedQuotes,
    Owed,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    owner: AccountId,
    guardian: AccountId,
    shark: AccountId,
    /// Shark's USDC wallet: the only sender of escrow, and who `fund_shark` pays (FR-34, FR-62)
    shark_wallet: AccountId,
    quote_pubkey: PublicKey,
    usdc: AccountId,
    /// CAIP-2, e.g. "near:testnet" (API §0.3 N4)
    network: String,
    config: Config,
    jobs: LookupMap<u64, Job>,
    next_job: u64,
    workers: IterableMap<AccountId, Worker>,
    reviewer: Option<Reviewer>,
    /// quote_id → job id: one payment per quote, and Shark finds the job a quote became
    used_quotes: LookupMap<String, u64>,
    paused: bool,
    closed: bool,
    strikes: u8,
    reserve: u128,
    owner_accrued: u128,
    /// Every USDC base unit the contract knows it holds (for balance checks of methods 2 and 3).
    accounted: u128,
    /// Jobs not yet Finalized or Refunded; `wind_down` needs none
    open_jobs: u64,
    last_fund_day: u64,
    owed: LookupMap<u64, Owed>,
    owed_next: u64,
    owed_open: u64,
}

fn now_secs() -> u64 {
    env::block_timestamp_ms() / 1000
}

fn emit(event: &str, data: serde_json::Value) {
    env::log_str(&format!(
        "EVENT_JSON:{}",
        json!({ "standard": "sharkco", "version": "2.0.0", "event": event, "data": [data] })
    ));
}

#[near]
impl Contract {
    #[init]
    pub fn new(
        owner: AccountId,
        guardian: AccountId,
        shark: AccountId,
        shark_wallet: AccountId,
        quote_pubkey: PublicKey,
        usdc: AccountId,
        network: String,
        config: Config,
    ) -> Self {
        require!(network == "near:testnet" || network == "near:mainnet", "E_BAD_CONFIG");
        let c = Self {
            owner,
            guardian,
            shark,
            shark_wallet,
            quote_pubkey,
            usdc,
            network,
            config: config.clone(),
            jobs: LookupMap::new(Key::Jobs),
            next_job: 1,
            workers: IterableMap::new(Key::Workers),
            reviewer: None,
            used_quotes: LookupMap::new(Key::UsedQuotes),
            paused: false,
            closed: false,
            strikes: 0,
            reserve: 0,
            owner_accrued: 0,
            accounted: 0,
            open_jobs: 0,
            last_fund_day: 0,
            owed: LookupMap::new(Key::Owed),
            owed_next: 1,
            owed_open: 0,
        };
        c.check_config(&config);
        c
    }

    // ---------- owner ----------

    pub fn set_config(&mut self, config: Config) {
        self.only(&self.owner.clone());
        self.check_config(&config);
        self.config = config;
        emit("config_changed", json!({}));
    }

    pub fn register_worker(&mut self, id: AccountId, types: Vec<JobType>, min_fees: Vec<U128>) {
        self.only(&self.owner.clone());
        require!(!types.is_empty() && types.len() == min_fees.len(), "E_BAD_CONFIG");
        let prev = self.workers.get(&id).cloned();
        let w = Worker {
            id: id.clone(),
            types,
            min_fees,
            jobs: prev.as_ref().map_or(0, |p| p.jobs),
            first_pass: prev.as_ref().map_or(0, |p| p.first_pass),
            final_fails: prev.as_ref().map_or(0, |p| p.final_fails),
            disputes_won: prev.as_ref().map_or(0, |p| p.disputes_won),
            disputes_lost: prev.as_ref().map_or(0, |p| p.disputes_lost),
            disputes_unresolved: prev.as_ref().map_or(0, |p| p.disputes_unresolved),
            unresolved_open: prev.as_ref().map_or(0, |p| p.unresolved_open),
            late: prev.as_ref().map_or(0, |p| p.late),
            suspended: prev.as_ref().is_some_and(|p| p.suspended),
        };
        self.workers.insert(id, w);
    }

    pub fn register_reviewer(&mut self, id: AccountId) {
        self.only(&self.owner.clone());
        self.reviewer = Some(Reviewer { id, reviews: 0, overturned: 0, suspended: false });
    }

    pub fn suspend(&mut self, id: AccountId) {
        self.only(&self.owner.clone());
        self.worker_mut(&id).suspended = true;
        emit("worker_suspended", json!({ "id": id }));
    }

    pub fn reinstate(&mut self, id: AccountId) {
        self.only(&self.owner.clone());
        self.worker_mut(&id).suspended = false;
        emit("reinstated", json!({ "id": id }));
    }

    pub fn reset_strikes(&mut self) {
        self.only(&self.owner.clone());
        self.strikes = 0;
    }

    pub fn set_shark_wallet(&mut self, wallet: AccountId) {
        self.only(&self.owner.clone());
        self.shark_wallet = wallet;
    }

    pub fn set_quote_pubkey(&mut self, pk: PublicKey) {
        self.only(&self.owner.clone());
        self.quote_pubkey = pk;
    }

    pub fn unpause(&mut self) {
        self.only(&self.owner.clone());
        self.paused = false;
        emit("unpaused", json!({}));
    }

    pub fn pause(&mut self) {
        let p = env::predecessor_account_id();
        require!(p == self.guardian || p == self.owner, "E_UNAUTHORIZED");
        self.paused = true;
        emit("paused", json!({}));
    }

    // ---------- payments ----------

    /// NEP-141 receiver. Returns the amount to send back (the token refunds it to the sender).
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        require!(env::predecessor_account_id() == self.usdc, "E_UNAUTHORIZED");
        if let Some(b64) = msg.strip_prefix("pay:") {
            return match self.try_pay(&sender_id, amount.0, b64) {
                Ok(job_id) => {
                    self.accounted += amount.0;
                    let j = self.job(job_id);
                    emit(
                        "job_paid",
                        json!({ "job_id": job_id, "quote_id": j.quote_id, "payer": j.payer, "job_type": j.job_type, "price": j.price, "method": "quote", "referrer": j.referrer }),
                    );
                    PromiseOrValue::Value(U128(0))
                }
                Err(reason) => {
                    emit("payment_returned", json!({ "sender": sender_id, "amount": amount, "reason": reason }));
                    PromiseOrValue::Value(amount)
                }
            };
        }
        if let Some(id) = msg.strip_prefix("escrow:") {
            require!(sender_id == self.shark_wallet, "E_UNAUTHORIZED");
            let id: u64 = id.parse().unwrap_or_else(|_| env::panic_str("E_BAD_STATE"));
            let mut j = self.job(id);
            require!(j.state == JobState::Awarded && !j.escrowed, "E_BAD_STATE");
            require!(amount.0 == j.worker_fee.0 + j.review_fee.0, "E_WRONG_AMOUNT");
            j.escrowed = true;
            self.jobs.insert(id, j);
            self.accounted += amount.0;
            return PromiseOrValue::Value(U128(0));
        }
        require!(msg == "reserve", "E_BAD_STATE");
        self.reserve += amount.0;
        self.accounted += amount.0;
        PromiseOrValue::Value(U128(0))
    }

    // ---------- jobs ----------

    pub fn award(&mut self, job: u64, worker: AccountId, fee: U128, bid_hash: String, reason_hash: String) {
        self.only(&self.shark.clone());
        let mut j = self.job(job);
        require!(j.state == JobState::Paid, "E_BAD_STATE");
        let w = self.workers.get(&worker).unwrap_or_else(|| env::panic_str("E_UNKNOWN_AGENT"));
        require!(!w.suspended && w.unresolved_open < self.config.max_unresolved_open && j.excluded.as_ref() != Some(&worker), "E_NOT_ELIGIBLE");
        let min = w.min_fee(j.job_type).unwrap_or_else(|| env::panic_str("E_NOT_ELIGIBLE"));
        require!(fee.0 >= min, "E_BELOW_MIN_FEE");
        require!(fee.0 * BPS <= j.price.0 * self.config.worker_cap_bps as u128, "E_OVER_CAP");
        j.state = JobState::Awarded;
        j.worker = Some(worker.clone());
        j.worker_fee = fee;
        j.bid_hash = Some(bid_hash.clone());
        j.reason_hash = Some(reason_hash.clone());
        j.round = 1;
        j.awarded_at = Some(now_secs());
        j.work_deadline = now_secs() + self.config.work_deadline_secs;
        self.jobs.insert(job, j);
        emit("worker_awarded", json!({ "job_id": job, "worker": worker, "fee": fee, "bid_hash": bid_hash, "reason_hash": reason_hash }));
    }

    pub fn deliver(&mut self, job: u64, delivery_hash: String) {
        let mut j = self.job(job);
        require!(j.worker.as_ref() == Some(&env::predecessor_account_id()), "E_UNAUTHORIZED");
        require!(j.state == JobState::Awarded || j.state == JobState::Revision, "E_BAD_STATE");
        require!(j.escrowed, "E_BAD_STATE");
        require!(now_secs() <= j.work_deadline, "E_DEADLINE_PASSED");
        j.state = JobState::Review;
        j.delivery_hash = Some(delivery_hash.clone());
        j.delivered_at = Some(now_secs());
        self.jobs.insert(job, j.clone());
        emit("delivered", json!({ "job_id": job, "worker": j.worker, "round": j.round, "delivery_hash": delivery_hash }));
    }

    /// Owl's verdict. Primary: pass pays the worker and Owl; a first fail asks for one revision; a
    /// second fail refunds the payer. Complaint: upheld refunds the payer and strikes Shark.
    pub fn on_review(&mut self, job: u64, result: ReviewResult) {
        let rv = self.reviewer.clone().unwrap_or_else(|| env::panic_str("E_UNKNOWN_AGENT"));
        require!(env::predecessor_account_id() == rv.id && !rv.suspended, "E_UNAUTHORIZED");
        let mut j = self.job(job);
        emit(
            "review_result",
            json!({ "job_id": job, "mode": result.mode, "pass": result.pass, "codes": result.codes, "reasons_hash": result.reasons_hash, "attestation": null }),
        );
        if let Some(r) = self.reviewer.as_mut() {
            r.reviews += 1;
        }
        j.codes = result.codes.clone();
        j.reviewed_at = Some(now_secs());
        j.reasons_hash = Some(result.reasons_hash.clone());
        let worker = j.worker.clone().unwrap_or_else(|| env::panic_str("E_BAD_STATE"));
        match (j.state, result.mode.as_str()) {
            (JobState::Review, "primary") => {
                if result.codes.iter().any(|c| c == "BRIEF_INVALID") {
                    // Shark's mistake: refund, strike, and the worker is still paid (FR-52)
                    self.pay_worker_and_reviewer(&mut j, &worker, &rv.id);
                    self.strike();
                    j.state = JobState::RefundDue;
                } else if result.pass {
                    let first = j.round == 1;
                    self.pay_worker_and_reviewer(&mut j, &worker, &rv.id);
                    let w = self.worker_mut(&worker);
                    w.jobs += 1;
                    if first {
                        w.first_pass += 1;
                    }
                    j.state = JobState::Delivered;
                    j.complaint_until = Some(now_secs() + j.complaint_window_secs);
                } else if j.round == 1 {
                    j.round = 2;
                    j.state = JobState::Revision;
                    j.work_deadline = now_secs() + self.config.work_deadline_secs;
                } else {
                    // second fail: Owl is paid now, the worker fee stays in escrow while it may dispute (FR-44)
                    self.payout(&rv.id, j.review_fee.0, job, "reviewer").detach();
                    self.worker_mut(&worker).jobs += 1;
                    j.state = JobState::Failed;
                    j.dispute_until = Some(now_secs() + self.config.dispute_window_secs);
                }
            }
            (JobState::DisputeReview | JobState::Unresolved, "secondary") => {
                let was_unresolved = j.state == JobState::Unresolved;
                self.pay_second_review(&rv.id, j.review_fee.0, job);
                j.escrowed = false;
                if result.pass {
                    // the first verdict is overturned: the worker is paid from escrow (FR-45)
                    self.payout(&worker, j.worker_fee.0, job, "worker").detach();
                    self.worker_mut(&worker).disputes_won += 1;
                    if let Some(r) = self.reviewer.as_mut() {
                        r.overturned += 1;
                    }
                    if was_unresolved {
                        j.state = JobState::Refunded; // the payer was already refunded and keeps it
                    } else {
                        j.state = JobState::Delivered;
                        j.complaint_until = Some(now_secs() + j.complaint_window_secs);
                    }
                } else {
                    self.reserve += j.worker_fee.0;
                    self.worker_mut(&worker).disputes_lost += 1;
                    j.state = if was_unresolved { JobState::Refunded } else { JobState::RefundDue };
                    self.suspend_if_needed(&worker);
                }
                if was_unresolved {
                    let w = self.worker_mut(&worker);
                    w.unresolved_open = w.unresolved_open.saturating_sub(1);
                    self.close_job(); // Unresolved always ends Refunded
                }
            }
            (JobState::ComplaintReview, "complaint") => {
                let upheld = result.codes.iter().any(|c| c == "COMPLAINT_UPHELD");
                emit("complaint_result", json!({ "job_id": job, "upheld": upheld }));
                if upheld {
                    self.strike();
                    j.state = JobState::RefundDue;
                } else {
                    j.state = JobState::Delivered;
                }
            }
            _ => env::panic_str("E_BAD_STATE"),
        }
        self.jobs.insert(job, j);
    }

    /// Shark records a payer's complaint (the payer proved ownership with NEP-413 off chain, API §1.6).
    pub fn complain(&mut self, job: u64, reason_hash: String) {
        self.only(&self.shark.clone());
        let mut j = self.job(job);
        require!(j.state == JobState::Delivered && j.complaint_hash.is_none(), "E_BAD_STATE");
        require!(j.complaint_until.is_some_and(|t| now_secs() <= t), "E_WINDOW_CLOSED");
        j.state = JobState::ComplaintReview;
        j.complaint_hash = Some(reason_hash);
        self.jobs.insert(job, j);
        emit("complaint", json!({ "job_id": job }));
    }

    /// The awarded worker contests a final fail within the window; a second review (Owl, another model) decides (FR-45).
    pub fn dispute(&mut self, job: u64) {
        let mut j = self.job(job);
        require!(j.worker.as_ref() == Some(&env::predecessor_account_id()), "E_UNAUTHORIZED");
        require!(j.state == JobState::Failed, "E_BAD_STATE");
        require!(j.dispute_until.is_some_and(|t| now_secs() <= t), "E_WINDOW_CLOSED");
        j.state = JobState::DisputeReview;
        j.review_requested_at = Some(now_secs());
        self.jobs.insert(job, j);
        emit("dispute", json!({ "job_id": job }));
    }

    /// Nobody disputed in time: the payer is refunded, the worker unpaid, its fee back to the reserve (FR-44). Anyone.
    pub fn settle_failed(&mut self, job: u64) {
        let mut j = self.job(job);
        require!(j.state == JobState::Failed, "E_BAD_STATE");
        require!(j.dispute_until.is_some_and(|t| now_secs() > t), "E_WINDOW_CLOSED");
        let worker = j.worker.clone().unwrap_or_else(|| env::panic_str("E_BAD_STATE"));
        self.reserve += j.worker_fee.0;
        j.escrowed = false;
        self.worker_mut(&worker).final_fails += 1;
        self.suspend_if_needed(&worker);
        j.state = JobState::RefundDue;
        self.jobs.insert(job, j);
    }

    /// The second review didn't come by `review_deadline`: refund the payer now and hold the worker fee (FR-46). Anyone.
    pub fn mark_unresolved(&mut self, job: u64) {
        let mut j = self.job(job);
        require!(j.state == JobState::DisputeReview, "E_BAD_STATE");
        let asked = j.review_requested_at.unwrap_or_else(|| env::panic_str("E_BAD_STATE"));
        require!(now_secs() > asked + self.config.review_deadline_secs, "E_TIMEOUT_NOT_REACHED");
        let worker = j.worker.clone().unwrap_or_else(|| env::panic_str("E_BAD_STATE"));
        self.worker_mut(&worker).unresolved_open += 1;
        j.held = true;
        j.unresolved_since = Some(now_secs());
        j.state = JobState::RefundDue; // `pay_refund` then moves it to Unresolved
        self.jobs.insert(job, j);
        emit("unresolved", json!({ "job_id": job, "worker": worker }));
    }

    /// Unresolved for the whole timeout: the worker gets its fee (FR-46). Anyone.
    pub fn release_unresolved(&mut self, job: u64) {
        let mut j = self.job(job);
        require!(j.state == JobState::Unresolved, "E_BAD_STATE");
        let since = j.unresolved_since.unwrap_or_else(|| env::panic_str("E_BAD_STATE"));
        require!(now_secs() >= since + self.config.unresolved_timeout_secs, "E_TIMEOUT_NOT_REACHED");
        let worker = j.worker.clone().unwrap_or_else(|| env::panic_str("E_BAD_STATE"));
        self.payout(&worker, j.worker_fee.0, job, "worker").detach();
        let w = self.worker_mut(&worker);
        w.disputes_unresolved += 1;
        w.unresolved_open = w.unresolved_open.saturating_sub(1);
        j.escrowed = false;
        j.state = JobState::Refunded;
        self.close_job();
        self.jobs.insert(job, j);
        emit("unresolved_released", json!({ "job_id": job, "worker": worker }));
    }

    /// Delivered and the complaint window is over: split the price (SRD §8.6). Anyone may call.
    pub fn finalize(&mut self, job: u64) {
        let mut j = self.job(job);
        require!(j.state == JobState::Delivered, "E_BAD_STATE");
        require!(j.complaint_until.is_some_and(|t| now_secs() > t), "E_WINDOW_CLOSED");
        let p = j.price.0;
        let referral = match &j.referrer {
            Some(r) if *r != j.payer && Some(r) != j.worker.as_ref() => p * j.referral_bps as u128 / BPS,
            _ => 0,
        };
        let profit = p.saturating_sub(j.worker_fee.0 + j.review_fee.0 + referral);
        let owners = profit * j.owner_bps as u128 / BPS;
        self.owner_accrued += owners;
        self.reserve += p - referral - owners;
        if referral > 0 {
            let r = j.referrer.clone().unwrap();
            self.payout(&r, referral, job, "referral").detach();
        }
        j.state = JobState::Finalized;
        self.close_job();
        self.jobs.insert(job, j);
        emit("finalized", json!({ "job_id": job, "referral": U128(referral), "owners": U128(owners), "reserve": U128(p - referral - owners) }));
    }

    /// Moves a stuck or unawarded job to RefundDue: Shark or the owner at any time, anyone after `job_timeout`.
    pub fn mark_refund_due(&mut self, job: u64) {
        let mut j = self.job(job);
        require!(matches!(j.state, JobState::Paid | JobState::Awarded | JobState::Revision), "E_BAD_STATE");
        let p = env::predecessor_account_id();
        require!(p == self.shark || p == self.owner || now_secs() >= j.paid_at + j.job_timeout_secs, "E_TIMEOUT_NOT_REACHED");
        if j.escrowed {
            self.reserve += j.worker_fee.0 + j.review_fee.0;
            j.escrowed = false;
        }
        j.state = JobState::RefundDue;
        self.jobs.insert(job, j);
    }

    /// Anyone. Refunds always go to the payer (FR-65); the payer is registered on USDC because it paid.
    pub fn pay_refund(&mut self, job: u64) -> Promise {
        let mut j = self.job(job);
        require!(j.state == JobState::RefundDue, "E_BAD_STATE");
        j.state = if j.held { JobState::Unresolved } else { JobState::Refunded };
        if !j.held {
            self.close_job();
        }
        let (to, amount) = (j.payer.clone(), j.price.0);
        self.jobs.insert(job, j);
        emit("refund", json!({ "job_id": job, "to": to, "amount": U128(amount), "reason": "refund_due" }));
        self.payout_refund(&to, amount, job)
    }

    // ---------- payout callback ----------

    /// A failed transfer is never retried blindly, so nothing is paid twice. A failed refund goes back to
    /// RefundDue for another `pay_refund` (fail to refund, never keep). Any other failed payout goes on the owed
    /// ledger: the money stays in the contract and anyone may retry it with `retry_owed`.
    #[private]
    pub fn on_payout(&mut self, job: u64, to: AccountId, amount: U128, kind: String, #[callback_result] r: Result<(), PromiseError>) {
        if r.is_ok() {
            emit("payout", json!({ "job_id": job, "to": to, "amount": amount, "kind": kind, "chain": "near" }));
            return;
        }
        self.accounted += amount.0;
        if kind == "refund" {
            let mut j = self.job(job);
            if j.state == JobState::Refunded {
                self.open_jobs += 1; // it was counted closed when the refund was sent
            }
            j.state = JobState::RefundDue;
            self.jobs.insert(job, j);
            emit("payout_failed", json!({ "job_id": job, "to": to, "amount": amount, "kind": kind }));
            return;
        }
        let id = self.owed_next;
        self.owed_next += 1;
        self.owed_open += 1;
        self.owed.insert(id, Owed { id, job, to: to.clone(), amount, kind: kind.clone() });
        emit("payout_failed", json!({ "job_id": job, "to": to, "amount": amount, "kind": kind, "owed_id": id }));
    }

    /// Tries a failed payout again. If it fails again it lands on the ledger under a new id. Anyone.
    pub fn retry_owed(&mut self, id: u64) -> Promise {
        let o = self.owed.remove(&id).unwrap_or_else(|| env::panic_str("E_BAD_STATE"));
        self.owed_open -= 1;
        self.payout(&o.to, o.amount.0, o.job, &o.kind)
    }

    // ---------- treasury (SRD FR-62, FR-63, FR-75) ----------

    /// Once per UTC day: `min(daily_budget, reserve - floor)` to Shark's wallet. Anyone.
    pub fn fund_shark(&mut self) {
        require!(!self.closed, "E_CLOSED");
        let day = now_secs() / DAY_SECS;
        require!(self.last_fund_day != day, "E_ONCE_PER_DAY");
        let floor = self.reserve_floor();
        require!(self.reserve > floor, "E_RESERVE_FLOOR");
        let amount = self.config.daily_budget.0.min(self.reserve - floor);
        self.last_fund_day = day;
        self.reserve -= amount;
        let to = self.shark_wallet.clone();
        self.payout(&to, amount, 0, "shark_budget").detach();
    }

    /// Pays the owners' accrued share, only while the reserve is at its floor. Anyone.
    pub fn pay_owners(&mut self) {
        require!(!self.closed, "E_CLOSED");
        require!(self.reserve >= self.reserve_floor(), "E_RESERVE_FLOOR");
        let amount = self.owner_accrued;
        require!(amount > 0, "E_WRONG_AMOUNT");
        self.owner_accrued = 0;
        let owner = self.owner.clone();
        self.payout(&owner, amount, 0, "owner").detach();
    }

    /// The end: paused, nothing open, nothing owed → all USDC to the DAO and the contract closes (FR-75).
    pub fn wind_down(&mut self) {
        self.only(&self.owner.clone());
        require!(self.paused, "E_PAUSED");
        require!(self.open_jobs == 0 && self.owed_open == 0, "E_OPEN_JOBS");
        let amount = self.accounted;
        self.closed = true;
        self.reserve = 0;
        self.owner_accrued = 0;
        emit("wound_down", json!({ "amount": U128(amount) }));
        if amount > 0 {
            let owner = self.owner.clone();
            self.payout(&owner, amount, 0, "owner").detach();
        }
    }

    /// Past the work deadline: the escrow goes back to Shark and the worker is marked late. The first time on an
    /// awarded job the job goes back to auction without that worker; otherwise it is refunded (FR-35). Anyone.
    pub fn expire_work(&mut self, job: u64) {
        let mut j = self.job(job);
        require!(matches!(j.state, JobState::Awarded | JobState::Revision), "E_BAD_STATE");
        require!(now_secs() > j.work_deadline, "E_TIMEOUT_NOT_REACHED");
        let worker = j.worker.clone().unwrap_or_else(|| env::panic_str("E_BAD_STATE"));
        self.worker_mut(&worker).late += 1;
        if j.escrowed {
            j.escrowed = false;
            let (wallet, back) = (self.shark_wallet.clone(), j.worker_fee.0 + j.review_fee.0);
            self.payout(&wallet, back, job, "shark_budget").detach();
        }
        if j.state == JobState::Awarded && !j.reauctioned {
            j.state = JobState::Paid;
            j.reauctioned = true;
            j.excluded = Some(worker.clone());
            j.worker = None;
            j.worker_fee = U128(0);
            j.bid_hash = None;
            j.reason_hash = None;
            j.round = 0;
            j.awarded_at = None;
            j.work_deadline = 0;
            emit("re_auction", json!({ "job_id": job, "late_worker": worker }));
        } else {
            j.state = JobState::RefundDue;
        }
        self.jobs.insert(job, j);
    }

    // ---------- views ----------

    pub fn get_job(&self, job: u64) -> Option<Job> {
        self.jobs.get(&job).cloned()
    }

    /// The job a paid quote became (API §1.3).
    pub fn get_job_by_quote(&self, quote_id: String) -> Option<Job> {
        self.used_quotes.get(&quote_id).and_then(|id| self.jobs.get(id).cloned())
    }

    pub fn get_jobs(&self, from: u64, limit: u64) -> Vec<Job> {
        (from.max(1)..self.next_job).take(limit.min(100) as usize).filter_map(|i| self.jobs.get(&i).cloned()).collect()
    }

    pub fn get_config(&self) -> Config {
        self.config.clone()
    }

    pub fn get_workers(&self) -> Vec<Worker> {
        self.workers.values().cloned().collect()
    }

    pub fn get_reviewer(&self) -> Option<Reviewer> {
        self.reviewer.clone()
    }

    /// `max(m × 10 000 / worker_cap_bps, m + review_fee)`, m = cheapest eligible worker's min fee (FR-22).
    pub fn get_price_floor(&self, job_type: JobType) -> U128 {
        let m = self.workers.values().filter(|w| !w.suspended).filter_map(|w| w.min_fee(job_type)).min();
        let rf = self.config.review_fee.0;
        U128(m.map_or(rf, |m| (m * BPS / self.config.worker_cap_bps as u128).max(m + rf)))
    }

    pub fn get_service_state(&self) -> String {
        if self.closed {
            "closed"
        } else if self.paused {
            "paused"
        } else if self.strikes >= self.config.strike_threshold {
            "caged"
        } else {
            "ok"
        }
        .into()
    }

    pub fn get_stats(&self) -> Stats {
        Stats {
            jobs: self.next_job - 1,
            strikes: self.strikes,
            reserve: U128(self.reserve),
            owner_accrued: U128(self.owner_accrued),
            accounted: U128(self.accounted),
            open_jobs: self.open_jobs,
            owed_open: self.owed_open,
        }
    }

    /// The ledger of failed payouts, oldest first from id `from`.
    pub fn get_owed(&self, from: u64, limit: u64) -> Vec<Owed> {
        (from.max(1)..self.owed_next).filter_map(|i| self.owed.get(&i).cloned()).take(limit.min(100) as usize).collect()
    }

    pub fn get_quote_pubkey(&self) -> PublicKey {
        self.quote_pubkey.clone()
    }

    pub fn get_roles(&self) -> Roles {
        Roles { owner: self.owner.clone(), guardian: self.guardian.clone(), shark: self.shark.clone(), shark_wallet: self.shark_wallet.clone(), usdc: self.usdc.clone(), network: self.network.clone() }
    }
}

impl Contract {
    fn only(&self, who: &AccountId) {
        require!(env::predecessor_account_id() == *who, "E_UNAUTHORIZED");
    }

    fn job(&self, id: u64) -> Job {
        self.jobs.get(&id).cloned().unwrap_or_else(|| env::panic_str("E_BAD_STATE"))
    }

    fn worker_mut(&mut self, id: &AccountId) -> &mut Worker {
        self.workers.get_mut(id).unwrap_or_else(|| env::panic_str("E_UNKNOWN_AGENT"))
    }

    fn check_config(&self, c: &Config) {
        require!(c.worker_cap_bps > 0 && c.worker_cap_bps as u128 <= BPS, "E_BAD_CONFIG");
        require!(c.referral_bps as u128 <= BPS && c.owner_bps as u128 <= BPS, "E_BAD_CONFIG");
        for t in [JobType::Extract, JobType::Summary, JobType::Thread] {
            let b = c.band(t);
            require!(b.band_min.0 <= b.band_max.0, "E_BAD_CONFIG");
            // band minimum must stay at or above the floor (FR-22); with no workers yet the floor is the review fee
            require!(b.band_min.0 >= c.review_fee.0, "E_BAD_CONFIG");
        }
    }

    /// Method 1 checks (FR-06). Err carries the contract error code for `payment_returned`.
    fn try_pay(&mut self, sender: &AccountId, amount: u128, b64: &str) -> Result<u64, &'static str> {
        if self.closed {
            return Err("E_CLOSED");
        }
        if self.paused {
            return Err("E_PAUSED");
        }
        if self.strikes >= self.config.strike_threshold {
            return Err("E_CAGED");
        }
        let raw = near_sdk::base64::Engine::decode(&near_sdk::base64::engine::general_purpose::STANDARD, b64).map_err(|_| "E_BAD_QUOTE_SIG")?;
        let m: PayMsg = serde_json::from_slice(&raw).map_err(|_| "E_BAD_QUOTE_SIG")?;
        let q = m.quote;
        let sig = m
            .sig
            .strip_prefix("ed25519:")
            .and_then(|s| near_sdk::bs58::decode(s).into_vec().ok())
            .and_then(|v| <[u8; 64]>::try_from(v).ok())
            .ok_or("E_BAD_QUOTE_SIG")?;
        let pk: [u8; 32] = self.quote_pubkey.as_bytes()[1..].try_into().map_err(|_| "E_BAD_QUOTE_SIG")?;
        let canonical = serde_json::to_string(&q).map_err(|_| "E_BAD_QUOTE_SIG")?;
        let digest = env::sha256_array(format!("{QUOTE_DOMAIN}{canonical}").as_bytes());
        if !env::ed25519_verify(&sig, &digest, &pk) {
            return Err("E_BAD_QUOTE_SIG");
        }
        if q.network != self.network {
            return Err("E_BAD_QUOTE_SIG");
        }
        if *sender != q.payer {
            return Err("E_WRONG_PAYER");
        }
        if amount != q.price.0 {
            return Err("E_WRONG_AMOUNT");
        }
        let band = self.config.band(q.job_type);
        if q.price.0 < band.band_min.0 || q.price.0 > band.band_max.0 {
            return Err("E_PRICE_OUT_OF_BAND");
        }
        if q.price.0 < self.get_price_floor(q.job_type).0 {
            return Err("E_PRICE_BELOW_FLOOR");
        }
        if now_secs() > q.expires_at {
            return Err("E_QUOTE_EXPIRED");
        }
        if self.used_quotes.contains_key(&q.quote_id) {
            return Err("E_QUOTE_USED");
        }
        let id = self.next_job;
        self.next_job += 1;
        self.used_quotes.insert(q.quote_id.clone(), id);
        self.jobs.insert(
            id,
            Job {
                id,
                quote_id: q.quote_id,
                payer: q.payer,
                job_type: q.job_type,
                price: q.price,
                input_hash: q.input_hash,
                brief_hash: q.brief_hash,
                referrer: q.referrer,
                state: JobState::Paid,
                paid_at: now_secs(),
                worker: None,
                worker_fee: U128(0),
                escrowed: false,
                bid_hash: None,
                reason_hash: None,
                round: 0,
                delivery_hash: None,
                work_deadline: 0,
                awarded_at: None,
                delivered_at: None,
                reviewed_at: None,
                complaint_until: None,
                complaint_hash: None,
                codes: vec![],
                reasons_hash: None,
                dispute_until: None,
                review_requested_at: None,
                unresolved_since: None,
                held: false,
                reauctioned: false,
                excluded: None,
                review_fee: self.config.review_fee,
                referral_bps: self.config.referral_bps,
                owner_bps: self.config.owner_bps,
                complaint_window_secs: self.config.complaint_window_secs,
                job_timeout_secs: self.config.job_timeout_secs,
            },
        );
        self.open_jobs += 1;
        Ok(id)
    }

    fn pay_worker_and_reviewer(&mut self, j: &mut Job, worker: &AccountId, reviewer: &AccountId) {
        require!(j.escrowed, "E_BAD_STATE");
        j.escrowed = false;
        // shortcut: only NEAR payouts; Raven's Base payout via Chain Signatures comes with that slice (FR-60)
        self.payout(worker, j.worker_fee.0, j.id, "worker").detach();
        self.payout(reviewer, j.review_fee.0, j.id, "reviewer").detach();
    }

    fn reserve_floor(&self) -> u128 {
        3 * self.config.daily_budget.0 + 2 * self.config.review_fee.0 // D-145
    }

    fn close_job(&mut self) {
        self.open_jobs = self.open_jobs.saturating_sub(1);
    }

    /// FR-47: final fails plus lost disputes at the threshold suspend the worker.
    /// shortcut: counted over the worker's whole record, not the last 20 jobs; add the window with the event reader.
    fn suspend_if_needed(&mut self, worker: &AccountId) {
        let threshold = self.config.suspend_threshold as u32;
        let w = self.worker_mut(worker);
        if !w.suspended && w.final_fails + w.disputes_lost >= threshold {
            w.suspended = true;
            emit("worker_suspended", json!({ "id": worker }));
        }
    }

    /// The second review's fee comes from the reserve (FR-45).
    /// shortcut: capped at what the reserve holds, so an empty reserve means an unpaid second review.
    fn pay_second_review(&mut self, reviewer: &AccountId, fee: u128, job: u64) {
        let amount = fee.min(self.reserve);
        if amount == 0 {
            return;
        }
        self.reserve -= amount;
        self.payout(reviewer, amount, job, "reviewer").detach();
    }

    fn strike(&mut self) {
        self.strikes = self.strikes.saturating_add(1);
        emit("strike", json!({ "count": self.strikes, "threshold": self.config.strike_threshold }));
        if self.strikes == self.config.strike_threshold {
            emit("caged", json!({ "count": self.strikes, "threshold": self.config.strike_threshold }));
        }
    }

    /// A refund registers the payer on the USDC token first if needed (FR-65). The contract pays the 0.00125 NEAR
    /// deposit, so it needs a little NEAR; if the deposit fails the transfer still goes ahead.
    fn payout_refund(&mut self, to: &AccountId, amount: u128, job: u64) -> Promise {
        self.accounted -= amount;
        ext_ft::ext(self.usdc.clone())
            .with_attached_deposit(STORAGE_DEPOSIT)
            .with_static_gas(GAS_STORAGE)
            .storage_deposit(Some(to.clone()), Some(true))
            .then(
                ext_ft::ext(self.usdc.clone())
                    .with_attached_deposit(ONE_YOCTO)
                    .with_static_gas(GAS_FT_TRANSFER)
                    .ft_transfer(to.clone(), U128(amount), Some(format!("sharkco:refund:{job}"))),
            )
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_CALLBACK).on_payout(job, to.clone(), U128(amount), "refund".into()))
    }

    fn payout(&mut self, to: &AccountId, amount: u128, job: u64, kind: &str) -> Promise {
        self.accounted -= amount;
        ext_ft::ext(self.usdc.clone())
            .with_attached_deposit(ONE_YOCTO)
            .with_static_gas(GAS_FT_TRANSFER)
            .ft_transfer(to.clone(), U128(amount), Some(format!("sharkco:{kind}:{job}")))
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_CALLBACK).on_payout(job, to.clone(), U128(amount), kind.into()))
    }
}

#[cfg(test)]
mod tests;
