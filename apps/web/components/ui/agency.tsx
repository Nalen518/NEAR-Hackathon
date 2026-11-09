// Agency components (DESIGN-HANDOFF §4 "New" and §8 node map), typed by the packages/shared API shapes.
// Customer instructions, inputs and deliveries render as plain React text, never HTML (prompt rule 9).
import type {
  AuctionRecord,
  Bid,
  Brief,
  CheckItem,
  Company,
  Delivery,
  JobType,
  LedgerJob,
  Network,
  Order,
  Quote402,
  Review,
  Worker,
} from "@shark/shared";
import { useState, type ReactNode } from "react";
import { checkLabel } from "@/lib/checklist";
import { NETWORKS } from "@/lib/network";
import { jobNo, weightedLength, wordCount } from "@/lib/text";
import { Play } from "./motion";
import {
  Button,
  Chip,
  cx,
  Mascot,
  NAME,
  ProofPill,
  Sample,
  SmartLink,
} from "./primitives";

const usd = (network: Network) =>
  network === "testnet" ? "test USDC" : "USDC";
const hhmmss = (iso: string) => iso.slice(11, 19);
/** Tx link on this deployment's explorer; none for sample data (fake hashes). */
export const txHref = (
  network: Network,
  tx: string | null | undefined,
  sample: boolean,
) => (tx && !sample ? `${NETWORKS[network].nearTx}${tx}` : undefined);

