// Contract test: every real response must parse with the web's schemas (packages/shared). A failure is a
// contract bug in Shark, never a reason to loosen the schema. Chain is faked; signatures and NEP-413 are real.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApiError, Company, ComplaintAccepted, Health, InfeasibleDetails, X402PaymentRequired, Order, OrderAccepted, OrderPayer, PaymentOptions, Prices, Quote402, QuoteStatus, UploadResult } from "@shark/shared";
import { baseEncode, KeyPair, KeyPairSigner } from "near-api-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import { createApp } from "../src/app";
import { rpcChain, verifyNep413, type Chain, type ContractConfig, type ContractJob, type Nep413 } from "../src/chain";
import { loadConfig } from "../src/config";
import { agentMessage } from "../src/agents";
import { fetchSnapshot } from "../src/input";
import { bidDigest, tick } from "../src/loop";
import { openStore } from "../src/store";
import type { Facilitator } from "../src/x402";
import { classify, nearblocksSource, syncReceipts, type ReceiptSource, type StoredReceipt } from "../src/events";

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
  CACHE_SECS: "0",
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
  review_deadline_secs: 600,
  dispute_window_secs: 3600,
  unresolved_timeout_secs: 604800,
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
let keeperTxs: string[];
/** What the contract does with an x402 report: create the job, refuse it, or accept without creating one */
let x402Mode: "ok" | "throw" | "no_job";

const fakeChain = (over: Partial<Chain> = {}): Chain => ({
  serviceState: async () => "ok",
  config: async () => contractConfig,
  priceFloor: async (t) => floors[t],
  workers: async () => [
    { id: "crab-worker.testnet", types: ["extract", "summary", "thread"], min_fees: ["100000", "60000", "120000"], jobs: 4, first_pass: 3, final_fails: 1, disputes_won: 1, disputes_lost: 0, disputes_unresolved: 0, unresolved_open: 0, late: 0, suspended: false },
    { id: "raven-worker.testnet", types: ["extract", "summary", "thread"], min_fees: ["140000", "80000", "180000"], jobs: 0, first_pass: 0, final_fails: 0, disputes_won: 0, disputes_lost: 0, disputes_unresolved: 0, unresolved_open: 0, late: 0, suspended: false },
  ],
  reviewer: async () => ({ id: "owl-reviewer.testnet", reviews: 5, overturned: 0, suspended: false }),
  stats: async () => ({ jobs: jobs.size, strikes: 1, reserve: "16460000", owner_accrued: "195000", accounted: "0", open_jobs: 0, owed_open: 0, owners_paid: "0", config_changed_at: null }),
  roles: async () => ({ owner: "sharkco.testnet", guardian: "guardian.sharkco.testnet", shark: "shark.sharkco.testnet", shark_wallet: "wallet.sharkco.testnet", usdc: USDC, network: "near:testnet" }),
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
  settleFailed: async (job) => (txs.push(`settle_failed ${job}`), "TxSettle"),
  markUnresolved: async (job) => (txs.push(`mark_unresolved ${job}`), "TxUnresolved"),
  releaseUnresolved: async (job) => (txs.push(`release_unresolved ${job}`), "TxRelease"),
  expireWork: async (job) => (txs.push(`expire_work ${job}`), "TxExpire"),
  fundShark: async () => (keeperTxs.push("fund_shark"), "TxFund"),
  payOwners: async () => (keeperTxs.push("pay_owners"), "TxOwners"),
  owed: async () => [],
  retryOwed: async (id) => (keeperTxs.push(`retry_owed ${id}`), "TxRetry"),
  markPaidX402: async (quote, _sig, s) => {
    txs.push(`mark_paid_x402 ${quote.quote_id} ${s.tx_hash}`);
    if (x402Mode === "throw") throw new Error("contract refused");
    if (x402Mode === "ok") {
      const id = jobs.size + 77;
      job(id, { quote_id: quote.quote_id, method: "x402", state: "paid", worker: null, worker_fee: "0", codes: [], awarded_at: null, delivered_at: null, reviewed_at: null, work_deadline: 0 });
      paidQuotes.set(quote.quote_id, id);
    }
    return "TxMark";
  },
  returnX402: async (s) => (txs.push(`return_x402 ${s.tx_hash}`), "TxReturn"),
  ravenGas: async () => null,
  ...over,
});

let app: ReturnType<typeof createApp>;
let store: ReturnType<typeof openStore>;
const makeApp = (chain = fakeChain(), now = () => NOW, facilitator?: Facilitator) => createApp({ config, chain, store, now, facilitator, fetchImpl: async () => new Response("<html><body><p>Hello from example.com</p></body></html>", { headers: { "content-type": "text/html" } }) });

