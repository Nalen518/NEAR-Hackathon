// Unit tests for the first slice. Numbers are the SRD §8.7 testnet sample.
use super::*;
use ed25519_dalek::{Signer, SigningKey};
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::{CurveType, testing_env};

const NET: &str = "near:testnet";

fn acc(s: &str) -> AccountId {
    s.parse().unwrap()
}
fn usdc() -> AccountId {
    acc("usdc.testnet")
}
fn key() -> SigningKey {
    SigningKey::from_bytes(&[7u8; 32])
}

fn ctx(predecessor: &str, secs: u64) {
    let mut b = VMContextBuilder::new();
    b.current_account_id(acc("sharkco.testnet"))
        .predecessor_account_id(acc(predecessor))
        .block_timestamp(secs * 1_000_000_000);
    testing_env!(b.build());
}

fn config() -> Config {
    let band = |a: u128, b: u128| TypeConfig { band_min: U128(a), band_max: U128(b) };
    Config {
        extract: band(300_000, 1_500_000),
        summary: band(200_000, 1_000_000),
        thread: band(500_000, 2_000_000),
        worker_cap_bps: 5000,
        review_fee: U128(50_000),
        referral_bps: 750,
        owner_bps: 6000,
        daily_budget: U128(4_000_000),
        strike_threshold: 3,
        suspend_threshold: 3,
        max_unresolved_open: 2,
        work_deadline_secs: 600,
        review_deadline_secs: 600,
        dispute_window_secs: 3_600,
        unresolved_timeout_secs: 604_800,
        complaint_window_secs: 86_400,
        job_timeout_secs: 21_600,
    }
}

fn setup() -> Contract {
    ctx("deployer.testnet", 1_000);
    let pk = PublicKey::from_parts(CurveType::ED25519, key().verifying_key().to_bytes().to_vec()).unwrap();
    let mut c = Contract::new(acc("dao.testnet"), acc("guardian.testnet"), acc("shark.testnet"), acc("wallet.testnet"), pk, usdc(), NET.into(), config());
    ctx("dao.testnet", 1_000);
    c.register_worker(acc("crab.testnet"), vec![JobType::Extract, JobType::Summary, JobType::Thread], vec![U128(100_000), U128(60_000), U128(120_000)]);
    c.register_reviewer(acc("owl.testnet"));
    c
}

fn quote(id: &str, price: u128, payer: &str) -> Quote {
    Quote {
        brief_hash: "sha256:b".into(),
        expires_at: 2_000,
        input_hash: "sha256:i".into(),
        job_type: JobType::Summary,
        network: NET.into(),
        payer: acc(payer),
        price: U128(price),
        quote_id: id.into(),
        referrer: Some(acc("ref.testnet")),
    }
}

fn quote_sig(q: &Quote, k: &SigningKey) -> String {
    let canonical = serde_json::to_string(q).unwrap();
    let digest = env::sha256_array(format!("{QUOTE_DOMAIN}{canonical}").as_bytes());
    format!("ed25519:{}", near_sdk::bs58::encode(k.sign(&digest).to_bytes()).into_string())
}

/// What Shark sends in `msg` (API §1.2).
fn pay_msg(q: &Quote, k: &SigningKey) -> String {
    let sig = quote_sig(q, k);
    let body = json!({ "quote": q, "sig": sig }).to_string();
    format!("pay:{}", near_sdk::base64::Engine::encode(&near_sdk::base64::engine::general_purpose::STANDARD, body))
}

fn pay(c: &mut Contract, q: &Quote, sender: &str, amount: u128) -> u128 {
    ctx(usdc().as_str(), 1_000);
    match c.ft_on_transfer(acc(sender), U128(amount), pay_msg(q, &key())) {
        PromiseOrValue::Value(v) => v.0,
        _ => panic!("expected a value"),
    }
}

/// Paid → awarded → escrowed → delivered (round 1). Returns the job id.
fn delivered_job(c: &mut Contract) -> u64 {
    assert_eq!(pay(c, &quote("q_A", 600_000, "buyer.testnet"), "buyer.testnet", 600_000), 0);
    ctx("shark.testnet", 1_010);
    c.award(1, acc("crab.testnet"), U128(180_000), "sha256:bid".into(), "sha256:why".into());
    ctx(usdc().as_str(), 1_011);
    let _ = c.ft_on_transfer(acc("wallet.testnet"), U128(230_000), "escrow:1".into());
    ctx("crab.testnet", 1_100);
    c.deliver(1, "sha256:d".into());
    1
}

fn review(c: &mut Contract, job: u64, mode: &str, pass: bool, codes: &[&str], at: u64) {
    ctx("owl.testnet", at);
    c.on_review(job, ReviewResult { mode: mode.into(), pass, codes: codes.iter().map(|s| s.to_string()).collect(), reasons_hash: "sha256:r".into() });
}

#[test]
fn floor_follows_cheapest_worker() {
    let c = setup();
    // max(0.06 / 50%, 0.06 + 0.05) = 0.12 (SRD §8.7)
    assert_eq!(c.get_price_floor(JobType::Summary).0, 120_000);
    assert_eq!(c.get_price_floor(JobType::Extract).0, 200_000);
    assert_eq!(c.get_price_floor(JobType::Thread).0, 240_000);
}

#[test]
fn valid_quote_is_paid() {
    let mut c = setup();
    assert_eq!(pay(&mut c, &quote("q_A", 600_000, "buyer.testnet"), "buyer.testnet", 600_000), 0);
    let j = c.get_job(1).unwrap();
    assert_eq!(j.state, JobState::Paid);
    assert_eq!(j.price.0, 600_000);
    assert_eq!(c.get_stats().accounted.0, 600_000);
}

