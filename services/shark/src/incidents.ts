// The incidents log of GET /v1/company (C2): what went wrong for the company, newest first.
// Times and transactions come from the receipts the event reader stored; job state backfills what the indexer hasn't
// shown (yet). Text is UI copy: no semicolons, dashes or hyphenated words (D-170).
import { fromBase, type Incident } from "@shark/shared";
import type { ContractJob, ContractOwed, ContractWorker } from "./chain";
import type { StoredReceipt } from "./events";

export type IncidentInput = {
  now: number;
  /** Shark's strikes before it is caged (the contract's strike_threshold) */
  threshold: number;
  jobs: ContractJob[];
  workers: ContractWorker[];
  /** Ok receipts of on_review, reset_strikes, expire_work, mark_unresolved and suspend, oldest first */
  receipts: StoredReceipt[];
  /** Failed payouts waiting for a retry, and when Shark first saw each */
  owed: { entry: ContractOwed; seenAt: number }[];
  /** When Shark first saw a job waiting for its refund */
  refundSeen: Map<number, number>;
  nameOf: (account: string) => string;
};

/** A refund that has waited this long is not "about to go through" any more. */
export const STUCK_REFUND_SECS = 600;

const iso = (secs: number) => new Date(secs * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
const orderId = (n: number | null) => (n ? `j_${String(n).padStart(6, "0")}` : null);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const KIND_COPY: Record<string, string> = { worker: "worker", reviewer: "reviewer", referral: "referral", owner: "owners", x402_return: "x402 return", shark_budget: "budget" };

export function incidentsOf(i: IncidentInput): Incident[] {
  const out: Incident[] = [];
  const have = new Set<string>();
  const add = (x: Incident) => {
    out.push(x);
    have.add(`${x.orderId}:${x.kind}`);
  };
  const byId = new Map(i.jobs.map((j) => [j.id, j]));
  const lates = new Map<number, number>();
  let strikes = 0;

  for (const r of i.receipts) {
    const at = iso(r.at);
    const job = r.job ? byId.get(r.job) : undefined;
    const oid = orderId(r.job);
    if (r.method === "reset_strikes") strikes = 0;
    else if (r.method === "mark_unresolved") add({ at, orderId: oid, kind: "dispute", text: "A dispute got no second review in time. The customer was refunded and the worker fee is held.", strike: false });
    else if (r.method === "expire_work" && job) {
      const nth = lates.get(job.id) ?? 0;
      lates.set(job.id, nth + 1);
      const late = nth === 0 ? (job.excluded ?? job.worker) : job.worker;
      const text = `${late ? cap(i.nameOf(late)) : "The worker"} missed its deadline. ${nth === 0 && job.reauctioned ? "The job went back to auction." : "The customer was refunded."}`;
      add({ at, orderId: oid, kind: "late", text, strike: false });
    } else if (r.method === "on_review") {
      const res = (r.args.result ?? {}) as { mode?: string; pass?: boolean; codes?: string[] };
      const codes = res.codes ?? [];
      const upheld = codes.includes("COMPLAINT_UPHELD");
      const invalid = res.mode === "primary" && codes.includes("BRIEF_INVALID");
      if (upheld) add({ at, orderId: oid, kind: "complaint_upheld", text: "Complaint upheld: the brief did not match the order. Refunded.", strike: true });
      else if (codes.includes("COMPLAINT_REJECTED")) add({ at, orderId: oid, kind: "complaint_rejected", text: "Complaint rejected: the brief matched the order.", strike: false });
      else if (invalid) add({ at, orderId: oid, kind: "brief_invalid", text: "The brief could not be met. Refunded.", strike: true });
      else if (res.mode === "secondary" && res.pass) add({ at, orderId: oid, kind: "dispute_won", text: "Dispute won, the second review overturned the fail. The worker was paid.", strike: false });
      else if (res.mode === "secondary") add({ at, orderId: oid, kind: "dispute", text: "Dispute lost, the second review confirmed the fail. The customer was refunded.", strike: false });
      if (upheld || invalid) {
        strikes += 1;
        if (strikes === i.threshold) add({ at, orderId: null, kind: "strike", text: `Shark is caged after ${i.threshold} strikes. It takes no new orders until the owners reset them.`, strike: true });
      }
    }
  }

  // What the chain shows now but the receipts didn't (indexer off or behind): the same incidents from job state.
  for (const j of i.jobs) {
    const oid = orderId(j.id);
    const at = iso(j.reviewed_at ?? j.paid_at);
    const backfill = (x: Omit<Incident, "orderId">) => !have.has(`${oid}:${x.kind}`) && add({ ...x, orderId: oid });
    if (j.held || j.state === "unresolved") backfill({ at: iso(j.unresolved_since ?? j.paid_at), kind: "dispute", text: "A dispute got no second review in time. The customer was refunded and the worker fee is held.", strike: false });
    else if (j.review_requested_at && ["delivered", "complaint_review", "finalized"].includes(j.state)) backfill({ at, kind: "dispute_won", text: "Dispute won, the second review overturned the fail. The worker was paid.", strike: false });
    else if (j.review_requested_at && ["refund_due", "refunded"].includes(j.state)) backfill({ at, kind: "dispute", text: "Dispute lost, the second review confirmed the fail. The customer was refunded.", strike: false });
    if (j.codes.includes("COMPLAINT_UPHELD")) backfill({ at, kind: "complaint_upheld", text: "Complaint upheld: the brief did not match the order. Refunded.", strike: true });
    else if (j.codes.includes("COMPLAINT_REJECTED")) backfill({ at, kind: "complaint_rejected", text: "Complaint rejected: the brief matched the order.", strike: false });
    else if (j.codes.includes("BRIEF_INVALID")) backfill({ at, kind: "brief_invalid", text: "The brief could not be met. Refunded.", strike: true });
    // a refund that Shark has been trying to send for a while
    const seen = i.refundSeen.get(j.id);
    if (j.state === "refund_due" && seen !== undefined && i.now - seen > STUCK_REFUND_SECS) backfill({ at: iso(seen), kind: "payout_failed", text: "The refund has not gone through yet. Shark keeps trying.", strike: false });
  }

  // A suspended worker: when the owners did it, else when its last fail happened
  for (const w of i.workers.filter((x) => x.suspended)) {
    const own = i.receipts.filter((r) => r.method === "suspend" && r.args.id === w.id).at(-1);
    const fail = i.receipts.filter((r) => ["settle_failed", "on_review"].includes(r.method) && r.job && byId.get(r.job)?.worker === w.id).at(-1);
    add({ at: iso((own ?? fail)?.at ?? i.now), orderId: null, kind: "worker_suspended", text: `${cap(i.nameOf(w.id))} was suspended after too many fails. Only the owners can bring it back.`, strike: false });
  }

  // Payouts that failed and wait for a retry
  for (const { entry, seenAt } of i.owed) {
    add({ at: iso(seenAt), orderId: orderId(entry.job), kind: "payout_failed", text: `A ${KIND_COPY[entry.kind] ?? entry.kind} payout of ${fromBase(BigInt(entry.amount))} to ${i.nameOf(entry.to)} failed. Shark retries it every hour.`, strike: false });
  }

  return out.reverse().sort((a, b) => b.at.localeCompare(a.at)).slice(0, 20);
}
