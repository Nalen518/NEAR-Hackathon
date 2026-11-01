# Web status report · 31 Oct 2026

One place for what is built, what is not, every gap, and what we found while checking.
The single register of gaps is **§3**. The backend checklist is `BACKEND-TODO.md`. `W0-reading-report.md` keeps the history of how each gap was found.

## 1. Built (on mocks, local only, no git)

| Phase | Result | Checks |
| --- | --- | --- |
| W0 | Reading report, field map, gap list, API v2.3 proposal (agreed in tiers) | none |
| W1 | Shared v2 schemas, client, 11 fixtures, 30 `?mock=` scenarios, 33 Figma mascots, v2 components, copy lint, dev gallery | Unit tests |
| W2 | Landing: 9 slots, shader hero, Sea mist, receipt stage, cage meter, auction tabs, ledger | 8 Playwright |
| W3 | Order: form, brief and quote, pay (N3 checks, register, faucet, mainnet confirm, Intents card), what happened, receipt, every state | 17 Playwright |
| W4 | Job: public view, payer view after NEP-413, complaints, every status, polling | 17 Playwright |
| W5 | The company: every v2.3 pane, LIVE or SAMPLE per pane, banners, both networks | 11 Playwright |
| Handoff | `BACKEND-HANDOFF.md` rewritten for v2 with the agreed tiers | none |

**Totals:** typecheck and lint are clean. Vitest: 47 web + 24 shared. Playwright: 67, all passing with `--workers=1`. The hero fps check is load sensitive, so run it with one worker. The web has **never** called a real API, wallet or contract.

## 2. Not done yet (rechecked 31 Oct)

**Frontend items still open, in suggested order:**
1. ~~Pixel comparison fixes~~ all done 1 Nov. Owner choice left: single column for the Company workers pane (see PIXEL-COMPARISON §4)
2. F7 unused SVGs (kept, as you chose)
3. W6 live run (waits for the backend)


### 2.1 Checks the prompt asks for
| Item | Why not | What it needs |
| --- | --- | --- |
| Pixel comparison with Figma | **Done 31 Oct**, see `PIXEL-COMPARISON-2026-10-31.md` | 12 differences: all fixes applied by 1 Nov (D1 incl. shader, D3 to D7, D9 to D12). What is left is data or design choice, listed in §4 there |
| Real wallet (NEAR Wallet Selector, `signMessage`) | Waits for W6 and your go | Backend B1, then your yes |
| W6 live testnet run | Backend not serving v2 yet | Backend B1 and B2, then your yes for each test payment |

### 2.2 Motion beats from the Motion spec (155:3522) ✅ (done 31 Oct)
All CSS, all under `prefers-reduced-motion: no-preference`, so reduced motion shows the end state. A `Play` wrapper holds each beat at its first frame until its box scrolls into view. New file: `components/ui/motion.tsx` (`Play`, `Tick`, `Typed`, `Padlock`, `Coin`).

| Beat (spec) | Where | How |
| --- | --- | --- |
| Partner chips: typewriter swap of the heading | Landing hero | Spec phrases at 34 ms/char with a blinking caret: "Pay from any chain.", "Writes the brief.", "The reviewer can’t lie.", "Pays Raven on Base.", "Profit goes to owners." (**closes G18**) |
| Bid rows slide in | AuctionCard (Landing, Job, Company) | Rise 12 px + fade, 280 ms, stagger 120 ms |
| Winner highlight | AuctionCard | Chips pop (.9 → 1, 180 ms) after the last bid + 400 ms, then Shark's reason fades in |
| Numbers tick up | Ledger tiles, company P&L | 900 ms ease out from 0, bigint maths, exact end value; screen readers get the real number |
| Checklist ticks | ReviewReport, receipt | One by one, 120 ms apart, code checks first (scale .8 → 1) |
| Second opinion | ReviewReport | Owl's badge flips (rotateY 90 → 0, 360 ms), then the checks re-tick |
| Revision loop | JobTimeline | ↻ arrow turns once on the revision step |
| Payout coins | Receipt, company payouts | Coin and amounts slide in from 24 px, stagger 100 ms. Green only for money |
| Proof pills pop | Receipt (Order, Job) | .9 → 1, stagger 90 ms |
| New log row | "What happened" on Order and Job | Each new row slides in when polling adds it |
| Payout sent | Company 7 day split | Bars grow from 0 (ink) |
| Unresolved padlock | Company held payout, Job unresolved state | Shackle drops 3 px and snaps shut |
| Payment returned | Order returned card | Coin slides back toward the wallet, then the pill pops |
| Cage drop | Landing rules, company strikes | Strike states drop in one by one, 420 ms apart |
| Dot panel (loading only) | Order waiting, Job while a worker or Owl works | Small Sea mist strip |

