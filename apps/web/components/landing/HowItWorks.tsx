"use client";
import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "@/lib/motion";
import { SeaMist } from "../hero/SeaMist";
import { StepCard } from "../ui/data";
import { cx, Mascot, Section, SectionHead, type MascotName } from "../ui/primitives";

type Beat = { label: string; title: string; body: string; stage: string; actor: [MascotName, string]; head: string; lines: [string, string][]; stamp?: string };

// Step titles, beat 03 body and every receipt line: Figma 149:4061 and storyboard 149:4296.
// Bodies for 01, 02, 04, 05 aren't in Figma (gap G20); drafted from the SRD.
const BEATS: Beat[] = [
  {
    label: "The order",
    title: "You order. Shark writes the brief.",
    body: "Pick a job, add a link, a file or text. Shark saves one snapshot, turns your words into a checkable brief and refuses harmful jobs.",
    stage: "Shark writes the brief",
    actor: ["shark", "briefing"],
    head: "01 · the order",
    lines: [
      ["ordered by", "demo-buyer.testnet"],
      ["job", "summary · ≤ 150 words"],
      ["time", "5 Nov · 08:12 UTC"],
    ],
  },
  {
    label: "Payment",
    title: "You pay the contract, not the AI.",
    body: "Shark signs a quote inside the owners' band. Your wallet pays the company contract, which checks the quote itself. Bots can pay with x402.",
    stage: "Shark prices the job",
    actor: ["shark", "pricing"],
    head: "02 · payment",
    lines: [
      ["price", "0.60 test USDC · band 0.20 to 1.00"],
      ["paid from", "NEAR wallet · signed quote"],
      ["reason", "6 pages, 2 required points"],
    ],
  },
  {
    label: "Hiring",
    title: "Two workers bid.",
    body: "Crab and Raven send signed bids. Shark picks on price and track record, under the owners' cap, and the fee waits in escrow until the work passes review.",
    stage: "Shark hires a worker",
    actor: ["shark", "hiring"],
    head: "03 · hiring",
    lines: [
      ["crab bid", "0.18 · 70 s · won"],
      ["raven bid", "0.24 · 45 s"],
      ["why", "cheaper, 93% first pass"],
    ],
  },
  {
    label: "Review",
    title: "Owl checks the work.",
    body: "Code checks first, then a model check. A fail gets one revision. A worker can dispute and a different model decides.",
    stage: "Owl passes it",
    actor: ["owl", "pass"],
    head: "04 · review",
    lines: [
      ["C1 to C3 · code", "3 / 3 pass"],
      ["M1 and M2 · AI", "2 / 2 pass"],
      ["result", "pass · 5 of 5"],
    ],
    stamp: "Owl · pass",
  },
  {
    label: "Payout",
    title: "Pass: everyone is paid. Fail twice: money back.",
    body: "Crab is paid on NEAR and Owl for the review. After the 24 hour complaint window the referrer, the owners and the reserve get their share.",
    stage: "Delivered and paid",
    actor: ["crab", "paid"],
    head: "05 · delivered + payouts",
    lines: [
      ["crab (NEAR)", "0.18 test USDC"],
      ["owl (NEAR)", "0.05 test USDC"],
      ["after 24 h", "0.37 to referrer, owners, reserve"],
    ],
    stamp: "Delivered · 142 words",
  },
];

