// Mock API: the real client runs with this fetch in place of window.fetch, so wiring
// to the live API (W6) changes nothing but NEXT_PUBLIC_API_MODE.
// Dev only: ?mock=<scenario> picks a scenario (prompt v2.1 §3). Production builds ignore it.
import { fromBase, toBase } from "@shark/shared";
import type { Company, ErrorCode, Network, Order, OrderPayer, OrderStatus, Prices, Quote402, Review, TimelineEvent } from "@shark/shared";
import company from "@shark/shared/fixtures/company.json";
import health from "@shark/shared/fixtures/health.json";
import orderPayer from "@shark/shared/fixtures/order-delivered-payer.json";
import paymentOptions from "@shark/shared/fixtures/payment-options-testnet.json";
import prices from "@shark/shared/fixtures/prices.json";
import quote402 from "@shark/shared/fixtures/quote-402.json";
import upload from "@shark/shared/fixtures/upload.json";

export const SCENARIOS = {
  ok: "Fixtures; a paid order is delivered",
  quoting: "POST /v1/orders takes 6 s (Shark is writing your brief)",
  refused: "422 job_refused",
  infeasible: "422 brief_infeasible",
  unreadable: "422 input_unreadable",
  too_large: "413 input_too_large",
  closed: "503 closed",
  paused: "503 paused",
  caged: "503 caged, strikes 3 of 3",
  no_worker: "503 no_worker",
  out_of_budget: "503 out_of_budget, Retry-After 3600",
  rate_limited: "429, Retry-After 30",
  upstream_down: "502 upstream_unavailable on every call",
  returned: "The payment is sent back (quote RETURNED)",
  unregistered: "Payer not registered on USDC (storage_deposit first)",
  working: "Job stops at awarded (Crab working)",
  reviewing: "Job stops in review",
  revision: "First review fails, Crab revises",
  refunded: "Two fails, no dispute: refunded",
  dispute: "Two fails, Crab disputes: second review running",
  disputed_overturned: "Second review overturns the fail, Crab paid",
  unresolved: "Second review timed out: refunded, fee held",
  complaint_review: "Payer complained, review running",
  complaint_upheld: "Complaint upheld: refunded, Shark strike",
  complaint_rejected: "Complaint not upheld",
  finalized: "Complaint window over, split paid",
  needs_review: "A payment step is checked by hand",
  job_loading: "GET /v1/orders/{id} never resolves",
  job_unreachable: "GET /v1/orders/{id} fails with 502",
  public_view: "Job page without a payer signature",
  wrong_network: "The API host answers for the other network (API §0.3 N1)",
  thread_job: "A delivered X thread job (5 posts)",
  extract_job: "A delivered data extraction job (24 records)",
  incident_kinds: "Company page with a strike, a suspension and a failed payout",
  raven_gas_unset: "Raven has no Base address yet (gas 0, count unknown)",
} as const;
export type Scenario = keyof typeof SCENARIOS;

export function parseScenario(v: string | null): Scenario {
  if (process.env.NODE_ENV === "production") return "ok";
  return v && v in SCENARIOS ? (v as Scenario) : "ok";
}

const ERRORS: Partial<Record<Scenario, [number, ErrorCode, string, Record<string, string>?]>> = {
  refused: [422, "job_refused", "Shark doesn't take this job: it asks for personal data harvesting."],
  infeasible: [422, "brief_infeasible", "150 words can't cover 9 required points. Reduce the points or raise the limit."],
  unreadable: [422, "input_unreadable", "Shark couldn't read that page. It may block bots or be a PDF without text."],
  too_large: [413, "input_too_large", "That file is over 2 MB or 20 pages."],
  closed: [503, "closed", "The company has wound down."],
  paused: [503, "paused", "Paused by the guardian or the owners."],
  caged: [503, "caged", "Shark has 3 strikes. New orders wait until the owners reset them."],
  no_worker: [503, "no_worker", "No worker can take this job type right now."],
  out_of_budget: [503, "out_of_budget", "Shark's wallet can't fund a worker until the daily top up.", { "Retry-After": "3600" }],
  rate_limited: [429, "rate_limited", "Too many requests.", { "Retry-After": "30" }],
};

