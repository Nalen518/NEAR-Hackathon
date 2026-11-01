// Core components (DESIGN-HANDOFF §6): Button, chips, ProofPill, Mascot, Sample label.
import Link from "next/link";
import type { ReactNode } from "react";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
export { cx };

export function isExternal(href: string) {
  return /^https?:\/\//.test(href);
}

/** Internal links use next/link; external ones open safely in a new tab. */
export function SmartLink({ href, className, children, ...rest }: { href: string; className?: string; children: ReactNode; "aria-label"?: string }) {
  return isExternal(href) ? (
    <a href={href} className={className} target="_blank" rel="noopener noreferrer" {...rest}>
      {children}
    </a>
  ) : (
    <Link href={href} className={className} {...rest}>
      {children}
    </Link>
  );
}

type ButtonProps = {
  variant?: "primary" | "ghost";
  href?: string;
  arrow?: boolean;
  children: ReactNode;
  className?: string;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children">;

/** Pill + mono caps. Primary = accent fill, max one per view. */
export function Button({ variant = "primary", href, arrow = true, children, className, ...rest }: ButtonProps) {
  const cls = cx(
    "mono-button inline-flex shrink-0 items-center gap-2 rounded-pill px-6 whitespace-nowrap transition-colors",
    variant === "primary"
      ? "bg-accent py-4 text-surface hover:bg-[#1f47e0]"
      : "border-[1.5px] border-ink bg-surface py-[15px] text-ink hover:bg-surface-2",
    rest.disabled && "opacity-50",
    className,
  );
  const body = (
    <>
      {children}
      {arrow && <span aria-hidden>↗</span>}
    </>
  );
  return href ? (
    <SmartLink href={href} className={cls}>
      {body}
    </SmartLink>
  ) : (
    <button className={cls} {...rest}>
      {body}
    </button>
  );
}

/** Neutral state chip (WINNER, LOST, ACTIVE, SAMPLE…). Ink only. */
export function Chip({ children, tone = "outline" }: { children: ReactNode; tone?: "solid" | "outline" | "muted" }) {
  const cls = {
    solid: "bg-ink text-surface border-ink",
    outline: "border-ink text-ink",
    muted: "border-muted text-muted",
  }[tone];
  return <span className={cx("mono-chip inline-flex shrink-0 items-center rounded-pill border px-3 py-1", cls)}>{children}</span>;
}

/** FR-84 label. Shown on every number not read from the live contract. */
export function Sample({ show = true, className }: { show?: boolean; className?: string }) {
  if (!show) return null;
  return <span className={cx("mono-chip inline-flex shrink-0 items-center rounded-pill border border-line-strong px-3 py-1 text-muted", className)}>sample</span>;
}

export type ProofKind = "payment" | "worker-near" | "worker-base" | "review" | "refund" | "intents";

// Icons from Figma 27:75 / 64:56x, as used by ProofPill v2 (130:1927).
const PROOF_ICON: Record<ProofKind, string> = {
  payment: "/brand/icon-tx.svg",
  "worker-near": "/brand/icon-tx.svg",
  "worker-base": "/brand/icon-raven-base.svg",
  review: "/brand/icon-attestation.svg",
  refund: "/brand/icon-refund.svg",
  intents: "/brand/icon-intents-payment.svg",
};

/** Every claim links to a real tx or attestation. Without href it renders as plain text (sample). */
export function ProofPill({ kind, href, children }: { kind: ProofKind; href?: string | null; children: ReactNode }) {
  const inner = (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={PROOF_ICON[kind]} alt="" width={14} height={14} />
      <span className="text-ink">{children}</span>
      <span className="text-muted" aria-hidden>
        ↗
      </span>
    </>
  );
  const cls = "mono-data inline-flex w-fit shrink-0 items-center gap-2 self-start rounded-pill border border-line-strong bg-surface px-4 py-3 whitespace-nowrap";
  return href ? (
    <SmartLink href={href} className={cx(cls, "hover:border-ink")}>
      {inner}
    </SmartLink>
  ) : (
    <span className={cls}>{inner}</span>
  );
}

export const MASCOT_STATES = {
  crab: ["idle", "bidding", "won", "lost", "working", "delivered", "revising", "paid", "unpaid", "suspended"],
  raven: ["idle", "bidding", "won", "lost", "working", "delivered", "revising", "paid", "unpaid", "suspended"],
  owl: ["idle", "reviewing", "pass", "fail", "second-opinion", "attested"],
  shark: ["idle", "briefing", "pricing", "hiring", "strikes-1", "strikes-2", "caged"],
} as const;
export type MascotName = keyof typeof MASCOT_STATES;
export type MascotState<N extends MascotName> = (typeof MASCOT_STATES)[N][number];
export const NAME: Record<MascotName, string> = { crab: "Crab", raven: "Raven", owl: "Owl", shark: "Shark" };

/** Mascot v2 sets (Figma 129:1260, 129:1661, 129:1911, 129:2181), exported as SVG. Colour = who, badge = state. */
export function Mascot<N extends MascotName>({ name, state, size, alt, className, style }: { name: N; state?: MascotState<N>; size: number; alt?: string; className?: string; style?: React.CSSProperties }) {
  const st = state ?? "idle";
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={`/brand/m/${name}-${st}.svg`} alt={alt ?? `${NAME[name]}, ${st.replace("-", " ")}`} width={size} height={size} className={cx("shrink-0 rounded-[22%]", className)} style={style} />;
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cx("mono-label text-muted", className)}>{children}</p>;
}

/** Section shell: Figma sections are 72px side padding on a 1440 frame. */
export function Section({ id, children, className }: { id?: string; children: ReactNode; className?: string }) {
  return (
    <section id={id} className={cx("mx-auto w-full max-w-[1440px] px-[72px] max-xl:px-10", className)}>
      {children}
    </section>
  );
}

export function SectionHead({ eyebrow, title, lede, titleClass, ledeClass = "max-w-[800px]" }: { eyebrow: ReactNode; title: ReactNode; lede?: ReactNode; titleClass?: string; ledeClass?: string }) {
  return (
    <div className="flex flex-col gap-5 pb-5">
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className={cx("display-l text-ink", titleClass)}>{title}</h2>
      {lede && <p className={cx("mono-lede text-muted", ledeClass)}>{lede}</p>}
    </div>
  );
}

/** Same-size placeholder while a live section loads (no layout shift). */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cx("animate-pulse rounded-md bg-surface-2 motion-reduce:animate-none", className)} />;
}

export function LiveUnavailable({ show }: { show: boolean }) {
  if (!show) return null;
  return <p className="mono-small text-muted">Live numbers unavailable. Showing sample data.</p>;
}
