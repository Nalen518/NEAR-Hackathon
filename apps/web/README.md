# Shark & Co. web (apps/web)

Next.js App Router app for Landing, Order, Job and The company. Built on mocks from `packages/shared` until the Shark API serves `/v1` on testnet.

## Run
```bash
pnpm install
pnpm --filter web dev -p 3100   # http://localhost:3100
```
Copy `.env.example` to `.env.local`. With `NEXT_PUBLIC_API_MODE=mock` (the default) every number is sample data.

## Mock scenarios (dev only)
Add `?mock=<name>` to any page, for example `/order?mock=caged` or `/jobs/j_000042?mock=unresolved`. The full list is in `mocks/scenarios.ts` and on `/dev/components`.

## Test
```bash
pnpm --filter web typecheck
pnpm --filter web lint
pnpm --filter web test          # unit: mocks, copy rule D-170, checklist map, counts
pnpm --filter web e2e           # Playwright, needs the dev server on 3100
```

## Rules that bite
- Money is a decimal string in HTTP and `bigint` in code, never a float.
- Green and red only for money moving. Copy has no semicolons, dashes or hyphenated words (D-170). The copy test fails otherwise.
- Customer text and deliveries render as plain text.
- The job page is public. The payer view needs a NEP-413 signature and is never cached for others (D-166).

Docs: `docs/agent-prompt-frontend-v2.1.md`, `docs/web/STATUS-REPORT-2026-10-31.md`, `docs/web/BACKEND-HANDOFF.md`.
