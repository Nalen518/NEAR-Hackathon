// Orders, quotes, uploads, the job views and complaints (API §1.1 to §1.6, v2.3 P1 and P2).
import {
  ComplaintRequest,
  ExtractParams,
  fromBase,
  OrderRequest,
  REVIEW_CODES,
  SignedMessage,
  type Brief,
  type Order,
  type OrderPayer,
  type OrderPublic,
  type Quote402,
  type QuoteStatus,
  type UploadResult,
  SummaryParams,
  ThreadParams,
} from "@shark/shared";
import type { Hono } from "hono";
import { buildBrief, priceJob, refuseHarmful } from "./brief";
import type { Chain, ContractJob } from "./chain";
import type { Config } from "./config";
import { HttpError } from "./errors";
import { fetchSnapshot, fileToSnapshot, MAX_BYTES, snapshotText, type Snapshot } from "./input";
import { canonicalJson, sha256Ref, signQuote, ulid, type SignedQuote } from "./quote";
import type { QuoteRow, Store } from "./store";

export type OrderDeps = { config: Config; chain: Chain; store: Store; now: () => number; fetchImpl?: typeof fetch };

const QUOTE_TTL_SECS = 600; // FR-08
const IDEM_WINDOW_SECS = 600;
const AUTH_MAX_AGE_SECS = 300; // v2.3 P1
const PAY_GAS = "100000000000000"; // O-18: measure on testnet
const REGISTER_GAS = "30000000000000";
const REGISTER_DEPOSIT = "1250000000000000000000";

