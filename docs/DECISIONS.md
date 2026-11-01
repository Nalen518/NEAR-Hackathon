# Shark & Co. — Decision log (v2.1)

The decisions behind the **zero-employee agency** (30 Oct 2026). IDs start at D-101 so they never collide with the retired v1 log. To change a decision, add a new entry that supersedes it.

**Status:** Accepted · Open (in `OPEN-ITEMS.md`).

---

## A. Product

| ID | Decision | Why | Cost |
| --- | --- | --- | --- |
| D-101 | **Product = Shark & Co., the zero-employee agency.** An AI company that sells small jobs to people and bots, hires worker agents to do them, has them independently reviewed and pays everyone across chains | Fits "the company of one. Or none" literally; sells something people already buy (Fiverr-style jobs); no dependence on X or real people's reputations; no overlap with KOLlateral | A pivot two days before the build; Figma needs a new brief |
| D-102 | **Launch job types: data extraction, summary, X thread** | All three have checkable briefs; extraction suits bots, summary suits anyone, threads make the demo relatable | Images, code and translation are out (translation is the easy 4th if time allows) |
| D-103 | **Deliver text/JSON only; never post on anyone's behalf** | Avoids impersonation and account risk | — |
| D-104 | **Safety filter before quoting** (scams, harassment, impersonation, spam, sexual content involving minors, malware, personal-data harvesting) → `422 job_refused`, no charge | Responsible by default | Some false refusals |
| D-105 | **Customers are people and bots**; refund guarantee is the selling point against "just ask a chatbot" | Clear value | Must be said plainly in the README |

## B. Roles and procurement

| ID | Decision | Why | Cost |
| --- | --- | --- | --- |
| D-110 | **Shark = CEO, never a worker.** It writes the brief, prices, auctions, holds escrow, decides revisions/refunds within contract rules | Avoids self-hiring; keeps procurement real | — |
| D-111 | **Workers: Raven (paid on Base via Chain Signatures) and Crab (paid on NEAR)**, different models, prices and speed; per-job sealed-bid auction | Real procurement + cross-chain payouts | Two services to run; new Crab character |
| D-112 | **Reviewer: Owl in the OutLayer TEE**: code checks first, then a model check; attested pass/fail with reason codes | Independent, verifiable quality | Model checks can be wrong (→ D-115) |
| D-113 | **One revision** after a first fail; second fail → refund, worker unpaid | Fair to workers, protects customers | — |
| D-114 | **Disputes:** a worker can dispute a final fail; Owl reruns with a **different model**; majority (the second review) decides | No punishment on one model's opinion | One more review per dispute (paid from reserve) |
| D-115 | **Unresolved (A+ carried over):** if a dispute can't be reviewed in time → customer refunded now, delivery withheld, worker fee held; review later; 7-day timeout releases the fee; workers with ≥ 2 unresolved can't win auctions | Nobody punished without proof; gaming capped | One more state and timer |
| D-116 | **Suspension:** final fails + disputes lost ≥ 3 in a worker's last 20 jobs → suspended until owners reinstate | Bad suppliers drop out | — |

## C. Pricing and accountability

