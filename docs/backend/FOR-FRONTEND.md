# Backend to web: what changed, and what the web still needs for W6

**From:** the backend agent. **Status:** no web session was running when this was written, so this note is the message. Whoever works on `apps/web` next should read it first.

The backend is built and tested on a fake chain and a local NEAR node. It has **not** been deployed to testnet yet, so the web has still never talked to a real Shark. Everything below is testnet only.

## 1. Changes the web already has (commit `24a1c58`) or got from the backend

- `X402PaymentRequired` is now the x402 v2 shape. `InfeasibleDetails` and `InfeasibleFix` exist for `brief_infeasible` (`details.fixes[]` with prices). Order `params` are strict. `order_not_found` is in `ERROR_CODES`.
- One web file was touched by the backend: `apps/web/components/company/Company.tsx`. The incidents heading is now "complaints, disputes and failures" (commit `ab844a4`).
- `Incident.kind` has four new values: `strike`, `late`, `worker_suspended`, `payout_failed` (shared schema). The company page shows a kind as its name with the underscore turned into a space, so it already displays.

## 2. Small things the web should do

1. **Labels and icons for the four new incident kinds.** Today they fall back to plain text. The mock scenarios (`apps/web/mocks/scenarios.ts`) have no incident of these kinds, so no test shows them. Add one of each to the mocks, and a Playwright check.
2. **Raven gas shows "0 Sepolia ETH, unknown payouts left" until the owner gives Shark a Base Sepolia RPC URL and address.** That reads like an empty tank. When `payoutsLeft` is `null` and `balanceEth` is `"0"`, show "not connected" instead of 0. The backend cannot flag this with `sample` without marking the whole reserve section as sample.
3. **`company.owners` is always `sample: true` by decision** (no DAO yet). Keep the SAMPLE label there.
4. **`pnl7d.ownersPaid` is real now** (a new contract counter). It covers the last 7 days once Shark has run for a week. Before that it shows everything paid.
5. **`config.changedAt` and `config.changeTx` are real.** `changedByProposal` stays `null`. Show the tx as a link when it is set.
6. `payouts` is `sample: true` when Shark's event reader is switched off (`TESTNET_EVENTS_URL=off`). The web already reads the flag.

## 3. What W6 needs from the web (not started)

- **Real wallet.** NEAR Wallet Selector with `signAndSendTransaction` and `signMessage` (NEP-413, recipient and nonce as in the API contract). `NEXT_PUBLIC_TESTNET_WALLETS` is empty until then.
- **Payment.** The 402 response carries `pay.args` for `ft_transfer_call` (attach 1 yocto, 100 Tgas). If `quote.payerRegistered` is false the wallet must first call `register` (a `storage_deposit` on the USDC token). The order flow already has the button.
- **Env values** (after the deploy, see `docs/backend/DEPLOY-TESTNET.md` section 8): `NEXT_PUBLIC_API_MODE=live`, API URL ending in `/v1`, RPC, contract, USDC, faucet and both explorer URLs.
- **CORS.** Shark allows `http://localhost:3100` and whatever the owner puts in `WEB_ORIGINS`. The deployed web origin must be added there.
- **First live run.** Use the Playwright specs against a local Shark first. Any response that fails a zod schema is a backend bug: send the response body back to the backend agent.

## 4. What the web can rely on

- Money is a decimal string with at most 6 places. Times are ISO 8601 UTC with `Z`. Lists are newest first except `timeline`.
- The public order view never has instructions or delivery. The payer view needs a valid NEP-413 signature, else `401 payer_signature_invalid`. `delivery` is `null` until a review passes.
- All text the web shows follows D-170. The backend tests check its own strings for it.
- `GET /v1/company` is one call that reads about 15 RPC values. Do not poll it faster than every 10 seconds. Shark has no cache on it yet, so it is the slowest endpoint.
- `GET /v1/openapi.json` lists every route and is checked against the served routes in a test.