const iso = (secs: number) => new Date(secs * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
const orderId = (id: number) => `j_${String(id).padStart(6, "0")}`;
const usdc = (base: string | bigint) => fromBase(BigInt(base));
const badField = (field: string, message: string) => new HttpError(400, "invalid_request", message, { field });
const FIELD_OF: Record<string, string> = { input: "source", params: "instructions", jobType: "instructions" };

function parseOrderId(raw: string): number {
  const m = /^j_(\d{6,})$/.exec(raw);
  if (!m) throw new HttpError(404, "order_not_found", "There is no job with that number.");
  return Number(m[1]);
}

export function orderRoutes(app: Hono, d: OrderDeps) {
  const { config, chain, store, now } = d;
  const ctx: ViewCtx = { networkId: config.networkId, blob: store.blob };

  async function serviceCheck(jobType: string) {
    const state = await chain.serviceState();
    if (state !== "ok") throw new HttpError(503, state, `Shark is ${state} and takes no new orders right now. Nothing was charged.`, undefined, 60);
    const workers = await chain.workers();
    if (!workers.some((w) => !w.suspended && w.types.includes(jobType as never)))
      throw new HttpError(503, "no_worker", "No worker can take this job right now. Nothing was charged.", undefined, 60);
    // shortcut: out_of_budget needs Shark's wallet balance; add it with the OutLayer wallet (FR-64)
  }

  async function snapshotFor(input: OrderRequest["input"]): Promise<{ snap: Snapshot; source: string | null } | null> {
    if (!input) return null;
    if ("text" in input) return { snap: snapshotText(input.text), source: null };
    if ("url" in input) return { snap: await fetchSnapshot(input.url, d.fetchImpl), source: input.url };
    const f = store.file(input.fileId);
    const text = f ? store.blob(f.hash) : null;
    if (!f || text === null) throw badField("source", "That upload is not known here. Upload the file again.");
    return { snap: { text, pages: f.pages, words: f.words }, source: null };
  }

  // §1.1
  app.post("/v1/uploads", async (c) => {
    const form = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
    const file = form.file;
    if (!(file instanceof File)) throw badField("source", "Send the file as multipart field `file`.");
    if (file.size > MAX_BYTES) throw new HttpError(413, "input_too_large", "The file is over 2 MB. Nothing was charged.");
    const snap = await fileToSnapshot(new Uint8Array(await file.arrayBuffer()), file.name, file.type);
    const hash = sha256Ref(snap.text);
    store.putBlob(hash, snap.text);
    const id = `f_${ulid(now() * 1000)}`;
    store.putFile({ id, hash, bytes: file.size, pages: snap.pages, words: snap.words });
    return c.json({ fileId: id, bytes: file.size, pages: snap.pages, words: snap.words, inputHash: hash } satisfies UploadResult);
  });

  // §1.2
  app.post("/v1/orders", async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const net = (body as { network?: unknown } | null)?.network;
    if (net !== undefined && net !== config.networkId)
      throw new HttpError(400, "network_mismatch", `This Shark serves ${config.networkId}.`, { field: "network" });
    const parsed = OrderRequest.safeParse(body);
    if (!parsed.success) {
      const key = String(parsed.error.issues[0]?.path[0] ?? "instructions");
      throw badField(FIELD_OF[key] ?? key, "Check this field and send the order again.");
    }
    // the shared union accepts any job type's params, so check them against this job type's schema
    const PARAMS = { extract: ExtractParams, summary: SummaryParams, thread: ThreadParams };
    const params = PARAMS[parsed.data.jobType].safeParse((body as { params?: unknown }).params ?? {});
    if (!params.success) throw badField("instructions", "Check the options for this job type and send the order again.");
    const req = { ...parsed.data, params: params.data };
    if (req.payWith) throw new HttpError(422, "intents_unavailable", "Paying from another chain works on mainnet only.");

    const idem = c.req.header("Idempotency-Key") ?? null;
    const bodyHash = sha256Ref(canonicalJson(req));
    if (idem) {
      const prev = store.quoteByIdem(idem, now() - IDEM_WINDOW_SECS);
      if (prev) {
        if (prev.body_hash !== bodyHash) throw new HttpError(409, "idempotency_conflict", "This Idempotency-Key was used for another order.");
        const job = await chain.jobByQuote(prev.id);
        if (job) return c.json({ orderId: orderId(job.id), status: "paid", statusUrl: `/v1/orders/${orderId(job.id)}` }, 202);
        if (now() > prev.expires_at) throw new HttpError(410, "quote_expired", "This quote expired. Ask for a new one.");
        c.header("WWW-Authenticate", `SharkQuote quote_id="${prev.id}"`);
        return c.json(JSON.parse(prev.response), 402);
      }
    }

    await serviceCheck(req.jobType);
    if (!(await chain.accountExists(req.payer))) throw new HttpError(400, "invalid_payer", `${req.payer} is not an account on ${config.networkId}.`, { field: "payer" });
    const referrer = req.referrer && req.referrer !== req.payer && (await chain.accountExists(req.referrer)) ? req.referrer : null;
    refuseHarmful(req.instructions);
    if (!req.input && req.jobType !== "thread") throw badField("source", "Add a link, a file or text to work from.");

    const snap = await snapshotFor(req.input);
    const size = snap ? { pages: snap.snap.pages, words: snap.snap.words } : { pages: 0, words: 0 };
    const inputHash = sha256Ref(snap?.snap.text ?? "");
    if (snap) store.putBlob(inputHash, snap.snap.text);
    const brief = buildBrief(req.jobType, req.params);
    const briefHash = sha256Ref(canonicalJson(brief));
    store.putBlob(briefHash, canonicalJson(brief));

    const [cfg, floorBase] = await Promise.all([chain.config(), chain.priceFloor(req.jobType)]);
    const band = { min: BigInt(cfg[req.jobType].band_min), max: BigInt(cfg[req.jobType].band_max) };
    const floor = BigInt(floorBase);
    if (floor > band.max) throw new HttpError(503, "no_worker", "No worker can take this job inside its price band right now. Nothing was charged.", undefined, 60);
    const { price, reason } = priceJob(brief, size, band, floor);

    const quoteId = `q_${ulid(now() * 1000)}`;
    const expiresAt = now() + QUOTE_TTL_SECS;
    const quote: SignedQuote = {
      quote_id: quoteId,
      network: config.networkId,
      job_type: req.jobType,
      price: price.toString(),
      payer: req.payer,
      input_hash: inputHash,
      brief_hash: briefHash,
      referrer,
      expires_at: expiresAt,
    };
    const sig = signQuote(quote, config.quoteKey);
    const registered = await chain.usdcRegistered(req.payer);
    const res: Quote402 = {
      orderId: null,
      quoteId,
      jobType: req.jobType,
      price: usdc(price),
      band: { min: usdc(band.min), max: usdc(band.max) },
      floor: usdc(floor),
      priceReason: reason,
      input: { inputHash, pages: size.pages, words: size.words, source: snap?.source ?? null },
      brief,
      briefHash,
      quote,
      sig,
      pay: {
        network: config.networkId,
        token: config.usdcId,
        method: "ft_transfer_call",
        args: { receiver_id: config.contractId, amount: price.toString(), msg: `pay:${Buffer.from(JSON.stringify({ quote, sig })).toString("base64")}` },
        gas: PAY_GAS,
        deposit: "1",
      },
      payerRegistered: registered,
      register: registered
        ? null
        : { contract: config.usdcId, method: "storage_deposit", args: { account_id: req.payer, registration_only: true }, gas: REGISTER_GAS, deposit: REGISTER_DEPOSIT },
      intents: null,
      expiresAt: iso(expiresAt),
      charged: false,
    };
    store.putQuote({
      id: quoteId,
      idem,
      body_hash: bodyHash,
      created_at: now(),
      expires_at: expiresAt,
      payer: req.payer,
      job_type: req.jobType,
      price: price.toString(),
      reason,
      instructions: req.instructions,
      brief: JSON.stringify(brief),
      input: JSON.stringify(res.input),
      response: JSON.stringify(res),
    });
    // shortcut: no x402 PAYMENT-REQUIRED header yet; it comes with the x402 slice (FR-12)
    c.header("WWW-Authenticate", `SharkQuote quote_id="${quoteId}"`);
    return c.json(res, 402);
  });

  // §1.3
  app.get("/v1/quotes/:id", async (c) => {
    const row = store.quote(c.req.param("id"));
    if (!row) throw badField("quoteId", "There is no quote with that id.");
    const job = await chain.jobByQuote(row.id);
    // shortcut: RETURNED needs the payment_returned event (an indexer); until then a returned payment shows AWAITING_PAYMENT, then EXPIRED
    const status: QuoteStatus["status"] = job ? "PAID" : now() > row.expires_at ? "EXPIRED" : "AWAITING_PAYMENT";
    return c.json({ quoteId: row.id, method: "quote", status, orderId: job ? orderId(job.id) : null, paymentTx: null, oneClickStatus: null } satisfies QuoteStatus);
  });

  async function loadJob(raw: string) {
    const job = await chain.job(parseOrderId(raw));
    if (!job) throw new HttpError(404, "order_not_found", "There is no job with that number.");
    return { job, row: store.quote(job.quote_id) };
  }

  // §1.5 public view
  app.get("/v1/orders/:id", async (c) => {
    const { job, row } = await loadJob(c.req.param("id"));
    return c.json(orderView(job, row, "public", ctx));
  });

  /** NEP-413 proof that the caller is this job's payer (v2.3 P1). */
  async function payerAuth(kind: "view" | "complain", auth: SignedMessage, job: ContractJob) {
    const fail = (why: string) => new HttpError(401, "payer_signature_invalid", `The signature didn't check out (${why}). Sign in again.`);
    const m = new RegExp(`^sharkco:${kind}:${orderId(job.id)}:(\\d+)$`).exec(auth.message);
    if (!m) throw fail("wrong message");
    const ts = Number(m[1]);
    if (ts < now() - AUTH_MAX_AGE_SECS || ts > now() + 60) throw fail("expired");
    if (auth.recipient !== config.contractId) throw fail("wrong recipient");
    if (Buffer.from(auth.nonce, "base64").length !== 32) throw fail("bad nonce");
    if (!(await chain.verifyNep413(auth))) throw fail("bad signature");
    if (!store.useNonce(auth.nonce, now())) throw fail("signature already used");
    if (auth.accountId !== job.payer) throw new HttpError(403, "not_payer", "Only the account that paid for this job can do this.");
  }

  // v2.3 P1 payer view
  app.post("/v1/orders/:id/view", async (c) => {
    const { job, row } = await loadJob(c.req.param("id"));
    const auth = SignedMessage.safeParse(await c.req.json().catch(() => null));
    if (!auth.success) throw new HttpError(401, "payer_signature_invalid", "Send the signed message from your wallet.");
    await payerAuth("view", auth.data, job);
    c.header("Cache-Control", "private, no-store");
    return c.json(orderView(job, row, "payer", ctx));
  });

  // §1.6, v2.3 P2
  app.post("/v1/orders/:id/complaint", async (c) => {
    const { job } = await loadJob(c.req.param("id"));
    const req = ComplaintRequest.safeParse(await c.req.json().catch(() => null));
    if (!req.success) {
      const field = req.error.issues[0]?.path[0];
      if (field === "auth") throw new HttpError(401, "payer_signature_invalid", "Send the signed message from your wallet.");
      throw badField("reason", "Say in up to 1 000 characters what didn't match your order.");
    }
    await payerAuth("complain", req.data.auth, job);
    if (job.state !== "delivered" || job.complaint_hash || !job.complaint_until || now() > job.complaint_until)
      throw new HttpError(409, "complaint_closed", "Complaints for this job are closed.");
    const DAY = 86_400;
    if (store.complaintsSince(job.payer, now() - DAY) >= 3) throw new HttpError(429, "rate_limited", "Three complaints a day is the limit. Try again tomorrow.", undefined, 3600);
    const reasonHash = sha256Ref(req.data.reason);
    store.putBlob(reasonHash, req.data.reason);
    await chain.complain(job.id, reasonHash);
    store.addComplaint(job.payer, now());
    return c.json({ status: "complaint_review" }, 202);
  });
}

