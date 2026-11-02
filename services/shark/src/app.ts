// Shark HTTP API `/v1/*` (API-CONTRACT v2.3 §1). Every response states this host's network (§0.3 N1).
import { fromBase, JobType, type PaymentOptions, type Prices } from "@shark/shared";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Chain } from "./chain";
import type { Config } from "./config";
import { HttpError, sendError } from "./errors";
import { orderRoutes } from "./orders";
import type { Store } from "./store";

export type Deps = { config: Config; chain: Chain; store: Store; now?: () => number; fetchImpl?: typeof fetch };

export function createApp({ config, chain, store, now = () => Math.floor(Date.now() / 1000), fetchImpl }: Deps) {
  const app = new Hono();

  app.use(
    "/v1/*",
    cors({
      origin: config.webOrigins,
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Content-Type", "Idempotency-Key", "PAYMENT-SIGNATURE"],
      exposeHeaders: ["Retry-After", "WWW-Authenticate", "PAYMENT-REQUIRED", "PAYMENT-RESPONSE"],
    }),
  );

  // §0.2: > 30 requests/min per IP → 429. shortcut: in memory, one host; move to the store if Shark ever runs on several
  const hits = new Map<string, { minute: number; n: number }>();
  app.use("/v1/*", async (c, next) => {
    if (c.req.method === "OPTIONS") return next();
    const ip = c.req.header("x-forwarded-for")?.split(",")[0].trim() ?? "local";
    const minute = Math.floor(now() / 60);
    const h = hits.get(ip);
    const n = h && h.minute === minute ? h.n + 1 : 1;
    hits.set(ip, { minute, n });
    if (n > config.rateLimitPerMin) throw new HttpError(429, "rate_limited", "Too many requests. Wait a minute and try again.", undefined, 60 - (now() % 60));
    return next();
  });

  app.onError((err, c) => {
    if (err instanceof HttpError) return sendError(c, err);
    console.error(JSON.stringify({ level: "error", path: c.req.path, error: String(err) }));
    return sendError(c, new HttpError(502, "upstream_unavailable", "Shark can't reach NEAR right now. Nothing was charged.", undefined, 30));
  });

  // shortcut: state is the contract's only; no_worker and out_of_budget join when workers and the wallet exist
  const serviceState = () => chain.serviceState();

  app.get("/v1/health", async (c) =>
    c.json({ ok: true, network: config.networkId, state: await serviceState(), contract: config.contractId, version: config.version }),
  );

  app.get("/v1/prices", async (c) => {
    const cfg = await chain.config();
    const floors = await Promise.all(JobType.options.map((t) => chain.priceFloor(t)));
    const types = Object.fromEntries(
      JobType.options.map((t, i) => [
        t,
        { band: { min: fromBase(BigInt(cfg[t].band_min)), max: fromBase(BigInt(cfg[t].band_max)) }, floor: fromBase(BigInt(floors[i])) },
      ]),
    ) as Prices["types"];
    // shortcut: recentQuotes stays empty until quotes are stored (POST /v1/orders)
    const body: Prices & { network: string } = { network: config.networkId, types, recentQuotes: [] };
    return c.json(body);
  });

  app.get("/v1/payment-options", (c) => {
    const options: PaymentOptions["options"] = [
      { method: "quote", token: config.usdcId, label: config.network === "testnet" ? "test USDC (no real value)" : "USDC", faucet: config.usdcFaucetUrl ? { url: config.usdcFaucetUrl } : null },
    ];
    if (config.x402FacilitatorUrl)
      options.push({ method: "x402", scheme: "exact", network: config.networkId, asset: config.usdcId, facilitator: config.x402FacilitatorUrl });
    return c.json({ network: config.networkId, options } satisfies PaymentOptions);
  });

  orderRoutes(app, { config, chain, store, now, fetchImpl });

  return app;
}
