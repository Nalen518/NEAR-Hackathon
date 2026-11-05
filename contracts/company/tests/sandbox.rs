//! The real wasm of the company contract and the test USDC on a local NEAR node (near-sandbox). The unit tests in
//! src/tests.rs mock the VM; these check what a mock can't: cross-contract calls, callbacks, gas, storage and that
//! the contract's own books match the token's balance after every path.
//! Linux only (near-sandbox has no Windows build): run `contracts/run-sandbox.sh`, which builds nothing itself and
//! expects `cargo near build` to have made both wasm files.
#![cfg(target_os = "linux")]

use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use company::{JobType, Quote};
use ed25519_dalek::{Signer as _, SigningKey};
use near_api::{Contract, Data, NearGas, NearToken, NetworkConfig, Signer};
use near_sandbox::config::DEFAULT_GENESIS_ACCOUNT_PRIVATE_KEY;
use near_sandbox::{GenesisAccount, Sandbox, SandboxConfig};
use near_sdk::json_types::U128;
use near_sdk::serde::de::DeserializeOwned;
use near_sdk::serde_json::{self, Value, json};
use near_sdk::{CurveType, PublicKey};
use testresult::TestResult;

const ACCOUNTS: [&str; 10] = ["usdc", "company", "dao", "guardian", "shark", "wallet", "buyer", "crab", "owl", "referrer"];
const PRICE: u128 = 600_000;
const SEED: u128 = 20_000_000;

struct Net {
    _sandbox: Sandbox,
    net: NetworkConfig,
    signer: Arc<Signer>,
}

fn quote_key() -> SigningKey {
    SigningKey::from_bytes(&[7u8; 32])
}

fn wasm(env: &str, default: &str) -> TestResult<Vec<u8>> {
    let path = std::env::var(env).unwrap_or_else(|_| format!("{}/{default}", env!("CARGO_MANIFEST_DIR")));
    Ok(std::fs::read(&path).map_err(|e| format!("{path}: {e} (run cargo near build first)"))?)
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs()
}

impl Net {
    async fn call(&self, who: &str, contract: &str, method: &str, args: Value, deposit: NearToken) -> TestResult<()> {
        Contract(contract.parse()?)
            .call_function(method, args)
            .transaction()
            .gas(NearGas::from_tgas(100))
            .deposit(deposit)
            .with_signer(who.parse()?, self.signer.clone())
            .send_to(&self.net)
            .await?
            .assert_success();
        Ok(())
    }

    async fn view<T: DeserializeOwned + Send + Sync>(&self, contract: &str, method: &str, args: Value) -> TestResult<T> {
        let d: Data<T> = Contract(contract.parse()?).call_function(method, args).read_only().fetch_from(&self.net).await?;
        Ok(d.data)
    }

    async fn balance(&self, who: &str) -> TestResult<u128> {
        let s: String = self.view("usdc", "ft_balance_of", json!({ "account_id": who })).await?;
        Ok(s.parse()?)
    }

    /// `ft_transfer_call` of `amount` from `from` to the company with `msg` (1 yocto, as the token requires).
    async fn send(&self, from: &str, amount: u128, msg: &str) -> TestResult<()> {
        self.call(from, "usdc", "ft_transfer_call", json!({ "receiver_id": "company", "amount": amount.to_string(), "msg": msg }), NearToken::from_yoctonear(1)).await
    }

    /// A plain `ft_transfer` into the contract, like an x402 facilitator's settlement.
    async fn transfer(&self, from: &str, amount: u128) -> TestResult<()> {
        self.call(from, "usdc", "ft_transfer", json!({ "receiver_id": "company", "amount": amount.to_string() }), NearToken::from_yoctonear(1)).await
    }

    async fn job(&self, id: u64) -> TestResult<Value> {
        self.view("company", "get_job", json!({ "job": id })).await
    }

    async fn job_by_quote(&self, quote: &str) -> TestResult<Value> {
        self.view("company", "get_job_by_quote", json!({ "quote_id": quote })).await
    }

    async fn stats(&self) -> TestResult<Value> {
        self.view("company", "get_stats", json!({})).await
    }

    /// The contract's books must equal what the token says it holds, after every path.
    async fn assert_books(&self) -> TestResult<()> {
        let accounted: u128 = self.stats().await?["accounted"].as_str().unwrap().parse()?;
        assert_eq!(accounted, self.balance("company").await?, "accounted vs the token's balance of the contract");
        Ok(())
    }
}

