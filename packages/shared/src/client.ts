import { z } from "zod";
import {
  ApiError,
  Company,
  ComplaintAccepted,
  ComplaintRequest,
  Health,
  Order,
  OrderAccepted,
  OrderPayer,
  OrderRequest,
  PaymentOptions,
  Prices,
  Quote402,
  QuoteStatus,
  SignedMessage,
  UploadResult,
} from "./schemas";

/** The API answered with a documented error body (§0.1). */
export class SharkApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiError,
    readonly retryAfter: number | null,
  ) {
    super(`${status} ${body.error}: ${body.message}`);
  }
}

/** The response didn't match API-CONTRACT. Shown to the user, never swallowed. */
export class ContractMismatchError extends Error {
  constructor(
    readonly path: string,
    readonly issues: z.core.$ZodIssue[],
  ) {
    super(`Response from ${path} doesn't match the API contract: ${z.prettifyError(new z.ZodError(issues))}`);
  }
}

/** API §0.3 N1: a response says it is from the other network. Nothing from it is shown or paid. */
export class NetworkMismatchError extends Error {
  constructor(
    readonly path: string,
    readonly expected: string,
    readonly got: string,
  ) {
    super(`${path} answered for ${got}, but ${expected} is selected`);
  }
}

/** The CAIP-2 network a response states: top-level `network`, or the signed quote's. */
function statedNetwork(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const b = body as { network?: unknown; quote?: { network?: unknown } };
  if (typeof b.network === "string") return b.network;
  return typeof b.quote?.network === "string" ? b.quote.network : null;
}

export type OrderResponse =
  | { kind: "quote"; quote: Quote402 }
  | { kind: "accepted"; accepted: z.infer<typeof OrderAccepted> };

/** `expectNetwork` (CAIP-2) rejects any response that states another network (API §0.3 N1). */
export function createSharkClient(baseUrl: string, fetchImpl: typeof fetch = (...a) => fetch(...a), expectNetwork?: string) {
  // Paths below start with /v1, so a base that already ends in /v1 (API-CONTRACT §5.1 writes it that way) is trimmed.
  const base = baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");

  async function call<S extends z.ZodType>(path: string, schema: S, init?: RequestInit, ok = [200]): Promise<z.infer<S>> {
    const res = await fetchImpl(`${base}${path}`, init);
    const body: unknown = await res.json().catch(() => null);
    if (!ok.includes(res.status)) {
      const err = ApiError.safeParse(body);
      if (!err.success) throw new ContractMismatchError(path, err.error.issues);
      const ra = res.headers.get("Retry-After");
      throw new SharkApiError(res.status, err.data, ra && /^\d+$/.test(ra) ? Number(ra) : null);
    }
    // The network check comes before the shape check: the schemas accept near:testnet only, so a host for another
    // network would otherwise surface as a contract mismatch instead of the clearer network mismatch.
    const got = statedNetwork(body);
    if (expectNetwork && got && got !== expectNetwork) throw new NetworkMismatchError(path, expectNetwork, got);
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw new ContractMismatchError(path, parsed.error.issues);
    return parsed.data;
  }

  const json = (body: unknown, headers: Record<string, string> = {}): RequestInit => ({
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const orderPath = (id: string) => `/v1/orders/${encodeURIComponent(id)}`;

  return {
    prices: () => call("/v1/prices", Prices),
    company: () => call("/v1/company", Company),
    health: () => call("/v1/health", Health),
    paymentOptions: () => call("/v1/payment-options", PaymentOptions),
    quote: (quoteId: string) => call(`/v1/quotes/${encodeURIComponent(quoteId)}`, QuoteStatus),
    /** Public view unless the API is given a payer signature (D-166). */
    order: (orderId: string) => call(orderPath(orderId), Order),
    /** v2.3 P1: payer view after a NEP-413 signature. Never cache this for other visitors. */
    orderAsPayer: (orderId: string, auth: SignedMessage) =>
      call(`${orderPath(orderId)}/view`, OrderPayer, { ...json(SignedMessage.parse(auth)), cache: "no-store" }),
    complain: (orderId: string, req: ComplaintRequest) =>
      call(`${orderPath(orderId)}/complaint`, ComplaintAccepted, json(ComplaintRequest.parse(req)), [202]),
    upload: (file: Blob, name: string) => {
      const form = new FormData();
      form.append("file", file, name);
      return call("/v1/uploads", UploadResult, { method: "POST", body: form });
    },
    /** 402 = quote; 202 = Idempotency-Key replay after payment (§1.2). 200 is x402 only, which the web never sends. */
    async order402(req: OrderRequest, idempotencyKey: string): Promise<OrderResponse> {
      const res = await call(
        "/v1/orders",
        z.union([Quote402, OrderAccepted]),
        json(OrderRequest.parse(req), { "Idempotency-Key": idempotencyKey }),
        [402, 202],
      );
      return "quoteId" in res ? { kind: "quote", quote: res } : { kind: "accepted", accepted: res };
    },
  };
}

export type SharkClient = ReturnType<typeof createSharkClient>;
