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
    let mut c = Contract::new(acc("dao.testnet"), acc("guardian.testnet"), acc("shark.testnet"), pk, usdc(), NET.into(), config());
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

/// What Shark sends in `msg` (API §1.2).
fn pay_msg(q: &Quote, k: &SigningKey) -> String {
    let canonical = serde_json::to_string(q).unwrap();
    let digest = env::sha256_array(format!("{QUOTE_DOMAIN}{canonical}").as_bytes());
    let sig = format!("ed25519:{}", near_sdk::bs58::encode(k.sign(&digest).to_bytes()).into_string());
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
    let _ = c.ft_on_transfer(acc("shark.testnet"), U128(230_000), "escrow:1".into());
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
    let _ = c.ft_on_transfer(acc("shark.testnet"), U128(180_000), "escrow:1".into());
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
        let _ = c.ft_on_transfer(acc("shark.testnet"), U128(230_000), format!("escrow:{id}"));
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
    assert_eq!((r.owner.as_str(), r.guardian.as_str(), r.shark.as_str(), r.network.as_str()), ("dao.testnet", "guardian.testnet", "shark.testnet", NET));
}

// ---------- disputes and Unresolved (FR-44 to FR-47) ----------

/// Pay, award, escrow, deliver and fail twice. The job ends Failed at 1_400 with the dispute window open until 5_000.
fn failed_job(c: &mut Contract, id: u64, qid: &str) {
    assert_eq!(pay(c, &quote(qid, 600_000, "buyer.testnet"), "buyer.testnet", 600_000), 0);
    ctx("shark.testnet", 1_010);
    c.award(id, acc("crab.testnet"), U128(180_000), "h".into(), "h".into());
    ctx(usdc().as_str(), 1_011);
    let _ = c.ft_on_transfer(acc("shark.testnet"), U128(230_000), format!("escrow:{id}"));
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
