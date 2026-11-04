// Method 3, x402 v2 (API §1.2, FR-12): the PAYMENT-REQUIRED header on every quote, and the retry with
// PAYMENT-SIGNATURE. Shark verifies and settles through a facilitator, then tells the contract (`mark_paid_x402`),
// which checks its own USDC balance grew. If money landed but no job exists, Shark sends it back (`return_x402`).
import type { Quote402 } from "@shark/shared";
import type { Context } from "hono";
import { z } from "zod";
import type { Chain } from "./chain";
import type { Config } from "./config";
import { HttpError } from "./errors";
import { canonicalJson } from "./quote";
import type { QuoteRow, Store } from "./store";

const MAX_TIMEOUT_SECS = 120; // blocks of about 1 s (API §1.2)
const MIN_QUOTE_LEFT_SECS = 150; // so a settled payment can never meet an expired quote

export const encode = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64");
const decode = (b64: string): unknown => JSON.parse(Buffer.from(b64, "base64").toString("utf8"));

const Requirement = z
  .object({
    scheme: z.literal("exact"),
    network: z.string(),
    amount: z.string(),
    asset: z.string(),
    payTo: z.string(),
    maxTimeoutSeconds: z.number().int(),
    extra: z.object({ quoteId: z.string(), briefHash: z.string() }).strict(),
  })
  .strict();
type Requirement = z.infer<typeof Requirement>;

const PaymentPayload = z.object({
  x402Version: z.literal(2),
  resource: z.object({ url: z.string(), description: z.string().optional(), mimeType: z.string().optional() }).optional(),
  accepted: Requirement,
  payload: z.object({ signedDelegateAction: z.string().min(1) }),
});
export type PaymentPayload = z.infer<typeof PaymentPayload>;

export type Settlement = { success: boolean; errorReason?: string; transaction?: string; network?: string; payer?: string };
export type Facilitator = {
  verify(payload: PaymentPayload, requirement: Requirement): Promise<{ isValid: boolean; invalidReason?: string; payer?: string }>;
  settle(payload: PaymentPayload, requirement: Requirement): Promise<Settlement>;
};

/**
 * POST {url}/verify and {url}/settle with `{ x402Version, paymentPayload, paymentRequirements }` (x402 v2).
 * [VERIFY O-26] the exact key names were not shown verbatim in the docs we could read; check them against the
 * facilitator's /openapi.yaml before the first real payment.
 */
