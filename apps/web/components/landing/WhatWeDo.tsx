"use client";
import { Prices, type JobType } from "@shark/shared";
import samplePrices from "@shark/shared/fixtures/prices.json";
import { usePrices } from "@/lib/api";
import { useNetwork } from "@/lib/network";
import { JobTypeCard } from "../ui/agency";
import { LiveUnavailable, Section, SectionHead, Skeleton } from "../ui/primitives";

const fallback = Prices.parse(samplePrices);
const TYPES: JobType[] = ["extract", "summary", "thread"];

export function WhatWeDo() {
  const { network } = useNetwork();
  const { data, isPending, isError } = usePrices();
  const types = (data ?? fallback).types;
  return (
    <Section className="pt-[72px] pb-6">
      <SectionHead eyebrow="// what we do" title="Three small jobs. Checked every time." lede="Extraction, summaries and X threads. Every order becomes a brief that can be checked." ledeClass="max-w-none" />
      <LiveUnavailable show={isError} />
      <div className="grid grid-cols-3 gap-12 pt-7 max-xl:gap-6">
        {TYPES.map((t) => (isPending ? <Skeleton key={t} className="h-[223px]" /> : <JobTypeCard key={t} type={t} band={types[t].band} floor={types[t].floor} network={network} />))}
      </div>
    </Section>
  );
}
