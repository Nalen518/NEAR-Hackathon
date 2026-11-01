# Backend handoff from the web front end · v2 (30 Oct 2026, updated 31 Oct)

**For:** the agents building the Shark service (`/v1/*`), the workers, Owl and the company contract.
**Start here:** `docs/web/BACKEND-TODO.md` is the checklist (Must / Should / Could) with an acceptance check for each item. This file explains the rules behind it.
**From:** the web session. The full log is in `docs/web/SESSION-2026-10-30.md`, and the field map and gaps G1 to G27 are in `docs/web/W0-reading-report.md`.
**Build against:**
- `docs/API-CONTRACT.md` **v2.2**
- `docs/web/API-CHANGE-PROPOSAL-v2.3.md`: additions the web already uses on mocks. **Agreed by the owner in three tiers (30 Oct)**, so build in this order:
  - **Must:** P1 payer view, P2 signed complaints.
  - **Should:** P3 timeline events and proofs, P4 per-check results (code checks only), P6 core (`config`, `owners.proposals` + `ownersWaiting`, `payouts`, `warnBelow`, `recentJobs` deltas).
  - **Could:** P5 quote status (`returned`, not `rejected`), P6 extras (`auctions`, `incidents` logs). These are optional in the schemas: when missing, the web shows empty logs marked SAMPLE.

If this file disagrees with API-CONTRACT, **API-CONTRACT wins**. Record the disagreement and ask the owner. Don't guess.

This replaces the 26 Oct handoff, which was written for the retired v1 "check a call" product.

---

## 1. Where the front end stands

| Page | Route | State |
| --- | --- | --- |
| Landing | `/` | ✅ Built on mocks (9 slots, receipt stage, Sea mist) |
| Order | `/order` | ✅ Built on mocks: form, 402 brief + quote, pay (mock wallet), what happened, every error state |
| Job | `/jobs/[id]` | ✅ Built on mocks: public view, payer view after a NEP-413 signature, complaints, every status |
| The company | `/company` | ✅ Built on mocks: every v2.3 company field, LIVE or SAMPLE per pane, system banners |
| Component gallery | `/dev/components` | ✅ Dev only |
| Live testnet (W6) | none | ⏳ **Not started.** It waits for your API on testnet (ROADMAP G5) and the owner's yes |

**The web is done on mocks, not done live.** It has never called a real API, wallet or contract.
Tests: typecheck and lint are clean. Vitest has 47 web and 24 shared tests, and Playwright has 67. Lighthouse (production build): performance 100 and accessibility 100 on all four pages.

## 2. What the web calls

Every response goes through a zod schema in `packages/shared/src/schemas.ts`:
- **Extra fields are ignored.**
- **A missing or wrong field** shows a visible "contract mismatch" error instead of the page.

| Call | Used on | Statuses the web accepts | Notes |
| --- | --- | --- | --- |
| `GET /v1/prices` | Landing, Order, Company | 200 | `recentQuotes[].status/returnReason/tx` are optional (P5, could) |
| `GET /v1/company` | Landing, Job (worker stats), Company | 200 | v2.3 P6 core is required. `auctions` and `incidents` may be omitted (P6 extras, could). See §3 |
| `GET /v1/health` | none yet | 200 | Schema ready |
| `GET /v1/payment-options` | Order | 200 | Testnet: `quote` (with `faucet.url`) + `x402`. Mainnet: + `intents` routes |
| `POST /v1/uploads` (multipart `file`) | Order | 200, 413, 422 | `UploadResult` |
| `POST /v1/orders` + `Idempotency-Key` | Order | **402** (quote), **202** (replay after payment), §0.1 errors | **A 200 here is treated as a mismatch.** 200 is for x402 retries only, and the web never sends `PAYMENT-SIGNATURE`. Mainnet "pay from another chain" re-posts the same order with `payWith` + `refundTo` |
| `GET /v1/quotes/{quoteId}` | Order (every 3 s after paying) | 200 | `orderId` must be set once `PAID` |
| `GET /v1/orders/{orderId}` | Order, Job (every 5 s, 60 s while `unresolved`) | 200 | Must return the **public view** (v2.3 P1) |
| `POST /v1/orders/{orderId}/view` | Job | 200 payer view, **401** `payer_signature_invalid`, **403** `not_payer` | v2.3 P1. Body = NEP-413 output. Send `Cache-Control: private, no-store` |
| `POST /v1/orders/{orderId}/complaint` | Job | **202**, 401, 403, **409** `complaint_closed`, 429 | v2.3 P2: `{ reason, auth }` |

