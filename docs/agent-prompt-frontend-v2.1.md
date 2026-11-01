# Prompt for the coding agent — Shark & Co. web app v2.1 (Landing → Order → Job → The company)

> Paste everything below the line into the coding agent. Written 30 Oct 2026 against SRD v2.1, API-CONTRACT v2.1, ARCHITECTURE v2.0, RULES v2.0, DECISIONS (D-101 to D-171), DESIGN-HANDOFF v2.0 §8 and the Figma v2.0 pages as rebuilt on the v1 layouts. **Replaces** `agent-prompt-frontend-v2.0.md` and every earlier frontend prompt.

---

## 0. What you are building
**Shark & Co.** is an agency with zero employees. People and bots order small jobs: **data extraction**, **summary**, **X thread**. Shark (an AI CEO) writes a checkable brief and a price, hires a worker agent (🦀 Crab, paid on NEAR, or 🐦‍⬛ Raven, paid on Base) by sealed auction, and 🦉 Owl checks the work inside an OutLayer TEE. A fail gets one revision, then a full refund.

You build **`apps/web`** (Next.js), desktop and laptop only (≥ 1024 px), four pages plus a dev gallery:

| Route | Figma page / frame | Layout source |
| --- | --- | --- |
| `/` Landing | Landing v2.0 `129:3424` → frame `149:3998`, receipt storyboard `149:4296` | v1 Landing (9 slots, pinned receipt stage) |
| `/order` | Order v2.0 `129:3425` → `150:3999`, states `150:4148`, mainnet pay `150:4277` | v1 Check a call (numbered step cards + sticky receipt column) |
| `/jobs/[id]` | Job v2.0 `129:3426` → payer view `153:5264`, public view `153:5994`, states `153:6714` | Same step card + receipt layout |
| `/company` | The company v2.0 `129:3427` → testnet `154:3972`, mainnet `154:4322`, system states `154:4587` | v1 The company |
| `/dev/components` | Foundations `0:1` → Components v2.0 `130:1845`, Mascots v2.0 `129:860` | — |
| Motion | Motion spec v2.0 `129:3428` → table `155:3522`, key frames `155:3814` | v1 Motion spec |

Figma file `VMQqQ1nlXend8pAQO8Ovih`. Pages below "Archive (v1, not built)" are **not** to be built. One app serves both deployments: nav switch `Testnet | Mainnet`, opens on Testnet, `?network=`.

Work in phases and **stop at every gate** to report to the owner.

## 1. Hard rules

| # | Rule |
| --- | --- |
| 1 | **No pushing**, no remotes, nothing public. Local commits only (Conventional Commits) |
| 2 | **Repo history starts 1 Nov 2026 07:00 WIB** (00:00 UTC). Before that: reading and sandbox only, no `git init`. Then one honest initial import commit, then real commits. Never fake dates or stage fake "daily" commits |
| 3 | **Never sign, spend or deploy.** The user signs in their own wallet. Every test payment needs the owner's explicit yes, each time |
| 4 | No secrets in the repo. `.env.example` lists names only. Secret scan before every commit |
| 5 | **Money is never a float**: decimal strings in HTTP, `bigint` base units (6 dp) in code |
| 6 | Green `#147A44` / red `#C2362B` only for money moving. Review results, strikes, limits, network and system states use ink or accent `#2B59FF` |
| 7 | **Copy rule (D-170):** no semicolons, no em or en dashes, no hyphenated words, no dash placeholders in any UI string you write. Ranges read "0.20 to 1.00", empty cells read "none". Exempt: technical identifiers (account names, URLs, header names like `PAYMENT-REQUIRED`, `NEP-413`, error codes) and the minus sign on money (−0.60). Copy Figma text exactly |
| 8 | Testnet money is "test USDC". Non-live sections show a **SAMPLE** chip. Made-up brands only (`@example_brand`, `example.com`) |
| 9 | Customer instructions, inputs and deliveries render as **plain text, never HTML** |
| 10 | Motion off under `prefers-reduced-motion`. No information carried only by motion |
| 11 | Sources of truth: contract for money and state, API-CONTRACT for shapes, SRD for behaviour, Figma for layout and copy. If they disagree, **don't guess**: add it to the gap list and ask |
| 12 | Pin dependency versions with a one-line reason each. Log design decisions in `DECISIONS.md` before code depends on them |

