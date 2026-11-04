# Testnet deploy runbook

Everything here is **testnet only**. Nothing in this folder signs or sends on its own: `plan.mjs` and `order.mjs` print commands, and you run each one. Anything that signs, spends or deploys needs the owner's yes, each time.

Secrets (`*.env`, keys) stay on this machine. They are git-ignored, and the helper scripts never print a secret.

## 0. What you need

| What | Who makes it | Notes |
| --- | --- | --- |
| `near` CLI with a testnet keychain holding the owner key | you | `near account import-account` if the accounts were made in a wallet |
| Accounts (all `.testnet`): contract, owner, guardian, shark, wallet, crab, raven, owl, demo buyer | you (done) | the contract account is only for the contract, not for signing anything else |
| `contracts/company/target/near/company.wasm` | `cd contracts/company && cargo near build non-reproducible-wasm --no-abi` | rebuild after any contract change |
| Test USDC on testnet | https://faucet.circle.com (Near Testnet) | 20 for the owner, a few for the buyer |
| Optional: `x402-relayer.<you>.testnet` | you | only to run our own x402 facilitator (section 7) |
| Later: a NEAR AI key, a Base Sepolia RPC URL and Raven's address there | you | not needed for the first run |

No USDC from the faucet yet? `contracts/test-usdc` is a mock token with a faucet. Deploy it to a spare account and use that account as `usdc`. The real Circle token is the better demo.

## 1. Keys

Each service gets its own key. The script writes the secret into a git-ignored env file and prints only the public key.

```bash
cd services/shark
node scripts/make-key.mjs .env SHARK_QUOTE_KEY
node scripts/make-key.mjs .env SHARK_FN_KEY
node scripts/make-key.mjs .env SHARK_WALLET_KEY
cd ../agents
node ../shark/scripts/make-key.mjs .env.crab CRAB_KEY
node ../shark/scripts/make-key.mjs .env.raven RAVEN_KEY
node ../shark/scripts/make-key.mjs .env.owl OWL_KEY
```

Copy `contracts/deploy/accounts.example.json` to `contracts/deploy/accounts.local.json` (git-ignored) and fill in the account names and the five public keys plus `quotePublicKey` (the public half of `SHARK_QUOTE_KEY`).

## 2. The plan

```bash
node contracts/deploy/plan.mjs contracts/deploy/accounts.local.json
```

Add `--fast-demo` to shorten the complaint, dispute and review windows to minutes, so a whole demo (including a dispute) finishes while you watch. It refuses to run while any placeholder is left, and it checks its config against the Rust `Config` struct.

It prints seven steps and writes their argument files to `contracts/deploy/out/`:

1. Add the services' keys. Function-call keys for Shark, Crab, Raven and Owl, limited to their own methods. The wallet key is full access because it pays escrow and gas.
2. Deploy the contract and run `new` in one transaction.
3. Send the contract 1 NEAR (it pays the USDC storage for refunds).
4. Register every USDC receiver on the token (`storage_deposit`).
5. Register Crab, Raven and Owl.
6. Get test USDC from the faucet.
7. Seed the reserve with 16.10 USDC, then `fund_shark`.

Run them in order. Each command signs, so each needs the owner's yes. Afterwards the read-only checks below must pass before anything else starts.

## 3. Check the chain (read only)

```bash
near contract call-function as-read-only <contract> get_roles json-args '{}' network-config testnet now
near contract call-function as-read-only <contract> get_stats json-args '{}' network-config testnet now
near contract call-function as-read-only <contract> get_workers json-args '{}' network-config testnet now
```

Expect: the right owner, guardian, Shark, wallet and USDC in `get_roles`; `reserve` of `16100000` less what `fund_shark` moved in `get_stats`; two workers in `get_workers`.

## 4. Shark

`services/shark/.env` (names are in `.env.example`):