const PASSED: ContractJob["state"][] = ["delivered", "complaint_review", "finalized"];
type ViewCtx = { networkId: Config["networkId"]; blob: Store["blob"] };

/** Contract job + Shark's quote record → the §1.5 shape. The public view never carries private fields (D-166). */
function orderView(job: ContractJob, row: QuoteRow | undefined, view: "public", ctx: ViewCtx): OrderPublic;
function orderView(job: ContractJob, row: QuoteRow | undefined, view: "payer", ctx: ViewCtx): OrderPayer;
function orderView(job: ContractJob, row: QuoteRow | undefined, view: Order["view"], ctx: ViewCtx): Order {
  const brief: Brief = row ? JSON.parse(row.brief) : { jobType: job.job_type, params: {}, checklist: [], deliverableFormat: "text/plain" };
  const input: Quote402["input"] = row ? JSON.parse(row.input) : { inputHash: job.input_hash, pages: 0, words: 0, source: null };
  const passed = job.codes.includes("PASS");
  const codes = job.codes.filter((x): x is (typeof REVIEW_CODES)[number] => (REVIEW_CODES as readonly string[]).includes(x));

  const timeline: Order["timeline"] = [{ at: iso(job.paid_at), event: "paid" }];
  // shortcut: only the latest award, delivery and review times are on chain; the full event history comes from NEP-297 events (B1)
  if (job.awarded_at) timeline.push({ at: iso(job.awarded_at), event: "awarded" });
  if (job.delivered_at) timeline.push({ at: iso(job.delivered_at), event: "delivered_for_review", round: job.round });
  if (job.reviewed_at) {
    if (job.state === "revision") timeline.push({ at: iso(job.reviewed_at), event: "review_fail", round: 1 }, { at: iso(job.reviewed_at), event: "revision_requested", round: 2 });
    else timeline.push({ at: iso(job.reviewed_at), event: passed ? "review_pass" : "review_fail", round: job.round });
  }

  const workerFee = BigInt(job.worker_fee);
  const price = BigInt(job.price);
  let money: Order["money"] = null;
  if (workerFee > 0n) {
    const reviewFee = BigInt(job.review_fee);
    const referral = job.referrer && job.referrer !== job.payer && job.referrer !== job.worker ? (price * BigInt(job.referral_bps)) / 10_000n : 0n;
    const profit = price - workerFee - reviewFee - referral;
    const owners = profit > 0n ? (profit * BigInt(job.owner_bps)) / 10_000n : 0n;
    money = { method: "quote", price: usdc(price), workerFee: usdc(workerFee), reviewFee: usdc(reviewFee), referral: usdc(referral), owners: usdc(owners), reserve: usdc(price - referral - owners) };
  }

  const refunding = job.state === "refund_due" || job.state === "refunded";
  const refundReason = codes.includes("COMPLAINT_UPHELD")
    ? "Complaint upheld"
    : codes.includes("BRIEF_INVALID")
      ? "The brief could not be met"
      : job.reviewed_at
        ? "The work failed review twice"
        : "No worker finished in time";

  const base = {
    orderId: orderId(job.id),
    status: job.state,
    network: ctx.networkId,
    jobType: job.job_type,
    price: usdc(price),
    briefHash: job.brief_hash,
    inputHash: job.input_hash,
    timeline,
    // shortcut: the auction record and Owl's reasons text arrive with the auction and Owl slices
    auction: null,
    reviews: job.reviewed_at
      ? [{ round: job.round, mode: "primary" as const, pass: passed, codes, reasons: passed ? "All checks passed." : "The delivery did not pass review.", attestationUrl: null }]
      : [],
    money,
    complaint: {
      allowedUntil: job.complaint_until ? iso(job.complaint_until) : null,
      status:
        job.state === "complaint_review" ? ("complaint_review" as const) : job.complaint_hash ? (refunding ? ("upheld" as const) : ("rejected" as const)) : null,
    },
    refund: refunding ? { to: job.payer, amount: usdc(price), reason: refundReason, tx: null } : null,
    proof: { paymentTx: null, awardTx: null, workerPayoutTx: null, contractTxs: [] },
    sample: false,
  };
  if (view === "public")
    return { ...base, view, brief: { jobType: brief.jobType, checklist: brief.checklist.map(({ id, kind }) => ({ id, kind })) }, size: { pages: input.pages, words: input.words } };
  return {
    ...base,
    view,
    brief,
    instructions: row?.instructions ?? "",
    input: { source: input.source, pages: input.pages, words: input.words },
    // delivery stays null until a review passes, and for unresolved and refunds, even for the payer (A9)
    delivery: PASSED.includes(job.state) && job.delivery_hash ? deliveryOf(job.delivery_hash, brief, ctx) : null,
  };
}

function deliveryOf(hash: string, brief: Brief, ctx: ViewCtx): OrderPayer["delivery"] {
  const content = ctx.blob(hash);
  return content === null ? null : { format: brief.deliverableFormat as "text/plain" | "text/markdown" | "application/json", content, deliveryHash: hash };
}
