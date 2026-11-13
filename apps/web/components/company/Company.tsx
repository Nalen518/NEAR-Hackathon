"use client";
// The company v2.0 (Figma 154:3972, 154:4587 system states), from GET /v1/company
// (v2.2 + the v2.3 proposal). Every pane says LIVE or SAMPLE from its own `sample` flag.
import {
  addUsdc,
  Company as CompanySchema,
  fromBase,
  toBase,
  type Company,
  type CompanySection,
  type JobType,
  type Network,
} from "@shark/shared";
import sampleCompany from "@shark/shared/fixtures/company.json";
import type { ReactNode } from "react";
import { isSample, useCompany } from "@/lib/api";
import { NETWORKS, useNetwork } from "@/lib/network";
import {
  AuctionCard,
  JOB_TYPE,
  ReviewerCard,
  txHref,
  WorkerCard,
} from "../ui/agency";
import { bandPct, StatTile } from "../ui/data";
import { SystemBanner, type BannerState } from "../ui/feedback";
import { Padlock, Play, Tick } from "../ui/motion";
import {
  Button,
  Chip,
  cx,
  LiveUnavailable,
  Mascot,
  NAME,
  ProofPill,
  Skeleton,
  SmartLink,
} from "../ui/primitives";

const fallback = CompanySchema.parse(sampleCompany);
const sub = (a: string, b: string) => fromBase(toBase(a) - toBase(b));
const day = (iso: string) =>
  new Date(iso).toUTCString().slice(5, 11).replace(/^0/, "");
const time = (iso: string) => iso.slice(11, 16);
const bps = (n: number) => `${n.toLocaleString("en")} bps`;
const short = (h: string) => `${h.slice(0, 3)}…${h.slice(-2)}`;

/** DataSource (Figma components board): LIVE from the contract, or SAMPLE. */
export function DataSource({ live }: { live: boolean }) {
  return live ? (
    <span className="mono-chip inline-flex w-fit items-center gap-1.5 rounded-pill bg-ink px-3 py-1 text-surface">
      <span aria-hidden className="size-1.5 rounded-full bg-accent" />
      live · from the contract
    </span>
  ) : (
    <span className="mono-chip inline-flex w-fit rounded-pill border border-line-strong px-3 py-1 text-muted">
      sample
    </span>
  );
}

function Pane({
  live,
  eyebrow,
  title,
  lede,
  children,
  className,
}: {
  live: boolean;
  eyebrow: string;
  title: string;
  lede: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cx(
        "flex flex-col gap-5 rounded-pane border border-line bg-surface p-7",
        className,
      )}
    >
      <DataSource live={live} />
      <div className="flex flex-col gap-2">
        <p className="mono-label text-muted">{eyebrow}</p>
        <h2 className="display-m text-ink">{title}</h2>
        <p className="body-default text-muted">{lede}</p>
      </div>
      {children}
    </section>
  );
}

const INCIDENT_LABEL: Record<Company["incidents"][number]["kind"], string> = {
  complaint_upheld: "complaint upheld",
  complaint_rejected: "complaint rejected",
  dispute: "dispute",
  dispute_won: "dispute won",
  late: "late",
  brief_invalid: "brief invalid",
  strike: "strike",
  worker_suspended: "worker suspended",
  payout_failed: "payout failed",
};

type RavenGas = Company["reserve"]["ravenPayoutGas"];
/** Shark has no Base address or RPC for Raven yet: balance "0" and no count would read like an empty tank. */
const gasUnset = (g: RavenGas) => g.payoutsLeft === null && Number(g.balanceEth) === 0;

