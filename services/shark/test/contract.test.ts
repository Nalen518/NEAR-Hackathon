// Contract test: every real response must parse with the web's schemas (packages/shared). A failure is a
// contract bug in Shark, never a reason to loosen the schema. Chain is faked; signatures and NEP-413 are real.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApiError, Company, ComplaintAccepted, Health, Order, OrderAccepted, OrderPayer, PaymentOptions, Prices, Quote402, QuoteStatus, UploadResult } from "@shark/shared";
import { baseEncode, KeyPair, KeyPairSigner } from "near-api-js";
import { beforeEach, describe, expect, it } from "vitest";
import type { z } from "zod";
import { createApp } from "../src/app";
import { verifyNep413, type Chain, type ContractConfig, type ContractJob, type Nep413 } from "../src/chain";
import { loadConfig } from "../src/config";
import { agentMessage } from "../src/agents";
import { bidDigest, tick } from "../src/loop";
import { openStore } from "../src/store";

const USDC = "3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af";
const NOW = 1_793_500_000;
const quoteKey = KeyPair.fromRandom("ed25519");
const buyerKey = KeyPair.fromRandom("ed25519");
const strangerKey = KeyPair.fromRandom("ed25519");
const crabKey = KeyPair.fromRandom("ed25519");
const ravenKey = KeyPair.fromRandom("ed25519");
const owlKey = KeyPair.fromRandom("ed25519");

