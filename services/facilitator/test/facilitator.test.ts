import { x402Facilitator } from "@x402/core/facilitator";
import { createFacilitatorNearSigner } from "@x402/near";
import { ExactNearScheme } from "@x402/near/exact/facilitator";
import { KeyPair } from "near-api-js";
import { describe, expect, it, vi } from "vitest";
import { createFacilitatorApp, type FacilitatorCore, type Policy } from "../src/app";

const policy: Policy = { network: "near:testnet", asset: "usdc-id", payTo: "sharkco.testnet" };
const requirements = { scheme: "exact", network: "near:testnet", amount: "600000", asset: "usdc-id", payTo: "sharkco.testnet", maxTimeoutSeconds: 120, extra: { quoteId: "q_A", briefHash: "sha256:b" } };
const payload = { x402Version: 2, accepted: requirements, payload: { signedDelegateAction: "AAAA" } };
const body = (over: Record<string, unknown> = {}) => JSON.stringify({ x402Version: 2, paymentPayload: payload, paymentRequirements: requirements, ...over });
const post = (app: ReturnType<typeof createFacilitatorApp>, path: string, b: string, headers: Record<string, string> = { "X-API-Key": "secret" }) =>
  app.request(path, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: b });

function fakeCore(over: Partial<FacilitatorCore> = {}) {
  const core = {
    getSupported: () => ({ kinds: [{ x402Version: 2, scheme: "exact", network: "near:testnet" }], extensions: [], signers: { "near:testnet": ["relayer.testnet"] } }),
    verify: vi.fn(async () => ({ isValid: true, payer: "demo-buyer.testnet" })),
    settle: vi.fn(async () => ({ success: true, transaction: "TxSettle", network: "near:testnet", payer: "demo-buyer.testnet" })),
    ...over,
  };
  return { core, app: createFacilitatorApp({ core: core as FacilitatorCore, apiKeys: ["secret"], policy, log: () => {} }) };
}

describe("access", () => {
  it("verify and settle need the API key, as X-API-Key or a bearer token", async () => {
    const { app, core } = fakeCore();
    for (const path of ["/verify", "/settle"]) {
      expect((await post(app, path, body(), {})).status).toBe(401);
      expect((await post(app, path, body(), { "X-API-Key": "wrong" })).status).toBe(401);
    }
    expect((await post(app, "/verify", body(), { "X-API-Key": "secret" })).status).toBe(200);
    expect((await post(app, "/settle", body(), { Authorization: "Bearer secret" })).status).toBe(200);
    expect(core.verify).toHaveBeenCalledTimes(1);
  });
  it("is closed when no key is configured", async () => {
    const app = createFacilitatorApp({ core: fakeCore().core as FacilitatorCore, apiKeys: [""], policy });
    expect((await post(app, "/settle", body(), { "X-API-Key": "" })).status).toBe(401);
  });
  it("supported and health are public", async () => {
    const { app } = fakeCore();
    expect(await (await app.request("/supported")).json()).toMatchObject({ kinds: [{ scheme: "exact", network: "near:testnet" }], signers: { "near:testnet": ["relayer.testnet"] } });
    expect((await app.request("/healthz")).status).toBe(200);
  });
});

describe("policy: it never spends gas on someone else's payment", () => {
  it.each([
    ["network", { network: "near:mainnet" }],
    ["asset", { asset: "other-token" }],
    ["recipient", { payTo: "thief.testnet" }],
    ["scheme", { scheme: "upto" }],
  ])("refuses another %s without reaching the chain", async (_name, change) => {
    const { app, core } = fakeCore();
    const b = body({ paymentRequirements: { ...requirements, ...change } });
    const verify = await post(app, "/verify", b);
    expect(verify.status).toBe(403);
    expect(await verify.json()).toEqual({ isValid: false, invalidReason: "not_allowed" });
    const settle = await post(app, "/settle", b);
    expect(settle.status).toBe(403);
    expect(await settle.json()).toMatchObject({ success: false, errorReason: "not_allowed" });
    expect(core.verify).not.toHaveBeenCalled();
    expect(core.settle).not.toHaveBeenCalled();
  });
  it("refuses a body that is not an x402 v2 request", async () => {
    const { app } = fakeCore();
    for (const b of ["not json", JSON.stringify({ x402Version: 1 }), body({ paymentPayload: undefined })]) expect((await post(app, "/verify", b)).status).toBe(400);
  });
});

describe("pass through", () => {
  it("returns the facilitator's own verdicts untouched", async () => {
    const { app, core } = fakeCore({ verify: vi.fn(async () => ({ isValid: false, invalidReason: "insufficient_funds" })), settle: vi.fn(async () => ({ success: false, errorReason: "duplicate_settlement", transaction: "", network: "near:testnet" })) });
    expect(await (await post(app, "/verify", body())).json()).toEqual({ isValid: false, invalidReason: "insufficient_funds" });
    expect(await (await post(app, "/settle", body())).json()).toMatchObject({ success: false, errorReason: "duplicate_settlement" });
    expect(core.verify).toHaveBeenCalledWith(payload, requirements);
  });
});

describe("with the real @x402/near scheme (no network needed)", () => {
  const signer = createFacilitatorNearSigner({ relayers: [{ accountId: "relayer.testnet", secretKey: KeyPair.fromRandom("ed25519").toString() as `ed25519:${string}` }], rpcUrls: { "near:testnet": "http://rpc.invalid" } });
  const core = new x402Facilitator().register("near:testnet", new ExactNearScheme(signer));
  const app = createFacilitatorApp({ core, apiKeys: ["secret"], policy, log: () => {} });

  it("advertises exact on near:testnet with our relayer", async () => {
    const s = await (await app.request("/supported")).json();
    expect(s.kinds).toEqual(expect.arrayContaining([expect.objectContaining({ x402Version: 2, scheme: "exact", network: "near:testnet" })]));
    expect(s.signers["near:*"]).toEqual(["relayer.testnet"]); // the library keys signers by family
  });
  it("a payment that isn't a signed delegate is invalid, not a crash", async () => {
    const res = await post(app, "/verify", body());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ isValid: false });
  });
});
