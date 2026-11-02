// GET /v1/prices and GET /v1/company (API §1.7, §1.9, v2.3 P6 core). Every number comes from the contract;
// a section whose data has no live source yet says so with `sample: true`, and the web labels it SAMPLE.
import { fromBase, JobType, type Company, type LedgerJob, type Prices, type Worker, type WorkerId } from "@shark/shared";
import type { Chain, ContractJob } from "./chain";
import type { Config } from "./config";

const usdc = (base: string | bigint) => fromBase(BigInt(base));
const iso = (secs: number) => new Date(secs * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
const DAY = 86_400;
const QUOTE_TTL_SECS = 600;
const SUSPEND_WINDOW_JOBS = 20; // SRD FR-47
const UNRESOLVED_TIMEOUT_SECS = 7 * DAY; // SRD FR-46

export async function pricesOf(chain: Chain): Promise<Prices> {
  const [cfg, floors] = await Promise.all([chain.config(), Promise.all(JobType.options.map((t) => chain.priceFloor(t)))]);
  const types = Object.fromEntries(
    JobType.options.map((t, i) => [t, { band: { min: usdc(cfg[t].band_min), max: usdc(cfg[t].band_max) }, floor: usdc(floors[i]) }]),
  ) as Prices["types"];
  // shortcut: recentQuotes stays empty until stored quotes are listed here (P5, could)
  return { types, recentQuotes: [] };
}

/** The split `finalize` makes (SRD §8.6), so the ledger and P&L match the contract to the base unit. */
function split(j: ContractJob) {
  const price = BigInt(j.price);
  const worker = BigInt(j.worker_fee);
  const review = BigInt(j.review_fee);
  const referral = j.referrer && j.referrer !== j.payer && j.referrer !== j.worker ? (price * BigInt(j.referral_bps)) / 10_000n : 0n;
  const profit = price - worker - review - referral;
  const owners = profit > 0n ? (profit * BigInt(j.owner_bps)) / 10_000n : 0n;
  return { price, worker, review, referral, profit: profit > 0n ? profit : 0n, owners, reserve: price - referral - owners };
}

export async function companyOf(config: Config, chain: Chain, now: number): Promise<Company & { network: string }> {
  const [state, cfg, stats, roles, workers, reviewer, prices] = await Promise.all([
    chain.serviceState(),
    chain.config(),
    chain.stats(),
    chain.roles(),
    chain.workers(),
    chain.reviewer(),
    pricesOf(chain),
  ]);
  // shortcut: reads every job each call; fine for a hackathon's few hundred jobs, cache or index beyond that
  const jobs: ContractJob[] = [];
  for (let from = 1; from <= stats.jobs; from += 100) jobs.push(...(await chain.jobs(from, 100)));
  const sharkWallet = await chain.usdcBalance(roles.shark).catch(() => "0");

  const idOf = (account: string | null): WorkerId | null =>
    account === config.agents.crab ? "crab" : account === config.agents.raven ? "raven" : null;
  const reviewFee = BigInt(cfg.review_fee);
  const floor = 3n * BigInt(cfg.daily_budget) + 2n * reviewFee; // D-145

  const week = jobs.filter((j) => j.paid_at >= now - 7 * DAY);
  const done = week.filter((j) => j.state === "finalized").map(split);
  const sum = (k: keyof ReturnType<typeof split>) => done.reduce((a, s) => a + s[k], 0n);

  const ledger: LedgerJob[] = jobs
    .slice(-20)
    .reverse()
    .map((j) => {
      const s = split(j);
      return {
        orderId: `j_${String(j.id).padStart(6, "0")}`,
        jobType: j.job_type,
        price: usdc(s.price),
        worker: idOf(j.worker),
        payoutChain: idOf(j.worker) === "raven" ? "base" : idOf(j.worker) ? "near" : null,
        status: j.state,
        referral: j.state === "finalized" ? usdc(s.referral) : null,
        attestationUrl: null,
        workerPayoutTx: null,
        at: iso(j.paid_at),
        reserveDelta: j.state === "finalized" ? usdc(s.reserve) : null,
        refund: j.state === "refunded" || j.state === "refund_due" ? usdc(s.price) : null,
      };
    });

  const workerCards: Worker[] = workers.flatMap((w) => {
    const id = idOf(w.id);
    if (!id) return [];
    const minFee = Object.fromEntries(w.types.map((t, i) => [t, usdc(w.min_fees[i])])) as Worker["minFee"];
    return [
      {
        id,
        account: w.id,
        payoutChain: id === "raven" ? "base" : "near",
        types: w.types,
        minFee,
        jobs: w.jobs,
        firstPassPct: w.jobs ? Math.round((100 * w.first_pass) / w.jobs) : 0,
        finalFails: w.final_fails,
        // shortcut: disputes and Unresolved come with the dispute slice; until then they are zero
        disputesWon: 0,
        disputesLost: 0,
        suspendThreshold: cfg.suspend_threshold,
        unresolvedOpen: 0,
        maxUnresolvedOpen: cfg.max_unresolved_open,
        late: w.late,
        suspended: w.suspended,
        eligible: !w.suspended,
        ineligibleReason: w.suspended ? "suspended" : null,
      },
    ];
  });

  return {
    network: config.networkId,
    state,
    strikes: { count: stats.strikes, threshold: cfg.strike_threshold },
    reserve: {
      balance: usdc(stats.reserve),
      floor: usdc(floor),
      sharkWallet: usdc(sharkWallet),
      dailyBudget: usdc(cfg.daily_budget),
      // shortcut: Raven's Base payouts come with the Chain Signatures slice; null means "unknown until the first payout"
      ravenPayoutGas: { balanceEth: "0", payoutsLeft: null, warnBelow: 5 },
    },
    pnl7d: {
      jobs: week.length,
      revenue: usdc(sum("price")),
      workers: usdc(sum("worker")),
      reviews: usdc(sum("review")),
      referrals: usdc(sum("referral")),
      profit: usdc(sum("profit")),
      // shortcut: pay_owners isn't in the contract yet, so nothing has been paid out to owners
      ownersPaid: "0.00",
      ownersAccrued: usdc(stats.owner_accrued),
    },
    prices,
    workers: workerCards,
    reviewer: {
      id: "owl",
      account: reviewer?.id ?? config.agents.owl ?? "",
      reviews: reviewer?.reviews ?? 0,
      overturned: reviewer?.overturned ?? 0,
      reviewFee: usdc(reviewFee),
      suspended: reviewer?.suspended ?? false,
    },
    recentJobs: ledger,
    owners: {
      dao: roles.owner,
      // shortcut: no Sputnik DAO yet (O-09); the owner is one account, so proposals are empty and marked sample
      approvalRule: "1 of 1",
      openProposals: [],
      proposals: [],
      ownersWaiting: usdc(stats.owner_accrued),
      trezuUrl: config.trezuUrl ?? "",
    },
    guardian: { account: roles.guardian, power: "pause only" },
    config: {
      quoteTtlSecs: QUOTE_TTL_SECS,
      workerCapBps: cfg.worker_cap_bps,
      reviewFee: usdc(reviewFee),
      referralBps: cfg.referral_bps,
      ownerBps: cfg.owner_bps,
      dailyBudget: usdc(cfg.daily_budget),
      reserveFloor: usdc(floor),
      strikeThreshold: cfg.strike_threshold,
      suspendThreshold: cfg.suspend_threshold,
      suspendWindowJobs: SUSPEND_WINDOW_JOBS,
      unresolvedTimeoutSecs: UNRESOLVED_TIMEOUT_SECS,
      maxUnresolvedOpen: cfg.max_unresolved_open,
      complaintWindowSecs: cfg.complaint_window_secs,
      bands: Object.fromEntries(Object.entries(prices.types).map(([t, v]) => [t, v.band])) as Company["config"]["bands"],
      changedAt: null,
      changedByProposal: null,
      changeTx: null,
    },
    // shortcut: payouts need tx hashes from NEP-297 events (an indexer); empty and marked sample until then
    payouts: [],
    auctions: [],
    incidents: [],
    sample: {
      strikes: false,
      reserve: false,
      pnl7d: false,
      prices: false,
      workers: false,
      reviewer: !reviewer,
      recentJobs: false,
      owners: true,
      config: false,
      payouts: true,
      guardian: false,
      auctions: true,
      incidents: true,
    },
  };
}