## 2. Phase W0 — Read and report (no code)
Read in this order: `README.md` → SRD v2.1 (§1.2, §1.3, §5, §8.2–8.3, §8.7, §9) → API-CONTRACT v2.1 (§0, §1.1–1.13, §4) → ARCHITECTURE §2, §9 → RULES → DECISIONS (D-101 to D-171, especially D-152 x402, D-166 payer only delivery, D-169 v1 layouts, D-170 copy rule, D-171 sea mist) → DESIGN-HANDOFF (all, §8 has node IDs and data source notes) → the Figma frames in §0.

Deliver `docs/web/W0-reading-report.md`:
1. **Field map:** every number, label and state on the four pages → endpoint and field, or "static copy", or "no source".
2. **Gap list:** where Figma, SRD and API disagree or a value has no source.
3. **Plan** for W1–W6 with any changes (options, pros and cons, recommendation).

**→ Gate G-W0.**

## 3. Phase W1 — Scaffold, types, mocks, design system

| Choice | Pick | Why |
| --- | --- | --- |
| Framework | Next.js App Router, TypeScript strict | Vercel |
| Styling | Tailwind v4, tokens as CSS variables | 1:1 with Figma variables |
| Fonts | `next/font/google`: Schibsted Grotesk 400/600/800, IBM Plex Mono 400/500/600, Patrick Hand 400 | Self hosted |
| Data | TanStack Query | Polling, cache per network |
| Schemas | zod in `packages/shared` | From the API contract |
| Wallet | NEAR Wallet Selector (NEAR wallets only), incl. `signMessage` for NEP-413 | Payment + payer view |
| Mocks | MSW | Same client for mocks and live |
| Motion | CSS + a small hook for the pinned stage; canvas for the sea mist | No heavy libs |
| Tests | Vitest + Playwright | — |

**`packages/shared`:** zod schemas for every shape in API-CONTRACT §1: `UploadResult`, `OrderRequest`, `Quote402` (brief, priceReason, band, floor, quote, sig, pay, payerRegistered, register, intents, expiresAt), `X402PaymentRequired` (decoded header, for the For agents snippet only), `QuoteStatus`, `Order` **public view and payer view** (D-166), all 13 statuses, `timeline`, `auction`, `reviews`, `delivery`, `money`, `complaint`, `refund`, `proof`; `ViewRequest` (NEP-413), `ComplaintRequest` (reason + auth), `Prices`, `PaymentOptions`, `Company`, `Health`, error shape + full error code union (incl. `401 payer_signature_invalid`, `402 x402_*`). Params per job type (§4.1). Money helpers `toBase`, `fromBase`, `formatUsdc({network})`, `bpsToPct`, unit tested, no floats. Fixtures from the API examples and DESIGN-HANDOFF §3 under `fixtures/api/`, each passing its schema.

**Network config:** `NEXT_PUBLIC_TESTNET_*` / `NEXT_PUBLIC_MAINNET_*`, `NEXT_PUBLIC_API_MODE=mock|live`, `NEXT_PUBLIC_PROOF_LINKS`. Dev only `?mock=<scenario>`: `quoting`, `refused`, `infeasible`, `unreadable`, `too_large`, `paused`, `caged`, `no_worker`, `out_of_budget`, `rate_limited`, `upstream_down`, `returned`, `unregistered`, `working`, `reviewing`, `revision`, `refunded`, `dispute`, `disputed_overturned`, `unresolved`, `complaint_review`, `complaint_upheld`, `complaint_rejected`, `finalized`, `needs_review`, `job_loading`, `job_unreachable`, `public_view`.