fn config() -> Value {
    let band = |a: &str, b: &str| json!({ "band_min": a, "band_max": b });
    json!({
        "extract": band("300000", "1500000"), "summary": band("200000", "1000000"), "thread": band("500000", "2000000"),
        "worker_cap_bps": 5000, "review_fee": "50000", "referral_bps": 750, "owner_bps": 6000, "daily_budget": "1000000",
        "strike_threshold": 3, "suspend_threshold": 3, "max_unresolved_open": 2,
        "work_deadline_secs": 600, "review_deadline_secs": 600, "dispute_window_secs": 2, "unresolved_timeout_secs": 604800,
        "complaint_window_secs": 2, "job_timeout_secs": 21600,
    })
}

async fn setup() -> TestResult<Net> {
    let sandbox = Sandbox::start_sandbox_with_config(SandboxConfig {
        additional_accounts: ACCOUNTS.iter().map(|n| GenesisAccount::default_with_name(n.parse().unwrap())).collect(),
        ..Default::default()
    })
    .await?;
    let net = NetworkConfig::from_rpc_url("sandbox", sandbox.rpc_addr.parse()?);
    let signer = Signer::from_secret_key(DEFAULT_GENESIS_ACCOUNT_PRIVATE_KEY.parse()?)?;
    let n = Net { _sandbox: sandbox, net, signer };

    Contract::deploy("usdc".parse()?).use_code(wasm("USDC_WASM", "../test-usdc/target/near/test_usdc.wasm")?).with_init_call("new", json!({}))?.with_signer(n.signer.clone()).send_to(&n.net).await?.assert_success();
    let pk = serde_json::to_value(PublicKey::from_parts(CurveType::ED25519, quote_key().verifying_key().to_bytes().to_vec())?)?;
    Contract::deploy("company".parse()?)
        .use_code(wasm("COMPANY_WASM", "target/near/company.wasm")?)
        .with_init_call(
            "new",
            json!({ "owner": "dao", "guardian": "guardian", "shark": "shark", "shark_wallet": "wallet", "quote_pubkey": pk, "usdc": "usdc", "network": "near:testnet", "config": config() }),
        )?
        .with_signer(n.signer.clone())
        .send_to(&n.net)
        .await?
        .assert_success();

    let none = NearToken::from_yoctonear(0);
    n.call("dao", "company", "register_worker", json!({ "id": "crab", "types": ["extract", "summary", "thread"], "min_fees": ["100000", "60000", "120000"] }), none).await?;
    n.call("dao", "company", "register_reviewer", json!({ "id": "owl" }), none).await?;
    // balances and registrations: minting (by the token's own account) registers the receiver on the token
    for (who, amount) in [("buyer", 5_000_000u128), ("wallet", 5_000_000), ("dao", SEED), ("company", 0), ("crab", 0), ("owl", 0), ("referrer", 0)] {
        n.call("usdc", "usdc", "mint", json!({ "account_id": who, "amount": amount.to_string() }), none).await?;
    }
    n.send("dao", SEED, "reserve").await?;
    n.assert_books().await?;
    Ok(n)
}

/// A quote for `price` signed the way Shark signs it, and the `pay:` message that carries it.
fn signed(id: &str, price: u128) -> (Quote, String, String) {
    let q = Quote {
        brief_hash: "sha256:b".into(),
        expires_at: now() + 600,
        input_hash: "sha256:i".into(),
        job_type: JobType::Summary,
        network: "near:testnet".into(),
        payer: "buyer".parse().unwrap(),
        price: U128(price),
        quote_id: id.into(),
        referrer: Some("referrer".parse().unwrap()),
    };
    let digest = near_sdk::env::sha256_array(format!("sharkco:quote:v2|{}", serde_json::to_string(&q).unwrap()).as_bytes());
    let sig = format!("ed25519:{}", near_sdk::bs58::encode(quote_key().sign(&digest).to_bytes()).into_string());
    let body = json!({ "quote": q, "sig": sig }).to_string();
    let msg = format!("pay:{}", near_sdk::base64::Engine::encode(&near_sdk::base64::engine::general_purpose::STANDARD, body));
    (q, sig, msg)
}

async fn award_and_deliver(n: &Net, job: u64) -> TestResult<()> {
    let none = NearToken::from_yoctonear(0);
    n.call("shark", "company", "award", json!({ "job": job, "worker": "crab", "fee": "180000", "bid_hash": "sha256:h", "reason_hash": "sha256:h" }), none).await?;
    n.send("wallet", 230_000, &format!("escrow:{job}")).await?;
    n.call("crab", "company", "deliver", json!({ "job": job, "delivery_hash": "sha256:d" }), none).await
}

fn review(pass: bool, codes: &[&str]) -> Value {
    json!({ "mode": "primary", "pass": pass, "codes": codes, "reasons_hash": "sha256:r" })
}