**Not animated:** the company auction log, quotes and payouts lists don't get new rows live, because the data is static until W6.

### 2.3 Smaller pieces from Figma ✅ (done 31 Oct)
- **Gallery** now shows Nav v2, Footer v2, SeaMist (light and dark), DataSource (live and sample), PartnerChip, OrderForm and Receipt (quote, delivered and public). `PartnerChip` and `DataSource` are now exported components, used by the pages too.
- **DeliveryView:**
  - threads show 3 posts, then "+ 2 more posts" (and back)
  - extraction shows 4 rows, then "show all", with right-aligned numbers and **Download .json** next to Copy JSON
- **Job mocks** `?mock=thread_job` (5 posts, 1.20) and `?mock=extract_job` (24 records, 0.80): checklist rows use the extract and thread rule copy, and paid amounts and the worker cap match each price.
- **Tests:** 2 new Job tests (expand posts; show all + download) and the gallery checks the new entries. Screenshots: `job-thread-1440.png`, `job-extract-1440.png`.

### 2.4 Done since the first version of this report (31 Oct)
- **Lighthouse installed** (`lighthouse@13.5.0`, dev only; 13.6.0 was under two weeks old). Run on a production build, desktop preset, **after the contrast fix (F12)**:

| Page | Perf (≥ 85) | A11y (≥ 95) | TBT | Note |
| --- | --- | --- | --- | --- |
| `/` | **100** | 100 | 30 to 40 ms | Was 72 to 88. The shader no longer blocks (see F11) |
| `/order` | 100 | 100 | 10 ms | |
| `/jobs/j_000042` | 100 | 100 | 10 ms | |
| `/company` | 100 | 100 | 20 ms | |

  Before the fix, a11y was 96, 100, 96 and 96 (27 + 5 + 13 low-contrast elements), and Landing perf was 78.

- **Hero frame rate:** `e2e/hero.spec.ts` reads the shader's `fps` (exposed on `window` in dev only).
  - Result: 24 to 25 fps against the 30 cap, DPR ≤ 1.5.
  - It pauses off screen, and it stops under reduced motion.
  - It is sensitive to machine load, so run it with `--workers=1`.
- **Quick tidy F1 to F6, F8, F9 done:**
  - env names follow API §5.1, and explorer, RPC, faucet and wallet values come from the profile
  - live mode refuses to pay when the contract or token is not configured
  - the PROOF_LINKS example is fixed, and code comments cite v2 decisions
  - `formatPrice8` is gone, and the wallet messages say W6
  - real README, and `tokens.json` v2.0 with Crab
- F7 (unused SVGs) waits for your delete choice.

## 3. Gap register (all gaps, one table)

**Status:** **Decided** = settled and in code · **Owner** = needs your answer · **Backend** = needs the API · **Web** = we can fix.