const config = loadConfig({
  SHARK_NETWORK: "testnet",
  TESTNET_RPC_URL: "http://rpc.invalid",
  TESTNET_CONTRACT_ID: "sharkco.testnet",
  TESTNET_USDC_ID: USDC,
  TESTNET_USDC_FAUCET_URL: "https://faucet.circle.com",
  TESTNET_X402_FACILITATOR_URL: "http://localhost:8787/x402",
  SHARK_QUOTE_KEY: quoteKey.toString(),
  RATE_LIMIT_PER_MIN: "1000",
  TESTNET_CRAB_ID: "crab-worker.testnet",
  TESTNET_RAVEN_ID: "raven-worker.testnet",
  TESTNET_OWL_ID: "owl-reviewer.testnet",
  TESTNET_CRAB_URL: "http://crab.local",
  TESTNET_RAVEN_URL: "http://raven.local",
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
const accessKeys = new Map([
  ["demo-buyer.testnet", buyerKey.getPublicKey().toString()],
  ["stranger.testnet", strangerKey.getPublicKey().toString()],
  ["crab-worker.testnet", crabKey.getPublicKey().toString()],
  ["raven-worker.testnet", ravenKey.getPublicKey().toString()],
  ["owl-reviewer.testnet", owlKey.getPublicKey().toString()],
]);

let jobs: Map<number, ContractJob>;
let paidQuotes: Map<string, number>;
let complaints: { job: number; hash: string }[];
let txs: string[];

const fakeChain = (over: Partial<Chain> = {}): Chain => ({
  serviceState: async () => "ok",
  config: async () => contractConfig,
  priceFloor: async (t) => floors[t],
  workers: async () => [
    { id: "crab-worker.testnet", types: ["extract", "summary", "thread"], min_fees: ["100000", "60000", "120000"], jobs: 4, first_pass: 3, final_fails: 1, late: 0, suspended: false },
    { id: "raven-worker.testnet", types: ["extract", "summary", "thread"], min_fees: ["140000", "80000", "180000"], jobs: 0, first_pass: 0, final_fails: 0, late: 0, suspended: false },
  ],
  reviewer: async () => ({ id: "owl-reviewer.testnet", reviews: 5, overturned: 0, suspended: false }),
  stats: async () => ({ jobs: jobs.size, strikes: 1, reserve: "16460000", owner_accrued: "195000", accounted: "0" }),
  roles: async () => ({ owner: "sharkco.testnet", guardian: "guardian.sharkco.testnet", shark: "shark.sharkco.testnet", usdc: USDC, network: "near:testnet" }),
  jobs: async (from, limit) => [...jobs.values()].filter((j) => j.id >= from).slice(0, limit),
  usdcBalance: async () => "3100000",
  job: async (id) => jobs.get(id) ?? null,
  jobByQuote: async (q) => (paidQuotes.has(q) ? (jobs.get(paidQuotes.get(q)!) ?? null) : null),
  accountExists: async (id) => accessKeys.has(id) || id === "ref-agent.testnet",
  usdcRegistered: async (id) => id === "demo-buyer.testnet",
  verifyNep413: (m) =>
    verifyNep413(m, {
      viewAccessKey: async ({ accountId, publicKey }) => {
        if (accessKeys.get(accountId) !== publicKey.toString()) throw new Error("UNKNOWN_ACCESS_KEY");
        return { permission: "FullAccess" } as never;
      },
    }),
  complain: async (job, hash) => {
    complaints.push({ job, hash });
  },
  isAccessKey: async (account, key) => accessKeys.get(account) === key,
  award: async (job, worker, fee) => (txs.push(`award ${job} ${worker} ${fee}`), "TxAward"),
  escrow: async (job, amount) => (txs.push(`escrow ${job} ${amount}`), "TxEscrow"),
  markRefundDue: async (job) => (txs.push(`refund_due ${job}`), "TxRefundDue"),
  finalize: async (job) => (txs.push(`finalize ${job}`), "TxFinalize"),
  payRefund: async (job) => (txs.push(`pay_refund ${job}`), "TxPayRefund"),
  ...over,
});

let app: ReturnType<typeof createApp>;
let store: ReturnType<typeof openStore>;
const makeApp = (chain = fakeChain(), now = () => NOW) => createApp({ config, chain, store, now, fetchImpl: async () => new Response("<html><body><p>Hello from example.com</p></body></html>", { headers: { "content-type": "text/html" } }) });

beforeEach(() => {
  jobs = new Map();
  paidQuotes = new Map();
  complaints = [];
  txs = [];
  store = openStore(mkdtempSync(join(tmpdir(), "shark-")));
  app = makeApp();
});

async function parsed<S extends z.ZodType>(schema: S, res: Response): Promise<z.infer<S>> {
  const json = await res.json();
  const r = schema.safeParse(json);
  expect(r.success, r.success ? "" : JSON.stringify(r.error.issues, null, 2)).toBe(true);
  if (typeof (json as { network?: unknown }).network === "string") expect((json as { network: string }).network).toBe("near:testnet");
  return r.data as z.infer<S>;
}
const get = (path: string) => app.request(path);
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  app.request(path, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

const TEXT_3000_WORDS = Array.from({ length: 3000 }, (_, i) => `word${i % 50}`).join(" ");
const order = (over: Record<string, unknown> = {}) => ({
  jobType: "summary",
  instructions: "Summarise this article in at most 150 words. Must mention NEAR Intents and fees.",
  input: { text: TEXT_3000_WORDS },
  params: { maxWords: 150, mustMention: ["NEAR Intents", "fees"] },
  payer: "demo-buyer.testnet",
  referrer: "ref-agent.testnet",
  ...over,
});

function job(id: number, over: Partial<ContractJob> = {}): ContractJob {
  const j: ContractJob = {
    id,
    quote_id: "q_X",
    payer: "demo-buyer.testnet",
    job_type: "summary",
    price: "600000",
    input_hash: "sha256:i",
    brief_hash: "sha256:b",
    referrer: "ref-agent.testnet",
    state: "delivered",
    paid_at: NOW - 600,
    worker: "crab-worker.testnet",
    worker_fee: "180000",
    escrowed: false,
    round: 1,
    delivery_hash: "sha256:d",
    work_deadline: NOW + 100,
    awarded_at: NOW - 580,
    delivered_at: NOW - 500,
    reviewed_at: NOW - 450,
    complaint_until: NOW + 86_000,
    complaint_hash: null,
    codes: ["PASS"],
    reasons_hash: null,
    review_fee: "50000",
    referral_bps: 750,
    owner_bps: 6000,
    ...over,
  };
  jobs.set(id, j);
  return j;
}

async function signed(kind: "view" | "complain", id: string, opts: { key?: KeyPair; account?: string; ts?: number; recipient?: string; nonce?: Buffer } = {}): Promise<Nep413> {
  const account = opts.account ?? "demo-buyer.testnet";
  const nonce = opts.nonce ?? Buffer.from(crypto.getRandomValues(new Uint8Array(32)));
  const message = `sharkco:${kind}:${id}:${opts.ts ?? NOW}`;
  const recipient = opts.recipient ?? "sharkco.testnet";
  const s = await new KeyPairSigner(opts.key ?? buyerKey).signNep413Message(account, { message, recipient, nonce });
  return { accountId: account, publicKey: s.publicKey.toString(), signature: Buffer.from(s.signature).toString("base64"), message, nonce: nonce.toString("base64"), recipient };
}

describe("A1: read endpoints", () => {
  it("health parses", async () => {
    expect(await parsed(Health, await get("/v1/health"))).toMatchObject({ ok: true, state: "ok", contract: "sharkco.testnet" });
  });
  it("prices parse with bands and floors from the contract", async () => {
    const body = await parsed(Prices, await get("/v1/prices"));
    expect(body.types.summary).toEqual({ band: { min: "0.20", max: "1.00" }, floor: "0.12" });
  });
});

describe("A1 and B4: GET /v1/company", () => {
  it("parses as Company from contract views, with sample only where there is no live source", async () => {
    job(1, { state: "finalized" });
    job(2, { state: "refunded", codes: ["FAIL_LENGTH"], worker_fee: "0" });
    const c = await parsed(Company, await get("/v1/company"));
    expect(c.strikes).toEqual({ count: 1, threshold: 3 });
    expect(c.reserve).toMatchObject({ balance: "16.46", floor: "12.10", sharkWallet: "3.10", dailyBudget: "4.00" });
    expect(c.workers.map((w) => [w.id, w.payoutChain, w.firstPassPct])).toEqual([["crab", "near", 75], ["raven", "base", 0]]);
    expect(c.workers[0].minFee).toEqual({ extract: "0.10", summary: "0.06", thread: "0.12" });
    expect(c.reviewer).toMatchObject({ id: "owl", account: "owl-reviewer.testnet", reviews: 5, reviewFee: "0.05" });
    expect(c.pnl7d).toMatchObject({ jobs: 2, revenue: "0.60", workers: "0.18", reviews: "0.05", referrals: "0.045", profit: "0.325", ownersAccrued: "0.195" });
    // newest first; finalized carries the reserve delta, refunded the refund
    expect(c.recentJobs.map((j) => [j.orderId, j.status, j.reserveDelta, j.refund])).toEqual([["j_000002", "refunded", null, "0.60"], ["j_000001", "finalized", "0.36", null]]);
    expect(c.config).toMatchObject({ workerCapBps: 5000, reserveFloor: "12.10", complaintWindowSecs: 86400, bands: { summary: { min: "0.20", max: "1.00" } } });
    expect(c.owners).toMatchObject({ dao: "sharkco.testnet", ownersWaiting: "0.195" });
    expect(c.sample).toMatchObject({ strikes: false, reserve: false, workers: false, recentJobs: false, owners: true, payouts: true });
  });
});

describe("A11: payment options", () => {
  it("testnet has the faucet and x402, no intents", async () => {
    const body = await parsed(PaymentOptions, await get("/v1/payment-options"));
    expect(body.options.map((o) => o.method)).toEqual(["quote", "x402"]);
    expect(body.options[0]).toMatchObject({ token: USDC, faucet: { url: "https://faucet.circle.com" } });
  });
});

describe("A2: POST /v1/orders answers 402 with a signed quote", () => {
  it("parses as Quote402 and pay matches the quote, token and contract", async () => {
    const res = await post("/v1/orders", order(), { "Idempotency-Key": "k1" });
    expect(res.status).toBe(402);
    expect(res.headers.get("WWW-Authenticate")).toMatch(/^SharkQuote quote_id="q_[0-9A-Z]{26}"$/);
    const q = await parsed(Quote402, res);
    expect(q.price).toBe("0.60");
    expect(q.priceReason).toBe("6 pages, 2 required points");
    expect(q.pay.args.amount).toBe(q.quote.price);
    expect(q.pay.token).toBe(USDC);
    expect(q.pay.args.receiver_id).toBe("sharkco.testnet");
    expect(q.quote.network).toBe("near:testnet");
    expect(q.payerRegistered).toBe(true);
    expect(q.register).toBeNull();
    expect(q.brief.checklist.map((c) => c.rule)).toEqual(["word_count <= 150", "mentions_all", "language == en", "every claim is supported by the source", "covers the source's main point"]);
    const msg = JSON.parse(Buffer.from(q.pay.args.msg.replace(/^pay:/, ""), "base64").toString());
    expect(msg).toEqual({ quote: q.quote, sig: q.sig });
  });

  it("an unregistered payer gets the storage_deposit step", async () => {
    accessKeys.set("new-buyer.testnet", "ed25519:x");
    const q = await parsed(Quote402, await post("/v1/orders", order({ payer: "new-buyer.testnet" })));
    expect(q.payerRegistered).toBe(false);
    expect(q.register).toMatchObject({ contract: USDC, method: "storage_deposit", args: { account_id: "new-buyer.testnet", registration_only: true } });
    accessKeys.delete("new-buyer.testnet");
  });

  it("thread and extract quotes parse, with the extract and thread rule strings (B3)", async () => {
    const t = await parsed(Quote402, await post("/v1/orders", order({ jobType: "thread", input: undefined, params: { posts: 5, mustInclude: ["https://example.com/launch", "#NEAR"] } })));
    expect(t.brief.checklist.map((c) => c.rule)).toEqual(["post_count == 5", "post_length <= 280", "includes_all", "no_extra_handles", "on topic", "no invented facts"]);
    const e = await parsed(Quote402, await post("/v1/orders", order({ jobType: "extract", input: { url: "https://example.com/catalogue" }, params: { schema: { fields: [{ name: "price", type: "number", required: true }] } } })));
    expect(e.brief.checklist.map((c) => c.rule)).toEqual(["json_parses", "matches_schema", "required_fields_filled", "traceable >= 90%", "records <= 50", "no invented records"]);
    expect(e.input.source).toBe("https://example.com/catalogue");
  });

  it("the same Idempotency-Key and body give the same quote; another body is 409", async () => {
    const a = await parsed(Quote402, await post("/v1/orders", order(), { "Idempotency-Key": "k2" }));
    const b = await parsed(Quote402, await post("/v1/orders", order(), { "Idempotency-Key": "k2" }));
    expect(b.quoteId).toBe(a.quoteId);
    const c = await post("/v1/orders", order({ instructions: "Something else entirely here." }), { "Idempotency-Key": "k2" });
    expect(c.status).toBe(409);
    expect((await parsed(ApiError, c)).error).toBe("idempotency_conflict");
  });

  it("a replay after payment answers 202", async () => {
    const q = await parsed(Quote402, await post("/v1/orders", order(), { "Idempotency-Key": "k3" }));
    job(42, { quote_id: q.quoteId, state: "paid" });
    paidQuotes.set(q.quoteId, 42);
    const res = await post("/v1/orders", order(), { "Idempotency-Key": "k3" });
    expect(res.status).toBe(202);
    expect(await parsed(OrderAccepted, res)).toMatchObject({ orderId: "j_000042", status: "paid", statusUrl: "/v1/orders/j_000042" });
  });
});

describe("A3: GET /v1/quotes/{id}", () => {
  it("moves AWAITING_PAYMENT to PAID with the orderId, then EXPIRED when unpaid", async () => {
    const q = await parsed(Quote402, await post("/v1/orders", order()));
    expect((await parsed(QuoteStatus, await get(`/v1/quotes/${q.quoteId}`))).status).toBe("AWAITING_PAYMENT");
    job(7, { quote_id: q.quoteId, state: "paid" });
    paidQuotes.set(q.quoteId, 7);
    expect(await parsed(QuoteStatus, await get(`/v1/quotes/${q.quoteId}`))).toMatchObject({ status: "PAID", orderId: "j_000007" });
    paidQuotes.clear();
    app = makeApp(fakeChain(), () => NOW + 601);
    expect((await parsed(QuoteStatus, await get(`/v1/quotes/${q.quoteId}`))).status).toBe("EXPIRED");
  });
});

describe("A4: POST /v1/uploads", () => {
  const upload = (bytes: Uint8Array | string, name: string, type = "") => {
    const form = new FormData();
    form.append("file", new Blob([bytes as BlobPart], { type }), name);
    return app.request("/v1/uploads", { method: "POST", body: form });
  };
  it("text and markdown parse as UploadResult", async () => {
    const r = await parsed(UploadResult, await upload(TEXT_3000_WORDS, "a.txt", "text/plain"));
    expect(r).toMatchObject({ pages: 6, words: 3000 });
    await parsed(UploadResult, await upload("# Title\n\nSome words here.", "notes.md"));
  });
  it("a PDF with text parses", async () => {
    const r = await parsed(UploadResult, await upload(tinyPdf("Hello shark and co"), "a.pdf", "application/pdf"));
    expect(r).toMatchObject({ pages: 1, words: 4 });
  });
  it("over 2 MB is 413, other types are 422", async () => {
    const big = await upload(new Uint8Array(2 * 1024 * 1024 + 1), "big.txt", "text/plain");
    expect(big.status).toBe(413);
    expect((await parsed(ApiError, big)).error).toBe("input_too_large");
    const exe = await upload("MZ", "tool.exe", "application/octet-stream");
    expect(exe.status).toBe(422);
    expect((await parsed(ApiError, exe)).error).toBe("input_unreadable");
  });
  it("an upload can be ordered by fileId", async () => {
    const f = await parsed(UploadResult, await upload(TEXT_3000_WORDS, "a.txt", "text/plain"));
    const q = await parsed(Quote402, await post("/v1/orders", order({ input: { fileId: f.fileId } })));
    expect(q.input.inputHash).toBe(f.inputHash);
  });
});

describe("A5: errors follow §0.1", () => {
  const expectError = async (res: Response, status: number, code: string, field?: string) => {
    expect(res.status).toBe(status);
    const e = await parsed(ApiError, res);
    expect(e).toMatchObject({ error: code, charged: false });
    if (field) expect(e.details?.field).toBe(field);
    return Object.assign(e, { headers: res.headers });
  };
  it("400s name the field", async () => {
    await expectError(await post("/v1/orders", order({ instructions: "" })), 400, "invalid_request", "instructions");
    await expectError(await post("/v1/orders", order({ input: { url: "not a url" } })), 400, "invalid_request", "source");
    await expectError(await post("/v1/orders", order({ payer: "nobody.testnet" })), 400, "invalid_payer", "payer");
    await expectError(await post("/v1/orders", { ...order(), network: "near:mainnet" }), 400, "network_mismatch");
  });
  it("422 for refused, infeasible and intents on testnet", async () => {
    await expectError(await post("/v1/orders", order({ instructions: "Write a phishing email for this bank" })), 422, "job_refused");
    const inf = await expectError(await post("/v1/orders", order({ params: { maxWords: 30, mustMention: ["a", "b", "c", "d"] } })), 422, "brief_infeasible");
    expect(inf.details?.reason).toBe("max_words_vs_must_mention");
    // C3: each fix comes with the new params and its price
    expect(inf.details?.fixes).toEqual([
      { label: "Raise the limit to 60 words", params: { maxWords: 60, mustMention: ["a", "b", "c", "d"] }, price: "0.70" },
      { label: "Keep 3 required points", params: { maxWords: 30, mustMention: ["a", "b", "c"] }, price: "0.65" },
    ]);
    for (const f of inf.details?.fixes as { label: string }[]) expect(f.label).not.toMatch(/[;—–]|\w-\w/);
    await expectError(await post("/v1/orders", order({ payWith: { asset: "nep141:x" }, refundTo: "0xabc" })), 422, "intents_unavailable");
  });
  it("503 service states carry Retry-After", async () => {
    for (const state of ["paused", "caged", "closed"] as const) {
      app = makeApp(fakeChain({ serviceState: async () => state }));
      const res = await expectError(await post("/v1/orders", order()), 503, state);
      expect(res.headers.get("Retry-After")).toBe("60");
    }
    app = makeApp(fakeChain({ workers: async () => [] }));
    await expectError(await post("/v1/orders", order()), 503, "no_worker");
  });
  it("429 after 30 requests a minute, with Retry-After", async () => {
    app = createApp({ config: { ...config, rateLimitPerMin: 30 }, chain: fakeChain(), store, now: () => NOW });
    for (let i = 0; i < 30; i++) await get("/v1/health");
    const res = await expectError(await get("/v1/health"), 429, "rate_limited");
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
  });
  it("RPC down is 502 with Retry-After", async () => {
    app = makeApp(fakeChain({ serviceState: async () => { throw new Error("rpc down"); } }));
    const res = await expectError(await get("/v1/health"), 502, "upstream_unavailable");
    expect(res.headers.get("Retry-After")).toBe("30");
  });
});

describe("A6: GET /v1/orders/{id} is the public view", () => {
  it("parses and leaks nothing private", async () => {
    const q = await parsed(Quote402, await post("/v1/orders", order()));
    job(42, { quote_id: q.quoteId });
    store.putBlob("sha256:d", "The delivered summary.");
    const res = await get("/v1/orders/j_000042");
    const raw = await res.clone().json();
    const o = await parsed(Order, res);
    expect(o.view).toBe("public");
    for (const k of ["instructions", "delivery", "input"]) expect(raw).not.toHaveProperty(k);
    expect(raw.brief).not.toHaveProperty("params");
    expect(raw.brief.checklist[0]).toEqual({ id: "C1", kind: "code" });
    expect(raw.size).toEqual({ pages: 6, words: 3000 });
    expect(JSON.stringify(raw)).not.toContain("NEAR Intents and fees");
  });
  it("B5: money is split once the worker fee is known", async () => {
    job(42);
    expect((await parsed(Order, await get("/v1/orders/j_000042"))).money).toEqual({ method: "quote", price: "0.60", workerFee: "0.18", reviewFee: "0.05", referral: "0.045", owners: "0.195", reserve: "0.36" });
  });
  it("B6: an unknown job is 404 order_not_found", async () => {
    const res = await get("/v1/orders/j_000999");
    expect(res.status).toBe(404);
    expect(await parsed(ApiError, res)).toMatchObject({ error: "order_not_found", charged: false });
  });
});

describe("A7: POST /v1/orders/{id}/view is the payer view", () => {
  beforeEach(async () => {
    const q = await parsed(Quote402, await post("/v1/orders", order()));
    job(42, { quote_id: q.quoteId });
    store.putBlob("sha256:d", "The delivered summary.");
  });
  it("a valid NEP-413 signature gets the payer view, never cached", async () => {
    const res = await post("/v1/orders/j_000042/view", await signed("view", "j_000042"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const o = await parsed(OrderPayer, res);
    expect(o.instructions).toContain("NEAR Intents and fees");
    expect(o.delivery).toEqual({ format: "text/plain", content: "The delivered summary.", deliveryHash: "sha256:d" });
  });
  it("401 for a wrong recipient, an old timestamp, a replayed nonce or someone else's key", async () => {
    const bad = [
      await signed("view", "j_000042", { recipient: "other.testnet" }),
      await signed("view", "j_000042", { ts: NOW - 301 }),
      await signed("complain", "j_000042"),
      await signed("view", "j_000042", { key: strangerKey }),
    ];
    for (const auth of bad) {
      const res = await post("/v1/orders/j_000042/view", auth);
      expect(res.status).toBe(401);
      expect((await parsed(ApiError, res)).error).toBe("payer_signature_invalid");
    }
    const once = await signed("view", "j_000042");
    expect((await post("/v1/orders/j_000042/view", once)).status).toBe(200);
    expect((await post("/v1/orders/j_000042/view", once)).status).toBe(401);
  });
  it("403 not_payer for another valid account", async () => {
    const res = await post("/v1/orders/j_000042/view", await signed("view", "j_000042", { key: strangerKey, account: "stranger.testnet" }));
    expect(res.status).toBe(403);
    expect((await parsed(ApiError, res)).error).toBe("not_payer");
  });
});

describe("A8: POST /v1/orders/{id}/complaint", () => {
  it("202 records the complaint on chain with the reason hash", async () => {
    job(42);
    const res = await post("/v1/orders/j_000042/complaint", { reason: "I asked for bullet points.", auth: await signed("complain", "j_000042") });
    expect(res.status).toBe(202);
    expect(await parsed(ComplaintAccepted, res)).toEqual({ status: "complaint_review" });
    expect(complaints).toEqual([{ job: 42, hash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/) }]);
  });
  it("409 when the window is over or a complaint was already sent", async () => {
    job(42, { complaint_until: NOW - 1 });
    job(43, { complaint_hash: "sha256:x" });
    for (const id of ["j_000042", "j_000043"]) {
      const res = await post(`/v1/orders/${id}/complaint`, { reason: "late", auth: await signed("complain", id) });
      expect(res.status).toBe(409);
      expect((await parsed(ApiError, res)).error).toBe("complaint_closed");
    }
  });
  it("401 without a valid signature, 403 for another account", async () => {
    job(42);
    expect((await post("/v1/orders/j_000042/complaint", { reason: "x", auth: await signed("view", "j_000042") })).status).toBe(401);
    expect((await post("/v1/orders/j_000042/complaint", { reason: "x", auth: await signed("complain", "j_000042", { key: strangerKey, account: "stranger.testnet" }) })).status).toBe(403);
  });
  it("429 after three complaints a day", async () => {
    for (const id of [1, 2, 3, 4]) job(id);
    for (const id of [1, 2, 3]) expect((await post(`/v1/orders/j_00000${id}/complaint`, { reason: "x", auth: await signed("complain", `j_00000${id}`) })).status).toBe(202);
    const res = await post("/v1/orders/j_000004/complaint", { reason: "x", auth: await signed("complain", "j_000004") });
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("3600");
  });
});

describe("A9: delivery stays null until a review passes, even for the payer", () => {
  for (const state of ["paid", "awarded", "review", "revision", "refund_due", "refunded"] as const) {
    it(state, async () => {
      job(42, { state, codes: state.startsWith("refund") ? ["FAIL_LENGTH"] : [] });
      store.putBlob("sha256:d", "secret delivery");
      const o = await parsed(OrderPayer, await post("/v1/orders/j_000042/view", await signed("view", "j_000042")));
      expect(o.delivery).toBeNull();
      expect(o.status).toBe(state);
    });
  }
});

describe("A10: CORS", () => {
  for (const origin of ["http://localhost:3100", "http://localhost:3000"]) {
    it(`allows ${origin}`, async () => {
      const res = await app.request("/v1/orders", { method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type,idempotency-key" } });
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe(origin);
      expect(res.headers.get("Access-Control-Allow-Headers")?.toLowerCase()).toContain("idempotency-key");
    });
  }
  it("refuses other origins and exposes Retry-After and WWW-Authenticate", async () => {
    expect((await app.request("/v1/health", { headers: { Origin: "https://evil.example" } })).headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect((await app.request("/v1/health", { headers: { Origin: "http://localhost:3100" } })).headers.get("Access-Control-Expose-Headers")).toMatch(/Retry-After.*WWW-Authenticate/);
  });
});

/** A one-page PDF with a text layer (no xref; pdf.js rebuilds it). */
function tinyPdf(text: string): Uint8Array {
  const stream = `BT /F1 18 Tf 20 100 Td (${text}) Tj ET`;
  return new TextEncoder().encode(
    `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 400 144]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n4 0 obj<</Length ${stream.length}>>stream\n${stream}\nendstream endobj\n5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n`,
  );
}

describe("params for the wrong job type", () => {
  it("summary params on a thread order are a 400 on the instructions field", async () => {
    const res = await post("/v1/orders", order({ jobType: "thread", input: undefined, params: { maxWords: 150 } }));
    expect(res.status).toBe(400);
    expect((await parsed(ApiError, res)).details?.field).toBe("instructions");
  });
});

type Bidder = { key: KeyPair; account: string; price: string; eta: number; expiry?: string; status?: number; signAs?: KeyPair };
function bidFrom(b: Bidder, jobId: string) {
  const expiry = b.expiry ?? new Date((NOW + 60) * 1000).toISOString();
  const digest = bidDigest({ workerId: b.account, jobId, etaSecs: b.eta }, BigInt(Math.round(Number(b.price) * 1e6)), Math.floor(Date.parse(expiry) / 1000));
  return { workerId: b.account, jobId, price: b.price, etaSecs: b.eta, expiry, pubKey: b.key.getPublicKey().toString(), sig: `ed25519:${baseEncode((b.signAs ?? b.key).sign(digest).signature)}` };
}
function workersFetch(bidders: Record<string, Bidder>, calls: { url: string; body: unknown }[]) {
  return (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    const body = JSON.parse(String(init?.body ?? "{}"));
    calls.push({ url: u, body });
    const b = Object.entries(bidders).find(([host]) => u.startsWith(host))?.[1];
    if (u.endsWith("/rfq")) {
      if (!b || b.status === 204) return new Response(null, { status: 204 });
      return Response.json(bidFrom(b, body.jobId));
    }
    return Response.json({ accepted: true });
  }) as typeof fetch;
}
const loopDeps = (bidders: Record<string, Bidder>, calls: { url: string; body: unknown }[] = [], chain = fakeChain()) => ({ config, chain, store, now: () => NOW, fetchImpl: workersFetch(bidders, calls), log: () => {} });
const unawarded: Partial<ContractJob> = { state: "paid", worker: null, worker_fee: "0", awarded_at: null, work_deadline: 0, codes: [], reviewed_at: null, delivered_at: null };
const crab = { key: crabKey, account: "crab-worker.testnet", price: "0.18", eta: 70 };
const raven = { key: ravenKey, account: "raven-worker.testnet", price: "0.24", eta: 45 };

describe("job loop: auction (FR-30 to FR-33)", () => {
  it("sends the RFQ, checks signed bids and awards the best one with a reason", async () => {
    job(1, unawarded);
    const calls: { url: string; body: unknown }[] = [];
    await tick(loopDeps({ "http://crab.local": crab, "http://raven.local": raven }, calls));
    expect(calls.map((c) => c.url).sort()).toEqual(["http://crab.local/rfq", "http://raven.local/rfq"]);
    expect(calls[0].body).toMatchObject({ jobId: "j_000001", jobType: "summary", cap: "0.30", briefHash: "sha256:b" });
    expect(txs).toEqual(["award 1 crab-worker.testnet 180000"]);
    const row = store.auction(1)!;
    expect(row.bids.map((b) => [b.account, b.state])).toEqual([["crab-worker.testnet", "winner"], ["raven-worker.testnet", "lost"]]);
    expect(row.reason).toBe("Crab wins at 0.18 with a 75% first pass rate, done in about 70 s.");
    expect(row.reason).not.toMatch(/[;—–]|\w-\w/); // D-170
  });
  it("throws out over cap, forged, expired and foreign key bids", async () => {
    job(1, unawarded);
    await tick(loopDeps({ "http://crab.local": { ...crab, price: "0.31" }, "http://raven.local": { ...raven, signAs: strangerKey } }));
    expect(store.auction(1)!.bids.map((b) => b.state)).toEqual(["invalid", "invalid"]);
    expect(txs).toEqual(["refund_due 1"]); // no valid bid: refund
    job(2, unawarded);
    await tick(loopDeps({ "http://crab.local": { ...crab, expiry: new Date((NOW - 1) * 1000).toISOString() }, "http://raven.local": { ...raven, key: strangerKey } }));
    expect(store.auction(2)!.bids.map((b) => b.state)).toEqual(["invalid", "invalid"]);
  });
  it("204 is busy", async () => {
    job(1, unawarded);
    await tick(loopDeps({ "http://crab.local": crab, "http://raven.local": { ...raven, status: 204 } }));
    expect(store.auction(1)!.bids.map((b) => b.state)).toEqual(["winner", "busy"]);
  });
});

describe("job loop: after the award", () => {
  async function awarded() {
    job(1, unawarded);
    await tick(loopDeps({ "http://crab.local": crab }));
    txs = [];
    return job(1, { state: "awarded", escrowed: false, awarded_at: NOW - 10, work_deadline: NOW + 590, codes: [], reviewed_at: null, delivered_at: null });
  }
  it("escrows fee plus review fee, then tells the worker once", async () => {
    await awarded();
    const calls: { url: string; body: unknown }[] = [];
    await tick(loopDeps({ "http://crab.local": crab }, calls));
    expect(txs).toEqual(["escrow 1 230000"]);
    job(1, { ...jobs.get(1)!, escrowed: true });
    await tick(loopDeps({ "http://crab.local": crab }, calls));
    await tick(loopDeps({ "http://crab.local": crab }, calls));
    expect(calls.filter((c) => c.url.endsWith("/award")).map((c) => c.body)).toEqual([{ jobId: "j_000001", price: "0.18", awardTx: "TxAward", round: 1 }]);
    expect(txs).toEqual(["escrow 1 230000"]);
  });
  it("a revision is sent once as round 2 with the codes", async () => {
    await awarded();
    store.putAuction({ ...store.auction(1)!, round_sent: 1, escrow_tx: "TxEscrow" });
    job(1, { ...jobs.get(1)!, state: "revision", escrowed: true, round: 2, codes: ["FAIL_LENGTH"] });
    const calls: { url: string; body: unknown }[] = [];
    await tick(loopDeps({ "http://crab.local": crab }, calls));
    await tick(loopDeps({ "http://crab.local": crab }, calls));
    expect(calls.map((c) => c.body)).toEqual([{ jobId: "j_000001", price: "0.18", awardTx: "TxAward", round: 2, codes: ["FAIL_LENGTH"] }]);
  });
  it("late work goes to refund due", async () => {
    await awarded();
    job(1, { ...jobs.get(1)!, escrowed: true, work_deadline: NOW - 61 });
    await tick(loopDeps({}));
    expect(txs).toEqual(["refund_due 1"]);
  });
  it("finalizes after the complaint window and pays due refunds", async () => {
    job(1, { state: "delivered", complaint_until: NOW - 1 });
    job(2, { state: "delivered", complaint_until: NOW + 10 });
    job(3, { state: "refund_due" });
    await tick(loopDeps({}));
    expect(txs).toEqual(["finalize 1", "pay_refund 3"]);
  });
  it("the job page shows the auction and the award tx", async () => {
    await awarded();
    const o = await parsed(Order, await get("/v1/orders/j_000001"));
    expect(o.auction).toMatchObject({ cap: "0.30", bids: [{ worker: "crab", price: "0.18", etaSecs: 70, state: "winner" }, { worker: "raven", state: "busy" }], reason: expect.stringContaining("Crab wins") });
    expect(o.proof.awardTx).toBe("TxAward");
    expect(o.timeline.find((e) => e.event === "awarded")).toMatchObject({ worker: "crab", tx: "TxAward" });
  });
});

describe("files for agents (API 1.11)", () => {
  const signedReq = (method: string, path: string, body: string, key: KeyPair, account: string, ts = NOW) => {
    const sig = key.sign(new TextEncoder().encode(agentMessage(method, path, ts, body))).signature;
    return app.request(path, {
      method,
      body: method === "GET" ? undefined : body,
      headers: { "X-Agent-Account": account, "X-Agent-Key": key.getPublicKey().toString(), "X-Agent-Ts": String(ts), "X-Agent-Sig": Buffer.from(sig).toString("base64") },
    });
  };
  it("a worker uploads a delivery and Owl reads it back by hash", async () => {
    const put = await signedReq("PUT", "/v1/files", "My delivery", crabKey, "crab-worker.testnet");
    const { hash } = await put.json();
    expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    const got = await signedReq("GET", `/v1/files/${hash}`, "", owlKey, "owl-reviewer.testnet");
    expect(await got.text()).toBe("My delivery");
  });
  it("refuses strangers, forged and stale signatures", async () => {
    store.putBlob("sha256:x", "secret");
    expect((await app.request("/v1/files/sha256:x")).status).toBe(401);
    expect((await signedReq("GET", "/v1/files/sha256:x", "", strangerKey, "stranger.testnet")).status).toBe(401);
    expect((await signedReq("GET", "/v1/files/sha256:x", "", strangerKey, "owl-reviewer.testnet")).status).toBe(401);
    expect((await signedReq("GET", "/v1/files/sha256:x", "", owlKey, "owl-reviewer.testnet", NOW - 301)).status).toBe(401);
  });
});

describe("B2: per check review results", () => {
  it("code checks carry their detail, model checks pass only, and Owl's reasons show", async () => {
    const q = await parsed(Quote402, await post("/v1/orders", order()));
    const delivery = "NEAR Intents lets people swap across chains, and the fees stay low for everyone who uses them every day.";
    store.putBlob("sha256:d", delivery);
    store.putBlob("sha256:r", "Short, faithful and mentions both terms.");
    job(42, { quote_id: q.quoteId, input_hash: q.input.inputHash, reasons_hash: "sha256:r" });
    const o = await parsed(OrderPayer, await post("/v1/orders/j_000042/view", await signed("view", "j_000042")));
    expect(o.reviews[0].checks).toEqual([
      { id: "C1", pass: true, detail: "19 words" },
      { id: "C2", pass: true, detail: "both found" },
      { id: "C3", pass: true, detail: "en" },
      { id: "M1", pass: true },
      { id: "M2", pass: true },
    ]);
    expect(o.reviews[0].reasons).toBe("Short, faithful and mentions both terms.");
  });
  it("a failed model check shows as failed; a failed code check hides the model checks", async () => {
    const q = await parsed(Quote402, await post("/v1/orders", order()));
    store.putBlob("sha256:d", "NEAR Intents and fees are mentioned in this short summary of the article.");
    job(42, { quote_id: q.quoteId, input_hash: q.input.inputHash, state: "revision", codes: ["FAIL_FAITHFULNESS"] });
    const a = await parsed(Order, await get("/v1/orders/j_000042"));
    expect(a.reviews[0].checks?.filter((c) => c.id.startsWith("M"))).toEqual([{ id: "M1", pass: false }, { id: "M2", pass: true }]);
    store.putBlob("sha256:d", "Too short.");
    const b = await parsed(Order, await get("/v1/orders/j_000042"));
    expect(b.reviews[0].checks?.map((c) => c.id)).toEqual(["C1", "C2", "C3"]);
  });
});

describe("C1: recent quotes on /v1/prices", () => {
  it("newest first, paid or expired, and parses as Prices", async () => {
    const a = await parsed(Quote402, await post("/v1/orders", order()));
    const b = await parsed(Quote402, await post("/v1/orders", order({ jobType: "thread", input: undefined, params: { posts: 3 } })));
    job(7, { quote_id: a.quoteId, state: "paid" });
    paidQuotes.set(a.quoteId, 7);
    const p = await parsed(Prices, await get("/v1/prices"));
    expect(p.recentQuotes.map((q) => [q.jobType, q.price, q.status])).toEqual([["thread", b.price, undefined], ["summary", "0.60", "paid"]]);
    expect(p.recentQuotes[1].reason).toBe("6 pages, 2 required points");
    app = makeApp(fakeChain(), () => NOW + 601);
    expect((await parsed(Prices, await get("/v1/prices"))).recentQuotes.map((q) => q.status)).toEqual(["expired", "paid"]);
  });
});

describe("C2: auctions and incidents logs on /v1/company", () => {
  it("lists the auctions and the complaint and brief incidents, newest first", async () => {
    store.putAuction({ job_id: 1, cap: "300000", bids: [{ account: "crab-worker.testnet", price: "0.18", etaSecs: 70, state: "winner" }, { account: "raven-worker.testnet", price: "0.24", etaSecs: 45, state: "lost" }], winner: "crab-worker.testnet", reason: "Crab wins at 0.18.", reason_hash: "sha256:r", bid_hash: "sha256:b", award_tx: "TxA", escrow_tx: "TxE", round_sent: 1, at: NOW - 100 });
    job(1, { state: "refunded", codes: ["COMPLAINT_UPHELD"], complaint_hash: "sha256:c", reviewed_at: NOW - 50 });
    job(2, { state: "refund_due", codes: ["BRIEF_INVALID"], reviewed_at: NOW - 40 });
    const c = await parsed(Company, await get("/v1/company"));
    expect(c.auctions).toEqual([{ orderId: "j_000001", jobType: "summary", price: "0.60", cap: "0.30", bids: [{ worker: "crab", price: "0.18", etaSecs: 70, state: "winner" }, { worker: "raven", price: "0.24", etaSecs: 45, state: "lost" }], winner: "crab", reason: "Crab wins at 0.18.", outcome: "complaint" }]);
    expect(c.incidents.map((i) => [i.orderId, i.kind, i.strike])).toEqual([["j_000002", "brief_invalid", true], ["j_000001", "complaint_upheld", true]]);
    for (const i of c.incidents) expect(i.text).not.toMatch(/[;—–]|\w-\w/);
    expect(c.sample).toMatchObject({ auctions: false, incidents: false });
  });
});

describe("out_of_budget (FR-64)", () => {
  const walletConfig = { ...config, walletId: "wallet.sharkco.testnet" };
  it("refuses to quote and says so on /health when Shark's wallet can't cover a job", async () => {
    // summary: 1.00 band max × 50% + 0.05 review fee = 0.55 needed
    app = createApp({ config: walletConfig, chain: fakeChain({ usdcBalance: async () => "549999" }), store, now: () => NOW });
    expect((await post("/v1/orders", order())).status).toBe(503);
    expect((await parsed(Health, await get("/v1/health"))).state).toBe("out_of_budget");
    app = createApp({ config: walletConfig, chain: fakeChain({ usdcBalance: async () => "1000000" }), store, now: () => NOW });
    expect((await post("/v1/orders", order())).status).toBe(402);
    expect((await parsed(Health, await get("/v1/health"))).state).toBe("ok");
  });
  it("/health says no_worker when every worker is suspended", async () => {
    app = makeApp(fakeChain({ workers: async () => [] }));
    expect((await parsed(Health, await get("/v1/health"))).state).toBe("no_worker");
  });
});