/** Timeline steps per scenario. A paid order walks them one per 2.5 s; the job page fixture shows them all. */
const STEPS: Partial<Record<Scenario, { events: TimelineEvent["event"][]; status: OrderStatus }>> = {
  working: { events: ["paid", "awarded"], status: "awarded" },
  reviewing: { events: ["paid", "awarded", "delivered_for_review"], status: "review" },
  revision: { events: ["paid", "awarded", "delivered_for_review", "review_fail", "revision_requested"], status: "revision" },
  refunded: { events: ["paid", "awarded", "delivered_for_review", "review_fail", "revision_requested", "delivered_for_review", "review_fail", "refund_due", "refunded"], status: "refunded" },
  dispute: { events: ["paid", "awarded", "delivered_for_review", "review_fail", "revision_requested", "delivered_for_review", "review_fail", "dispute"], status: "dispute_review" },
  disputed_overturned: { events: ["paid", "awarded", "delivered_for_review", "review_fail", "revision_requested", "delivered_for_review", "review_fail", "dispute", "second_review_pass", "worker_paid", "reviewer_paid"], status: "delivered" },
  unresolved: { events: ["paid", "awarded", "delivered_for_review", "review_fail", "revision_requested", "delivered_for_review", "review_fail", "dispute", "unresolved", "refunded"], status: "unresolved" },
  complaint_review: { events: ["paid", "awarded", "delivered_for_review", "review_pass", "worker_paid", "reviewer_paid", "complaint"], status: "complaint_review" },
  complaint_upheld: { events: ["paid", "awarded", "delivered_for_review", "review_pass", "worker_paid", "reviewer_paid", "complaint", "complaint_upheld", "refunded"], status: "refunded" },
  complaint_rejected: { events: ["paid", "awarded", "delivered_for_review", "review_pass", "worker_paid", "reviewer_paid", "complaint", "complaint_rejected"], status: "delivered" },
  finalized: { events: ["paid", "awarded", "delivered_for_review", "review_pass", "worker_paid", "reviewer_paid", "finalized"], status: "finalized" },
  needs_review: { events: ["paid", "awarded", "delivered_for_review", "needs_review"], status: "needs_review" },
};
const DELIVERED: Scenario = "ok";
// Sample thread and extraction jobs (DESIGN-HANDOFF §3): 5 posts for @example_brand at 1.20, 24 products at 0.80.
const THREAD_POSTS = [
  "Launch day at @example_brand. One page, every product, priced in USDC: example.com/launch #NEAR",
  "You pay once. An AI agent does the work, another one checks it, and the money only moves when the check passes.",
  "Missed the brief? You get one fix, then your money back. No support ticket, no waiting.",
  "Bots can order too: one HTTP call, pay with x402, get JSON back with a proof link for every payout.",
  "Try it on testnet today with free test USDC: https://example.com/launch #NEAR",
];
const PRODUCTS = ["Kettle 1 L", "Toaster S2", "Mug, set of 4", "Grinder Mini", "Blender Pro", "Scale Lite", "Press 8 cup", "Tray Oak", "Jar Glass", "Whisk Steel", "Board Bamboo", "Pan 28 cm"];
const EXTRACT_ROWS = Array.from({ length: 24 }, (_, i) => ({
  name: `Example ${PRODUCTS[i % PRODUCTS.length]}${i >= PRODUCTS.length ? " v2" : ""}`,
  price: Number((12 + ((i * 7.35) % 48)).toFixed(2)),
  date: `2026-${String(9 + (i % 2)).padStart(2, "0")}-${String(1 + ((i * 3) % 28)).padStart(2, "0")}`,
}));
const KIND: Partial<Record<Scenario, Pick<OrderPayer, "jobType" | "price" | "instructions" | "brief" | "input"> & { content: string }>> = {
  thread_job: {
    jobType: "thread",
    price: "1.20",
    instructions: "Write a 5 post X thread for @example_brand about our launch. Friendly tone. Include the launch link and #NEAR.",
    input: { source: "https://example.com/launch", pages: 1, words: 640 },
    brief: {
      jobType: "thread",
      params: { posts: 5, mustInclude: ["https://example.com/launch", "#NEAR"], tone: "friendly", topic: "launch" },
      checklist: [
        { id: "C1", kind: "code", rule: "post_count == 5" },
        { id: "C2", kind: "code", rule: "post_length <= 280" },
        { id: "C3", kind: "code", rule: "includes_all" },
        { id: "C4", kind: "code", rule: "no_extra_handles" },
        { id: "M1", kind: "model", rule: "on topic" },
        { id: "M2", kind: "model", rule: "no invented facts" },
      ],
      deliverableFormat: "application/json",
    },
    content: JSON.stringify({ posts: THREAD_POSTS }),
  },
  extract_job: {
    jobType: "extract",
    price: "0.80",
    instructions: "Get the name, price and release date of every product on this page.",
    input: { source: "https://example.com/catalogue", pages: 3, words: 2140 },
    brief: {
      jobType: "extract",
      params: { schema: { fields: [{ name: "name", type: "string", required: true }, { name: "price", type: "number", required: true }, { name: "date", type: "date", required: false }] }, many: true, maxRecords: 50 },
      checklist: [
        { id: "C1", kind: "code", rule: "json_parses" },
        { id: "C2", kind: "code", rule: "matches_schema" },
        { id: "C3", kind: "code", rule: "required_fields_filled" },
        { id: "C4", kind: "code", rule: "traceable >= 90%" },
        { id: "M1", kind: "model", rule: "no invented records" },
      ],
      deliverableFormat: "application/json",
    },
    content: JSON.stringify(EXTRACT_ROWS),
  },
};
const DETAIL: Record<string, string> = { "post_count == 5": "5 posts", "post_length <= 280": "max 118", includes_all: "both found", no_extra_handles: "none", json_parses: "valid", matches_schema: "24 of 24", required_fields_filled: "all filled", "traceable >= 90%": "100%" };

