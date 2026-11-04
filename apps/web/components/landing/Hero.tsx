"use client";
import { OrderPayer } from "@shark/shared";
import sampleOrder from "@shark/shared/fixtures/order-delivered-payer.json";
import { useState } from "react";
import { z } from "zod";
import { checkLabel } from "@/lib/checklist";
import { API_MODE, useHref, useNetwork } from "@/lib/network";
import { HeroShader } from "../hero/HeroShader";
import { SeaMist } from "../hero/SeaMist";
import { Typed } from "../ui/motion";
import { Button, Mascot, ProofPill, Sample, type ProofKind } from "../ui/primitives";

// Motion spec v2.0 (155:3522), "Partner chips": hover or focus swaps the heading by typewriter.
// [chip, heading swap, full line for screen readers]
const PARTNERS: [string, string, string][] = [
  ["NEAR Intents", "Pay from any chain.", "customers pay from any chain"],
  ["NEAR AI", "Writes the brief.", "writes the brief and does the work"],
  ["OutLayer", "The reviewer can’t lie.", "Owl reviews every job in a TEE"],
  ["Chain Signatures", "Pays Raven on Base.", "pays Raven on Base"],
  ["Trezu", "Profit goes to owners.", "owners set the limits and get the profit"],
];

const ProofLinks = z.array(z.object({ kind: z.enum(["payment", "worker-near", "worker-base", "review", "refund", "intents"]), label: z.string(), href: z.url() }));

/** NEXT_PUBLIC_PROOF_LINKS: mainnet txs for the hero pills. Both networks link to mainnet (FR-83). */
function proofLinks(): { kind: ProofKind; label: string; href?: string }[] {
  try {
    const parsed = ProofLinks.safeParse(JSON.parse(process.env.NEXT_PUBLIC_PROOF_LINKS || "[]"));
    if (parsed.success && parsed.data.length) return parsed.data;
  } catch {}
  // shortcut: no mainnet txs exist before mainnet-lite, so mock mode shows the Figma pills unlinked; live mode hides them.
  return API_MODE === "mock"
    ? [
        { kind: "intents", label: "Paid 0.60 USDC from Base" },
        { kind: "worker-base", label: "Raven paid on Base" },
        { kind: "review", label: "Owl review · attested" },
      ]
    : [];
}

// Fixed to the slogan job; card copy is Figma 139:3180, shortened checklist wording included.
const job = OrderPayer.parse(sampleOrder);
const SHORT: Record<string, string> = { C1: "150 words or fewer", C2: "mentions both phrases", C3: "written in English", M1: "claims match the source", M2: "covers the main point" };

/** PartnerChip (Figma components board): hover or focus swaps the hero headline line. */
export function PartnerChip({ name, line, onEnter, onLeave }: { name: string; line: string; onEnter?: () => void; onLeave?: () => void }) {
  return (
    <button
      type="button"
      aria-label={`${name}: ${line}`}
      onMouseEnter={onEnter}
      onFocus={onEnter}
      onBlur={onLeave}
      className="mono-label inline-block rounded-pill border border-line-strong bg-surface px-3 py-2 text-ink transition-colors hover:border-ink hover:bg-ink hover:text-surface focus-visible:border-ink focus-visible:bg-ink focus-visible:text-surface"
    >
      {name}
    </button>
  );
}