#[test]
fn bad_payments_are_returned_in_full() {
    let mut c = setup();
    let q = quote("q_A", 600_000, "buyer.testnet");
    // wrong sender, wrong amount
    assert_eq!(pay(&mut c, &q, "stranger.testnet", 600_000), 600_000);
    assert_eq!(pay(&mut c, &q, "buyer.testnet", 500_000), 500_000);
    // out of band, below floor is impossible inside this band, wrong network, expired
    assert_eq!(pay(&mut c, &quote("q_B", 1_200_000, "buyer.testnet"), "buyer.testnet", 1_200_000), 1_200_000);
    let mut mainnet = quote("q_C", 600_000, "buyer.testnet");
    mainnet.network = "near:mainnet".into();
    assert_eq!(pay(&mut c, &mainnet, "buyer.testnet", 600_000), 600_000);
    let mut old = quote("q_D", 600_000, "buyer.testnet");
    old.expires_at = 999;
    assert_eq!(pay(&mut c, &old, "buyer.testnet", 600_000), 600_000);
    // signed by another key
    ctx(usdc().as_str(), 1_000);
    let forged = pay_msg(&quote("q_E", 600_000, "buyer.testnet"), &SigningKey::from_bytes(&[9u8; 32]));
    assert!(matches!(c.ft_on_transfer(acc("buyer.testnet"), U128(600_000), forged), PromiseOrValue::Value(U128(600_000))));
    assert!(c.get_job(1).is_none());
    assert_eq!(c.get_stats().accounted.0, 0);
}

#[test]
fn a_quote_pays_once() {
    let mut c = setup();
    let q = quote("q_A", 600_000, "buyer.testnet");
    assert_eq!(pay(&mut c, &q, "buyer.testnet", 600_000), 0);
    assert_eq!(pay(&mut c, &q, "buyer.testnet", 600_000), 600_000);
}

#[test]
fn a_tampered_quote_fails_the_signature() {
    let mut c = setup();
    let q = quote("q_A", 600_000, "buyer.testnet");
    let mut msg = pay_msg(&q, &key());
    let mut cheap = q.clone();
    cheap.price = U128(300_000);
    // swap in a cheaper quote but keep the original signature
    let body: serde_json::Value = serde_json::from_slice(
        &near_sdk::base64::Engine::decode(&near_sdk::base64::engine::general_purpose::STANDARD, msg.strip_prefix("pay:").unwrap()).unwrap(),
    )
    .unwrap();
    let swapped = json!({ "quote": cheap, "sig": body["sig"] }).to_string();
    msg = format!("pay:{}", near_sdk::base64::Engine::encode(&near_sdk::base64::engine::general_purpose::STANDARD, swapped));
    ctx(usdc().as_str(), 1_000);
    assert!(matches!(c.ft_on_transfer(acc("buyer.testnet"), U128(300_000), msg), PromiseOrValue::Value(U128(300_000))));
}

#[test]
#[should_panic(expected = "E_UNAUTHORIZED")]
fn only_usdc_can_call_ft_on_transfer() {
    let mut c = setup();
    ctx("fake-usdc.testnet", 1_000);
    let _ = c.ft_on_transfer(acc("buyer.testnet"), U128(600_000), pay_msg(&quote("q_A", 600_000, "buyer.testnet"), &key()));
}

#[test]
#[should_panic(expected = "E_OVER_CAP")]
fn award_over_the_worker_cap_fails() {
    let mut c = setup();
    pay(&mut c, &quote("q_A", 600_000, "buyer.testnet"), "buyer.testnet", 600_000);
    ctx("shark.testnet", 1_010);
    c.award(1, acc("crab.testnet"), U128(300_001), "h".into(), "h".into());
}

#[test]
#[should_panic(expected = "E_BELOW_MIN_FEE")]
fn award_below_min_fee_fails() {
    let mut c = setup();
    pay(&mut c, &quote("q_A", 600_000, "buyer.testnet"), "buyer.testnet", 600_000);
    ctx("shark.testnet", 1_010);
    c.award(1, acc("crab.testnet"), U128(59_999), "h".into(), "h".into());
}

#[test]
#[should_panic(expected = "E_WRONG_AMOUNT")]
fn escrow_must_be_fee_plus_review_fee() {
    let mut c = setup();
    pay(&mut c, &quote("q_A", 600_000, "buyer.testnet"), "buyer.testnet", 600_000);
    ctx("shark.testnet", 1_010);
    c.award(1, acc("crab.testnet"), U128(180_000), "h".into(), "h".into());
    ctx(usdc().as_str(), 1_011);
    let _ = c.ft_on_transfer(acc("wallet.testnet"), U128(180_000), "escrow:1".into());
}

#[test]
fn pass_then_finalize_splits_the_price() {
    let mut c = setup();
    let id = delivered_job(&mut c);
    review(&mut c, id, "primary", true, &["PASS"], 1_200);
    let j = c.get_job(id).unwrap();
    assert_eq!(j.state, JobState::Delivered);
    assert_eq!(j.complaint_until, Some(1_200 + 86_400));
    assert_eq!(j.reasons_hash.as_deref(), Some("sha256:r"));
    ctx("anyone.testnet", 1_200 + 86_401);
    c.finalize(id);
    let s = c.get_stats();
    // 0.60: referral 0.045, profit 0.325, owners 0.195, reserve 0.36 (0.13 profit + 0.23 refill)
    assert_eq!(s.owner_accrued.0, 195_000);
    assert_eq!(s.reserve.0, 360_000);
    assert_eq!(c.get_job(id).unwrap().state, JobState::Finalized);
    // in: 0.60 + 0.23 escrow. out: worker 0.18, Owl 0.05, referral 0.045
    assert_eq!(s.accounted.0, 830_000 - 180_000 - 50_000 - 45_000);
}

