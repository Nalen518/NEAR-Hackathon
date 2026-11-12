# Company contract

Holds every customer payment, runs the job state machine and pays workers, Owl, referrers and the owners (API-CONTRACT §3, SRD §8).

It covers payments by signed quote (`ft_transfer_call`) and by x402 (`mark_paid_x402`), award and escrow, deliveries, reviews posted by Owl's account, one revision, disputes decided by a second model, Unresolved jobs, refunds, complaints, strikes and the cage, `finalize` with the revenue split, owner rules set by the DAO (`set_config`, `set_owner`) and `wind_down`. Not built yet: payouts through Chain Signatures and payments through NEAR Intents.

The 76 unit tests (`src/tests.rs`, a mocked VM, no network):

```bash
cargo test --lib
```

Use `--lib`: plain `cargo test` on Linux also runs the sandbox tests below, which need the wasm files built first and Docker.

```bash
cargo near build non-reproducible-wasm --no-abi
```

On Windows, add NASM to `PATH` first (a test dependency needs it). `--no-abi` is needed because cargo-near's ABI step can't link on Windows.

The contract itself needs a little NEAR (about 0.01) because `pay_refund` pays the 0.00125 NEAR USDC storage deposit for a payer who is no longer registered. Shark funds it at deploy.

## Sandbox tests

`tests/sandbox.rs` runs the real wasm and the mock USDC (`../test-usdc`) on a local NEAR node: a full paid job to finalize with every payout, a job that fails twice and is refunded, and the x402 balance checks. After each path the contract's books must equal the token's balance. near-sandbox has no Windows build, so it runs in Docker on Linux:

```bash
(cd ../test-usdc && cargo near build non-reproducible-wasm --no-abi) && cargo near build non-reproducible-wasm --no-abi
```

```bash
bash ../run-sandbox.sh
```

The first run compiles for several minutes and downloads the node; later runs take about a minute.
