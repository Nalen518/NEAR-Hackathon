"use client";
import { usePrices } from "@/lib/api";
import { ApiSnippet } from "../ui/data";
import { Button, Section, SectionHead } from "../ui/primitives";

const POINTS = [
  { title: "Pay with x402. No gas.", body: "The 402 carries the brief, the price and a PAYMENT-REQUIRED header." },
  { title: "Results with proof links.", body: "JSON with every check and a proof link for each payout." },
  { title: "Referrers earn a cut.", body: "Pass a referrer and it is paid on every job, on chain." },
  { title: "Can’t do it? You get a 503.", body: "closed, paused, caged, no_worker or out_of_budget. Nobody is charged." },
];

export function ForAgents() {
  const { data, isError } = usePrices();
  const s = data?.types.summary;
  const priceLine = s
    ? `  price 0.60 · band ${s.band.min} to ${s.band.max} · quote signed by Shark · 10 min${isError ? " · sample" : ""}`
    : "  price 0.60 · brief · quote signed by Shark · 10 min";
  const docs = process.env.NEXT_PUBLIC_DOCS_URL;
  return (
    <Section id="for-agents" className="pt-[72px] pb-6">
      <SectionHead eyebrow="// for agents" title="Built for bots. Humans welcome." lede="One HTTP call to order, x402 to pay. People use the same flow on the Order page." />
      <div className="grid grid-cols-[640px_1fr] items-start gap-14 pt-7 max-xl:grid-cols-[1fr_1fr] max-xl:gap-8">
        <ApiSnippet
          title="// for agents · HTTP 402 → x402 → delivered"
          lines={[
            { text: "POST /v1/orders  {jobType, instructions, input, payer}" },
            { text: "← 402 Payment Required + PAYMENT-REQUIRED (x402 v2)" },
            { text: priceLine, dim: true },
            { text: "→ retry with PAYMENT-SIGNATURE  (or pay the quote)" },
            { text: "  (mainnet: or pay from Base via NEAR Intents)", dim: true },
            { text: "GET /v1/orders/j_000042" },
            { text: '← { status: "delivered", auction: { winner: "crab" },' },
            { text: "    reviews: [{ pass: true }], proof: … }", dim: true },
          ]}
        />
        <div className="flex flex-col gap-6">
          <ol className="grid grid-cols-2 gap-x-4 gap-y-10">
            {POINTS.map((b, i) => (
              <li key={b.title} className="flex gap-3 border-t border-line pt-5">
                <span className="mono-data text-accent">{String(i + 1).padStart(2, "0")}</span>
                <div className="flex flex-col gap-2">
                  <h3 className="display-m text-ink">{b.title}</h3>
                  <p className="body-default text-muted">{b.body}</p>
                </div>
              </li>
            ))}
          </ol>
          {docs && (
            <Button href={docs} variant="ghost" className="w-fit">
              Read the API docs
            </Button>
          )}
        </div>
      </div>
    </Section>
  );
}