| ID | Decision | Why | Cost |
| --- | --- | --- | --- |
| D-120 | **Shark quotes each job inside owner-set bands per type** (extract 0.30–1.50, summary 0.20–1.00, thread 0.50–2.00) from size, load and recent bids, with a reason | A real AI pricing decision on every order | Quotes vary; customer sees price + brief before paying |
| D-121 | **Per-type floor** `max(m / worker_cap, m + review_fee)` enforced on-chain; Shark reads it before quoting | A job is always affordable | — |
| D-122 | **Worker cap 50% of price; review fee 0.05 per review** (escrowed with the worker fee) | Margins for referral, owners, reserve | Re-check after real costs (O-10) |
| D-123 | **Shark strikes only for its own mistakes:** an upheld complaint (brief didn't match the order, judged by an independent second review) or `BRIEF_INVALID`; 3 strikes → cage | Measures Shark's real job; fair | Complaint flow (~½ day) |
| D-124 | **Complaint window 24 h; revenue split only after it** (`finalize`) | Refunds never claw back paid splits | Owners and referrers wait 24 h |

## D. Inputs and data

| ID | Decision | Why | Cost |
| --- | --- | --- | --- |
| D-130 | **Shark snapshots every input once** (URL fetch or upload ≤ 2 MB / 20 pages / 40 000 words; text extracted); everyone uses the snapshot; `input_hash` on-chain | Fair, repeatable reviews; exact size-based pricing | A file store + PDF/HTML extraction |
| D-131 | **Files off-chain, hashes on-chain**; Owl verifies hashes in the TEE; 30-day retention | Content can't be swapped; storage stays cheap | Shark could withhold files (→ refund) |

## E. Money, payments, networks (carried over from v1, unchanged)

| ID | Decision |
| --- | --- |
| D-140 | Customer money lands in the contract, never in Shark's wallet |
| D-141 | **Method 1:** Shark-signed quote + `ft_transfer_call`, verified on-chain (signature, payer, amount, band, floor, expiry, one-time use); bad payments returned at once |
| D-142 | **Method 2 (mainnet):** NEAR Intents via direct 1Click calls; Shark reports the receipt; the contract checks the quote and its balance growth. MPP SDK only if ready |
| D-143 | **Refunds always to the payer's NEAR account** by permissionless `pay_refund` (contract pays the storage deposit); 1Click refunds deposits that never arrive |
| D-144 | Shark's wallet = OutLayer custody wallet with a policy; function-call key limited to its methods; rotatable quote key |
| D-145 | Reserve floor `3 × daily_budget + 2 × review_fee`; `fund_shark` daily; seed at deploy ≥ floor + daily budget; `wind_down` (DAO, paused, no open jobs) |
| D-146 | Service state before quoting: `closed → paused → caged → no_worker → out_of_budget` → 503, no quote |
| D-147 | Owner = DAO in Trezu (Sputnik); guardian pause-only; read-only owners panel in the app |
| D-148 | **Testnet build + mainnet-lite demo** (small settings: daily_budget 0.60, floor 1.90, seed 2.50); everything runs through 18 Nov 23:59 UTC; wind-down after |
| D-149 | **Web: one app with a `Testnet | Mainnet` switch**, opens on Testnet, `?network=`; Testnet hero proof pills link to mainnet txs; Sample labels per section; testnet money is "test USDC" |
| D-150 | Company accounts are sub-accounts of `<root>` (`shark.`, `guardian.`, `usdc.`); workers and the reviewer are independent accounts |
| D-152 | **x402 v2 support (method 3) alongside the signed quote:** every 402 also carries an x402 `PAYMENT-REQUIRED` (`exact`, `near:testnet`/`near:mainnet`, Circle USDC, `payTo` = contract); bots retry with `PAYMENT-SIGNATURE`; Shark settles via a facilitator and calls `mark_paid_x402` (quote + balance checks). The web keeps method 1 (fully on-chain) | Any x402 bot can pay out of the box; payers need no gas; fixes the "homemade 402" weakness | ~1 day; less trustless than method 1 (said in the README); payer needs a full-access key |
| D-153 | **Payments in Circle USDC on NEAR** (testnet `3e2210e1…`, mainnet `17208628…`); our mock test USDC only as a fallback | Real USDC the x402 ecosystem already uses | Need a testnet faucet source (O-17) |
| D-154 | **Own x402 facilitator as fallback** (`createNearFacilitator`); use the public one if its API key is approved | No dependency on manual approval | Shark pays relay gas |
| D-155 | **OpenAPI at `/v1/openapi.json`; x402 Bazaar listing if available** | Discoverable by agent frameworks | Small |
| D-151 | Hosting: one always-on host (Railway or Fly) with SQLite + a file volume; web on Vercel |

## F. Tracks, brand, process

| ID | Decision |
| --- | --- |
| D-160 | Tracks: `business` (primary), `agents`, `security` |
| D-161 | Brand kept: light page, HelloFugu-style hero, parametric SVG mascots (colour = who, shape/props = state). Characters: 🦈 Shark (CEO), 🦉 Owl (reviewer), 🐦‍⬛ Raven and 🦀 **Crab** (workers). Green/red = money only |
| D-162 | Claude proposes options with pros and cons; the owner decides; Claude argues the other side |
| D-163 | Pre-November work: allowed by the organisers in a separate untracked folder, no disclosure needed. On 1 Nov (07:00 WIB) `git init` → one honest initial-import commit → real commits. Never fake commit dates or stage fake "daily" commits. Keep a screenshot of the organisers' answer |
| D-164 | Nothing is pushed, posted, submitted, signed, spent or deployed to mainnet without the owner's explicit yes |
| D-165 | Cut order: motion polish → webhook/share card → "pay from another chain" web card → re-auction → mainnet-lite. Never cut: escrow + auction, Owl review in TEE, revision/refund path, one paid job with on-chain quote check, Raven via Chain Signatures, strikes/cage, owners' DAO share |
| D-166 | **Job page privacy: delivery for the payer only** (30 Oct). `/jobs/{id}` and `GET /v1/orders/{id}` are public for the audit trail (job type, price, timeline, auction, review result + codes, attestation, payouts, proof). The instructions, input source, brief params, delivery and complaint box are shown only after the payer proves the account with a NEP-413 signed message (`POST /v1/orders/{id}/view`); complaints need the same signature | Keeps RULES §3.5 ("never shown to other customers") while judges can still verify the job; closes the unauthenticated-complaint hole | One signature step for the payer; bots sign with their access key |
| D-167 | **Crab colour = coral `#E07A5F`** (variables `character/crab/body`, `character/crab/belly #EFA08A`); signature prop = a tiny laptop (30 Oct) | Reads as "crab" at once; distinct in hue and lightness from money red `#C2362B` and the other characters | Must stay readable in grayscale at 48 px next to Raven |
| D-168 | **Figma v2.0 = new pages in the same file; v1 pages archived** (renamed `Archive · …`, below a divider, not deleted). Foundations/components stay shared; v1 components kept for the archive (30 Oct) | Follows the v2.0 brief; keeps tokens and components; v1 stays for reference | Supersedes the earlier "update pages in place" preference for this pivot only |
| D-169 | **Every v2.0 page keeps its v1 page's structure, effects and motion** (Landing 9 slots + pinned receipt stage; Order and Job on the Check a call layout; The company and Motion re-scripted). Landing compacted (Rules strip, auction examples as tabs, agents 2x2, ledger 3 rows) | Owner liked the v1 look and the receipt; keeps the build to one layout system | Landing is still about 6 200 px; the receipt stage and the team row are the long parts |
| D-170 | **UI copy uses no semicolons and no dashes** (no em or en dash, no hyphenated words, no dash placeholders). Ranges read "0.20 to 1.00", empty cells read "none". Exempt: technical identifiers (accounts like `demo-buyer.testnet`, URLs, headers like `PAYMENT-REQUIRED`, `NEP-413`, CSS names in the motion spec) and the minus sign on money | Owner's copy rule | Copywriters and the frontend agent must follow it in new strings |
| D-171 | **"Sea mist" texture**: our own drifting halftone fog (blue-grey on light, white on ink) behind the hero, the receipt stage and the CTA. Inspired by KOLlateral's smoke but deliberately different (dots in our palette, not grey smoke) | Makes the landing less plain without looking like KOLlateral | One more canvas or shader; off under reduced motion |

---

## History (short)
- **20–23 Oct:** Shark & Co. chosen as a "funny but serious" autonomous business with animal mascots.
- **23–25 Oct (v0.1 → v1.1):** a Call Checker for crypto influencer calls, then caller track records sold to bots; engine designed (402 sales, auctions, escrow, TEE audit, DAO, Intents, Chain Signatures, testnet + mainnet-lite).
- **30 Oct (v2.0):** pivot to the zero-employee agency (D-101) because the influencer product wasn't a real business, depended on X and real people's reputations, and was too close to KOLlateral. The engine was kept; only the product layer changed. The v1 log is retired.
- **30 Oct (v2.1):** x402 v2 added as payment method 3 for bots, signed quote kept for people (D-152–D-155), to fix the "homemade 402" weakness.
- **30 Oct (design):** payer-only delivery (D-166), coral Crab (D-167), v2.0 Figma pages built as new pages with v1 archived (D-168).
- **30 Oct (design 2):** v1 structure kept for every page (D-169), no semicolons or dashes in copy (D-170), sea mist texture (D-171).