// ---- ChecklistRow (130:1884): pass = accent, fail = ink; never green/red.
export type CheckState = "pending" | "passed" | "failed";
export function ChecklistRow({
  id,
  kind,
  label,
  state,
  detail,
  delay,
}: {
  id: string;
  kind: CheckItem["kind"];
  label: string;
  state: CheckState;
  detail?: string;
  delay?: number;
}) {
  return (
    <div
      className={cx(
        "flex items-center gap-3 rounded-md border px-[14px] py-[10px]",
        state === "failed"
          ? "border-ink bg-surface-2"
          : "border-line bg-surface",
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/brand/check-${state}.svg`}
        alt={state}
        width={20}
        height={20}
        className={cx(
          state !== "pending" && delay !== undefined && "anim-tick",
        )}
        style={
          delay !== undefined ? { animationDelay: `${delay}ms` } : undefined
        }
      />
      <span className="mono-data text-muted">{id}</span>
      <span className="body-small flex-1 text-ink">{label}</span>
      <span className="mono-chip rounded-pill bg-surface-2 px-[10px] py-1 text-ink">
        {kind === "code" ? "code" : "ai"}
      </span>
      {detail && (
        <span
          className={cx(
            "mono-small whitespace-nowrap",
            state === "failed" ? "text-ink" : "text-muted",
          )}
        >
          {detail}
        </span>
      )}
    </div>
  );
}

/** Rows for a brief's checklist, split "checked by code" / "checked by AI". */
export function Checklist({
  items,
  params,
  review,
  codeTitle = "Checked by code",
}: {
  items: CheckItem[];
  params: Brief["params"];
  review?: Review;
  codeTitle?: string;
}) {
  const row = (c: CheckItem) => {
    const r = review?.checks?.find((x) => x.id === c.id);
    return (
      <ChecklistRow
        key={c.id}
        id={c.id}
        kind={c.kind}
        label={checkLabel(c, params)}
        state={r ? (r.pass ? "passed" : "failed") : "pending"}
        detail={r?.detail}
      />
    );
  };
  const code = items.filter((c) => c.kind === "code");
  const model = items.filter((c) => c.kind === "model");
  return (
    <div className="flex flex-col gap-2">
      <p className="mono-label text-muted">{codeTitle}</p>
      {code.map(row)}
      <p className="mono-label pt-2 text-muted">
        Checked by AI · Owl
      </p>
      {model.map(row)}
    </div>
  );
}

// ---- JobTypeCard (130:2025). Band from GET /v1/prices.
export const JOB_TYPE: Record<
  JobType,
  { title: string; example: string; delivered: string }
> = {
  extract: {
    title: "Data extraction",
    example:
      "“Pull name, price and date for every product on example.com/catalogue.”",
    delivered: "delivered as JSON",
  },
  summary: {
    title: "Summary",
    example:
      "“Summarise example.com/blog/intents-explained in 150 words or fewer. Mention NEAR Intents and fees.”",
    delivered: "delivered as text",
  },
  thread: {
    title: "X thread",
    example:
      "“5 posts for @example_brand about the launch. Include example.com/launch and #NEAR.”",
    delivered: "we never post for you",
  },
};
export function JobTypeCard({
  type,
  band,
  floor,
  network,
  selected,
  onSelect,
}: {
  type: JobType;
  band: { min: string; max: string };
  floor: string;
  network: Network;
  selected?: boolean;
  onSelect?: () => void;
}) {
  const t = JOB_TYPE[type];
  const body = (
    <>
      <span className="flex w-full items-center justify-between">
        <span className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/brand/icon-${type}.svg`} alt="" width={28} height={28} />
          <span className="display-s text-ink">{t.title}</span>
        </span>
        {selected && (
          <span className="mono-chip rounded-pill bg-accent px-[10px] py-1 text-surface">
            selected
          </span>
        )}
      </span>
      <span className="body-small text-muted">{t.example}</span>
      <span className="h-px w-full bg-line" />
      <span className="flex w-full items-center justify-between">
        <span className="mono-small text-muted">Price band</span>
        <span className="mono-data text-ink">
          {band.min} to {band.max} {usd(network)}
        </span>
      </span>
      <span className="mono-small text-muted">
        floor {floor} · {t.delivered}
      </span>
    </>
  );
  const cls = cx(
    "flex flex-col items-start gap-4 rounded-pane bg-surface p-6 text-left",
    selected ? "border-2 border-accent" : "border border-line",
  );
  return onSelect ? (
    <button
      type="button"
      aria-pressed={!!selected}
      onClick={onSelect}
      className={cx(cls, "hover:border-ink")}
    >
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

// ---- PriceBandRow (130:2079): per type band, floor and the last quote marker.
export function PriceBandRow({
  type,
  band,
  floor,
  last,
  network,
}: {
  type: JobType;
  band: { min: string; max: string };
  floor: string;
  last?: { price: string; reason: string };
  network: Network;
}) {
  const pct = last ? bandPctLocal(band.min, band.max, last.price) : null;
  return (
    <div className="grid grid-cols-[140px_1fr_220px] items-center gap-6 rounded-md border border-line bg-surface px-5 py-4">
      <div className="flex flex-col">
        <span className="display-s text-ink">{JOB_TYPE[type].title}</span>
        <span className="mono-small text-muted">floor {floor}</span>
      </div>
      <div className="flex flex-col gap-1">
        <div
          className="relative h-2 rounded-sm border border-line-strong bg-surface-2"
          role="img"
          aria-label={`Band ${band.min} to ${band.max}${last ? `, last quote ${last.price}` : ""}`}
        >
          {pct !== null && (
            <span
              className="absolute -top-1 h-4 w-0.5 bg-ink"
              style={{ left: `${pct}%` }}
            />
          )}
        </div>
        <div className="mono-small flex justify-between text-muted">
          <span>{band.min}</span>
          <span>{band.max}</span>
        </div>
      </div>
      <div className="flex flex-col text-right">
        <span className="mono-data text-ink">
          {last ? `Last quote ${last.price}` : "No quote yet"}
        </span>
        {last && <span className="mono-small text-muted">“{last.reason}”</span>}
        <span className="mono-small text-muted">{usd(network)}</span>
      </div>
    </div>
  );
}
function bandPctLocal(min: string, max: string, price: string) {
  const [lo, hi, p] = [min, max, price].map((v) => Math.round(Number(v) * 1e6)); // display only, never money maths
  return hi > lo ? Math.min(100, Math.max(0, ((p - lo) / (hi - lo)) * 100)) : 0;
}

// ---- BriefCard (131:2218): Shark's brief + quote.
export function BriefCard({
  quote,
  network,
  secsLeft,
  actions,
}: {
  quote: Quote402;
  network: Network;
  secsLeft: number;
  actions?: ReactNode;
}) {
  const p = quote.brief.params as Record<string, unknown>;
  const expired = secsLeft <= 0;
  const mm = String(Math.floor(Math.max(0, secsLeft) / 60)).padStart(2, "0");
  const ss = String(Math.max(0, secsLeft) % 60).padStart(2, "0");
  const rows: [string, ReactNode][] = [
    ...(p.maxWords
      ? [["Max words", String(p.maxWords)] as [string, ReactNode]]
      : []),
    ...(Array.isArray(p.mustMention) && p.mustMention.length
      ? [
          [
            "Must mention",
            <span key="m" className="flex flex-wrap justify-end gap-1">
              {p.mustMention.map((m) => (
                <Chip key={String(m)}>{String(m)}</Chip>
              ))}
            </span>,
          ] as [string, ReactNode],
        ]
      : []),
    ...(p.posts ? [["Posts", String(p.posts)] as [string, ReactNode]] : []),
    ...(p.language
      ? [
          [
            "Language",
            p.language === "en" ? "English" : String(p.language),
          ] as [string, ReactNode],
        ]
      : []),
    ...(p.format
      ? [
          ["Format", p.format === "bullets" ? "Bullets" : "Paragraph"] as [
            string,
            ReactNode,
          ],
        ]
      : []),
    ["Delivered as", quote.brief.deliverableFormat],
  ];
  return (
    <section className="flex flex-col gap-5 rounded-pane border border-line bg-surface p-7">
      <div className="mono-label flex items-center justify-between text-muted">
        <span>
          {"// "}Shark’s brief · quote{" "}
          {quote.quoteId.slice(0, 10).toLowerCase()}
        </span>
        <Sample />
      </div>
      <div className="flex items-start gap-4">
        <Mascot name="shark" state="briefing" size={56} />
        <div className="flex flex-col gap-1">
          <h3 className="display-m text-ink">
            {JOB_TYPE[quote.jobType].title}
            {quote.input.source
              ? ` of ${quote.input.source.replace(/^https?:\/\//, "")}`
              : ""}
          </h3>
          <p className="mono-small text-muted">
            {quote.input.pages} pages ·{" "}
            {quote.input.words.toLocaleString("en").replace(/,/g, " ")} words ·
            snapshot {quote.input.inputHash.slice(0, 13)}…
          </p>
        </div>
      </div>
      <dl className="flex flex-col gap-2 rounded-md bg-surface-2 px-4 py-3">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between gap-4">
            <dt className="mono-small text-muted">{k}</dt>
            <dd className="mono-data text-ink">{v}</dd>
          </div>
        ))}
      </dl>
      <Checklist items={quote.brief.checklist} params={quote.brief.params} />
      <div className="flex items-end justify-between border-t border-line pt-5">
        <div className="flex flex-col gap-1">
          <p className={cx("figure-l", expired ? "text-muted" : "text-ink")}>
            {quote.price}{" "}
            <span className="mono-data text-muted">{usd(network)}</span>
          </p>
          <p className="mono-small text-muted">
            Shark’s reason: “{quote.priceReason}”
          </p>
          <p className="mono-small text-muted">
            band {quote.band.min} to {quote.band.max} · floor {quote.floor}
          </p>
        </div>
        <div className="flex flex-col items-end">
          <p className="mono-small text-muted">
            {expired ? "Quote expired" : "Quote valid for"}
          </p>
          <p
            className={cx("figure-m", expired ? "text-muted" : "text-ink")}
            aria-live="polite"
          >
            {mm}:{ss}
          </p>
        </div>
      </div>
      <p className="body-small flex items-center gap-3 rounded-md border border-accent px-4 py-3 text-ink">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/check-passed.svg" alt="" width={20} height={20} />
        If it fails the check: one revision, then your money back to{" "}
        {quote.quote.payer}.
      </p>
      {actions && <div className="flex flex-wrap gap-3">{actions}</div>}
      <p className="mono-small text-muted">
        {expired ? "Nothing was charged." : "Nothing is charged until you pay."}
      </p>
    </section>
  );
}

