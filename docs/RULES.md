# Shark & Co. — Project rules

These rules apply to anyone working on the repo, human or AI. If two rules conflict, the earlier section wins.

---

## 1. Hackathon facts (from HACKATHON.md, 24 Oct copy — re-read the live file before submitting)

1. The hackathon starts **1 Nov 2026 00:00 UTC**. Submissions are accepted only **1–14 Nov**; the deadline is **14 Nov 23:59 UTC** (06:59 WIB, 15 Nov). Our own target: submit by **14 Nov 20:00 UTC**.
2. **One submission, cannot be edited.** Tracks: `business`, `agents`, `security`. Add `swarms` only if co-funded checks were built (D-076).
3. The repo may stay private while building, but must be **public before the deadline**.
4. The owner publishes the X demo post: it says the project was **built at NEAR HACKATHON** and has the video attached.
5. Judging starts **16 Nov**; results by **18 Nov 23:59 UTC**. Everything stays running until then.
6. The prize payout needs a **mainnet** NEAR account, created by the owner.
7. The payload is sent only with exactly the documented fields (never `website`), printed first, and sent after an explicit yes. Keep the `requestId` for retries. Never commit the payload.
8. HACKATHON.md has no rule about code written before 1 Nov. Our own rules: local throwaway spikes (D-065) and prototypes in a **separate throwaway folder** (D-077) are allowed before 1 Nov, never pushed; the real repo starts clean on 1 Nov and its git history starts then too (D-078, §3a). The organisers confirmed pre-November work is allowed (O-19, closed 26 Oct). The web front-end prototype on mocks (26 Oct, in `apps/web` + `packages/shared`, no git) is copied in as plain files on 1 Nov (D-080, D-081).

## 2. Owner confirmation required (agents stop and ask)

No agent does any of these without an explicit "yes" from the owner in the current conversation:

- **Push to GitHub** (any remote), force-push, or make the repo public. Currently: **no pushing at all** until the owner says so.
- **Create the GitHub repo.** Not before 1 Nov 00:00 UTC, created empty (D-078).
- Submit the hackathon form or `POST /api/applications`.
- Post on X or any network.
- Sign any transaction, spend any token, or move funds, on testnet included if the owner's keys are used.
- Deploy to mainnet, fund the mainnet-lite contract, create a DAO proposal, or run `wind_down`.
- Delete files, branches or data outside the scratch area.

## 3. Secrets and personal data

1. No secret in the repo, ever: private keys, `wk_` keys, NEAR AI keys, JWTs, seed phrases, the quote key.
2. Secrets live in env vars. `.env` is git-ignored; `.env.example` lists names only.
3. Run a secret scan before every commit (gitleaks, or grep for `ed25519:|wk_|sk-|PRIVATE`).
4. If a secret is ever committed: **rotate it first**, then clean the history.
5. Never send the owner's email or wallet details to a service that doesn't need them. Never commit the submission payload.

## 3a. Git history starts 1 Nov (D-078)

1. **Cutoff:** every commit's author date **and** committer date is ≥ `2026-11-01T00:00:00Z` (07:00 WIB on 1 Nov). This covers code, docs, Figma exports — everything in the repo.
2. **Create late, create empty:** `git init` and the GitHub repo happen after the cutoff. On GitHub, tick nothing (no README, .gitignore or license), so GitHub makes no commit of its own.
3. **Copy, don't import:** pre-November files (docs pack, prototypes from the throwaway folder (D-077), the web front-end prototype `apps/web` + `packages/shared` (D-080), `docs/brand/figma/*.png`, `spikes/hero-shader/*`, `scripts/mascots.js`, `assets/brand/*`) are copied in as plain files. Never copy a `.git` folder, add a spike as a remote, merge, cherry-pick or subtree it.
4. **Never fake a date:** no `--date`, `GIT_AUTHOR_DATE`, `GIT_COMMITTER_DATE`, `commit --amend --reset-author` tricks or rebase date edits. If a commit is blocked by the cutoff, wait — don't work around it.
5. **Enforce it:** install the hook below as `.githooks/pre-commit` (`git config core.hooksPath .githooks`). Before the owner approves any push, run the history check and show the output.

```sh
#!/bin/sh
# .githooks/pre-commit — block commits before the hackathon start (D-073)
CUTOFF=1793491200   # 2026-11-01T00:00:00Z
NOW=$(date -u +%s)
if [ "$NOW" -lt "$CUTOFF" ]; then
  echo "Blocked: the repo history starts 2026-11-01 00:00 UTC (07:00 WIB). See D-078." >&2
  exit 1
fi
```