#[test]
#[should_panic(expected = "E_WINDOW_CLOSED")]
fn finalize_waits_for_the_complaint_window() {
    let mut c = setup();
    let id = delivered_job(&mut c);
    review(&mut c, id, "primary", true, &["PASS"], 1_200);
    ctx("anyone.testnet", 1_300);
    c.finalize(id);
}

#[test]
#[should_panic(expected = "E_BAD_STATE")]
fn a_refund_pays_once() {
    let mut c = setup();
    pay(&mut c, &quote("q_A", 600_000, "buyer.testnet"), "buyer.testnet", 600_000);
    ctx("shark.testnet", 1_010);
    c.mark_refund_due(1);
    c.pay_refund(1).detach();
    c.pay_refund(1).detach();
}

#[test]
#[should_panic(expected = "E_TIMEOUT_NOT_REACHED")]
fn strangers_wait_for_the_job_timeout() {
    let mut c = setup();
    pay(&mut c, &quote("q_A", 600_000, "buyer.testnet"), "buyer.testnet", 600_000);
    ctx("anyone.testnet", 1_100);
    c.mark_refund_due(1);
}

#[test]
fn three_upheld_complaints_cage_shark() {
    let mut c = setup();
    for (i, qid) in ["q_A", "q_B", "q_C"].iter().enumerate() {
        let id = (i + 1) as u64;
        assert_eq!(pay(&mut c, &quote(qid, 600_000, "buyer.testnet"), "buyer.testnet", 600_000), 0);
        ctx("shark.testnet", 1_010);
        c.award(id, acc("crab.testnet"), U128(180_000), "h".into(), "h".into());
        ctx(usdc().as_str(), 1_011);
        let _ = c.ft_on_transfer(acc("wallet.testnet"), U128(230_000), format!("escrow:{id}"));
        ctx("crab.testnet", 1_100);
        c.deliver(id, "sha256:d".into());
        review(&mut c, id, "primary", true, &["PASS"], 1_200);
        ctx("shark.testnet", 1_300);
        c.complain(id, "sha256:why".into());
        review(&mut c, id, "complaint", false, &["COMPLAINT_UPHELD"], 1_400);
        assert_eq!(c.get_job(id).unwrap().state, JobState::RefundDue);
    }
    assert_eq!(c.get_service_state(), "caged");
    assert_eq!(pay(&mut c, &quote("q_D", 600_000, "buyer.testnet"), "buyer.testnet", 600_000), 600_000);
}

#[test]
fn a_rejected_complaint_changes_nothing() {
    let mut c = setup();
    let id = delivered_job(&mut c);
    review(&mut c, id, "primary", true, &["PASS"], 1_200);
    ctx("shark.testnet", 1_300);
    c.complain(id, "sha256:why".into());
    review(&mut c, id, "complaint", false, &["COMPLAINT_REJECTED"], 1_400);
    assert_eq!(c.get_job(id).unwrap().state, JobState::Delivered);
    assert_eq!(c.get_stats().strikes, 0);
}

#[test]
fn brief_invalid_refunds_strikes_and_pays_the_worker() {
    let mut c = setup();
    let id = delivered_job(&mut c);
    review(&mut c, id, "primary", false, &["BRIEF_INVALID"], 1_200);
    assert_eq!(c.get_job(id).unwrap().state, JobState::RefundDue);
    assert_eq!(c.get_stats().strikes, 1);
}

#[test]
fn paused_returns_payments() {
    let mut c = setup();
    ctx("guardian.testnet", 1_000);
    c.pause();
    assert_eq!(c.get_service_state(), "paused");
    assert_eq!(pay(&mut c, &quote("q_A", 600_000, "buyer.testnet"), "buyer.testnet", 600_000), 600_000);
}

#[test]
#[should_panic(expected = "E_UNAUTHORIZED")]
fn the_guardian_cannot_unpause() {
    let mut c = setup();
    ctx("guardian.testnet", 1_000);
    c.pause();
    c.unpause();
}

/// Shark (TypeScript) must produce exactly these bytes; services/shark/test/quote.test.ts pins the same string.
#[test]
fn canonical_quote_bytes() {
    let q = quote("q_A", 600_000, "buyer.testnet");
    assert_eq!(
        serde_json::to_string(&q).unwrap(),
        r#"{"brief_hash":"sha256:b","expires_at":2000,"input_hash":"sha256:i","job_type":"summary","network":"near:testnet","payer":"buyer.testnet","price":"600000","quote_id":"q_A","referrer":"ref.testnet"}"#
    );
}

#[test]
fn job_by_quote_finds_the_paid_job() {
    let mut c = setup();
    pay(&mut c, &quote("q_A", 600_000, "buyer.testnet"), "buyer.testnet", 600_000);
    assert_eq!(c.get_job_by_quote("q_A".into()).unwrap().id, 1);
    assert!(c.get_job_by_quote("q_B".into()).is_none());
}

#[test]
fn roles_view() {
    let c = setup();
    let r = c.get_roles();
    assert_eq!((r.owner.as_str(), r.guardian.as_str(), r.shark.as_str(), r.shark_wallet.as_str(), r.network.as_str()), ("dao.testnet", "guardian.testnet", "shark.testnet", "wallet.testnet", NET));
}

// ---------- disputes and Unresolved (FR-44 to FR-47) ----------