#[tokio::test(flavor = "multi_thread")]
async fn a_paid_job_is_delivered_finalized_and_everyone_is_paid() -> TestResult<()> {
    let n = setup().await?;
    let none = NearToken::from_yoctonear(0);
    let (_, _, msg) = signed("q_A", PRICE);
    n.send("buyer", PRICE, &msg).await?;
    assert_eq!(n.job_by_quote("q_A").await?["state"], "paid");
    assert_eq!(n.balance("buyer").await?, 5_000_000 - PRICE);

    award_and_deliver(&n, 1).await?;
    n.call("owl", "company", "on_review", json!({ "job": 1, "result": review(true, &["PASS"]) }), none).await?;
    assert_eq!((n.balance("crab").await?, n.balance("owl").await?), (180_000, 50_000));
    assert_eq!(n.job(1).await?["state"], "delivered");

    tokio::time::sleep(Duration::from_secs(4)).await; // the 2 s complaint window
    n.call("wallet", "company", "finalize", json!({ "job": 1 }), none).await?;
    assert_eq!(n.balance("referrer").await?, 45_000);
    assert_eq!(n.stats().await?["owner_accrued"], "195000");

    n.call("wallet", "company", "pay_owners", json!({}), none).await?;
    assert_eq!(n.balance("dao").await?, 195_000);
    assert_eq!(n.stats().await?["owners_paid"], "195000"); // counted when the transfer succeeded
    n.call("wallet", "company", "fund_shark", json!({}), none).await?; // daily budget 1.00, reserve is far above its floor
    assert_eq!(n.balance("wallet").await?, 5_000_000 - 230_000 + 1_000_000);
    n.assert_books().await
}

#[tokio::test(flavor = "multi_thread")]
async fn a_job_that_fails_twice_is_refunded_and_the_worker_is_not_paid() -> TestResult<()> {
    let n = setup().await?;
    let none = NearToken::from_yoctonear(0);
    let (_, _, msg) = signed("q_B", PRICE);
    n.send("buyer", PRICE, &msg).await?;
    award_and_deliver(&n, 1).await?;
    n.call("owl", "company", "on_review", json!({ "job": 1, "result": review(false, &["FAIL_LENGTH"]) }), none).await?;
    assert_eq!(n.job(1).await?["state"], "revision");
    n.call("crab", "company", "deliver", json!({ "job": 1, "delivery_hash": "sha256:d2" }), none).await?;
    n.call("owl", "company", "on_review", json!({ "job": 1, "result": review(false, &["FAIL_LENGTH"]) }), none).await?;
    assert_eq!(n.job(1).await?["state"], "failed");
    assert_eq!(n.balance("owl").await?, 50_000); // Owl is paid for the review, the worker is not

    tokio::time::sleep(Duration::from_secs(4)).await; // the 2 s dispute window
    n.call("wallet", "company", "settle_failed", json!({ "job": 1 }), none).await?;
    n.call("wallet", "company", "pay_refund", json!({ "job": 1 }), none).await?; // registers the payer first, then transfers
    assert_eq!(n.balance("buyer").await?, 5_000_000);
    assert_eq!((n.job(1).await?["state"].clone(), n.balance("crab").await?), (json!("refunded"), 0));
    n.assert_books().await
}

#[tokio::test(flavor = "multi_thread")]
async fn x402_reports_are_checked_against_the_real_balance() -> TestResult<()> {
    let n = setup().await?;
    let none = NearToken::from_yoctonear(0);
    // a settled payment: the facilitator's relayer moved the USDC, then Shark reports it
    let (q, sig, _) = signed("q_X", PRICE);
    n.transfer("buyer", PRICE).await?;
    n.call("shark", "company", "mark_paid_x402", json!({ "quote": q, "sig": sig, "settlement": { "tx_hash": "txA", "payer": "buyer", "amount": PRICE.to_string() } }), none).await?;
    let job = n.job_by_quote("q_X").await?;
    assert_eq!((job["state"].clone(), job["method"].clone()), (json!("paid"), json!("x402")));
    n.assert_books().await?;

    // a report with no money behind it creates nothing
    let (q2, sig2, _) = signed("q_Y", PRICE);
    n.call("shark", "company", "mark_paid_x402", json!({ "quote": q2, "sig": sig2, "settlement": { "tx_hash": "txFake", "payer": "buyer", "amount": PRICE.to_string() } }), none).await?;
    assert!(n.job_by_quote("q_Y").await?.is_null());
    n.assert_books().await?;

    // money that landed but matches no job goes back, once
    n.transfer("buyer", 300_000).await?;
    let before = n.balance("buyer").await?;
    n.call("shark", "company", "return_x402", json!({ "settlement": { "tx_hash": "txStray", "payer": "buyer", "amount": "300000" } }), none).await?;
    assert_eq!(n.balance("buyer").await?, before + 300_000);
    n.assert_books().await
}