| # | Gap | Status | Note |
| --- | --- | --- | --- |
| G1 | `/v1/company` missing config, logs, payouts, proposals | Decided | v2.3 P6, tiered |
| G2 | No payer view endpoint, unsigned complaints | Decided | v2.3 P1, P2 (must) |
| G3 | Timeline events too few, no award tx | Decided | v2.3 P3 |
| G4 | No per-check details | Decided | v2.3 P4, code checks only |
| G5 | Figma v1 copy: "Post URL or text", "CHECK ANOTHER", Job nav highlights ORDER | **Owner** | Code uses "Order another" and no active link on Job |
| G6 | No `warnBelow` for Raven gas | Decided | v2.3 P6 core |
| G7 | CORS lists port 3000, web runs on 3100 | **Backend** | In handoff B7 |
| G8 | Version drift (prompt says API v2.1, file is v2.2; ARCHITECTURE cites SRD v2.0) | **Owner** | Docs only |
| G9 | RULES.md still has v1 rules (`no_auditor`, investment advice line, callers, Figma "in place") | **Owner** | Your file |
| G10 | No Crab in `scripts/mascots.js` | Decided | Exported from Figma instead |
| G11 | Prompt asks for MSW, we kept the injected mock fetch | **Owner** | Not in `DECISIONS.md` yet |
| G12 | Exact checklist rule strings for extract and thread | **Backend** | Handoff B3 |
| G13 | Ledger reserve and refund amounts | Decided | v2.3 P6 core |
| G14 | Gas and deposit for client calls (O-18) | **Backend** | Web sends what the 402 says |
| G15 | Figma copy breaks D-170 ("24-hour", "7-day") | **Owner** | Code writes "24 hour", "7 day" |
| G16 | Complaint upheld text names a reason with no field | **Owner** | Code uses a general line |
| G17 | Sample delivery is 90 words but its check says 142 | **Web** | Sample text only |
| G18 | Hero partner swap lines aren't in Figma | Decided | Found in the Motion spec (155:3522): the five phrases are now used, typed at 34 ms/char |
| G19 | Landing "Refund" tab has no Figma frame | **Owner** | Drafted from SRD FR-44 |
| G20 | Step bodies 01, 02, 04, 05 aren't in Figma | **Owner** | Drafted from the SRD |
| G21 | No fix list on `brief_infeasible` | **Backend** (optional) | Web offers its own fixes |
| G22 | Job page link before W4 | Decided | Fixed by W4 |
| G23 | Intents card needs `payWith` before a deposit address | Decided | Card re-posts the order |
| G24 | What the public job view may show | **Owner** | Size added; checks read "Checked by code / AI"; must mention "private" |
| G25 | No "job not found" error | **Backend** | Handoff B4 |
| G26 | "7-DAY SPLIT" breaks D-170 | **Owner** | Code says "7 day split" |
| G27 | Mainnet company numbers beyond "4 jobs, 3.20" are placeholders | Decided | Live data in W6 |
| G28 | v2.3 tier decision not in `DECISIONS.md` | **Owner** | Text ready in `W0-reading-report.md` §5 |
| G29 | The web didn't check that the API host serves the selected network (API §0.3 N1) | Decided | **Fixed 31 Oct.** The shared client takes the expected CAIP-2 network and rejects any response whose `network` (or signed `quote.network`) differs (`NetworkMismatchError`, 4 unit tests). A "Wrong network" banner shows under the nav (from `/v1/health`, checked every 60 s). Order shows "nothing can be paid" with no pay button; Job says "This job is on the other network"; Company falls back to sample data. Mock `?mock=wrong_network` plus 1 e2e test |
| G30 | Ledger dates come from `recentJobs[].at`, which is optional in the schema | **Backend** | Send it (P6 core). Without it the ledger date column is blank |

## 4. New findings from this check (inconsistencies we can fix)