| Name | Value |
| --- | --- |
| `SHARK_NETWORK` | `testnet` |
| `TESTNET_RPC_URL` | `https://rpc.testnet.near.org` (or FastNEAR's) |
| `TESTNET_CONTRACT_ID`, `TESTNET_USDC_ID` | from `accounts.local.json` |
| `TESTNET_SHARK_ID`, `TESTNET_SHARK_WALLET_ID` | the shark and wallet accounts |
| `TESTNET_CRAB_ID`, `TESTNET_RAVEN_ID`, `TESTNET_OWL_ID` | the agent accounts |
| `TESTNET_CRAB_URL`, `TESTNET_RAVEN_URL` | where the agents listen, Crab `http://localhost:8788`, Raven `http://localhost:8789` by default |
| `TESTNET_USDC_FAUCET_URL` | `https://faucet.circle.com` |
| `WEB_ORIGINS` | `http://localhost:3100` plus the deployed web origin, comma separated |
| `CACHE_SECS` | optional, default 10: how long `/v1/company`, `/v1/prices` and `/v1/health` are kept in memory |
| `PUBLIC_BASE_URL` | where agents reach this Shark |
| `TESTNET_EVM_RPC_URL`, `TESTNET_RAVEN_EVM_ADDRESS` | optional: the gas gauge on the company page. Placeholder until set |

The three secrets are already in the file from step 1.

```bash
pnpm --filter @shark/service start
curl http://localhost:8787/v1/health
```

`health` should answer `ok`. If the contract is paused, caged or closed it says so.

## 5. First order, paid by hand

The web has no real wallet until W6, so the first order is placed with a script and paid with one `near` command.

```bash
cd services/shark
node scripts/order.mjs http://localhost:8787 <buyer account> summary "Summarise in 100 words." "Some text to work from..."
```

It prints the quote and the exact payment command (`ft_transfer_call` to the contract with the signed quote). Run that yourself, then watch:

```bash
curl http://localhost:8787/v1/quotes/<quote id>
```

Shark picks the paid job up within 15 seconds and runs the auction. Without agents running there are no bids, so the job waits. With them (section 6) it goes on through work, review and payout.

## 6. Agents (needs a NEAR AI key)

`services/agents/.env.crab`, `.env.raven`, `.env.owl`: `AGENT_ROLE`, the network, contract and Shark API URL, the account ids, the model names, `NEARAI_BASE_URL`, `NEARAI_API_KEY`, `PORT`, and the role's key from step 1. Then, one terminal each:

```bash
pnpm --filter @shark/agents start:crab
pnpm --filter @shark/agents start:raven
pnpm --filter @shark/agents start:owl
```

Known shortcuts at this stage (all in `checklist.md`): Owl posts its review directly, so there is no TEE attestation yet. Raven's Base payout is not wired. The safety filter is a pattern list.

## 7. Our x402 facilitator (optional)

Only needed to test method 3 (agents paying over x402). Create and fund `x402-relayer.<you>.testnet`, then fill `services/facilitator/.env` (`X402_RELAYER_KEY`, `X402_API_KEY`, ids) and run `pnpm --filter @shark/facilitator start`. In Shark's `.env` set `TESTNET_X402_FACILITATOR_URL` to it and `TESTNET_X402_API_KEY` to the same key.

## 8. Point the web at it (A12)

In `apps/web/.env.local`:

```
NEXT_PUBLIC_API_MODE=live
NEXT_PUBLIC_TESTNET_API_URL=http://localhost:8787
NEXT_PUBLIC_TESTNET_RPC_URL=<same RPC as Shark>
NEXT_PUBLIC_TESTNET_CONTRACT_ID=<contract>
NEXT_PUBLIC_TESTNET_USDC_ID=<usdc>
NEXT_PUBLIC_TESTNET_NETWORK_ID=near:testnet
NEXT_PUBLIC_TESTNET_USDC_FAUCET_URL=https://faucet.circle.com
NEXT_PUBLIC_TESTNET_EXPLORER_URL=https://testnet.nearblocks.io
NEXT_PUBLIC_TESTNET_EVM_EXPLORER_URL=https://sepolia.basescan.org
```

The wallet list (`NEXT_PUBLIC_TESTNET_WALLETS`) waits for W6.

## 9. Safety

- The guardian can `pause` the contract, and nothing else.
- The owner can `set_config`. `wind_down` (after a pause, with nothing open or owed) sends all USDC to the owner account and closes the contract.
- Nothing here touches mainnet. If any command names a mainnet account or RPC, stop.
- The contract has no `set_owner`. Moving to a DAO later means a redeploy on testnet. Decide that before the final demo.
- **A changed contract cannot be deployed over the old one.** The contract saves its state in a fixed layout, so after any change to its fields the new code on the same account fails every call with "cannot deserialize the contract state". Redeploy to a fresh account (for example `sharkco-2.testnet`) and change `contract` in `accounts.local.json`, `TESTNET_CONTRACT_ID` in the `.env` files and the web's contract id. Or delete the account and create it again.
- **Behind a proxy:** Shark's rate limit uses the last `x-forwarded-for` value. Use a host whose proxy adds the real client address (Railway and Fly do), not one that passes the header through unchanged.
- Keep `contracts/deploy/accounts.local.json` and every `.env*` file out of git. The commit hook runs a secret scan.
