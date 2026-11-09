"use client";
import type { Order, Quote402 } from "@shark/shared";
import { checkLabel } from "@/lib/checklist";
import { JOB_TYPE, txHref } from "../ui/agency";
import { Coin } from "../ui/motion";
import { Button, cx, Mascot, NAME, ProofPill, Sample } from "../ui/primitives";

/** Sticky receipt column: the job card fills in as the order progresses. */
export type ReceiptHead = { id: string; jobType: Quote402["jobType"]; price: string; brief: { checklist: { id: string; kind: "code" | "model"; rule?: string }[]; params?: Record<string, unknown> } };

export function Receipt({ quote, order, network, onRestart, note = "Sample data. Brands and accounts are placeholders." }: { quote: ReceiptHead | null; order: Order | null; network: "testnet" | "mainnet"; onRestart?: () => void; note?: string }) {
  const usd = network === "testnet" ? "test USDC" : "USDC";
  const brief = quote?.brief;
  const winner = order?.auction?.bids.find((b) => b.state === "winner");
  const review = order?.reviews.filter((r) => r.mode !== "complaint").at(-1);
  const workerPaid = order?.timeline.find((t) => t.event === "worker_paid");
  const sample = order?.sample ?? true;
  const title = quote ? `${JOB_TYPE[quote.jobType].title}${brief?.params?.maxWords ? ` · ${brief.params.maxWords} words` : ""}` : "Your job";
  const copy = () => void navigator.clipboard?.writeText(JSON.stringify(order ?? quote, null, 2));
  return (
    <aside aria-label="Your receipt" className="sticky top-24 flex flex-col gap-4">
      <p className="mono-label text-muted">{"// "}your receipt</p>
      <article className="flex flex-col gap-4 rounded-pane border border-line bg-surface p-5">
        <div className="mono-label flex items-center justify-between text-muted">
          <span>{order ? `// job ${order.orderId}` : quote ? `// quote ${quote.id.slice(0, 10).toLowerCase()}` : "// nothing yet"}</span>
          <Sample show={sample} />
        </div>
        <div className="flex items-center gap-3">
          {winner ? <Mascot name={winner.worker} state={workerPaid ? "paid" : "working"} size={56} /> : <Mascot name="shark" state={quote ? "pricing" : "idle"} size={56} />}
          <div className="flex flex-col">
            <p className="display-s text-ink">{title}</p>
            <p className="mono-small text-muted">
              {quote ? `${quote.price} ${usd}` : "Fill in the order"}
              {winner ? ` · ${NAME[winner.worker]} won at ${winner.price}` : ""}
            </p>
          </div>
        </div>
        {brief && (
          <ul className="flex flex-col gap-1.5">
            {brief.checklist.map((c, i) => {
              const r = review?.checks?.find((x) => x.id === c.id);
              return (
                <li key={c.id} className="flex items-center gap-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/brand/check-${r ? (r.pass ? "passed" : "failed") : "pending"}.svg`} alt={r ? (r.pass ? "passed" : "failed") : "waiting"} width={16} height={16} className={cx(r && "anim-tick")} style={{ animationDelay: `${i * 120}ms` }} />
                  <span className="mono-small text-muted">{c.id}</span>
                  <span className="body-small text-ink">{c.rule ? checkLabel({ rule: c.rule }, brief.params ?? {}) : c.id}</span>
                </li>
              );
            })}
          </ul>
        )}
        {review && (
          <div className="flex items-center gap-3 rounded-md bg-surface-2 px-3 py-2">
            <Mascot name="owl" state={review.pass ? "pass" : "fail"} size={36} />
            <p className="body-small text-ink">{review.pass ? `Owl passed it${review.attestationUrl ? " · attested in a TEE" : ""}` : "Owl failed it · one revision"}</p>
          </div>
        )}
        {workerPaid && winner && (
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <p className="mono-data flex items-center gap-1.5 text-gain">
              <Coin className="anim-coin" />
              <span className="anim-coin">
                {NAME[winner.worker]} +{workerPaid.amount}
              </span>
              <span>·</span>
              <span className="anim-coin" style={{ animationDelay: "100ms" }}>
                Owl +{order?.money?.reviewFee ?? "0.05"}
              </span>
            </p>
            <p className="mono-small text-muted">split after the complaint window</p>
          </div>
        )}
        {order?.refund && <p className="anim-coin mono-data text-gain">{`${order.refund.amount} ${usd} refunded to ${order.refund.to}`}</p>}
      </article>
      {order && (
        <div className="flex flex-col items-start gap-2">
          {/* Proof pills pop (scale .9 → 1), staggered 90 ms */}
          {order.proof.paymentTx && (
            <span className="anim-pillpop">
              <ProofPill kind="payment" href={txHref(network, order.proof.paymentTx, sample)}>
                Paid {order.price} {usd} on NEAR
              </ProofPill>
            </span>
          )}
          {order.proof.workerPayoutTx && winner && (
            <span className="anim-pillpop" style={{ animationDelay: "90ms" }}>
              <ProofPill kind={winner.worker === "raven" ? "worker-base" : "worker-near"} href={txHref(network, order.proof.workerPayoutTx, sample)}>
                {NAME[winner.worker]} paid {winner.price} on {winner.worker === "raven" ? "Base" : "NEAR"}
              </ProofPill>
            </span>
          )}
          {review?.attestationUrl && (
            <span className="anim-pillpop" style={{ animationDelay: "180ms" }}>
              <ProofPill kind="review" href={sample ? undefined : review.attestationUrl}>
                Owl review · attested
              </ProofPill>
            </span>
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-3">
        {(order || quote) && (
          <Button variant="ghost" arrow={false} onClick={copy}>
            Copy JSON
          </Button>
        )}
        {order && onRestart && (
          <Button variant="ghost" arrow={false} onClick={onRestart}>
            Order another
          </Button>
        )}
      </div>
      <p className="mono-small text-muted">{note}</p>
    </aside>
  );
}