| # | Finding | Fix | Size |
| --- | --- | --- | --- |
| F1 ✅ | `.env.example` env names don't match API §5.1. Ours are `NEXT_PUBLIC_TESTNET_SHARK_API`, `…_CONTRACT_ID`, `…_USDC_ID`. The contract says `NEXT_PUBLIC_<NET>_API_URL`, and also lists `_NETWORK_ID`, `_RPC_URL`, `_EXPLORER_URL`, `_WALLETS` and `_USDC_FAUCET_URL` | Rename to the §5.1 names and add the missing ones | Small |
| F2 ✅ | Explorer URLs are hard-coded in `lib/network.ts`, but §0.3 says every value comes from the profile, with no hard-coding | Read them from the env, keeping today's values as defaults | Small |
| F3 ✅ | `.env.example` `NEXT_PUBLIC_PROOF_LINKS` example uses the old v1 kind `intents-payment`, which no longer parses | Change to `intents` | Tiny |
| F4 ✅ | Code comments cite retired v1 decisions (D-054, D-072) | Point to D-149 and FR-84 | Tiny |
| F5 ✅ | `formatPrice8` and its test are leftovers from v1 (8 dp verdict prices) | Delete both | Tiny |
| F6 ✅ | `lib/wallet.ts` says the Wallet Selector comes "in W3"; it's planned for W6 | Fix the comment | Tiny |
| F7 | 47 v1 SVGs in `apps/web/public/brand` are no longer used (old mascots, dithers, verdict fins, two icons) | Delete, or move to `_archive/` | Small |
| F8 ✅ | `apps/web/README.md` is the default create-next-app text | Replace with a short run and test guide | Small |
| F9 ✅ | `docs/brand/tokens.json` predates Crab (`#E07A5F`, `#EFA08A`) | Add the Crab tokens | Tiny |
| F10 ✅ | No test at 1024 px (prompt §10) | **Fixed 31 Oct.** Only the Job payer view scrolled sideways (23 px): its main column wouldn't shrink below its content. Job and Order now use `minmax(0,1fr)`. The bid rows' fixed columns pushed the WINNER chip out of its card, so they now use one shared template (`minmax(100px,130px) 56 48 56 68 88`), and header and rows line up at every width. Tests: Landing and Company now run at 1024 too, plus a 1024 sweep over Order (both networks, mainnet quote), Job (public, payer, refunded) and the gallery | Done |
| F11 ✅ | Landing perf was borderline (84 to 87), then 72 | **Real cause, found by bisecting:** the hero's WebGL shader asked for compile and link status at once, which makes the main thread wait for the GPU (650 ms or more, varying by run). It now compiles with `KHR_parallel_shader_compile` and polls once per frame; browsers without it behave as before. The canvas fades in after its first frame, and a failed link still shows the still image. Also kept from the first try: Sea mist draws once and drifts with CSS. **Result: perf 100 on all four pages**, and hero fps 30 to 31 (cap 30) | Done |
| F12 ✅ | Colour contrast fails on 27 (Landing), 13 (Company) and 5 (Job) elements. `text-faint` (#8B919C, 2.93:1) is used for normal text, but tokens.json allows it only for caps labels ≥ 12 px | Swap `text-faint` to `text-muted` (5.84:1) on non-label text; keep faint for placeholders | Small |

## 5. Files that are out of date (candidates to remove)

| File | Why it is out of date | Replaced by |
| --- | --- | --- |
| ~~`docs/web/SESSION-2026-10-26.md`~~ | Removed 31 Oct | `SESSION-2026-10-30.md` |
| ~~`docs/web/API-CHANGE-PROPOSAL-N1-N23.md`~~ | Removed 31 Oct | `API-CHANGE-PROPOSAL-v2.3.md` |
| `docs/brand/figma/*-v1.0.png` (9 files) · kept for now | Exports of the archived v1 Figma pages | The Figma v2.0 pages |
| `docs/brand/mascot-sheet-v0.2.png` | Mascot sheet before v1 | Figma Mascots v2.0 `129:860` |
| ~~`_archive/web-v1/`~~ | Deleted 31 Oct | The v2 pages |
| 47 unused v1 SVGs (F7) · kept for now | No longer referenced | `public/brand/m/*` (v2 mascots) |

**Keep:** everything else in `docs/` (SRD, API-CONTRACT, ARCHITECTURE, DECISIONS, RULES, ROADMAP, OPEN-ITEMS, DESIGN-HANDOFF, HACKATHON, both agent prompts, `mascots.md`, `tokens.json`, `mascot-sheet.png`) and every file in `docs/web/` not listed above.

No file has been removed yet. Each removal waits for your choice.
