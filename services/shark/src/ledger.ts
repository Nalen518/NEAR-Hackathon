// What the contract paid out, derived from the calls that trigger the payouts (events.ts has no logs to read).
// Amounts come from the job's own numbers, which the contract fixed at award, so they match what it sent.
import type { ContractJob } from "./chain";
import type { StoredReceipt } from "./events";

export type PayoutKind = "worker" | "reviewer" | "referral" | "refund";
export type DerivedPayout = { kind: PayoutKind; to: string; amount: bigint };

type Result = { mode?: string; pass?: boolean; codes?: string[] };
const resultOf = (r: StoredReceipt) => (r.args.result ?? {}) as Result;

/** Receipts of a job's reviews, in order, to tell a first fail (nobody paid) from the second (Owl paid). */
export const reviewsBefore = (all: StoredReceipt[], r: StoredReceipt) =>
  all.filter((x) => x.method === "on_review" && x.ok && x.at <= r.at && x.receipt_id !== r.receipt_id && resultOf(x).mode === "primary").length;

/** The payouts one successful call made, in the order the contract sends them. `priorPrimary` = earlier primary reviews of this job. */
export function payoutsOf(job: ContractJob, r: StoredReceipt, priorPrimary: number): DerivedPayout[] {
  if (!r.ok) return [];
  const worker = job.worker;
  const fee = BigInt(job.worker_fee);
  const review = BigInt(job.review_fee);
  const out: DerivedPayout[] = [];
  switch (r.method) {
    case "on_review": {
      const res = resultOf(r);
      if (res.mode === "primary") {
        const done = res.pass === true || (res.codes ?? []).includes("BRIEF_INVALID");
        if (done && worker) out.push({ kind: "worker", to: worker, amount: fee }, { kind: "reviewer", to: r.predecessor, amount: review });
        else if (res.pass === false && priorPrimary >= 1) out.push({ kind: "reviewer", to: r.predecessor, amount: review }); // second fail: Owl is paid, the worker is not
      } else if (res.mode === "secondary") {
        if (res.pass === true && worker) out.push({ kind: "worker", to: worker, amount: fee });
        out.push({ kind: "reviewer", to: r.predecessor, amount: review }); // paid from the reserve
      }
      break;
    }
    case "release_unresolved":
      if (worker) out.push({ kind: "worker", to: worker, amount: fee });
      break;
    case "pay_refund":
      out.push({ kind: "refund", to: job.payer, amount: BigInt(job.price) });
      break;
    case "finalize": {
      const ref = job.referrer;
      if (ref && ref !== job.payer && ref !== worker) out.push({ kind: "referral", to: ref, amount: (BigInt(job.price) * BigInt(job.referral_bps)) / 10_000n });
      break;
    }
  }
  return out.filter((p) => p.amount > 0n);
}