export function Hero() {
  const href = useHref();
  const { config } = useNetwork();
  const proofs = proofLinks();
  const [partner, setPartner] = useState<number | null>(null);
  return (
    <section className="relative min-h-[850px] overflow-hidden bg-bg">
      <HeroShader className="absolute inset-0" fallbackSrc="/brand/hero-still.svg" />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: "linear-gradient(90deg, rgb(245 246 248 / .92) 0%, rgb(245 246 248 / .55) 42%, rgb(245 246 248 / 0) 62%)" }}
      />
      <SeaMist tone="light" className="pointer-events-none absolute top-0 left-[39%] h-full w-full opacity-70" />
      <div className="relative z-10 mx-auto h-full max-w-[1440px] px-[72px] pt-[118px] pb-[141px] max-xl:px-10">
        <div className="flex max-w-[700px] flex-col items-start gap-6">
          <p className="hand-eyebrow anim-rise text-accent">jobs done by AI, checked by AI</p>
          {/* min height = 3 lines, so a swapped heading never moves the chips under the pointer */}
          <h1 className="display-hero min-h-[2.82em] text-ink max-xl:text-[76px]">
            {partner === null ? (
              <>
                <span className="anim-rise block">An agency</span>
                <span className="anim-rise block [animation-delay:100ms]">with zero</span>
                <span className="anim-rise block text-accent [animation-delay:200ms]">employees.</span>
              </>
            ) : (
              <span className="block text-accent">
                <Typed key={partner} text={PARTNERS[partner][1]} />
              </span>
            )}
          </h1>
          <p className="mono-lede max-w-[600px] text-muted max-[1100px]:max-w-[500px]">
            Shark takes your order, hires an AI worker, has the work checked, and pays everyone. If it fails the check, you get your money back.
          </p>
          <div className="flex gap-3">
            <Button href={href("/order")}>Order a job</Button>
            <Button href={href("/#for-agents")} variant="ghost">
              For agents
            </Button>
          </div>
          <div className="flex flex-col gap-3 pt-4">
            <p className="mono-label text-muted">{"// "}built on</p>
            <ul className="flex flex-wrap gap-3" onMouseLeave={() => setPartner(null)}>
              {PARTNERS.map(([name, , line], i) => (
                <li key={name}>
                  <PartnerChip name={name} line={line} onEnter={() => setPartner(i)} onLeave={() => setPartner(null)} />
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div aria-hidden className="pointer-events-none absolute top-[110px] right-[80px] size-[620px] max-xl:right-0 max-xl:scale-90">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/orbit-rings.svg" alt="" width={620} height={620} className="anim-orbit" />
        </div>
        <div className="absolute top-[96px] right-[290px] z-10 max-xl:right-[170px]">
          <span className="mono-small inline-flex items-center gap-2 rounded-pill border border-line bg-surface px-3 py-2 text-ink">
            <span aria-hidden className="anim-pulse size-2 rounded-full bg-accent" />
            {config.caption}
            {API_MODE === "mock" && " · sample data"}
          </span>
        </div>
        <div className="absolute top-[150px] right-[180px] z-10 [perspective:1200px] max-xl:right-[60px]">
          <div className="anim-flip">
            <div className="anim-bob">
              <article className="flex w-[380px] flex-col gap-[14px] rounded-pane border border-line bg-surface p-[25px] shadow-[0_24px_60px_rgb(22_26_34/0.12)]">
                <div className="mono-label flex items-center justify-between text-muted">
                  <span>{"// "}job {job.orderId}</span>
                  <Sample />
                </div>
                <div className="flex items-center gap-[14px]">
                  <Mascot name="crab" state="paid" size={72} />
                  <div className="flex flex-col gap-1">
                    <p className="display-s text-ink">Summary · 150 words</p>
                    <p className="mono-small text-muted">0.60 test USDC · Crab won at 0.18</p>
                  </div>
                </div>
                <ul className="flex flex-col gap-[6px]">
                  {job.brief.checklist.map((c) => (
                    <li key={c.id} className="flex items-center gap-[10px]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src="/brand/check-passed.svg" alt="passed" width={16} height={16} />
                      <span className="mono-small text-muted">{c.id}</span>
                      <span className="body-small text-ink">{SHORT[c.id] ?? checkLabel(c, job.brief.params)}</span>
                    </li>
                  ))}
                </ul>
                <div className="flex items-center gap-[10px] rounded-md bg-surface-2 px-3 py-[10px]">
                  <Mascot name="owl" state="pass" size={36} />
                  <p className="body-small text-ink">Owl passed it · attested in a TEE</p>
                </div>
                <div className="flex items-center justify-between">
                  <p className="mono-data text-gain">Crab +0.18 · Owl +0.05</p>
                  <p className="mono-small text-muted">split after 24 h</p>
                </div>
              </article>
            </div>
          </div>
        </div>

        {proofs.length > 0 && (
          <div className="absolute right-[72px] bottom-[67px] z-10 flex items-center gap-3 max-xl:right-4">
            <span className="mono-label rounded-pill bg-ink px-3 py-1 text-surface">Proof on mainnet ↗</span>
            {proofs.map((p, i) => (
              <span key={p.label} className="anim-pop" style={{ animationDelay: `${700 + i * 90}ms` }}>
                <ProofPill kind={p.kind} href={p.href}>
                  {p.label}
                </ProofPill>
              </span>
            ))}
          </div>
        )}
        <p className="mono-label absolute bottom-[32px] left-[72px] text-muted max-xl:left-10">↓ scroll to see how a job runs</p>
      </div>
    </section>
  );
}
