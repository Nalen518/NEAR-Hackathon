# Shark & Co. — Open items (v2.0)

**Status:** Open · Answered (confirm by test) · Closed.

| ID | Question | Blocks | How to close | Due | Status |
| --- | --- | --- | --- | --- | --- |
| O-02 | MPP NEAR Intents SDK ready, or direct 1Click? | 7 Nov | Read mpp.dev; default direct 1Click | 31 Oct | Open |
| O-03 | OutLayer `request_execution` schema + testnet/mainnet IDs | Owl reviews (4 Nov) | NEAR integration guide + spike | 31 Oct | Open |
| O-04 | 1Click delivery with an `ft_transfer_call` message (method 2 fully on-chain) | Improvement | Docs / Discord | 2 Nov | Open |
| O-05 | Base USDC → NEAR USDC at ~0.50–1.00: route minimum OK? | Mainnet-lite | `dry` quote | 31 Oct | Open |
| O-06 | NEAR AI models: pick Shark, Raven, Crab, Owl-primary, Owl-secondary models (quality, price, TEE badge) | Workers, reviews | `/v1/models` + golden-order tests | 31 Oct | Open |
| O-07 | Base Sepolia + Base RPC | 6 Nov | Pick a free provider | 31 Oct | Open |
| O-08 | Can the OutLayer policy pin the FT receiver? | Security story | Test the policy | 31 Oct | Open |
| O-09 | Trezu: testnet DAO + function-call proposals to our contract | All owner actions | Testnet DAO → proposal | 31 Oct (overdue) | Open |
| O-10 | Real costs → worker `min_fee`s and review fee (NEAR AI tokens per job, OutLayer execution cost) | Bands, floors | Measure on testnet 4–6 Nov | 6 Nov | Open |
| O-13 | Owl WASM: HTTP (docs say yes on WASI P2, 60 s, ≤ 900 bytes) **and calling NEAR AI with a secret key from inside the TEE** | Owl reviews | Phase 0 spike | 31 Oct | Answered (HTTP) — confirm model call |
| O-17 | Public NEAR testnet USDC vs our mock | 7 Nov | Look; default our mock + faucet | 31 Oct | Open |
| O-18 | Gas for client calls (`pay` 100 Tgas, `faucet_mint`/`storage_deposit` 30 Tgas) | Web, bot | Measure on testnet | 7 Nov | Open |
| O-20 | Text extraction: HTML readability + PDF library (pinned), handling of blocked sites | Snapshots | Spike on 5 sample URLs + 3 PDFs | 1 Nov | Open |
| O-21 | X weighted length rules (URLs 23, emoji/CJK 2) | Thread checks | Check X docs / twitter-text library | 3 Nov | Open |
| O-22 | Worker quality: golden orders per type pass review ≥ 90% first try | Demo credibility | Phase 0 prompt tests | 1 Nov | Open |
| O-23 | Review output ≤ 900 bytes enough (codes + hash)? | Owl | Spike | 31 Oct | Open |
| O-24 | Native USDC contract ID on NEAR mainnet + USDC addresses on Base / Base Sepolia | Mainnet-lite, Raven payouts | Official Circle / NEAR docs | 2 Nov | Open |

## Closed
| ID | Answer |
| --- | --- |
| O-19 | Pre-November code allowed in separate files, no disclosure (organisers, Discord, 25 Oct) → D-163 |
| v1 items (O-01, O-11, O-12, O-14, O-15, O-16) | Retired with the influencer-call product |
