# Shark & Co. — Design handoff (v2.0, the zero-employee agency)

What carries over from the existing Figma, what must be redesigned for the agency, the sample numbers, and the component → code map. The Figma brief is `agent-prompt-figma-v2.0.md`.

- **Figma file:** `VMQqQ1nlXend8pAQO8Ovih`. Foundations `0:1` (tokens, styles, components board `11:15`) are kept. Pages built for the v1 product (Callers, the caller-record parts of Landing / Check a call / The company) are archived, not built.
- **Style:** light page, HelloFugu-style hero, parametric SVG mascots (colour = who, shape/props = state), desktop only (≥ 1024 px).

## 1. Pages for v2.0

| Page | Status | Content |
| --- | --- | --- |
| Foundations | Keep + add | Tokens, 17 text styles, mascots; add **Crab**, worker/reviewer states, new components (§4) |
| **Landing v2.0** | Redesign from Landing v1.0 | Hero (agency pitch), "What we do" (3 job types with examples and price bands), How it works (order → brief → auction → review → delivery), Rules, The auction (bids), Guarantee (revision, refund, dispute), For agents (API snippet), Ledger, CTA, Footer (3 tracks) |
| **Order v2.0** | New (replaces Check a call) | Choose job type → instructions + input (URL / upload / text) → **brief + quote card** → register if needed → pay (testnet faucet / mainnet "pay from another chain" card) → progress |
| **Job v2.0** | New | Timeline, auction, review report with checklist ticks and attestation, delivery (text / JSON / thread view), payouts, complaint button, states board |
| **The company v2.0** | Update | Revenue/costs/profit, reserve and floor, price bands + recent quotes with reasons, **WorkerCards** (Raven, Crab), **ReviewerCard** (Owl), strikes/cage, payouts, proof links, owners & guardian panel |
| Motion spec | Update | New beats (bids slide in, checklist ticks, revision loop) |
| Callers v1.0, Check a call v1.0 | **Archive** | Not built |

## 2. Roles in the UI

| Who | Where |
| --- | --- |
| 🙋 People | Order page; job page (delivery and complaint box only after a NEP-413 signature as the payer, D-166); complaint button |
| 🤖 Bots | "For agents": `POST /v1/orders` → 402 (x402 `PAYMENT-REQUIRED` + signed quote) → retry with `PAYMENT-SIGNATURE` (or pay the quote) → `GET /v1/orders/{id}`; badge "Speaks x402" |
| 🦈 Shark | Brief + price reason on the quote card; auction reason on the job page |
| 🐦‍⬛ Raven / 🦀 Crab | Bids, WorkerCards, payouts (Base / NEAR) |
| 🦉 Owl | Review report, ReviewerCard, attestation links |
| 👤 Owners / 🛡️ Guardian | Read-only panel; "Open in Trezu"; "pause only" |

## 3. Sample numbers (= SRD §8.7; fixtures must match)
- **Bands:** extract 0.30–1.50 · summary 0.20–1.00 · thread 0.50–2.00. Floors 0.20 / 0.12 / 0.24.
- **Sample job:** summary of a 6-page article (`example.com/blog/intents-explained`), ≤ 150 words, must mention "NEAR Intents" and "fees" → price 0.60 ("6 pages, 2 required points"); bids Crab 0.18 (70 s) / Raven 0.24 (45 s) → Crab ("cheaper, 93% first-pass"); review 0.05; referral 0.045; owners 0.195; reserve 0.13.
- **Sample thread:** 5 posts for `@example_brand`, include `https://example.com/launch` and `#NEAR` → 1.20.
- **Sample extraction:** 24 products (name, price, date) from a catalogue page → 0.80.
- **7 days:** 200 jobs, revenue 128.00, workers 38.40, reviews 10.00, referrals 9.60, profit 70.00, owners 42.00 (36.00 paid, 6.00 accrued).
- **Reserve:** daily budget 4.00, floor 12.10, reserve 40.10, Shark wallet 3.10.
- **Workers:** Crab 124 jobs, 93% first-pass, 2 final fails, 1 dispute won, unresolved 0 of 2 · Raven 76 jobs, 89% first-pass, 3 final fails, unresolved 1 of 2, paid on Base Sepolia.
- **Reviewer:** Owl 214 reviews, 3 overturned, review fee 0.05.
- **Mainnet view:** 4 jobs, revenue 3.20, real data only.

## 4. Components

