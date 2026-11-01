# Shark & Co. — Roadmap (v2.0)

| Phase | Dates (UTC) | Goal |
| --- | --- | --- |
| **0. Prepare** | 30–31 Oct | Docs v2.0 (done), Figma brief, accounts, Phase-0 spikes in the untracked sandbox |
| **1. Build** | 1–10 Nov | Local repo from 1 Nov 07:00 WIB; feature-complete on testnet; Intents proven with 1–2 tiny mainnet payments |
| **2. Ship** | 11–13 Nov | Testnet deploy (backup) + mainnet-lite deploy; end-to-end runs; README; video |
| **3. Submit** | 14 Nov | Repo public, X post, submission — each with the owner's yes. Hard stop 20:00 UTC |
| **4. Judging** | 15–18 Nov | Keep everything up; fix only outages |
| **5. Wind down** | ≥ 19 Nov | Mainnet-lite: pause → `wind_down` → delete throwaway accounts |

WIB = UTC+7.

---

## Phase 0 — Prepare (30–31 Oct)

**Accounts (owner creates):**
- ☐ Mainnet named account (prize payout + mainnet-lite deployer)
- ☐ Testnet `<root>.testnet` + `shark.`, `guardian.`, `usdc.`; independent `raven-worker`, `crab-worker`, `owl-reviewer`; `demo-buyer`
- ☐ Raven receive-only addresses on Base Sepolia and Base
- ☐ Railway or Fly; Vercel
- ☐ **Trezu on testnet** (overdue): DAO 1-of-1 → a function-call proposal (**O-09**)

**Keys:** NEAR AI key (**O-06**); OutLayer testnet wallet + policy (**O-08**); 1Click partner JWT request.

**Sandbox spikes (untracked folder, D-163):**
- ☐ **Owl spike:** WASM on OutLayer testnet fetches a file by URL, verifies its hash, calls NEAR AI with a secret key, returns ≤ 900 bytes (**O-03, O-13, O-23**)
- ☐ **Worker quality:** 5 golden orders per job type through 2 candidate models each; run the code checks; target ≥ 90% first-pass (**O-06, O-22**)
- ☐ **Text extraction:** 5 URLs + 3 PDFs (**O-20**)
- ☐ **1Click dry quotes** Base USDC → NEAR USDC at 0.50 and 1.00 (**O-05**)
- ☐ Look up USDC contract IDs (**O-24**) and X length rules (**O-21**)

**Design:** send `agent-prompt-figma-v2.0.md` to the design agent.

**Exit gate (31 Oct):** O-09, O-13, O-22 answered; accounts exist.

**Funds:** testnet faucets only. Mainnet-lite (buy only after O-05): ~USD 8–10 USDC + ~5 NEAR + ~USD 5 on Base; ~USD 1–3 actually spent.

---

## Phase 1 — Build (1–10 Nov)