**Tokens:** bg `#F5F6F8`, surface `#FCFCFD`, surface-2 `#ECEEF2`, tile `#E9EDF2`, line `#DADDE3`, line-strong `#B5BAC4`, ink `#161A22`, muted `#5A606C`, faint `#8B919C`, accent `#2B59FF`, gain `#147A44`, loss `#C2362B`. Characters: shark `#6E8BA8`, owl `#A86B32`, raven `#5E5A86`, **crab `#E07A5F` / belly `#EFA08A`**. Radius `sm 4 · md 10 · pane 22 · pill 999`. 4 pt grid. Text styles exactly as Figma Foundations: Display Hero 92 · XL 72 · L 40 · M 24 · S 18; Body 16 / 14; Mono Lede 17, Data 14, Label 11 upper, Small 12, Chip 10 upper, Button 13 upper; Figure L 40 / M 18; Hand Eyebrow 22; Wordmark 18. **No text below 10 px**, never scale a component to fit; let it reflow.

**Mascots:** `<Mascot name="shark|owl|raven|crab" state=… size>` from parametric SVGs in `scripts/mascots`, matching Figma sets Crab `129:1260`, Raven `129:1661`, Owl `129:1911`, Shark `129:2181`. The state is the badge in the bottom right slot; body colour never changes.
- Workers (Crab, Raven): Idle, Bidding, Won, Lost, Working, Delivered, Revising, Paid, Unpaid, Suspended.
- Owl: Idle, Reviewing, Pass, Fail, Second opinion, Attested.
- Shark: Idle, Briefing, Pricing, Hiring, Strikes 1, Strikes 2, Caged.

**Components** on `/dev/components` (Figma IDs in DESIGN-HANDOFF §8): Nav v2 (active link per page), Footer v2, JobTypeCard, OrderForm, BriefCard, ChecklistRow, ReviewReport, DeliveryView (Text, JSON table, Thread with weighted counts, Locked), JobTimeline, AuctionCard v2, BidRow v2, WorkerCard, ReviewerCard, ComplaintBox, PriceBandRow, LedgerRow v2, ProofPill v2, SystemBanner v2, StatTile, RuleCard, ApiSnippet, NetworkSwitch, DataSource, PartnerChip, TextInput, Button, **SeaMist** (`162:2913`, tones Light and Dark), Receipt (paper, torn edge, printer slot, print line).

**→ Gate G-W1:** typecheck, lint and tests green; gallery screenshots next to Figma Foundations.

## 4. Phase W2 — Landing (on mocks)
Build the 9 slots of Landing `149:3998` in this order, copy exactly:
1. **Nav** (Landing variant) with NetworkSwitch and "Order a job".
2. **Hero:** halftone fin + sea (port `spikes/hero-shader`, WebGL, ≤ 30 fps, DPR ≤ 1.5, pauses off screen), **Sea mist light** on the right, orbit rings, headline lines blur in (stagger 0/100/200 ms), the job card flips in then bobs, partner chips swap the headline by typewriter on hover, proof pills link to mainnet txs (`NEXT_PUBLIC_PROOF_LINKS`).
3. **What we do:** 3 JobTypeCards from `/v1/prices`.
4. **How it works · "Watch a receipt print":** left rail of 5 steps, right **pinned stage** (`position: sticky; top: 96px`) with Sea mist dark and a receipt that prints one block per beat as the user scrolls (one beat per 100vh): 01 order, 02 pay, 03 hiring (bid rows, winner inks in), 04 review (Owl reviewing → pass, check lines tick), 05 payout (DELIVERED stamp thuds 1.3 → 1, payout lines print). Storyboard frame `149:4296` shows each beat. Reduced motion: fully printed receipt + numbered list.
5. **Rules:** 4 RuleCards + compact cage meter (strikes from `/v1/company`, cage drops bar by bar, ink only).
6. **The auction:** AuctionCard v2 (bids slide in, winner highlight), tabs **Dispute / Unresolved / Refund** with one example visible, team row (WorkerCard Crab, WorkerCard Raven, ReviewerCard Owl) from `/v1/company`.
7. **For agents:** ApiSnippet (x402 flow) + 4 points in a 2×2 grid + "Read the API docs".
8. **Ledger:** 4 StatTiles + 3 LedgerRows from `/v1/company` (SAMPLE chip while `sample.recentJobs` is true).
9. **CTA** with Sea mist dark + **Footer** (three track chips, hide links whose env var is empty).

