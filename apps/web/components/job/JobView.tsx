"use client";
// Job page (Figma Job v2.0: payer view 153:5264, public view 153:5994, states 153:6714).
// Public by default (D-166). The payer view needs a NEP-413 signature and lives only in this tab's memory.
import { NetworkMismatchError, SharkApiError, type Order, type OrderPayer, type Worker } from "@shark/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { useCompany, useShark } from "@/lib/api";
import { DELIVERED, mergePayerView } from "@/lib/payer-view";
import { jobNo, timeLeft } from "@/lib/text";
import { useNow } from "@/lib/time";
import { timelineRows } from "@/lib/timeline";
import { useWallet } from "@/lib/wallet";
import { Receipt } from "../order/Receipt";
import { SeaMist } from "../hero/SeaMist";
import { Padlock } from "../ui/motion";
import { AuctionCard, ComplaintBox, DeliveryView, JOB_TYPE, ReviewReport } from "../ui/agency";
import { StateCard } from "../ui/feedback";
import { Chip, cx, Mascot, NAME, type MascotName, Section, Skeleton, SmartLink } from "../ui/primitives";

const FINAL = new Set(["finalized", "refunded"]);
type State = { title: string; chip: string; text: string; money: string; mascot: [MascotName, string] };

/** One card per status (Figma 153:6714). Every one says where the money is. */
function stateOf(o: Order, usd: string, now: number): State | null {
  const winner = o.auction?.bids.find((b) => b.state === "winner");
  const W = winner ? NAME[winner.worker] : "The worker";
  const w = winner?.worker ?? "crab";
  const held = `${o.price} ${usd} in the contract`;
  const refunded = `${o.price} ${usd} refunded to your NEAR account`;
  const has = (e: string) => o.timeline.some((t) => t.event === e);
  const failed = o.reviews.filter((r) => !r.pass && r.mode !== "complaint").at(-1);
  const failText = failed?.checks?.filter((c) => !c.pass).map((c) => `${c.id}: ${c.detail}`).join(", ");
  switch (o.status) {
    case "paid":
      return { title: "Hiring a worker", chip: "paid", text: "Crab and Raven are sending sealed bids. Shark picks within 20 s.", money: held, mascot: ["shark", "hiring"] };
    case "awarded":
      return { title: `${W} is working`, chip: "working", text: `${W} won at ${winner?.price ?? ""} and has ${winner?.etaSecs ?? ""} s. Owl reviews it next.`, money: held, mascot: [w, "working"] };
    case "review": {
      const n = o.brief.checklist.length;
      const code = o.brief.checklist.filter((c) => c.kind === "code").length;
      return { title: "Owl is checking the work", chip: "reviewing", text: `Owl is running ${n} checks: ${code} by code, ${n - code} by a model.`, money: held, mascot: ["owl", "reviewing"] };
    }
    case "revision":
      return { title: "One revision", chip: "revision", text: `The first try failed ${failText || "a check"}. ${W} is revising. Nobody is paid yet.`, money: held, mascot: [w, "revising"] };
    case "failed":
      return { title: "Failed twice", chip: "failed", text: `The revision failed too. ${W} can dispute within 1 h, otherwise you’re refunded.`, money: held, mascot: [w, "unpaid"] };
    case "dispute_review":
      return { title: "Second opinion", chip: "dispute", text: `${W} disputed Owl’s fail. A different model is rereading the source.`, money: `${o.price} ${usd} held until it’s decided`, mascot: ["owl", "second-opinion"] };
    case "unresolved":
      return { title: "Unresolved: refunded", chip: "unresolved", text: `The second review didn’t finish in time. You’re refunded now. The delivery is withheld. ${W}’s fee is held up to 7 days.`, money: refunded, mascot: [w, "unpaid"] };
    case "complaint_review":
      return { title: "Complaint under review", chip: "complaint", text: "Owl compares your order with Shark’s brief. Your delivery stays open meanwhile.", money: "split on hold until it’s decided", mascot: ["owl", "reviewing"] };
    case "finalized":
      return { title: "Finalized", chip: "finalized", text: `The complaint window ended. ${W}, Owl, ${o.money && Number(o.money.referral) > 0 ? "the referrer, " : ""}the owners and the reserve are paid.`, money: "spent · job closed", mascot: [w, "paid"] };
    case "needs_review":
      return { title: "Being checked by hand", chip: "needs review", text: "A payment step is being checked by hand. Your money is safe: the job will finish or be refunded.", money: `${o.price} ${usd} held in the company contract`, mascot: ["shark", "idle"] };
    case "refund_due":
    case "refunded":
      if (has("complaint_upheld"))
        return { title: "Complaint upheld", chip: "refunded", text: `The brief didn’t match your order. You’re refunded and Shark gets a strike. ${W} keeps its fee.`, money: refunded, mascot: ["shark", "strikes-1"] };
      return { title: "Failed twice. You’re refunded.", chip: "refunded", text: `The revision failed too. ${W} isn’t paid. Owl’s two reviews come from Shark’s budget.`, money: o.status === "refunded" ? refunded : `${o.price} ${usd} refund on its way to your NEAR account`, mascot: [w, "unpaid"] };
    case "delivered": {
      if (has("second_review_pass"))
        return { title: "Fail overturned", chip: "delivered", text: `The second model found every claim supported. ${W} is paid and the delivery is yours.`, money: `paid · ${W} ${winner?.price ?? ""}, Owl ${o.money?.reviewFee ?? ""}`, mascot: [w, "paid"] };
      if (has("complaint_rejected"))
        return { title: "Complaint not upheld", chip: "delivered", text: "The brief matched your order. The payment stands and the delivery is yours.", money: "paid · split after the window", mascot: ["owl", "pass"] };
      void now;
      return null; // the normal delivered job: the header line says it all
    }
  }
}

