# Backend checklist

The one place to see where the backend stands. Updated right after every finished task.
Items come from `docs/web/BACKEND-TODO.md` (A Must, B Should, C Could) and the SRD. Shapes follow API-CONTRACT v2.3 (D-172).

**Status:** ✅ done and tested · 🟡 partly done · ⬜ not started · 🔒 needs a wallet signature (owner's yes each time) · 🧠 needs the NEAR AI key

**How "done" is checked:** every response is parsed with the web's schemas from `packages/shared` in `services/shark/test/contract.test.ts`, against a fake chain. Nothing has run on testnet yet.

Last updated: 2 Nov 2026 (after `fd56a27`)

## A. Must (the web goes live on these)

| Item | Status | Where | Notes |
| --- | --- | --- | --- |
| A1 Serve `/v1/*` with `near:testnet` | ✅ | `b37e5fb` | Prices, Company, Health, PaymentOptions, QuoteStatus all parse |
| A2 `POST /v1/orders` 402 with a signed quote | ✅ | `f523c10` | Canonical quote bytes pinned in the Rust and TS tests. No x402 header yet (see x402 below) |
| A3 `GET /v1/quotes/{id}` | 🟡 | `f523c10` | AWAITING_PAYMENT, PAID, EXPIRED work. RETURNED needs the event reader |
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
| B1 Timeline events with tx links | 🟡 | `2acabfa` | paid, awarded (worker, award tx), delivered, review pass or fail, revision. The rest needs the event reader |
| B2 Per-check review results | ✅ | `cb15147` | Code checks with detail, model checks pass only, Owl's reasons |
| B3 Exact rule strings | ✅ | `f523c10` | The web's list in `apps/web/lib/checklist.ts` is now the real one |
| B4 Company core (P6) | 🟡 | `b37e5fb` | Live: strikes, reserve, P&L, workers, reviewer, ledger, config. Sample: DAO proposals (no DAO yet), payouts (needs the event reader) |
| B5 `money` on orders | ✅ | `f523c10` | Same split as the contract's `finalize` |
| B6 `404 order_not_found` | ✅ | `ca2bf11` | Schema fixed too |

## C. Could

| Item | Status | Where | Notes |
| --- | --- | --- | --- |
| C1 Recent quotes with status | 🟡 | `fd56a27` | Last 20 quotes, paid or expired. "returned" and its reason need the event reader |
| C2 Auctions and incidents logs | 🟡 | `fd56a27` | Auctions log done. Incidents from job state (complaints, impossible briefs); disputes, late work and strikes need the event reader |
| C3 `details.fixes[]` on brief_infeasible | ✅ | `fd56a27` | `{label, params, price}`. The web still offers its own fixes until it reads these |

## Schema bugs found and fixed
- `OrderRequest.params` stripped thread params. Fixed with strict params schemas (`ca2bf11`).
- `ERROR_CODES` had no `order_not_found`. Added (`ca2bf11`).

## Next: no wallet or AI needed (in this order)

| # | Task | Status |
| --- | --- | --- |
| 1 | C1 recent quotes, C3 fixes with prices, C2 auctions log, `out_of_budget` state | ✅ `fd56a27` |
| 2 | Contract: disputes and Unresolved (FR-44 to FR-46), Shark loop and timeline for them | ⬜ |
| 3 | Contract: `pay_owners`, `fund_shark`, `wind_down`, late worker re-auction, storage deposit in `pay_refund`, an owed ledger for failed payouts | ⬜ |
| 4 | x402: the `PAYMENT-REQUIRED` header, `PAYMENT-SIGNATURE` checks, contract `mark_paid_x402` and `return_x402` | ⬜ |
| 5 | Event reader (NEP-297 logs) for B1 tx links, the payouts list, RETURNED quotes and the incidents log | ⬜ |
| 6 | `GET /v1/openapi.json` (FR-14) | ⬜ |
| 7 | Sandbox tests of the real wasm in Docker (full job path) | ⬜ |
| 8 | Rust port of the code checks, for Owl in the OutLayer TEE (NFR-02) | ⬜ |

## Later: needs a wallet 🔒 or NEAR AI 🧠
- 🔒 Testnet deploy: contract init, register workers and Owl, USDC storage registrations, reserve seed, agent keys, then A12.
- 🔒 x402 settlement through our own facilitator (a funded relayer account).
- 🧠 Running Crab, Raven and Owl for real (built and tested with a fake model in `a37ad08`). Pick models (O-06).
- 🧠 The safety filter on NEAR AI (a pattern list for now).
- 🔒🧠 Owl in the OutLayer TEE with attestation (O-03, O-13). Raven paid on Base via Chain Signatures (FR-60). The owners' DAO (O-09). The OutLayer custody wallet for Shark (D-144).
- Hosting (Railway or Fly) and the deployed web origin for CORS.

## Shortcuts in the code (each marked `shortcut:` where it lives)
- Escrow comes from a plain testnet wallet account, not the OutLayer custody wallet.
- Reviews are posted by Owl's own account, not an OutLayer callback, so there is no attestation.
- The safety filter is a pattern list.
- A failed worker, reviewer or referral payout is parked in the reserve.
- A second failed review is final, because the dispute window isn't built yet.
- The rate limit is kept in memory on one host.
- The URL fetcher checks the address before connecting, so DNS rebinding isn't caught.