/// Pay, award, escrow, deliver and fail twice. The job ends Failed at 1_400 with the dispute window open until 5_000.
fn failed_job(c: &mut Contract, id: u64, qid: &str) {
    assert_eq!(pay(c, &quote(qid, 600_000, "buyer.testnet"), "buyer.testnet", 600_000), 0);
    ctx("shark.testnet", 1_010);
    c.award(id, acc("crab.testnet"), U128(180_000), "h".into(), "h".into());
    ctx(usdc().as_str(), 1_011);
    let _ = c.ft_on_transfer(acc("wallet.testnet"), U128(230_000), format!("escrow:{id}"));
    ctx("crab.testnet", 1_100);
    c.deliver(id, "sha256:d".into());
    review(c, id, "primary", false, &["FAIL_LENGTH"], 1_200);
    ctx("crab.testnet", 1_300);
    c.deliver(id, "sha256:d2".into());
    review(c, id, "primary", false, &["FAIL_LENGTH"], 1_400);
}

fn seed_reserve(c: &mut Contract, amount: u128) {
    ctx(usdc().as_str(), 1_000);
    let _ = c.ft_on_transfer(acc("dao.testnet"), U128(amount), "reserve".into());
}

fn dispute_at(c: &mut Contract, id: u64, at: u64) {
    ctx("crab.testnet", at);
    c.dispute(id);
}

#[test]
fn a_second_fail_opens_a_dispute_window_and_pays_no_one_else() {
    let mut c = setup();
    failed_job(&mut c, 1, "q_A");
    let j = c.get_job(1).unwrap();
    assert_eq!((j.state, j.dispute_until, j.escrowed), (JobState::Failed, Some(5_000), true));
    let w = &c.get_workers()[0];
    assert_eq!((w.jobs, w.final_fails, w.disputes_lost), (1, 0, 0));
    assert_eq!(c.get_stats().reserve.0, 0);
}

#[test]
fn no_dispute_means_refund_and_an_unpaid_worker() {
    let mut c = setup();
    failed_job(&mut c, 1, "q_A");
    ctx("anyone.testnet", 5_001);
    c.settle_failed(1);
    assert_eq!(c.get_job(1).unwrap().state, JobState::RefundDue);
    assert_eq!(c.get_stats().reserve.0, 180_000); // the unpaid worker fee
    assert_eq!(c.get_workers()[0].final_fails, 1);
    c.pay_refund(1).detach();
    assert_eq!(c.get_job(1).unwrap().state, JobState::Refunded);
}

#[test]
#[should_panic(expected = "E_WINDOW_CLOSED")]
fn settle_failed_waits_for_the_window() {
    let mut c = setup();
    failed_job(&mut c, 1, "q_A");
    ctx("anyone.testnet", 4_000);
    c.settle_failed(1);
}

#[test]
#[should_panic(expected = "E_WINDOW_CLOSED")]
fn a_late_dispute_is_refused() {
    let mut c = setup();
    failed_job(&mut c, 1, "q_A");
    dispute_at(&mut c, 1, 5_001);
}

#[test]
#[should_panic(expected = "E_UNAUTHORIZED")]
fn only_the_worker_disputes() {
    let mut c = setup();
    failed_job(&mut c, 1, "q_A");
    ctx("stranger.testnet", 1_500);
    c.dispute(1);
}

#[test]
fn an_overturned_fail_pays_the_worker_and_delivers() {
    let mut c = setup();
    seed_reserve(&mut c, 1_000_000);
    failed_job(&mut c, 1, "q_A");
    dispute_at(&mut c, 1, 1_500);
    assert_eq!(c.get_job(1).unwrap().state, JobState::DisputeReview);
    review(&mut c, 1, "secondary", true, &["PASS"], 1_600);
    let j = c.get_job(1).unwrap();
    assert_eq!((j.state, j.escrowed, j.complaint_until), (JobState::Delivered, false, Some(1_600 + 86_400)));
    let w = &c.get_workers()[0];
    assert_eq!((w.disputes_won, w.final_fails), (1, 0));
    assert_eq!(c.get_reviewer().unwrap().overturned, 1);
    assert_eq!(c.get_stats().reserve.0, 950_000); // the second review fee came from the reserve
}

#[test]
fn a_dispute_that_fails_refunds_and_counts_against_the_worker() {
    let mut c = setup();
    seed_reserve(&mut c, 1_000_000);
    failed_job(&mut c, 1, "q_A");
    dispute_at(&mut c, 1, 1_500);
    review(&mut c, 1, "secondary", false, &["FAIL_LENGTH"], 1_600);
    assert_eq!(c.get_job(1).unwrap().state, JobState::RefundDue);
    let w = &c.get_workers()[0];
    assert_eq!((w.disputes_lost, w.final_fails), (1, 0));
    assert_eq!(c.get_stats().reserve.0, 1_000_000 + 180_000 - 50_000);
}

#[test]
#[should_panic(expected = "E_TIMEOUT_NOT_REACHED")]
fn unresolved_waits_for_the_review_deadline() {
    let mut c = setup();
    failed_job(&mut c, 1, "q_A");
    dispute_at(&mut c, 1, 1_500);
    ctx("anyone.testnet", 2_100); // asked at 1_500, deadline 600 s: must be after 2_100
    c.mark_unresolved(1);
}

/// Dispute at 1_500, no review by 2_101, refund paid: the job is Unresolved with the fee held.
fn unresolved_job(c: &mut Contract) {
    failed_job(c, 1, "q_A");
    dispute_at(c, 1, 1_500);
    ctx("anyone.testnet", 2_101);
    c.mark_unresolved(1);
    assert_eq!(c.get_job(1).unwrap().state, JobState::RefundDue);
    c.pay_refund(1).detach();
}