// ---- ReviewReport (131:2517)
export function ReviewReport({
  review,
  brief,
  worker,
  summary,
  attestationHref,
}: {
  review: Review;
  brief: Pick<Brief, "checklist" | "params">;
  worker: string;
  summary: string;
  attestationHref?: string;
}) {
  const second = review.mode !== "primary";
  const attested = !!review.attestationUrl; // no TEE claim without an attestation
  const title = second
    ? review.pass
      ? "Second opinion · fail overturned"
      : "Second opinion · fail upheld"
    : review.pass
      ? "Owl’s review · passed"
      : "Owl’s review · failed";
  const chip = second ? "second opinion" : review.pass ? "passed" : "failed";
  return (
    <Play>
      <section className="flex flex-col gap-4 rounded-pane border border-line bg-surface p-6">
        <div className="flex items-start gap-3">
          <Mascot
            name="owl"
            state={second ? "second-opinion" : review.pass ? "pass" : "fail"}
            size={44}
            className={cx(second && "anim-flipy")}
          />
          <div className="flex flex-1 flex-col">
            <p className="display-s text-ink">{title}</p>
            <p className="mono-small text-muted">
              {second
                ? "dispute · secondary · different model"
                : `round ${review.round} · primary`}
              {attested && " · OutLayer TEE"}
            </p>
          </div>
          <span
            className={cx(
              "mono-chip rounded-pill px-[10px] py-1",
              second
                ? "border border-ink text-ink"
                : review.pass
                  ? "bg-accent text-surface"
                  : "bg-ink text-surface",
            )}
          >
            {chip}
          </span>
        </div>
        <div className="flex flex-col gap-2">
          {brief.checklist.map((c, i) => {
            const r = review.checks?.find((x) => x.id === c.id);
            return (
              <ChecklistRow
                key={c.id}
                id={c.id}
                kind={c.kind}
                label={checkLabel(c, brief.params)}
                state={r ? (r.pass ? "passed" : "failed") : "pending"}
                detail={r?.detail}
                delay={(second ? 360 : 0) + i * 120}
              />
            );
          })}
        </div>
        <p className="body-small text-ink">{summary}</p>
        <p className="sr-only">Reviewer: Owl. Worker: {worker}.</p>
        {attested && (
          <ProofPill kind="review" href={attestationHref}>
            Owl review · attested
          </ProofPill>
        )}
      </section>
    </Play>
  );
}

