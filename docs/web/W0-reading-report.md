# W0 reading report — web v2.1 (30 Oct 2026)

**Read:**
- `agent-prompt-frontend-v2.1.md`
- SRD v2.1
- API-CONTRACT **v2.2** (the prompt says v2.1, but the file is v2.2)
- ARCHITECTURE (its header still says SRD v2.0)
- RULES, DECISIONS D-101 to D-171, DESIGN-HANDOFF v2.0 §1 to §8, OPEN-ITEMS
- Figma pages Landing `149:3998`, Order `150:3999`, Job `153:5264`, The company `154:3972`

There is no `README.md` yet.

**Owner's answers (30 Oct):**
- Fill API gaps with a v2.3 proposal (`API-CHANGE-PROPOSAL-v2.3.md`).
- Order step 01 follows the prompt and OrderForm `136:3143`.
- Today's scope is W0 + W1, stopping at G-W1.

## 1. Field map

`/v1/company` is shortened to `company` below. `static` means fixed UI copy. A **v2.3** tag means the field only exists in our proposal.

### Landing `149:3998`

| Slot | Shows | Source |
| --- | --- | --- |
| Nav | network switch, "Testnet · test USDC" | `?network=`, static |
| Hero | headline, partner chips | static |
| Hero | job card (Summary · 150 words, checks, Crab +0.18 · Owl +0.05) | fixture `order-delivered` (SAMPLE) |
| Hero | proof pills | `NEXT_PUBLIC_PROOF_LINKS` (mainnet txs) |
| What we do | 3 cards: band and floor | `/v1/prices` `types.<t>.band`, `floor` |
| What we do | 3 cards: example and "delivered as …" | static |
| How it works | receipt beats 01–05 | static sample (order, pay, hire, review, payout) |
| Rules | 4 rule cards | static |
| Rules | cage meter | `company.strikes.count/threshold` |
| The auction | AuctionCard | sample order `auction` + `company.workers[]` (first pass, unresolved) |
| The auction | Dispute / Unresolved / Refund tabs | static examples |
| The auction | team row | `company.workers[]`, `company.reviewer` |
| For agents | ApiSnippet | static, plus the price from `/v1/prices` |
| Ledger | Revenue, Workers + reviews, Owners' share, Referral payouts | `company.pnl7d.revenue`, `workers + reviews`, `ownersPaid + ownersAccrued`, `referrals` |
| Ledger | 3 rows | `company.recentJobs[]` (orderId, jobType, price, worker, payoutChain, status) |
| Ledger | "+0.13 to reserve" / "−0.60 refunded" | **no source** (G13) |
| CTA, Footer | links | static; env URLs hidden when empty |

### Order `150:3999`

| Step | Shows | Source |
| --- | --- | --- |
| 01 | job type, instructions, source, params, referrer | form → `POST /v1/orders` |
| 01 | upload | `POST /v1/uploads` → `UploadResult` |
| 01 | Detected row (type, source, size, must mention) | 402 `jobType`, `input.source/pages/words`, `brief.params.mustMention` |
| 02 | price | 402 `price` |
| 02 | max words | `brief.params.maxWords` |
| 02 | quote expires | countdown from `expiresAt` |
| 02 | checklist split code / AI | `brief.checklist[].kind`, copy mapped from `rule` |
| 02 | reason | `priceReason` |
| 02 | band | `band` |
| 03 | wallet | wallet account ("refunds go here") |
| 03 | register | `payerRegistered` / `register` |
| 03 | pay | `pay` sent exactly as given |
| 03 | faucet | `/v1/payment-options` `faucet.url` |
| 03 | mainnet Intents card `150:4277` | `intents` |
| 04 | What happened | `GET /v1/quotes/{id}` (3 s), then `/v1/orders/{id}` `timeline[]` + `proof` |
| Receipt column | job card, checks, Owl result, split | the order |
| Receipt column | proof pills | `proof.paymentTx`, `proof.workerPayoutTx`, `reviews[].attestationUrl` |

### Job `153:5264` (payer view) / `153:5994` (public view)