#[test]
fn an_unavailable_reviewer_refunds_now_and_holds_the_fee() {
    let mut c = setup();
    unresolved_job(&mut c);
    let j = c.get_job(1).unwrap();
    assert_eq!((j.state, j.held, j.escrowed, j.unresolved_since), (JobState::Unresolved, true, true, Some(2_101)));
    assert_eq!(c.get_workers()[0].unresolved_open, 1);
    assert_eq!(c.get_stats().reserve.0, 0); // the fee is still in escrow, not the reserve
}

#[test]
fn a_late_review_that_passes_pays_the_worker_after_the_refund() {
    let mut c = setup();
    unresolved_job(&mut c);
    review(&mut c, 1, "secondary", true, &["PASS"], 3_000);
    assert_eq!(c.get_job(1).unwrap().state, JobState::Refunded);
    let w = &c.get_workers()[0];
    assert_eq!((w.disputes_won, w.unresolved_open), (1, 0));
}

#[test]
fn a_late_review_that_fails_returns_the_fee_to_the_reserve() {
    let mut c = setup();
    unresolved_job(&mut c);
    review(&mut c, 1, "secondary", false, &["FAIL_LENGTH"], 3_000);
    assert_eq!(c.get_job(1).unwrap().state, JobState::Refunded);
    let w = &c.get_workers()[0];
    assert_eq!((w.disputes_lost, w.unresolved_open), (1, 0));
    assert_eq!(c.get_stats().reserve.0, 180_000);
}

#[test]
fn seven_days_unresolved_releases_the_fee_to_the_worker() {
    let mut c = setup();
    unresolved_job(&mut c);
    ctx("anyone.testnet", 2_101 + 604_800);
    c.release_unresolved(1);
    assert_eq!(c.get_job(1).unwrap().state, JobState::Refunded);
    let w = &c.get_workers()[0];
    assert_eq!((w.disputes_unresolved, w.unresolved_open), (1, 0));
}

#[test]
#[should_panic(expected = "E_TIMEOUT_NOT_REACHED")]
fn release_unresolved_waits_seven_days() {
    let mut c = setup();
    unresolved_job(&mut c);
    ctx("anyone.testnet", 2_101 + 604_799);
    c.release_unresolved(1);
}

#[test]
#[should_panic(expected = "E_NOT_ELIGIBLE")]
fn a_worker_at_the_unresolved_cap_cannot_win_an_award() {
    let mut c = setup();
    unresolved_job(&mut c);
    ctx("dao.testnet", 3_000);
    c.set_config(Config { max_unresolved_open: 1, ..config() });
    pay(&mut c, &quote("q_B", 600_000, "buyer.testnet"), "buyer.testnet", 600_000);
    ctx("shark.testnet", 3_010);
    c.award(2, acc("crab.testnet"), U128(180_000), "h".into(), "h".into());
}

#[test]
fn final_fails_and_lost_disputes_suspend_the_worker() {
    let mut c = setup();
    for (i, q) in ["q_A", "q_B", "q_C"].iter().enumerate() {
        failed_job(&mut c, (i + 1) as u64, q);
    }
    ctx("anyone.testnet", 5_001);
    c.settle_failed(1);
    c.settle_failed(2);
    assert!(!c.get_workers()[0].suspended);
    c.settle_failed(3);
    assert!(c.get_workers()[0].suspended);
}

// ---------- treasury, wind-down, re-auction, owed ledger ----------

const DAY: u64 = 86_400;

#[test]
#[should_panic(expected = "E_UNAUTHORIZED")]
fn only_the_shark_wallet_can_escrow() {
    let mut c = setup();
    pay(&mut c, &quote("q_A", 600_000, "buyer.testnet"), "buyer.testnet", 600_000);
    ctx("shark.testnet", 1_010);
    c.award(1, acc("crab.testnet"), U128(180_000), "h".into(), "h".into());
    ctx(usdc().as_str(), 1_011);
    let _ = c.ft_on_transfer(acc("shark.testnet"), U128(230_000), "escrow:1".into()); // the key account is not the wallet
}

#[test]
fn fund_shark_pays_the_daily_budget_above_the_floor_once_a_day() {
    let mut c = setup();
    seed_reserve(&mut c, 20_000_000); // floor is 3 x 4.00 + 2 x 0.05 = 12.10
    ctx("anyone.testnet", 10 * DAY);
    c.fund_shark();
    let s = c.get_stats();
    assert_eq!((s.reserve.0, s.accounted.0), (16_000_000, 16_000_000));
    // the next day it is capped by what is left above the floor
    ctx("anyone.testnet", 11 * DAY);
    c.fund_shark();
    assert_eq!(c.get_stats().reserve.0, 12_100_000 + 0); // 16.00 - min(4.00, 3.90) = 12.10
}

#[test]
#[should_panic(expected = "E_ONCE_PER_DAY")]
fn fund_shark_only_once_per_utc_day() {
    let mut c = setup();
    seed_reserve(&mut c, 30_000_000);
    ctx("anyone.testnet", 10 * DAY);
    c.fund_shark();
    ctx("anyone.testnet", 10 * DAY + 3_600);
    c.fund_shark();
}

#[test]
#[should_panic(expected = "E_RESERVE_FLOOR")]
fn fund_shark_never_goes_below_the_floor() {
    let mut c = setup();
    seed_reserve(&mut c, 12_100_000);
    ctx("anyone.testnet", 10 * DAY);
    c.fund_shark();
}

#[test]
fn open_jobs_are_counted_until_they_finish() {
    let mut c = setup();
    let id = delivered_job(&mut c);
    assert_eq!(c.get_stats().open_jobs, 1);
    review(&mut c, id, "primary", true, &["PASS"], 1_200);
    ctx("anyone.testnet", 1_200 + 86_401);
    c.finalize(id);
    assert_eq!(c.get_stats().open_jobs, 0);
}

