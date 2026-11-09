import { ApiError, Company, Order, OrderPayer, Prices, Quote402, QuoteStatus } from "@shark/shared";
import { describe, expect, it } from "vitest";
import { createMockFetch, orderFor, SCENARIOS, toPublic, type Scenario } from "./scenarios";

const scenarios = Object.keys(SCENARIOS) as Scenario[];

describe("every mock scenario speaks the API contract", () => {
  it.each(scenarios)("%s: orders parse in both views at every step", (s) => {
    for (let step = 1; step <= 12; step++) {
      const o = orderFor("j_000042", "testnet", s, Date.parse("2026-11-05T08:13:02Z"), step);
      expect(() => OrderPayer.parse(o)).not.toThrow();
      const pub = Order.parse(toPublic(o));
      expect(pub).not.toHaveProperty("delivery"); // D-166
    }
  });

  it("delivery is withheld for refunded and unresolved jobs", () => {
    for (const s of ["refunded", "unresolved", "complaint_upheld"] as const) expect(orderFor("j_000042", "testnet", s, 0).delivery).toBeNull();
    expect(orderFor("j_000042", "testnet", "ok", 0).delivery).not.toBeNull();
  });

  it("dashboard and prices parse", async () => {
    const f = createMockFetch("testnet", "ok");
    Company.parse(await (await f("/v1/company")).json());
    Prices.parse(await (await f("/v1/prices")).json());
  });

  it("order → 402 → pay → quote PAID", async () => {
    const f = createMockFetch("testnet", "ok");
    const res = await f("/v1/orders", { method: "POST", body: JSON.stringify({ jobType: "thread", payer: "demo-buyer.testnet", instructions: "x" }) });
    expect(res.status).toBe(402);
    const q = Quote402.parse(await res.json());
    expect(q.price).toBe("1.20");
    expect(q.pay.args.amount).toBe(q.quote.price);
    const { mockChainCall } = await import("./scenarios");
    mockChainCall("demo-buyer.testnet", "ft_transfer_call", q.pay.args);
    const st = QuoteStatus.parse(await (await f(`/v1/quotes/${q.quoteId}`)).json());
    expect(st.status).toBe("PAID");
  });

  it.each(["refused", "infeasible", "too_large", "caged", "rate_limited"] as const)("%s: error body follows §0.1", async (s) => {
    const res = await createMockFetch("testnet", s)("/v1/orders", { method: "POST", body: JSON.stringify({ jobType: "summary", payer: "a.testnet" }) });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(ApiError.parse(await res.json()).charged).toBe(false);
  });

  it("a NEP-413 nonce works once, like Shark's (payer view and complaint)", async () => {
    const f = createMockFetch("testnet", "ok");
    const auth = (kind: "view" | "complain", nonce: string) => ({ accountId: "demo-buyer.testnet", publicKey: "ed25519:SAMPLE", signature: "SAMPLE", message: `sharkco:${kind}:j_000042:1`, nonce, recipient: "c" });
    const view = (nonce: string) => f("/v1/orders/j_000042/view", { method: "POST", body: JSON.stringify(auth("view", nonce)) });
    expect((await view("n1")).status).toBe(200);
    const again = await view("n1");
    expect(again.status).toBe(401);
    expect((await again.json()).error).toBe("payer_signature_invalid");
    expect((await view("n2")).status).toBe(200);
  });
});