## 3. Things the web relies on: get these exactly right

1. **Money is a decimal string, never a number.**
   - USDC: `"0.60"`, `"0.045"`, at most 6 dp.
   - Base units: digit-only strings.
   - ETH (`ravenPayoutGas.balanceEth`): a string with at most 18 dp.
2. **Times are ISO 8601 UTC with `Z`.** Signed payloads use unix seconds (§0).
3. **IDs:** `j_` + at least 6 digits; `q_` / `f_` + uppercase ULID characters; hashes start `sha256:`.
4. **Network names are CAIP-2:** `near:testnet` / `near:mainnet`, everywhere, including `pay.network` and every response's `network`. The web rejects any response that states the other network (§0.3 N1).
5. **Enums are exact lowercase strings**, as in the schemas:
   - order `status` (13)
   - `timeline[].event`: the v2.3 P3 list
   - bid `state`: `winner|lost|busy|late|invalid`
   - review `mode`: `primary|secondary|complaint`
   - review `codes`: SRD §8.3
   - payout `kind`
   - incident `kind`
   - auction `outcome`
6. **Errors follow §0.1:** `{ error, message, charged, details }`.
   - `charged` must be on every order error.
   - Send `Retry-After` in whole seconds on 429 and 503; the web shows it.
   - For a 400, put the field in `details.field` (`instructions`, `source`, `payer`, `referrer`) so the web can show it inline.
7. **The 402 body is signed exactly as the web will send it.** The web takes `pay.token`, `method`, `args`, `gas` and `deposit` (and `register`, the same way) and passes them to the wallet unchanged. Before signing it checks (N3):
   - `pay.network` = the selected network
   - `pay.args.receiver_id` = the profile's contract
   - `pay.token` = the profile's USDC
   - wallet account = `quote.payer`

   Any mismatch blocks payment.
8. **`brief.checklist[].rule` strings are mapped to copy** in `apps/web/lib/checklist.ts`.
   - The summary rules follow API §1.2.
   - The extract and thread rules there are guesses from SRD §8.2: `json_parses`, `matches_schema`, `required_fields_filled`, `traceable >= 90%`, `records <= N`, `post_count == N`, `post_length <= 280`, `includes_all`, `no_extra_handles`.
   - **Send us your exact strings** (gap G12). Unknown rules show raw.
9. **Privacy (D-166, v2.3 P1).** The public `GET /v1/orders/{id}`:
   - must **omit** `instructions`, `input.source`, `brief.params` and `delivery`, and keep only `brief.checklist[].{id,kind}`
   - may include `size: {pages, words}`

   The web has a test that a public view leaks none of these.
10. **`delivery` is `null`** until a review passes, and **stays null** for `unresolved`, `refund_due` and `refunded`, even in the payer view.
11. **List order:** `timeline` is **oldest first**. `recentQuotes`, `auctions`, `incidents`, `payouts`, `proposals` and `recentJobs` are **newest first**, at most 20 each.
12. **`sample` flags:**
    - `/v1/company.sample` must have these 11 keys: `strikes, reserve, pnl7d, prices, workers, reviewer, recentJobs, owners, config, payouts, guardian`. Add `auctions` and `incidents` when you serve those logs (missing = sample).
    - Orders carry `sample: boolean`.
    - **The web hides every tx and attestation link while `sample` is true**, so set it `false` only for real on-chain data.