| Step | Shows | Source |
| --- | --- | --- |
| Header | "JOB #0042" | `orderId` (`j_000042` → `#0042`) |
| Header | status line, "23 h left to complain" | `status`, `complaint.allowedUntil` |
| 01 Brief | instructions, source, params | **payer only** (D-166), via the view endpoint (**v2.3**) |
| 01 Brief | brief hash, input hash | `briefHash`, `inputHash` |
| 02 Auction | cap, bids, ETA, state | `auction.cap`, `bids[]` |
| 02 Auction | first pass %, unresolved n of 2 | `company.workers[]` |
| 02 Auction | Shark's pick | `auction.reason` |
| 03 Review | round, mode, pass, attestation | `reviews[]` |
| 03 Review | per-check detail ("142 words", "both found") | **v2.3** `reviews[].checks[]` |
| 04 Delivery | text / JSON / thread | `delivery` (payer only) |
| 04 Delivery | word or character counts | computed in code |
| 04 Delivery | ComplaintBox | `complaint`, `POST …/complaint` + NEP-413 (**v2.3**) |
| 05 What happened | rows | `timeline[]` (payout and refund events are **v2.3**) |
| 05 What happened | links | `proof.*`, `auction` reason hash / award tx (**v2.3**) |

### The company `154:3972`

| Widget | Source |
| --- | --- |
| P&L 7 days tiles | `company.pnl7d`, `reserve.balance`, `strikes` |
| P&L 7 days line | "billed off chain by API key" is static |
| Price pane | `/v1/prices` |
| Price pane: last quote, recent quotes, REJECTED rows | `recentQuotes[]` + **v2.3** `status`, `rejectReason` |
| Owner limits | **v2.3** `company.config` + `configChangedBy` |
| Auctions: latest, log | **v2.3** `company.auctions[]` |
| Auctions: "How Shark picks" | static |
| Workers, reviewer | `company.workers[]`, `company.reviewer` |
| Strikes, complaints and disputes log | `strikes` + **v2.3** `company.incidents[]` |
| Reserve: balance, floor, Shark wallet, daily budget | `company.reserve` |
| Reserve: review fee in formula | **v2.3** `config.reviewFee` |
| Raven gas | `reserve.ravenPayoutGas` + **v2.3** `warnBelow` |
| Owners and guardian | `company.owners`, `company.guardian` |
| Owners: proposal status and date | **v2.3** `owners.proposals[]` |
| Owners: owners' share waiting | `pnl7d.ownersAccrued` |
| Payouts list | **v2.3** `company.payouts[]` |
| 7 day split | `pnl7d` |
| Review proofs | **v2.3** `recentJobs[].attestationUrl` (already there) |
| LIVE / SAMPLE chips | `company.sample.<section>` (keys added in v2.3) |

## 2. Gap list

| # | Gap | Proposed handling |
| --- | --- | --- |
| G1 | `/v1/company` lacks config, the auction log, payouts, the incidents log, proposal status, and rejected quotes in `recentQuotes` | v2.3 proposal |
| G2 | D-166 payer view has no endpoint, no public vs payer shape, and complaints carry no signature. `401 payer_signature_invalid` and `409 complaint_closed` are missing from §0.2 | v2.3 proposal |
| G3 | `timeline[].event` names exist only for paid, awarded, delivered_for_review and review_pass. Figma also shows payouts, and the states need revision, refund, dispute and complaint. There is no award tx or reason hash | v2.3 proposal (event enum + `proof.awardTx`, `auction.reasonHash`) |
| G4 | Per-check review detail ("142 words") has no source | v2.3 `reviews[].checks[{id, pass, detail}]` |
| G5 | Figma copy left over from v1: Order 01 "Post URL or text", receipt "CHECK ANOTHER", Job nav highlights "ORDER" | Code uses "Order another" and no active nav link on Job. Owner to confirm |
| G6 | "Warning below 5 payouts" has no field | v2.3 `ravenPayoutGas.warnBelow` |
| G7 | CORS lists `localhost:3000`; our dev port is 3100 | Ask the backend to add 3100 (same as v1) |
| G8 | Version drift: prompt says API v2.1, the file is v2.2; ARCHITECTURE cites SRD v2.0 | Build on v2.2 + v2.3 |
| G9 | RULES.md is partly v1: §4.9 `no_auditor`, §4.14 reads/seed jobs, §6.1 "Not investment advice", §6.2/§6.11 callers, §7.2 Figma "in place" | Owner to update RULES. The web follows the prompt's §1 rules |
| G10 | No Crab in `scripts/mascots.js` | Export the mascot SVGs from Figma sets `129:1260`, `129:1661`, `129:1911`, `129:2181` |
| G11 | Prompt asks for MSW; v1 uses an injected mock fetch through the same client | Keep ours: no new dependency, same parse path |
| G12 | The rule → copy map has only summary examples; extract and thread rule strings aren't listed | Derive them from SRD §8.2; flag them for the backend to confirm the exact `rule` strings |
| G13 | Ledger row deltas ("+0.13 to reserve", "−0.60 refunded") have no field in `recentJobs[]` | v2.3 `recentJobs[].reserveDelta` / refund amount, or compute it from `money` |
| G14 | `deposit: "1"` for `ft_transfer_call`, plus gas | O-18 open; the web sends what the 402 says |

