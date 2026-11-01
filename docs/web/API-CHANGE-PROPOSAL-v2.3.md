# API change proposal v2.2 → v2.3 (from the web, 30 Oct 2026)

**Status:** Agreed in tiers by the owner (30 Oct 2026). API-CONTRACT is updated from here. Every change is **additive**: no v2.2 field changes meaning.
**Why:** the Figma v2.0 pages show data that v2.2 has no field for (gaps G1 to G4, G6 and G13 in `W0-reading-report.md`).

## Tiers (build in this order)

| Tier | Items | Why | If it's late |
| --- | --- | --- | --- |
| **Must** | P1 payer view, P2 signed complaints | Privacy (D-166) and security: without P2 anyone could complain about any job and cause refunds and Shark strikes | The delivery and the complaint box only work on mocks |
| **Should** | P3 timeline events + proofs, P4 per-check results (**code checks only**), P6 core: `config`, `owners.proposals` + `ownersWaiting`, `payouts`, `ravenPayoutGas.warnBelow`, `recentJobs` deltas | Cheap: contract views and events Shark already reads. They show the limits, the DAO and where the money went | Those parts of the page show less detail. The schemas require them, so ship them together |
| **Could** | P5 quote status, P6 extras: `auctions` log and `incidents` log | The most backend work. Nice for the demo, not needed for the flow | The schemas treat them as optional: missing logs parse as empty and their panes show SAMPLE |

## P1. Payer view (D-166): `POST /v1/orders/{orderId}/view` · must

**Request:**
```json
{ "accountId": "demo-buyer.testnet", "publicKey": "ed25519:…", "signature": "base64…", "message": "sharkco:view:j_000042:1793521364", "nonce": "base64(32 bytes)", "recipient": "sharkco.testnet" }
```

This is the NEP-413 `signMessage` output.
- Shark checks that the key is an access key of `accountId`, that `accountId` is the payer, and that the timestamp is within 5 min.

**Responses:**
- `200`: the §1.5 order **payer view**.
- `401 payer_signature_invalid`.
- `403 not_payer`.

**Public view:** `GET /v1/orders/{id}` without a signature always returns the **public view**:
- `brief.params`, `delivery.content`, `instructions` and `input.source` are **omitted**.
- `brief` keeps `jobType` and `checklist[].id/kind` only.
- `view: "public" | "payer"` is added to the response.
- The public view may carry `size: { pages, words }` (counts only, never the source), because Figma's public brief shows the size.

**Response headers on the payer view:** `Cache-Control: private, no-store`.

## P2. Complaint with a signature (§1.6) · must

- `POST /v1/orders/{id}/complaint` body = `{ "reason": "…", "auth": <P1 request with message "sharkco:complain:<orderId>:<ts>"> }`.
- Add to §0.2:
  - `401 payer_signature_invalid`
  - `403 not_payer`
  - `409 complaint_closed`

## P3. Timeline events and proofs (§1.5) · should

- `timeline[].event` gains:
  - `quoted`, `paid`, `awarded`, `delivered_for_review`
  - `review_pass`, `review_fail`, `revision_requested`
  - `dispute`, `second_review_pass`, `second_review_fail`, `unresolved`
  - `worker_paid`, `reviewer_paid`
  - `complaint`, `complaint_upheld`, `complaint_rejected`
  - `refund_due`, `refunded`, `finalized`, `needs_review`
- Each event carries optional `tx`, `worker`, `amount` and `round`.
- `auction.reasonHash` holds the reason hash that went on chain.
- `proof.awardTx` holds the award transaction.

## P4. Per-check review results (§1.5) · should

`reviews[].checks = [{ "id": "C1", "pass": true, "detail": "142 words" }, { "id": "M1", "pass": true }]`.
- **`detail` only for code checks** (C ids). Shark computes it with the shared checklist library, so Owl's output stays ≤ 900 bytes.
- Model checks (M ids) carry `pass` only. The pass or fail comes from Owl's `codes`.
- `detail` is short, ≤ 40 chars, and uses no semicolons or dashes (D-170).

## P5. `/v1/prices.recentQuotes[]` · could

Each quote may gain (all optional):
- `status: "paid" | "expired" | "returned"`. Shark never signs a quote outside the band (it reads the floor first), so a bad price only shows up when the contract sends the payment back (`payment_returned`). That's why it is "returned", not "rejected".
- `returnReason: "E_PRICE_BELOW_FLOOR" | "E_PRICE_OUT_OF_BAND" | null`, from the contract's return.
- `tx: string | null`: the payment or return transaction.

## P6. `/v1/company` additions · core should, extras could

```json
{
  "config": { "quoteTtlSecs": 600, "workerCapBps": 5000, "reviewFee": "0.05", "referralBps": 750, "ownerBps": 6000, "dailyBudget": "4.00", "reserveFloor": "12.10", "strikeThreshold": 3, "suspendThreshold": 3, "suspendWindowJobs": 20, "unresolvedTimeoutSecs": 604800, "maxUnresolvedOpen": 2, "complaintWindowSecs": 86400, "bands": { "…": "as /v1/prices types" }, "changedAt": "2026-10-30T09:00:00Z", "changedByProposal": 11, "changeTx": "…" },
  "auctions": [ { "orderId": "j_000045", "jobType": "summary", "price": "0.80", "cap": "0.40", "bids": [ { "worker": "crab", "price": "…", "etaSecs": 0, "state": "busy" } ], "winner": "raven", "reason": "Raven disputed. Second review timed out. Refunded. Fee held.", "outcome": "unresolved" } ],
  "incidents": [ { "at": "…", "orderId": "j_000040", "kind": "complaint_upheld" , "text": "complaint: asked for bullets, brief said paragraph", "strike": true } ],
  "payouts": [ { "at": "…", "to": "raven", "kind": "worker", "amount": "0.18", "chain": "near" , "tx": "…", "held": false } ],
  "owners": { "proposals": [ { "id": 14, "title": "…", "status": "open" | "passed" | "rejected", "at": "…", "votes": "0 of 1" } ], "ownersWaiting": "6.00" },
  "reserve": { "ravenPayoutGas": { "warnBelow": 5 } },
  "recentJobs": [ { "reserveDelta": "0.13", "refund": "0.60" } ]
}
```

Notes on the shape above:
- `bids[].state` is `winner | lost | busy | late | invalid`.
- `auctions[].outcome` is `delivered | dispute_won | unresolved | complaint | refunded | working`.
- `incidents[].kind` is `complaint_upheld | complaint_rejected | dispute | dispute_won | late | brief_invalid | strike`.
- `payouts[].kind` is `worker | reviewer | referral | owner | refund | held`, and `chain` is `near | base`.
- `recentJobs[].reserveDelta` and `recentJobs[].refund` are both nullable.

**Order rules:**
- `auctions`, `incidents`, `payouts` and `proposals` are newest first, with at most 20 entries each.
- `sample` gains the keys `config`, `payouts` and `guardian` (core), and `auctions` and `incidents` (extras, default true when absent).
- **Core (should):** `config`, `owners.proposals`, `owners.ownersWaiting`, `payouts`, `reserve.ravenPayoutGas.warnBelow`, `recentJobs[].reserveDelta` / `refund`.
- **Extras (could):** `auctions`, `incidents`. When they are missing the web treats them as empty lists and shows SAMPLE.

## Not changed
Money stays a decimal string, times stay ISO UTC with `Z`, and the error shape stays §0.1.
