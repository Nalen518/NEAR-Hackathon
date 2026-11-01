# What the backend must build for the web · checklist (31 Oct 2026)

**For:** the backend agent (Shark service `/v1/*`, contract, workers, Owl).
**From:** the web front end. It is done on mocks and waits for these items to go live (W6).
**Details and reasons:** `BACKEND-HANDOFF.md` (rules) and `API-CHANGE-PROPOSAL-v2.3.md` (shapes). If anything here disagrees with `API-CONTRACT.md`, the contract wins: record it and ask the owner.

**How to check any item:** parse your real response with the web's schema. It throws on any mismatch.
```ts
import { Order, Quote402, Company, Prices } from "@shark/shared"; // packages/shared/src/schemas.ts
Order.parse(await (await fetch(`${API}/v1/orders/j_000042`)).json());
```

Tiers were agreed by the owner on 30 Oct: **Must** first, then **Should**, then **Could**.

---

## A. Before anything works live (Must)

- [ ] **A1 · Serve `/v1/*` on testnet** with the API-CONTRACT v2.2 shapes and `network: "near:testnet"` on every response.
  - **Accept when:** `Prices`, `Company`, `Health`, `PaymentOptions` and `QuoteStatus` all parse.
  - **Watch out:** the web now **rejects any response whose `network` (or signed `quote.network`) isn't the selected one** (API §0.3 N1). A testnet host that answers `near:mainnet` anywhere shows a "Wrong network" banner and blocks payment.
- [ ] **A2 · `POST /v1/orders` answers 402 or 202** (never 200 for the web) with the full `Quote402` body.
  - The body includes `brief`, `briefHash`, `input.{inputHash,pages,words,source}`, `quote` (with `network`), `sig`, `pay`, `payerRegistered`, `register`, `expiresAt` and `charged:false`.
  - **Accept when:** `Quote402.parse` passes, `pay.args.amount === quote.price`, and `pay.token` and `pay.args.receiver_id` equal the testnet USDC and contract.
- [ ] **A3 · `GET /v1/quotes/{id}`** moves `AWAITING_PAYMENT → PAID` and sets `orderId` once paid. A bad payment moves it to `RETURNED`.
  - **Accept when:** after a real `ft_transfer_call`, the web's step 04 shows "Paid … on NEAR" within about 15 s.
- [ ] **A4 · `POST /v1/uploads`** (multipart `file`, ≤ 2 MB, PDF, HTML, TXT, MD) returns `UploadResult`, with 413 and 422 for bad files.
- [ ] **A5 · Errors follow §0.1** on every order call:
  - `charged` is always present.
  - `details.field` is set on 400s (`instructions`, `source`, `payer`, `referrer`).
  - `Retry-After` (whole seconds) is sent on 429 and 503.
  - **Accept when:** `ApiError.parse` passes for each code in §0.2.
- [ ] **A6 · P1 public view.** `GET /v1/orders/{id}`:
  - returns `view:"public"`
  - **omits** `instructions`, `input.source`, `brief.params` and `delivery`
  - keeps `brief.checklist[].{id,kind}`
  - may add `size:{pages,words}`
  - **Accept when:** `Order.parse` passes and none of those keys exist.
- [ ] **A7 · P1 payer view.** `POST /v1/orders/{id}/view` takes the NEP-413 `signMessage` output:
  - **Body:** `{accountId, publicKey, signature, message, nonce, recipient}`.
  - **Message format:** `sharkco:view:<orderId>:<unix ts>`. The recipient is the contract id, and the nonce is 32 bytes base64.
  - **Verify:** the signature is per NEP-413, `publicKey` is an access key of `accountId` (`view_access_key`), `accountId === payer`, and `ts` is within 5 min.
  - **Return:** `200` with `view:"payer"` and `Cache-Control: private, no-store`, or `401 payer_signature_invalid`, or `403 not_payer`.
- [ ] **A8 · P2 signed complaints.** `POST /v1/orders/{id}/complaint` takes `{ reason (≤ 1 000), auth }`, where auth is the same shape as A7 with the message `sharkco:complain:<orderId>:<ts>`.
  - **Return:** `202 {status:"complaint_review"}`, or 401, 403, `409 complaint_closed` (window over or already sent) or `429`.
- [ ] **A9 · `delivery` stays `null`** until a review passes, and also for `unresolved`, `refund_due` and `refunded`, **even in the payer view**.
- [ ] **A10 · CORS** allows these origins: `http://localhost:3100` (dev) and the deployed web origin.
  - **Methods:** `GET, POST, OPTIONS`.
  - **Request headers:** `Content-Type`, `Idempotency-Key`.
  - **Exposed headers:** `Retry-After`, `WWW-Authenticate`.