export function httpFacilitator(url: string, apiKey?: string | null, fetchImpl: typeof fetch = (...a) => fetch(...a)): Facilitator {
  const post = async <T>(path: "/verify" | "/settle", payload: PaymentPayload, requirement: Requirement): Promise<T> => {
    const res = await fetchImpl(`${url.replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(apiKey ? { "X-API-Key": apiKey } : {}) },
      body: JSON.stringify({ x402Version: 2, paymentPayload: payload, paymentRequirements: requirement }),
      signal: AbortSignal.timeout(60_000),
    });
    // a 4xx body still carries the facilitator's reason; only an unusable answer is an outage
    const body = (await res.json().catch(() => null)) as T | null;
    if (!body) throw new Error(`facilitator ${path} answered ${res.status}`);
    return body;
  };
  return { verify: (p, r) => post("/verify", p, r), settle: (p, r) => post("/settle", p, r) };
}

/** The one requirement we accept for a quote: exact USDC to the contract, tagged with the quote. */
export function requirementFor(config: Config, q: Pick<Quote402, "quoteId" | "briefHash" | "quote">): Requirement {
  return {
    scheme: "exact",
    network: config.networkId,
    amount: q.quote.price,
    asset: config.usdcId,
    payTo: config.contractId,
    maxTimeoutSeconds: MAX_TIMEOUT_SECS,
    extra: { quoteId: q.quoteId, briefHash: q.briefHash },
  };
}

/** Decoded `PAYMENT-REQUIRED` (x402 v2); \`error\` is set when this answers a failed attempt. */
export function paymentRequired(config: Config, q: Pick<Quote402, "quoteId" | "briefHash" | "quote" | "jobType">, error?: string) {
  return {
    x402Version: 2,
    error: error ?? "PAYMENT-SIGNATURE header is required",
    resource: { url: `${config.publicBaseUrl}/v1/orders`, description: `Shark & Co. ${q.jobType} job ${q.quoteId}`, mimeType: "application/json" },
    accepts: [requirementFor(config, q)],
  };
}

export type X402Deps = {
  config: Config;
  chain: Chain;
  store: Store;
  now: () => number;
  facilitator?: Facilitator;
  /** Refuses to take money while the service is closed, paused, caged or has no worker (FR-09). */
  serviceCheck: (jobType: Quote402["jobType"]) => Promise<void>;
};

// NFR-05: contract calls about payments are serialized
let queue: Promise<unknown> = Promise.resolve();
const serialized = <T>(f: () => Promise<T>): Promise<T> => {
  const run = queue.then(f, f);
  queue = run.catch(() => undefined);
  return run;
};

export async function payWithX402(c: Context, header: string, d: X402Deps) {
  const { config, chain, store, now } = d;
  const orderId = (id: number) => `j_${String(id).padStart(6, "0")}`;
  let row: QuoteRow | undefined;
  let quote: Quote402 | undefined;
  /** A failed attempt answers 402 with the error JSON and a fresh PAYMENT-REQUIRED (when we know the quote). */
  const fail = (code: "x402_invalid" | "x402_settlement_failed", reason: string): never => {
    throw new HttpError(402, code, `The x402 payment didn't go through (${reason}). Nothing was charged.`, { reason }, undefined, quote ? { "PAYMENT-REQUIRED": encode(paymentRequired(config, quote, reason)) } : undefined);
  };

  if (!d.facilitator) return fail("x402_invalid", "not_enabled");
  const parsed = (() => {
    try {
      return PaymentPayload.safeParse(decode(header));
    } catch {
      return null;
    }
  })();
  if (!parsed?.success) return fail("x402_invalid", "malformed");
  const payload = parsed.data;
  row = store.quote(payload.accepted.extra.quoteId);
  if (!row) return fail("x402_invalid", "unknown_quote");
  quote = JSON.parse(row.response) as Quote402;

  // N6: a payment meant for the other network is never settled here
  if (payload.accepted.network !== config.networkId) return fail("x402_invalid", "network");
  const requirement = requirementFor(config, quote);
  if (canonicalJson(payload.accepted) !== canonicalJson(requirement)) return fail("x402_invalid", "requirement_mismatch");

  const paid = await chain.jobByQuote(quote.quoteId);
  if (paid) return c.json({ orderId: orderId(paid.id), status: "paid", statusUrl: `/v1/orders/${orderId(paid.id)}` }, 202);
  if (row.expires_at - now() < MIN_QUOTE_LEFT_SECS) throw new HttpError(410, "quote_expired", "This quote is about to expire. Ask for a new one.");
  await d.serviceCheck(quote.jobType);

  // shortcut: a facilitator that times out mid settle may have moved the money; there is no reconciliation yet, so
  // that case is a 502 and the payer's USDC shows up as an unmatched deposit to return by hand (needs the event reader)
  const verified = await d.facilitator.verify(payload, requirement).catch(unavailable);
  if (!verified.isValid) return fail("x402_invalid", verified.invalidReason ?? "invalid");
  const settled = await d.facilitator.settle(payload, requirement).catch(unavailable);
  if (!settled.success || !settled.transaction) return fail("x402_settlement_failed", settled.errorReason ?? "settlement_failed");

  const settlement = { tx_hash: settled.transaction, payer: settled.payer ?? verified.payer ?? row.payer, amount: quote.quote.price };
  const job = await serialized(async () => {
    try {
      await chain.markPaidX402({ ...quote.quote, referrer: quote.quote.referrer ?? null }, quote.sig, settlement);
      const made = await chain.jobByQuote(quote.quoteId);
      if (made) return made;
    } catch {
      // fall through: the money is in the contract but not matched to a job
    }
    await chain.returnX402(settlement); // fail to refund, never keep
    return null;
  });
  if (!job) return fail("x402_settlement_failed", "returned");

  store.setKv(`paytx:${quote.quoteId}`, settled.transaction);
  c.header("PAYMENT-RESPONSE", encode({ success: true, transaction: settled.transaction, network: config.networkId, payer: settlement.payer }));
  return c.json({ orderId: orderId(job.id), status: "paid", statusUrl: `/v1/orders/${orderId(job.id)}`, payment: { method: "x402", tx: settled.transaction } }, 200);
}

function unavailable(): never {
  throw new HttpError(502, "upstream_unavailable", "Shark can't reach the payment facilitator right now. Check your balance before paying again.", undefined, 30);
}