Every data section: skeleton while loading. On error: the static copy plus a SAMPLE chip.
**→ Gate G-W2:** screenshots at 1440 and 1280 on both networks; Lighthouse desktop perf ≥ 85, a11y ≥ 95; reduced motion run.

## 5. Phase W3 — Order (on mocks)
Layout of `150:3999`: big uppercase title "ORDER A JOB", left column of numbered step cards, right **sticky receipt column** (job card that fills in as the order progresses, proof pills, actions).

| Step card | Content | Data |
| --- | --- | --- |
| 01 The order | Job type, instructions (≤ 2 000 chars), source: URL, upload (`POST /v1/uploads`, ≤ 2 MB, show pages and words) or pasted text, optional params per type, optional referrer. Detected row: job type, source, size, must mention | Request + `UploadResult` + 402 `input` |
| 02 The brief and the price | Price, max words, quote countdown, Shark's reason, band, the guarantee line; checklist rows split "checked by code" and "checked by AI" | 402 `price`, `priceReason`, `band`, `floor`, `expiresAt`, `brief.checklist` |
| 03 Pay | Connected NEAR wallet ("refunds go here"), register step if `payerRegistered` is false (send `register` exactly), faucet button (`/v1/payment-options`), pay button (send `pay` exactly: method, args, gas, deposit). Mainnet: "Pay from another chain" card (`payWith` + `refundTo` → deposit address, amount, timer) per `150:4277` | 402 `pay`, `register`, `intents` |
| 04 What happened | Rows from `timeline[]` events with times and proof links | `GET /v1/quotes/{id}` (3 s) then `/v1/orders/{id}` |

On `PAID` link to `/jobs/{orderId}`. Checklist row text is copy mapped from `brief.checklist[].rule` codes; keep that map in one file. Every state in the states frame `150:4148` (14 cards) must be reachable via `?mock=`, each with its "your money:" line:

| Response | Screen |
| --- | --- |
| `POST /v1/orders` pending | "Shark is writing your brief" (QUOTING) |
| 400 / 413 | Inline field error, "Nothing was charged" |
| 422 `job_refused` / `input_unreadable` / `brief_infeasible` | Card with the reason and the fix (infeasible offers fixes, Shark re quotes) |
| 503 (5 reasons) / 429 / 502 | SystemBanner v2 + "Nothing was charged" (`Retry-After` shown) |
| quote `RETURNED` / 410 | "Payment returned", money back line |

**→ Gate G-W3:** every state reachable; Playwright: fill → 402 → mock paid → job page.

## 6. Phase W4 — Job page (on mocks)
Layout of `153:5264`: title "JOB #0042", step cards **01 The brief · 02 The auction · 03 The review · 04 The delivery (+ ComplaintBox) · 05 What happened**, sticky receipt column on the right. Poll `GET /v1/orders/{id}` every 5 s until final (60 s while `unresolved`).

**Privacy (D-166):** the page is public. Without a payer signature render the **public view** `153:5994`: brief shows job type and check ids only, source and instructions read "private", DeliveryView `Locked`, no ComplaintBox, receipt button "Sign in to view". "Sign in to view" asks the connected wallet to sign the NEP-413 message `sharkco:view:<orderId>:<unix ts>` and calls `POST /v1/orders/{id}/view`; on success render the **payer view**. Complaints send the same kind of signature. Never cache the payer view for other visitors or in shared caches.

