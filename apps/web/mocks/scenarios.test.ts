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

  it.each(["testnet", "mainnet"] as const)("%s: dashboard and prices parse", async (n) => {
    const f = createMockFetch(n, "ok");
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
});
