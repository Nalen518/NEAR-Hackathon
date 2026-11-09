"use client";
import { Company, Quote402, type JobType } from "@shark/shared";
import company from "@shark/shared/fixtures/company.json";
import quote from "@shark/shared/fixtures/quote-402.json";
import { useState, type ReactNode } from "react";
import { AuctionCard, BriefCard, ChecklistRow, ComplaintBox, DeliveryView, JobTimeline, JobTypeCard, LedgerRow, PriceBandRow, ReviewerCard, ReviewReport, WorkerCard } from "@/components/ui/agency";
import { ApiSnippet, RuleCard, StatTile, StepCard } from "@/components/ui/data";
import { StateCard, SystemBanner, type BannerState } from "@/components/ui/feedback";
import { NetworkBadge, NetworkSwitch } from "@/components/ui/NetworkSwitch";
import { Button, Chip, Mascot, MASCOT_STATES, ProofPill, Sample, type MascotName, type ProofKind } from "@/components/ui/primitives";
import { orderFor, SCENARIOS, toPublic, type Scenario } from "@/mocks/scenarios";
import { DataSource } from "@/components/company/Company";
import { SeaMist } from "@/components/hero/SeaMist";
import { Footer } from "@/components/landing/CtaFooter";
import { PartnerChip } from "@/components/landing/Hero";
import { Nav } from "@/components/landing/Nav";
import { EMPTY_FORM, OrderForm, type FormState } from "@/components/order/OrderForm";
import { Receipt } from "@/components/order/Receipt";

const c = Company.parse(company);
const q = Quote402.parse(quote);
const order = (s: Scenario) => orderFor("j_000042", "testnet", s, Date.parse("2026-11-05T08:13:02Z"));
const delivered = order("ok");

const TEXT_STYLES = ["display-hero", "display-xl", "display-l", "display-m", "display-s", "body-default", "body-small", "mono-lede", "mono-data", "mono-label", "mono-small", "mono-chip", "mono-button", "figure-l", "figure-m", "hand-eyebrow", "brand-wordmark"];
const COLORS = ["bg", "surface", "surface-2", "tile", "line", "line-strong", "ink", "muted", "faint", "accent", "gain", "loss", "shark", "owl", "raven", "crab", "crab-belly"];
const BANNERS: BannerState[] = ["closed", "paused", "caged", "no_worker", "out_of_budget", "rate_limited", "upstream_down"];
const PROOFS: [ProofKind, string][] = [
  ["payment", "Paid 0.60 test USDC on NEAR"],
  ["worker-near", "Crab paid 0.18 on NEAR"],
  ["worker-base", "Raven paid on Base · Chain Signatures"],
  ["review", "Owl review · attested"],
  ["refund", "Refunded to demo-buyer.testnet"],
];

function Row({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4 border-t border-line py-8">
      <h2 className="mono-label text-muted">{title}</h2>
      <div className="flex flex-wrap items-start gap-4">{children}</div>
    </section>
  );
}