## 3. Plan W1–W6 (changes from the prompt)

- **W1 (today):**
  - Rework the v1 prototype in place. Keep the scaffold, network, client pattern, money helpers, hero shader and UI primitives.
  - Replace the schemas and fixtures with v2.2 + v2.3, rewrite the mock scenarios (28), and drop the Callers and Check pages.
  - Add the Crab tokens, `<Mascot name state>` from Figma exports, and the v2 components in `/dev/components`, plus a copy lint test.
  - **Wallet Selector is deferred to W3.** The mock wallet gains `signMessage`.
  - Stop at G-W1.
- **W2:** Landing on the 9 slots, Sea mist, the receipt stage.
- **W3:** Order.
- **W4:** Job (public and payer views, NEP-413 on a mock wallet).
- **W5:** The company.
- **W6:** live testnet, only after G5 and the owner's yes.
- **No git until 1 Nov 07:00 WIB.** Then one honest import commit (D-163).

## 4. Found while building W1 (30 Oct)

| # | Gap | Handling |
| --- | --- | --- |
| G15 | Figma copy itself breaks D-170 in a few places: ComplaintBox "24-hour window", JobTimeline "7-day timeout" | Code writes "24 hour", "7 day". Owner: fix in Figma or confirm |
| G16 | Figma ComplaintBox "Upheld" names a specific reason ("you asked for bullet points…"), which has no field in the API | Code uses the general line "the brief didn’t match your order". Could come from `reviews[mode=complaint].reasons` |
| G17 | Sample delivery text in Figma is 90 words, but its review says "142 words" | Sample only. Live data comes from Owl |
| G18 | Hero partner chips "swap the headline by typewriter", but Figma has no swap text | Code types a short line into the third headline line ("any chain.", "AI brains.", "TEE checks.", "Base payouts.", "owner rules.") and gives each chip a full line for screen readers. Owner to confirm the copy |
| G19 | The Landing auction "Refund" tab has no Figma frame (Unresolved is a hidden frame, 149:4205) | Refund example drafted from SRD FR-44 |
| G20 | Step bodies for receipt beats 01, 02, 04 and 05 aren't in Figma (only 03 is) | Drafted from the SRD. Beat 05's split shows as one line, "0.37 to referrer, owners, reserve", so it fits |
| G21 | `422 brief_infeasible` has no list of fixes (Figma shows "Raise the limit to 300 words +0.20", "Keep 4 required points") | Code offers fixes the SRD feasibility rule implies (raise the word limit, halve the must mention list, edit) without a price delta. The API could add `details.fixes[]` |
| G22 | `/jobs/{id}` doesn't exist until W4, but Order links to it after payment | The link is in place now and resolves once W4 lands |
| G23 | The Figma intents card shows a chain picker and amount before a deposit exists, but API §1.2 only returns `intents` when `payWith` and `refundTo` were sent | Code asks for the chain and a refund address, re-posts the order with `payWith` and `refundTo`, then shows the deposit address, amount and timer |
| G24 | The Figma public view shows the size ("6 pages · 3 120 words"), "2 phrases" and full check labels, but D-166 allows only the job type and check ids | Added an optional public `size: {pages, words}` to proposal P1. Public check rows read "Checked by code" or "Checked by AI". Must mention shows "private". Owner to confirm what is public |
| G25 | Figma "Can't reach Shark" retries every 5 s, but there is no API signal for "the job doesn't exist" (the mock returns 400) | The page treats 400 as "No such job" and anything else as unreachable. The API could add `404 order_not_found` |
| G26 | Figma's company page says "7-DAY SPLIT", which breaks D-170 | Code says "7 day split" |
| G27 | Mainnet company numbers beyond "4 jobs, revenue 3.20" are Figma placeholders (DESIGN-HANDOFF §8) | The mock derives the rest. Live mainnet replaces them in W6 |

## 5. Decisions (30 Oct)
- **v2.3 proposal agreed in tiers** by the owner:
  - **Must:** P1, P2.
  - **Should:** P3, P4, P6 core.
  - **Could:** P5, P6 extras.
- **Two changes came with it:**
  - P4 `detail` covers code checks only (model checks are pass or fail).
  - P5 says `returned` with a `returnReason` instead of `rejected`, because Shark never signs an out of band quote. Only a payment the contract sends back shows a bad price.
- **The web now tolerates the "could" tier being late:** `auctions`, `incidents` and the P5 fields are optional in the schemas.
- **Owner's next step:** log this in `DECISIONS.md` as a new D-17x entry.