#[test]
fn owners_are_paid_only_while_the_reserve_is_at_the_floor() {
    let mut c = setup();
    let id = delivered_job(&mut c);
    review(&mut c, id, "primary", true, &["PASS"], 1_200);
    ctx("anyone.testnet", 1_200 + 86_401);
    c.finalize(id);
    assert_eq!(c.get_stats().owner_accrued.0, 195_000);
    let before = c.get_stats().accounted.0;
    seed_reserve(&mut c, 12_100_000);
    ctx("anyone.testnet", 1_200 + 86_402);
    c.pay_owners();
    let s = c.get_stats();
    assert_eq!((s.owner_accrued.0, s.accounted.0), (0, before + 12_100_000 - 195_000));
}

#[test]
#[should_panic(expected = "E_RESERVE_FLOOR")]
fn owners_wait_while_the_reserve_is_below_the_floor() {
    let mut c = setup();
    let id = delivered_job(&mut c);
    review(&mut c, id, "primary", true, &["PASS"], 1_200);
    ctx("anyone.testnet", 1_200 + 86_401);
    c.finalize(id);
    c.pay_owners();
}

#[test]
fn wind_down_sends_everything_to_the_dao_and_closes() {
    let mut c = setup();
    seed_reserve(&mut c, 5_000_000);
    ctx("guardian.testnet", 2_000);
    c.pause();
    ctx("dao.testnet", 2_001);
    c.wind_down();
    let s = c.get_stats();
    assert_eq!((s.accounted.0, s.reserve.0), (0, 0));
    assert_eq!(c.get_service_state(), "closed");
    assert_eq!(pay(&mut c, &quote("q_A", 600_000, "buyer.testnet"), "buyer.testnet", 600_000), 600_000);
}

#[test]
#[should_panic(expected = "E_OPEN_JOBS")]
fn wind_down_waits_for_open_jobs() {
    let mut c = setup();
    pay(&mut c, &quote("q_A", 600_000, "buyer.testnet"), "buyer.testnet", 600_000);
    ctx("guardian.testnet", 2_000);
    c.pause();
    ctx("dao.testnet", 2_001);
    c.wind_down();
}

#[test]
#[should_panic(expected = "E_PAUSED")]
fn wind_down_needs_a_pause_first() {
    let mut c = setup();
    ctx("dao.testnet", 2_000);
    c.wind_down();
}

#[test]
#[should_panic(expected = "E_UNAUTHORIZED")]
fn only_the_dao_winds_down() {
    let mut c = setup();
    ctx("guardian.testnet", 2_000);
    c.pause();
    c.wind_down();
}

fn two_workers() -> Contract {
    let mut c = setup();
    ctx("dao.testnet", 1_000);
    c.register_worker(acc("raven.testnet"), vec![JobType::Summary], vec![U128(80_000)]);
    c
}

fn awarded_to(c: &mut Contract, worker: &str, at: u64) {
    ctx("shark.testnet", at);
    c.award(1, acc(worker), U128(180_000), "h".into(), "h".into());
    ctx(usdc().as_str(), at + 1);
    let _ = c.ft_on_transfer(acc("wallet.testnet"), U128(230_000), "escrow:1".into());
}

#[test]
fn a_late_worker_loses_the_job_to_one_re_auction_and_cannot_win_it_again() {
    let mut c = two_workers();
    pay(&mut c, &quote("q_A", 600_000, "buyer.testnet"), "buyer.testnet", 600_000);
    awarded_to(&mut c, "crab.testnet", 1_010); // deadline 1_610
    ctx("anyone.testnet", 1_610);
    let early = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.expire_work(1)));
    assert!(early.is_err(), "not late until after the deadline");
    ctx("anyone.testnet", 1_611);
    c.expire_work(1);
    let j = c.get_job(1).unwrap();
    assert_eq!((j.state, j.worker.is_none(), j.escrowed, j.reauctioned), (JobState::Paid, true, false, true));
    assert_eq!(j.excluded.unwrap().as_str(), "crab.testnet");
    assert_eq!(c.get_workers().iter().find(|w| w.id.as_str() == "crab.testnet").unwrap().late, 1);
    assert_eq!(c.get_stats().accounted.0, 600_000); // the escrow went back to Shark's wallet
    // the second worker takes it, is late too: this time the payer is refunded
    awarded_to(&mut c, "raven.testnet", 1_700);
    ctx("anyone.testnet", 2_301);
    c.expire_work(1);
    assert_eq!(c.get_job(1).unwrap().state, JobState::RefundDue);
}

#[test]
#[should_panic(expected = "E_NOT_ELIGIBLE")]
fn the_late_worker_cannot_be_awarded_again() {
    let mut c = two_workers();
    pay(&mut c, &quote("q_A", 600_000, "buyer.testnet"), "buyer.testnet", 600_000);
    awarded_to(&mut c, "crab.testnet", 1_010);
    ctx("anyone.testnet", 1_611);
    c.expire_work(1);
    ctx("shark.testnet", 1_700);
    c.award(1, acc("crab.testnet"), U128(180_000), "h".into(), "h".into());
}

#[test]
fn a_late_revision_is_refunded_not_re_auctioned() {
    let mut c = setup();
    let id = delivered_job(&mut c);
    review(&mut c, id, "primary", false, &["FAIL_LENGTH"], 1_200); // revision, deadline 1_800
    ctx("anyone.testnet", 1_801);
    c.expire_work(id);
    let j = c.get_job(id).unwrap();
    assert_eq!((j.state, j.reauctioned, j.escrowed), (JobState::RefundDue, false, false));
}