Data notes: "What happened" = `timeline[]` (`paid`, `awarded`, `delivered_for_review`, `review_pass`, …) + `proof.paymentTx`, `proof.workerPayoutTx`; BidRow first pass % and unresolved come from `/v1/company` `workers[]` (cache it); complaint countdown = `complaint.allowedUntil`; "MONEY" lines come from `money` and `refund`.

States frame `153:6714` (16 cards + thread and extraction deliveries), all via `?mock=`: loading, can't reach Shark (retry every 5 s), working, reviewing, revision, refunded after two fails, second opinion, fail overturned, unresolved, complaint under review, complaint upheld (refund + "Shark got a strike"), complaint not upheld, finalized, needs review ("A payment step is being checked by hand. Your money is safe.").
**→ Gate G-W4:** screenshots of every state, public and payer views; Playwright flow on mocks including the NEP-413 sign step (mocked wallet).

## 7. Phase W5 — The company (on mocks)
Rebuild `154:3972` from `GET /v1/company` and `/v1/prices`: header with LIVE OR SAMPLE chips per widget, P&L 7 days (+ "inference billed off chain by API key" note), price pane (last quote marker on its band, recent quotes with reasons and REJECTED rows), owner limits list, auctions (latest AuctionCard v2, "How Shark picks" list, log), workers and reviewer cards + strikes and complaints log, reserve (floor bar, formula, Raven payout gas with a warning below 5 payouts), owners and guardian panel (read only, proposals, "Open in Trezu", guardian "pause only"), payouts and 7 day split bars (ink only), review proofs. Mainnet view `154:4322` uses real data only. System states `154:4587` show SystemBanner v2 under the nav.
**→ Gate G-W5:** screenshots on both networks and every banner state.

## 8. Motion (applies in W2–W5)
Follow Motion spec v2.0 `155:3522` and key frames `155:3814`. Global: fast 180 ms, base 280 ms, slow 600 ms, ease out quart `cubic-bezier(0.25,1,0.5,1)`, expo out `cubic-bezier(0.16,1,0.3,1)`, stagger 120 ms, at most one moving thing per pane. Beats: hero headline, halftone fin, partner typewriter, receipt prints itself, job card flip and bob, live dot, proof pills pop, cage drop, numbers tick up, bid rows slide in, winner highlight, second opinion flip, **checklist ticks**, **revision loop**, **payout coins** (green only for money moving), price marker slides, quote rejected nudge, new log row, payout sent, unresolved padlock, network switch, payment returned. **Sea mist** drifts slowly (noise offset about 8 px/s, ≤ 30 fps, pauses off screen). Under `prefers-reduced-motion` everything shows its end state and nothing pins.

## 9. Phase W6 — Live testnet
Only after ROADMAP G5 and the owner's go: `NEXT_PUBLIC_API_MODE=live`. Live responses must parse (a parse failure is a contract bug: report it). SAMPLE chips disappear where live. With the owner's yes each time: faucet → order a summary → pay in the owner's wallet → watch it deliver → sign in as payer → one complaint. Mainnet view: read only checks unless the owner says otherwise.
**→ Gate G-W6:** endpoint → schema pass or fail table; end to end tx hashes. Feature freeze 10 Nov 23:59 UTC.

## 10. Quality bar
Strict types (no `any` in money or API code); money unit tests; every error code has a UI mapping; WCAG 2.1 AA, visible focus, keyboard reachable tabs and pinned stage; reduced motion run; 1440 and 1280 px, no horizontal scroll down to 1024; external links `rel="noopener noreferrer"`; customer text and deliveries rendered as text; a copy lint check in CI that fails on `;`, `—`, `–` and hyphenated words in UI strings (allow list for technical identifiers).

## 11. Out of scope
Phone layouts; owner console; EVM wallets; posting to X; image or code jobs; contract, Shark, worker or reviewer code; pushing or deploying; anything on the archived v1 pages.