beforeEach(() => {
  jobs = new Map();
  paidQuotes = new Map();
  complaints = [];
  txs = [];
  keeperTxs = [];
  x402Mode = "ok";
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
    method: "quote",
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
    dispute_until: null,
    review_requested_at: null,
    unresolved_since: null,
    held: false,
    reauctioned: false,
    excluded: null,
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
    expect(c.sample).toMatchObject({ strikes: false, reserve: false, workers: false, recentJobs: false, owners: true, payouts: false });
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
    expect(InfeasibleDetails.parse(inf.details).reason).toBe("max_words_vs_must_mention"); // the shared schema accepts what Shark really sends
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
  it("401 for a wrong recipient, an old timestamp, the wrong message or someone else's key", async () => {
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
  });
  it("the same view signature works again for the same account and order, so the page can refresh", async () => {
    const auth = await signed("view", "j_000042");
    for (let i = 0; i < 3; i++) expect((await post("/v1/orders/j_000042/view", auth)).status).toBe(200);
    // the nonce belongs to the first use: another order with the same nonce is a replay
    job(43, { ...jobs.get(42)!, id: 43 });
    const other = await signed("view", "j_000043", { nonce: Buffer.from(auth.nonce, "base64") });
    expect((await post("/v1/orders/j_000043/view", other)).status).toBe(401);
  });
  it("a complaint signature is one use only", async () => {
    const auth = await signed("complain", "j_000042");
    const body = { reason: "The summary left out the fees.", auth };
    expect((await post("/v1/orders/j_000042/complaint", body)).status).toBe(202);
    const again = await post("/v1/orders/j_000042/complaint", body);
    expect(again.status).toBe(401);
    expect((await parsed(ApiError, again)).error).toBe("payer_signature_invalid");
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
  it("late work is expired on chain: the contract sends it back to auction or refunds it", async () => {
    await awarded();
    job(1, { ...jobs.get(1)!, escrowed: true, work_deadline: NOW - 61 });
    await tick(loopDeps({}));
    expect(txs).toEqual(["expire_work 1"]);
    txs = [];
    job(1, { ...jobs.get(1)!, work_deadline: NOW - 59 }); // still inside the grace
    await tick(loopDeps({}));
    expect(txs).toEqual([]);
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

describe("disputes in the job loop (FR-44 to FR-46)", () => {
  const withAuction = (jobId: number) => store.putAuction({ job_id: jobId, cap: "300000", bids: [{ account: "crab-worker.testnet", price: "0.18", etaSecs: 70, state: "winner" }], winner: "crab-worker.testnet", reason: "Crab wins at 0.18.", reason_hash: "sha256:r", bid_hash: "sha256:b", award_tx: "TxA", escrow_tx: "TxE", round_sent: 2, at: NOW - 900 });
  it("tells the worker about the dispute window once, then settles after it", async () => {
    store.putBlob("sha256:rr", "The post was too long.");
    withAuction(1);
    job(1, { state: "failed", codes: ["FAIL_LENGTH"], reasons_hash: "sha256:rr", escrowed: true, dispute_until: NOW + 100 });
    const calls: { url: string; body: unknown }[] = [];
    await tick(loopDeps({ "http://crab.local": crab }, calls));
    await tick(loopDeps({ "http://crab.local": crab }, calls));
    expect(calls.map((c) => [c.url, c.body])).toEqual([["http://crab.local/dispute-window", { jobId: "j_000001", codes: ["FAIL_LENGTH"], reasons: "The post was too long.", until: new Date((NOW + 100) * 1000).toISOString().replace(/\.\d{3}Z$/, "Z") }]]);
    expect(txs).toEqual([]);
    job(1, { ...jobs.get(1)!, dispute_until: NOW - 1 });
    await tick(loopDeps({ "http://crab.local": crab }, calls));
    expect(txs).toEqual(["settle_failed 1"]);
  });
  it("a dispute with no second review by the deadline goes Unresolved, not before", async () => {
    job(1, { state: "dispute_review", review_requested_at: NOW - 600 });
    await tick(loopDeps({}));
    expect(txs).toEqual([]);
    job(1, { ...jobs.get(1)!, review_requested_at: NOW - 601 });
    await tick(loopDeps({}));
    expect(txs).toEqual(["mark_unresolved 1"]);
  });
  it("releases an Unresolved fee after seven days, not before", async () => {
    job(1, { state: "unresolved", held: true, unresolved_since: NOW - 604_799 });
    await tick(loopDeps({}));
    expect(txs).toEqual([]);
    job(1, { ...jobs.get(1)!, unresolved_since: NOW - 604_800 });
    await tick(loopDeps({}));
    expect(txs).toEqual(["release_unresolved 1"]);
  });
});

describe("disputes on the job page and the company page", () => {
  it("shows the dispute and the second review in order, and the review as secondary", async () => {
    const q = await parsed(Quote402, await post("/v1/orders", order()));
    store.putBlob("sha256:d", "NEAR Intents lets people swap across chains, and the fees stay low for everyone who uses them every day.");
    job(42, { quote_id: q.quoteId, input_hash: q.input.inputHash, state: "delivered", codes: ["PASS"], review_requested_at: NOW - 460, reviewed_at: NOW - 450 });
    const o = await parsed(Order, await get("/v1/orders/j_000042"));
    expect(o.timeline.map((e) => e.event)).toEqual(["paid", "awarded", "delivered_for_review", "dispute", "second_review_pass"]);
    expect(o.reviews[0]).toMatchObject({ mode: "secondary", pass: true });
  });
  it("an Unresolved job is public as unresolved with its timeline event and no delivery", async () => {
    job(42, { state: "unresolved", held: true, unresolved_since: NOW - 100, review_requested_at: NOW - 400, codes: ["FAIL_LENGTH"] });
    store.putBlob("sha256:d", "secret delivery");
    const o = await parsed(OrderPayer, await post("/v1/orders/j_000042/view", await signed("view", "j_000042")));
    expect(o.status).toBe("unresolved");
    expect(o.delivery).toBeNull();
    expect(o.timeline.map((e) => e.event)).toEqual(["paid", "awarded", "delivered_for_review", "review_fail", "dispute", "unresolved"]);
  });
  it("the company page counts disputes, caps unresolved workers and logs the incidents", async () => {
    app = makeApp(fakeChain({ workers: async () => [
      { id: "crab-worker.testnet", types: ["extract", "summary", "thread"], min_fees: ["100000", "60000", "120000"], jobs: 4, first_pass: 3, final_fails: 1, disputes_won: 2, disputes_lost: 1, disputes_unresolved: 0, unresolved_open: 0, late: 0, suspended: false },
      { id: "raven-worker.testnet", types: ["extract", "summary", "thread"], min_fees: ["140000", "80000", "180000"], jobs: 2, first_pass: 1, final_fails: 0, disputes_won: 0, disputes_lost: 0, disputes_unresolved: 1, unresolved_open: 2, late: 0, suspended: false },
    ] }));
    job(1, { state: "finalized", review_requested_at: NOW - 460, reviewed_at: NOW - 450 });
    job(2, { state: "refunded", codes: ["FAIL_LENGTH"], review_requested_at: NOW - 400, reviewed_at: NOW - 390 });
    job(3, { state: "unresolved", held: true, unresolved_since: NOW - 100, codes: [] });
    const c = await parsed(Company, await get("/v1/company"));
    expect(c.workers.map((w) => [w.id, w.disputesWon, w.disputesLost, w.unresolvedOpen, w.eligible, w.ineligibleReason])).toEqual([["crab", 2, 1, 0, true, null], ["raven", 0, 0, 2, false, "unresolved_cap"]]);
    expect(c.incidents.map((i) => [i.orderId, i.kind, i.strike]).sort()).toEqual([["j_000001", "dispute_won", false], ["j_000002", "dispute", false], ["j_000003", "dispute", false]]);
    for (const i of c.incidents) expect(i.text).not.toMatch(/[;—–]|\w-\w/);
  });
});

describe("re-auction after a late worker (FR-35)", () => {
  it("asks everyone but the late worker, and awards a second time", async () => {
    job(1, unawarded);
    await tick(loopDeps({ "http://crab.local": crab, "http://raven.local": raven }));
    expect(txs).toEqual(["award 1 crab-worker.testnet 180000"]);
    txs = [];
    job(1, { ...unawarded, reauctioned: true, excluded: "crab-worker.testnet" });
    const calls: { url: string; body: unknown }[] = [];
    await tick(loopDeps({ "http://crab.local": crab, "http://raven.local": raven }, calls));
    expect(calls.map((c) => c.url)).toEqual(["http://raven.local/rfq"]);
    expect(txs).toEqual(["award 1 raven-worker.testnet 240000"]);
    expect(store.auction(1)).toMatchObject({ reauction: true, winner: "raven-worker.testnet", award_tx: "TxAward" });
    await tick(loopDeps({ "http://crab.local": crab, "http://raven.local": raven }, calls)); // not a third time
    expect(txs).toHaveLength(1);
  });
});

describe("daily and owed keepers", () => {
  const day = 20_758 * 86_400;
  it("funds Shark and pays the owners once a day after 00:05 UTC, and a revert does not stop the loop", async () => {
    let now = day + 100;
    const deps = (chain = fakeChain()) => ({ ...loopDeps({}, [], chain), now: () => now });
    await tick(deps());
    expect(keeperTxs).toEqual([]);
    now = day + 301;
    await tick(deps());
    await tick(deps());
    expect(keeperTxs).toEqual(["fund_shark", "pay_owners"]);
    now = day + 86_400 + 301;
    await tick(deps(fakeChain({ fundShark: async () => { throw new Error("E_RESERVE_FLOOR"); } })));
    expect(keeperTxs).toEqual(["fund_shark", "pay_owners", "pay_owners"]);
  });
  it("retries owed payouts once an hour", async () => {
    const owed = [{ id: 1, job: 5, to: "crab-worker.testnet", amount: "180000", kind: "worker" }, { id: 2, job: 6, to: "owl-reviewer.testnet", amount: "50000", kind: "reviewer" }];
    let now = day + 100;
    const deps = () => ({ ...loopDeps({}, [], fakeChain({ owed: async () => owed })), now: () => now });
    await tick(deps());
    await tick(deps());
    expect(keeperTxs).toEqual(["retry_owed 1", "retry_owed 2"]);
    now += 3_600;
    await tick(deps());
    expect(keeperTxs).toEqual(["retry_owed 1", "retry_owed 2", "fund_shark", "pay_owners", "retry_owed 1", "retry_owed 2"]); // an hour later is also past 00:05
  });
});

describe("x402 (method 3, FR-12)", () => {
  const dec = (h: string | null) => JSON.parse(Buffer.from(h ?? "", "base64").toString("utf8"));
  const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64");

  function fakeFacilitator(over: Partial<Facilitator> = {}) {
    const calls: string[] = [];
    const f: Facilitator = {
      verify: async () => (calls.push("verify"), { isValid: true, payer: "demo-buyer.testnet" }),
      settle: async () => (calls.push("settle"), { success: true, transaction: "TxSettle", network: "near:testnet", payer: "demo-buyer.testnet" }),
      ...over,
    };
    return { f, calls };
  }
  /** Ask for a quote, read the x402 requirement from its header, and build the retry's PAYMENT-SIGNATURE. */
  async function quoted(f: Facilitator, now = () => NOW) {
    app = makeApp(fakeChain(), now, f);
    const res = await post("/v1/orders", order(), { "Idempotency-Key": "x1" });
    const required = dec(res.headers.get("PAYMENT-REQUIRED"));
    const q = await parsed(Quote402, res);
    const payload = { x402Version: 2, resource: required.resource, accepted: required.accepts[0], payload: { signedDelegateAction: "AAAA" } };
    return { q, required, payload, header: enc(payload) };
  }
  const retry = (header: string) => post("/v1/orders", order(), { "Idempotency-Key": "x1", "PAYMENT-SIGNATURE": header });

  it("every 402 also carries an x402 v2 PAYMENT-REQUIRED for the exact quote", async () => {
    const { q, required } = await quoted(fakeFacilitator().f);
    X402PaymentRequired.parse(required); // the shared v2 schema accepts what Shark really sends
    expect(required).toEqual({
      x402Version: 2,
      error: "PAYMENT-SIGNATURE header is required",
      resource: { url: "http://localhost:8787/v1/orders", description: `Shark & Co. summary job ${q.quoteId}`, mimeType: "application/json" },
      accepts: [{ scheme: "exact", network: "near:testnet", amount: "600000", asset: USDC, payTo: "sharkco.testnet", maxTimeoutSeconds: 120, extra: { quoteId: q.quoteId, briefHash: q.briefHash } }],
    });
  });

  it("a signed retry is verified, settled, reported to the contract and answered 200 with PAYMENT-RESPONSE", async () => {
    const fac = fakeFacilitator();
    const { q, header } = await quoted(fac.f);
    const res = await retry(header);
    expect(res.status).toBe(200);
    expect(dec(res.headers.get("PAYMENT-RESPONSE"))).toEqual({ success: true, transaction: "TxSettle", network: "near:testnet", payer: "demo-buyer.testnet" });
    expect(await parsed(OrderAccepted, res)).toMatchObject({ status: "paid", payment: { method: "x402", tx: "TxSettle" } });
    expect(fac.calls).toEqual(["verify", "settle"]);
    expect(txs).toEqual([`mark_paid_x402 ${q.quoteId} TxSettle`]);
    // the quote now reads as paid by x402, and the order carries its payment tx
    expect(await parsed(QuoteStatus, await get(`/v1/quotes/${q.quoteId}`))).toMatchObject({ method: "x402", status: "PAID", paymentTx: "TxSettle" });
    const o = await parsed(Order, await get(`/v1/orders/${(await (await get(`/v1/quotes/${q.quoteId}`)).json()).orderId}`));
    expect(o.proof.paymentTx).toBe("TxSettle");
  });

  it("retrying an already paid quote answers 202 without settling again", async () => {
    const fac = fakeFacilitator();
    const { header } = await quoted(fac.f);
    expect((await retry(header)).status).toBe(200);
    fac.calls.length = 0;
    const again = await retry(header);
    expect(again.status).toBe(202);
    expect(await parsed(OrderAccepted, again)).toMatchObject({ status: "paid" });
    expect(fac.calls).toEqual([]);
  });

  describe("refusals (x402_invalid), each with a fresh PAYMENT-REQUIRED carrying the error", () => {
    const expectInvalid = async (res: Response, reason: string, withHeader = true) => {
      expect(res.status).toBe(402);
      const e = await parsed(ApiError, res.clone());
      expect(e).toMatchObject({ error: "x402_invalid", charged: false, details: { reason } });
      if (withHeader) expect(dec(res.headers.get("PAYMENT-REQUIRED")).error).toBe(reason);
    };
    it("malformed, unknown quote, wrong network, changed requirement", async () => {
      const fac = fakeFacilitator();
      const { payload } = await quoted(fac.f);
      await expectInvalid(await retry("not base64 json"), "malformed", false);
      await expectInvalid(await retry(enc({ ...payload, accepted: { ...payload.accepted, extra: { ...payload.accepted.extra, quoteId: "q_NOPE" } } })), "unknown_quote", false);
      await expectInvalid(await retry(enc({ ...payload, accepted: { ...payload.accepted, network: "near:mainnet" } })), "network");
      await expectInvalid(await retry(enc({ ...payload, accepted: { ...payload.accepted, amount: "1" } })), "requirement_mismatch");
      await expectInvalid(await retry(enc({ ...payload, accepted: { ...payload.accepted, payTo: "thief.testnet" } })), "requirement_mismatch");
      expect(fac.calls).toEqual([]); // nothing reached the facilitator
    });
    it("the facilitator's own verify refusal is passed on", async () => {
      const fac = fakeFacilitator({ verify: async () => ({ isValid: false, invalidReason: "insufficient_funds" }) });
      const { header } = await quoted(fac.f);
      await expectInvalid(await retry(header), "insufficient_funds");
      expect(txs).toEqual([]);
    });
    it("x402 is not enabled without a facilitator", async () => {
      app = createApp({ config: { ...config, x402FacilitatorUrl: null }, chain: fakeChain(), store, now: () => NOW });
      const res = await post("/v1/orders", order());
      expect(res.headers.get("PAYMENT-REQUIRED")).toBeNull();
      await expectInvalid(await retry(enc({ x402Version: 2 })), "not_enabled", false);
    });
  });

  it("a settlement failure is x402_settlement_failed with the facilitator's reason", async () => {
    const fac = fakeFacilitator({ settle: async () => ({ success: false, errorReason: "delegate_action_expired" }) });
    const { header } = await quoted(fac.f);
    const res = await retry(header);
    expect(res.status).toBe(402);
    expect(await parsed(ApiError, res)).toMatchObject({ error: "x402_settlement_failed", details: { reason: "delegate_action_expired" } });
    expect(txs).toEqual([]);
  });

  it("a quote with under 150 s left is 410, before anything is settled", async () => {
    const fac = fakeFacilitator();
    const { header } = await quoted(fac.f);
    app = makeApp(fakeChain(), () => NOW + 451, fac.f); // 600 s ttl, 149 s left
    const res = await retry(header);
    expect(res.status).toBe(410);
    expect((await parsed(ApiError, res)).error).toBe("quote_expired");
    expect(fac.calls).toEqual([]);
  });

  it("a paused service takes no x402 money", async () => {
    const fac = fakeFacilitator();
    const { header } = await quoted(fac.f);
    app = makeApp(fakeChain({ serviceState: async () => "paused" }), () => NOW, fac.f);
    const res = await retry(header);
    expect(res.status).toBe(503);
    expect(fac.calls).toEqual([]);
  });

  it("money that landed but could not become a job is sent back: the contract refused, or made no job", async () => {
    for (const mode of ["throw", "no_job"] as const) {
      txs = [];
      x402Mode = mode;
      const { q, header } = await quoted(fakeFacilitator().f);
      const res = await retry(header);
      expect(res.status).toBe(402);
      expect(await parsed(ApiError, res)).toMatchObject({ error: "x402_settlement_failed", charged: false, details: { reason: "returned" } });
      expect(txs).toEqual([`mark_paid_x402 ${q.quoteId} TxSettle`, "return_x402 TxSettle"]);
    }
  });

  it("an unreachable facilitator is a 502", async () => {
    const { header } = await quoted(fakeFacilitator({ verify: async () => { throw new Error("down"); } }).f);
    const res = await retry(header);
    expect(res.status).toBe(502);
    expect((await parsed(ApiError, res)).error).toBe("upstream_unavailable");
  });
});

describe("event reader", () => {
  let rid = 0;
  const rcpt = (o: Partial<StoredReceipt> & Pick<StoredReceipt, "method" | "tx">): StoredReceipt => ({ receipt_id: `R${++rid}`, ok: true, at: NOW, predecessor: "x.testnet", args: {}, job: null, quote: null, ...o });
  const put = (...rs: StoredReceipt[]) => rs.forEach((r) => store.putReceipt(r));
  const payMsg = (quoteId: string) => `pay:${Buffer.from(JSON.stringify({ quote: { quote_id: quoteId }, sig: "ed25519:x" })).toString("base64")}`;

  describe("source", () => {
    const entry = (over: Record<string, unknown>) => ({
      id: "1", receipt_id: "R1", transaction_hash: "TX1", predecessor_account_id: USDC, receiver_account_id: "sharkco.testnet", block_timestamp: "1793500000123456789",
      actions: [{ action: "FUNCTION_CALL", method: "ft_on_transfer", args: JSON.stringify({ sender_id: "demo-buyer.testnet", amount: "600000", msg: payMsg("q_A") }) }],
      outcomes: { status: true }, ...over,
    });
    it("parses the indexer's receipts and keeps only calls to the contract", async () => {
      const urls: string[] = [];
      const body = { cursor: "c2", txns: [
        entry({}),
        entry({ receipt_id: "R2", transaction_hash: "TX2", actions: [{ action: "FUNCTION_CALL", method: "deliver", args: JSON.stringify({ job: 7, delivery_hash: "sha256:d" }) }], outcomes: { status: false } }),
        entry({ receipt_id: "R3", receiver_account_id: "someone.testnet" }), // not ours
        entry({ receipt_id: "R4", actions: [{ action: "TRANSFER" }] }), // not a call
        entry({ receipt_id: "R5", actions: [{ action: "FUNCTION_CALL", method: "pause", args: "not json" }] }),
      ] };
      const src = nearblocksSource("https://indexer.example/", "sharkco.testnet", (async (u: string) => (urls.push(u), Response.json(body))) as unknown as typeof fetch);
      const page = await src.page(null);
      expect(urls[0]).toBe("https://indexer.example/v1/account/sharkco.testnet/receipts?order=desc&per_page=25");
      expect(page.next).toBe("c2");
      expect(page.receipts.map((r) => [r.receipt_id, r.tx, r.method, r.ok, r.at, r.job, r.quote])).toEqual([
        ["R1", "TX1", "ft_on_transfer", true, 1_793_500_000, null, "q_A"],
        ["R2", "TX2", "deliver", false, 1_793_500_000, 7, null],
        ["R5", "TX1", "pause", true, 1_793_500_000, null, null],
      ]);
      await src.page("c2");
      expect(urls[1]).toContain("&cursor=c2");
    });
    it("finds the job or quote a call belongs to", () => {
      expect(classify("ft_on_transfer", { msg: "escrow:12" })).toEqual({ job: 12, quote: null });
      expect(classify("ft_on_transfer", { msg: payMsg("q_B") })).toEqual({ job: null, quote: "q_B" });
      expect(classify("ft_on_transfer", { msg: "reserve" })).toEqual({ job: null, quote: null });
      expect(classify("mark_paid_x402", { quote: { quote_id: "q_C" } })).toEqual({ job: null, quote: "q_C" });
      expect(classify("award", { job: 3 })).toEqual({ job: 3, quote: null });
    });
    it("sync stores new receipts, goes back a page only while everything is new, and never twice", async () => {
      const pages: Record<string, { receipts: StoredReceipt[]; next: string | null }> = {
        first: { receipts: [rcpt({ method: "award", tx: "A", receipt_id: "S1" }), rcpt({ method: "deliver", tx: "B", receipt_id: "S2" })], next: "p2" },
        p2: { receipts: [rcpt({ method: "pause", tx: "C", receipt_id: "S3" }), rcpt({ method: "pause", tx: "C", receipt_id: "S2" })], next: "p3" },
        p3: { receipts: [rcpt({ method: "pause", tx: "D", receipt_id: "S4" })], next: null },
      };
      const asked: (string | null)[] = [];
      const source: ReceiptSource = { page: async (c) => (asked.push(c), pages[c ?? "first"]) };
      expect(await syncReceipts(source, store)).toBe(3); // S1 S2 fresh; S3 fresh, S2 known: stop
      expect(asked).toEqual([null, "p2"]);
      asked.length = 0;
      expect(await syncReceipts(source, store)).toBe(0);
      expect(asked).toEqual([null]);
    });
  });

  describe("derived data", () => {
    async function finalizedJob() {
      const q = await parsed(Quote402, await post("/v1/orders", order()));
      const j = job(42, { quote_id: q.quoteId, state: "finalized" });
      store.putBlob("sha256:d", "x");
      put(
        rcpt({ method: "ft_on_transfer", tx: "TxPay", at: NOW - 600, predecessor: USDC, quote: q.quoteId }),
        rcpt({ method: "deliver", tx: "TxDeliver", at: NOW - 500, job: 42, predecessor: "crab-worker.testnet", args: { job: 42 } }),
        rcpt({ method: "on_review", tx: "TxReview", at: NOW - 450, job: 42, predecessor: "owl-reviewer.testnet", args: { job: 42, result: { mode: "primary", pass: true, codes: ["PASS"] } } }),
        rcpt({ method: "finalize", tx: "TxFinal", at: NOW - 100, job: 42, args: { job: 42 } }),
      );
      return { q, j };
    }
    it("links the payment, delivery and review, and shows each payout and the split with its tx", async () => {
      const { q } = await finalizedJob();
      const o = await parsed(Order, await get("/v1/orders/j_000042"));
      expect(o.timeline.map((e) => [e.event, e.tx ?? null, e.amount ?? null, e.worker ?? null])).toEqual([
        ["paid", "TxPay", null, null],
        ["awarded", null, null, "crab"],
        ["delivered_for_review", "TxDeliver", null, null],
        ["review_pass", "TxReview", null, null],
        ["worker_paid", "TxReview", "0.18", "crab"],
        ["reviewer_paid", "TxReview", "0.05", null],
        ["finalized", "TxFinal", null, null],
      ]);
      expect(o.proof).toMatchObject({ paymentTx: "TxPay", workerPayoutTx: "TxReview" });
      expect(o.proof.contractTxs).toEqual(expect.arrayContaining(["TxPay", "TxDeliver", "TxReview", "TxFinal"]));
      expect((await parsed(QuoteStatus, await get(`/v1/quotes/${q.quoteId}`))).paymentTx).toBe("TxPay");
    });
    it("a failed call is not a payout, and a first fail pays nobody while the second pays Owl only", async () => {
      const q = await parsed(Quote402, await post("/v1/orders", order()));
      job(42, { quote_id: q.quoteId, state: "failed", round: 2, codes: ["FAIL_LENGTH"] });
      const owl = "owl-reviewer.testnet";
      put(
        rcpt({ method: "on_review", tx: "TxFail1", at: NOW - 460, job: 42, predecessor: owl, args: { job: 42, result: { mode: "primary", pass: false, codes: ["FAIL_LENGTH"] } } }),
        rcpt({ method: "on_review", tx: "TxFail2", at: NOW - 450, job: 42, predecessor: owl, args: { job: 42, result: { mode: "primary", pass: false, codes: ["FAIL_LENGTH"] } } }),
        rcpt({ method: "on_review", tx: "TxBad", at: NOW - 440, job: 42, predecessor: owl, ok: false, args: { job: 42, result: { mode: "primary", pass: true, codes: ["PASS"] } } }),
      );
      const o = await parsed(Order, await get("/v1/orders/j_000042"));
      expect(o.timeline.filter((e) => e.event.endsWith("_paid")).map((e) => [e.event, e.tx])).toEqual([["reviewer_paid", "TxFail2"]]);
    });
    it("a refund and a second review are linked", async () => {
      const q = await parsed(Quote402, await post("/v1/orders", order()));
      job(42, { quote_id: q.quoteId, state: "refunded", codes: ["FAIL_LENGTH"], review_requested_at: NOW - 400, reviewed_at: NOW - 300 });
      put(
        rcpt({ method: "dispute", tx: "TxDispute", at: NOW - 400, job: 42 }),
        rcpt({ method: "on_review", tx: "TxSecond", at: NOW - 300, job: 42, predecessor: "owl-reviewer.testnet", args: { job: 42, result: { mode: "secondary", pass: false, codes: ["FAIL_LENGTH"] } } }),
        rcpt({ method: "pay_refund", tx: "TxRefund", at: NOW - 200, job: 42 }),
      );
      const o = await parsed(Order, await get("/v1/orders/j_000042"));
      const by = Object.fromEntries(o.timeline.map((e) => [e.event, e]));
      expect(by.dispute.tx).toBe("TxDispute");
      expect(by.second_review_fail.tx).toBe("TxSecond");
      expect([by.reviewer_paid.tx, by.reviewer_paid.amount]).toEqual(["TxSecond", "0.05"]);
      expect([by.refunded.tx, by.refunded.amount]).toEqual(["TxRefund", "0.60"]);
    });
    it("a payment the contract received but turned into no job is RETURNED after 90 s", async () => {
      const q = await parsed(Quote402, await post("/v1/orders", order()));
      put(rcpt({ method: "ft_on_transfer", tx: "TxBad", at: NOW, predecessor: USDC, quote: q.quoteId }));
      app = makeApp(fakeChain(), () => NOW + 89);
      expect(await parsed(QuoteStatus, await get(`/v1/quotes/${q.quoteId}`))).toMatchObject({ status: "AWAITING_PAYMENT" });
      app = makeApp(fakeChain(), () => NOW + 91);
      expect(await parsed(QuoteStatus, await get(`/v1/quotes/${q.quoteId}`))).toMatchObject({ status: "RETURNED", paymentTx: "TxBad" });
      const p = await parsed(Prices, await get("/v1/prices"));
      expect(p.recentQuotes[0]).toMatchObject({ status: "returned", tx: "TxBad", returnReason: null });
    });
    it("the company page lists payouts from the calls that made them, newest first, with the held fee", async () => {
      await finalizedJob();
      job(43, { state: "unresolved", held: true, unresolved_since: NOW - 50, worker: "raven-worker.testnet", worker_fee: "240000" });
      put(rcpt({ method: "mark_unresolved", tx: "TxHold", at: NOW - 50, job: 43 }), rcpt({ method: "pay_refund", tx: "TxRefund43", at: NOW - 40, job: 43 }));
      const c = await parsed(Company, await get("/v1/company"));
      expect(c.payouts.map((p) => [p.orderId, p.kind, p.to, p.amount, p.tx, p.held])).toEqual([
        ["j_000043", "refund", "demo-buyer.testnet", "0.60", "TxRefund43", false],
        ["j_000043", "held", "raven", "0.24", "TxHold", true],
        ["j_000042", "referral", "ref-agent.testnet", "0.045", "TxFinal", false],
        ["j_000042", "worker", "crab", "0.18", "TxReview", false],
        ["j_000042", "reviewer", "owl", "0.05", "TxReview", false],
      ]);
      expect(c.sample.payouts).toBe(false);
      expect(c.recentJobs.find((j) => j.orderId === "j_000042")?.workerPayoutTx).toBe("TxReview");
    });
    it("the reader is off when its url is off", async () => {
      expect(loadConfig({ SHARK_NETWORK: "testnet", TESTNET_RPC_URL: "x", TESTNET_CONTRACT_ID: "c", TESTNET_USDC_ID: "u", SHARK_QUOTE_KEY: "k", TESTNET_EVENTS_URL: "off" }).eventsUrl).toBeNull();
      expect(loadConfig({ SHARK_NETWORK: "mainnet", MAINNET_RPC_URL: "x", MAINNET_CONTRACT_ID: "c", MAINNET_USDC_ID: "u", SHARK_QUOTE_KEY: "k" }).eventsUrl).toBe("https://api.nearblocks.io");
    });
  });

  describe("in the job loop", () => {
    it("syncs once a minute, and a broken indexer does not stop the loop", async () => {
      let calls = 0;
      let broken = false;
      const receipts: ReceiptSource = { page: async () => { calls++; if (broken) throw new Error("indexer down"); return { receipts: [], next: null }; } };
      let now = NOW;
      const deps = () => ({ ...loopDeps({}), now: () => now, receipts });
      await tick(deps());
      await tick(deps());
      expect(calls).toBe(1);
      now += 60;
      broken = true;
      await expect(tick(deps())).resolves.toBeUndefined();
      expect(calls).toBe(2);
    });
  });
});

describe("FR-14: GET /v1/openapi.json", () => {
  it("documents exactly the customer routes the app serves, nothing missing and nothing extra", async () => {
    const res = await get("/v1/openapi.json");
    expect(res.status).toBe(200);
    const doc = await res.json();
    expect(doc.openapi).toBe("3.1.0");
    const documented = Object.entries(doc.paths as Record<string, object>).flatMap(([p, ops]) => Object.keys(ops).map((m) => `${m.toUpperCase()} ${p.replace(/\{[^}]+\}/g, ":p")}`));
    const internal = (p: string) => p.startsWith("/v1/files") || p.startsWith("/v1/agent") || p === "/v1/openapi.json";
    const served = app.routes.filter((r) => r.method !== "ALL" && !internal(r.path)).map((r) => `${r.method} ${r.path.replace(/:[A-Za-z]+/g, ":p")}`);
    expect([...new Set(documented)].sort()).toEqual([...new Set(served)].sort());
  });
  it("describes the 402 and x402 flow with schemas generated from the shared ones", async () => {
    const doc = await (await get("/v1/openapi.json")).json();
    const post = doc.paths["/v1/orders"].post;
    expect(post.requestBody.content["application/json"].schema.required).toEqual(expect.arrayContaining(["jobType", "instructions", "payer"]));
    expect(Object.keys(post.parameters.map((p: { name: string }) => p.name).reduce((a: object, n: string) => ({ ...a, [n]: 1 }), {}))).toEqual(["Idempotency-Key", "PAYMENT-SIGNATURE"]);
    expect(Object.keys(post.responses["402"].headers)).toEqual(["WWW-Authenticate", "PAYMENT-REQUIRED"]);
    expect(post.responses["402"].content["application/json"].schema.required).toEqual(expect.arrayContaining(["quoteId", "price", "brief", "quote", "sig", "pay"]));
    expect(Object.keys(post.responses["200"].headers)).toEqual(["PAYMENT-RESPONSE"]);
    expect(doc.info.description).toContain("near:testnet");
    expect(doc.servers).toEqual([{ url: "http://localhost:8787" }]);
  });
});

describe("C2/B4: incidents from receipts, owners paid, config change, Raven gas", () => {
  let n = 0;
  const rc = (method: string, at: number, over: Partial<StoredReceipt> = {}) => store.putReceipt({ receipt_id: `C${++n}`, tx: `Tx${n}`, method, ok: true, at, predecessor: "x.testnet", args: {}, job: null, quote: null, ...over });
  const company = async () => parsed(Company, await get("/v1/company"));
  const review = (at: number, jobId: number, result: Record<string, unknown>) => rc("on_review", at, { job: jobId, args: { job: jobId, result } });

  it("logs late work, a re-auction, the strikes and the cage, with the time of each call", async () => {
    job(1, { state: "awarded", worker: "raven-worker.testnet", excluded: "crab-worker.testnet", reauctioned: true });
    job(2, { state: "refunded", worker: "crab-worker.testnet", codes: ["BRIEF_INVALID"] });
    rc("expire_work", NOW - 900, { job: 1 });
    review(NOW - 800, 2, { mode: "primary", pass: false, codes: ["BRIEF_INVALID"] });
    review(NOW - 700, 3, { mode: "primary", pass: false, codes: ["BRIEF_INVALID"] });
    review(NOW - 600, 4, { mode: "primary", pass: false, codes: ["COMPLAINT_UPHELD"] });
    const c = await company();
    expect(c.incidents.map((i) => [i.at, i.orderId, i.kind, i.strike])).toEqual([
      [new Date((NOW - 600) * 1000).toISOString().replace(".000", ""), null, "strike", true],
      [new Date((NOW - 600) * 1000).toISOString().replace(".000", ""), "j_000004", "complaint_upheld", true],
      [new Date((NOW - 700) * 1000).toISOString().replace(".000", ""), "j_000003", "brief_invalid", true],
      [new Date((NOW - 800) * 1000).toISOString().replace(".000", ""), "j_000002", "brief_invalid", true],
      [new Date((NOW - 900) * 1000).toISOString().replace(".000", ""), "j_000001", "late", false],
    ]);
    expect(c.incidents.at(-1)?.text).toBe("Crab missed its deadline. The job went back to auction.");
    expect(c.incidents[0].text).toBe("Shark is caged after 3 strikes. It takes no new orders until the owners reset them.");
    for (const i of c.incidents) expect(i.text).not.toMatch(/[;—–]|\w-\w/);
  });

  it("restarts the strike count when the owners reset it", async () => {
    rc("on_review", NOW - 500, { job: 5, args: { result: { mode: "primary", codes: ["BRIEF_INVALID"] } } });
    rc("on_review", NOW - 400, { job: 6, args: { result: { mode: "primary", codes: ["BRIEF_INVALID"] } } });
    rc("reset_strikes", NOW - 300);
    rc("on_review", NOW - 200, { job: 7, args: { result: { mode: "primary", codes: ["BRIEF_INVALID"] } } });
    expect((await company()).incidents.some((i) => i.kind === "strike")).toBe(false);
  });

  it("shows a suspended worker and the payouts that failed", async () => {
    app = makeApp(
      fakeChain({
        workers: async () => [{ id: "crab-worker.testnet", types: ["extract", "summary", "thread"], min_fees: ["100000", "60000", "120000"], jobs: 9, first_pass: 3, final_fails: 3, disputes_won: 0, disputes_lost: 2, disputes_unresolved: 0, unresolved_open: 0, late: 0, suspended: true }],
        owed: async () => [{ id: 1, job: 5, to: "crab-worker.testnet", amount: "180000", kind: "worker" }],
      }),
    );
    rc("suspend", NOW - 100, { args: { id: "crab-worker.testnet" } });
    const c = await company();
    expect(c.incidents.map((i) => [i.kind, i.orderId, i.text])).toEqual([
      ["payout_failed", "j_000005", "A worker payout of 0.18 to crab failed. Shark retries it every hour."],
      ["worker_suspended", null, "Crab was suspended after too many fails. Only the owners can bring it back."],
    ]);
    expect(c.incidents[1].at).toBe(new Date((NOW - 100) * 1000).toISOString().replace(".000", ""));
    // the first sighting is remembered, so a later read shows the same time
    app = makeApp(fakeChain({ owed: async () => [{ id: 1, job: 5, to: "crab-worker.testnet", amount: "180000", kind: "worker" }] }), () => NOW + 3000);
    expect((await company()).incidents[0].at).toBe(new Date(NOW * 1000).toISOString().replace(".000", ""));
  });

  it("flags a refund that has been waiting too long, not a fresh one", async () => {
    job(8, { state: "refund_due" });
    expect((await company()).incidents).toEqual([]);
    app = makeApp(fakeChain(), () => NOW + 601);
    expect((await company()).incidents.map((i) => [i.orderId, i.kind])).toEqual([["j_000008", "payout_failed"]]);
  });

  it("owners paid: the last 7 days against a snapshot a week old, and the config change time and tx", async () => {
    let paid = "300000";
    const chain = () => fakeChain({ stats: async () => ({ jobs: jobs.size, strikes: 0, reserve: "0", owner_accrued: "0", accounted: "0", open_jobs: 0, owed_open: 0, owners_paid: paid, config_changed_at: NOW - 50 }) });
    app = makeApp(chain(), () => NOW - 8 * 86_400);
    expect((await company()).pnl7d.ownersPaid).toBe("0.30"); // first sight: nothing older, so all of it
    paid = "500000";
    app = makeApp(chain(), () => NOW);
    expect((await company()).pnl7d.ownersPaid).toBe("0.20"); // 0.50 now less the 0.30 seen 8 days ago
    rc("set_config", NOW - 50);
    const c = await company();
    expect([c.config.changedAt, c.config.changeTx]).toEqual([new Date((NOW - 50) * 1000).toISOString().replace(".000", ""), `Tx${n}`]);
  });

  it("Raven gas: the Base Sepolia balance and what it pays for, else a placeholder", async () => {
    expect((await company()).reserve.ravenPayoutGas).toEqual({ balanceEth: "0", payoutsLeft: null, warnBelow: 5 });
    app = makeApp(fakeChain({ ravenGas: async () => ({ balanceWei: "3250000000000000", gasPriceWei: "1000000000" }) })); // 0.00325 ETH at 1 gwei
    expect((await company()).reserve.ravenPayoutGas).toEqual({ balanceEth: "0.003250000000000000", payoutsLeft: 50, warnBelow: 5 });
    app = makeApp(fakeChain({ ravenGas: async () => { throw new Error("rpc down"); } }));
    expect((await company()).reserve.ravenPayoutGas.payoutsLeft).toBeNull();
  });
});

describe("a failed call in the job loop is asked again (review 1 and 5)", () => {
  it("sends the award again when the first one failed", async () => {
    job(1, unawarded);
    let fail = true;
    const chain = fakeChain({ award: async (j, w, fee) => { if (fail) throw new Error("rpc down"); txs.push(`award ${j} ${w} ${fee}`); return "TxAward"; } });
    await tick(loopDeps({ "http://crab.local": crab }, [], chain));
    expect(txs).toEqual([]);
    expect(store.auction(1)!.award_tx).toBeNull();
    fail = false;
    await tick(loopDeps({ "http://crab.local": crab }, [], chain));
    expect(txs).toEqual(["award 1 crab-worker.testnet 180000"]);
    expect(store.auction(1)!.award_tx).toBe("TxAward");
    await tick(loopDeps({ "http://crab.local": crab }, [], chain)); // sent, not seen yet: nothing more
    expect(txs).toHaveLength(1);
  });
  it("asks for the refund again when nobody bid and the first ask failed", async () => {
    job(1, unawarded);
    let fail = true;
    const chain = fakeChain({ markRefundDue: async (j) => { if (fail) throw new Error("rpc down"); txs.push(`refund_due ${j}`); return "TxRefundDue"; } });
    await tick(loopDeps({}, [], chain));
    expect(txs).toEqual([]);
    fail = false;
    await tick(loopDeps({}, [], chain));
    expect(txs).toEqual(["refund_due 1"]);
  });
  it("refunds a job that could not be awarded within the job timeout", async () => {
    job(1, { ...unawarded, paid_at: NOW - 21_601 });
    const chain = fakeChain({ award: async () => { throw new Error("key has no allowance left"); } });
    await tick(loopDeps({ "http://crab.local": crab }, [], chain));
    await tick(loopDeps({ "http://crab.local": crab }, [], chain));
    expect(txs).toEqual(["refund_due 1"]);
  });
  it("tries the daily keepers again after a network error, not after the contract said no", async () => {
    const day = 20_758 * 86_400;
    const deps = (chain: Chain) => ({ ...loopDeps({}, [], chain), now: () => day + 301 });
    const down = fakeChain({ fundShark: async () => { throw new Error("fetch failed"); } });
    await tick(deps(down));
    await tick(deps(down));
    expect(keeperTxs).toEqual(["pay_owners", "pay_owners"]); // fund_shark is asked every tick while the network is down
    await tick(deps(fakeChain()));
    await tick(deps(fakeChain()));
    expect(keeperTxs).toEqual(["pay_owners", "pay_owners", "fund_shark", "pay_owners"]); // then once, and the day is done
  });
});

describe("public reads under load (review 2, 3 and 4)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("rate limit counts the last x-forwarded-for value, which a client cannot fake", async () => {
    app = createApp({ config: { ...config, rateLimitPerMin: 3 }, chain: fakeChain(), store, now: () => NOW });
    const hit = (xff: string) => app.request("/v1/health", { headers: { "x-forwarded-for": xff } });
    for (const fake of ["1.1.1.1", "2.2.2.2", "3.3.3.3"]) expect((await hit(`${fake}, 9.9.9.9`)).status).toBe(200); // the proxy added 9.9.9.9
    expect((await hit("4.4.4.4, 9.9.9.9")).status).toBe(429);
    expect((await hit("4.4.4.4, 8.8.8.8")).status).toBe(200); // another client behind the same proxy
  });

  it("keeps health, prices and company for cacheSecs, shares one read, and does not keep a failure", async () => {
    let reads = 0;
    let now = NOW;
    let broken = false;
    const chain = fakeChain({ stats: async () => (reads++, { jobs: 0, strikes: 0, reserve: "1000000", owner_accrued: "0", accounted: "0", open_jobs: 0, owed_open: 0, owners_paid: "0", config_changed_at: null }), serviceState: async () => { if (broken) throw new Error("rpc down"); return "ok"; } });
    app = createApp({ config: { ...config, cacheSecs: 10 }, chain, store, now: () => now });
    await Promise.all([get("/v1/company"), get("/v1/company"), get("/v1/company")]);
    expect(reads).toBe(1); // three at once is one read
    now += 9;
    await get("/v1/company");
    expect(reads).toBe(1);
    now += 1;
    await get("/v1/company");
    expect(reads).toBe(2);
    broken = true;
    now += 10;
    expect((await get("/v1/health")).status).toBe(502);
    broken = false;
    expect((await get("/v1/health")).status).toBe(200); // the failure was not kept
  });

  it("Raven's Base balance read has a timeout and turns hex wei into decimal", async () => {
    const seen: (AbortSignal | null | undefined)[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      seen.push(init.signal);
      const { method } = JSON.parse(String(init.body));
      return Response.json({ jsonrpc: "2.0", id: 1, result: method === "eth_getBalance" ? "0xb8a9a9ff3000" : "0x3b9aca00" });
    });
    const chain = rpcChain({ rpcUrl: "http://rpc.invalid", contractId: "sharkco.testnet", usdcId: USDC, evmRpcUrl: "http://base.invalid", payoutEvmAddress: "0x0000000000000000000000000000000000000001" });
    expect(await chain.ravenGas()).toEqual({ balanceWei: "203038841057280", gasPriceWei: "1000000000" });
    expect(seen.every((s) => s instanceof AbortSignal)).toBe(true);
    expect(await rpcChain({ rpcUrl: "http://rpc.invalid", contractId: "x", usdcId: USDC }).ravenGas()).toBeNull();
  });
});

describe("a suspended worker without a suspend call (review 6)", () => {
  it("keeps the time Shark first saw it instead of the time of the request", async () => {
    const suspended = fakeChain({
      workers: async () => [{ id: "crab-worker.testnet", types: ["extract", "summary", "thread"], min_fees: ["100000", "60000", "120000"], jobs: 9, first_pass: 3, final_fails: 3, disputes_won: 0, disputes_lost: 2, disputes_unresolved: 0, unresolved_open: 0, late: 0, suspended: true }],
    });
    const at = async (now: number) => {
      app = makeApp(suspended, () => now);
      return (await parsed(Company, await get("/v1/company"))).incidents.map((i) => [i.kind, i.at]);
    };
    const first = new Date(NOW * 1000).toISOString().replace(".000", "");
    expect(await at(NOW)).toEqual([["worker_suspended", first]]);
    expect(await at(NOW + 3_000)).toEqual([["worker_suspended", first]]);
  });
});

describe("housekeeping and a lost escrow (review 10 and 12)", () => {
  it("sends the escrow again when it never arrived, but not before two minutes, and stops once escrowed", async () => {
    job(1, unawarded);
    await tick(loopDeps({ "http://crab.local": crab }));
    job(1, { ...jobs.get(1)!, state: "awarded", worker: "crab-worker.testnet", worker_fee: "180000", escrowed: false, awarded_at: NOW, work_deadline: NOW + 600 });
    const at = async (now: number, chain = fakeChain()) => tick({ ...loopDeps({ "http://crab.local": crab }, [], chain), now: () => now });
    await at(NOW);
    expect(txs.filter((t) => t.startsWith("escrow"))).toEqual(["escrow 1 230000"]);
    await at(NOW + 100); // too soon
    expect(txs.filter((t) => t.startsWith("escrow"))).toHaveLength(1);
    await at(NOW + 121); // the first one never showed up on chain
    expect(txs.filter((t) => t.startsWith("escrow"))).toHaveLength(2);
    job(1, { ...jobs.get(1)!, escrowed: true });
    await at(NOW + 300);
    expect(txs.filter((t) => t.startsWith("escrow"))).toHaveLength(2);
  });

  it("forgets first sightings that are no longer true, and keeps the ones that are", async () => {
    store.setKv("owed_seen:1", "100");
    store.setKv("owed_seen:2", "200");
    store.setKv("refund_seen:7", "300");
    store.setKv("other", "x");
    store.keepSeen("owed_seen:", [2]);
    store.keepSeen("refund_seen:", []);
    expect([store.kv("owed_seen:1"), store.kv("owed_seen:2"), store.kv("refund_seen:7"), store.kv("other")]).toEqual([null, "200", null, "x"]);
  });

  it("drops nonces older than a day when the store opens", () => {
    const dir = mkdtempSync(join(tmpdir(), "shark-nonce-"));
    const first = openStore(dir);
    const old = Math.floor(Date.now() / 1000) - 2 * 86_400;
    expect(first.useNonce("old", old, "view:a:j_000001", false)).toBe(true);
    expect(first.useNonce("fresh", Math.floor(Date.now() / 1000), "view:a:j_000001", false)).toBe(true);
    const again = openStore(dir);
    expect(again.useNonce("old", Math.floor(Date.now() / 1000), "view:a:j_000001", false)).toBe(true); // gone, so usable again
    expect(again.useNonce("fresh", Math.floor(Date.now() / 1000), "view:a:j_000001", false)).toBe(false); // still known
  });
});

describe("security audit: file hashes, links, body size, worker token", () => {
  it("1: a hash cannot reach a file outside files/ (a worker chooses delivery and reasons hashes)", () => {
    const root = mkdtempSync(join(tmpdir(), "shark-trav-"));
    mkdirSync(join(root, "data"));
    writeFileSync(join(root, ".env"), "SHARK_WALLET_KEY=ed25519:SECRET");
    const st = openStore(join(root, "data"));
    for (const bad of ["../.env", "sha256:../../.env", "sha256:..\..\.env", "a/b", "sha256:", "", "sha256:ab.cd"]) {
      expect(st.blob(bad)).toBeNull();
      expect(() => st.putBlob(bad, "x")).toThrow();
    }
    st.putBlob("sha256:abc123", "fine");
    expect(st.blob("sha256:abc123")).toBe("fine");
  });

  it("2: links to private, mapped, reserved and odd port addresses are refused before any request", async () => {
    const blocked = ["http://127.0.0.1/", "http://0x7f.1/", "http://[::1]/", "http://[::ffff:7f00:1]/", "http://[::ffff:127.0.0.1]/", "http://[::ffff:a9fe:a9fe]/latest/meta-data/", "http://[64:ff9b::7f00:1]/", "http://[fec0::1]/", "http://[2002:7f00:1::1]/", "http://224.0.0.1/", "http://198.18.0.1/", "http://169.254.169.254/", "http://10.0.0.5/", "http://93.184.216.34:8080/", "https://93.184.216.34:22/"];
    for (const url of blocked) {
      let sent = false;
      const f = (async () => ((sent = true), new Response("secret", { headers: { "content-type": "text/plain" } }))) as unknown as typeof fetch;
      await expect(fetchSnapshot(url, f), url).rejects.toMatchObject({ status: 422, code: "input_unreadable" });
      expect(sent, url).toBe(false);
    }
    const ok = (async () => new Response("An article about NEAR.", { headers: { "content-type": "text/plain" } })) as unknown as typeof fetch;
    for (const url of ["http://93.184.216.34/", "https://93.184.216.34:443/", "http://[2606:4700:4700::1111]/"]) expect((await fetchSnapshot(url, ok)).words).toBe(4);
  });

  it("3: a body over 3 MB is refused with 413 before it is read", async () => {
    const res = await app.request("/v1/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: "x".repeat(3 * 1024 * 1024 + 1) });
    expect(res.status).toBe(413);
    expect((await parsed(ApiError, res)).error).toBe("input_too_large");
    expect((await post("/v1/orders", order())).status).toBe(402); // a normal order still works
  });

  it("4: Shark sends its token to the workers on every call", async () => {
    job(1, unawarded);
    const seen: { url: string; token: string | null }[] = [];
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      seen.push({ url: String(url), token: new Headers(init?.headers).get("X-Shark-Token") });
      return workersFetch({ "http://crab.local": crab }, [])(url, init);
    }) as typeof fetch;
    await tick({ ...loopDeps({}), config: { ...config, agentToken: "tok" }, fetchImpl });
    expect(seen.map((s) => s.url)).toEqual(["http://crab.local/rfq", "http://raven.local/rfq"]);
    expect(seen.every((s) => s.token === "tok")).toBe(true);
    job(1, { ...jobs.get(1)!, state: "awarded", worker: "crab-worker.testnet", escrowed: true, work_deadline: NOW + 500 });
    await tick({ ...loopDeps({}), config: { ...config, agentToken: "tok" }, fetchImpl });
    expect(seen.at(-1)).toEqual({ url: "http://crab.local/award", token: "tok" });
  });
});
