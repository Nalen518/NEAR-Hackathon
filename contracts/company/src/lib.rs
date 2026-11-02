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
const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);
const BPS: u128 = 10_000;
const QUOTE_DOMAIN: &str = "sharkco:quote:v2|";

#[ext_contract(ext_ft)]
#[allow(dead_code)]
trait FungibleToken {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
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

#[near(serializers = [json])]
pub struct Roles {
    pub owner: AccountId,
    pub guardian: AccountId,
    pub shark: AccountId,
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
}

#[derive(BorshStorageKey)]
#[near]
enum Key {
    Jobs,
    Workers,
    UsedQuotes,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    owner: AccountId,
    guardian: AccountId,
    shark: AccountId,
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
            require!(sender_id == self.shark, "E_UNAUTHORIZED");
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
        require!(!w.suspended, "E_NOT_ELIGIBLE");
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
                    // second fail: payer refunded, worker unpaid, its fee back to the reserve, Owl paid (FR-44)
                    // shortcut: the dispute window (FR-44, FR-45) comes with the dispute slice; until then a second fail is final
                    self.reserve += j.worker_fee.0;
                    self.payout(&rv.id, j.review_fee.0, job, "reviewer").detach();
                    j.escrowed = false;
                    let w = self.worker_mut(&worker);
                    w.jobs += 1;
                    w.final_fails += 1;
                    let w = w.clone();
                    if w.final_fails >= self.config.suspend_threshold as u32 && !w.suspended {
                        self.worker_mut(&worker).suspended = true;
                        emit("worker_suspended", json!({ "id": worker }));
                    }
                    j.state = JobState::RefundDue;
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
        j.state = JobState::Refunded;
        let (to, amount) = (j.payer.clone(), j.price.0);
        self.jobs.insert(job, j);
        emit("refund", json!({ "job_id": job, "to": to, "amount": U128(amount), "reason": "refund_due" }));
        self.payout(&to, amount, job, "refund")
    }

    // ---------- payout callback ----------

    /// A failed transfer is never retried blindly, so nothing is paid twice. A failed refund goes back to
    /// RefundDue for another `pay_refund` (fail to refund, never keep).
    /// shortcut: a failed worker, reviewer or referral payout is parked in the reserve with a `payout_failed`
    /// event; add an owed ledger with a permissionless retry before mainnet-lite.
    #[private]
    pub fn on_payout(&mut self, job: u64, to: AccountId, amount: U128, kind: String, #[callback_result] r: Result<(), PromiseError>) {
        if r.is_ok() {
            emit("payout", json!({ "job_id": job, "to": to, "amount": amount, "kind": kind, "chain": "near" }));
            return;
        }
        self.accounted += amount.0;
        if kind == "refund" {
            let mut j = self.job(job);
            j.state = JobState::RefundDue;
            self.jobs.insert(job, j);
        } else {
            self.reserve += amount.0;
        }
        emit("payout_failed", json!({ "job_id": job, "to": to, "amount": amount, "kind": kind }));
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
        }
    }

    pub fn get_quote_pubkey(&self) -> PublicKey {
        self.quote_pubkey.clone()
    }

    pub fn get_roles(&self) -> Roles {
        Roles { owner: self.owner.clone(), guardian: self.guardian.clone(), shark: self.shark.clone(), usdc: self.usdc.clone(), network: self.network.clone() }
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
                review_fee: self.config.review_fee,
                referral_bps: self.config.referral_bps,
                owner_bps: self.config.owner_bps,
                complaint_window_secs: self.config.complaint_window_secs,
                job_timeout_secs: self.config.job_timeout_secs,
            },
        );
        Ok(id)
    }

    fn pay_worker_and_reviewer(&mut self, j: &mut Job, worker: &AccountId, reviewer: &AccountId) {
        require!(j.escrowed, "E_BAD_STATE");
        j.escrowed = false;
        // shortcut: only NEAR payouts; Raven's Base payout via Chain Signatures comes with that slice (FR-60)
        self.payout(worker, j.worker_fee.0, j.id, "worker").detach();
        self.payout(reviewer, j.review_fee.0, j.id, "reviewer").detach();
    }

    fn strike(&mut self) {
        self.strikes = self.strikes.saturating_add(1);
        emit("strike", json!({ "count": self.strikes, "threshold": self.config.strike_threshold }));
        if self.strikes == self.config.strike_threshold {
            emit("caged", json!({ "count": self.strikes, "threshold": self.config.strike_threshold }));
        }
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
