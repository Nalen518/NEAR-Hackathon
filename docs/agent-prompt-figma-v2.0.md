# Prompt for the design agent — Shark & Co. v2.0 (the zero-employee agency)

Paste everything below the line into the design agent. Attach `shark-co-SRD.md` (v2.0), `DESIGN-HANDOFF.md` (v2.0) and `API-CONTRACT.md` (v2.0).

---

## Role and goal
You are the product designer for **Shark & Co.**, a solo NEAR Hackathon project (build 1–14 Nov 2026). The product has **changed**: it is now **an agency with zero employees**. Shark, an AI CEO, takes small jobs from people and bots (data extraction, summaries, X threads), writes a checkable brief, prices it, auctions it to worker agents (🐦‍⬛ Raven, 🦀 Crab), has 🦉 Owl review the delivery, and pays everyone across chains. If the work fails review, the customer gets their money back.

Reuse the existing brand, tokens, text styles and components. Redesign the pages for the new product. Desktop only (≥ 1024 px).

- Figma: `VMQqQ1nlXend8pAQO8Ovih` (Foundations `0:1`, components `11:15`)
- Spec: SRD v2.0 §1.2–1.3, §5, §8.2–8.3, §8.7; DESIGN-HANDOFF v2.0 §1, §3, §4

## Brand rules (unchanged)
- Colour = **who**; shape and props = **state**; readable in grayscale at 48 px.
- Green `#147A44` / red `#C2362B` = **money up/down only**. Review fails, strikes, limits and system states use ink or accent `#2B59FF`.
- Keep tokens, the 17 text styles, the heading ladder (Hero → XL → L → M → S), 4 pt grid, radii, mascot construction. No Bold. SVG check icon (Plex Mono has no ✓).
- Examples use made-up brands and handles only (`@example_brand`, `example.com`). Testnet money says "test USDC". Non-live numbers say **Sample**.

## Working rules
- Archive the v1 pages (Callers, Check a call, the caller-record sections). Build v2.0 pages as **new pages**; keep Foundations/Components separate.
- After each task, screenshot and check against its **Accept** line.
- Use exactly the sample numbers in DESIGN-HANDOFF §3.

## Tasks

### T1 — Crab and agent states (Foundations)
1. **🦀 Crab** (new worker): same construction as the other mascots; a body colour distinct from Shark `#6E8BA8`, Owl `#A86B32`, Raven `#5E5A86`, and not green, red or accent blue. One signature prop (e.g. a clipboard or tiny laptop).
2. **Worker states** (Raven and Crab): Bidding (price tag), Won, Lost (muted), Working, Delivered, Revising (pencil), Paid (coin), Unpaid (empty pocket, ink), Suspended (lock).
3. **Owl states:** Reviewing (magnifier), Pass (SVG check stamp), Fail (cross stamp, ink), Second opinion (two pairs of glasses), Attested (seal).
4. **Shark states:** Briefing (clipboard), Pricing (price tag), Hiring (two bids), Caged (keep).
**Accept:** every state is readable in grayscale at 48 px; no green/red outside money.

### T2 — New components (DESIGN-HANDOFF §4)
`JobTypeCard`, `OrderForm` (tabs Extract / Summary / Thread; URL · upload · paste text; optional params: word limit, must-mention chips, post count, must-include chips, schema builder rows), `BriefCard` (params, checklist split into "checked by code" and "checked by AI", price + reason, "if it fails: one revision, then your money back"), `ChecklistRow` (pending / passed / failed), `ReviewReport`, `DeliveryView` (text / JSON table / thread preview with weighted char counts), `JobTimeline`, `WorkerCard`, `ReviewerCard`, `ComplaintBox` (24 h countdown), `PriceBandRow`. Update `LedgerRow` (job type, worker, status), `BidRow` (worker), `ProofPill` (+ `worker-payout`, `review`), `SystemBanner` (`no_worker` replaces `no_auditor`).
**Accept:** each component has all its states as variants.

### T3 — Landing v2.0
1. **Nav:** wordmark; links Order · How it works · For agents · The company; `NetworkSwitch` (Testnet selected); CTA "Order a job".
2. **Hero:** "An agency with zero employees." Lede: "Shark takes your order, hires an AI worker, has the work checked, and pays everyone. If it fails the check, you get your money back." CTAs "Order a job" / "For agents ↗". Proof pills → mainnet txs ("Proof on mainnet ↗"). Partner chips: NEAR Intents · NEAR AI · OutLayer · Chain Signatures · Trezu.
3. **What we do:** three `JobTypeCard`s with example orders and price bands.
4. **How it works (5 beats):** order → brief & quote → auction → review → delivery & payouts.
5. **The guarantee:** revision → refund → dispute → complaint, in plain words.
6. **The auction:** AuctionCard (Crab 0.18 vs Raven 0.24) + WorkerCards + ReviewerCard.
7. **For agents:** ApiSnippet (`POST /v1/orders` → 402 → `ft_transfer_call` → `GET /v1/orders/{id}`).
8. **Rules:** 4 RuleCards: "Your money never touches the AI" · "Shark prices inside the owners' bands" · "Workers are paid only when the work passes" · "Three strikes, then the cage".
9. **Ledger** (sample) + CTA + Footer (three track chips).
**Accept:** no influencer, call or verdict wording anywhere.

### T4 — Order v2.0 (new page)
Frames: (a) empty form; (b) filled summary order; (c) **brief + quote** card (sample job, price 0.60, reason, countdown); (d) registration step; (e) testnet pay (NEAR wallet + "Get test USDC" faucet); (f) mainnet pay with the optional "pay from another chain" card; (g) progress (paid → hiring → working → reviewing).
States board: refused (`job_refused`), input unreadable, too large, brief infeasible (with the reason), 503 (each reason), 429, 502, payment returned. Each says "Nothing was charged" where true.
**Accept:** the customer always sees the brief and the price before paying.

### T5 — Job v2.0 (new page)
Frames: delivered summary (timeline, auction, ReviewReport with ticks + attestation, DeliveryView, payouts, ComplaintBox); revision then pass; refunded after two fails; dispute overturned; unresolved (delivery withheld, refunded); complaint upheld (refund + "Shark got a strike"); `needs_review`; thread delivery; extraction delivery (JSON table).
**Accept:** every state says what happened to the money in one line.

### T6 — The company v2.0
Revenue/costs/profit (7 days), reserve + floor (formula "3 × daily budget + 2 × review fee") + Raven payout gas, PriceBandRows with recent quotes and reasons, WorkerCards (Crab, Raven), ReviewerCard (Owl), strikes/cage meter, payouts with chains, proof links, owners & guardian panel (read-only, "Open in Trezu", guardian "pause only"), DataSource chip on every pane. Plus a smaller **Mainnet selected** copy (4 real-looking jobs) and the SystemBanner states.

### T7 — Motion
Bids slide in (stagger), winner highlight, checklist ticks one by one, revision loop, payout coins. Off under reduced motion; no information only in motion.

## Definition of done
- Pages: Landing v2.0, Order v2.0, Job v2.0, The company v2.0; v1 pages archived.
- Crab + all agent states; all new components with variants.
- No influencer/call/verdict wording; green/red only for money; "test USDC" on testnet frames; Sample labels.
- **Report back:** node IDs of new pages, frames and components; screenshots; open questions.

## Out of scope
Code, mobile layouts, changing the type scale or existing character colours, real brands or people.