```sh
# history check before any push (prints offenders; empty output = OK)
git log --all --format='%H %aI %cI' | awk '$2 < "2026-11-01T00:00:00Z" || $3 < "2026-11-01T00:00:00Z"'
```

6. **README and timing:** no statement about when things were built is needed, since the organisers allow pre-November work (O-19, D-081). Never claim the work started on 1 Nov, and if anyone asks, answer with the real dates (dates are never faked, rule 4).

## 4. Money and safety (code must enforce)

1. Customer money lands in the contract, never in Shark's wallet.
2. AI never produces a number that moves money or decides a verdict. AI outputs are proposals that the contract or deterministic code checks.
3. Verdict and money paths: integers only (bps, 8-dp prices, 6-dp USDC base units). No floats.
4. Every money-moving method is idempotent and guarded by the state machine. **Fail to refund, never to double-pay.**
5. Refunds go only to the payer's NEAR account.
6. Shark wallet calls and `mark_paid_intents` are serialized.
7. OutLayer `needs_review` is never auto-retried.
8. Chain Signatures: the contract builds the payload; the relayer supplies only nonce and gas; one payout per job.
9. Check service state before any quote (`closed → paused → caged → no_auditor → out_of_budget`); return 503 without quoting.
10. Re-read `get_price_floor()` before every `set_price`.
11. Pasted text is untrusted: never interpolate it into system instructions; it never reaches a tool that moves money.
12. Nobody is punished without proof: an unresolved dispute holds the fee and waits for a tie-break (D-064).
13. Mainnet-lite: never put more than ~USD 10 in; small settings only; wind down after 18 Nov.
14. Reads are paid with method 1 only and create no job. Seed jobs are price 0, only within the daily seed allowance, and never push the reserve below the floor (D-074, D-075).

## 5. Engineering

| Topic | Rule |
| --- | --- |
| Sources of truth | Contract for state and money; `API-CONTRACT.md` for shapes; SRD for behaviour. Change them together |
| Decisions | Log in `DECISIONS.md` before code depends on it; open questions go to `OPEN-ITEMS.md` |
| Languages | Rust (contract, Owl WASM `wasm32-wasip2`); TypeScript strict (services, web); zod schemas from the API contract |
| Tests | Every contract method has unit tests; sandbox tests cover the full job path, tie-break, Unresolved (both outcomes + timeout), cage, refunds, floor, snapshot, wind-down |
| Fixtures | `fixtures/verdict` must pass in TS and Rust before auction work |
| Networks | Build and test on **testnet**. Mainnet only for: 1–2 tiny Intents tests (7 Nov) and the mainnet-lite deploy (11 Nov), each with the owner's OK |
| Logging | Structured JSON with `jobId`; never secrets or full keys |
| Git | Local only until the owner says push. `main` always demo-able; short branches; Conventional Commits; Claude's commits carry the session's attribution lines |
| Dependencies | Pin versions; one-line reason for each new one |
| Time box | A task over 1.5× its slot → apply the cut order |

## 6. Product, copy and brand

1. Every result says "Describes a past price move. Not investment advice."
2. Placeholder callers only (`@example_caller_1`…), never real influencers, anywhere.
3. No privacy claims.
4. **Green `#147A44` / red `#C2362B` = money up/down only.** Strikes, auctions, limits and system states use ink or accent.
5. Colour = who; shape and props = state; every state readable in grayscale at 48 px.
6. The nav network switch opens on Testnet and always shows which network is selected; non-live numbers say **Sample**; test USDC is called "test USDC".
7. Type: Grotesk ExtraBold titles / SemiBold headings / Regular prose; Mono for figures, chips, buttons, code names (never uppercase code names); no Bold.
8. Plex Mono has no ✓ glyph, so use the SVG icon.
9. Motion off under `prefers-reduced-motion`; no information carried by motion alone.
10. README: cite KOLlateral and Shark Council; claim three tracks (D-076); state the trust boundaries, incl. that tip entries' call text is not verified.
11. Caller records: every hit rate shows its count; rates are split by source (`commissioned` / `tip`); tip entries say "tip — call text not verified"; never rank or name "worst callers" — answer only for the author asked about (D-073, FR-97).

## 7. Working with Claude

1. Claude proposes options with pros and cons and a recommendation; the owner decides; Claude argues the other side on product and scope.
2. Figma: Foundations/Components stay separate. The v1.0 pages are updated in place (owner's request, 24 Oct), not copied to new pages.
3. Durable docs are saved to the Project (`claude/docs/`) as well as to the local `docs/`.