**Keep:** Button, NetworkSwitch (+ caption), NetworkBadge, ProofPill (add kinds `worker-payout`, `review`), StatTile, LedgerRow (job type + worker + status), RuleCard, StepCard, BidRow (worker), AuctionCard, SystemBanner (`closed / paused / caged / no_worker / out_of_budget / rate_limited / upstream_down`), DataSource (LIVE / SAMPLE), PartnerChip, ApiSnippet, TextInput.

**New:**

| Component | Purpose |
| --- | --- |
| `JobTypeCard` | Extract / Summary / Thread: icon, example, price band |
| `OrderForm` | Job type tabs, instructions, input (URL / upload / text), optional params (word limit, must-mention, posts, schema builder) |
| `BriefCard` | Shark's brief: params + checklist (code vs model items) + price + price reason + "what happens if it fails" |
| `ChecklistRow` | One check with state: pending / passed / failed (ink + SVG icons, not green/red) |
| `ReviewReport` | Round, mode (primary/secondary), checklist rows, reason text, attestation link |
| `DeliveryView` | Text, JSON table, or thread preview (posts with character counts) |
| `JobTimeline` | paid → awarded → working → review → delivered / revision / refunded |
| `WorkerCard` | Raven/Crab: payout chain, model, jobs, first-pass %, final fails, disputes, unresolved `n of 2`, eligibility |
| `ReviewerCard` | Owl: reviews, overturned, review fee, attested |
| `ComplaintBox` | 24 h countdown, reason field, result states |
| `PriceBandRow` | Per type: band, floor, recent quote |

**Mascots:** keep Shark, Owl, Raven (drop Fish from product UI; it may stay as a playful 404). **Add 🦀 Crab** (worker): a colour distinct from Shark `#6E8BA8`, Owl `#A86B32`, Raven `#5E5A86` and not green, red or accent blue. States for workers: Bidding, Won, Lost, Working, Delivered, Revising, Paid, Unpaid, Suspended. Owl states: Reviewing, Pass, Fail, Second opinion, Attested.

## 5. Code-side watch-outs
1. Reserve seeded at deploy (16.10 testnet, 2.50 mainnet-lite).
2. Checklist rows, bars and PriceBand markers are computed in code.
3. Thread preview shows weighted character counts (URLs 23).
4. Deliveries are rendered as text, never HTML. The job page is public; the delivery, instructions, source and complaint box appear only in the payer view (D-166, API §1.5).
5. Plex Mono has no ✓ glyph: SVG icons.
6. Sample labels per section; "test USDC" on testnet.

## 6. Component → code map

| Figma | React | Key props / data |
| --- | --- | --- |
| JobTypeCard | `<JobTypeCard>` | `type, band, example` (from `/v1/prices`) |
| OrderForm | `<OrderForm>` | `POST /v1/uploads`, `POST /v1/orders` request |
| BriefCard | `<BriefCard>` | 402 body: `brief`, `price`, `priceReason`, `band`, `floor`, `expiresAt` |
| ChecklistRow / ReviewReport | `<ChecklistRow>` / `<ReviewReport>` | `reviews[]` (codes mapped to checklist ids) |
| DeliveryView | `<DeliveryView>` | `delivery.format`, `delivery.content` |
| JobTimeline | `<JobTimeline>` | `timeline[]`, `status` |
| AuctionCard / BidRow | `<AuctionCard>` / `<BidRow>` | `auction` |
| WorkerCard / ReviewerCard | `<WorkerCard>` / `<ReviewerCard>` | `/v1/company` `workers[]`, `reviewer` |
| ComplaintBox | `<ComplaintBox>` | `complaint`, `POST …/complaint` |
| PriceBandRow | `<PriceBandRow>` | `/v1/prices` |
| SystemBanner | `<SystemBanner>` | `state` / 429 / 502 |
| NetworkSwitch | `<NetworkSwitch>` | `?network=` |
| DataSource | `<DataSource>` | section `sample` flag |
| Mascot | `<Mascot name state size>` | SVGs from `scripts/mascots` |

## 7. Type and colour (unchanged)
Grotesk ExtraBold titles / SemiBold headings / Regular prose; Mono for figures, chips, buttons; no Bold. Heading ladder Hero → XL → L → M → S. 4 pt grid; radius `sm 4 · md 10 · pane 22 · pill 999`. Tokens: bg `#F5F6F8`, surface `#FCFCFD`, surface-2 `#ECEEF2`, tile `#E9EDF2`, line `#DADDE3`, line-strong `#B5BAC4`, ink `#161A22`, muted `#5A606C`, faint `#8B919C`, accent `#2B59FF`, gain `#147A44`, loss `#C2362B`. Green/red = money only.