- [ ] **A11 · `GET /v1/payment-options` (testnet)** returns `quote` with `faucet.url` (Circle, or the fallback mock USDC faucet) and the `x402` option. Mainnet adds the `intents` routes.
- [ ] **A12 · Testnet values for the web's env** (owner puts them in `.env.local`, never in the repo):
  - `NEXT_PUBLIC_TESTNET_API_URL`, `_CONTRACT_ID`, `_USDC_ID`, `_RPC_URL`
  - `_USDC_FAUCET_URL`, `_WALLETS` (Wallet Selector module ids that work on testnet, O-28)
  - Same names for mainnet later. The full list is in `apps/web/.env.example`.

## B. So the pages show real detail (Should)

- [ ] **B1 · P3 timeline.** Emit `timeline[]` oldest first with the v2.3 event names.
  - **Events:** `paid, awarded, delivered_for_review, review_pass, review_fail, revision_requested, dispute, second_review_pass, second_review_fail, unresolved, worker_paid, reviewer_paid, complaint, complaint_upheld, complaint_rejected, refund_due, refunded, finalized, needs_review`.
  - **Per event:** carry `worker`, `amount`, `round` and `tx` where they apply.
  - **Also add:** `auction.reasonHash` and `proof.awardTx`.
  - **Accept when:** the Job page's "What happened" shows each payout with a tx link.
- [ ] **B2 · P4 per-check results.** Send `reviews[].checks = [{id, pass, detail?}]`.
  - `detail` is for **code checks only**, computed by Shark with the checklist library (for example `"142 words"`, `"both found"`, `"en"`). It is ≤ 40 chars, with no `;` or dashes.
  - Model checks send `pass` only.
- [ ] **B3 · Exact `brief.checklist[].rule` strings for extract and thread.** The web maps them to copy in `apps/web/lib/checklist.ts`; send us the real list (gap G12). Our guesses:
  - **Extract:** `json_parses`, `matches_schema`, `required_fields_filled`, `traceable >= 90%`, `records <= N`, `no invented records`
  - **Thread:** `post_count == N`, `post_length <= 280`, `includes_all`, `no_extra_handles`, `on topic`, `no invented facts`
- [ ] **B4 · P6 core on `/v1/company`:**
  - `config` (13 fields + `bands` + `changedAt`, `changedByProposal`, `changeTx`), from `get_config` and DAO proposals
  - `owners.proposals[]` (`id, title, status, at, votes`) and `owners.ownersWaiting`
  - `payouts[]` (`at, orderId, to, kind, amount, chain, tx, held`), newest first, ≤ 20
  - `reserve.ravenPayoutGas.warnBelow`
  - `recentJobs[].at`, `reserveDelta` and `refund` (G30: without `at` the ledger date is blank)
  - `sample` with 11 keys: `strikes, reserve, pnl7d, prices, workers, reviewer, recentJobs, owners, config, payouts, guardian`. Set **false only for real on-chain data**, because the web hides tx links while it is true.
- [ ] **B5 · `money` on each order** (`method, price, workerFee, reviewFee, referral, owners, reserve`) once the split is known, and `complaint.allowedUntil` once a review passes.
- [ ] **B6 · `404 order_not_found`** for unknown job ids (G25). The web treats 400 as "No such job" until then.

## C. Nice for the demo (Could; the web shows SAMPLE until they exist)

- [ ] **C1 · P5 on `/v1/prices.recentQuotes[]`:** `status: paid | expired | returned`, `returnReason` (the contract's `payment_returned` reason) and `tx`.
- [ ] **C2 · P6 extras:** `auctions[]` (`orderId, jobType, price, cap, bids, winner, reason, outcome`) and `incidents[]` (`at, orderId, kind, text, strike`), newest first, ≤ 20. Add the `sample.auctions` and `sample.incidents` keys when you serve them.
- [ ] **C3 · `details.fixes[]` on `422 brief_infeasible`:** each fix as `{label, params, price}`, so the web can show "+0.20" next to each fix (G21).

## D. Already settled: don't change these

- Money is a decimal string in HTTP (≤ 6 dp) and `bigint` base units on chain. Never a float.
- Times are ISO 8601 UTC with `Z`. Signed payloads use unix seconds.
- Network names are CAIP-2: `near:testnet` / `near:mainnet`.
- IDs:
  - jobs: `j_` + ≥ 6 digits
  - quotes and files: `q_` / `f_` + an uppercase ULID
  - hashes: `sha256:…`
- Lists are newest first, except `timeline` (oldest first).
- Text you send that the web shows (`message`, `reasons`, `priceReason`, `detail`, auction `reason`, incident `text`) follows D-170: no semicolons, em or en dashes, or hyphenated words. Use made-up brands only.

## E. What the web does once these land (W6, owner's yes needed)

1. Switch `NEXT_PUBLIC_API_MODE=live` and produce an endpoint → schema pass/fail table.
2. Wire the real NEAR Wallet Selector (`signAndSendTransaction`, `signMessage`).
3. With the owner's yes for each payment: faucet → order a summary → pay → watch it deliver → sign in as payer → one complaint.
4. Report the tx hashes. Any parse failure goes back to you as a contract bug.

Owner-only items that don't block you: copy gaps G5, G15, G16, G18 to G20, G24, G26, and logging the v2.3 tier decision in `DECISIONS.md` (G28).
