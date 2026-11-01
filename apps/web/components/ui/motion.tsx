"use client";
// Motion helpers for the Motion spec v2.0 (Figma 155:3522). Every animation is CSS, defined under
// prefers-reduced-motion: no-preference in globals.css, so reduced motion shows the end state.
import { toBase } from "@shark/shared";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useReducedMotion } from "@/lib/motion";
import { cx } from "./primitives";

/** True once the element has scrolled into view (never goes back to false). */
export function useInView<T extends Element>(margin = "0px") {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || inView) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setInView(true), { rootMargin: margin });
    io.observe(el);
    return () => io.disconnect();
  }, [inView, margin]);
  return [ref, inView] as const;
}

/** Holds every `anim-*` child paused at its first frame until the box scrolls into view. */
export function Play({ children, className }: { children: ReactNode; className?: string }) {
  const [ref, inView] = useInView<HTMLDivElement>("-60px");
  return (
    <div ref={ref} data-play={inView} className={className}>
      {children}
    </div>
  );
}

/** "Numbers tick up" (900 ms ease out) from 0 to a decimal string. Exact end value, bigint maths, display only. */
export function Tick({ value, ms = 900 }: { value: string; ms?: number }) {
  const reduced = useReducedMotion();
  const [ref, inView] = useInView<HTMLSpanElement>();
  const [frame, setFrame] = useState<string | null>(null); // null = show the real value
  const animate = !reduced && inView && /^\d+(\.\d+)?$/.test(value);
  useEffect(() => {
    if (!animate) return;
    const dp = value.split(".")[1]?.length ?? 0;
    const end = toBase(value);
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / ms);
      const k = BigInt(Math.round((1 - (1 - p) ** 3) * 1000)); // ease out cubic
      const v = (end * k) / 1000n;
      const frac = (v % 1_000_000n).toString().padStart(6, "0").slice(0, dp);
      setFrame(p < 1 ? `${v / 1_000_000n}${dp ? `.${frac}` : ""}` : null);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, animate, ms]);
  return (
    <span ref={ref} className="tabular-nums">
      <span className="sr-only">{value}</span>
      <span aria-hidden>{(animate && frame) || value}</span>
    </span>
  );
}

/** Types text at `msPerChar` with a blinking caret. Reduced motion: the whole text at once. Give it a new `key` to restart. */
export function Typed({ text, msPerChar = 34, caret = true }: { text: string; msPerChar?: number; caret?: boolean }) {
  const reduced = useReducedMotion();
  const [n, setN] = useState(0);
  useEffect(() => {
    if (reduced) return;
    const t = setInterval(() => setN((v) => (v >= text.length ? (clearInterval(t), v) : v + 1)), msPerChar);
    return () => clearInterval(t);
  }, [text, msPerChar, reduced]);
  const done = reduced || n >= text.length;
  return (
    <>
      {reduced ? text : text.slice(0, n)}
      {caret && !done && <span aria-hidden className="anim-blink ml-[0.05em] inline-block h-[0.8em] w-[0.08em] bg-current align-baseline" />}
    </>
  );
}

/** "Unresolved padlock": the shackle drops 3 px and snaps shut. Ink only. */
export function Padlock({ className }: { className?: string }) {
  return (
    <svg aria-hidden width="12" height="14" viewBox="0 0 12 14" className={cx("inline-block text-ink", className)}>
      <path className="anim-shackle" d="M3 6V4a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <rect x="1" y="6" width="10" height="7.5" rx="1.5" fill="currentColor" />
    </svg>
  );
}

/** "Payout coins": a small coin. Green, because it is money moving. */
export function Coin({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <span aria-hidden className={cx("inline-block size-2 rounded-full bg-gain", className)} style={style} />;
}
