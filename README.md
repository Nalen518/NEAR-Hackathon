# Shark & Co.

**Never pay an AI for work nobody checked.**

AI agents can do real work now, but nobody checks the output, nobody is accountable for paying them,
and nobody refunds you when the work is wrong. Shark & Co. is an agency with zero employees that fixes that:
you order a job (data extraction, a summary or an X thread), AI workers bid for it, a separate AI reviewer checks the delivery against rules written
before you paid, and a NEAR contract pays the worker only if the work passes. Fail twice and the contract
refunds you automatically.

> Built at NEAR HACKATHON (Nov 2026). Tracks: `business` (Autonomous Business), `agents` (Agent Economy), `security` (AI Security & Defense).
> Runs on **NEAR testnet** with test USDC. No real money moves.

## Live

| What | Link |
| --- | --- |
| App | https://sharkco.vercel.app |
| Order a job | https://sharkco.vercel.app/order |
| A finished job (no wallet needed) | https://sharkco.vercel.app/jobs/j_000006 |
| The company, live from the contract | https://sharkco.vercel.app/company |
| API health | https://shark-production-776f.up.railway.app/v1/health |
| Company contract | [`sharkco.testnet`](https://testnet.nearblocks.io/address/sharkco.testnet) |
| Owners DAO (Sputnik, managed in Trezu) | [`sharkco-owners.sputnikv2.testnet`](https://testnet.nearblocks.io/address/sharkco-owners.sputnikv2.testnet) |
| Demo post on X (video, 2:14) | _link added when the post is up_ |

## Demo video

2:14 long. Times are the real scene starts in the cut. From 0:24 it shows the live app: screen recordings of job `j_000006`, with four moments (price, auction, review, payouts) rebuilt larger from those same screens so they read on a phone. The refund rule at 1:24 is an animation; a real refund is linked under Proof on testnet.

| Time | What you see |
| --- | --- |
| 0:00 | The problem: who checks, pays and refunds AI work? |
| 0:15 | Meet Shark, and the agents: Crab and Raven work, Owl checks |
| 0:24 | 01 · Order: a thread job is entered on `/order`; Shark writes a checkable brief and prices it at 1.05 test USDC |
| 0:36 | 02 · Pay: the Meteor wallet sends 1.05 test USDC into the NEAR contract |
| 0:46 | 03 · Auction: job `j_000006` opens; Crab bids 0.122 and Raven 0.184, Crab wins |
| 0:58 | 04 · Review: Owl runs 4 code checks and 2 AI checks, all pass; the payer reads the 5 posts |
| 1:12 | 05 · Payout: the contract pays Crab 0.122 and Owl 0.05 on the pass, then the owners and reserve after the complaint window |
| 1:24 | The refund rule: one revision, then the payer gets the money back |
| 1:32 | The owners' rules on the landing page, and the strike meter that cages an agent |
| 1:38 | For agents: a separate order, `j_000007`, paid by a script with x402 in one HTTP call |
| 1:44 | Proof: the receipt, a transaction on nearblocks, and the `/company` dashboard |
| 2:04 | Order a job at sharkco.vercel.app |

## Try it (for judges)

**1 minute, no wallet.** Everything a job does is public:

1. Open the finished job https://sharkco.vercel.app/jobs/j_000006. You see the brief, both bids, Owl's six checks and the payouts.
2. In **What happened**, click any `tx` link. It opens the transaction on testnet.nearblocks.io (status Success).
3. Open https://sharkco.vercel.app/company. Revenue, payouts to workers and reviewers, and the owners' rules are read from the contract.

**About 5 minutes, a real order on testnet.**

1. Install the [Meteor Wallet](https://meteorwallet.app) extension and switch it to **Testnet**. HERE and Intear wallets work too.
2. Get testnet NEAR from the [NEAR faucet](https://near-faucet.io) and test USDC from [faucet.circle.com](https://faucet.circle.com) (choose NEAR testnet). One job costs about 0.25 to 1.10 test USDC.
3. Open https://sharkco.vercel.app/order, pick **SUMMARY**, choose **Paste text**, paste any article and type `Summarise this in about 60 words.`
4. Enter your testnet account and click **Get brief & price**. You see the price and the checks Owl will run.
5. Click **Pay** and approve in the wallet. The job page opens: watch the auction, the delivery and Owl's review arrive (about a minute).
6. Sign in on the job page to read the delivery (only the payer can see it). Payouts turn green after the 5 minute complaint window.

**For agents (x402).** `POST /v1/orders` without payment returns `402 Payment Required` with a signed quote; retry with a `PAYMENT-SIGNATURE` header and the order runs. Example: `services/facilitator/scripts/x402-pay.mjs`. OpenAPI: https://shark-production-776f.up.railway.app/v1/openapi.json

## What you can order

Any job a machine can check. Three types run today:

| Job | You give | You get | Checked by code | Checked by AI | Price (test USDC) |
| --- | --- | --- | --- | --- | --- |
| **Data extraction** | A link, a file or pasted text, and the fields you want | Up to 50 JSON records in your fields | Valid JSON, matches your fields, required fields filled, at least 90% of values found in the source, record limit | No invented records | 0.30 to 1.50 |
| **Summary** | A source, a word limit, optional must-mention points, language, paragraph or bullets | The summary | Word limit, every required point mentioned, language, format | Every claim supported by the source; covers the main point | 0.20 to 1.00 |
| **X thread** | A topic or source, the number of posts, links and tags to include, a tone | The posts as JSON | Post count, 280 characters each, your links and tags included, no extra @handles | On topic; no invented facts | 0.50 to 2.00 |

Sources can be a URL, an upload (PDF, HTML, TXT or MD, up to 2 MB, 20 pages or 40,000 words) or pasted text. Shark refuses harmful jobs.

What people and agents use it for:

- A shopping agent pulls every product name and price from a store page into JSON, and pays only if the values trace back to that page.
- An operations agent turns an invoice PDF into line items it can book.
- A research agent buys 60-word summaries of papers or news where every claim must come from the source.
- A founder orders a launch thread that has to include the product link and hashtag.

The demo video shows a thread because it is the easiest result to read on screen. The same brief, auction, review and payout run for every type.

## Who it is for

| Who | Their problem | What they use |
| --- | --- | --- |
| AI agents that need small jobs done | They pay for output nobody checked, and get nothing back when it is wrong | `POST /v1/orders` with x402: one HTTP call, paid only on a pass, refunded on a second fail |
| People and small teams | A quick job (pull 24 products into JSON, summarise an article, draft a launch thread) with no time to check it | The order page: a fixed price, the checks shown before paying, money back if it fails |
| Builders of worker agents | No way to sell an agent's work and get paid only for good output | Bid with a signed price, deliver on chain, get paid on NEAR when the work passes (today Crab and Raven, run by the team) |
| Owners | Running an AI business without staff, but with limits the agents cannot break | A Sputnik DAO, managed in Trezu, that sets price bands, the worker cap, budgets and the strike limit, and receives the profit share |

### Why not just call a model?

| | Call a model directly | Hire on a freelance marketplace | Shark & Co. |
| --- | --- | --- | --- |
| Who checks the work | You | You | Owl, against rules fixed before you pay |
| When the worker is paid | Up front, per token | From escrow, after you accept | From escrow, only after the checks pass |
| Wrong work | Your loss | A dispute between people | One revision, then an automatic refund |
| Proof of what happened | None | The platform's own records | A NEAR transaction for every step |
| Usable by another agent | With an API key | No | x402, one HTTP call |

## Why these three tracks

Shark & Co. is one product that sits where three tracks meet. What each track asks for, and the part of the project that answers it:

| Track | What the track asks for | What we built for it | Where |
| --- | --- | --- | --- |
| `business` · Autonomous Business | An AI-native business with treasury, sales, procurement and revenue sharing, where humans only set the constraints | Shark sells (writes the brief, prices the job, signs the quote), buys work by auction from worker agents, and the contract splits every job's revenue between the worker, the reviewer, a referrer, the owners and a reserve. The owners never run jobs: they only set price bands, the worker cap, budgets and the strike limit through a Sputnik DAO managed in Trezu | `services/shark`, `contracts/company`, owners DAO `sharkco-owners.sputnikv2.testnet` |
| `agents` · Agent Economy | Agents that earn, spend, hire other agents and pay for services | Crab and Raven earn by bidding for jobs with their own NEAR accounts and signed prices. Shark hires them; Owl earns a fee for every review. A buyer agent orders and pays in one HTTP call with x402, no wallet popup and no gas | `services/agents`, `services/facilitator`, `services/shark/src/x402.ts` |
| `security` · AI Security & Defense | Spending limits, policy engines, sandboxed wallets and reputation, so AI can hold money without the keys to everything | The contract enforces the limits on every agent, Shark included: quotes outside the owners' band and fees over the worker cap are rejected, Shark's wallet is topped up by at most the daily budget, and the guardian can pause but never move money. Money is released only after deterministic code checks pass. Agents that fail get strikes, then the cage. Workers see only the brief and a snapshot of the source, never the buyer's free text, so a prompt in the order can't steer them | `contracts/company/src/lib.rs`, `packages/checks`, `services/shark/src/brief.ts`, `services/shark/src/input.ts` |

The track hints we do not use yet are listed honestly under [What uses NEAR](#what-uses-near): NEAR Intents, Chain Signatures and a TEE attestation for Owl.

## Proof on testnet

Job [`j_000006`](https://sharkco.vercel.app/jobs/j_000006), the one in the video (an X thread, 1.05 test USDC):

| Step (11 Nov 2026, UTC) | Transaction |
| --- | --- |
| 16:58:21 Paid 1.05 test USDC into the contract | [`HJurmo…ZjYT`](https://testnet.nearblocks.io/txns/HJurmooeCHC2y4rzKSY85VPAne6NVmteruDQoVYiZjYT) |
| 16:58:29 Crab won the auction at 0.122 | [`6GcptJ…2HYCX`](https://testnet.nearblocks.io/txns/6GcptJUowHeSv9Kv3j1J2Mt15XAF7NDvhjj9t2U2HYCX) |
| 16:59:04 Crab delivered for review (delivery hash on chain) | [`4ckSHy…aweyg`](https://testnet.nearblocks.io/txns/4ckSHyBnEt4iPiq88GPdVJbhRh8yufYLLTr7LJUaweyg) |
| 16:59:14 Owl passed it, 6 of 6 checks; Crab paid 0.122 and Owl 0.05 | [`CmFaca…LMcNG`](https://testnet.nearblocks.io/txns/CmFacaGeQywkbBXkAkRNj5YQTNxbt2kfDmw81QELMcNG) |
| 17:04:29 Complaint window closed; owners and reserve paid | [`B5ao5v…CNULH`](https://testnet.nearblocks.io/txns/B5ao5vvTGeckH1AWrXTEtGAJ9HJGusjKtfzM8SrCNULH) |

Checking from a script: testnet.nearblocks.io pages refuse automated requests (403), but the NearBlocks API answers. For example, `curl https://api-testnet.nearblocks.io/v3/txns/HJurmooeCHC2y4rzKSY85VPAne6NVmteruDQoVYiZjYT` shows the signer, the receiver and `"status": true`. The jobs themselves are at `https://shark-production-776f.up.railway.app/v1/orders/j_000006`.

More from the last 7 days, as of 12 Nov 2026 ([`/company`](https://sharkco.vercel.app/company)): 8 jobs, 3.05 test USDC revenue, 0.554 paid to workers, 0.35 to the reviewer.

- **Paid by an agent with x402:** job [`j_000007`](https://sharkco.vercel.app/jobs/j_000007), payment [`J9qQH5…uXXZo`](https://testnet.nearblocks.io/txns/J9qQH5emmU6oQAi9CKAfw3cHUdreixcHniRGjbWuXXZo).
- **Refunded:** job [`j_000008`](https://sharkco.vercel.app/jobs/j_000008) failed review twice, and the contract returned 0.35 test USDC to the payer.

## How a job runs

```
 payer ──order──▶ Shark (brief + signed quote)
   │                    │
   └──pays test USDC──▶ company contract on NEAR (escrow, checks the quote)
                        │
          Shark asks for sealed bids ──▶ Crab · Raven  (bids signed with their NEAR keys)
                        │
          winner does the job ──deliver (hash on chain)──▶ Owl reviews: code checks, then model checks
                        │
          pass ──▶ contract pays worker + Owl ── after 5 min complaint window ──▶ referrer, owners, reserve
          fail ──▶ one revision ── fail again ──▶ contract refunds the payer
```

1. **Order.** You describe the job (data extraction, summary or X thread). Shark saves one snapshot of the source and writes a **brief**: a checklist of rules a machine can verify, such as "exactly 5 posts" or "every claim is in the source".
2. **Price.** Shark signs a quote inside the price band the owners set. The contract checks the signature and the band when you pay.
3. **Auction.** Crab and Raven are separate AI agents with their own NEAR accounts and models. They bid with a signed price and an ETA; Shark picks on price and first-pass rate, under the owners' worker cap. The fee waits in escrow.
4. **Review.** Owl runs the code checks first, then a model check. A fail gets one revision; a worker can dispute and a second model decides.
5. **Payout.** On a pass the contract pays the worker and Owl. After the complaint window the referrer, the owners and the reserve get their share. Every step is a NEAR transaction.

The job is small on purpose. What is new is the loop around it: an AI hires another AI, a third AI checks the work against rules fixed before payment, and a contract pays or refunds without a human in the middle.

## What uses NEAR

| Piece | How it is used | Status |
| --- | --- | --- |
| NEAR testnet contract `sharkco.testnet` (Rust) | Escrow, signed quotes, bids, deliveries, reviews, payouts, refunds, strikes and the cage | Live |
| NEAR accounts and keys | Every agent signs its bids and deliveries with its own key; payers sign in with NEP-413 to read deliveries | Live |
| NEAR AI Cloud | The models Crab, Raven and Owl call to do and review the work | Live |
| Sputnik DAO, managed in Trezu | The owners set price bands, the worker cap, budgets and the strike limit by proposal | Live |
| x402 | Agents order and pay in one HTTP call through our facilitator | Live |
| OutLayer TEE | Run Owl's review inside a TEE with an attestation | **Not yet**: Owl runs as a signed service, reviews have no attestation |
| Chain Signatures | Pay Raven on Base Sepolia | **Not yet**: all payouts are on NEAR |

## What you have to trust

| You trust | Because | What limits it |
| --- | --- | --- |
| Shark's key (quotes, the job loop) | It prices jobs and runs the auction | The contract rejects quotes outside the owners' band and fees over the worker cap, and tops up Shark's own wallet by at most the daily budget |
| Owl's operator | Owl runs as a signed service, not yet in a TEE | The code checks are deterministic (`packages/checks`); a worker can dispute a fail and a second model decides |
| NEAR AI Cloud | The workers and Owl call its models | Every result still has to pass the code checks |
| Shark's storage | Briefs, inputs and deliveries are kept off chain | Their hashes are on chain, so a changed file no longer matches |
| The guardian account `sharkco-guardian.testnet` | It can pause the company | It can only pause; it cannot move money |
| The owners DAO | It changes the rules by proposal | Approval is 1 of 1 today (the team) |

## Where it is in the code

| Claim | Code | Tests |
| --- | --- | --- |
| Escrow, quotes, payouts, refunds, strikes | `contracts/company/src/lib.rs` | `contracts/company/src/tests.rs` |
| Brief and checklist per job type | `services/shark/src/brief.ts` | `services/shark/test/quote.test.ts` |
| Signed quotes | `services/shark/src/quote.ts` | `services/shark/test/quote.test.ts` |
| Auction and job loop | `services/shark/src/loop.ts` | `services/shark/test/contract.test.ts` |
| Worker agents (bid, do, deliver) | `services/agents/src/worker.ts` | `services/agents/test/agents.test.ts` |
| Owl's review | `services/agents/src/owl.ts` | `services/agents/test/agents.test.ts` |
| Deterministic code checks | `packages/checks/src`, `owl/checks` | `packages/checks/src/index.test.ts` |
| Owners from the DAO | `services/shark/src/company.ts` | `services/shark/test/contract.test.ts` |
| x402 payment | `services/shark/src/x402.ts`, `services/facilitator` | `services/facilitator/test/facilitator.test.ts` |

## What is real

| Part | Real or not |
| --- | --- |
| Payments, escrow, payouts, refunds | Real NEAR testnet transactions in test USDC |
| Workers and reviewer | Real AI agents on NEAR AI Cloud, each with its own NEAR account |
| The demo job `j_000006` | A real order placed on 11 Nov 2026, paid and finalized on chain |
| Harmful-job filter on the brief | A pattern list for now; the NEAR AI classifier is not wired in |
| TEE attestation, Chain Signatures payout | Not built yet (see the table above) |
| Orders | All 8 orders so far were placed by the team's demo accounts. This is a count of use, not of outside users |

## What comes next

- Run Owl inside an OutLayer TEE so every review carries an attestation.
- Pay Raven on Base Sepolia through Chain Signatures.
- Pay from other chains with NEAR Intents, which runs on mainnet only, when the company moves to mainnet.
- Wire in the NEAR AI classifier for harmful jobs in place of the pattern list.

## Run it locally

Needs Node 24+ and pnpm 11.

```sh
pnpm install
pnpm test          # all packages: 283 tests
pnpm dev           # the web app on http://localhost:3100
```

The contract's 76 unit tests need Rust 1.93 (pinned in `rust-toolchain.toml`). On Windows, add NASM to `PATH` first:

```sh
cd contracts/company && cargo test --lib
```

The sandbox tests (`contracts/company/tests/sandbox.rs`, the real wasm on a local NEAR node) run in Docker; see `contracts/company/README.md`.

Set `NEXT_PUBLIC_API_MODE=mock` in `apps/web/.env.local` to run the web app on sample data with no backend.
The services (`services/shark`, `services/agents`, `services/facilitator`) read their settings from `.env` files; each has a `.env.example`. Never commit the real ones.

## Repo layout

| Path | What |
| --- | --- |
| `apps/web` | Next.js site: landing, order flow, job pages, company dashboard |
| `services/shark` | Shark: briefs, quotes, auction, job loop, public API |
| `services/agents` | Crab, Raven (workers) and Owl (reviewer) |
| `services/facilitator` | x402 facilitator |
| `contracts/company` | The company contract (Rust, NEAR) |
| `contracts/test-usdc` | Test token used in local tests |
| `packages/shared` | Shared types, schemas and money helpers |
| `packages/checks`, `owl/checks` | Code checks Owl runs |
| `docs` | Architecture, API contract and the hackathon rules |
