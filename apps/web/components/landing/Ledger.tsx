"use client";
import { addUsdc, Company } from "@shark/shared";
import sampleCompany from "@shark/shared/fixtures/company.json";
import { isSample, useCompany } from "@/lib/api";
import { useNetwork } from "@/lib/network";
import { LedgerRow } from "../ui/agency";
import { StatTile } from "../ui/data";
import { Tick } from "../ui/motion";
import { LiveUnavailable, Section, SectionHead, Skeleton } from "../ui/primitives";

const fallback = Company.parse(sampleCompany);

export function Ledger() {
  const { network } = useNetwork();
  const { data, isPending, isError } = useCompany();
  const c = data ?? fallback;
  const unit = network === "testnet" ? "test USDC" : "USDC";
  const pnlSample = isError || !data || isSample(data.sample, "pnl7d");
  const jobsSample = isError || !data || isSample(data.sample, "recentJobs");
  const p = c.pnl7d;
  const tiles: [string, string][] = [
    [`Revenue · ${unit}`, p.revenue],
    [`Workers + reviews · ${unit}`, addUsdc(p.workers, p.reviews)],
    [`Owners' share · ${unit}`, addUsdc(p.ownersPaid, p.ownersAccrued)],
    [`Referral payouts · ${unit}`, p.referrals],
  ];
  return (
    <Section id="receipts" className="pt-[72px] pb-[72px]">
      <SectionHead
        eyebrow={`// the public ledger${jobsSample ? " · sample data" : ""}`}
        title="Receipts for every job."
        lede={`Every job, review, refund and payout is on NEAR. Amounts in ${unit}.`}
      />
      <LiveUnavailable show={isError} />
      <div className="grid grid-cols-4 gap-6 pt-7">
        {tiles.map(([label, value]) => (isPending ? <Skeleton key={label} className="h-[116px]" /> : <StatTile key={label} label={label} value={<Tick value={value} />} sample={pnlSample} className="p-5!" />))}
      </div>
      <div className="mt-5 flex flex-col gap-2 rounded-md border border-line bg-surface px-4 [&>*:first-child]:border-t-0">
        {isPending ? <Skeleton className="my-3 h-[150px]" /> : c.recentJobs.slice(0, 3).map((j) => <LedgerRow key={j.orderId} job={j} network={network} sample={jobsSample} />)}
      </div>
      <p className="mono-small pt-5 text-muted">Brands and accounts shown are placeholders. Instructions and deliveries stay private to the payer.</p>
    </Section>
  );
}