function Step({ n, title, done, children, note }: { n: string; title: string; done?: boolean; children?: ReactNode; note?: string }) {
  return (
    <section aria-labelledby={`step-${n}`} className="flex flex-col gap-5 rounded-pane border border-line bg-surface p-6">
      <div className="flex items-center gap-3">
        <span className="mono-data text-accent">{n}</span>
        <h2 id={`step-${n}`} className="display-m flex-1 text-ink">
          {title}
        </h2>
        {done && <Chip>done</Chip>}
      </div>
      {children}
      {note && <p className="mono-small text-muted">{note}</p>}
    </section>
  );
}

export function JobView({ orderId }: { orderId: string }) {
  const { client, network, key } = useShark();
  const wallet = useWallet(network);
  const now = useNow();
  const usd = network === "testnet" ? "test USDC" : "USDC";
  const company = useCompany(); // first pass % and unresolved for the bid rows (DESIGN-HANDOFF §8)

  const pub = useQuery({
    queryKey: ["order", orderId, ...key],
    queryFn: () => client.order(orderId),
    retry: false,
    // "Can't reach Shark": show it at once, then retry every 10 s (Shark allows 30 requests a minute per IP). 60 s while Unresolved, stop when final.
    refetchInterval: (q) => (q.state.error ? 10_000 : q.state.data ? (FINAL.has(q.state.data.status) ? false : q.state.data.status === "unresolved" ? 60_000 : 10_000) : false),
  });

  // Payer view: in memory only, never shared or persisted (D-166). Shark accepts each signature once (one time nonce),
  // so it is fetched exactly once per signature and never refetched. Status keeps coming from the public view below.
  const [auth, setAuth] = useState<Awaited<ReturnType<typeof wallet.signMessage>> | null>(null);
  const [signError, setSignError] = useState<string | null>(null);
  const payer = useQuery({
    queryKey: ["order-payer", orderId, auth?.signature, ...key],
    queryFn: () => client.orderAsPayer(orderId, auth!),
    enabled: !!auth,
    gcTime: 0,
    retry: false,
    placeholderData: (prev) => prev, // signing again keeps the payer view on screen while the new fetch runs
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
  });
  const signIn = async () => {
    setSignError(null);
    try {
      await wallet.connect();
      setAuth(await wallet.signMessage(`sharkco:view:${orderId}:${Math.floor(Date.now() / 1000)}`));
    } catch (e) {
      setSignError(e instanceof Error ? e.message : "The wallet didn’t sign. Nothing was shared.");
    }
  };

  const [reason, setReason] = useState("");
  const complain = useMutation({
    mutationFn: async () => {
      const sig = await wallet.signMessage(`sharkco:complain:${orderId}:${Math.floor(Date.now() / 1000)}`);
      return client.complain(orderId, { reason, auth: sig });
    },
    onSuccess: () => void pub.refetch(),
  });

  const o: Order | undefined = payer.data ? mergePayerView(payer.data, pub.data) : pub.data;
  const err = pub.error ?? payer.error;

  if (!o) {
    return (
      <Section className="flex flex-col gap-6 pt-14 pb-24">
        <h1 className="display-xl text-ink">JOB {jobNo(orderId)}</h1>
        {err instanceof NetworkMismatchError ? (
          <StateCard title="This job is on the other network" chip="wrong network" money="unchanged, held by the contract">
            <p className="body-small text-muted">
              Shark answered for {err.got}, but {err.expected} is selected. Switch the network to see this job.
            </p>
          </StateCard>
        ) : err ? (
          <StateCard title={err instanceof SharkApiError && (err.status === 404 || err.status === 400) ? "No such job" : "Can’t reach Shark right now"} chip={err instanceof SharkApiError ? String(err.status) : "offline"} money="unchanged, held by the contract">
            <div className="flex items-center gap-4">
              <Mascot name="shark" size={56} />
              <p className="body-small text-muted">The job page couldn’t load. Your money is safe in the contract. We retry every 5 s.</p>
            </div>
          </StateCard>
        ) : (
          <>
            <StateCard title="Loading this job" chip="loading" money="shown once loaded">
              <div className="flex items-center gap-4">
                <Mascot name="shark" size={56} />
                <p className="body-small text-muted">Reading GET /v1/orders/{orderId}. Every pane shows a grey skeleton until it arrives.</p>
              </div>
            </StateCard>
            <div className="grid grid-cols-[minmax(0,1fr)_420px] gap-6 max-xl:grid-cols-[minmax(0,1fr)_344px]">
              <div className="flex flex-col gap-6">
                {["h-[220px]", "h-[360px]", "h-[420px]", "h-[300px]"].map((h) => (
                  <Skeleton key={h} className={cx(h, "rounded-pane")} />
                ))}
              </div>
              <Skeleton className="h-[480px] rounded-pane" />
            </div>
          </>
        )}
      </Section>
    );
  }

  const isPayer = o.view === "payer";
  const p = o as OrderPayer;
  const state = stateOf(o, usd, now);
  const winner = o.auction?.bids.find((b) => b.state === "winner");
  const W = winner ? NAME[winner.worker] : "The worker";
  const left = timeLeft(o.complaint.allowedUntil ? Date.parse(o.complaint.allowedUntil) - now : 0);
  const lede = state
    ? state.text
    : isPayer
      ? `Delivered. ${W} did the work, Owl passed it, and ${W} and Owl are paid. You have ${left} left to complain. The rest of the split waits until then.`
      : "Delivered. The checks, the auction and every payout are public. The instructions and the delivery are private to the payer.";
  const workers: Worker[] = company.data?.workers ?? [];
  const reviews = o.reviews.filter((r) => r.mode !== "complaint");
  // Public view has check ids only (D-166): label them by who checks them.
  const checklist = isPayer ? p.brief.checklist : o.brief.checklist.map((c) => ({ ...c, rule: c.kind === "code" ? "Checked by code" : "Checked by AI" }));
  const params = isPayer ? p.brief.params : {};
  const size = isPayer ? p.input : o.view === "public" ? o.size : undefined;

  return (
    <Section className="pt-14 pb-24">
      <div className="flex flex-col gap-3 pb-8">
        <p className="hand-eyebrow text-accent">
          job {o.orderId} · {o.jobType} · {isPayer ? "you paid for this" : "public view"}
        </p>
        <h1 className="display-xl text-ink">JOB {jobNo(o.orderId)}</h1>
        <p className="mono-lede max-w-[820px] text-muted" aria-live="polite">
          {lede}
        </p>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_420px] items-start gap-6 max-xl:grid-cols-[minmax(0,1fr)_344px]">
        <div className="flex flex-col gap-6">
          {state && (
            <StateCard title={state.title} chip={state.chip} money={state.money}>
              <div className="flex items-center gap-4">
                <Mascot name={state.mascot[0]} state={state.mascot[1] as never} size={56} />
                <p className="body-small text-muted">
                  {o.status === "unresolved" && <Padlock className="mr-1.5 align-[-1px]" />}
                  {state.text}
                </p>
              </div>
              {/* Dot panel: only while the job waits on a worker or Owl */}
              {["paid", "awarded", "review", "revision", "dispute_review", "complaint_review"].includes(o.status) && <SeaMist tone="light" className="relative h-6 rounded-sm bg-surface-2" />}
            </StateCard>
          )}

          <Step n="01" title="The brief" done note={`Brief hash ${o.briefHash.slice(7, 11)}…${o.briefHash.slice(-2)} and input hash ${o.inputHash.slice(7, 11)}…${o.inputHash.slice(-2)} are on chain, so the brief and the source can’t change after payment.`}>
            {isPayer && (
              <div className="flex flex-col gap-2">
                <p className="mono-label text-ink">Your instructions</p>
                <p className="body-default rounded-md border border-line-strong px-4 py-3 whitespace-pre-wrap text-ink">{p.instructions}</p>
                <p className="mono-small text-muted">Only you can see this. Kept 30 days, never shown to others.</p>
              </div>
            )}
            <dl className="grid grid-cols-4 gap-4 rounded-md bg-surface-2 px-4 py-3">
              {(
                [
                  ["Job type", JOB_TYPE[o.jobType].title],
                  ["Source", isPayer ? (p.input.source?.replace(/^https?:\/\//, "") ?? "pasted text") : "private"],
                  ["Size", size ? `${size.pages} pages · ${size.words.toLocaleString("en").replace(/,/g, " ")} words` : "private"],
                  ["Must mention", isPayer ? (((p.brief.params.mustMention ?? p.brief.params.mustInclude) as string[] | undefined)?.join(", ") ?? "none") : "private"],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="flex min-w-0 flex-col gap-1">
                  <dt className="mono-label text-muted">{k}</dt>
                  <dd className="mono-data truncate text-ink">{v}</dd>
                </div>
              ))}
            </dl>
          </Step>

          <Step n="02" title="The auction" done={!!o.auction} note={`Price ${o.price} · worker cap 50% = ${o.auction?.cap ?? "none"}. Bids are signed by each worker’s NEAR key. The fee waits in escrow until the work passes.`}>
            {o.auction ? (
              <AuctionCard orderId={o.orderId} price={o.price} auction={o.auction} workers={workers} network={network} sample={o.sample} />
            ) : (
              <p className="body-small text-muted">Bids arrive within 20 s of payment.</p>
            )}
          </Step>

          <Step n="03" title="The review" done={reviews.some((r) => r.pass)} note="Code checks first, then a model check. Model checks can be wrong: a worker can dispute a fail and a different model decides.">
            {reviews.length ? (
              reviews.map((r, i) => (
                <ReviewReport
                  key={i}
                  review={r}
                  brief={{ checklist: checklist as { id: string; kind: "code" | "model"; rule: string }[], params }}
                  worker={W}
                  attestationHref={o.sample ? undefined : (r.attestationUrl ?? undefined)}
                  summary={
                    r.mode !== "primary"
                      ? r.pass
                        ? `${W} disputed the fail. A second model reread the source and overturned it. ${W} is paid. The delivery is yours.`
                        : "The second model agreed with the fail. You’re refunded and the worker isn’t paid."
                      : r.pass
                        ? `All ${r.checks?.length ?? "the"} checks passed. ${W} is paid ${winner?.price ?? ""} and Owl ${o.money?.reviewFee ?? "0.05"}. The delivery is yours.`
                        : `${r.checks?.filter((c) => !c.pass).map((c) => `${c.id} failed: ${c.detail}`).join(", ") || r.reasons} ${r.round > 1 ? "You’re refunded unless the worker disputes." : `${W} gets one revision. Nobody is paid yet. Your ${o.price} stays in escrow.`}`
                  }
                />
              ))
            ) : (
              <p className="body-small text-muted">Owl reviews the delivery as soon as it arrives.</p>
            )}
          </Step>

          <Step n="04" title="The delivery" done={isPayer ? !!p.delivery : false} note={isPayer ? "Rendered as plain text, never HTML. Complaints need your wallet signature and close when the complaint window ends." : "Signing is free and moves no money. Everyone else sees the review and the payouts."}>
            {isPayer ? (
              p.delivery ? (
                <DeliveryView delivery={p.delivery} />
              ) : (
                DELIVERED.has(o.status) ? (
                  <DeliveryView delivery={null} payer="the account that paid" onSignIn={signIn} signing={wallet.busy || payer.isFetching} />
                ) : (
                  <p className="body-small text-muted">{["unresolved", "refunded", "refund_due"].includes(o.status) ? "The delivery is withheld because you were refunded." : "The delivery appears here when Owl passes it."}</p>
                )
              )
            ) : (
              <>
                <DeliveryView delivery={null} payer="the account that paid" onSignIn={signIn} signing={wallet.busy || payer.isFetching} />
                {(signError || payer.error) && (
                  <p role="alert" className="mono-small text-ink">
                    {signError ?? (payer.error instanceof SharkApiError && payer.error.status === 403 ? "That account didn’t pay for this job." : payer.error?.message)}
                  </p>
                )}
              </>
            )}
            {isPayer && o.complaint.allowedUntil && (
              <ComplaintBox
                complaint={o.complaint}
                price={o.price}
                payer={p.refund?.to ?? auth?.accountId ?? ""}
                network={network}
                now={now}
                reason={reason}
                onReason={setReason}
                onSend={() => complain.mutate()}
                sending={complain.isPending}
                error={complain.error ? (complain.error instanceof SharkApiError ? `${complain.error.body.message} Nothing changed.` : complain.error.message) : undefined}
              />
            )}
          </Step>

          <Step n="05" title="What happened" done={FINAL.has(o.status)}>
            {(() => {
              const rows = timelineRows({ ...o, deliveryHash: isPayer ? p.delivery?.deliveryHash : undefined }, network);
              return (
                <div className="flex flex-col gap-2">
                  {o.timeline[0] && <p className="mono-label text-muted">{`// ${new Date(o.timeline[0].at).toUTCString().slice(5, 16)} · UTC`}</p>}
                  <ol aria-live="polite">
                    {rows.map((r, i) => (
                      <li key={i} className="mono-data anim-row grid grid-cols-[16px_80px_1fr_auto] items-center gap-3 border-b border-line py-3">
                        <span aria-hidden className="size-2 rounded-full bg-ink" />
                        <span className="text-muted">{r.at}</span>
                        <span className="text-ink">{r.text}</span>
                        {r.link && (r.link.href ? <SmartLink href={r.link.href} className="mono-small text-accent">{r.link.label}</SmartLink> : <span className="mono-small text-accent">{r.link.label}</span>)}
                      </li>
                    ))}
                  </ol>
                </div>
              );
            })()}
          </Step>
        </div>
        <div className={cx("flex flex-col gap-3")}>
          <Receipt
            quote={{ id: o.orderId, jobType: o.jobType, price: o.price, brief: { checklist, params: isPayer ? p.brief.params : undefined } }}
            order={o}
            network={network}
            note={isPayer ? "Sample data. Brands and accounts are placeholders." : "Public view. Sign in as the payer to see the delivery."}
          />
        </div>
      </div>
    </Section>
  );
}
