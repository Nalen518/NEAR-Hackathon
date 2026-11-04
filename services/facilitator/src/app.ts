// Our own x402 facilitator for NEAR (D-154): /verify, /settle and /supported over `@x402/core`'s facilitator.
// A relayer account pays the gas of every settlement, so this service is closed by default: it needs Shark's API key
// and only settles payments to our own contract in our own USDC. Anything else is refused before it costs gas.
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import { Hono } from "hono";

/** The part of `x402Facilitator` this service uses, so tests can bring a fake. */
export type FacilitatorCore = {
  getSupported(): unknown;
  verify(payload: PaymentPayload, requirements: PaymentRequirements): Promise<unknown>;
  settle(payload: PaymentPayload, requirements: PaymentRequirements): Promise<unknown>;
};

export type Policy = { network: string; asset: string; payTo: string };
export type FacilitatorAppOptions = { core: FacilitatorCore; apiKeys: string[]; policy: Policy; log?: (o: Record<string, unknown>) => void };

type Body = { x402Version?: number; paymentPayload?: PaymentPayload; paymentRequirements?: PaymentRequirements };

export function createFacilitatorApp({ core, apiKeys, policy, log = (o) => console.log(JSON.stringify(o)) }: FacilitatorAppOptions) {
  const app = new Hono();
  const keys = new Set(apiKeys.filter(Boolean));

  app.get("/healthz", (c) => c.json({ ok: true }));
  app.get("/supported", (c) => c.json(core.getSupported())); // public, like other facilitators

  app.use("/verify", requireKey(keys));
  app.use("/settle", requireKey(keys));

  /** Parses the body and applies the policy; null means a response was already built. */
  const parse = async (c: import("hono").Context, settle: boolean) => {
    const body = (await c.req.json().catch(() => null)) as Body | null;
    if (body?.x402Version !== 2 || !body.paymentPayload || !body.paymentRequirements) {
      c.status(400);
      return { error: settle ? { success: false, errorReason: "invalid_request", transaction: "", network: policy.network } : { isValid: false, invalidReason: "invalid_request" } };
    }
    const r = body.paymentRequirements;
    if (r.network !== policy.network || r.asset !== policy.asset || r.payTo !== policy.payTo || r.scheme !== "exact") {
      c.status(403);
      return { error: settle ? { success: false, errorReason: "not_allowed", transaction: "", network: policy.network } : { isValid: false, invalidReason: "not_allowed" } };
    }
    return { payload: body.paymentPayload, requirements: r };
  };

  app.post("/verify", async (c) => {
    const p = await parse(c, false);
    if (p.error) return c.json(p.error);
    return c.json(await core.verify(p.payload, p.requirements));
  });

  app.post("/settle", async (c) => {
    const p = await parse(c, true);
    if (p.error) return c.json(p.error);
    const result = (await core.settle(p.payload, p.requirements)) as { success?: boolean; transaction?: string; errorReason?: string };
    log({ level: "info", settle: result.success ? "ok" : "failed", tx: result.transaction, reason: result.errorReason });
    return c.json(result);
  });

  return app;
}

function requireKey(keys: Set<string>) {
  return async (c: import("hono").Context, next: () => Promise<void>) => {
    const header = c.req.header("X-API-Key") ?? c.req.header("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    if (!keys.size || !keys.has(header)) return c.json({ error: "unauthorized" }, 401);
    return next();
  };
}