13. **Per-check review results (v2.3 P4):** `reviews[].checks = [{id, pass, detail?}]`. Send `detail` **for code checks only** (computed by Shark with the checklist library); model checks carry `pass` only. `detail` is at most 40 characters, with no semicolons or dashes (D-170), for example `"142 words"`.
14. **Timeline events carry `worker`, `amount`, `round` and `tx`** where they apply (v2.3 P3), plus `auction.reasonHash` and `proof.awardTx`.
15. **`ravenPayoutGas.payoutsLeft` can be `null`** ("unknown until the first payout"). Below `warnBelow` the web shows a warning.
16. **CORS:**
    - Allow `http://localhost:3100`. That's the web's dev port, because 3000 is taken on the build laptop (gap G7).
    - Allow the deployed web origin.
    - Allow the request headers `Content-Type` and `Idempotency-Key`.
    - Expose `Retry-After`.
17. **Customer text is untrusted.** The web renders instructions and deliveries as plain text (tested with an XSS string). Never put HTML in `message` or `reasons` expecting it to render.

## 4. Fixtures and the fastest check

`packages/shared/fixtures/api/` holds one example per shape, all built from the DESIGN-HANDOFF §3 numbers:
- `prices`
- `health`
- `company` (full v2.3)
- `upload`
- `quote-402`
- `x402-payment-required`
- `quote-status-paid`
- `order-delivered-payer`
- `order-delivered-public`
- `payment-options-testnet`
- `error-infeasible`

Parse your real responses with the same schemas:

```ts
import { Company, Order, Quote402 } from "@shark/shared";
Company.parse(await (await fetch(`${API}/v1/company`)).json()); // throws on any mismatch
```

The mock API (`apps/web/mocks/scenarios.ts`, 33 `?mock=` scenarios, including `thread_job` and `extract_job` deliveries) shows how each error, system state and order path should look. Examples: `refused`, `infeasible`, `caged`, `returned`, `unregistered`, `revision`, `dispute`, `unresolved`, `complaint_upheld` and `needs_review`.

## 5. Open items

| # | Item | Who | Note |
| --- | --- | --- | --- |
| B1 | Serve `/v1/*` on testnet with the v2.2 shapes | **Backend** | Unblocks W6 |
| B2 | Implement the v2.3 proposal in tier order: must (P1, P2), should (P3, P4 code only, P6 core), could (P5, P6 extras) | **Backend** | Agreed by the owner 30 Oct. Update API-CONTRACT to v2.3 in the same change |
| B3 | Exact `brief.checklist[].rule` strings for extract and thread | Backend | G12 |
| B4 | `404 order_not_found` for unknown jobs | Backend | G25. The web treats 400 as "No such job" for now |
| B5 | `details.fixes[]` on `brief_infeasible` (fix text + new price) | Backend, optional | G21. The web offers its own fixes for now |
| B6 | Testnet API, contract and USDC values for the web's env (`NEXT_PUBLIC_TESTNET_*`) | Backend → owner | Names only in `apps/web/.env.example`. Values never go in the repo |
| B7 | CORS for `localhost:3100` | Backend | G7 |
| W1 | NEAR Wallet Selector (NEAR wallets only, incl. `signMessage`), replacing the mock wallet | Web | After B1, with the owner's yes |
| W2 | Live schema pass/fail table, then faucet → order → pay → deliver → sign in → complaint | Web | After B1. **Every test payment needs the owner's explicit yes** |
| W3 | Lighthouse, hero fps, motion polish, pixel check against Figma | Web | Not blocking you |
| W4 | Copy gaps G5, G15, G16, G18 to G20, G24, G26 | Owner | Not blocking you |

## 6. Rules that apply to you too
- **No git before 1 Nov 2026 07:00 WIB** (D-163). Then one honest initial import commit and real commits. Never fake dates. No push without the owner's yes.
- **Never sign, spend or deploy with the owner's keys.** No mainnet calls. Every test payment needs the owner's yes, each time.
- **No secrets in the repo.** `.env` stays git-ignored and `.env.example` lists names only. Run a secret scan before every commit.
- **Money is never a float**, in the services as well: use `bigint` or decimal strings.
- **UI copy you send:**
  - D-170: no semicolons, em or en dashes, or hyphenated words in `message`, `reasons`, check `detail` or price reasons.
  - Testnet money is "test USDC".
  - Made-up brands only (`@example_brand`, `example.com`).
- **Dates are never faked**, and nobody claims the work started on 1 Nov (D-163).
