// Contract test: every real response must parse with the web's schemas (packages/shared). A failure is a
// contract bug in Shark, never a reason to loosen the schema.
import { Health, PaymentOptions, Prices } from "@shark/shared";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { createApp } from "../src/app";
import type { Chain, ContractConfig } from "../src/chain";
import { loadConfig } from "../src/config";

const config = loadConfig({
  SHARK_NETWORK: "testnet",
  TESTNET_RPC_URL: "http://rpc.invalid",
  TESTNET_CONTRACT_ID: "sharkco.testnet",
  TESTNET_USDC_ID: "3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af",
  TESTNET_USDC_FAUCET_URL: "https://faucet.circle.com",
  TESTNET_X402_FACILITATOR_URL: "http://localhost:8787/x402",
});

// SRD §8.7 testnet numbers
const contractConfig: ContractConfig = {
  extract: { band_min: "300000", band_max: "1500000" },
  summary: { band_min: "200000", band_max: "1000000" },
  thread: { band_min: "500000", band_max: "2000000" },
  worker_cap_bps: 5000,
  review_fee: "50000",
  referral_bps: 750,
  owner_bps: 6000,
  daily_budget: "4000000",
  strike_threshold: 3,
  suspend_threshold: 3,
  max_unresolved_open: 2,
  work_deadline_secs: 600,
  complaint_window_secs: 86400,
  job_timeout_secs: 21600,
};
const floors = { extract: "200000", summary: "120000", thread: "240000" };

const fakeChain = (over: Partial<Chain> = {}): Chain => ({
  serviceState: async () => "ok",
  config: async () => contractConfig,
  priceFloor: async (t) => floors[t],
  ...over,
});

const app = createApp({ config, chain: fakeChain() });

async function parsed<S extends z.ZodType>(path: string, schema: S, init?: RequestInit): Promise<{ res: Response; body: z.infer<S> }> {
  const res = await app.request(path, init);
  const json = await res.json();
  const r = schema.safeParse(json);
  expect(r.success, r.success ? "" : JSON.stringify(r.error.issues, null, 2)).toBe(true);
  expect((json as { network?: string }).network).toBe("near:testnet");
  return { res, body: r.data as z.infer<S> };
}

describe("GET /v1/health", () => {
  it("parses as Health", async () => {
    const { body } = await parsed("/v1/health", Health);
    expect(body).toMatchObject({ ok: true, state: "ok", contract: "sharkco.testnet" });
  });
});

describe("GET /v1/prices", () => {
  it("parses as Prices with bands and floors from the contract", async () => {
    const { body } = await parsed("/v1/prices", Prices);
    expect(body.types.summary).toEqual({ band: { min: "0.20", max: "1.00" }, floor: "0.12" });
    expect(body.types.extract.floor).toBe("0.20");
  });
});

describe("GET /v1/payment-options (A11)", () => {
  it("parses as PaymentOptions with the faucet and the x402 option", async () => {
    const { body } = await parsed("/v1/payment-options", PaymentOptions);
    expect(body.options.map((o) => o.method)).toEqual(["quote", "x402"]);
    expect(body.options[0]).toMatchObject({ token: config.usdcId, faucet: { url: "https://faucet.circle.com" } });
  });
});

describe("errors (A5)", () => {
  it("an RPC failure answers 502 upstream_unavailable with charged and Retry-After", async () => {
    const down = createApp({ config, chain: fakeChain({ serviceState: async () => { throw new Error("rpc down"); } }) });
    const res = await down.request("/v1/health");
    expect(res.status).toBe(502);
    expect(res.headers.get("Retry-After")).toBe("30");
    expect(await res.json()).toMatchObject({ error: "upstream_unavailable", charged: false });
  });
});

describe("CORS (A10)", () => {
  for (const origin of ["http://localhost:3100", "http://localhost:3000"]) {
    it(`allows ${origin}`, async () => {
      const res = await app.request("/v1/orders", { method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type,idempotency-key" } });
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe(origin);
      expect(res.headers.get("Access-Control-Allow-Headers")?.toLowerCase()).toContain("idempotency-key");
    });
  }
  it("refuses other origins", async () => {
    const res = await app.request("/v1/health", { headers: { Origin: "https://evil.example" } });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
  it("exposes Retry-After and WWW-Authenticate", async () => {
    const res = await app.request("/v1/health", { headers: { Origin: "http://localhost:3100" } });
    expect(res.headers.get("Access-Control-Expose-Headers")).toMatch(/Retry-After.*WWW-Authenticate/);
  });
});