## 8. Built in Figma (30 Oct) — node map

File `VMQqQ1nlXend8pAQO8Ovih`. v1 pages are below the `——— Archive (v1, not built) ———` divider (D-168).

**Layout rule (30 Oct, owner):** every v2.0 page reuses the structure, effects and motion of its v1 page; only the content changed. Landing keeps v1's 9 slots and the pinned "Watch a receipt print" stage (5 beats: order → pay → hire → review → payout); Order and Job use the v1 Check a call layout (numbered step cards + sticky receipt column + states grid); The company and Motion spec are the v1 pages re-scripted.

| Page | Page id | Frames |
| --- | --- | --- |
| Foundations | `0:1` | Mascots v2.0 `129:860` · Components v2.0 `130:1845` (v1 boards renamed "archived") |
| Landing v2.0 | `129:3424` | Landing `149:3998` (hero `139:3038`, 9 sections, about 6 200 px after compacting) · Receipt storyboard · 5 beats `149:4296` |
| Order v2.0 | `129:3425` | Order desktop `150:3999` (01 order · 02 brief + price · 03 pay · 04 what happened + receipt column) · states (13) `150:4148` · pay step mainnet + Intents `150:4277` |
| Job v2.0 | `129:3426` | payer view `153:5264` (01 brief · 02 auction · 03 review · 04 delivery + complaint · 05 what happened) · public view `153:5994` (delivery locked, no complaint box) · states (14) `153:6714` |
| The company v2.0 | `129:3427` | testnet `154:3972` · mainnet view `154:4322` · system states `154:4587` |
| Motion spec v2.0 | `129:3428` | spec table `155:3522` (adds checklist ticks, revision loop, payout coins) · key frames `155:3814` |

**Components (v2.0):** Mascot v2 sets — Crab `129:1260`, Raven `129:1661`, Owl `129:1911`, Shark `129:2181` (property `State`) · ChecklistRow `130:1884` · ProofPill v2 `130:1927` · JobTypeCard `130:2025` · PriceBandRow `130:2079` · BidRow v2 `130:2227` · BriefCard `131:2218` · ReviewReport `131:2517` · DeliveryView `132:2418` (Text / JSON table / Thread / Locked) · JobTimeline `132:2620` · WorkerCard `135:2605` · ReviewerCard `135:2735` · ComplaintBox `135:2872` · AuctionCard v2 `135:3024` · LedgerRow v2 `135:3224` · SystemBanner v2 `135:3286` · OrderForm `136:3143` · Nav v2 `136:3283` · Footer v2 `136:3299`.

**Notes for code:** Crab = `character/crab/body #E07A5F`, `character/crab/belly #EFA08A` (D-167). State badges sit in the bottom-right slot of each 200×200 mascot. The mainnet copy of The company uses placeholder figures beyond "4 jobs, revenue 3.20"; replace with live values.

**Sea mist (D-171):** component set `162:2913` (Tone=Light, Tone=Dark), 1440×760 halftone fog. Light behind the hero (right side, 70%), Dark in the receipt stage and the CTA (replaces the v1 dither). Code: canvas or shader, noise offset drifts about 8 px/s, static under reduced motion.

**Copy rule (D-170):** no semicolons, em/en dashes, hyphenated words or dash placeholders in UI copy. Technical identifiers are exempt.

**Data sources for Order and Job (checked against API-CONTRACT v2.1):**
- "What happened" rows come from `timeline[]` events (`paid`, `awarded`, `delivered_for_review`, `review_pass`) plus `proof.paymentTx` and `proof.workerPayoutTx`. Times are the event `at` values.
- Checklist row text is UI copy mapped from `brief.checklist[].rule` codes (for example `word_count <= 150` → "Word count is 150 or fewer"); keep that map in the frontend.
- BidRow "first pass" and "unresolved" come from `/v1/company` `workers[]`, not from `auction.bids[]`; the job page needs that second call (cached).
- Countdown on the complaint box = `complaint.allowedUntil`; quote countdown = `expiresAt`.
- New states: Order "Shark is writing your brief" (while `POST /v1/orders` is pending); Job "Loading this job" and "Can't reach Shark" (network or 502, retry every 5 s).