const stepsFor = (s: Scenario) => STEPS[s] ?? { events: ["paid", "awarded", "delivered_for_review", "review_pass", "worker_paid", "reviewer_paid"] as TimelineEvent["event"][], status: "delivered" as OrderStatus };

const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d+Z$/, "Z");
const STATUS_AT: Partial<Record<TimelineEvent["event"], OrderStatus>> = {
  paid: "paid",
  awarded: "awarded",
  delivered_for_review: "review",
  review_pass: "delivered",
  review_fail: "revision",
  dispute: "dispute_review",
  second_review_pass: "delivered",
  unresolved: "unresolved",
  complaint: "complaint_review",
  complaint_rejected: "delivered",
  refund_due: "refund_due",
  refunded: "refunded",
  finalized: "finalized",
  needs_review: "needs_review",
};

/** Builds the payer view of an order after `upTo` timeline steps of the scenario. */
export function orderFor(orderId: string, network: Network, scenario: Scenario, startMs: number, upTo = Infinity): OrderPayer {
  const o = structuredClone(orderPayer) as OrderPayer;
  const plan = stepsFor(scenario);
  const events = plan.events.slice(0, upTo);
  const done = events.length === plan.events.length;
  o.orderId = orderId;
  o.network = `near:${network}`;
  let round = 0;
  let status: OrderStatus = "paid";
  const reviews: Review[] = [];
  const pass = o.reviews[0];
  o.timeline = events.map((event, i) => {
    const at = iso(startMs + i * 2500);
    if (event === "delivered_for_review") round++;
    if (event === "review_pass" || event === "second_review_pass") reviews.push({ ...pass, round, mode: event === "review_pass" ? "primary" : "secondary" });
    if (event === "review_fail" || event === "second_review_fail")
      reviews.push({
        round,
        mode: "primary",
        pass: false,
        codes: ["FAIL_MISSING_ITEM"],
        reasons: "The delivery never mentions fees.",
        attestationUrl: pass.attestationUrl,
        checks: pass.checks?.map((c) => (c.id === "C2" ? { ...c, pass: false, detail: "fees missing" } : c)),
      });
    if (event === "complaint_upheld" || event === "complaint_rejected")
      reviews.push({ round, mode: "complaint", pass: event === "complaint_rejected", codes: [event === "complaint_upheld" ? "COMPLAINT_UPHELD" : "COMPLAINT_REJECTED"], reasons: event === "complaint_upheld" ? "The order asked for bullet points. The brief said paragraph." : "The brief matches the order.", attestationUrl: pass.attestationUrl });
    status = STATUS_AT[event] ?? status;
    const extra = event === "delivered_for_review" ? { worker: "crab" as const } : event === "awarded" || event === "worker_paid" ? { worker: "crab" as const, amount: "0.18" } : event === "reviewer_paid" ? { amount: "0.05" } : event === "paid" || event === "refunded" ? { amount: "0.60" } : {};
    const tx = ["paid", "awarded", "worker_paid", "reviewer_paid", "refunded", "finalized"].includes(event) ? `SAMPLEtx${i}` : null;
    return { at, event, ...extra, ...(event === "delivered_for_review" ? { round } : {}), tx };
  });
  if (done) status = plan.status;
  o.status = status;
  o.reviews = reviews;
  if (!events.includes("awarded")) o.auction = null;
  const passed = events.includes("review_pass") || events.includes("second_review_pass");
  // API §1.5: delivery stays null until a pass, and hidden for unresolved and refunded.
  if (!passed || status === "unresolved" || status === "refunded") o.delivery = null;
  o.complaint = {
    allowedUntil: passed ? iso(startMs + 86_400_000) : null,
    status: status === "complaint_review" ? "complaint_review" : events.includes("complaint_upheld") ? "upheld" : events.includes("complaint_rejected") ? "rejected" : null,
  };
  o.refund = events.includes("refunded")
    ? { to: "demo-buyer.testnet", amount: "0.60", reason: scenario === "complaint_upheld" ? "complaint_upheld" : scenario === "unresolved" ? "unresolved" : "failed_twice", tx: "SAMPLEtxRefund" }
    : null;
  if (!events.includes("worker_paid")) o.proof = { ...o.proof, workerPayoutTx: null };
  if (!events.includes("awarded")) o.proof = { ...o.proof, awardTx: null };
  o.money = status === "finalized" || status === "delivered" || status === "complaint_review" ? o.money : null;
  const kind = KIND[scenario];
  if (kind) {
    const { content, ...rest } = kind;
    Object.assign(o, rest);
    o.reviews = o.reviews.map((r) => ({ ...r, checks: kind.brief.checklist.map((c) => ({ id: c.id, pass: true, ...(c.kind === "code" ? { detail: DETAIL[c.rule] } : {}) })) }));
    if (o.delivery) o.delivery = { ...o.delivery, format: "application/json", content };
    o.timeline = o.timeline.map((e) => (e.event === "paid" || e.event === "refunded" ? { ...e, amount: o.price } : e));
    if (o.money) o.money = { ...o.money, price: o.price };
    if (o.auction) o.auction = { ...o.auction, cap: fromBase(toBase(o.price) / 2n) }; // worker cap 50%
  }
  o.sample = true;
  return o;
}

