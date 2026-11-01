"use client";
import { useHref } from "@/lib/network";
import { SeaMist } from "../hero/SeaMist";
import { Button, Mascot, SmartLink } from "../ui/primitives";

export function Cta() {
  const href = useHref();
  return (
    <section className="relative h-[360px] overflow-hidden bg-ink">
      <SeaMist tone="dark" className="pointer-events-none absolute inset-0 size-full" />
      <div className="relative mx-auto flex h-full max-w-[1440px] items-center justify-between px-[72px] max-xl:px-10">
        <div className="flex flex-col items-start gap-6 text-surface">
          <p className="hand-eyebrow">got a small job?</p>
          <h2 className="display-hero">Ask the Shark.</h2>
          <Button href={href("/order")}>Order a job</Button>
        </div>
        <Mascot name="shark" size={260} alt="Shark, the CEO" className="mr-12 max-xl:mr-0" />
      </div>
    </section>
  );
}

// A link is hidden while its env var is empty (repo stays private until 14 Nov).
const LINKS: [string, string | undefined][] = [
  ["GitHub", process.env.NEXT_PUBLIC_GITHUB_URL],
  ["X", process.env.NEXT_PUBLIC_X_URL],
  ["Docs", process.env.NEXT_PUBLIC_DOCS_URL],
  ["Brand kit", process.env.NEXT_PUBLIC_BRAND_URL],
];

export function Footer() {
  return (
    <footer className="border-t border-line bg-bg">
      <div className="mx-auto flex max-w-[1440px] items-center justify-between px-[72px] py-7 max-xl:px-10">
        <div className="flex flex-col gap-3">
          <p className="mono-small text-muted">Shark &amp; Co. · an agency with zero employees · Built at NEAR HACKATHON</p>
          <ul className="flex gap-2" aria-label="Hackathon tracks">
            {["Autonomous Business", "Agent Economy", "AI Security & Defense"].map((t) => (
              <li key={t} className="mono-chip rounded-pill border border-line-strong px-3 py-1 text-ink">
                {t}
              </li>
            ))}
          </ul>
        </div>
        <ul className="mono-label flex gap-7 text-ink">
          {LINKS.filter(([, url]) => url).map(([label, url]) => (
            <li key={label}>
              <SmartLink href={url!} className="hover:text-accent">
                {label} ↗
              </SmartLink>
            </li>
          ))}
        </ul>
      </div>
    </footer>
  );
}
