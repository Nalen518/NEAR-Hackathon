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
