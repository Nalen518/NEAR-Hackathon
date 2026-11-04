# Backend to web: what changed, and what the web still needs for W6

**From:** the backend agent. **Status (4 Nov):** the web agent has done everything in section 2 and confirmed that web and backend are settled except W6 (section 3). It reported its work in commits `a2905b0` to `2010538`.

The backend is built and tested on a fake chain and a local NEAR node. It has **not** been deployed to testnet yet, so the web has still never talked to a real Shark. Everything below is testnet only.

## 1. Changes the web already has (commit `24a1c58`) or got from the backend

- `X402PaymentRequired` is now the x402 v2 shape. `InfeasibleDetails` and `InfeasibleFix` exist for `brief_infeasible` (`details.fixes[]` with prices). Order `params` are strict. `order_not_found` is in `ERROR_CODES`.
- One web file was touched by the backend: `apps/web/components/company/Company.tsx`. The incidents heading is now "complaints, disputes and failures" (commit `ab844a4`).
- `Incident.kind` has four new values: `strike`, `late`, `worker_suspended`, `payout_failed` (shared schema). The company page shows a kind as its name with the underscore turned into a space, so it already displays.

## 2. Small things the web should do (all done by the web agent)

1. ✅ **Labels and icons for the four new incident kinds.** Today they fall back to plain text. The mock scenarios (`apps/web/mocks/scenarios.ts`) have no incident of these kinds, so no test shows them. Add one of each to the mocks, and a Playwright check.
2. ✅ **Raven gas shows "0 Sepolia ETH, unknown payouts left" until the owner gives Shark a Base Sepolia RPC URL and address.** That reads like an empty tank. When `payoutsLeft` is `null` and `balanceEth` is `"0"`, show "not connected" instead of 0. The backend cannot flag this with `sample` without marking the whole reserve section as sample.
3. **`company.owners` is always `sample: true` by decision** (no DAO yet). Keep the SAMPLE label there.
4. **`pnl7d.ownersPaid` is real now** (a new contract counter). It covers the last 7 days once Shark has run for a week. Before that it shows everything paid.
5. ✅ **`config.changedAt` and `config.changeTx` are real.** `changedByProposal` stays `null`. Show the tx as a link when it is set.
6. ✅ **Payer view.** The web fetches it once per signature (no interval, no refetch on focus or reconnect) and takes status, timeline, money and reviews from the public view, so the 5 minute limit of D-173 is never reached. If the job becomes delivered after the payer signed, the page asks to sign again. Complaints sign a fresh message each time. Code: `apps/web/lib/payer-view.ts`.
7. `payouts` is `sample: true` when Shark's event reader is switched off (`TESTNET_EVENTS_URL=off`). The web already reads the flag.

## 3. What W6 needs from the web (not started, waits for the testnet deploy and the owner's yes)

- **Real wallet.** NEAR Wallet Selector with `signAndSendTransaction` and `signMessage` (NEP-413, recipient and nonce as in the API contract). `NEXT_PUBLIC_TESTNET_WALLETS` is empty until then.
- **Payment.** The 402 response carries `pay.args` for `ft_transfer_call` (attach 1 yocto, 100 Tgas). If `quote.payerRegistered` is false the wallet must first call `register` (a `storage_deposit` on the USDC token). The order flow already has the button.
- **Env values** (after the deploy, see `docs/backend/DEPLOY-TESTNET.md` section 8): `NEXT_PUBLIC_API_MODE=live`, `NEXT_PUBLIC_TESTNET_API_URL` is the origin only, e.g. `http://localhost:8787` (the client adds `/v1/...` itself), RPC, contract, USDC, faucet and both explorer URLs.
- **CORS.** Shark allows `http://localhost:3100` and whatever the owner puts in `WEB_ORIGINS`. The deployed web origin must be added there.
- **First live run.** Use the Playwright specs against a local Shark first. Any response that fails a zod schema is a backend bug: send the response body back to the backend agent.

## 4. What the web can rely on

- Money is a decimal string with at most 6 places. Times are ISO 8601 UTC with `Z`. Lists are newest first except `timeline`.
- The public order view never has instructions or delivery. The payer view needs a valid NEP-413 signature, else `401 payer_signature_invalid`. `delivery` is `null` until a review passes.
- All text the web shows follows D-170. The backend tests check its own strings for it.
- `GET /v1/company`, `/v1/prices` and `/v1/health` are kept in Shark's memory for 10 seconds (`CACHE_SECS`), so polling faster than that gains nothing.
- **Payer view signature:** it may be sent again with the same signature for the same account and order until it is 5 minutes old (D-173). The web does not need that, because it fetches once per signature. A complaint signature works once.
- Rate limit: 30 requests a minute per client IP (the last `x-forwarded-for` value). The web polls about 8 a minute on the job page and 12 on the order page, so one or two tabs fit. People behind one shared IP can still reach 429, and `RATE_LIMIT_PER_MIN` can be raised for a demo.
- `GET /v1/openapi.json` lists every route and is checked against the served routes in a test.
