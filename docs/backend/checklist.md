# Backend checklist

The one place to see where the backend stands. Updated right after every finished task.
Items come from `docs/web/BACKEND-TODO.md` (A Must, B Should, C Could) and the SRD. Shapes follow API-CONTRACT v2.3 (D-172).

**Status:** ✅ done and tested · 🟡 partly done · ⬜ not started · 🔒 needs a wallet signature (owner's yes each time) · 🧠 needs the NEAR AI key

**How "done" is checked:** every response is parsed with the web's schemas from `packages/shared` in `services/shark/test/contract.test.ts`, against a fake chain. Nothing has run on testnet yet.

Last updated: 4 Nov 2026 (after the review fixes)

## Resume here (next session)
Every item in the "no wallet or AI needed" list is done. What is left needs your yes for signing, or the NEAR AI key: see "Later" below. Tests at the last commit: Shark 107, facilitator 11, agents 22, checks 33 (TypeScript) and the same 20 shared fixtures in Rust, shared 25, web 47, contract 68 unit tests plus 3 sandbox tests on the real wasm. Nothing is deployed. `development` is pushed to GitHub.

## A. Must (the web goes live on these)

| Item | Status | Where | Notes |
| --- | --- | --- | --- |
| A1 Serve `/v1/*` with `near:testnet` | ✅ | `b37e5fb` | Prices, Company, Health, PaymentOptions, QuoteStatus all parse |
| A2 `POST /v1/orders` 402 with a signed quote | ✅ | `5a8ac61` | Canonical quote bytes pinned in the Rust and TS tests. Also carries the x402 v2 `PAYMENT-REQUIRED` header |
| A3 `GET /v1/quotes/{id}` | ✅ | `e224e9d` | AWAITING_PAYMENT, PAID, EXPIRED, RETURNED (from the payment receipt, after 90 s with no job) and the payment tx |
| A4 `POST /v1/uploads` | ✅ | `f523c10` | PDF, HTML, TXT, MD. 413 and 422 |
| A5 Errors per §0.1 | ✅ | `f523c10` | `charged`, `details.field`, `Retry-After` on 429, 502 and 503 |
| A6 Public view | ✅ | `f523c10` | Leaks no instructions, source, params or delivery |
| A7 Payer view (NEP-413) | ✅ | `f523c10` | Recipient, 5 min age, one-time nonce, full-access key, 401 and 403 |
| A8 Signed complaints | ✅ | `f523c10` | 202, 401, 403, 409, 429 (3 a day) |
| A9 `delivery` null until a pass | ✅ | `f523c10` | Also for refund_due and refunded, even for the payer |
| A10 CORS | ✅ | `9ae484d` | Ports 3100 and 3000, exposes Retry-After and WWW-Authenticate |
| A11 Payment options | ✅ | `9ae484d` | Faucet URL plus the x402 option |
| A12 Testnet values for the web's `.env.local` | ⬜ 🔒 | | After the testnet deploy |

## B. Should

| Item | Status | Where | Notes |
| --- | --- | --- | --- |
| B1 Timeline events with tx links | ✅ | `e224e9d` | Every step links its tx; adds worker_paid, reviewer_paid, refunded, finalized, complaint. Built from the indexer's receipts: untested against real testnet data |
| B2 Per-check review results | ✅ | `cb15147` | Code checks with detail, model checks pass only, Owl's reasons |
| B3 Exact rule strings | ✅ | `f523c10` | The web's list in `apps/web/lib/checklist.ts` is now the real one |
| B4 Company core (P6) | ✅ | `e224e9d` and the next commit | Live: strikes, reserve, P&L (owners paid is the last 7 days, from a new contract counter), workers, reviewer, ledger (with worker payout txs), config (with the change time and tx), payouts (from the reader, owners' payouts not listed), Raven's Base gas (needs `TESTNET_PAYOUT_EVM_ADDRESS`, the address that pays the gas; the RPC defaults to `https://sepolia.base.org`; a placeholder until the address is set). Sample by decision: DAO proposals (no DAO yet) |
| B5 `money` on orders | ✅ | `f523c10` | Same split as the contract's `finalize` |
| B6 `404 order_not_found` | ✅ | `ca2bf11` | Schema fixed too |

## C. Could

| Item | Status | Where | Notes |
| --- | --- | --- | --- |
| C1 Recent quotes with status | ✅ | `e224e9d` | Last 20 quotes: paid, returned (with the payment tx) or expired. `returnReason` is always null: the indexer gives no return value |
| C2 Auctions and incidents logs | ✅ | `fd56a27` and the next commit | Auctions log. Incidents from the reader's receipts, backfilled from job state: complaints, impossible briefs, disputes, late work and re-auctions, strikes and the cage (a reset restarts the count), a suspended worker, failed payouts (owed ledger) and refunds stuck over 10 minutes. New shared kinds `strike`, `late`, `worker_suspended`, `payout_failed` |
| C3 `details.fixes[]` on brief_infeasible | ✅ | `fd56a27` | `{label, params, price}`. The web now shows these with their prices (its own suggestions stay only as a fallback for an older Shark) |

## Review fixes (ponytail review, 4 Nov 2026)
- A paid job whose award or refund call failed once is now asked again every tick, and refunded after `job_timeout_secs` if it still cannot be awarded (it used to wait for a manual call).
- The daily keepers (`fund_shark`, `pay_owners`) are tried again after a network error, and the day is marked done only when the contract answered.
- Rate limit: counts the last `x-forwarded-for` value and drops old minutes (it used to grow without limit and the first value could be faked).
- Raven gas read has a 4 s timeout and logs its errors.
- `/v1/company`, `/v1/prices` and `/v1/health` are kept for `CACHE_SECS` (10), and concurrent calls share one read.
- A suspended worker with no `suspend` call keeps the time Shark first saw it.
- Payer view: the same signature may be sent again for the same account and order until it is 5 minutes old (owner decision). A complaint signature still works once. `API-CONTRACT.md` line 253 says so. See `DECISIONS.md` D-173.
- Runbook: a changed contract needs a fresh account, the web API URL is the origin only, and the proxy must add the client address.
- Raven gas gauge: `TESTNET_PAYOUT_EVM_ADDRESS` (renamed from `RAVEN_EVM_ADDRESS`, which the API contract uses for Raven's receive address) is the address Chain Signatures gives the contract for the path `base-payouts`. `services/shark/scripts/derive-address.mjs` works it out and checks it against the MPC contract's own `derived_public_key` (for `sharkco.testnet`: `0x3A3Fa9e6Df65F800ea24a99ad9191fa18b611440`, not funded yet). The Base Sepolia RPC defaults to `https://sepolia.base.org`.
- Old nonces (over a day) are dropped when Shark starts, and the "first seen" notes for paid refunds, retried payouts and reinstated workers are forgotten. An escrow that has not shown up on chain after 2 minutes is sent again (the contract refuses a second one for an escrowed job). `wind_down` has its own wording in the incident text.
- `DECISIONS.md` D-173 records the payer view signature reuse and the API URL being an origin.

## Security audit fixes (ponytail audit, 5 Nov 2026)
- A hash can no longer be a path: `blob()` and `putBlob()` take only letters and digits (a worker chooses the delivery and reasons hashes, and a registered agent can read `/v1/files/<hash>`; before this `sha256:../../.env` read Shark's env file).
- Customer links: only global IPv6 (2000::/3, not 6to4 or Teredo), more IPv4 ranges refused (multicast and above, 198.18/15, 192.0.0/24), and only ports 80 and 443. The `[::ffff:7f00:1]` form used to get through.
- Request bodies over 3 MB are refused with 413 before they are read.
- Crab and Raven answer only calls that carry `SHARK_AGENT_TOKEN` (`X-Shark-Token`). `make-key.mjs NAME --token` makes it. Shark refuses to start with worker URLs and no token.
- Still open from the audit (Should and Nice): hash strings are not validated in the contract (`deliver` and friends, free to change before the first deploy), the PDF page count is read after extraction, and the `elliptic` low vulnerability through `@x402/near`.

## Schema bugs found and fixed
- `X402PaymentRequired` had the x402 v1 shape. Now v2 (`resource` at the top, `accepts[]` are PaymentRequirements), with a new fixture; Shark's tests parse the header it really sends.
- New shared `InfeasibleDetails` and `InfeasibleFix` schemas for `brief_infeasible`; Shark's tests parse what it really sends.
- `OrderRequest.params` stripped thread params. Fixed with strict params schemas (`ca2bf11`).
- `ERROR_CODES` had no `order_not_found`. Added (`ca2bf11`).

## Next: no wallet or AI needed (in this order)

| # | Task | Status |
| --- | --- | --- |
| 1 | C1 recent quotes, C3 fixes with prices, C2 auctions log, `out_of_budget` state | ✅ `fd56a27` |
| 2 | Contract: disputes and Unresolved (FR-44 to FR-47), Shark loop and timeline for them, worker dispute decision, Owl second review | ✅ `110076b` |
| 3 | Contract: `pay_owners`, `fund_shark`, `wind_down`, late worker re-auction, storage deposit in `pay_refund`, an owed ledger for failed payouts; Shark keepers for all of them | ✅ `c4b6b93` |
| 4 | x402: the `PAYMENT-REQUIRED` header, `PAYMENT-SIGNATURE` flow with a facilitator client, contract `mark_paid_x402` and `return_x402` (balance checked in a callback) | ✅ `5a8ac61` |
| 4b | Our own x402 facilitator service on `@x402/near` (`/verify`, `/settle`, `/supported`); closed without Shark's API key and limited to our USDC and contract | ✅ `e90fa9f` |
| 5 | Event reader for B1 tx links, the payouts list and RETURNED quotes | ✅ `e224e9d` |
| 6 | `GET /v1/openapi.json` (FR-14) | ✅ `99cb32a` OpenAPI 3.1 from the shared schemas; a test checks it lists exactly the served routes |
| 7 | Sandbox tests of the real wasm (full job path), with a test USDC contract | ✅ `fe5070b` (run by `contracts/run-sandbox.sh` in Docker) |
| 8 | Rust port of the code checks, for Owl in the OutLayer TEE (NFR-02) | ✅ `a87a732` (`owl/checks`, 20 shared fixtures in `fixtures/checks`) |

## Later: needs a wallet 🔒 or NEAR AI 🧠
- 🔒 Testnet deploy: **runbook ready in `docs/backend/DEPLOY-TESTNET.md`** (helper scripts: `contracts/deploy/plan.mjs`, `services/shark/scripts/make-key.mjs` and `order.mjs`; none of them signs). Contract init (`new` now takes the Shark wallet account), fund the contract with a little NEAR, register workers and Owl, USDC storage registrations, reserve seed, agent keys, then A12.
- 🔒 Run our facilitator (`services/facilitator`): create and fund the relayer account (`x402-relayer.sharkco.testnet`), set `X402_RELAYER_KEY` and `X402_API_KEY`, point Shark's `TESTNET_X402_FACILITATOR_URL` at it. Or use FastNEAR's (needs an API key, requested by a GitHub issue, reviewed by hand).
- x402 with FastNEAR's hosted facilitator instead of ours: confirm its `/openapi.yaml` uses the same keys as `@x402/core` (`x402Version`, `paymentPayload`, `paymentRequirements`). Ours is checked against the library's types.
- 🧠 Running Crab, Raven and Owl for real (built and tested with a fake model in `a37ad08`). Pick models (O-06).
- 🧠 The safety filter on NEAR AI (a pattern list for now).
- 🔒🧠 Owl in the OutLayer TEE with attestation (O-03, O-13): `owl/review-wasm` (wasm32-wasip2) on top of `owl/checks`, which is ready. Raven paid on Base via Chain Signatures (FR-60). The owners' DAO (O-09). The OutLayer custody wallet for Shark (D-144).
- Hosting (Railway or Fly) and the deployed web origin for CORS.

## Shortcuts in the code (each marked `shortcut:` where it lives)
- Escrow comes from a plain testnet wallet account, not the OutLayer custody wallet.
- Reviews are posted by Owl's own account, not an OutLayer callback, so there is no attestation.
- The safety filter is a pattern list.
- The daily keepers and the hourly owed retries run from Shark's own wallet account, which pays the gas.
- The contract needs about 0.01 NEAR of its own for the refund storage deposit; the deploy has to fund it.
- The second review fee is capped at what the reserve holds.
- Suspension counts final fails plus lost disputes over a worker's whole record, not the last 20 jobs.
- A worker disputes only when its own delivery passes every code check.
- The sandbox tests cover the paid job, the double fail with refund, and x402. Disputes, Unresolved, re-auction and wind-down are covered by unit tests only.
- The rate limit is kept in memory on one host.
- Owners paid (7 days) is today's counter minus a daily snapshot kept in Shark's own store, so it is only exact once Shark has run for a week (before that it shows everything paid). The time a failed payout or a stuck refund "happened" is when Shark first saw it. A suspended worker's time is the owners' `suspend` call, else its last review.
- Raven's gas gauge assumes 65,000 gas per payout. `wind_down` pays the DAO as kind `wind_down` so the owners counter ignores it.
- The event reader uses a public indexer (NearBlocks, no key) that lists calls but not logs, so payouts are derived from the call that triggers them and the owners' payouts have no amount. It asks once a minute and is untested against real data until the contract is deployed. The exact `cursor` paging was seen live; pages are walked newest first until one is already known.
- If the facilitator times out in the middle of `/settle`, Shark answers 502 and does not reconcile: a payment that moved anyway shows up as an unmatched deposit to return by hand (needs the event reader).
- The URL fetcher checks the address before connecting, so DNS rebinding isn't caught.
