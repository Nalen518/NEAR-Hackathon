// Shark's job loop (ARCHITECTURE §7): auction paid jobs, award and escrow, send revisions, expire late work,
// finalize after the complaint window and pay refunds. Every step reads the job from the contract first and
// only moves it forward, so a crash or a failed tx is retried on the next tick and nothing is paid twice.
import { fromBase, toBase, type JobType } from "@shark/shared";
import { baseDecode, PublicKey } from "near-api-js";
import type { Chain, ContractJob, ContractWorker } from "./chain";
import type { Config } from "./config";
import { syncReceipts, type ReceiptSource } from "./events";
import { canonicalJson, sha256, sha256Ref } from "./quote";
import type { AuctionRow, BidRow, Store } from "./store";

export type LoopDeps = { config: Config; chain: Chain; store: Store; now: () => number; fetchImpl?: typeof fetch; receipts?: ReceiptSource; log?: (o: Record<string, unknown>) => void };

const RFQ_TIMEOUT_MS = 20_000; // FR-31
const LATE_GRACE_SECS = 60;
const ESCROW_RETRY_SECS = 120;
const OPEN = new Set<ContractJob["state"]>(["paid", "awarded", "review", "revision", "failed", "dispute_review", "unresolved", "delivered", "complaint_review", "refund_due"]);

type Bid = { workerId: string; jobId: string; price: string; etaSecs: number; expiry: string; pubKey: string; sig: string };

/** `ed25519(sha256("sharkco:bid:v2|" + workerId + "|" + jobId + "|" + price_base + "|" + etaSecs + "|" + expiry_unix))` (API §2.1). */
export const bidDigest = (b: Pick<Bid, "workerId" | "jobId" | "etaSecs">, priceBase: bigint, expiryUnix: number) =>
  sha256(`sharkco:bid:v2|${b.workerId}|${b.jobId}|${priceBase}|${b.etaSecs}|${expiryUnix}`);

const name = (id: string, config: Config) => (id === config.agents.crab ? "Crab" : id === config.agents.raven ? "Raven" : id);
const orderId = (id: number) => `j_${String(id).padStart(6, "0")}`;

const DAY = 86_400;
const DAILY_AT_SECS = 5 * 60; // 00:05 UTC (ARCHITECTURE §7)
const OWED_RETRY_SECS = 3_600;
/** The contract refused the call (a panic or one of its E_ codes), as opposed to the network failing. */
const CONTRACT_SAID_NO = /panicked|E_[A-Z_]+/;
const RECEIPTS_EVERY_SECS = 60; // a keyless indexer allows a handful of requests a minute

export async function tick(d: LoopDeps): Promise<void> {
  const log = d.log ?? ((o) => console.log(JSON.stringify(o)));
  if (d.receipts && d.now() - Number(d.store.kv("receipts_at") ?? 0) >= RECEIPTS_EVERY_SECS) {
    d.store.setKv("receipts_at", String(d.now()));
    await syncReceipts(d.receipts, d.store).catch((e) => log({ level: "error", reader: "receipts", error: String(e).slice(0, 160) })); // the API works without it
  }
  await keepers(d, log);
  const stats = await d.chain.stats();
  const jobs: ContractJob[] = [];
  for (let from = 1; from <= stats.jobs; from += 100) jobs.push(...(await d.chain.jobs(from, 100)));
  for (const job of jobs.filter((j) => OPEN.has(j.state))) {
    try {
      await step(d, job);
    } catch (e) {
      log({ level: "error", jobId: orderId(job.id), state: job.state, error: String(e) });
    }
  }
}

/** Once a day at 00:05 UTC fund Shark's budget and pay the owners, and once an hour retry failed payouts. The contract
 * decides: both daily calls revert when the reserve is at its floor or there is nothing to pay, which is normal. */
async function keepers(d: LoopDeps, log: (o: Record<string, unknown>) => void) {
  const now = d.now();
  const day = Math.floor(now / DAY);
  if (now % DAY >= DAILY_AT_SECS && d.store.kv("daily") !== String(day)) {
    let netError = false;
    for (const [keeper, run] of [["fund_shark", d.chain.fundShark], ["pay_owners", d.chain.payOwners]] as const)
      await run().catch((e) => {
        netError ||= !CONTRACT_SAID_NO.test(String(e)); // a timeout or an RPC error is tried again next tick
        log({ level: "info", keeper, skipped: String(e).slice(0, 120) });
      });
    if (!netError) d.store.setKv("daily", String(day));
  }
  if (now - Number(d.store.kv("owed_at") ?? 0) >= OWED_RETRY_SECS) {
    d.store.setKv("owed_at", String(now));
    for (const o of await d.chain.owed(1, 100)) await d.chain.retryOwed(o.id).catch((e) => log({ level: "error", owedId: o.id, error: String(e) }));
  }
}

