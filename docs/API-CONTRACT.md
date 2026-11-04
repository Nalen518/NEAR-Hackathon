# Shark & Co. — API contract

The single source for every interface: the Shark HTTP API, the worker and reviewer interfaces, the company contract, shared data shapes, and **every external resource we use** (§5). If code and this file disagree, fix one of them in the same change.

| Field | Value |
| --- | --- |
| Version | **2.3** (31 Oct: checked against docs.near.org, `near/agent-skills`, the x402 spec v2 and `@x402/near`; see §5.3. 1 Nov: payer view and complaint shapes settled with the web, D-172. The additions P1 to P6 in `docs/web/API-CHANGE-PROPOSAL-v2.3.md` are part of this version) |
| Deployments | One Shark host per deployment: **testnet** (methods 1 + 3) and **mainnet-lite** (methods 1 + 2 + 3). Method 1 = signed quote · 2 = NEAR Intents · 3 = x402 |

---

## 0. Conventions

| Topic | Rule |
| --- | --- |
| Transport | HTTPS, JSON, UTF-8, paths versioned `/v1` |
| Money in HTTP | Decimal **strings** in USDC (≤ 6 dp): `"0.60"`. Never floats |
| Money on-chain | `U128` base units, 6 decimals (`0.60` = `"600000"`) |
| Percentages | Integer bps (10 000 = 100%) |
| Time | HTTP: ISO 8601 UTC. On-chain and signed payloads: unix seconds |
| IDs | `orderId`/`jobId` = `j_` + zero-padded on-chain number; `quoteId` = `q_` + ULID; `fileId` = `f_` + ULID; files addressed by `sha256:` hash |
| Job types | `extract` · `summary` · `thread` |
| Accounts | Testnet examples end in `.testnet`, mainnet in `.near`; `<root>` = the company root account |
| Idempotency | `POST /v1/orders` accepts `Idempotency-Key`; same key + body within 10 min → same response |
| Sample data | Dashboard responses carry `"sample": { "<section>": bool }`; job responses carry one `"sample": bool` |
| Canonical JSON | Keys sorted, no spaces, UTF-8 (used for hashes and signatures) |
| CORS | Browser calls allowed only from the web origins (`https://<web-domain>`, `http://localhost:3100` (the web's dev port), `http://localhost:3000`): `GET, POST, OPTIONS`; headers `Content-Type, Idempotency-Key, PAYMENT-SIGNATURE`; exposed `WWW-Authenticate, Retry-After, PAYMENT-REQUIRED, PAYMENT-RESPONSE`. Agents call server-to-server |
| Network names | CAIP-2 everywhere: `near:testnet`, `near:mainnet`; Base: `eip155:84532` (Sepolia), `eip155:8453`. NEAR Connect uses `network: "testnet" \| "mainnet"` |
| Token | **Circle USDC on NEAR**: testnet `3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af`, mainnet `17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1` (per FastNEAR docs; **[VERIFY O-24]** with Circle) |
| Gas | Every on-chain call a client makes is given with explicit `gas` and `deposit` |

### 0.1 Error shape
```json
{ "error": "brief_infeasible", "message": "150 words can't cover 9 required points. Reduce the points or raise the limit.", "charged": false, "details": {} }
```
`charged` is present on every order error.

### 0.2 Error codes

| HTTP | `error` | When | Charged |
| --- | --- | --- | --- |
| 400 | `invalid_request` | Schema or field error (`details.field`) | no |
| 400 | `invalid_payer` | `payer` missing or not a valid NEAR account on this network | no |
| 400 | `invalid_refund_to` | `payWith` without a valid `refundTo` | no |
| 400 | `network_mismatch` | Request `network` ≠ this host's network (§0.3 N5) | no |
| 409 | `idempotency_conflict` | Same key, different body | no |
| 410 | `quote_expired` | Replay of an expired quote | no |
| 413 | `input_too_large` | > 2 MB file, > 20 pages or > 40 000 words | no |
| 422 | `input_unreadable` | URL unreachable, blocked, or a PDF without text | no |
| 422 | `job_refused` | Safety filter: harmful or illegal job | no |
| 422 | `brief_infeasible` | Constraints can't all be met (`details.reason`) | no |
| 422 | `unsupported_job_type` | Not `extract` / `summary` / `thread` | no |
| 422 | `unsupported_payment_asset` / `amount_below_minimum` / `intents_unavailable` | Method-2 problems | no |
| 402 | `x402_invalid` / `x402_settlement_failed` | `PAYMENT-SIGNATURE` malformed, `accepted` ≠ the stored requirement, wrong network, or the facilitator's verify/settle failed (`details.reason` = its `errorReason`) | no |
| 401 | `payer_signature_invalid` | Missing, expired (> 5 min) or wrong NEP-413 signature on a payer-only call (§1.5a, §1.6) | no |
| 403 | `not_payer` | Valid signature, but `accountId` is not the order's payer (§1.5a, §1.6) | no |
| 404 | `order_not_found` | Unknown `orderId` | no |
| 409 | `complaint_closed` | Complaint window over, or a complaint was already sent (§1.6) | no |
| 429 | `rate_limited` | > 30 requests/min per IP, or > 3 complaints/day per payer (`Retry-After`) | no |
| 502 | `upstream_unavailable` | NEAR AI, NEAR RPC, fetch or 1Click down before quoting | no |
| 503 | `closed` · `paused` · `caged` · `no_worker` · `out_of_budget` | Service state, checked first in this order | no |


### 0.3 Network binding — testnet and mainnet never mix
Testnet and mainnet are **two separate deployments that share only code**: their own Shark host, contract, accounts, token, facilitator, RPC, explorer and wallet session. Every value comes from one **network profile** (§5.1); nothing is hard-coded and nothing falls back to the other network.

| # | Rule | Enforced by |
| --- | --- | --- |
| N1 | Each Shark host serves **exactly one** network and says so in every response (`network: "near:testnet" \| "near:mainnet"`, CAIP-2 names, same as x402). `/v1/health` returns the network, contract and token | Shark |
| N2 | The web's `Testnet \| Mainnet` switch selects a **whole profile** (API URL, RPC, contract, USDC, explorer, wallets). Switching **signs the wallet out**, clears cached data and calls NEAR Connect `connector.switchNetwork("testnet" \| "mainnet")` (which disconnects the wallet); only wallets whose manifest has `features.testnet` / `features.mainnet` are offered. A wallet session is never carried across networks | Web |
| N3 | **Before every signature** the web checks: the wallet's network = the selected network; the 402's `pay.network` = the selected network; `pay.args.receiver_id` = the profile's contract; `pay.token` = the profile's USDC. Any mismatch blocks signing with "Your wallet is on Mainnet — switch it to Testnet" (or the reverse). Account suffix (`.testnet` / `.near`) is a hint only, because implicit 64-hex accounts look the same on both | Web |
| N4 | The **signed quote contains `network`**, and the contract rejects a quote whose `network` differs from its own config → a testnet quote can never be paid on mainnet (or replayed there) | Contract |
| N5 | `payer` and `referrer` must exist **on this network** (`view_account` via this network's RPC) → else `400 invalid_payer`. A request may send `network`; if it differs from the host's → `400 network_mismatch` | Shark |
| N6 | x402: the requirement's `network`, `asset` and `payTo` come from the profile; the facilitator is the profile's; a `PAYMENT-SIGNATURE` for another network → `402 x402_invalid` (`details.reason: "network"`) | Shark |
| N7 | Raven is paid on **Base Sepolia (84532)** from testnet and on **Base (8453)** from mainnet; the Chain Signatures signer, Base RPC and Base USDC come from the profile | Contract config, Shark |
| N8 | Mainnet is **real money**: the web shows a "Real USDC" badge and one extra confirm ("You are paying 0.60 real USDC on NEAR mainnet") before the wallet opens. Testnet always says "test USDC (no real value)" | Web |
| N9 | Method 2 (NEAR Intents) exists **only on mainnet**; on testnet the option is absent from `/v1/payment-options` and `payWith` → `422 intents_unavailable` | Shark, web |
| N10 | NEAR AI Cloud is the same off-chain service on both networks and **bills real money on testnet too** (by API key) | Note |

---

## 1. Shark HTTP API
Base URL `https://<shark-host>/v1`. No authentication: payment is the authentication.

### 1.1 `POST /v1/uploads` — upload an input file
`multipart/form-data` with `file` (PDF, HTML, TXT, MD; ≤ 2 MB) → `200 { "fileId": "f_01J…", "bytes": 482113, "pages": 6, "words": 3120, "inputHash": "sha256:…" }`. Errors: 413, 422 `input_unreadable`.

### 1.2 `POST /v1/orders` — place an order

**Request**
```json
{
  "jobType": "summary",
  "instructions": "Summarise this article in at most 150 words. Must mention NEAR Intents and fees.",
  "input": { "url": "https://example.com/blog/intents-explained" },
  "params": { "maxWords": 150, "mustMention": ["NEAR Intents", "fees"] },
  "payer": "demo-buyer.testnet",
  "referrer": "ref-agent.testnet"
}
```

| Field | Req | Notes |
| --- | --- | --- |
| `jobType` | yes | `extract` \| `summary` \| `thread` |
| `instructions` | yes | ≤ 2 000 chars; untrusted text |
| `input` | yes* | one of `{url}`, `{fileId}`, `{text}` (≤ 40 000 words). *`thread` may omit it |
| `params` | no | Optional structured hints; Shark fills the rest. Shapes per type in §4.1 |
| `payer` | yes | NEAR account that pays (method 1) and receives any refund |
| `referrer` | no | NEAR account; ignored if invalid or equal to the payer or a worker |
| `payWith` / `refundTo` | mainnet | Method 2: 1Click `assetId` + origin-chain refund address |

**`402 Payment Required`** (header `WWW-Authenticate: SharkQuote quote_id="q_…"`)
```json
{
  "orderId": null,
  "quoteId": "q_01JC8Z3R9X0V4G7K2M5N8P1Q3S",
  "jobType": "summary",
  "price": "0.60",
  "band": { "min": "0.20", "max": "1.00" },
  "floor": "0.12",
  "priceReason": "6 pages, 2 required points",
  "input": { "inputHash": "sha256:4c1e…", "pages": 6, "words": 3120, "source": "https://example.com/blog/intents-explained" },
  "brief": {
    "jobType": "summary",
    "params": { "maxWords": 150, "mustMention": ["NEAR Intents", "fees"], "language": "en", "format": "paragraph" },
    "checklist": [
      { "id": "C1", "kind": "code", "rule": "word_count <= 150" },
      { "id": "C2", "kind": "code", "rule": "mentions_all" },
      { "id": "C3", "kind": "code", "rule": "language == en" },
      { "id": "M1", "kind": "model", "rule": "every claim is supported by the source" },
      { "id": "M2", "kind": "model", "rule": "covers the source's main point" }
    ],
    "deliverableFormat": "text/plain"
  },
  "briefHash": "sha256:a91f…",
  "quote": {
    "quote_id": "q_01JC8Z3R9X0V4G7K2M5N8P1Q3S",
    "network": "near:testnet",
    "job_type": "summary",
    "price": "600000",
    "payer": "demo-buyer.testnet",
    "input_hash": "sha256:4c1e…",
    "brief_hash": "sha256:a91f…",
    "referrer": "ref-agent.testnet",
    "expires_at": 1793521364
  },
  "sig": "ed25519:…",
  "pay": {
    "network": "near:testnet",
    "token": "3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af",
    "method": "ft_transfer_call",
    "args": { "receiver_id": "sharkco.testnet", "amount": "600000", "msg": "pay:<base64(json{quote,sig})>" },
    "gas": "100000000000000",
    "deposit": "1"
  },
  "payerRegistered": true,
  "register": null,
  "intents": null,
  "expiresAt": "2026-11-05T08:22:44Z",
  "charged": false
}
```
- **Quote signature:** `sig = ed25519_sign(quote_key, sha256("sharkco:quote:v2|" + canonical_json(quote)))`, verified on-chain against `quote_pubkey`. The contract also requires `quote.network` = its configured network (§0.3 N4).
- **Mainnet:** the same shape with `network: "near:mainnet"`, `token` = mainnet Circle USDC, `receiver_id` = the mainnet contract, payer/referrer `.near` (or implicit) accounts.
- **Registration:** if `payerRegistered` is false, `register` = `{ "contract": "<usdc>", "method": "storage_deposit", "args": { "account_id": "<payer>", "registration_only": true }, "gas": "30000000000000", "deposit": "1250000000000000000000" }`. Send it first.
- **Method 1:** send `pay` exactly as given, then poll §1.3. `gas`/`deposit` **[VERIFY O-18]**.
- **Method 2 (mainnet):** `intents = { asset, chain, amountIn, depositAddress, refundTo, deadline }`. Send `amountIn` to `depositAddress`, optionally call §1.4, then poll §1.3.

- **Method 3 (x402 v2, checked against the x402 spec v2 and `scheme_exact_near.md`, 31 Oct):** the same 402 also sets the header `PAYMENT-REQUIRED: <base64(PaymentRequired)>`:
  ```json
  {
    "x402Version": 2,
    "error": "PAYMENT-SIGNATURE header is required",
    "resource": { "url": "https://<shark-host>/v1/orders", "description": "Shark & Co. summary job q_01JC8Z3R9X0V4G7K2M5N8P1Q3S", "mimeType": "application/json" },
    "accepts": [{
      "scheme": "exact",
      "network": "near:testnet",
      "amount": "600000",
      "asset": "3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af",
      "payTo": "sharkco.testnet",
      "maxTimeoutSeconds": 120,
      "extra": { "quoteId": "q_01JC8Z3R9X0V4G7K2M5N8P1Q3S", "briefHash": "sha256:a91f…" }
    }]
  }
  ```
  1. The bot signs a NEP-366 `SignedDelegateAction` with **exactly one** `ft_transfer` (receiver = `asset`, args `{receiver_id: payTo, amount}`, deposit 1 yocto) using a **full-access key**. It needs USDC but **no NEAR**: the facilitator's relayer pays gas and the 1 yocto.
  2. It **retries the same `POST /v1/orders`** (same body, same `Idempotency-Key`) with `PAYMENT-SIGNATURE: <base64(PaymentPayload)>`, where `PaymentPayload = { x402Version: 2, resource, accepted: <the accepts[] entry, unchanged>, payload: { signedDelegateAction: "<base64 borsh>" } }`.
  3. Shark finds the quote by `accepted.extra.quoteId` (not by re-running the brief), checks `accepted` equals the stored requirement, then calls the facilitator **`/verify` then `/settle`**. Settle returns only after the inner `ft_transfer` receipt has executed on chain (finality `FINAL`).
  4. Shark calls `mark_paid_x402` and answers **`200`** with the order and `PAYMENT-RESPONSE: <base64(SettlementResponse)>` = `{ "success": true, "transaction": "<tx hash>", "network": "near:testnet", "payer": "demo-buyer.testnet" }`:
  ```json
  { "orderId": "j_000042", "status": "paid", "statusUrl": "/v1/orders/j_000042", "payment": { "method": "x402", "tx": "…" } }
  ```
  5. **Failure:** `402` again with a fresh `PAYMENT-REQUIRED` (its `error` set) and our JSON error `x402_invalid` / `x402_settlement_failed` with `details.reason` = the facilitator's `errorReason` (e.g. `insufficient_funds`, `delegate_action_expired`, `delegate_action_nonce_already_used`, `duplicate_settlement`).
  - **Timeout vs quote expiry:** `maxTimeoutSeconds` is 120 (= 120 blocks, ~1 s each). Shark rejects an x402 retry when the quote has < 150 s left (→ `410 quote_expired`, ask again), so a settled payment can never meet an expired quote.
  - **Money that lands but can't be matched** (e.g. the service got caged between settle and `mark_paid_x402`): Shark calls `return_x402(settlement)` → the contract sends the amount back to the payer (§3.2). Fail to refund, never keep.
  - **Preconditions:** the company contract must be **registered on the USDC token** (`storage_deposit`), or the facilitator rejects every payment (deploy step, SRD §12). The payer must hold the USDC.
  - **Libraries (official, x402 Foundation):** `@x402/core` + `@x402/near` **2.29.0**: server `x402ResourceServer` + `ExactNearScheme` (`@x402/near/exact/server`); client `x402Client` + `createClientNearSigner` + `ExactNearScheme` (`/exact/client`); facilitator `x402Facilitator` + `createFacilitatorNearSigner` (`/exact/facilitator`). Because our price differs per quote, Shark builds the requirement per request instead of a fixed-price route middleware **[VERIFY O-25]**. `@fastnear/x402` (2.5.0) is the alternative.

**`202 Accepted`** for an `Idempotency-Key` replay after payment: `{ "orderId": "j_000042", "status": "paid", "statusUrl": "/v1/orders/j_000042" }`.

### 1.3 `GET /v1/quotes/{quoteId}`
`{ "quoteId": "q_…", "method": "quote" | "intents" | "x402", "status": "AWAITING_PAYMENT" | "PAID" | "EXPIRED" | "RETURNED", "orderId": "j_000042" | null, "paymentTx": "…", "oneClickStatus": "…" | null }`.

### 1.4 `POST /v1/quotes/{quoteId}/deposit` (mainnet, optional)
`{ "txHash": "0x…" }` → forwards to 1Click `POST /v0/deposit/submit` → `{ "accepted": true }`.

### 1.5 `GET /v1/orders/{orderId}` — status and result
```json
{
  "orderId": "j_000042",
  "status": "delivered",
  "network": "near:testnet",
  "jobType": "summary",
  "price": "0.60",
  "brief": { "…": "as in the quote" },
  "briefHash": "sha256:a91f…",
  "inputHash": "sha256:4c1e…",
  "timeline": [
    { "at": "2026-11-05T08:13:02Z", "event": "paid" },
    { "at": "2026-11-05T08:13:25Z", "event": "awarded", "worker": "crab" },
    { "at": "2026-11-05T08:14:40Z", "event": "delivered_for_review" },
    { "at": "2026-11-05T08:15:05Z", "event": "review_pass" }
  ],
  "auction": {
    "cap": "0.30",
    "bids": [
      { "worker": "crab", "price": "0.18", "etaSecs": 70, "state": "winner" },
      { "worker": "raven", "price": "0.24", "etaSecs": 45, "state": "lost" }
    ],
    "reason": "Crab is cheaper with a 93% first-pass rate; deadline allows 70 s."
  },
  "reviews": [
    { "round": 1, "mode": "primary", "pass": true, "codes": ["PASS"], "reasons": "All checks passed.", "attestationUrl": "https://…" }
  ],
  "delivery": { "format": "text/plain", "content": "NEAR Intents lets users …", "deliveryHash": "sha256:77be…" },
  "money": { "method": "quote", "price": "0.60", "workerFee": "0.18", "reviewFee": "0.05", "referral": "0.045", "owners": "0.195", "reserve": "0.13" },
  "complaint": { "allowedUntil": "2026-11-06T08:15:05Z", "status": null },
  "refund": null,
  "proof": { "paymentTx": "…", "workerPayoutTx": "…", "contractTxs": ["…"] },
  "sample": false
}
```
**`status`:** `paid`, `awarded`, `review`, `revision`, `failed`, `dispute_review`, `unresolved`, `delivered`, `complaint_review`, `finalized`, `refund_due`, `refunded`, `needs_review`. Final: `finalized`, `refunded`.
- `delivery` is `null` until a review passes; it stays `null` for `unresolved`, `refund_due` and `refunded`, in the payer view too.
- `needs_review`: "A payment step is being checked by hand. Your money is safe: the job will finish or be refunded."
- Refunds: `refund = { to: payer, amount, reason, tx }`.

### 1.5a `POST /v1/orders/{orderId}/view` — payer view (D-166)
`GET /v1/orders/{id}` is public and returns the **public view** (`view: "public"`): `brief` reduced to `jobType` + `checklist[].{id, kind}`; `instructions`, `input.source`, `brief.params` and `delivery` are **omitted**; `complaint` stays (window and status only); optional `size: { pages, words }`. The payer proves ownership with a NEP-413 signed message and gets the **payer view** (`view: "payer"`, the full §1.5 shape plus `instructions` and `input: { source, pages, words }`). The body is the flat `signMessage` output (D-172):
```json
{ "accountId": "demo-buyer.testnet", "publicKey": "ed25519:…", "signature": "<base64>", "message": "sharkco:view:j_000042:1793521364", "nonce": "<base64 32 bytes>", "recipient": "sharkco.testnet" }
```
`recipient` = this network's company contract id. Shark checks: the NEP-413 signature, `recipient`, the public key is a key of that account on **this network** (`view_access_key`), timestamp ≤ 5 min old, nonce not used before (the one exception: the payer view accepts the same signature again for the same account and order until it is 5 minutes old, so the page can refresh), then `accountId` = the order's payer. Response `200` = payer view with `Cache-Control: private, no-store`. Errors: `401 payer_signature_invalid`, `403 not_payer`, `404 order_not_found`.

### 1.6 `POST /v1/orders/{orderId}/complaint`
`{ "reason": "I asked for bullet points, the brief said paragraph.", "auth": { "…": "§1.5a body, message sharkco:complain:<orderId>:<ts>" } }` (reason ≤ 1 000 chars), only from the payer, only while `complaint.allowedUntil` is in the future → `202 { "status": "complaint_review" }`. Errors: `401 payer_signature_invalid`, `403 not_payer`, `409 complaint_closed`, `429 rate_limited`.

### 1.7 `GET /v1/prices`
```json
{ "types": {
  "extract": { "band": { "min": "0.30", "max": "1.50" }, "floor": "0.20" },
  "summary": { "band": { "min": "0.20", "max": "1.00" }, "floor": "0.12" },
  "thread":  { "band": { "min": "0.50", "max": "2.00" }, "floor": "0.24" } },
  "recentQuotes": [ { "at": "…", "jobType": "summary", "price": "0.60", "reason": "6 pages, 2 required points" } ] }
```

### 1.8 `GET /v1/payment-options`
Testnet: `{ "network": "near:testnet", "options": [ { "method": "quote", "token": "<Circle testnet USDC>", "label": "test USDC (no real value)", "faucet": { "url": "<Circle testnet faucet, O-17>" } }, { "method": "x402", "scheme": "exact", "network": "near:testnet", "asset": "<Circle testnet USDC>", "facilitator": "<url>" } ] }`. If Circle testnet USDC can't be obtained, the fallback is our mock `usdc.<root>.testnet` with `faucet_mint` (no args, 30 Tgas, 10 per 24 h, registers the caller).
Mainnet adds `{ "method": "intents", "asset": "nep141:base-0x8335…omft.near", "chain": "base", "minAmountIn": "…", "dryQuoteOk": true }` per route (from 1Click `/v0/tokens`, cached 1 h).

### 1.9 `GET /v1/company` — dashboard data
```json
{
  "network": "near:testnet",
  "state": "ok",
  "strikes": { "count": 1, "threshold": 3 },
  "reserve": { "balance": "40.10", "floor": "12.10", "sharkWallet": "3.10", "dailyBudget": "4.00", "ravenPayoutGas": { "balanceEth": "0.0041", "payoutsLeft": 23 } },
  "pnl7d": { "jobs": 200, "revenue": "128.00", "workers": "38.40", "reviews": "10.00", "referrals": "9.60", "profit": "70.00", "ownersPaid": "36.00", "ownersAccrued": "6.00" },
  "prices": { "…": "as /v1/prices" },
  "workers": [
    { "id": "crab", "account": "crab-worker.testnet", "payoutChain": "near", "types": ["extract", "summary", "thread"], "minFee": { "extract": "0.10", "summary": "0.06", "thread": "0.12" }, "jobs": 124, "firstPassPct": 93, "finalFails": 2, "disputesWon": 1, "disputesLost": 0, "suspendThreshold": 3, "unresolvedOpen": 0, "maxUnresolvedOpen": 2, "late": 1, "suspended": false, "eligible": true, "ineligibleReason": null },
    { "id": "raven", "account": "raven-worker.testnet", "payoutChain": "base", "types": ["extract", "summary", "thread"], "minFee": { "extract": "0.14", "summary": "0.08", "thread": "0.18" }, "jobs": 76, "firstPassPct": 89, "finalFails": 3, "disputesWon": 0, "disputesLost": 0, "suspendThreshold": 3, "unresolvedOpen": 1, "maxUnresolvedOpen": 2, "late": 0, "suspended": false, "eligible": true, "ineligibleReason": null }
  ],
  "reviewer": { "id": "owl", "account": "owl-reviewer.testnet", "reviews": 214, "overturned": 3, "reviewFee": "0.05", "suspended": false },
  "recentJobs": [ { "orderId": "j_000042", "jobType": "summary", "price": "0.60", "worker": "crab", "payoutChain": "near", "status": "finalized", "referral": "0.045", "attestationUrl": "https://…", "workerPayoutTx": "…" } ],
  "owners": { "dao": "sharkco.sputnikv2.testnet", "approvalRule": "1 of 1", "openProposals": [ { "id": 13, "title": "thread band 0.50–2.00 → 0.60–2.00" } ], "trezuUrl": "https://…" },
  "guardian": { "account": "guardian.sharkco.testnet", "power": "pause only" },
  "sample": { "strikes": false, "reserve": false, "pnl7d": true, "prices": false, "workers": false, "reviewer": false, "recentJobs": true, "owners": false }
}
```
`ineligibleReason`: `suspended` | `unresolved_cap` | `min_fee_above_cap` | `type_not_supported` | null.

### 1.10 `GET /v1/health`
`{ "ok": true, "network": "near:testnet", "state": "ok" | "closed" | "paused" | "caged" | "no_worker" | "out_of_budget", "contract": "…", "version": "…" }`

### 1.11 Files for workers and the reviewer (read-only, unguessable URLs)
`GET /v1/files/{sha256}` → the snapshot, brief or delivery by hash. Only for registered worker/reviewer keys (signed request header `X-Agent: <account>:<sig over path+ts>`) or the job's payer (deliveries after pass). `PUT /v1/files` (workers only) stores a delivery and returns its hash.

### 1.12 `GET /v1/openapi.json` (S)
OpenAPI 3.1 description of §1, including the 402 / x402 flow, for agent frameworks.

### 1.13 Webhook (C)
POST of §1.5 when an order reaches a final state; header `X-Shark-Signature: ed25519=<sig over body>`; 3 retries.

---

## 2. Worker and reviewer interfaces

### 2.1 Worker `POST /rfq`
```json
{ "jobId": "j_000042", "jobType": "summary", "size": { "pages": 6, "words": 3120 }, "briefUrl": "/v1/files/sha256:a91f…", "briefHash": "sha256:a91f…", "inputHash": "sha256:4c1e…", "cap": "0.30", "deadline": "2026-11-05T08:18:25Z" }
```
**Bid** (within 20 s; `204` = decline): `{ "workerId": "crab-worker.testnet", "jobId": "j_000042", "price": "0.18", "etaSecs": 70, "expiry": "…", "pubKey": "ed25519:…", "sig": "ed25519:…" }`
- Signature: `ed25519(sha256("sharkco:bid:v2|" + workerId + "|" + jobId + "|" + price_base + "|" + etaSecs + "|" + expiry_unix))`; `pubKey` must be an access key of `workerId` (RPC `view_access_key`).
- Invalid if `price < min_fee(type)`, `price > cap`, expired, bad signature, or the worker isn't eligible.

### 2.2 Worker `POST /award`
`{ "jobId": "j_000042", "price": "0.18", "awardTx": "…", "round": 1 | 2 }` → `{ "accepted": true }`. The worker fetches brief + snapshot, works, `PUT /v1/files` the delivery, then calls `deliver(job, delivery_hash)` on-chain before the deadline. `round: 2` = revision; the request includes the failed review's `codes` and `reasons`.

### 2.3 Worker `POST /dispute-window`
`{ "jobId": "…", "codes": ["FAIL_FAITHFULNESS"], "reasons": "…", "until": "…" }` → the worker calls `dispute(job)` on-chain if it disagrees.

### 2.4 Reviewer (Owl) — OutLayer execution input / output
**Input** (from the contract's `request_execution`):
```json
{ "job_id": "j_000042", "mode": "primary" | "secondary" | "complaint", "files_base": "https://<shark-host>/v1/files/", "brief_hash": "sha256:…", "input_hash": "sha256:…", "delivery_hash": "sha256:…", "order_text_hash": "sha256:…" }
```
**Output** (stdout, ≤ 900 bytes): `{ "job_id": "j_000042", "mode": "primary", "pass": true, "codes": ["PASS"], "reasons_hash": "sha256:…", "model": "<model id>" }`. Full reasons text is posted to Shark's file store under `reasons_hash`.
- Secrets (OutLayer env): `NEARAI_API_KEY`, the reviewer's file-access key.
- `mode: "complaint"` compares order text vs brief → `COMPLAINT_UPHELD` / `COMPLAINT_REJECTED`.

### 2.5 `GET /health` (each worker and Owl's helper)
`{ "ok": true, "agent": "crab", "types": ["extract","summary","thread"], "model": "<model id>" }`

---

## 3. Company contract

### 3.1 Roles

| Role | Who | How |
| --- | --- | --- |
| `owner` | DAO (Sputnik; Trezu UI) | Function-call proposal |
| `guardian` | `guardian.<root>` | `pause` only |
| `shark` | `shark.<root>` | Function-call key (NFR-04 list); no deposit |
| `quote_pubkey` | Shark's quote key | Verified in `ft_on_transfer` / `mark_paid_intents` |
| `worker` | Registered Raven / Crab | `deliver`, `dispute`, `update_min_fee` |
| `reviewer` | Owl via OutLayer | Callback `on_review` |
| `signer` | `v1.signer-prod.testnet` / `v1.signer` | Callback `on_signature` |
| anyone | — | Keepers (`finalize`, `pay_refund`, `release_unresolved`, `fund_shark`, `pay_owners`, `expire_*`) |

### 3.2 Methods

| Method | Caller | Guards → effect |
| --- | --- | --- |
| `new(owner_dao, guardian, shark, quote_pubkey, outlayer, signer, usdc, config)` | deployer | once |
| `set_config(config)` | owner | band mins ≥ floors; bps ≤ 10 000 → applies to new jobs |
| `register_worker(id, payout, types, min_fees)` / `register_reviewer(id, outlayer_project)` | owner | — |
| `suspend(id)` / `reinstate(id)` / `reset_strikes()` / `set_quote_pubkey(pk)` / `unpause()` / `wind_down()` | owner | `wind_down`: paused, no open jobs → all USDC to DAO; `closed = true` |
| `pause()` | guardian, owner | — |
| `update_min_fee(type, fee)` | worker (self) | future quotes only |
| `ft_on_transfer(sender, amount, msg)` | USDC token | `pay:<b64>`: not closed/paused/caged; sig valid; sender = payer; amount = price; band + floor; not expired; quote unused → **Paid**. `escrow:<job_id>`: sender = Shark wallet; amount = worker fee + review fee. `reserve`: anyone. A failed `pay:` returns the full amount (`payment_returned`) |
| `mark_paid_intents(quote, sig, receipt)` | shark | mainnet; quote valid/unused; `ft_balance_of(self) ≥ accounted + price` → Paid |
| `mark_paid_x402(quote, sig, settlement)` | shark | quote valid/unused; band + floor; `settlement` = `{tx_hash, payer, amount}` with `payer == quote.payer`; `ft_balance_of(self) ≥ accounted + price` → Paid (`method: x402`) |
| `return_x402(settlement)` | shark | For an x402 payment that landed but couldn't be matched to a job: `settlement.tx_hash` unused, `ft_balance_of(self) ≥ accounted + amount` → `ft_transfer(payer, amount)`; event `x402_returned` |
| `award(job, worker, fee, bid_hash, reason_hash)` | shark | eligible; `min_fee ≤ fee ≤ cap × price` → Awarded (waits for escrow) |
| `deliver(job, delivery_hash)` | awarded worker | before deadline → Review (round 1 or 2) |
| `start_review(job)` | shark, anyone | delivery present + escrow → OutLayer `request_execution` (mode primary) |
| `on_review(job, result)` | outlayer | primary: pass → pay worker + Owl, Delivered; fail r1 → Revision; fail r2 → Failed; `BRIEF_INVALID` → RefundDue + strike; `HASH_MISMATCH` → fail |
| `dispute(job)` | awarded worker | Failed, within `dispute_window` → DisputeReview |
| `start_dispute_review(job)` | shark, anyone | DisputeReview or Unresolved → request_execution (mode secondary); if the reviewer is unavailable past `review_deadline` → **Unresolved** (refund due, fee held, `unresolved_open +1`) |
| `release_unresolved(job)` | anyone | Unresolved ≥ 7 days → fee to worker; `disputes_unresolved +1`; Refunded |
| `complain(job, reason_hash)` | shark (for the payer) | Delivered, within 24 h → ComplaintReview (mode complaint) |
| `expire_work(job)` | anyone | past work deadline → Reauction (once) or RefundDue; escrow back to Shark |
| `request_raven_payout(job, nonce, gas_params)` / `on_signature(job, sig)` | shark / signer | one payout per job |
| `finalize(job)` | anyone | Delivered and complaint window over → referral, `owner_accrued`, reserve → Finalized |
| `mark_refund_due(job)` | shark, owner, anyone after `job_timeout` | → RefundDue |
| `pay_refund(job)` | anyone | `storage_deposit` for the payer if needed → `ft_transfer(payer, price)`; once |
| `pay_owners()` / `fund_shark()` | anyone | reserve ≥ floor / once per UTC day |

**Views:** `get_job`, `get_jobs(from, limit)`, `get_workers`, `get_reviewer`, `get_config`, `get_prices`, `get_price_floor(type)`, `get_stats`, `get_service_state` (`ok | paused | caged | closed`; the worker adds `no_worker`, `out_of_budget`).

### 3.3 Events (NEP-297, `standard: "sharkco"`, `version: "2.0.0"`)
`job_paid {job_id, quote_id, payer, job_type, price, method: quote/intents/x402, tx?, referrer?}` · `payment_returned {sender, amount, reason}` · `worker_awarded {job_id, worker, fee, bid_hash, reason_hash}` · `delivered {job_id, worker, round, delivery_hash}` · `review_result {job_id, mode, pass, codes, reasons_hash, attestation}` · `dispute {job_id}` · `unresolved / unresolved_released {job_id, worker}` · `complaint / complaint_result {job_id, upheld}` · `strike / caged {count, threshold}` · `worker_suspended / reinstated {id}` · `payout {job_id?, to, amount, kind: worker/reviewer/referral/owner/shark_budget, chain}` · `refund {job_id, to, amount, reason}` · `finalized {job_id}` · `paused / unpaused / config_changed / wound_down`.

### 3.4 Contract errors
`E_UNAUTHORIZED`, `E_CLOSED`, `E_PAUSED`, `E_CAGED`, `E_BAD_STATE`, `E_PRICE_OUT_OF_BAND`, `E_PRICE_BELOW_FLOOR`, `E_OVER_CAP`, `E_BELOW_MIN_FEE`, `E_NOT_ELIGIBLE`, `E_UNKNOWN_AGENT`, `E_WRONG_AMOUNT`, `E_WRONG_PAYER`, `E_BAD_QUOTE_SIG`, `E_QUOTE_EXPIRED`, `E_QUOTE_USED`, `E_BALANCE_NOT_RECEIVED`, `E_DEADLINE_PASSED`, `E_WINDOW_CLOSED`, `E_TIMEOUT_NOT_REACHED`, `E_ALREADY_SIGNED`, `E_RESERVE_FLOOR`, `E_ONCE_PER_DAY`, `E_OPEN_JOBS`, `E_BAD_CONFIG`.

---

## 4. Shared data shapes

### 4.1 Params per job type

| Type | `params` |
| --- | --- |
| `extract` | `{ "schema": { "fields": [ { "name": "price", "type": "number", "required": true } ] }, "many": true, "maxRecords": 50 }` — field types `string · number · date · url · enum(values)` |
| `summary` | `{ "maxWords": 150, "mustMention": ["…"], "language": "en", "format": "paragraph" | "bullets" }` |
| `thread` | `{ "posts": 5, "mustInclude": ["https://…", "#NEAR"], "tone": "neutral" | "friendly" | "bold", "topic": "…" }` |

### 4.2 Delivery formats
`extract` → `application/json` (array if `many`); `summary` → `text/plain` or bullets as `text/markdown`; `thread` → `application/json` `{ "posts": ["…", "…"] }`.

### 4.3 Checklist fixtures
`fixtures/checks/<type>/*.json` = `{ brief, snapshot, delivery, expected: { pass, codes } }`. The TS and Rust checklist libraries must produce identical `expected` for every fixture. Weighted X length: each URL counts 23; other characters count 1 (CJK/emoji 2) **[VERIFY O-21]**.

---

## 5. External resources

### 5.1 Network profiles (one per deployment — the web switch picks one whole column)
Every on-chain value the code uses comes from this table through env vars (`<NET>` = `TESTNET` or `MAINNET`; the web uses `NEXT_PUBLIC_<NET>_*`, services use the same names without the prefix and serve one network). **Nothing falls back to the other column.**

| Item | **Testnet** (build + backup demo) | **Mainnet-lite** (real money, small) | Env var | Status |
| --- | --- | --- | --- | --- |
| Network ID (CAIP-2 / NEAR Connect) | `near:testnet` / `testnet` | `near:mainnet` / `mainnet` | `<NET>_NETWORK_ID` | [VERIFIED] |
| Shark API (origin only, the client adds `/v1`) | `https://<shark-testnet-host>` | `https://<shark-mainnet-host>` | `<NET>_API_URL` | set at deploy |
| NEAR RPC | `https://rpc.testnet.fastnear.com` (= `@x402/near` default; docs.near.org also lists `https://test.rpc.fastnear.com`, `https://near-testnet.drpc.org`) | `https://rpc.mainnet.fastnear.com` (docs also list `https://free.rpc.fastnear.com`, `https://near.drpc.org`) | `<NET>_RPC_URL` (+ `<NET>_RPC_FALLBACK_URL`) | [VERIFIED 31 Oct]; legacy `rpc.*.near.org` is deprecated — never use |
| Explorer (tx / account links) | `https://testnet.nearblocks.io` | `https://nearblocks.io` | `<NET>_EXPLORER_URL` | [VERIFIED] |
| Company contract | `sharkco.testnet` (`<root>.testnet`) | `<root>.near` (owner's named account sub-account) | `<NET>_CONTRACT_ID` | set at deploy |
| Shark / guardian accounts | `shark.<root>.testnet`, `guardian.<root>.testnet` | `shark.<root>.near`, `guardian.<root>.near` | `<NET>_SHARK_ID`, `<NET>_GUARDIAN_ID` | set at deploy |
| Workers / reviewer accounts | `crab-worker.testnet`, `raven-worker.testnet`, `owl-reviewer.testnet` | separate `.near` accounts | `<NET>_*_ID` | Phase 0 |
| USDC on NEAR (Circle) | `3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af` | `17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1` | `<NET>_USDC_ID` | FastNEAR docs; **[VERIFY O-24]** with Circle |
| How users get USDC | Circle testnet faucet (NEAR support **[VERIFY O-17]**) → fallback our `usdc.<root>.testnet` + `faucet_mint` | Buy / bridge real USDC (owner funds the demo bot) | `<NET>_USDC_FAUCET_URL` | — |
| Gas token | Testnet NEAR from the NEAR testnet faucet | Real NEAR | — | — |
| Wallets offered (NEAR Connect) | Wallets whose manifest has `features.testnet` (filter `features: { testnet: true }`) — e.g. Meteor, HOT, MyNearWallet if listed | Wallets with `features.mainnet` — HOT, Meteor, Nightly, WalletConnect, 10+ | `<NET>_EXCLUDED_WALLETS` | [VERIFIED docs]; actual testnet list **[VERIFY O-28]** |
| Payment methods | 1 (signed quote) + 3 (x402) | 1 + 2 (Intents) + 3 | `<NET>_METHODS` | [DESIGN] |
| x402 network / facilitator | `near:testnet` · **our own** (`@x402/near` facilitator, relayer `x402-relayer.<root>.testnet`) or FastNEAR's public `https://test.x402.mikedotexe.com` | `near:mainnet` · ours (relayer `x402-relayer.<root>.near`, funded with real NEAR) or `https://x402.mikedotexe.com` | `<NET>_X402_FACILITATOR_URL`, `_API_KEY`, `_RELAYER_ID`, `_RELAYER_KEY` | the x402.org facilitator does **not** support NEAR [VERIFIED]; **[VERIFY O-26]** |
| NEAR Intents 1Click | — (not available) | `https://1click.chaindefuser.com` (OpenAPI `/docs/v0/openapi.yaml`) | `ONECLICK_URL`, `ONECLICK_API_KEY` (`X-API-Key`; JWT is legacy) | [VERIFIED 31 Oct]; key from the Partners Portal, else +0.25% fee |
| OutLayer API (custody wallet) | `https://testnet-api.outlayer.ai` | `https://api.outlayer.ai` | `<NET>_OUTLAYER_API_URL`, `_WALLET_KEY` | [VERIFIED] |
| OutLayer compute contract | `outlayer.testnet` | `outlayer.near` **[VERIFY O-03]** | `<NET>_OUTLAYER_CONTRACT` | — |
| Chain Signatures signer | `v1.signer-prod.testnet` | `v1.signer` | `<NET>_MPC_SIGNER` | [VERIFIED] |
| Raven's payout chain | Base Sepolia, `eip155:84532` | Base, `eip155:8453` | `<NET>_EVM_CHAIN_ID` | [VERIFIED] |
| Base RPC | a Base Sepolia endpoint | a Base endpoint | `<NET>_EVM_RPC_URL` | **[VERIFY O-07]** |
| USDC on Base (Circle) | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | `<NET>_EVM_USDC` | Circle docs **[VERIFY O-24]** |
| Base explorer | `https://sepolia.basescan.org` | `https://basescan.org` | `<NET>_EVM_EXPLORER_URL` | [VERIFIED] |
| Raven's receive address | Base Sepolia address | Base address (different key) | `<NET>_RAVEN_EVM_ADDRESS` | Phase 0 |
| Gas for Raven payouts | Base Sepolia ETH faucet → derived address | Real ETH on Base (~USD 5) | — | — |
| Owners' DAO | Sputnik `*.sputnikv2.testnet` (Trezu if it supports testnet, else Sputnik CLI) | Sputnik `*.sputnik-dao.near` via Trezu | `<NET>_DAO_ID` | **[VERIFY O-09]** |
| NEAR AI Cloud | `https://cloud-api.near.ai/v1` — same service, **real money** | same | `NEARAI_API_KEY` | [VERIFIED] |
| Money label in UI | "test USDC (no real value)" | "USDC" + "Real USDC" badge + extra confirm | — | [DESIGN] |

### 5.2 All resources (what each is for)

| # | Resource | Endpoint / ID | Used by | For | Auth / cost | Network | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | **NEAR AI Cloud** | `https://cloud-api.near.ai/v1` — `POST /chat/completions` (OpenAI-compatible, structured outputs), `GET /models`; also `POST /v1/privacy/classify` (option for the safety filter) and signed responses verifiable against TEE attestation (option for Owl if O-13 fails) | Shark (brief, safety, price reason), Raven + Crab (work), Owl (model checks) | All AI | `Authorization: Bearer <NEARAI_API_KEY>`; pay per token | both | **[VERIFIED]** (agent-skills `near-ai-cloud`); models **[VERIFY O-06]**; fallback OpenRouter |
| 2 | **NEAR RPC** | per network, see §5.1 | All services, web | Views, `view_access_key`, txs | free tier | both | choose in Phase 0 |
| 3 | **NEAR Connect** | `@hot-labs/near-connect` **0.12.0** (+ `near-connect-hooks` for React, `near-api-js` 7.4.0 for views). `new NearConnector({ network })`, `connect()`, `wallet().signAndSendTransaction({ receiverId, actions:[{type:"FunctionCall", params:{methodName,args,gas,deposit}}] })`, `signMessage` (NEP-413), `switchNetwork()` | Web | Customer pays (method 1) and proves payer (NEP-413) | — | both | **[VERIFIED 31 Oct]** — the wallet library used by docs.near.org and `near/agent-skills`; Wallet Selector is called the legacy format there and was last released Dec 2025 |
| 4 | **Circle USDC on NEAR** | testnet `3e2210e1…4afcb8af`, mainnet `17208628…e36133a1` — `ft_transfer_call`, `ft_transfer`, `storage_deposit` | Contract, web, bots | All payments | — | both | IDs from FastNEAR docs **[VERIFY O-24]**; testnet faucet **[VERIFY O-17]** |
| 5 | **Test USDC (ours, fallback)** | `usdc.<root>.testnet` + `faucet_mint()` | Web, bot | Only if Circle testnet USDC is unavailable | free | testnet | fallback |
| 5a | **x402 on NEAR** | **`@x402/core` + `@x402/near` 2.29.0** (x402 Foundation, official): spec `specs/schemes/exact/scheme_exact_near.md`; headers `PAYMENT-REQUIRED` / `PAYMENT-SIGNATURE` / `PAYMENT-RESPONSE`; `exact` scheme, NEP-366 delegate with one `ft_transfer`, full-access key only | Shark (server + own facilitator), demo bot (client) | Method 3 | — | both | **[VERIFIED 31 Oct]**; per-request pricing API **[VERIFY O-25]**; `@fastnear/x402` 2.5.0 = alternative |
| 5b | **x402 facilitator** | **ours** (`x402Facilitator` + `createFacilitatorNearSigner({ relayers })`, `POST /verify`, `POST /settle`, `GET /supported`) — or FastNEAR's public one (`https://test.x402.mikedotexe.com` / `https://x402.mikedotexe.com`, per-instance `X-API-Key`, manual approval) | Shark | Settle x402 payments; relayer pays gas + 1 yocto | gas only | both | the x402.org facilitator doesn't list NEAR; **[VERIFY O-26]** |
| 5c | **x402 Bazaar / catalog** | per facilitator | Discovery | Agents find our endpoint | — | both | optional **[VERIFY O-27]** |
| 6 | **NEAR Intents 1Click** | `https://1click.chaindefuser.com` — `GET /v0/tokens`, `POST /v0/quote` (`dry: true` then real; swap type `EXACT_OUTPUT`), deposit tx, `POST /v0/deposit/submit`, `GET /v0/status` | Shark (method 2) | Pay from other chains | `X-API-Key` from partners.near-intents.org (else +0.25%) | mainnet | **[VERIFIED 31 Oct]** (agent-skills `near-intents`); route minimum **[VERIFY O-05]**; delivery with message **[VERIFY O-04]** |
| 7 | **MPP NEAR Intents (optional)** | mpp.dev `nearintents.charge` | Shark | Standard 402 wrapper | — | mainnet | optional **[VERIFY O-02]** |
| 8 | **OutLayer custody wallet** | `https://testnet-api.outlayer.ai` / `https://api.outlayer.ai` — `/register`, `/wallet/v1/{address,balance,transfer,call,requests/{id},policy,audit}` | Shark | Escrow funding under a policy | `Bearer wk_…`; 100 ops/day free | both | **[VERIFIED]**; pin FT receiver **[VERIFY O-08]** |
| 9 | **OutLayer compute** | contract `outlayer.testnet` (mainnet ID **[VERIFY O-03]**) — `request_execution`; WASM `wasm32-wasip2`, HTTP via WASI P2, ≤ 60 s, output ≤ 900 bytes, secrets via env | Contract → Owl | Attested reviews | per execution | both | **[VERIFIED docs]**; NEAR AI call from inside WASM **[VERIFY O-13]** |
| 10 | **Chain Signatures** | `v1.signer-prod.testnet` / `v1.signer` — `sign`; `omni-transaction-rs` (contract), `chainsig.js` (relay) | Contract, Shark | Raven payouts | gas | both | **[VERIFIED]** |
| 11 | **Base / Base Sepolia RPC** | provider (chain IDs 8453 / 84532) — `eth_getTransactionCount`, `eth_sendRawTransaction` | Shark | Relay Raven payouts | free tier | both | choose **[VERIFY O-07]** |
| 12 | **USDC on Base / Base Sepolia** | Circle USDC contracts | Contract (payload), Raven | Raven's payout asset | — | both | addresses to record in config |
| 13 | **Trezu / Sputnik DAO** | Trezu app; Sputnik factory `sputnikv2.testnet` / `sputnik-dao.near` | Owners | Contract owner, treasury, proposals | gas | both | function-call proposals **[VERIFY O-09]** |
| 14 | **Web fetch + text extraction** | Shark's own fetcher (timeouts, size caps, user-agent), HTML readability extraction, a pinned PDF text library | Shark | Snapshots | — | both | library choice **[VERIFY O-20]** |
| 15 | **Hosting** | Railway or Fly (services, SQLite, a volume for files); Vercel (web) | All | Runtime | free/hobby tiers | both | **[DESIGN]** |
| 16 | **NEAR faucets** | NEAR testnet faucet; Base Sepolia ETH faucet | Setup | Gas on testnet | free | testnet | — |
| 17 | **Explorers** | NearBlocks (testnet / mainnet), BaseScan (Sepolia / mainnet) — §5.1 | Web, README | Proof links | free | both | [VERIFIED] |

### 5.3 Sources checked (31 Oct 2026)
| Source | What it confirmed or changed |
| --- | --- |
| docs.near.org — wallet login, NEAR Connect, RPC providers, chain signatures, faucet, FT, meta-tx | Wallet library = `@hot-labs/near-connect` (`network` in the constructor); RPC list (FastNEAR, dRPC, Intear…; NEAR's own endpoints "severely rate limited"); MPC signer `v1.signer-prod.testnet` / `v1.signer` |
| github.com/near/agent-skills (`near-dapp`, `near-api-js`, `near-intents`, `near-ai-cloud`, `near-kit`, `near-smart-contracts`, `near-contract-audit`, `near-cli-rs`) | NEAR Connect + `near-connect-hooks` are the recommended dApp stack; 1Click auth = `X-API-Key` (JWT legacy), +0.25% without a key; NEAR AI Cloud endpoints. **Install them for the coding agents:** `npx skills add near/agent-skills` |
| x402.org, docs.x402.org, github.com/x402-foundation/x402 (spec v2, `scheme_exact_near.md`, `@x402/near`) | NEAR is an official x402 network (`near:mainnet` / `near:testnet`, any NEP-141, USDC default); exact v2 wire format (`resource` object at top level, `accepted` echoed back, `SettlementResponse` fields); settle waits for the inner receipt; full-access keys only; recipient must be storage-registered; x402.org's own facilitator doesn't support NEAR |
| npm registry | `@x402/near` 2.29.0, `@x402/core` 2.29.0, `@hot-labs/near-connect` 0.12.0, `near-api-js` 7.4.0, `@fastnear/x402` 2.5.0, `@near-wallet-selector/core` 10.1.4 (Dec 2025) |

> **Hackathon-provided resources:** if HACKATHON.md or the organisers list sponsor credits, RPCs or faucets, add them here and in §5.1 (none are recorded yet).
