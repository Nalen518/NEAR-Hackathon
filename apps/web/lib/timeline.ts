// "What happened" rows (Order step 04, Job step 05): one line per timeline[] event, with its proof link.
// Copy from Figma 150:3999. Shared with the Job page.
import type { Network, Order } from "@shark/shared";
import { NETWORKS } from "./network";

const NAME = { crab: "Crab", raven: "Raven" } as const;
const short = (h: string) => (h.length > 10 ? `${h.replace(/^sha256:/, "").slice(0, 3)}…${h.slice(-2)}` : h);

export type Row = { at: string; text: string; link?: { label: string; href?: string } };

export function timelineRows(o: Pick<Order, "timeline" | "reviews" | "proof" | "auction" | "sample" | "refund" | "jobType"> & { deliveryHash?: string }, network: Network): Row[] {
  const usd = network === "testnet" ? "test USDC" : "USDC";
  const tx = (h: string | null | undefined, label = `tx ${h ? short(h) : ""}`) => (h ? { label, href: o.sample ? undefined : `${NETWORKS[network].nearTx}${h}` } : undefined);
  const lastPass = o.reviews.filter((r) => r.pass).at(-1);
  const rows: Row[] = [];
  for (let i = 0; i < o.timeline.length; i++) {
    const e = o.timeline[i];
    const w = e.worker ? NAME[e.worker] : "The worker";
    const at = e.at.slice(11, 19);
    switch (e.event) {
      case "paid":
        rows.push({ at, text: `Paid ${e.amount ?? ""} ${usd} on NEAR`, link: tx(e.tx) });
        break;
      case "awarded":
        rows.push({ at, text: `${w} won the auction at ${e.amount ?? o.auction?.bids.find((b) => b.state === "winner")?.price ?? ""}`, link: e.tx ? { label: "reason on chain", href: tx(e.tx)?.href } : undefined });
        break;
      case "delivered_for_review":
        rows.push({ at, text: e.round && e.round > 1 ? `${w} delivered the revision` : `${w} delivered for review`, link: o.deliveryHash ? { label: `delivery hash ${short(o.deliveryHash)}` } : undefined });
        break;
      case "review_pass":
      case "second_review_pass": {
        const n = lastPass?.checks?.length;
        rows.push({ at, text: `Owl passed it in a TEE${n ? `: ${n} of ${n} checks` : ""}${e.event === "second_review_pass" ? " (second model)" : ""}`, link: lastPass?.attestationUrl ? { label: "attestation ↗", href: o.sample ? undefined : lastPass.attestationUrl } : undefined });
        break;
      }
      case "review_fail":
      case "second_review_fail":
        rows.push({ at, text: e.event === "review_fail" ? "Owl failed it: one revision" : "The second model failed it too" });
        break;
      case "revision_requested":
        rows.push({ at, text: "Revision requested. Nobody is paid yet" });
        break;
      case "dispute":
        rows.push({ at, text: "The worker disputed the fail. A different model reviews it" });
        break;
      case "unresolved":
        rows.push({ at, text: "Second review timed out: refunded now, fee held" });
        break;
      case "worker_paid": {
        const owl = o.timeline.slice(i + 1).find((x) => x.event === "reviewer_paid");
        rows.push({ at, text: `Paid ${w} ${e.amount ?? ""}${owl ? ` and Owl ${owl.amount ?? ""}` : ""}`, link: tx(e.tx) });
        break;
      }
      case "reviewer_paid":
        break; // shown with the worker payout
      case "complaint":
        rows.push({ at, text: "You complained. A second review compares the order and the brief" });
        break;
      case "complaint_upheld":
        rows.push({ at, text: "Complaint upheld. Shark got a strike" });
        break;
      case "complaint_rejected":
        rows.push({ at, text: "Complaint not upheld. The delivery stands" });
        break;
      case "refund_due":
        rows.push({ at, text: "Refund due" });
        break;
      case "refunded":
        rows.push({ at, text: `Refunded ${e.amount ?? o.refund?.amount ?? ""} ${usd} to ${o.refund?.to ?? "your NEAR account"}`, link: tx(e.tx ?? o.refund?.tx) });
        break;
      case "finalized":
        rows.push({ at, text: "Finalized. Referrer, owners and reserve paid", link: tx(e.tx) });
        break;
      case "needs_review":
        rows.push({ at, text: "A payment step is being checked by hand. Your money is safe" });
        break;
      case "quoted":
        rows.push({ at, text: "Shark wrote the brief and the price" });
        break;
    }
  }
  return rows;
}