async function step(d: LoopDeps, job: ContractJob) {
  const { chain, store, now } = d;
  const row = store.auction(job.id);
  const late = job.work_deadline > 0 && now() > job.work_deadline + LATE_GRACE_SECS;
  switch (job.state) {
    case "paid": {
      if (!row || (job.reauctioned && !row.reauction)) return runAuction(d, job);
      // The row is saved before the award (or the refund) goes out, so a call that failed is asked again here.
      // The contract refuses a repeat once the job has moved on, which the tick logs and ignores.
      if (!row.winner) return void (await chain.markRefundDue(job.id)); // no valid bid
      const cfg = await chain.config();
      if (now() >= job.paid_at + cfg.job_timeout_secs) return void (await chain.markRefundDue(job.id)); // never awarded: give the money back
      if (!row.award_tx) await sendAward(d, job, row, row.winner);
      return; // award sent but not seen on chain yet
    }
    case "awarded":
      if (late) return void (await chain.expireWork(job.id));
      // Sent but still not escrowed on chain after a while: the contract gave the USDC back (an empty wallet, say), so send it
      // again. A second escrow of a job that is escrowed is refused by the contract and the token returns it.
      if (row && !job.escrowed && (!row.escrow_tx || now() > (row.escrow_at ?? row.at) + ESCROW_RETRY_SECS)) {
        const reviewFee = BigInt(job.review_fee);
        row.escrow_tx = await chain.escrow(job.id, (BigInt(job.worker_fee) + reviewFee).toString());
        row.escrow_at = now();
        store.putAuction(row);
      }
      if (row && job.escrowed && row.round_sent < 1) await notify(d, job, row, 1);
      return;
    case "revision":
      if (late) return void (await chain.expireWork(job.id));
      if (row && row.round_sent < 2) await notify(d, job, row, 2);
      return;
    case "delivered":
      if (job.complaint_until !== null && now() > job.complaint_until) await chain.finalize(job.id);
      return;
    case "refund_due":
      await chain.payRefund(job.id);
      return;
    case "failed":
      // the worker may dispute until dispute_until (FR-44); after that nobody can, so settle
      if (row && row.round_sent < 3) await notifyDispute(d, job, row);
      if (job.dispute_until !== null && now() > job.dispute_until) await chain.settleFailed(job.id);
      return;
    case "dispute_review": {
      // Owl hasn't answered by the review deadline: refund now, hold the fee (FR-46)
      const cfg = await chain.config();
      if (job.review_requested_at !== null && now() > job.review_requested_at + cfg.review_deadline_secs) await chain.markUnresolved(job.id);
      return;
    }
    case "unresolved": {
      const cfg = await chain.config();
      if (job.unresolved_since !== null && now() >= job.unresolved_since + cfg.unresolved_timeout_secs) await chain.releaseUnresolved(job.id);
      return;
    }
    default:
      return; // review and complaint_review wait for Owl
  }
}

