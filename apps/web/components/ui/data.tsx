// Generic data components (DESIGN-HANDOFF §4 "Keep"). The agency ones live in ./agency.tsx.
import { toBase } from "@shark/shared";
import type { ReactNode } from "react";
import { cx, Sample } from "./primitives";

export function StatTile({ label, value, sample, className }: { label: string; value: ReactNode; sample?: boolean; className?: string }) {
  return (
    <div className={cx("flex flex-col gap-3 rounded-md border border-line bg-surface p-6", className)}>
      <div className="flex items-center justify-between gap-2">
        <p className="mono-chip text-muted">{label}</p>
        <Sample show={!!sample} />
      </div>
      <p className="figure-l text-ink">{value}</p>
    </div>
  );
}

export function RuleCard({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div className="flex flex-col gap-4 rounded-md border border-line bg-surface p-6">
      <p className="mono-data text-accent">{n}</p>
      <h3 className="display-m text-ink">{title}</h3>
      <p className="body-default text-muted">{body}</p>
    </div>
  );
}

export function StepCard({ index, label, title, body, active }: { index: string; label: string; title: string; body?: string; active: boolean }) {
  return (
    <div className={cx("flex gap-7 py-6", active ? "border-t-2 border-ink" : "border-t border-line text-muted")}>
      <p className={cx("figure-l", active && "text-accent")}>{index}</p>
      <div className="flex flex-1 flex-col gap-2">
        <p className={cx("mono-label", active && "text-accent")}>{label}</p>
        <h3 className={cx("display-m", active && "text-ink")}>{title}</h3>
        {active && body && <p className="mono-lede max-w-[460px] text-muted">{body}</p>}
      </div>
    </div>
  );
}

export function ApiSnippet({ title, lines }: { title: string; lines: { text: string; dim?: boolean }[] }) {
  return (
    <figure className="flex flex-col gap-4 rounded-md bg-ink p-6">
      <figcaption className="mono-small flex items-center gap-2 whitespace-pre text-faint">
        {[0, 1, 2].map((i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={i} src="/brand/snippet-dot.svg" alt="" width={9} height={9} />
        ))}
        {`  ${title}`}
      </figcaption>
      <pre className="mono-small overflow-x-auto text-surface">
        {lines.map((l, i) => (
          <span key={i} className={cx("block", l.dim && "text-faint")}>
            {l.text}
          </span>
        ))}
      </pre>
    </figure>
  );
}

export function TextInput({
  label,
  hint,
  error,
  multiline,
  ...rest
}: { label: string; hint?: string; error?: string; multiline?: boolean } & React.InputHTMLAttributes<HTMLInputElement> &
  React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = rest.id ?? rest.name;
  const cls = cx(
    "mono-data w-full rounded-md border bg-surface px-4 py-3 text-ink outline-none placeholder:text-faint focus:border-[1.5px] focus:border-accent",
    error ? "border-loss" : "border-line-strong",
  );
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="mono-data text-ink">
        {label}
      </label>
      {multiline ? <textarea id={id} rows={2} className={cx(cls, "resize-none")} {...rest} /> : <input id={id} className={cls} {...rest} />}
      {error ? (
        <p className="mono-small text-loss" role="alert">
          {error}
        </p>
      ) : (
        hint && <p className="mono-small text-muted">{hint}</p>
      )}
    </div>
  );
}

/** Marker position = (price − min) / (max − min), from bigint base units (no floats on money). */
export function bandPct(min: string, max: string, price: string): number {
  const lo = toBase(min);
  const span = toBase(max) - lo;
  if (span <= 0n) return 0;
  const bp = ((toBase(price) - lo) * 10_000n) / span;
  return Number(bp < 0n ? 0n : bp > 10_000n ? 10_000n : bp) / 100; // percent for CSS only
}