// ---- DeliveryView (132:2418): Text, JSON table, Thread, Locked.
const SHOWN = { posts: 3, rows: 4 }; // Figma 132:2418: "+ 2 more posts", "24 records · 4 shown"

/** Saves the delivery as a file. The content stays text: nothing is parsed into HTML. */
function download(content: string, name: string) {
  const url = URL.createObjectURL(
    new Blob([content], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function DeliveryView({
  delivery,
  payer,
  onSignIn,
  signing,
}: {
  delivery: Delivery | null;
  payer?: string;
  onSignIn?: () => void;
  signing?: boolean;
}) {
  const [all, setAll] = useState(false);
  const head = (kind: string, hash?: string) => (
    <div className="mono-label flex justify-between text-muted">
      <span>
        {"// "}delivery · {kind}
      </span>
      {hash && <span className="text-muted">{hash.slice(0, 13)}…</span>}
    </div>
  );
  if (!delivery)
    return (
      <section className="flex flex-col gap-4 rounded-pane border border-line bg-surface p-6">
        {head("payer only")}
        <div className="flex flex-col items-center gap-3 rounded-md bg-surface-2 px-6 py-8 text-center">
          <svg
            aria-hidden
            width="20"
            height="24"
            viewBox="0 0 20 24"
            className="text-ink"
          >
            <path
              d="M5 10V7a5 5 0 0 1 10 0v3"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            />
            <rect
              x="1"
              y="10"
              width="18"
              height="13"
              rx="3"
              fill="currentColor"
            />
          </svg>
          <p className="display-s text-ink">
            Only the payer can see the delivery
          </p>
          <p className="body-small max-w-[420px] text-muted">
            Sign a message with {payer ?? "the payer account"} to open it.
            Signing is free and moves no money. Everyone else sees the review
            and the payouts.
          </p>
          {onSignIn && (
            <Button onClick={onSignIn} disabled={signing} arrow={false}>
              {signing ? "Waiting for your wallet" : "Sign in to view"}
            </Button>
          )}
        </div>
      </section>
    );
  const copy = (text: string) => void navigator.clipboard?.writeText(text);
  if (delivery.format === "application/json") {
    const parsed = safeJson(delivery.content);
    if (
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      Array.isArray((parsed as { posts?: unknown }).posts)
    ) {
      const posts = (parsed as { posts: unknown[] }).posts.map(String);
      return (
        <section className="flex flex-col gap-4 rounded-pane border border-line bg-surface p-6">
          {head("application/json · thread", delivery.deliveryHash)}
          {(all ? posts : posts.slice(0, SHOWN.posts)).map((p, i) => (
            <div
              key={i}
              className="flex flex-col gap-2 rounded-md bg-surface-2 px-4 py-3"
            >
              <div className="mono-small flex justify-between text-muted">
                <span>
                  {i + 1}/{posts.length}
                </span>
                <span>{weightedLength(p)} / 280</span>
              </div>
              <p className="body-small whitespace-pre-wrap text-ink">{p}</p>
            </div>
          ))}
          {posts.length > SHOWN.posts && (
            <button
              type="button"
              onClick={() => setAll(!all)}
              aria-expanded={all}
              className="mono-small w-fit text-accent"
            >
              {all
                ? "Show fewer posts"
                : `+ ${posts.length - SHOWN.posts} more post${posts.length - SHOWN.posts === 1 ? "" : "s"}`}
            </button>
          )}
          <div className="flex items-center justify-between gap-3">
            <p className="mono-small text-muted">
              Weighted count: each link counts 23. We never post for you.
            </p>
            <Button
              variant="ghost"
              arrow={false}
              onClick={() => copy(posts.join("\n\n"))}
            >
              Copy thread
            </Button>
          </div>
        </section>
      );
    }
    const rows = Array.isArray(parsed)
      ? (parsed as Record<string, unknown>[])
      : [];
    const cols = rows.length ? Object.keys(rows[0]) : [];
    return (
      <section className="flex flex-col gap-4 rounded-pane border border-line bg-surface p-6">
        {head("application/json", delivery.deliveryHash)}
        <div className="overflow-x-auto rounded-md border border-line">
          <table className="mono-small w-full text-left">
            <thead className="mono-label bg-surface-2 text-muted">
              <tr>
                {cols.map((c) => (
                  <th
                    key={c}
                    className={cx(
                      "px-3 py-2",
                      typeof rows[0][c] === "number" && "text-right",
                    )}
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(all ? rows : rows.slice(0, SHOWN.rows)).map((r, i) => (
                <tr key={i} className="border-t border-line text-ink">
                  {cols.map((c) => (
                    <td
                      key={c}
                      className={cx(
                        "px-3 py-2",
                        typeof r[c] === "number" && "text-right",
                      )}
                    >
                      {String(r[c] ?? "none")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="mono-small flex items-center gap-3 text-muted">
            {rows.length} records ·{" "}
            {all ? rows.length : Math.min(SHOWN.rows, rows.length)} shown
            {rows.length > SHOWN.rows && (
              <button
                type="button"
                onClick={() => setAll(!all)}
                aria-expanded={all}
                className="text-accent"
              >
                {all ? "show fewer" : "show all"}
              </button>
            )}
          </p>
          <div className="flex gap-3">
            <Button
              variant="ghost"
              arrow={false}
              onClick={() => copy(delivery.content)}
            >
              Copy JSON
            </Button>
            <Button
              variant="ghost"
              arrow={false}
              onClick={() =>
                download(
                  delivery.content,
                  `delivery-${delivery.deliveryHash.replace(/^sha256:/, "").slice(0, 8)}.json`,
                )
              }
            >
              Download .json
            </Button>
          </div>
        </div>
      </section>
    );
  }
  return (
    <section className="flex flex-col gap-4 rounded-pane border border-line bg-surface p-6">
      {head(delivery.format, delivery.deliveryHash)}
      <p className="body-default whitespace-pre-wrap rounded-md bg-surface-2 px-5 py-4 text-ink">
        {delivery.content}
      </p>
      <div className="flex items-center justify-between">
        <p className="mono-small text-muted">
          {wordCount(delivery.content)} words · reviewed by Owl
        </p>
        <Button
          variant="ghost"
          arrow={false}
          onClick={() => copy(delivery.content)}
        >
          Copy text
        </Button>
      </div>
    </section>
  );
}
function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

// ---- JobTimeline (132:2620): dot accent = done, ink = review fail, ring = now, faint = next.
const STEP: Partial<
  Record<
    Order["timeline"][number]["event"],
    (e: Order["timeline"][number]) => [string, string]
  >
> = {
  paid: (e) => ["Paid", e.amount ?? ""],
  awarded: (e) => [
    `Hired ${e.worker ? NAME[e.worker] : "a worker"}`,
    e.amount ? `bid ${e.amount}` : "",
  ],
  delivered_for_review: (e) => ["Delivered", `round ${e.round ?? 1}`],
  review_pass: () => ["Passed review", "Owl"],
  review_fail: () => ["Review: fail", "one revision"],
  revision_requested: () => ["Revision", "round 2"],
  dispute: () => ["Dispute", "second model asked"],
  second_review_pass: () => ["Fail overturned", "second model"],
  second_review_fail: () => ["Fail upheld", "second model"],
  unresolved: () => ["Unresolved", "refunded now · fee held"],
  worker_paid: (e) => [
    `Paid ${e.worker ? NAME[e.worker] : "worker"}`,
    e.amount ?? "",
  ],
  reviewer_paid: (e) => ["Paid Owl", e.amount ?? ""],
  complaint: () => ["Complaint", "second review"],
  complaint_upheld: () => ["Complaint upheld", "Shark strike"],
  complaint_rejected: () => ["Complaint not upheld", "delivery stands"],
  refund_due: () => ["Refund due", ""],
  refunded: (e) => ["Refunded", e.amount ?? ""],
  finalized: () => ["Finalized", "split paid"],
  needs_review: () => ["Checked by hand", "your money is safe"],
};
const FINAL = new Set(["finalized", "refunded"]);
export function JobTimeline({
  order,
}: {
  order: Pick<Order, "timeline" | "status">;
}) {
  const steps = order.timeline.filter((e) => e.event !== "reviewer_paid"); // shown with the worker payout
  const next: [string, string] | null = FINAL.has(order.status)
    ? null
    : order.status === "delivered"
      ? ["Finalized", "after the window"]
      : ["Next", "in progress"];
  return (
    <ol className="flex items-start overflow-x-auto rounded-pane border border-line bg-surface px-6 py-5">
      {steps.map((e, i) => {
        const [label, sub] = STEP[e.event]?.(e) ?? [e.event, ""];
        const fail =
          e.event === "review_fail" || e.event === "second_review_fail";
        const last = i === steps.length - 1;
        return (
          <li key={i} className="flex min-w-[140px] flex-1 flex-col gap-[10px]">
            <span className="flex items-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/brand/dot-${fail ? "fail" : last && next ? "now" : "done"}.svg`}
                alt=""
                width={12}
                height={12}
              />
              {(!last || next) && (
                <span className="h-0.5 flex-1 bg-line-strong" />
              )}
            </span>
            <span className="mono-data text-ink">
              {e.event === "revision_requested" && (
                <span aria-hidden className="anim-loop mr-1">
                  ↻
                </span>
              )}
              {label}
            </span>
            <span className="mono-small text-muted">{hhmmss(e.at)}</span>
            {sub && <span className="mono-small text-muted">{sub}</span>}
          </li>
        );
      })}
      {next && (
        <li className="flex min-w-[140px] flex-1 flex-col gap-[10px]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/dot-next.svg" alt="" width={12} height={12} />
          <span className="mono-data text-muted">{next[0]}</span>
          <span className="mono-small text-muted">{next[1]}</span>
        </li>
      )}
    </ol>
  );
}

// ---- BidRow v2 (130:2227) + AuctionCard v2 (135:3024). First pass and unresolved come from /v1/company workers[].
export function BidRow({
  bid,
  worker,
  network,
  index = 0,
  count = 1,
}: {
  bid: Bid;
  worker?: Pick<
    Worker,
    "firstPassPct" | "unresolvedOpen" | "maxUnresolvedOpen" | "eligible"
  >;
  network: Network;
  index?: number;
  count?: number;
}) {
  const pick = count * 120 + 400; // Shark picks after the last bid lands
  const won = bid.state === "winner";
  const out =
    bid.state === "busy" ||
    bid.state === "invalid" ||
    worker?.eligible === false;
  const chip = won
    ? "winner"
    : out
      ? "can’t bid"
      : bid.state === "late"
        ? "late"
        : "lost";
  const tone = won ? "text-ink" : out ? "text-muted" : "text-muted";
  return (
    <div
      className={cx(
        "anim-bid mono-data grid grid-cols-[minmax(100px,130px)_56px_48px_56px_68px_88px] items-center gap-3 rounded-sm px-4 py-3",
        won
          ? "border border-ink bg-surface-2"
          : out
            ? "border border-line bg-surface"
            : "bg-surface",
      )}
      style={{ animationDelay: `${index * 120}ms` }}
    >
      <span className={cx("flex items-center gap-[10px]", tone)}>
        <Mascot
          name={bid.worker}
          state={won ? "won" : out ? "suspended" : "lost"}
          size={36}
          className={cx(!won && !out && "opacity-60")}
        />
        {NAME[bid.worker]}
      </span>
      <span className={tone} aria-label={`bid ${bid.price} ${usd(network)}`}>
        {out ? "none" : bid.price}
      </span>
      <span className={tone}>{out ? "none" : `${bid.etaSecs} s`}</span>
      <span className={tone}>
        {worker ? `${worker.firstPassPct}%` : "none"}
      </span>
      <span className={tone}>
        {worker
          ? `${worker.unresolvedOpen} of ${worker.maxUnresolvedOpen}`
          : "none"}
      </span>
      <span>
        <span
          className="anim-chip inline-flex"
          style={{ animationDelay: `${pick}ms` }}
        >
          <Chip tone={won ? "solid" : "outline"}>{chip}</Chip>
        </span>
      </span>
    </div>
  );
}

export function AuctionCard({
  orderId,
  price,
  auction,
  workers,
  network,
  sample,
}: {
  orderId: string;
  price: string;
  auction: Pick<AuctionRecord, "cap" | "bids" | "reason">;
  workers: Worker[];
  network: Network;
  sample: boolean;
}) {
  return (
    <Play>
      <section className="flex flex-col gap-4 rounded-pane border border-line bg-surface p-6">
        <div className="mono-label flex items-center justify-between text-muted">
          <span>
            {"// "}auction · job {orderId}
          </span>
          <Sample show={sample} />
        </div>
        <p className="mono-data text-ink">
          price {price} {usd(network)} · worker cap 50% = {auction.cap} · sealed
          bids in 20 s
        </p>
        <div className="mono-label grid grid-cols-[minmax(100px,130px)_56px_48px_56px_68px_88px] gap-3 px-4 text-muted">
          <span>Worker</span>
          <span>Bid</span>
          <span>ETA</span>
          <span>First pass</span>
          <span>Unresolved</span>
          <span />
        </div>
        {auction.bids.map((b, i) => (
          <BidRow
            key={b.worker}
            bid={b}
            worker={workers.find((w) => w.id === b.worker)}
            network={network}
            index={i}
            count={auction.bids.length}
          />
        ))}
        <div className="flex items-center gap-3 pt-2">
          <Mascot name="shark" state="hiring" size={44} />
          <div className="flex flex-col gap-1">
            <p className="mono-label text-muted">Shark’s pick</p>
            <p
              className="anim-fade mono-data text-ink"
              style={{ animationDelay: `${auction.bids.length * 120 + 580}ms` }}
            >
              “{auction.reason}”
            </p>
          </div>
        </div>
      </section>
    </Play>
  );
}

// ---- WorkerCard (135:2605) + ReviewerCard (135:2735)
export function WorkerCard({
  worker: w,
  network,
  note,
}: {
  worker: Worker;
  network: Network;
  note?: string;
}) {
  const chain = w.payoutChain === "near" ? "NEAR" : NETWORKS[network].baseChain;
  const chip = w.suspended
    ? "suspended"
    : w.eligible
      ? "eligible"
      : "can’t bid";
  const state = w.suspended ? "suspended" : w.eligible ? "idle" : "unpaid";
  const stat = (k: string, v: ReactNode) => (
    <div className="flex flex-col gap-1">
      <span className="mono-small text-muted">{k}</span>
      <span className="figure-m text-ink">{v}</span>
    </div>
  );
  return (
    <article className="flex flex-col gap-5 rounded-pane border border-line bg-surface p-6">
      <div className="flex items-start gap-4">
        <Mascot name={w.id} state={state} size={56} />
        <div className="flex flex-1 flex-col">
          <h3 className="display-s text-ink">{NAME[w.id]}</h3>
          <p className="mono-small text-muted">
            {w.account} · paid on {chain}
          </p>
        </div>
        <span
          className={cx(
            "mono-chip rounded-pill px-[10px] py-1",
            w.suspended
              ? "bg-ink text-surface"
              : w.eligible
                ? "bg-surface-2 text-ink"
                : "border border-ink text-ink",
          )}
        >
          {chip}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-4">
        {stat("Jobs", w.jobs)}
        {stat("First pass", `${w.firstPassPct}%`)}
        {stat("Final fails", w.finalFails)}
        {stat("Disputes", `${w.disputesWon} won · ${w.disputesLost} lost`)}
        {stat("Unresolved", `${w.unresolvedOpen} of ${w.maxUnresolvedOpen}`)}
        {stat("Late", w.late)}
      </div>
      <p className="mono-small border-t border-line pt-4 text-muted">
        Min fee ·{" "}
        {(["extract", "summary", "thread"] as const)
          .map((t) => `${t} ${w.minFee[t]}`)
          .join(" · ")}
      </p>
      {note && <p className="body-small text-ink">{note}</p>}
    </article>
  );
}

export function ReviewerCard({
  reviewer: r,
  attestationHref,
}: {
  reviewer: Company["reviewer"];
  attestationHref?: string;
}) {
  return (
    <article className="flex flex-col gap-5 rounded-pane border border-line bg-surface p-6">
      <div className="flex items-start gap-4">
        <Mascot
          name="owl"
          state={r.suspended ? "fail" : "attested"}
          size={56}
        />
        <div className="flex flex-1 flex-col">
          <h3 className="display-s text-ink">Owl</h3>
          <p className="mono-small text-muted">
            {r.account}
            {attestationHref && " · OutLayer TEE"}
          </p>
        </div>
        <span
          className={cx(
            "mono-chip rounded-pill px-[10px] py-1",
            r.suspended ? "bg-ink text-surface" : "bg-accent text-surface",
          )}
        >
          {r.suspended ? "suspended" : attestationHref ? "attested" : "active"}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-4">
        {(
          [
            ["Reviews", r.reviews],
            ["Overturned", r.overturned],
            ["Review fee", r.reviewFee],
            ["Paid on", "NEAR"],
          ] as const
        ).map(([k, v]) => (
          <div key={k} className="flex flex-col gap-1">
            <span className="mono-small text-muted">{k}</span>
            <span className="figure-m text-ink">{v}</span>
          </div>
        ))}
      </div>
      <p className="body-small text-ink">
        Code checks first, then a model check{attestationHref && ", inside a TEE"}.
        Disputes go to a different model. Paid per review, pass or fail.
      </p>
      {attestationHref && (
        <ProofPill kind="review" href={attestationHref}>
          Owl review · attested
        </ProofPill>
      )}
    </article>
  );
}

// ---- ComplaintBox (135:2872). Window from complaint.allowedUntil; sending needs the payer's signature (D-166).
export function ComplaintBox({
  complaint,
  price,
  payer,
  network,
  now,
  reason,
  onReason,
  onSend,
  sending,
  error,
}: {
  complaint: Order["complaint"];
  price: string;
  payer: string;
  network: Network;
  now: number;
  reason: string;
  onReason: (v: string) => void;
  onSend: () => void;
  sending?: boolean;
  error?: string;
}) {
  const left = complaint.allowedUntil
    ? Date.parse(complaint.allowedUntil) - now
    : 0;
  const state =
    complaint.status === "complaint_review"
      ? "reviewing"
      : complaint.status === "upheld"
        ? "upheld"
        : complaint.status === "rejected"
          ? "rejected"
          : left > 0
            ? "open"
            : "closed";
  const secs = Math.max(0, Math.floor(left / 1000));
  const hms = `${String(Math.floor(secs / 3600)).padStart(2, "0")}:${String(Math.floor(secs / 60) % 60).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;
  const head = {
    open: "Not what you ordered?",
    reviewing: "Complaint sent",
    upheld: "Complaint upheld",
    rejected: "Complaint not upheld",
    closed: "Complaint window closed",
  }[state];
  const chip = {
    open: `${hms} left`,
    reviewing: "reviewing",
    upheld: "upheld",
    rejected: "not upheld",
    closed: "finalized",
  }[state];
  return (
    <section className="flex flex-col gap-4 rounded-pane border border-line bg-surface p-7">
      <div className="flex items-center justify-between">
        <h3 className="display-s text-ink">{head}</h3>
        <span
          className={cx(
            "mono-chip rounded-pill px-[10px] py-1",
            state === "upheld"
              ? "bg-ink text-surface"
              : state === "closed"
                ? "bg-surface-2 text-ink"
                : "border border-ink text-ink",
          )}
        >
          {chip}
        </span>
      </div>
      {state === "open" && (
        <>
          <p className="body-small text-muted">
            If Shark’s brief didn’t match your order, an independent review
            compares the two. If it agrees with you, you get your {price} back
            and Shark gets a strike.
          </p>
          <label className="sr-only" htmlFor="complaint">
            Your reason
          </label>
          <textarea
            id="complaint"
            maxLength={1000}
            value={reason}
            onChange={(e) => onReason(e.target.value)}
            placeholder="I asked for bullet points. The brief said paragraph."
            className="body-default h-[88px] resize-none rounded-md border border-line-strong bg-surface px-4 py-3 text-ink outline-none placeholder:text-faint focus:border-accent"
          />
          {error && (
            <p className="mono-small text-ink" role="alert">
              {error}
            </p>
          )}
          <div className="flex items-center gap-3">
            <Button
              arrow={false}
              onClick={onSend}
              disabled={sending || !reason.trim()}
            >
              {sending ? "Waiting for your wallet" : "Send complaint"}
            </Button>
            <span className="mono-small text-muted">
              Needs your wallet signature · free · 3 a day
            </span>
          </div>
        </>
      )}
      {state === "reviewing" && (
        <div className="flex items-center gap-[14px]">
          <Mascot name="owl" state="reviewing" size={48} />
          <p className="body-small flex-1 text-ink">
            Owl is comparing your order with the brief. This takes about a
            minute. Your delivery stays open.
          </p>
        </div>
      )}
      {state === "upheld" && (
        <>
          <p className="body-small text-ink">
            You were right: the brief didn’t match your order.
          </p>
          <p className="mono-data text-gain">
            {price} {usd(network)} refunded to {payer}
          </p>
          <div className="flex items-center gap-[14px] rounded-md bg-surface-2 px-4 py-3">
            <Mascot name="shark" state="strikes-1" size={48} />
            <p className="body-small flex-1 text-ink">
              Shark got a strike for a wrong brief. Three strikes and Shark goes
              in the cage.
            </p>
          </div>
        </>
      )}
      {state === "rejected" && (
        <>
          <p className="body-small text-ink">
            The review found the brief matched your order. The payment stands
            and the delivery is yours.
          </p>
          <p className="mono-small text-muted">
            Second review · different model
          </p>
        </>
      )}
      {state === "closed" && (
        <p className="body-small text-muted">
          The complaint window has ended. The job is final: the worker, Owl, any
          referrer, the owners and the reserve have been paid.
        </p>
      )}
    </section>
  );
}

// ---- LedgerRow v2 (135:3224): job type + worker + status. Green/red only for money moving.
export function LedgerRow({
  job,
  network,
  sample,
}: {
  job: LedgerJob;
  network: Network;
  sample: boolean;
}) {
  const href = txHref(network, job.workerPayoutTx, sample);
  return (
    <div className="mono-data grid grid-cols-[110px_90px_90px_70px_150px_110px_1fr_40px] min-h-[50px] items-center gap-3 border-t border-line py-3">
      <span className="text-muted">
        {job.at
          ? `${new Date(job.at).toUTCString().slice(5, 11)} ${hhmmss(job.at).slice(0, 5)}`
          : ""}
      </span>
      <span className="text-ink">{jobNo(job.orderId)}</span>
      <span className="mono-chip w-fit rounded-pill bg-surface-2 px-[10px] py-1 text-ink">
        {job.jobType}
      </span>
      <span className="text-ink">{job.price}</span>
      <span className="flex items-center gap-2 text-ink">
        {job.worker && <Mascot name={job.worker} size={24} />}
        {job.worker
          ? `${NAME[job.worker]} · ${job.payoutChain === "base" ? "Base" : "NEAR"}`
          : "none"}
      </span>
      <span>
        <Chip tone={job.status === "refunded" ? "outline" : "solid"}>
          {job.status}
        </Chip>
      </span>
      <span
        className={
          job.refund
            ? "text-loss"
            : job.reserveDelta
              ? "text-gain"
              : "text-muted"
        }
      >
        {job.refund
          ? `−${job.refund} refunded`
          : job.reserveDelta
            ? `+${job.reserveDelta} to reserve`
            : ""}
      </span>
      {href ? (
        <SmartLink
          href={href}
          className="text-accent"
          aria-label={`Payout tx for ${job.orderId}`}
        >
          tx ↗
        </SmartLink>
      ) : (
        <span className="text-muted">tx</span>
      )}
    </div>
  );
}