async function runAuction(d: LoopDeps, job: ContractJob) {
  const { config, chain, store, now } = d;
  const fetchImpl = d.fetchImpl ?? fetch;
  const [workers, cfg] = await Promise.all([chain.workers(), chain.config()]);
  const cap = (BigInt(job.price) * BigInt(cfg.worker_cap_bps)) / 10_000n;
  const quote = store.quote(job.quote_id);
  const size = quote ? (JSON.parse(quote.input) as { pages: number; words: number }) : { pages: 0, words: 0 };
  const eligible = workers.filter((w) => !w.suspended && w.types.includes(job.job_type) && w.id !== job.excluded && config.workerUrls[w.id]);
  const rfq = {
    jobId: orderId(job.id),
    jobType: job.job_type,
    size: { pages: size.pages, words: size.words },
    briefUrl: `/v1/files/${job.brief_hash}`,
    briefHash: job.brief_hash,
    inputHash: job.input_hash,
    cap: fromBase(cap),
    deadline: new Date((now() + cfg.work_deadline_secs) * 1000).toISOString().replace(/\.\d{3}Z$/, "Z"),
  };

  const answers = await Promise.all(
    eligible.map(async (w): Promise<{ w: ContractWorker; bid: Bid | null; state: BidRow["state"] }> => {
      try {
        const res = await fetchImpl(`${config.workerUrls[w.id]}/rfq`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(rfq), signal: AbortSignal.timeout(RFQ_TIMEOUT_MS) });
        if (res.status === 204) return { w, bid: null, state: "busy" };
        const bid = (await res.json()) as Bid;
        return { w, bid, state: (await validBid(d, bid, w, job.job_type, rfq.jobId, cap)) ? "lost" : "invalid" };
      } catch {
        return { w, bid: null, state: "late" };
      }
    }),
  );

  const valid = answers.filter((a) => a.state === "lost" && a.bid) as { w: ContractWorker; bid: Bid; state: BidRow["state"] }[];
  const rate = (w: ContractWorker) => (w.jobs ? w.first_pass / w.jobs : 0.9);
  // price weighted by the first pass rate (a worker that fails costs a revision), then the faster one (FR-32)
  const score = (a: (typeof valid)[number]) => Number(toBase(a.bid.price)) / Math.max(rate(a.w), 0.5);
  valid.sort((a, b) => score(a) - score(b) || a.bid.etaSecs - b.bid.etaSecs);
  const win = valid[0];
  if (win) win.state = "winner";

  const bids: BidRow[] = answers.map((a) => ({ account: a.w.id, price: a.bid?.price ?? "0", etaSecs: a.bid?.etaSecs ?? 0, state: a.state }));
  const reason = win
    ? `${name(win.w.id, config)} wins at ${win.bid.price} with ${win.w.jobs ? `a ${Math.round(100 * rate(win.w))}% first pass rate` : "no record yet"}, done in about ${win.bid.etaSecs} s.`
    : "No worker sent a valid bid, so the job is refunded.";
  const reasonHash = sha256Ref(reason);
  store.putBlob(reasonHash, reason);
  const row: AuctionRow = {
    job_id: job.id,
    cap: cap.toString(),
    bids,
    winner: win?.w.id ?? null,
    reason,
    reason_hash: reasonHash,
    bid_hash: win ? sha256Ref(canonicalJson(win.bid)) : null,
    award_tx: null,
    escrow_tx: null,
    round_sent: 0,
    at: now(),
    reauction: job.reauctioned,
  };
  store.putAuction(row);
  if (!win) {
    await chain.markRefundDue(job.id);
    return;
  }
  await sendAward(d, job, row, win.w.id);
}

async function sendAward(d: LoopDeps, job: ContractJob, row: AuctionRow, winner: string) {
  const bid = row.bids.find((b) => b.account === winner)!;
  row.award_tx = await d.chain.award(job.id, winner, toBase(bid.price).toString(), row.bid_hash!, row.reason_hash);
  d.store.putAuction(row);
}

async function validBid(d: LoopDeps, b: Bid, w: ContractWorker, type: JobType, jobId: string, cap: bigint): Promise<boolean> {
  try {
    if (b.workerId !== w.id || b.jobId !== jobId || !Number.isInteger(b.etaSecs) || b.etaSecs <= 0) return false;
    const price = toBase(b.price);
    const minFee = BigInt(w.min_fees[w.types.indexOf(type)]);
    const expiry = Math.floor(Date.parse(b.expiry) / 1000);
    if (price < minFee || price > cap || !(expiry > d.now())) return false;
    const sig = baseDecode(b.sig.replace(/^ed25519:/, ""));
    if (!PublicKey.from(b.pubKey).verify(bidDigest(b, price, expiry), sig)) return false;
    return await d.chain.isAccessKey(w.id, b.pubKey);
  } catch {
    return false;
  }
}

/** POST /award to the winner (API §2.2). Round 2 carries the failed review's codes. */
async function notify(d: LoopDeps, job: ContractJob, row: AuctionRow, round: 1 | 2) {
  const url = d.config.workerUrls[job.worker ?? ""];
  if (!url) return;
  const body = { jobId: orderId(job.id), price: fromBase(BigInt(job.worker_fee)), awardTx: row.award_tx, round, ...(round === 2 ? { codes: job.codes } : {}) };
  const res = await (d.fetchImpl ?? fetch)(`${url}/award`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(RFQ_TIMEOUT_MS) });
  if (res.ok) {
    row.round_sent = round;
    d.store.putAuction(row);
  }
}

/** POST /dispute-window to the worker (API §2.3): the codes and reasons of the final fail, and until when it may dispute. */
async function notifyDispute(d: LoopDeps, job: ContractJob, row: AuctionRow) {
  const url = d.config.workerUrls[job.worker ?? ""];
  if (!url || job.dispute_until === null) return;
  const reasons = (job.reasons_hash && d.store.blob(job.reasons_hash)) || "";
  const body = { jobId: orderId(job.id), codes: job.codes, reasons, until: new Date(job.dispute_until * 1000).toISOString().replace(/\.\d{3}Z$/, "Z") };
  const res = await (d.fetchImpl ?? fetch)(`${url}/dispute-window`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(RFQ_TIMEOUT_MS) });
  if (res.ok) {
    row.round_sent = 3;
    d.store.putAuction(row);
  }
}