export function HowItWorks() {
  const [active, setActive] = useState(2);
  const reduced = useReducedMotion();
  const refs = useRef<(HTMLLIElement | null)[]>([]);

  // One beat per step; the step crossing the middle of the viewport prints.
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.i));
      },
      { rootMargin: "-45% 0px -45% 0px" },
    );
    refs.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, []);

  // Reduced motion: the fully printed receipt, nothing pinned.
  const shown = reduced ? BEATS.length - 1 : active;
  const beat = BEATS[shown];
  const [who, state] = beat.actor;

  return (
    <Section id="how-it-works" className="grid grid-cols-[1fr_600px] gap-[72px] py-[72px] max-xl:grid-cols-[1fr_520px] max-xl:gap-12">
      <div>
        <div className="pb-3">
          <SectionHead eyebrow="// how the company works" title="Watch a receipt print." lede="Every step the company takes adds a line to the receipt, and every line links to its proof." />
        </div>
        <ol className="border-b border-line">
          {BEATS.map((b, i) => (
            <li key={b.label} data-i={i} ref={(el) => void (refs.current[i] = el)} className={cx(!reduced && "min-h-[40vh]")}>
              <button className="w-full text-left" onClick={() => setActive(i)} aria-current={i === shown ? "step" : undefined}>
                <StepCard index={String(i + 1).padStart(2, "0")} label={b.label} title={b.title} body={b.body} active={reduced || i === shown} />
              </button>
            </li>
          ))}
        </ol>
      </div>

      <div className={cx("flex flex-col gap-3.5 self-start", !reduced && "sticky top-24")}>
        <div className="relative h-[760px] overflow-hidden rounded-pane bg-ink max-xl:h-[700px]">
          <SeaMist tone="dark" className="absolute inset-0 size-full" />
          <div className="absolute top-14 right-[60px] left-[60px] h-2.5 rounded-[5px] border border-accent bg-[#05080d]" />
          <div className="absolute top-[61px] right-20 left-20" aria-live="polite">
            <div className="flex flex-col gap-3 bg-surface px-7 pt-[22px] pb-5">
              <div className="flex flex-col items-center gap-1">
                <p className="brand-wordmark text-ink">SHARK &amp; CO.</p>
                <p className="mono-label text-muted">zero employee agency · job j_000042 · sample</p>
              </div>
              {/* The stage fits three beats; older ones have fed out of the top. */}
              {shown > 2 && <p className="mono-label text-center text-muted">· · ·</p>}
              {BEATS.slice(0, shown + 1).map((b, i) =>
                i < shown - 2 ? null : (
                  <div key={b.label} className={cx("flex flex-col gap-3", i === shown && "anim-print")}>
                    <hr className="border-t-[1.5px] border-dashed border-line-strong" />
                    <p className="mono-label text-accent">{b.head}</p>
                    {b.lines.map(([k, v], j) => (
                      <p key={k} className={cx("mono-data flex justify-between gap-4", i === shown && i === 2 && "anim-slide")} style={i === shown ? { animationDelay: `${120 * j}ms` } : undefined}>
                        <span className="text-muted">{k}</span>
                        <span className={cx("text-right", i === 2 && j === 0 ? "font-semibold text-ink" : "text-ink")}>{v}</span>
                      </p>
                    ))}
                    {b.stamp && i === shown && (
                      <p className="stamp anim-stamp mono-button self-end rounded-md border-2 border-accent px-3 py-2 text-accent">{b.stamp}</p>
                    )}
                  </div>
                ),
              )}
              {shown < BEATS.length - 1 && (
                <p className="mono-label flex items-center gap-1.5 text-muted">
                  printing <span aria-hidden className="anim-blink inline-block h-3.5 w-2 bg-ink" />
                </p>
              )}
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/torn-edge.svg" alt="" className="block h-[11px] w-full" />
          </div>
          <Mascot name={who} state={state as never} size={150} className="absolute right-6 bottom-4 rotate-4 rounded-[22px]" />
          <p className="mono-label absolute bottom-6 left-6 text-surface">
            {"// "}
            {String(shown + 1).padStart(2, "0")} / 05 · {beat.stage}
          </p>
        </div>
        <div className="flex gap-2" aria-hidden>
          {BEATS.map((b, i) => (
            <span key={b.label} className={cx("h-[3px] flex-1 rounded-[2px] transition-colors", i <= shown ? "bg-accent" : "bg-line-strong")} />
          ))}
        </div>
      </div>
    </Section>
  );
}