| Day | Work | Gate |
| --- | --- | --- |
| **1 Nov** | 07:00 WIB `git init` → one initial-import commit (docs, brand, sandbox code). Contract: config + types, roles, job states, method-1 payment (`ft_on_transfer` + quote verify + band/floor), events | `cargo test` green |
| **2 Nov** | Contract: award, escrow, deliver, review result, revision, dispute, Unresolved, complaint, `BRIEF_INVALID`, strikes/cage, suspension, finalize, refunds, `fund_shark`, `pay_owners`, `wind_down`, `mark_paid_intents` | **G1:** sandbox full job path + fail/dispute/complaint paths green |
| **3 Nov** | Checklist lib (TS) + Rust port; fixtures per type (pass + every fail code) | **G2:** fixtures identical in TS and Rust |
| **4 Nov** | Owl review WASM on OutLayer testnet; Raven + Crab services (models, prompts, `deliver`) | Owl returns an attested result via callback |
| **5 Nov** | Shark: uploads, URL fetch + extraction, brief writer + feasibility + safety, pricing, RFQ/award, escrow, keepers, file store | **G3:** a testnet job goes paid → delivered |
| **6 Nov** | Raven payout via Chain Signatures → Base Sepolia + relay | **G4:** Base Sepolia tx pays Raven (*not by 7 Nov 12:00 → pay Raven on NEAR, drop the claim*) |
| **7 Nov** | Test USDC + faucet; HTTP 402 + signed quotes; 503s; demo bot. **Intents:** 1Click client, `mark_paid_intents`; 1–2 tiny mainnet payments (owner's OK) | **G5:** testnet order paid by the bot; one Intents payment reaches a mainnet contract (*not by 8 Nov 12:00 → cut mainnet-lite*) |
| **8 Nov** | OutLayer wallet policy + function-call key; pricing reasons; complaint endpoint | Quote with reason on testnet |
| **9 Nov** | Forced paths: revision → pass; two fails → refund; dispute overturned; reviewer down → Unresolved → resolved; complaint upheld → strike → cage; suspension | Acceptance 5–9, 13, 14 on testnet |
| **10 Nov** | Web wired to live testnet (the frontend agent builds on mocks from 1 Nov) | **Feature freeze 23:59 UTC** |

## Phase 2 — Ship (11–13 Nov)

| Day | Work | Gate |
| --- | --- | --- |
| **11 Nov** | Fresh testnet deploy (SRD §12.1). Mainnet-lite deploy (§12.2): contract → Trezu registers agents → seed 2.50 → keys + policy → fund the derived Base address → `fund_shark` | `/v1/health` = `ok` on both |
| **12 Nov** | Testnet: all acceptance paths. Mainnet-lite: 4 demo jobs + `pay_owners`. Record a rough safety video | Acceptance 1–15 |
| **13 Nov** | README; final video; X post draft; secret scan; cleanup | Owner reviews video + README |

## Phase 3 — Submit (14 Nov)
Fix only broken things → with the owner's yes: push + make public → owner posts on X → print payload → owner's yes → submit (`business`, `agents`, `security`). **Hard stop 20:00 UTC.**

## Phase 4 — Judging (15–18 Nov)
All services and both contracts up; health checks twice a day; top up Base gas; change nothing else.

## Phase 5 — Wind down (≥ 19 Nov, owner's OK)
Mainnet-lite: guardian `pause` → DAO `wind_down()` → delete throwaway accounts. Testnet can stay.

---

## Cut order
1. Motion polish
2. Webhook, share card
3. "Pay from another chain" card on the web (bots still use method 2)
4. Re-auction after a late worker (refund instead)
5. Mainnet-lite (fall back to the testnet demo)

**Never cut:** escrow + auction, Owl review in TEE, revision/refund path, one paid job with on-chain quote check, Raven via Chain Signatures, strikes/cage, owners' DAO share.

## Risk watch

| Risk | Early signal | Response |
| --- | --- | --- |
| Owl can't call NEAR AI in the TEE (O-13) | Phase 0 spike | Model check in Owl's TS helper, signed by Owl's key; code checks stay attested; say so |
| Worker quality too low (O-22) | Golden orders < 90% | Tighter prompts; better model; narrower briefs; demo the strongest type first |
| OutLayer schema unknown (O-03) | No callback by 4 Nov | Owl posts results via a signed call; keep the TEE wallet for Shark; say so |
| Trezu lacks testnet (O-09) | Test fails | Sputnik CLI on testnet; Trezu on mainnet-lite |
| 1Click minimum too high (O-05) | Dry quote fails | Use a larger job (thread ≥ 1.00) or cut mainnet-lite |
| Services down during judging | Health alert | Auto-restart; video; testnet backup |

---

## Demo video (~2:30)

| # | Time | Shows |
| --- | --- | --- |
| 1 | 0:00 | Hook: "An agency with zero employees. Run by a shark." Landing |
| 2 | 0:15 | A person orders a summary on the web: pastes a URL, sees Shark's brief and price (0.60, "6 pages, 2 required points"), pays with a NEAR wallet (testnet) |
| 3 | 0:40 | Auction: Crab 0.18 vs Raven 0.24 → Crab, with Shark's reason; escrow |
| 4 | 0:55 | Owl's review: checks ticked, attested; delivery shown; payouts split |
| 5 | 1:15 | **Mainnet:** a bot pays from Base via NEAR Intents for a data extraction; Raven wins a thread job and is paid on Base via Chain Signatures |
| 6 | 1:40 | A failed first delivery → revision → pass; a twice-failed one → refund (testnet, labelled) |
| 7 | 1:55 | **Attacks blocked** (real txs): prompt injection in an input, an award over the cap, the wallet paying a stranger, a reused quote |
| 8 | 2:10 | A complaint upheld → Shark strike → third strike → cage → 503 `caged`; owners in Trezu reset strikes |
| 9 | 2:25 | Close: three tracks + "Shark runs the company. Agents do the work. Humans set the limits." |

## README outline (humans and AI judges, no marketing)
1. The customer and the promise: "Order a small job; it's done by an AI agent, independently checked, or you get your money back."
2. **Try it** — "do X → see Y": open the site (Testnet) → faucet → order a summary → pay → watch the job page → read the review. Then switch to Mainnet for the Intents payment and Raven's Base payout.
3. Track fit: Autonomous Business, Agent Economy, AI Security & Defense.
4. Architecture + money flow.
5. Live links (mainnet-lite and testnet).
6. Security model and trust boundaries (incl. "model reviews can be wrong; disputes use a second model").
7. Prior art and difference.
8. Run locally / on testnet.
