"use client";
import { Company } from "@shark/shared";
import sampleCompany from "@shark/shared/fixtures/company.json";
import { useState } from "react";
import { isSample, useCompany } from "@/lib/api";
import { useNetwork } from "@/lib/network";
import { AuctionCard, ReviewerCard, WorkerCard } from "../ui/agency";
import { cx, LiveUnavailable, Mascot, ProofPill, Section, SectionHead, Skeleton, type MascotName } from "../ui/primitives";

const fallback = Company.parse(sampleCompany);

type Step = { name: MascotName; state: string; label: string };
// Dispute copy is Figma 149:4186. Unresolved is the hidden Figma frame 149:4205. Refund is drafted from SRD FR-44 (gap G19).
const EXAMPLES: { id: string; head: string; flow: Step[]; text: string; refund?: boolean }[] = [
  {
    id: "Dispute",
    head: "// dispute · job j_000044",
    flow: [
      { name: "raven", state: "lost", label: "raven disputes" },
      { name: "owl", state: "second-opinion", label: "second model" },
      { name: "owl", state: "pass", label: "overturned" },
      { name: "raven", state: "paid", label: "raven paid" },
    ],
    text: "Raven disputed Owl's M1 fail. A different model reread the source and found every claim supported, so Raven is paid and the customer keeps the delivery. Had it agreed with Owl, the customer would be refunded.",
  },
  {
    id: "Unresolved",
    head: "// unresolved · job j_000045",
    flow: [
      { name: "raven", state: "lost", label: "Raven disputes" },
      { name: "raven", state: "unpaid", label: "fee held" },
    ],
    text: "The second review didn't finish in time → customer refunded now, Raven's fee held for up to 7 days. The delivery is withheld until a review decides.",
    refund: true,
  },
  {
    id: "Refund",
    head: "// refund · job j_000040",
    flow: [
      { name: "owl", state: "fail", label: "first fail" },
      { name: "crab", state: "revising", label: "one revision" },
      { name: "owl", state: "fail", label: "second fail" },
      { name: "crab", state: "unpaid", label: "crab unpaid" },
    ],
    text: "Crab's delivery failed the check twice and Crab didn't dispute. The customer gets the full price back, Crab is unpaid and its record shows one more final fail.",
    refund: true,
  },
];

export function Auction() {
  const { network } = useNetwork();
  const { data, isPending, isError } = useCompany();
  const c = data ?? fallback;
  const latest = c.auctions.find((a) => a.outcome === "delivered") ?? fallback.auctions[2];
  const [tab, setTab] = useState(0);
  const ex = EXAMPLES[tab];
  return (
    <Section className="pt-[72px] pb-6">
      <SectionHead eyebrow="// the auction · sample data" title="Every job hires a worker." lede="Crab and Raven bid. Shark picks. The fee waits in escrow until Owl passes the work." />
      <LiveUnavailable show={isError} />
      <div className="grid grid-cols-[688px_1fr] items-start gap-7 pt-7 max-[1360px]:grid-cols-1">
        <AuctionCard orderId={latest.orderId} price={latest.price} auction={latest} workers={c.workers} network={network} sample={isError || !data || isSample(data.sample, "auctions")} />
        <div className="flex flex-col gap-5">
          <div role="tablist" aria-label="Examples" className="flex w-fit gap-1 rounded-pill border border-line bg-surface p-1">
            {EXAMPLES.map((e, i) => (
              <button
                key={e.id}
                role="tab"
                id={`ex-tab-${i}`}
                aria-selected={i === tab}
                aria-controls="ex-panel"
                onClick={() => setTab(i)}
                className={cx("mono-data rounded-pill px-[14px] py-[6px]", i === tab ? "bg-ink text-surface" : "text-ink hover:bg-surface-2")}
              >
                {e.id}
              </button>
            ))}
          </div>
          <div id="ex-panel" role="tabpanel" aria-labelledby={`ex-tab-${tab}`} className="flex flex-col gap-4 rounded-md border border-line bg-surface px-6 py-5">
            <p className="mono-label text-muted">{ex.head}</p>
            <ol className="flex items-center gap-3">
              {ex.flow.map((s, i) => (
                <li key={i} className="flex items-center gap-3">
                  {i > 0 && (
                    <span aria-hidden className="display-m text-faint">
                      →
                    </span>
                  )}
                  <span className="flex flex-col items-center gap-2">
                    <Mascot name={s.name} state={s.state as never} size={52} />
                    <span className="mono-label text-muted">{s.label}</span>
                  </span>
                </li>
              ))}
            </ol>
            <p className="body-small text-ink">{ex.text}</p>
            {ex.refund && (
              <ProofPill kind="refund">
                Refunded to {`demo-buyer.${network === "testnet" ? "testnet" : "near"}`}
              </ProofPill>
            )}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-5 pt-5">
        {isPending ? (
          [0, 1, 2].map((i) => <Skeleton key={i} className="h-[400px]" />)
        ) : (
          <>
            {c.workers.map((w) => (
              <WorkerCard
                key={w.id}
                worker={w}
                network={network}
                note={w.id === "crab" ? "Fast and cheap. Wins most summaries." : "Faster, pricier. Paid on NEAR today. Payouts on Base via Chain Signatures come next."}
              />
            ))}
            <ReviewerCard reviewer={c.reviewer} />
          </>
        )}
      </div>
    </Section>
  );
}