function KV({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="flex flex-col">
      {rows.map(([k, v]) => (
        <div
          key={k}
          className="mono-data flex justify-between gap-4 border-b border-line py-2.5"
        >
          <dt className="text-muted">{k}</dt>
          <dd className="text-right text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function CompanyMeta() {
  const { network } = useNetwork();
  const { data } = useCompany();
  const c = data ?? fallback;
  const usd = network === "testnet" ? "test USDC" : "USDC";
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="mono-chip rounded-pill border border-line-strong px-3 py-1 text-muted">
        live or sample · labelled per widget
      </span>
      <Chip tone="solid">
        {c.state === "ok"
          ? `Shark quoting · wallet ${c.reserve.sharkWallet} ${usd}`
          : `Shark ${c.state.replace(/_/g, " ")}`}
      </Chip>
    </div>
  );
}

export function CompanyDashboard() {
  const { network } = useNetwork();
  const { data, isPending, isError } = useCompany();
  const c: Company = data ?? fallback;
  const live = (s: CompanySection) =>
    !isError && !!data && !isSample(data.sample, s);
  const usd = network === "testnet" ? "test USDC" : "USDC";

  if (isPending)
    return (
      <div className="flex flex-col gap-6">
        {["h-[260px]", "h-[620px]", "h-[720px]"].map((h) => (
          <Skeleton key={h} className={cx(h, "rounded-pane")} />
        ))}
      </div>
    );

  const p = c.pnl7d;
  const owners = addUsdc(p.ownersPaid, p.ownersAccrued);
  const reserveShare = sub(p.profit, owners);
  const banner: BannerState | null = c.state === "ok" ? null : c.state;
  return (
    <div className="flex flex-col gap-6">
      {banner && <SystemBanner state={banner} />}
      <LiveUnavailable show={isError} />

      {/* P&L */}
      <section className="flex flex-col gap-4">
        <DataSource live={live("pnl7d")} />
        <p className="mono-label text-muted">{"// "}p&amp;l · last 7 days</p>
        <div className="grid grid-cols-6 gap-4 max-xl:grid-cols-3">
          <StatTile
            label={`revenue · ${usd}`}
            value={<Tick value={p.revenue} />}
          />
          <StatTile
            label={`workers + reviews · ${usd}`}
            value={<Tick value={addUsdc(p.workers, p.reviews)} />}
          />
          <StatTile
            label={`referral payouts · ${usd}`}
            value={<Tick value={p.referrals} />}
          />
          <StatTile
            label={`owners' share · ${usd}`}
            value={<Tick value={owners} />}
          />
          <StatTile
            label={`reserve · ${usd}`}
            value={<Tick value={reserveShare} />}
          />
          <StatTile
            label="strikes"
            value={`${c.strikes.count} of ${c.strikes.threshold}`}
          />
        </div>
        <p className="mono-small text-muted">
          {p.revenue} in − {p.workers} workers − {p.reviews} reviews −{" "}
          {p.referrals} referrals = {p.profit} profit →{" "}
          {c.config.ownerBps / 100}% owners’ share {owners} ({p.ownersPaid} paid
          to the Trezu DAO, {p.ownersAccrued} accrued) and{" "}
          {100 - c.config.ownerBps / 100}% reserve {reserveShare}.
        </p>
        <p className="mono-small text-muted">
          Not in these numbers: inference (NEAR AI) is billed off chain by API
          key.
        </p>
      </section>

      <div className="grid grid-cols-[800fr_472fr] items-start gap-6 max-xl:grid-cols-1">
        <PricePane c={c} live={live("prices")} usd={usd} />
        <Pane
          live={live("config")}
          eyebrow="// owner limits in force"
          title="The rules Shark can’t change"
          lede="Set by the owners’ Trezu DAO, one proposal at a time. Shark acts inside them. The contract enforces them. New settings apply to new jobs only."
        >
          <KV
            rows={[
              [
                "price bands",
                (["extract", "summary", "thread"] as JobType[])
                  .map(
                    (t) =>
                      `${c.config.bands[t].min} to ${c.config.bands[t].max}`,
                  )
                  .join(" · "),
              ],
              ["quote lifetime", `${c.config.quoteTtlSecs / 60} min`],
              ["worker cap", `${c.config.workerCapBps / 100}% of job price`],
              ["review fee", `${c.config.reviewFee} per review`],
              [
                "referral cut",
                `${bps(c.config.referralBps)} (${c.config.referralBps / 100}%)`,
              ],
              ["owner share", `${bps(c.config.ownerBps)} of profit`],
              ["Shark daily budget", `${c.config.dailyBudget} ${usd}`],
              ["reserve floor", `${c.config.reserveFloor} ${usd}`],
              [
                "Shark strikes → cage",
                `${c.config.strikeThreshold} · complaints and invalid briefs`,
              ],
              [
                "worker suspend at",
                `${c.config.suspendThreshold} fails in last ${c.config.suspendWindowJobs} jobs`,
              ],
              [
                "unresolved timeout",
                `${c.config.unresolvedTimeoutSecs / 86400} days`,
              ],
              [
                "unresolved per worker",
                `max ${c.config.maxUnresolvedOpen} open`,
              ],
              ["complaint window", `${c.config.complaintWindowSecs / 3600} h`],
            ]}
          />
          {c.config.changedAt && (
            <p className="mono-small text-muted">
              last changed {day(c.config.changedAt)}
              {c.config.changedByProposal
                ? ` by DAO proposal #${c.config.changedByProposal}`
                : ""}
              {c.config.changeTx && (
                <>
                  {" · "}
                  <TxLink
                    network={network}
                    tx={c.config.changeTx}
                    sample={!live("config")}
                  />
                </>
              )}
            </p>
          )}
        </Pane>
      </div>

      <Pane
        live={live("auctions")}
        eyebrow="// auctions"
        title="Every job goes to the worker Shark picks"
        lede="Crab and Raven bid. Bids above the worker cap are rejected by the contract. Shark writes down why it picked the winner."
      >
        <p className="mono-small text-muted">All amounts in {usd}.</p>
        <div className="grid grid-cols-[1fr_440px] items-start gap-6 max-xl:grid-cols-1">
          <div className="flex flex-col gap-3">
            <p className="mono-label text-muted">{"// "}latest</p>
            {c.auctions[0] ? (
              <AuctionCard
                orderId={c.auctions[0].orderId}
                price={c.auctions[0].price}
                auction={c.auctions[0]}
                workers={c.workers}
                network={network}
                sample={!live("auctions")}
              />
            ) : (
              <p className="body-small text-muted">No auctions yet.</p>
            )}
          </div>
          <div className="flex flex-col gap-3 rounded-md bg-surface-2 px-5 py-4">
            <p className="mono-label text-muted">{"// "}how Shark picks</p>
            <ol className="flex flex-col gap-3">
              {[
                `The contract rejects any bid above the worker cap (${c.config.workerCapBps / 100}% of the job price) or below the worker’s min fee.`,
                `Suspended workers, and workers with ${c.config.maxUnresolvedOpen} unresolved jobs, can’t win an auction.`,
                "Shark weighs price, ETA, first pass rate and final fails, and must say why it picked the winner.",
                "The reason goes on chain with the pick. Anyone can read it here.",
                "A worker can dispute a final fail. A different model decides. If that can’t finish in time, the customer is refunded and the fee is held.",
              ].map((t, i) => (
                <li key={i} className="flex gap-3">
                  <span className="mono-data text-accent">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="body-small text-ink">{t}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
        <p className="mono-label text-muted">{"// "}log</p>
        <ul>
          {c.auctions.map((a) => {
            const bid = (w: "crab" | "raven") => {
              const b = a.bids.find((x) => x.worker === w);
              return b
                ? b.state === "busy"
                  ? `${w} busy`
                  : b.state === "invalid"
                    ? `${w} ${b.price} · over cap`
                    : `${w} ${b.price} · ${b.etaSecs} s`
                : `${w} none`;
            };
            return (
              <li
                key={a.orderId}
                className="mono-data grid grid-cols-[90px_60px_90px_150px_150px_120px_1fr_110px] items-center gap-3 border-t border-line py-2.5 max-xl:grid-cols-[90px_60px_1fr_110px]"
              >
                <span className="text-ink">{a.orderId}</span>
                <span className="text-ink">{a.price}</span>
                <span className="text-muted max-xl:hidden">cap {a.cap}</span>
                <span className="text-muted max-xl:hidden">{bid("crab")}</span>
                <span className="text-muted max-xl:hidden">{bid("raven")}</span>
                <span className="flex items-center gap-2 text-ink max-xl:hidden">
                  {a.winner && <Mascot name={a.winner} size={24} />}
                  {a.winner ? NAME[a.winner] : "none"}
                </span>
                <span className="body-small text-ink">“{a.reason}”</span>
                <span className="text-right text-muted">
                  {a.outcome.replace(/_/g, " ")}
                </span>
              </li>
            );
          })}
        </ul>
      </Pane>

      <div className="grid grid-cols-[860fr_412fr] gap-6 max-xl:grid-cols-1">
        <Pane
          live={live("workers")}
          eyebrow="// workers and reviewer"
          title="Two workers, one reviewer"
          lede={`Crab and Raven are paid on NEAR. Owl reviews every job: code checks, then a model. Next: Raven paid on ${NETWORKS[network].baseChain} through Chain Signatures, and Owl inside an OutLayer TEE.`}
        >
          <div className="grid grid-cols-2 gap-4 max-[1360px]:grid-cols-1">
            {c.workers.map((w) => (
              <WorkerCard
                key={w.id}
                worker={w}
                network={network}
                note={
                  w.id === "crab"
                    ? "Fast and cheap. Wins most summaries."
                    : "Faster, pricier. Paid on NEAR today. Payouts on Base via Chain Signatures come next."
                }
              />
            ))}
            <ReviewerCard reviewer={c.reviewer} />
          </div>
        </Pane>
        <Pane
          live={live("strikes")}
          eyebrow="// strikes"
          title={`Shark is on ${c.strikes.count} strike${c.strikes.count === 1 ? "" : "s"}`}
          lede="A strike is Shark’s own mistake: an upheld complaint or an invalid brief. 3 strikes and Shark goes in the cage: no new orders until the owners let it out."
        >
          <Play>
            <ol
              className="grid grid-cols-4 gap-2"
              aria-label={`${c.strikes.count} of ${c.strikes.threshold} strikes`}
            >
              {(["idle", "strikes-1", "strikes-2", "caged"] as const).map(
                (s, i) => {
                  const now = Math.min(c.strikes.count, 3) === i;
                  return (
                    <li
                      key={s}
                      className="flex flex-col items-center gap-2"
                      aria-current={now ? "step" : undefined}
                    >
                      <Mascot
                        name="shark"
                        state={s}
                        size={64}
                        className={cx(
                          now ? "ring-2 ring-ink" : "opacity-40",
                          i > 0 &&
                            i <= Math.min(c.strikes.count, 3) &&
                            "anim-cage",
                        )}
                        style={{ animationDelay: `${(i - 1) * 420}ms` }}
                      />
                      <span
                        className={cx(
                          "mono-label",
                          now ? "text-ink" : "text-muted",
                        )}
                      >
                        {i === 3 ? "3 · caged" : now ? `${i} · now` : i}
                      </span>
                    </li>
                  );
                },
              )}
            </ol>
          </Play>
          <div className="h-1.5 rounded-pill bg-surface-2" aria-hidden>
            <div
              className="h-full rounded-pill bg-ink"
              style={{
                width: `${(Math.min(c.strikes.count, c.strikes.threshold) / c.strikes.threshold) * 100}%`,
              }}
            />
          </div>
          <div className="flex flex-col gap-3">
            <DataSource live={live("incidents")} />
            <p className="mono-label text-muted">
              {"// "}complaints, disputes and failures
            </p>
            {c.incidents.length ? (
              <ul className="flex flex-col gap-3">
                {c.incidents.map((x, i) => (
                  <li
                    key={i}
                    className="flex flex-col gap-1 border-b border-line pb-3"
                  >
                    <span className="mono-data text-ink">
                      {x.orderId ?? "company"} · {INCIDENT_LABEL[x.kind]}
                    </span>
                    <span className="mono-small text-muted">
                      {x.text}
                      {x.strike ? " Strike for Shark." : ""}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="body-small text-muted">none</p>
            )}
          </div>
        </Pane>
      </div>

      <div className="grid grid-cols-[752fr_520fr] gap-6 max-xl:grid-cols-1">
        <ReservePane c={c} live={live("reserve")} usd={usd} network={network} />
        <Pane
          live={live("owners")}
          eyebrow="// owners & guardian"
          title="Humans set the rules in Trezu"
          lede="Owners don’t sell or click anything here. Every sale is automatic. They change settings by DAO proposal in Trezu and receive the profit."
        >
          <KV
            rows={[
              ["owners", c.owners.dao],
              ["approval", `${c.owners.approvalRule} member`],
              ["guardian", `${c.guardian.account} · ${c.guardian.power}`],
              ["state", c.state],
              [
                "owner share waiting",
                `${c.owners.ownersWaiting} ${usd} · pay_owners()`,
              ],
            ]}
          />
          <p className="mono-label text-muted">{"// "}proposals</p>
          <ul className="flex flex-col">
            {c.owners.proposals.map((pr) => (
              <li
                key={pr.id}
                className="mono-data flex items-center gap-3 border-b border-line py-2.5"
              >
                <span className="text-muted">#{pr.id}</span>
                <span className="flex-1 text-ink">{pr.title}</span>
                <Chip tone={pr.status === "open" ? "outline" : "solid"}>
                  {pr.status === "open"
                    ? `${pr.votes} · open`
                    : `${pr.status} ${day(pr.at)}`}
                </Chip>
              </li>
            ))}
          </ul>
          <Button variant="ghost" href={c.owners.trezuUrl} className="w-fit">
            Open in Trezu
          </Button>
        </Pane>
      </div>

      <PayoutsPane
        c={c}
        live={live("payouts")}
        usd={usd}
        network={network}
        owners={owners}
        reserveShare={reserveShare}
      />
    </div>
  );
}

function TxLink({
  network,
  tx,
  sample,
  chain = "near",
}: {
  network: Network;
  tx: string;
  sample: boolean;
  chain?: "near" | "base";
}) {
  const href = sample
    ? undefined
    : chain === "base"
      ? `${NETWORKS[network].baseTx}${tx}`
      : txHref(network, tx, false);
  return href ? (
    <SmartLink href={href} className="text-accent">
      tx {short(tx)} ↗
    </SmartLink>
  ) : (
    <span className="text-accent">tx {short(tx)}</span>
  );
}

function PricePane({
  c,
  live,
  usd,
}: {
  c: Company;
  live: boolean;
  usd: string;
}) {
  const last =
    c.prices.recentQuotes.find((q) => q.status !== "returned") ??
    c.prices.recentQuotes[0];
  const t = last?.jobType ?? "summary";
  const band = c.prices.types[t];
  const crabMin = c.workers
    .map((w) => w.minFee[t])
    .sort((a, b) => Number(toBase(a) - toBase(b)))[0];
  return (
    <Pane
      live={live}
      eyebrow="// price"
      title="Shark prices every job"
      lede="Each job is quoted inside its type’s band, with a reason. The contract checks the signed quote and rejects anything outside the band or under the floor."
    >
      {last && (
        <div className="flex flex-col gap-4 rounded-md border border-line px-5 py-4">
          <p className="mono-label flex justify-between text-muted">
            <span>
              {"// "}last quote · {t} · {day(last.at)} {time(last.at)}
            </span>
            <span className="text-muted">owners’ band</span>
          </p>
          <p className="figure-l text-ink">
            {last.price} <span className="mono-data text-muted">{usd}</span>
          </p>
          <div
            className="relative h-11"
            role="img"
            aria-label={`Last quote ${last.price} inside the band ${band.band.min} to ${band.band.max}`}
          >
            <div className="absolute inset-x-0 top-[18px] h-2 rounded-sm border border-line-strong bg-surface-2" />
            <div className="absolute left-0 top-3 h-5 w-0.5 bg-ink" />
            <div className="absolute right-0 top-3 h-5 w-0.5 bg-ink" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/price-marker.svg"
              alt=""
              width={14}
              height={30}
              className="absolute top-0.5 -translate-x-1/2 transition-[left] duration-600 ease-out"
              style={{
                left: `${bandPct(band.band.min, band.band.max, last.price)}%`,
              }}
            />
          </div>
          <div className="mono-label flex justify-between text-muted">
            <span>min {band.band.min}</span>
            <span>max {band.band.max}</span>
          </div>
          <div className="flex items-center gap-3">
            <Mascot name="shark" state="pricing" size={44} />
            <p className="mono-data text-ink">“{last.reason}”</p>
          </div>
        </div>
      )}
      <p className="mono-small text-muted">
        Floor for {JOB_TYPE[t].title.toLowerCase()} jobs: {band.floor} {usd}{" "}
        (cheapest min fee {crabMin} ÷ {c.config.workerCapBps / 100}% worker cap,
        and at least min fee + {c.config.reviewFee} review). The contract
        rejects prices below it.
      </p>
      <p className="mono-label text-muted">{"// "}recent quotes</p>
      <ul>
        {c.prices.recentQuotes.map((q, i) => (
          <li
            key={i}
            className={cx(
              "mono-data grid grid-cols-[110px_120px_1fr_auto] items-center gap-3 border-t border-line py-2.5",
              q.status === "returned" && "anim-nudge",
            )}
          >
            <span className="text-muted">
              {day(q.at)} {time(q.at)}
            </span>
            <span className="text-ink">
              {q.jobType} {q.price}
            </span>
            <span className="body-small text-ink">“{q.reason}”</span>
            {q.status && (
              <Chip tone={q.status === "returned" ? "solid" : "outline"}>
                {q.status === "returned"
                  ? `returned · ${q.returnReason === "E_PRICE_BELOW_FLOOR" ? "below floor" : q.returnReason === "E_PRICE_OUT_OF_BAND" ? "out of band" : "payment sent back"}`
                  : q.status}
              </Chip>
            )}
          </li>
        ))}
      </ul>
    </Pane>
  );
}

function ReservePane({
  c,
  live,
  usd,
  network,
}: {
  c: Company;
  live: boolean;
  usd: string;
  network: Network;
}) {
  const r = c.reserve;
  const gas = r.ravenPayoutGas;
  // shortcut: Raven is paid on NEAR until Chain Signatures payouts ship, so an empty Base gas tank is not an alert yet
  const low = false;
  const room = sub(r.balance, r.floor);
  const topUp =
    toBase(room) < toBase(r.dailyBudget)
      ? toBase(room) < 0n
        ? "0.00"
        : room
      : r.dailyBudget;
  // Bar scale as in Figma: 5 × the floor (floor marker at 20%), or the balance if it is bigger.
  const scale = toBase(r.floor) * 5n;
  const max = toBase(r.balance) > scale ? toBase(r.balance) : scale > 0n ? scale : 1n;
  const pct = (v: string) => Math.max(0, Number((toBase(v) * 10000n) / max) / 100);
  const floorPct = pct(r.floor);
  return (
    <Pane
      live={live}
      eyebrow="// reserve"
      title="Can the company keep running?"
      lede="The reserve funds Shark’s daily budget for worker escrow and reviews. Owner payouts and top ups never take it below the floor."
    >
      <div className="grid grid-cols-3 gap-4">
        {(
          [
            [`reserve · ${usd}`, r.balance],
            [`floor · ${usd}`, r.floor],
            [`shark wallet · ${usd}`, r.sharkWallet],
          ] as const
        ).map(([k, v]) => (
          <div key={k} className="flex flex-col gap-1">
            <span className="mono-chip text-muted">{k}</span>
            <span className="figure-l text-ink">{v}</span>
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-2">
        <div
          className="relative h-2 rounded-pill bg-surface-2"
          role="img"
          aria-label={`Reserve ${r.balance}, floor ${r.floor}`}
        >
          <span
            className="anim-grow absolute inset-y-0 left-0 rounded-pill bg-ink"
            style={{ width: `${Math.min(100, pct(r.balance))}%` }}
          />
          <span
            className="absolute -top-1 h-4 w-0.5 bg-accent"
            style={{ left: `${Math.min(100, floorPct)}%` }}
          />
        </div>
        <p
          className="mono-small text-accent"
          style={{ paddingLeft: `${Math.min(80, floorPct)}%` }}
        >
          floor {r.floor} = 3 × daily budget + 2 × review fee
        </p>
      </div>
      <p className="mono-small text-muted">
        Next top up 00:00 UTC: min({r.dailyBudget} budget, {r.balance} −{" "}
        {r.floor}) = {topUp} {usd}. If Shark’s wallet can’t cover the next job,
        /v1/orders answers 503 out_of_budget and nobody is charged.
      </p>
      <div
        className={cx(
          "flex flex-col gap-1 rounded-md border px-4 py-3",
          low ? "border-ink bg-surface-2" : "border-line",
        )}
        role={low ? "alert" : undefined}
      >
        <p className="mono-label text-muted">Raven payout gas · not used yet</p>
        <p className="mono-data text-ink">
          {gasUnset(gas)
            ? "not connected"
            : `${gas.balanceEth} ${network === "testnet" ? "Sepolia ETH" : "ETH"} · ${gas.payoutsLeft === null ? "unknown until the first payout" : `enough for ≈ ${gas.payoutsLeft} payouts`}`}
        </p>
        <p className="mono-small text-muted">
          {gasUnset(gas)
            ? `Shark has no ${NETWORKS[network].baseChain} address or RPC for Raven yet. The owner sets them.`
            : low
            ? `Below ${gas.warnBelow} payouts: top it up before Raven’s payouts stop.`
            : `${NETWORKS[network].baseChain} address derived by Chain Signatures, ready for Raven’s payouts on ${NETWORKS[network].baseChain}, which come next. Today Raven is paid on NEAR.`}
        </p>
      </div>
    </Pane>
  );
}

function PayoutsPane({
  c,
  live,
  usd,
  network,
  owners,
  reserveShare,
}: {
  c: Company;
  live: boolean;
  usd: string;
  network: Network;
  owners: string;
  reserveShare: string;
}) {
  const p = c.pnl7d;
  const rev = toBase(p.revenue) > 0n ? toBase(p.revenue) : 1n;
  const pct = (v: string) => Number((toBase(v) * 10000n) / rev) / 100;
  const split: [string, string][] = [
    ["owners (Trezu)", owners],
    ["workers + reviews", addUsdc(p.workers, p.reviews)],
    ["reserve", reserveShare],
    ["referrals", p.referrals],
  ];
  const label = {
    worker: "worker fee",
    reviewer: "review fee",
    referral: "referral cut",
    owner: "owners’ share",
    refund: "refund",
    held: "fee held",
  } as const;
  return (
    <Pane
      live={live}
      eyebrow="// payouts"
      title="Where the money went"
      lede="Every payout is an on chain transfer from the contract. Worker fees go out on the worker’s own chain."
    >
      <p className="mono-small text-muted">All amounts in {usd}.</p>
      <div className="grid grid-cols-[1fr_400px] items-start gap-6 max-xl:grid-cols-1">
        <Play>
          <ul>
            {c.payouts.map((x, i) => (
              <li
                key={i}
                className="mono-data grid grid-cols-[110px_1fr_110px_70px_auto] items-center gap-3 border-t border-line py-2.5"
              >
                <span className="text-muted">
                  {day(x.at)} {time(x.at)}
                </span>
                <span className="truncate text-ink">{x.to}</span>
                <span className="text-muted">{label[x.kind]}</span>
                <span
                  className={cx(x.held ? "text-muted" : "anim-coin text-gain")}
                  style={{ animationDelay: `${i * 100}ms` }}
                >
                  {x.amount}
                </span>
                {x.held ? (
                  <Chip>
                    <Padlock className="mr-1.5" />
                    held · unresolved, up to 7 days
                  </Chip>
                ) : x.chain === "base" ? (
                  <ProofPill
                    kind="worker-base"
                    href={
                      live && x.tx
                        ? `${NETWORKS[network].baseTx}${x.tx}`
                        : undefined
                    }
                  >
                    {NETWORKS[network].baseChain} · Chain Signatures
                  </ProofPill>
                ) : (
                  <ProofPill
                    kind="payment"
                    href={live ? txHref(network, x.tx, false) : undefined}
                  >
                    {x.kind === "owner"
                      ? "NEAR · Trezu treasury"
                      : `NEAR · tx ${x.tx ? short(x.tx) : ""}`}
                  </ProofPill>
                )}
              </li>
            ))}
          </ul>
        </Play>
        <Play className="flex flex-col gap-4 rounded-md bg-surface-2 px-5 py-4">
          <p className="mono-label text-muted">{"// "}7 day split</p>
          {split.map(([k, v]) => (
            <div key={k} className="flex flex-col gap-1.5">
              <div className="mono-data flex justify-between">
                <span className="text-ink">{k}</span>
                <span className="text-ink">
                  {v} {usd}
                </span>
              </div>
              <div className="h-1.5 rounded-pill bg-surface" aria-hidden>
                <div
                  className="anim-grow h-full rounded-pill bg-ink"
                  style={{ width: `${pct(v)}%` }}
                />
              </div>
            </div>
          ))}
          <p className="mono-small text-muted">
            Bars are share of {p.revenue} {usd} revenue. Ink only: these are
            allocations, not gains or losses.
          </p>
        </Play>
      </div>
      {c.recentJobs.some((j) => j.attestationUrl || (j.payoutChain === "base" && j.workerPayoutTx)) && (
      <p className="mono-label text-muted">
        {"// "}review proofs · one per job
      </p>
      )}
      <div className="flex flex-wrap gap-3">
        {c.recentJobs
          .filter((j) => j.attestationUrl)
          .map((j) => (
            <ProofPill
              key={j.orderId}
              kind="review"
              href={live ? (j.attestationUrl ?? undefined) : undefined}
            >
              Owl attestation · {j.orderId}
            </ProofPill>
          ))}
        {c.recentJobs
          .filter((j) => j.payoutChain === "base" && j.workerPayoutTx)
          .map((j) => (
            <ProofPill
              key={`b${j.orderId}`}
              kind="worker-base"
              href={
                live
                  ? `${NETWORKS[network].baseTx}${j.workerPayoutTx}`
                  : undefined
              }
            >
              Raven paid on {NETWORKS[network].baseChain} · {j.orderId}
            </ProofPill>
          ))}
      </div>
    </Pane>
  );
}