#[test]
fn a_failed_payout_goes_on_the_owed_ledger_and_can_be_retried() {
    let mut c = setup();
    let before = c.get_stats().accounted.0;
    ctx("sharkco.testnet", 2_000); // callbacks come from the contract itself
    c.on_payout(7, acc("crab.testnet"), U128(180_000), "worker".into(), Err(PromiseError::Failed));
    let s = c.get_stats();
    assert_eq!((s.accounted.0, s.owed_open), (before + 180_000, 1));
    let owed = c.get_owed(1, 10);
    assert_eq!((owed.len(), owed[0].job, owed[0].amount.0, owed[0].kind.as_str()), (1, 7, 180_000, "worker"));
    ctx("anyone.testnet", 2_001);
    c.retry_owed(1).detach();
    let s = c.get_stats();
    assert_eq!((s.accounted.0, s.owed_open), (before, 0));
    assert!(c.get_owed(1, 10).is_empty());
}

#[test]
#[should_panic(expected = "E_OPEN_JOBS")]
fn wind_down_waits_for_owed_payouts() {
    let mut c = setup();
    ctx("sharkco.testnet", 2_000);
    c.on_payout(7, acc("crab.testnet"), U128(180_000), "worker".into(), Err(PromiseError::Failed));
    ctx("guardian.testnet", 2_001);
    c.pause();
    ctx("dao.testnet", 2_002);
    c.wind_down();
}

#[test]
fn a_failed_refund_reopens_the_job() {
    let mut c = setup();
    pay(&mut c, &quote("q_A", 600_000, "buyer.testnet"), "buyer.testnet", 600_000);
    ctx("shark.testnet", 1_010);
    c.mark_refund_due(1);
    c.pay_refund(1).detach();
    assert_eq!((c.get_job(1).unwrap().state, c.get_stats().open_jobs), (JobState::Refunded, 0));
    ctx("sharkco.testnet", 2_000);
    c.on_payout(1, acc("buyer.testnet"), U128(600_000), "refund".into(), Err(PromiseError::Failed));
    assert_eq!((c.get_job(1).unwrap().state, c.get_stats().open_jobs), (JobState::RefundDue, 1));
}

// ---------- method 3: x402 ----------

fn settlement(tx: &str, payer: &str, amount: u128) -> Settlement {
    Settlement { tx_hash: tx.into(), payer: acc(payer), amount: U128(amount) }
}

/// Shark reports a settled x402 payment (the balance check is then in flight).
fn x402_mark(c: &mut Contract, q: &Quote, tx: &str) {
    ctx("shark.testnet", 1_050);
    c.mark_paid_x402(q.clone(), quote_sig(q, &key()), settlement(tx, q.payer.as_str(), q.price.0)).detach();
}

/// The callback with the contract's USDC balance as the token reported it.
fn x402_balance(c: &mut Contract, q: &Quote, tx: &str, balance: u128) {
    ctx("sharkco.testnet", 1_051);
    c.on_x402_balance(q.clone(), settlement(tx, q.payer.as_str(), q.price.0), Ok(U128(balance)));
}

#[test]
fn an_x402_payment_becomes_a_paid_job_once_the_balance_grew() {
    let mut c = setup();
    let q = quote("q_X", 600_000, "buyer.testnet");
    x402_mark(&mut c, &q, "tx1");
    x402_balance(&mut c, &q, "tx1", 600_000);
    let j = c.get_job_by_quote("q_X".into()).unwrap();
    assert_eq!((j.state, j.method.as_str(), j.price.0), (JobState::Paid, "x402", 600_000));
    let s = c.get_stats();
    assert_eq!((s.accounted.0, s.open_jobs), (600_000, 1));
}

#[test]
fn an_x402_payment_is_refused_when_the_balance_did_not_grow() {
    let mut c = setup();
    let q = quote("q_X", 600_000, "buyer.testnet");
    x402_mark(&mut c, &q, "tx1");
    x402_balance(&mut c, &q, "tx1", 599_999);
    assert!(c.get_job_by_quote("q_X".into()).is_none());
    assert_eq!(c.get_stats().accounted.0, 0);
    // nothing is stuck: the same quote can be reported again once the money is really there
    x402_mark(&mut c, &q, "tx2");
    x402_balance(&mut c, &q, "tx2", 600_000);
    assert!(c.get_job_by_quote("q_X".into()).is_some());
}

#[test]
fn the_balance_check_counts_money_the_contract_already_owes() {
    let mut c = setup();
    assert_eq!(pay(&mut c, &quote("q_A", 600_000, "buyer.testnet"), "buyer.testnet", 600_000), 0);
    let q = quote("q_X", 600_000, "buyer.testnet");
    x402_mark(&mut c, &q, "tx1");
    x402_balance(&mut c, &q, "tx1", 1_199_999);
    assert!(c.get_job_by_quote("q_X".into()).is_none());
    x402_mark(&mut c, &q, "tx2");
    x402_balance(&mut c, &q, "tx2", 1_200_000);
    assert!(c.get_job_by_quote("q_X".into()).is_some());
}

#[test]
fn a_pause_between_the_report_and_the_balance_creates_no_job() {
    let mut c = setup();
    let q = quote("q_X", 600_000, "buyer.testnet");
    x402_mark(&mut c, &q, "tx1");
    ctx("guardian.testnet", 1_050);
    c.pause();
    x402_balance(&mut c, &q, "tx1", 600_000);
    assert!(c.get_job_by_quote("q_X".into()).is_none());
}

#[test]
#[should_panic(expected = "E_QUOTE_USED")]
fn a_quote_cannot_be_paid_twice_by_x402() {
    let mut c = setup();
    let q = quote("q_X", 600_000, "buyer.testnet");
    x402_mark(&mut c, &q, "tx1");
    x402_balance(&mut c, &q, "tx1", 600_000);
    x402_mark(&mut c, &q, "tx2");
}