/** D-166: the public view drops what only the payer may see. */
export function toPublic(o: OrderPayer): Order {
  const rest: Partial<OrderPayer> = { ...o };
  delete rest.instructions;
  delete rest.input;
  delete rest.delivery;
  return { ...(rest as Omit<OrderPayer, "view" | "brief">), view: "public", size: { pages: o.input.pages, words: o.input.words }, brief: { jobType: o.brief.jobType, checklist: o.brief.checklist.map(({ id, kind }) => ({ id, kind })) } };
}

// Mainnet-lite sample (DESIGN-HANDOFF §3): 4 jobs, revenue 3.20, nothing else made up beyond the Figma view.
function companyFor(network: Network, scenario: Scenario): Company {
  const c = structuredClone(company) as Company;
  if (network === "mainnet") {
    c.network = "near:mainnet";
    c.reserve = { balance: "2.80", floor: "1.90", sharkWallet: "0.44", dailyBudget: "0.60", ravenPayoutGas: { balanceEth: "0.0031", payoutsLeft: 50, warnBelow: 5 } };
    c.pnl7d = { jobs: 4, revenue: "3.20", workers: "0.96", reviews: "0.20", referrals: "0.08", profit: "1.96", ownersPaid: "0.00", ownersAccrued: "1.18" };
    c.strikes = { count: 0, threshold: 3 };
    c.config = { ...c.config, dailyBudget: "0.60", reserveFloor: "1.90", changedByProposal: 1, changedAt: "2026-11-11T09:00:00Z" };
    c.workers = c.workers.map((w) => ({ ...w, account: w.account.replace(".testnet", ".near"), jobs: 2, firstPassPct: 100, finalFails: 0, disputesWon: 0, disputesLost: 0, unresolvedOpen: 0, late: 0 }));
    c.reviewer = { ...c.reviewer, account: "owl-reviewer.near", reviews: 4, overturned: 0 };
    c.recentJobs = c.recentJobs.filter((j) => j.status !== "refunded");
    c.auctions = c.auctions.filter((a) => a.outcome === "delivered");
    c.incidents = [];
    c.payouts = c.payouts.filter((p) => p.kind === "worker" || p.kind === "reviewer").map((p) => ({ ...p, to: p.to.replace(".testnet", ".near") }));
    c.owners = { dao: "sharkco.sputnik-dao.near", approvalRule: "1 of 1", openProposals: [], proposals: [{ id: 1, title: "register workers and reviewer, config", status: "passed", at: "2026-11-11T09:00:00Z", votes: "1 of 1" }], ownersWaiting: "1.18", trezuUrl: "https://trezu.example/dao/sharkco-mainnet" };
    c.guardian = { account: "guardian.sharkco.near", power: "pause only" };
  }
  if (scenario === "incident_kinds")
    c.incidents = [
      { at: "2026-11-05T07:50:00Z", orderId: null, kind: "payout_failed", text: "Raven's payout on Base failed. Shark retries it and the fee stays held.", strike: false },
      { at: "2026-11-05T07:30:00Z", orderId: null, kind: "worker_suspended", text: "Raven has 2 unresolved jobs open. It can't win auctions until they close.", strike: false },
      { at: "2026-11-05T07:10:00Z", orderId: "j_000040", kind: "strike", text: "Brief invalid. Strike 1 for Shark.", strike: true },
      ...c.incidents,
    ];
  if (scenario === "raven_gas_unset") c.reserve = { ...c.reserve, ravenPayoutGas: { balanceEth: "0", payoutsLeft: null, warnBelow: 5 } };
  if (scenario === "caged") c.strikes = { count: 3, threshold: 3 };
  if (scenario === "closed" || scenario === "paused" || scenario === "caged" || scenario === "no_worker" || scenario === "out_of_budget") c.state = scenario;
  return c;
}

