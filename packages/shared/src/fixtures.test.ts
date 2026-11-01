import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { ApiError, Company, Health, Order, PaymentOptions, Prices, Quote402, QuoteStatus, UploadResult, X402PaymentRequired } from "./schemas";

const FIXTURES: Record<string, z.ZodType> = {
  "prices.json": Prices,
  "health.json": Health,
  "company.json": Company,
  "upload.json": UploadResult,
  "quote-402.json": Quote402,
  "x402-payment-required.json": X402PaymentRequired,
  "quote-status-paid.json": QuoteStatus,
  "order-delivered-payer.json": Order,
  "order-delivered-public.json": Order,
  "payment-options-testnet.json": PaymentOptions,
  "error-infeasible.json": ApiError,
};

const load = (file: string): unknown => JSON.parse(readFileSync(join(__dirname, "../fixtures/api", file), "utf8"));

describe("fixtures match API-CONTRACT schemas", () => {
  for (const [file, schema] of Object.entries(FIXTURES)) {
    it(file, () => {
      const r = schema.safeParse(load(file));
      expect(r.success, r.success ? "" : JSON.stringify(r.error.issues, null, 2)).toBe(true);
    });
  }

  it("public view leaks no payer data (D-166)", () => {
    const pub = Order.parse(load("order-delivered-public.json"));
    expect(pub.view).toBe("public");
    for (const k of ["instructions", "input", "delivery"]) expect(pub).not.toHaveProperty(k);
    expect(pub.brief).not.toHaveProperty("params");
  });
});
