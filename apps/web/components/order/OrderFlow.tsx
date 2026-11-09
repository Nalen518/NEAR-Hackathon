"use client";
// Order page (Figma Order v2.0 150:3999, states 150:4148), on the v1 Check a call layout:
// numbered step cards on the left, a sticky receipt column on the right.
import { ContractMismatchError, formatUsdc, InfeasibleDetails, NetworkMismatchError, SharkApiError, type Network, type Order, type Quote402 } from "@shark/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { useShark } from "@/lib/api";
import { API_MODE, useHref, useNetwork } from "@/lib/network";
import { useNow } from "@/lib/time";
import { timelineRows } from "@/lib/timeline";
import { useWallet } from "@/lib/wallet";
import { Checklist, JOB_TYPE, txHref } from "../ui/agency";
import { StateCard, SystemBanner, type BannerState } from "../ui/feedback";
import { Button, Chip, cx, Mascot, ProofPill, SmartLink } from "../ui/primitives";
import { canSubmit, EMPTY_FORM, fromParams, OrderForm, toRequest, type FormState } from "./OrderForm";
import { Receipt } from "./Receipt";
import { SeaMist } from "../hero/SeaMist";
import { Coin } from "../ui/motion";
import { NetworkBadge } from "../ui/NetworkSwitch";

type Phase = { kind: "form" } | { kind: "quote"; quote: Quote402 } | { kind: "paying"; quote: Quote402 } | { kind: "awaiting"; quote: Quote402; tx: string };
const BANNER: Partial<Record<string, BannerState>> = { closed: "closed", paused: "paused", caged: "caged", no_worker: "no_worker", out_of_budget: "out_of_budget", rate_limited: "rate_limited", upstream_unavailable: "upstream_down" };
const FINAL = new Set(["finalized", "refunded"]);

function Step({ n, title, done, active, children }: { n: string; title: string; done?: boolean; active?: boolean; children?: ReactNode }) {
  return (
    <section aria-labelledby={`step-${n}`} className={cx("flex flex-col gap-5 rounded-pane border bg-surface p-6", active ? "border-line-strong" : "border-line")}>
      <div className="flex items-center gap-3">
        <span className="mono-data text-accent">{n}</span>
        <h2 id={`step-${n}`} className={cx("display-m flex-1", active || done ? "text-ink" : "text-muted")}>
          {title}
        </h2>
        {done && <Chip>done</Chip>}
      </div>
      {children}
    </section>
  );
}