// ---- A tiny in-memory "chain" so the mock wallet and the mock API agree on what was paid.
type QuoteRec = { quoteId: string; issued: number; expiresAt: number; paidAt?: number; orderId: string; payer: string; method: "quote" | "intents" };
const chain = { quotes: new Map<string, QuoteRec>(), registered: new Set<string>(), complained: new Set<string>(), usedNonces: new Set<string>(), seq: 42 };
const nextQuoteId = () => `q_01JC8Z3R9X0V4G7K2M5N8P${(chain.seq++).toString(36).toUpperCase().padStart(4, "0")}`;

/** Called by the mock wallet when it "signs" a transaction. Returns a fake tx hash. */
export function mockChainCall(signer: string, method: string, args: Record<string, unknown>): string {
  if (method === "storage_deposit") chain.registered.add(signer);
  if (method === "ft_transfer_call") {
    const q = chain.quotes.get(String(args.msg ?? "").replace(/^pay:/, ""));
    if (q && !q.paidAt) q.paidAt = Date.now();
  }
  return `SAMPLE${Math.random().toString(36).slice(2, 10)}`;
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
const err = (status: number, error: ErrorCode, message: string, headers?: Record<string, string>, details?: Record<string, unknown>) =>
  json({ error, message, charged: false, ...(details ? { details } : {}) }, status, headers);

// What Shark sends with brief_infeasible (API §0.2, C3): the reason and each fix with its new price.
const INFEASIBLE_DETAILS = {
  reason: "max_words_vs_must_mention",
  fixes: [
    { label: "Raise the limit to 300 words", params: { maxWords: 300 }, price: "0.75" },
    { label: "Keep 1 required point", params: { mustMention: ["NEAR Intents"] }, price: "0.60" },
  ],
};

const contractFor = (n: Network) => (n === "testnet" ? "sharkco.testnet" : "sharkco.near");
const usdcFor = (n: Network) => (n === "testnet" ? "3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af" : "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1");
// Sample quote per job type (DESIGN-HANDOFF §3).
const SAMPLE_PRICE = { summary: ["0.60", "600000", "6 pages, 2 required points"], thread: ["1.20", "1200000", "5 posts, 2 must include"], extract: ["0.80", "800000", "24 records, 3 fields"] } as const;

export function createMockFetch(network: Network, scenario: Scenario): typeof fetch {
  const serve = mockHandler(network, scenario);
  if (scenario !== "wrong_network") return serve;
  // A host for the other network: every `near:<network>` in the body flips.
  const other = network === "testnet" ? "mainnet" : "testnet";
  return async (input, init) => {
    const res = await serve(input, init);
    const body = (await res.text()).replaceAll(`near:${network}`, `near:${other}`);
    return new Response(body, { status: res.status, headers: res.headers });
  };
}

function mockHandler(network: Network, scenario: Scenario): typeof fetch {
  return async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "http://mock");
    const path = url.pathname.replace(/^.*?(\/v1\/)/, "/v1/");
    const method = init?.method ?? "GET";
    await new Promise((r) => setTimeout(r, 250)); // let skeletons show briefly
    if (scenario === "upstream_down") return err(502, "upstream_unavailable", "A service Shark needs is down. Nothing was charged.");
    const orderMatch = path.match(/^\/v1\/orders\/(j_\d+)(\/view|\/complaint)?$/);
    if (orderMatch && scenario === "job_loading") return new Promise<Response>(() => {});
    if (orderMatch && scenario === "job_unreachable") return err(502, "upstream_unavailable", "Can't reach Shark.");

    if (method === "POST" && path === "/v1/uploads") {
      if (scenario === "too_large" || scenario === "unreadable") return err(...(ERRORS[scenario]!.slice(0, 3) as [number, ErrorCode, string]));
      return json(upload);
    }

    if (method === "POST" && path === "/v1/orders") {
      const body = JSON.parse(String(init?.body ?? "{}")) as { jobType: keyof typeof SAMPLE_PRICE; payer: string; payWith?: { asset: string }; refundTo?: string; referrer?: string };
      if (scenario === "quoting") await new Promise((r) => setTimeout(r, 6000));
      const e = ERRORS[scenario];
      if (e) return err(e[0], e[1], e[2], e[3], e[1] === "brief_infeasible" ? INFEASIBLE_DETAILS : undefined);
      if (body.payWith && network === "testnet") return err(422, "intents_unavailable", "Paying from another chain is mainnet only.");
      const now = Date.now();
      const quoteId = nextQuoteId();
      const orderId = `j_${String(chain.seq).padStart(6, "0")}`;
      chain.quotes.set(quoteId, { quoteId, issued: now, expiresAt: now + 600_000, orderId, payer: body.payer, method: body.payWith ? "intents" : "quote" });
      const q = structuredClone(quote402) as Quote402;
      const [price, base, reason] = SAMPLE_PRICE[body.jobType] ?? SAMPLE_PRICE.summary;
      const p = (prices as Prices).types[body.jobType] ?? q;
      const registered = scenario !== "unregistered" || chain.registered.has(body.payer);
      Object.assign(q, {
        quoteId,
        jobType: body.jobType,
        price,
        priceReason: reason,
        band: p.band,
        floor: p.floor,
        expiresAt: iso(now + 600_000),
        brief: { ...q.brief, jobType: body.jobType },
        quote: { ...q.quote, quote_id: quoteId, network: `near:${network}`, job_type: body.jobType, price: base, payer: body.payer, referrer: body.referrer ?? null, expires_at: Math.floor((now + 600_000) / 1000) },
        pay: { ...q.pay, network: `near:${network}`, token: usdcFor(network), args: { receiver_id: contractFor(network), amount: base, msg: `pay:${quoteId}` } },
        payerRegistered: registered,
        register: registered ? null : { contract: usdcFor(network), method: "storage_deposit", args: { account_id: body.payer, registration_only: true }, gas: "30000000000000", deposit: "1250000000000000000000" },
        intents: body.payWith ? { asset: body.payWith.asset, chain: "base", amountIn: "0.604120", depositAddress: "0x9c4e00000000000000000000000000000000a841", refundTo: body.refundTo ?? "", deadline: iso(now + 600_000) } : null,
      });
      return json(q, 402, { "WWW-Authenticate": `SharkQuote quote_id="${quoteId}"` });
    }

    const quoteMatch = path.match(/^\/v1\/quotes\/([^/]+)$/);
    if (method === "GET" && quoteMatch) {
      const q = chain.quotes.get(decodeURIComponent(quoteMatch[1]));
      if (!q) return err(400, "invalid_request", "Unknown quote.");
      if (q.method === "intents" && !q.paidAt && Date.now() - q.issued > 8000) q.paidAt = Date.now(); // the deposit "lands"
      const status = q.paidAt ? (scenario === "returned" ? "RETURNED" : "PAID") : Date.now() > q.expiresAt ? "EXPIRED" : "AWAITING_PAYMENT";
      return json({ quoteId: q.quoteId, method: q.method, status, orderId: status === "PAID" ? q.orderId : null, paymentTx: q.paidAt ? "SAMPLEtxPay" : null, oneClickStatus: q.method === "intents" ? (q.paidAt ? "SUCCESS" : "PENDING_DEPOSIT") : null });
    }

    if (orderMatch) {
      const [, id, sub] = orderMatch;
      const q = [...chain.quotes.values()].find((x) => x.orderId === id && x.paidAt);
      if (chain.complained.has(id)) scenario = "complaint_review";
      // A fresh order walks its steps live; any other id shows the scenario's end state.
      const o = q ? orderFor(id, network, scenario === DELIVERED ? "ok" : scenario, q.paidAt!, 1 + Math.floor((Date.now() - q.paidAt!) / 2500)) : orderFor(id, network, scenario, Date.now() - 3_600_000); // an hour ago, so the 24 h complaint window is open on any day
      if (method === "GET" && !sub) return json(toPublic(o));
      if (method === "POST" && sub === "/view") {
        const auth = JSON.parse(String(init?.body ?? "{}")) as { message?: string; accountId?: string; nonce?: string };
        if (!auth.message?.startsWith(`sharkco:view:${id}:`)) return err(401, "payer_signature_invalid", "The signature doesn't match this job.");
        // Shark accepts each NEP-413 nonce once (API-CONTRACT §1.5a), so the mock does too
        if (chain.usedNonces.has(auth.nonce ?? "")) return err(401, "payer_signature_invalid", "The signature didn't check out (signature already used). Sign in again.");
        chain.usedNonces.add(auth.nonce ?? "");
        (globalThis as { __mockViewCalls?: number }).__mockViewCalls = ((globalThis as { __mockViewCalls?: number }).__mockViewCalls ?? 0) + 1; // read by e2e/job.spec.ts
        return json(o, 200, { "Cache-Control": "private, no-store" });
      }
      if (method === "POST" && sub === "/complaint") {
        if (!o.complaint.allowedUntil || o.complaint.status) return err(409, "complaint_closed", "The complaint window is closed for this job.");
        const nonce = (JSON.parse(String(init?.body ?? "{}")) as { auth?: { nonce?: string } }).auth?.nonce ?? "";
        if (chain.usedNonces.has(nonce)) return err(401, "payer_signature_invalid", "The signature didn't check out (signature already used). Sign in again.");
        chain.usedNonces.add(nonce);
        chain.complained.add(id);
        return json({ status: "complaint_review" }, 202);
      }
    }

    switch (`${method} ${path}`) {
      case "GET /v1/prices":
        return json(prices);
      case "GET /v1/company":
        return json(companyFor(network, scenario));
      case "GET /v1/health":
        return json({ ...health, network: `near:${network}`, contract: contractFor(network), state: companyFor(network, scenario).state });
      case "GET /v1/payment-options":
        return json(
          network === "testnet"
            ? paymentOptions
            : {
                network: "near:mainnet",
                options: [
                  { method: "quote", token: usdcFor("mainnet"), label: "USDC" },
                  { method: "x402", scheme: "exact", network: "near:mainnet", asset: usdcFor("mainnet"), facilitator: "https://x402.mikedotexe.com" },
                  { method: "intents", asset: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near", chain: "base", minAmountIn: "0.50", dryQuoteOk: true },
                ],
              },
        );
      default:
        return err(400, "invalid_request", `No mock for ${method} ${path}`);
    }
  };
}