#[test]
#[should_panic(expected = "E_QUOTE_USED")]
fn a_quote_in_flight_cannot_be_reported_again() {
    let mut c = setup();
    let q = quote("q_X", 600_000, "buyer.testnet");
    x402_mark(&mut c, &q, "tx1");
    x402_mark(&mut c, &q, "tx2");
}

#[test]
#[should_panic(expected = "E_QUOTE_USED")]
fn a_settlement_tx_counts_once() {
    let mut c = setup();
    let q = quote("q_X", 600_000, "buyer.testnet");
    x402_mark(&mut c, &q, "tx1");
    x402_balance(&mut c, &q, "tx1", 600_000);
    x402_mark(&mut c, &quote("q_Y", 600_000, "buyer.testnet"), "tx1");
}

#[test]
#[should_panic(expected = "E_UNAUTHORIZED")]
fn only_shark_reports_x402() {
    let mut c = setup();
    let q = quote("q_X", 600_000, "buyer.testnet");
    ctx("stranger.testnet", 1_050);
    c.mark_paid_x402(q.clone(), quote_sig(&q, &key()), settlement("tx1", "buyer.testnet", 600_000)).detach();
}

#[test]
#[should_panic(expected = "E_WRONG_PAYER")]
fn x402_settlement_must_come_from_the_quote_payer() {
    let mut c = setup();
    let q = quote("q_X", 600_000, "buyer.testnet");
    ctx("shark.testnet", 1_050);
    c.mark_paid_x402(q.clone(), quote_sig(&q, &key()), settlement("tx1", "stranger.testnet", 600_000)).detach();
}

#[test]
#[should_panic(expected = "E_WRONG_AMOUNT")]
fn x402_settlement_must_be_the_price() {
    let mut c = setup();
    let q = quote("q_X", 600_000, "buyer.testnet");
    ctx("shark.testnet", 1_050);
    c.mark_paid_x402(q.clone(), quote_sig(&q, &key()), settlement("tx1", "buyer.testnet", 500_000)).detach();
}

#[test]
#[should_panic(expected = "E_BAD_QUOTE_SIG")]
fn x402_needs_a_real_quote_signature() {
    let mut c = setup();
    let q = quote("q_X", 600_000, "buyer.testnet");
    ctx("shark.testnet", 1_050);
    c.mark_paid_x402(q.clone(), quote_sig(&q, &SigningKey::from_bytes(&[9u8; 32])), settlement("tx1", "buyer.testnet", 600_000)).detach();
}

#[test]
#[should_panic(expected = "E_QUOTE_EXPIRED")]
fn x402_refuses_an_expired_quote() {
    let mut c = setup();
    let q = quote("q_X", 600_000, "buyer.testnet");
    ctx("shark.testnet", 2_001);
    c.mark_paid_x402(q.clone(), quote_sig(&q, &key()), settlement("tx1", "buyer.testnet", 600_000)).detach();
}

#[test]
fn an_unmatched_x402_payment_is_sent_back_once() {
    let mut c = setup();
    ctx("shark.testnet", 1_050);
    c.return_x402(settlement("tx9", "buyer.testnet", 600_000)).detach();
    ctx("sharkco.testnet", 1_051);
    c.on_x402_return(settlement("tx9", "buyer.testnet", 600_000), Ok(U128(600_000)));
    assert_eq!(c.get_stats().accounted.0, 0); // counted in, then paid straight back out
    let again = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        ctx("shark.testnet", 1_052);
        c.return_x402(settlement("tx9", "buyer.testnet", 600_000)).detach();
    }));
    assert!(again.is_err(), "the same settlement is returned once");
}

#[test]
fn an_x402_return_needs_the_balance_to_be_there() {
    let mut c = setup();
    ctx("shark.testnet", 1_050);
    c.return_x402(settlement("tx9", "buyer.testnet", 600_000)).detach();
    ctx("sharkco.testnet", 1_051);
    c.on_x402_return(settlement("tx9", "buyer.testnet", 600_000), Ok(U128(599_999)));
    assert_eq!(c.get_stats().accounted.0, 0);
    ctx("shark.testnet", 1_052);
    c.return_x402(settlement("tx9", "buyer.testnet", 600_000)).detach(); // not used up, so it can be tried again
}

#[test]
#[should_panic(expected = "E_UNAUTHORIZED")]
fn only_shark_returns_x402() {
    let mut c = setup();
    ctx("stranger.testnet", 1_050);
    c.return_x402(settlement("tx9", "buyer.testnet", 600_000)).detach();
}

#[test]
fn owners_paid_counts_only_transfers_that_succeeded_and_the_config_change_time_is_kept() {
    let mut c = setup();
    assert_eq!((c.get_stats().owners_paid.0, c.get_stats().config_changed_at), (0, None));
    ctx("dao.testnet", 3_000);
    c.set_config(config());
    assert_eq!(c.get_stats().config_changed_at, Some(3_000));
    ctx("sharkco.testnet", 3_001); // callbacks come from the contract itself
    c.on_payout(0, acc("dao.testnet"), U128(195_000), "owner".into(), Err(PromiseError::Failed));
    assert_eq!(c.get_stats().owners_paid.0, 0); // a failed payout is owed, not paid
    c.on_payout(0, acc("dao.testnet"), U128(195_000), "owner".into(), Ok(()));
    c.on_payout(0, acc("dao.testnet"), U128(1_000), "wind_down".into(), Ok(()));
    c.on_payout(1, acc("crab.testnet"), U128(180_000), "worker".into(), Ok(()));
    assert_eq!(c.get_stats().owners_paid.0, 195_000); // the wind-down sweep and worker pay don't count
}