export function OrderFlow() {
  const { client, network, key } = useShark();
  const { config } = useNetwork();
  const href = useHref();
  const wallet = useWallet(network);
  const now = useNow();
  const usd = "test USDC";

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const set = (p: Partial<FormState>) => setForm((f) => ({ ...f, ...p }));
  const [phase, setPhase] = useState<Phase>({ kind: "form" });
  const [registered, setRegistered] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);

  const upload = useMutation({
    mutationFn: (file: File) => (file.size > 2 * 1024 * 1024 ? Promise.reject(new Error("too_large")) : client.upload(file, file.name).then((r) => ({ ...r, name: file.name }))),
    onSuccess: (r) => set({ upload: r }),
  });
  const order = useMutation({
    mutationFn: (extra: Partial<FormState> = {}) => client.order402(toRequest({ ...form, ...extra }), crypto.randomUUID()),
    onSuccess: (r) => {
      setPayError(null);
      if (r.kind === "quote") setPhase({ kind: "quote", quote: r.quote });
    },
  });
  const options = useQuery({ queryKey: ["payment-options", ...key], queryFn: client.paymentOptions, enabled: phase.kind !== "form" });

  const quote = phase.kind === "form" ? null : phase.quote;
  const quoteStatus = useQuery({
    queryKey: ["quote", quote?.quoteId, ...key],
    queryFn: () => client.quote(quote!.quoteId),
    enabled: phase.kind === "awaiting",
    refetchInterval: (q) => (q.state.data?.status === "AWAITING_PAYMENT" || !q.state.data ? 5000 : false),
  });
  const orderId = quoteStatus.data?.status === "PAID" ? quoteStatus.data.orderId : null;
  const job = useQuery({
    queryKey: ["order", orderId, ...key],
    queryFn: () => client.order(orderId!),
    enabled: !!orderId,
    refetchInterval: (q) => (q.state.data && FINAL.has(q.state.data.status) ? false : 5000),
  });

  // ---- errors → states (prompt §5 table). Every one says nothing was charged.
  const e = order.error ?? upload.error;
  const api = e instanceof SharkApiError ? e : null;
  const field = api?.status === 413 || api?.body.error === "input_unreadable" ? "source" : api?.body.error === "invalid_payer" ? "payer" : api?.status === 400 ? (((api.body.details?.field as string) ?? "form") as "form") : null;
  const formErrors = {
    ...(e?.message === "too_large" ? { source: "That file is over 2 MB." } : {}),
    ...(api && field && api.body.error !== "input_unreadable" ? { [field]: api.body.message } : {}),
  };
  const banner = api ? BANNER[api.body.error] : undefined;

  const secsLeft = quote ? Math.max(0, Math.round((Date.parse(quote.expiresAt) - now) / 1000)) : 0;
  const returned = quoteStatus.data?.status === "RETURNED" || quoteStatus.data?.status === "EXPIRED";

  async function pay(q: Quote402) {
    setPayError(null);
    // N3: never sign a payment for another network or another contract.
    if (q.pay.network !== `near:${network}`) return setPayError(`Your quote is for ${q.pay.network}, not ${network}. Nothing was sent.`);
    if (API_MODE === "live" && (!config.contract || !config.usdc)) return setPayError("This deployment's contract and token aren't configured, so the payment can't be checked. Nothing was sent.");
    if (config.contract && q.pay.args.receiver_id !== config.contract) return setPayError("The quote pays a contract this app doesn't know. Nothing was sent.");
    if (config.usdc && q.pay.token !== config.usdc) return setPayError("The quote asks for a token this app doesn't know. Nothing was sent.");
    try {
      const account = wallet.accountId ?? (await wallet.connect());
      if (account !== q.quote.payer) return setPayError(`Your wallet is ${account}, but this quote is for ${q.quote.payer}. Change the account and get a new quote.`);
      setPhase({ kind: "paying", quote: q });
      const tx = await wallet.call({ contract: q.pay.token, method: q.pay.method, args: q.pay.args, gas: q.pay.gas, deposit: q.pay.deposit });
      setPhase({ kind: "awaiting", quote: q, tx });
    } catch (err) {
      setPhase({ kind: "quote", quote: q });
      setPayError(err instanceof Error ? err.message : "The wallet didn't send the payment. Nothing was charged.");
    }
  }
  async function register(q: Quote402) {
    if (!q.register) return;
    try {
      await wallet.connect();
      await wallet.call({ contract: q.register.contract, method: q.register.method, args: q.register.args, gas: q.register.gas, deposit: q.register.deposit });
      setRegistered(true);
    } catch (err) {
      setPayError(err instanceof Error ? err.message : "Registration didn't go through.");
    }
  }
  const restart = () => {
    order.reset();
    setPhase({ kind: "form" });
    setRegistered(false);
    setPayError(null);
  };

  const step1Done = phase.kind !== "form";
  const paid = !!orderId;
  const faucet = options.data?.options.find((o) => o.method === "quote");

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_420px] items-start gap-6 max-xl:grid-cols-[minmax(0,1fr)_344px]">
      <div className="flex flex-col gap-6">
        {banner && <SystemBanner state={banner} retryAfter={api?.retryAfter} />}
        {e instanceof NetworkMismatchError && (
          <p role="alert" className="mono-small rounded-md border border-ink bg-surface-2 px-4 py-3 text-ink">
            Shark answered for {e.got}, but {e.expected} is selected. Nothing was charged and nothing can be paid until they match.
          </p>
        )}
        {e instanceof ContractMismatchError && (
          <p role="alert" className="mono-small rounded-md border border-ink bg-surface-2 px-4 py-3 text-ink">
            Shark answered in a shape this page doesn’t understand. Nothing was charged. {e.message}
          </p>
        )}

        <Step n="01" title="The order" done={step1Done} active={!step1Done}>
          {step1Done && quote ? (
            <>
              <div className="flex flex-col gap-2">
                <p className="mono-label text-ink">Instructions</p>
                <p className="body-default rounded-md border border-line-strong px-4 py-3 whitespace-pre-wrap text-ink">{form.instructions}</p>
                <p className="mono-small text-muted">Plain words, up to 2 000 characters. Add a link, a file or pasted text.</p>
              </div>
              <dl className="grid grid-cols-4 gap-4 rounded-md bg-surface-2 px-4 py-3">
                {(
                  [
                    ["Job type", JOB_TYPE[quote.jobType].title],
                    ["Source", quote.input.source?.replace(/^https?:\/\//, "") ?? (form.upload?.name || "pasted text")],
                    ["Size", `${quote.input.pages} pages · ${quote.input.words.toLocaleString("en").replace(/,/g, " ")} words`],
                    ["Must mention", ((quote.brief.params.mustMention ?? quote.brief.params.mustInclude) as string[] | undefined)?.join(", ") || "none"],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k} className="flex min-w-0 flex-col gap-1">
                    <dt className="mono-label text-muted">{k}</dt>
                    <dd className="mono-data truncate text-ink">{v}</dd>
                  </div>
                ))}
              </dl>
              <p className="mono-small text-muted">Shark saves one snapshot of the source and everyone works from it. Wrong job type? Change it before paying.</p>
            </>
          ) : (
            <>
              {order.isPending ? (
                <StateCard title="Shark is writing your brief" chip="quoting" money="not charged yet">
                  <div className="flex items-center gap-4">
                    <Mascot name="shark" state="briefing" size={60} />
                    <p className="body-small text-muted">Reading the source, writing the checks and pricing the job. This takes about 10 s.</p>
                  </div>
                </StateCard>
              ) : (
                <ErrorState api={api} form={form} onFix={(p) => { set(p); order.mutate(p); }} onEdit={() => order.reset()} />
              )}
              {!order.isPending && (!api || field || banner) && (
                <OrderForm form={form} set={set} onSubmit={() => order.mutate({})} onUpload={(f) => upload.mutate(f)} uploading={upload.isPending} errors={formErrors} busy={order.isPending || !canSubmit(form)} />
              )}
            </>
          )}
        </Step>

        <Step n="02" title="The brief and the price" done={paid} active={!!quote && !paid}>
          {quote && <QuoteSummary quote={quote} usd={usd} secsLeft={secsLeft} paid={paid} />}
          {quote && !paid && (
            <div className="flex flex-wrap gap-3">
              {secsLeft <= 0 ? (
                <Button arrow={false} onClick={() => order.mutate({})}>
                  Get a new quote
                </Button>
              ) : (
                <Button variant="ghost" arrow={false} onClick={restart}>
                  Change the order
                </Button>
              )}
            </div>
          )}
        </Step>

        <Step n="03" title="Pay" done={paid} active={!!quote && !paid && secsLeft > 0}>
          {quote && !returned && (
            <div className="grid gap-5">
              <div className="flex flex-col gap-4 rounded-md border border-ink bg-surface-2 p-5">
                <p className="mono-label flex items-center gap-3 text-muted">
                  <NetworkBadge />
                  {"// test network · no real money"}
                </p>
                <h3 className="display-s text-ink">
                  Pay {quote.price} {usd} with your NEAR wallet
                </h3>
                <p className="body-small text-muted">Your wallet sends the quote Shark signed straight to the company contract. The contract checks it and starts the job. Refunds go back to your NEAR account.</p>
                <p className="mono-data text-ink">
                  paying from {quote.quote.payer} · refunds go here
                </p>
                {!quote.payerRegistered && !registered && quote.register && (
                  <div className="flex items-center gap-4 rounded-md border border-line bg-surface px-4 py-3">
                    <div className="flex flex-1 flex-col gap-1">
                      <p className="mono-data text-ink">Register your wallet for USDC: 0.00125 NEAR, one time</p>
                      <p className="mono-small text-muted">Shown only if your wallet isn’t registered on the USDC token yet. Needed once, so the payment and any refund can reach you.</p>
                    </div>
                    <Button variant="ghost" arrow={false} onClick={() => register(quote)} disabled={wallet.busy}>
                      Register
                    </Button>
                  </div>
                )}
                {payError && (
                  <p role="alert" className="mono-small text-ink">
                    {payError}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-3">
                  <Button arrow={false} disabled={paid || phase.kind !== "quote" || secsLeft <= 0 || (!quote.payerRegistered && !registered)} onClick={() => pay(quote)}>
                    {phase.kind === "paying" ? "Waiting for your wallet" : phase.kind === "awaiting" ? "Payment sent" : `Pay ${quote.price} ${usd}`}
                  </Button>
                  {((faucet && "faucet" in faucet && faucet.faucet?.url) || config.faucet) && (
                    <Button variant="ghost" href={(faucet && "faucet" in faucet && faucet.faucet?.url) || config.faucet}>
                      Get test USDC
                    </Button>
                  )}
                </div>
                <p className="mono-small text-muted">Test USDC has no real value. Get it free from the faucet.</p>
              </div>
            </div>
          )}
          {quote && returned && (
            <StateCard title="Payment returned" chip={quoteStatus.data?.status === "EXPIRED" ? "expired" : "returned"} money={quoteStatus.data?.status === "EXPIRED" ? "nothing was charged" : `${quote.price} ${usd} sent back to your NEAR account`}>
              <p className="body-small text-muted">
                Your payment was sent back: the quote expired or was already used, the amount was wrong, it came from a different account than the quoted payer, or the company stopped taking jobs. Nothing was charged.
              </p>
              {quoteStatus.data?.paymentTx && (
                <span className="flex items-center gap-3">
                  {/* Payment returned: a coin slides back toward the wallet, then the proof pill pops */}
                  <Coin className="anim-coinback" />
                  <span className="anim-pillpop" style={{ animationDelay: "320ms" }}>
                    <ProofPill kind="refund" href={txHref(network, quoteStatus.data.paymentTx, true)}>{`Payment returned · tx ${quoteStatus.data.paymentTx.slice(0, 6)}`}</ProofPill>
                  </span>
                </span>
              )}
              <Button arrow={false} className="w-fit" onClick={() => order.mutate({})}>
                Get a new quote
              </Button>
            </StateCard>
          )}
          {phase.kind === "awaiting" && !paid && !returned && (
            <StateCard title="Waiting for your payment" chip={`${Math.floor(secsLeft / 60)}:${String(secsLeft % 60).padStart(2, "0")} left`} money="not charged yet">
              <p className="body-small text-muted">Your wallet sent it. Shark is waiting for the contract to confirm. If the quote expires first, the contract sends your payment straight back.</p>
              <SeaMist tone="light" className="relative h-6 rounded-sm bg-surface-2" />
            </StateCard>
          )}
          <p className="mono-small text-muted">Paid on NEAR straight into the company contract, never to Shark. A wrong amount or an expired quote is sent back at once.</p>
        </Step>

        <Step n="04" title="What happened" done={!!job.data && FINAL.has(job.data.status)} active={paid}>
          {job.data && <WhatHappened order={job.data} network={network} />}
          {paid && (
            <Link href={href(`/jobs/${orderId}`)} className="mono-button w-fit rounded-pill border-[1.5px] border-ink px-6 py-[15px] text-ink hover:bg-surface-2">
              Open the job page ↗
            </Link>
          )}
        </Step>
      </div>

      <Receipt quote={quote && { id: quote.quoteId, jobType: quote.jobType, price: quote.price, brief: quote.brief }} order={job.data ?? null} network={network} onRestart={restart} />
    </div>
  );
}

/** Order step 02 (Figma 150:4046): price, the one size limit, the countdown, then the checklist and Shark's reason. */
function QuoteSummary({ quote, usd, secsLeft, paid }: { quote: Quote402; usd: string; secsLeft: number; paid: boolean }) {
  const p = quote.brief.params as Record<string, unknown>;
  const limit: [string, string] | null = p.maxWords ? ["max words", String(p.maxWords)] : p.posts ? ["posts", String(p.posts)] : p.maxRecords ? ["max records", String(p.maxRecords)] : null;
  const expired = secsLeft <= 0 && !paid;
  const left = `${Math.floor(secsLeft / 60)}:${String(secsLeft % 60).padStart(2, "0")}`;
  const reason = quote.priceReason.replace(/\.$/, ""); // we add the full stop ourselves
  return (
    <>
      <div className="flex items-end gap-10">
        <div className="flex flex-col gap-1">
          <p className="mono-label text-muted">price · {usd}</p>
          <p className={cx("figure-l", expired ? "text-muted" : "text-ink")}>{quote.price}</p>
        </div>
        {limit && (
          <div className="flex flex-col gap-1">
            <p className="mono-label text-muted">{limit[0]}</p>
            <p className="figure-m text-ink">{limit[1]}</p>
          </div>
        )}
        <div className="flex flex-col gap-1">
          <p className="mono-label text-muted">quote expires</p>
          <p className="figure-m text-ink" aria-live="polite">
            {paid ? "paid" : expired ? "expired" : `in ${left}`}
          </p>
        </div>
      </div>
      <Checklist items={quote.brief.checklist} params={quote.brief.params} codeTitle="Shark’s brief · checked by code" />
      <p className="mono-small text-muted">
        Shark’s reason: “{reason}.” Inside the owners’ band {quote.band.min} to {quote.band.max} {usd}. Signed, expires in 10 min. If it fails the check: one revision, then your money back.
      </p>
    </>
  );
}

function WhatHappened({ order, network }: { order: Order; network: Network }) {
  const rows = timelineRows({ ...order, deliveryHash: order.view === "payer" ? order.delivery?.deliveryHash : undefined }, network);
  const day = order.timeline[0]?.at;
  return (
    <div className="flex flex-col gap-2">
      {day && <p className="mono-label text-muted">{`// ${new Date(day).toUTCString().slice(5, 16)} · UTC`}</p>}
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
}

function ErrorState({ api, form, onFix, onEdit }: { api: SharkApiError | null; form: FormState; onFix: (p: Partial<FormState>) => void; onEdit: () => void }) {
  const { network } = useNetwork();
  if (!api || api.status !== 422 || api.body.error === "input_unreadable") {
    if (api?.body.error === "input_unreadable")
      return (
        <StateCard title="Shark couldn’t read the source" chip="unreadable" money="not charged">
          <p className="body-small text-muted">{api.body.message} Try another link, upload the file or paste the text.</p>
        </StateCard>
      );
    return null;
  }
  if (api.body.error === "job_refused")
    return (
      <StateCard title="We can’t take this job" chip="refused" money="not charged">
        <p className="body-small text-muted">It asks for something harmful or illegal, like collecting people’s personal data or pretending to be someone.</p>
      </StateCard>
    );
  if (api.body.error === "brief_infeasible") {
    // Shark sends its fixes with the new price of each (API §0.2, gap G21). Without them (an older Shark), we offer
    // the fixes the SRD feasibility rule implies, without a price.
    const fixes = InfeasibleDetails.safeParse(api.body.details).data?.fixes ?? [];
    const n = form.mustMention.length;
    return (
      <StateCard title="Can’t be done as asked" chip="infeasible" money="not charged yet">
        <p className="body-small text-muted">{api.body.message} Pick a fix: Shark requotes.</p>
        <ul className="flex flex-col">
          {fixes.map((f) => (
            <li key={f.label} className="border-b border-line">
              <button className="mono-data flex w-full justify-between gap-4 py-3 text-left text-ink hover:text-accent" onClick={() => onFix(fromParams(f.params))}>
                <span>{f.label}</span>
                <span className="text-muted">{formatUsdc(f.price, { network })}</span>
              </button>
            </li>
          ))}
          {!fixes.length && form.jobType === "summary" && n > 0 && (
            <li className="border-b border-line">
              <button className="mono-data flex w-full justify-between py-3 text-left text-ink hover:text-accent" onClick={() => onFix({ maxWords: String(Math.min(500, Math.max(10 * n, Number(form.maxWords) * 2 || 300))) })}>
                Raise the limit to {Math.min(500, Math.max(10 * n, Number(form.maxWords) * 2 || 300))} words
              </button>
            </li>
          )}
          {!fixes.length && form.jobType === "summary" && n > 1 && (
            <li className="border-b border-line">
              <button className="mono-data flex w-full justify-between py-3 text-left text-ink hover:text-accent" onClick={() => onFix({ mustMention: form.mustMention.slice(0, Math.ceil(n / 2)) })}>
                Keep {Math.ceil(n / 2)} required points
              </button>
            </li>
          )}
          <li className="border-b border-line">
            <button className="mono-data flex w-full justify-between py-3 text-left text-ink hover:text-accent" onClick={onEdit}>
              Edit the order myself
            </button>
          </li>
        </ul>
      </StateCard>
    );
  }
  return (
    <StateCard title="Can’t be done as asked" chip={api.body.error.replace(/_/g, " ")} money="not charged">
      <p className="body-small text-muted">{api.body.message}</p>
    </StateCard>
  );
}