export function Gallery() {
  const [reason, setReason] = useState("");
  const [form, setForm] = useState<FormState>({ ...EMPTY_FORM, instructions: "Summarise this article in 150 words or fewer. Mention NEAR Intents and fees.", url: "https://example.com/blog/intents-explained", maxWords: "150", mustMention: ["NEAR Intents", "fees"], payer: "demo-buyer.testnet" });
  const now = Date.parse("2026-11-05T08:33:52Z");
  return (
    <main className="mx-auto max-w-[1440px] px-[72px] py-12">
      <h1 className="display-l">Components v2.0 · dev only</h1>
      <p className="mono-small text-muted">Mock scenarios (?mock=): {Object.keys(SCENARIOS).join(" · ")}</p>
      <Row title="Text styles">
        <div className="flex flex-col gap-2">
          {TEXT_STYLES.map((s) => (
            <p key={s} className={s}>
              {s} 128.00
            </p>
          ))}
        </div>
      </Row>
      <Row title="Colours">
        {COLORS.map((t) => (
          <div key={t} className="flex flex-col items-center gap-1">
            <span className="size-16 rounded-md border border-line" style={{ background: `var(--color-${t})` }} />
            <span className="mono-small">{t}</span>
          </div>
        ))}
      </Row>
      {(Object.keys(MASCOT_STATES) as MascotName[]).map((n) => (
        <Row key={n} title={`Mascot v2 · ${n}`}>
          {MASCOT_STATES[n].map((s) => (
            <figure key={s} className="flex flex-col items-center gap-2">
              <Mascot name={n} state={s as never} size={96} />
              <figcaption className="mono-small text-muted">{s}</figcaption>
            </figure>
          ))}
        </Row>
      ))}
      <Row title="Nav v2 · Footer v2">
        <div className="w-full overflow-hidden rounded-md border border-line">
          <Nav />
          <Footer />
        </div>
      </Row>
      <Row title="SeaMist (light · dark)">
        <SeaMist tone="light" className="relative h-[200px] w-[560px] rounded-md border border-line bg-bg" />
        <SeaMist tone="dark" className="relative h-[200px] w-[560px] rounded-md bg-ink" />
      </Row>
      <Row title="DataSource · PartnerChip">
        <DataSource live />
        <DataSource live={false} />
        <PartnerChip name="NEAR AI" line="writes the brief and does the work" />
        <PartnerChip name="OutLayer" line="Owl reviews every job in a TEE" />
      </Row>
      <Row title="NetworkSwitch · NetworkBadge">
        <NetworkSwitch />
        <NetworkBadge />
      </Row>
      <Row title="Button · Chip · Sample">
        <Button>Order a job</Button>
        <Button variant="ghost">For agents</Button>
        <Button disabled>Disabled</Button>
        <Chip tone="solid">winner</Chip>
        <Chip>lost</Chip>
        <Sample />
      </Row>
      <Row title="ProofPill v2">
        {PROOFS.map(([k, t]) => (
          <ProofPill key={k} kind={k} href="https://example.com">
            {t}
          </ProofPill>
        ))}
      </Row>
      <Row title="SystemBanner v2">
        <div className="flex w-full flex-col gap-3">
          {BANNERS.map((b) => (
            <SystemBanner key={b} state={b} retryAfter={b === "rate_limited" ? 30 : null} />
          ))}
        </div>
      </Row>
      <Row title="JobTypeCard">
        {(["extract", "summary", "thread"] as JobType[]).map((t) => (
          <div key={t} className="flex w-[400px] flex-col gap-4">
            <JobTypeCard type={t} band={c.prices.types[t].band} floor={c.prices.types[t].floor} network="testnet" />
            <JobTypeCard type={t} band={c.prices.types[t].band} floor={c.prices.types[t].floor} network="testnet" selected onSelect={() => {}} />
          </div>
        ))}
      </Row>
      <Row title="PriceBandRow">
        <div className="flex w-full flex-col gap-3">
          {(["extract", "summary", "thread"] as JobType[]).map((t) => {
            const last = c.prices.recentQuotes.find((x) => x.jobType === t && x.status === "paid");
            return <PriceBandRow key={t} type={t} band={c.prices.types[t].band} floor={c.prices.types[t].floor} last={last} network="testnet" />;
          })}
        </div>
      </Row>
      <Row title="OrderForm (summary · switch the tabs for extract and thread)">
        <div className="w-[640px] rounded-pane border border-line bg-surface p-6">
          <OrderForm form={form} set={(p) => setForm((f) => ({ ...f, ...p }))} onSubmit={() => {}} onUpload={() => {}} uploading={false} errors={{}} busy={false} />
        </div>
      </Row>
      <Row title="Receipt (quote · delivered · public)">
        <div className="w-[344px]">
          <Receipt quote={{ id: q.quoteId, jobType: q.jobType, price: q.price, brief: q.brief }} order={null} network="testnet" />
        </div>
        <div className="w-[344px]">
          <Receipt quote={{ id: q.quoteId, jobType: q.jobType, price: q.price, brief: q.brief }} order={delivered} network="testnet" onRestart={() => {}} />
        </div>
        <div className="w-[344px]">
          <Receipt quote={{ id: delivered.orderId, jobType: "summary", price: "0.60", brief: { checklist: delivered.brief.checklist.map((c) => ({ id: c.id, kind: c.kind, rule: c.kind === "code" ? "Checked by code" : "Checked by AI" })) } }} order={toPublic(delivered)} network="testnet" note="Public view. Sign in as the payer to see the delivery." />
        </div>
      </Row>
      <Row title="ChecklistRow">
        <div className="flex w-[560px] flex-col gap-2">
          <ChecklistRow id="C1" kind="code" label="Word count is 150 or fewer" state="pending" />
          <ChecklistRow id="C1" kind="code" label="Word count is 150 or fewer" state="passed" detail="142 words" />
          <ChecklistRow id="C1" kind="code" label="Word count is 150 or fewer" state="failed" detail="171 words · 21 over" />
        </div>
      </Row>
      <Row title="BriefCard (valid · expired)">
        <div className="w-[640px]">
          <BriefCard quote={q} network="testnet" secsLeft={581} actions={<div className="flex gap-3"><Button arrow={false}>Pay 0.60 test USDC</Button><Button variant="ghost" arrow={false}>Change the order</Button></div>} />
        </div>
        <div className="w-[640px]">
          <BriefCard quote={q} network="testnet" secsLeft={0} actions={<Button arrow={false}>Get a new quote</Button>} />
        </div>
      </Row>
      <Row title="ReviewReport (passed · failed · second opinion)">
        {[order("ok").reviews[0], order("revision").reviews[0], order("disputed_overturned").reviews.at(-1)!].map((r, i) => (
          <div key={i} className="w-[460px]">
            <ReviewReport
              review={r}
              brief={q.brief}
              worker="Crab"
              summary={r.pass ? (r.mode === "primary" ? "All five checks passed. Crab is paid 0.18 and Owl 0.05. The delivery is yours." : "A second model reread the source and overturned the fail. Crab is paid. The delivery is yours.") : "C2 failed: fees are never mentioned. Crab gets one revision. Nobody is paid yet. Your 0.60 stays in escrow."}
            />
          </div>
        ))}
      </Row>
      <Row title="DeliveryView (text · JSON table · thread · locked)">
        <div className="w-[560px]">
          <DeliveryView delivery={delivered.delivery} />
        </div>
        <div className="w-[560px]">
          <DeliveryView delivery={order("extract_job").delivery} />
        </div>
        <div className="w-[560px]">
          <DeliveryView delivery={order("thread_job").delivery} />
        </div>
        <div className="w-[560px]">
          <DeliveryView delivery={null} payer="demo-buyer.testnet" onSignIn={() => {}} />
        </div>
      </Row>
      <Row title="JobTimeline (delivered · revision · refunded · unresolved · finalized)">
        <div className="flex w-full flex-col gap-3">
          {(["ok", "revision", "refunded", "unresolved", "finalized"] as Scenario[]).map((s) => (
            <JobTimeline key={s} order={order(s)} />
          ))}
        </div>
      </Row>
      <Row title="AuctionCard v2 · BidRow v2">
        <div className="w-[700px]">
          <AuctionCard orderId="j_000042" price="0.60" auction={delivered.auction!} workers={c.workers} network="testnet" sample />
        </div>
        <div className="w-[700px]">
          <AuctionCard orderId={c.auctions[0].orderId} price={c.auctions[0].price} auction={c.auctions[0]} workers={c.workers} network="testnet" sample />
        </div>
      </Row>
      <Row title="WorkerCard · ReviewerCard">
        <div className="w-[380px]">
          <WorkerCard worker={c.workers[0]} network="testnet" note="Fast and cheap. Wins most summaries." />
        </div>
        <div className="w-[380px]">
          <WorkerCard worker={c.workers[1]} network="testnet" note="Paid in USDC on Base via Chain Signatures · payout gas 0.0041 ETH, about 23 payouts left." />
        </div>
        <div className="w-[380px]">
          <WorkerCard worker={{ ...c.workers[1], suspended: true, eligible: false, ineligibleReason: "suspended", disputesLost: 1 }} network="testnet" note="Suspended: 3 final fails or lost disputes in its last 20 jobs. Only the owners can reinstate it." />
        </div>
        <div className="w-[380px]">
          <ReviewerCard reviewer={c.reviewer} attestationHref="https://example.com" />
        </div>
      </Row>
      <Row title="ComplaintBox (open · reviewing · upheld · rejected · closed)">
        {(["ok", "complaint_review", "complaint_upheld", "complaint_rejected", "finalized"] as Scenario[]).map((s) => {
          const o = order(s);
          return (
            <div key={s} className="w-[560px]">
              <ComplaintBox complaint={s === "finalized" ? { ...o.complaint, allowedUntil: "2026-11-05T08:00:00Z" } : o.complaint} price="0.60" payer="demo-buyer.testnet" network="testnet" now={now} reason={reason} onReason={setReason} onSend={() => {}} />
            </div>
          );
        })}
      </Row>
      <Row title="LedgerRow v2">
        <div className="w-full">
          {c.recentJobs.map((j) => (
            <LedgerRow key={j.orderId} job={j} network="testnet" sample />
          ))}
        </div>
      </Row>
      <Row title="StatTile · RuleCard · StepCard · StateCard">
        <div className="w-[260px]">
          <StatTile label="Revenue · test USDC" value="128.00" sample />
        </div>
        <div className="w-[300px]">
          <RuleCard n="01" title="Your money never touches the AI." body="Payments land in the contract. Shark only holds a small daily budget." />
        </div>
        <div className="w-[420px]">
          <StepCard index="03" label="hiring" title="Two workers bid." body="Crab and Raven send signed bids. Shark picks on price and track record." active />
        </div>
        <div className="w-[420px]">
          <StateCard title="Shark is writing your brief" chip="quoting" money="nothing charged yet" />
        </div>
      </Row>
      <Row title="ApiSnippet">
        <div className="w-[640px]">
          <ApiSnippet
            title="// for agents · HTTP 402 → x402 or signed quote"
            lines={[
              { text: "POST /v1/orders  {jobType, instructions, input, payer}" },
              { text: "← 402 Payment Required · PAYMENT-REQUIRED: <x402>" },
              { text: "  price 0.60 · band 0.20 to 1.00 · expires in 10 min", dim: true },
              { text: "→ retry with PAYMENT-SIGNATURE (x402)" },
              { text: "GET /v1/orders/j_000042" },
            ]}
          />
        </div>
      </Row>
    </main>
  );
}
