// Shark HTTP API `/v1/*` (API-CONTRACT v2.3 §1). Every response states this host's network (§0.3 N1).
import type { PaymentOptions } from "@shark/shared";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { agentRoutes } from "./agents";
import type { Chain } from "./chain";
import { companyOf, pricesOf, serviceStateOf } from "./company";
import type { Config } from "./config";
import { HttpError, sendError } from "./errors";
import { openApi } from "./openapi";
import { orderRoutes } from "./orders";
import { httpFacilitator, type Facilitator } from "./x402";
import type { Store } from "./store";

export type Deps = { config: Config; chain: Chain; store: Store; now?: () => number; fetchImpl?: typeof fetch; facilitator?: Facilitator };

export function createApp({ config, chain, store, now = () => Math.floor(Date.now() / 1000), fetchImpl, facilitator }: Deps) {
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

  // §0.2: > 30 requests/min per IP → 429. shortcut: in memory, one host; move to the store if Shark ever runs on several.
  // The IP is the LAST x-forwarded-for value: the one the host's proxy added, which a client cannot fake. The first can be.
  const hits = new Map<string, { minute: number; n: number }>();
  let sweptAt = 0;
  app.use("/v1/*", async (c, next) => {
    if (c.req.method === "OPTIONS") return next();
    const ip = c.req.header("x-forwarded-for")?.split(",").at(-1)?.trim() || "local";
    const minute = Math.floor(now() / 60);
    if (minute !== sweptAt) {
      sweptAt = minute;
      for (const [k, v] of hits) if (v.minute < minute) hits.delete(k); // old minutes count for nothing
    }
    const h = hits.get(ip);
    const n = h && h.minute === minute ? h.n + 1 : 1;
    hits.set(ip, { minute, n });
    if (n > config.rateLimitPerMin) throw new HttpError(429, "rate_limited", "Too many requests. Wait a minute and try again.", undefined, 60 - (now() % 60));
    return next();
  });

  // The biggest legitimate body is a 2 MB upload plus form overhead. Without this a single huge POST fills the memory
  // before any size or login check runs.
  app.use("/v1/*", bodyLimit({ maxSize: 3 * 1024 * 1024, onError: (c) => sendError(c, new HttpError(413, "input_too_large", "The request is over 3 MB. Nothing was charged.")) }));

  app.onError((err, c) => {
    if (err instanceof HttpError) return sendError(c, err);
    console.error(JSON.stringify({ level: "error", path: c.req.path, error: String(err) }));
    return sendError(c, new HttpError(502, "upstream_unavailable", "Shark can't reach NEAR right now. Nothing was charged.", undefined, 30));
  });

  // The three public reads are the heavy ones (a dozen RPC calls each) and every visitor polls them, so they are kept for
  // `cacheSecs`. A call already in flight is shared, and a failure is not kept.
  const cached = <T>(read: () => Promise<T>) => {
    let at = 0;
    let hit: Promise<T> | undefined;
    return () => {
      if (!hit || now() - at >= config.cacheSecs) {
        at = now();
        const p = (hit = read());
        p.catch(() => hit === p && (hit = undefined));
      }
      return hit;
    };
  };
  const serviceState = cached(() => serviceStateOf(config, chain));
  const prices = cached(() => pricesOf(chain, store, now()));
  const company = cached(() => companyOf(config, chain, store, now()));

  app.get("/v1/health", async (c) =>
    c.json({ ok: true, network: config.networkId, state: await serviceState(), contract: config.contractId, version: config.version }),
  );

  app.get("/v1/prices", async (c) => c.json({ network: config.networkId, ...(await prices()) }));

  const openapi = openApi(config);
  app.get("/v1/openapi.json", (c) => c.json(openapi));

  app.get("/v1/company", async (c) => c.json(await company()));

  app.get("/v1/payment-options", (c) => {
    const options: PaymentOptions["options"] = [
      { method: "quote", token: config.usdcId, label: config.network === "testnet" ? "test USDC (no real value)" : "USDC", faucet: config.usdcFaucetUrl ? { url: config.usdcFaucetUrl } : null },
    ];
    if (config.x402FacilitatorUrl)
      options.push({ method: "x402", scheme: "exact", network: config.networkId, asset: config.usdcId, facilitator: config.x402FacilitatorUrl });
    return c.json({ network: config.networkId, options } satisfies PaymentOptions);
  });

  const x402 = facilitator ?? (config.x402FacilitatorUrl ? httpFacilitator(config.x402FacilitatorUrl, config.x402ApiKey) : undefined);
  orderRoutes(app, { config, chain, store, now, fetchImpl, facilitator: x402 });
  agentRoutes(app, { config, chain, store, now });

  return app;
}
