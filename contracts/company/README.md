# Company contract

Holds every customer payment, runs the job state machine and pays workers, Owl, referrers and the owners (API-CONTRACT §3, SRD §8).

This first slice covers method 1 payments (signed quote + `ft_transfer_call`), award and escrow, deliveries, reviews posted by Owl's account, one revision, refunds, complaints, strikes and the cage, and `finalize` with the revenue split. Disputes, Unresolved, x402, Intents, Chain Signatures and the DAO come next.

```bash
cargo test
```

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
