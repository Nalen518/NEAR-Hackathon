// The company contract and NEAR RPC, as Shark sees them (API §3.2). The contract is the source of truth
// for state and money; Shark only reads it and sends the few calls its function-call key allows.
import type { JobType } from "@shark/shared";
import { Account, JsonRpcProvider, KeyPairSigner, type KeyPairString, type Provider } from "near-api-js";
import { verifyMessage } from "near-api-js/nep413";
import type { SignedQuote } from "./quote";

export type ChainState = "ok" | "paused" | "caged" | "closed";

/** `get_config` exactly as contracts/company returns it (U128 as strings). */
export type ContractConfig = Record<JobType, { band_min: string; band_max: string }> & {
  worker_cap_bps: number;
  review_fee: string;
  referral_bps: number;
  owner_bps: number;
  daily_budget: string;
  strike_threshold: number;
  suspend_threshold: number;
  max_unresolved_open: number;
  work_deadline_secs: number;
  review_deadline_secs: number;
  dispute_window_secs: number;
  unresolved_timeout_secs: number;
  complaint_window_secs: number;
  job_timeout_secs: number;
};

export type JobState = "paid" | "awarded" | "review" | "revision" | "failed" | "dispute_review" | "unresolved" | "delivered" | "complaint_review" | "finalized" | "refund_due" | "refunded";

/** `get_job` (contracts/company `Job`). Times are unix seconds. */
export type ContractJob = {
  id: number;
  quote_id: string;
  payer: string;
  job_type: JobType;
  price: string;
  input_hash: string;
  brief_hash: string;
  referrer: string | null;
  method: "quote" | "x402";
  state: JobState;
  paid_at: number;
  worker: string | null;
  worker_fee: string;
  escrowed: boolean;
  round: number;
  delivery_hash: string | null;
  /** unix seconds; 0 until awarded */
  work_deadline: number;
  awarded_at: number | null;
  delivered_at: number | null;
  reviewed_at: number | null;
  complaint_until: number | null;
  complaint_hash: string | null;
  codes: string[];
  reasons_hash: string | null;
  dispute_until: number | null;
  review_requested_at: number | null;
  unresolved_since: number | null;
  held: boolean;
  reauctioned: boolean;
  excluded: string | null;
  review_fee: string;
  referral_bps: number;
  owner_bps: number;
};

export type ContractWorker = {
  id: string;
  types: JobType[];
  min_fees: string[];
  jobs: number;
  first_pass: number;
  final_fails: number;
  disputes_won: number;
  disputes_lost: number;
  disputes_unresolved: number;
  unresolved_open: number;
  late: number;
  suspended: boolean;
};
export type ContractReviewer = { id: string; reviews: number; overturned: number; suspended: boolean };
export type ContractStats = { jobs: number; strikes: number; reserve: string; owner_accrued: string; accounted: string; open_jobs: number; owed_open: number; owners_paid: string; config_changed_at: number | null };
export type ContractOwed = { id: number; job: number; to: string; amount: string; kind: string };
export type ContractRoles = { owner: string; guardian: string; shark: string; shark_wallet: string; usdc: string; network: string };

/** NEP-413 `signMessage` output (API §1.5a), nonce and signature base64. */
export type Nep413 = { accountId: string; publicKey: string; signature: string; message: string; nonce: string; recipient: string };

export type Chain = {
  serviceState(): Promise<ChainState>;
  config(): Promise<ContractConfig>;
  priceFloor(type: JobType): Promise<string>;
  workers(): Promise<ContractWorker[]>;
  reviewer(): Promise<ContractReviewer | null>;
  stats(): Promise<ContractStats>;
  roles(): Promise<ContractRoles>;
  /** Jobs with ids from `from`, oldest first, at most `limit` (≤ 100). */
  jobs(from: number, limit: number): Promise<ContractJob[]>;
  usdcBalance(account: string): Promise<string>;
  /** Failed payouts waiting for a retry, oldest first from id `from`. */
  owed(from: number, limit: number): Promise<ContractOwed[]>;
  job(id: number): Promise<ContractJob | null>;
  jobByQuote(quoteId: string): Promise<ContractJob | null>;
  accountExists(id: string): Promise<boolean>;
  /** Registered on the USDC token (NEP-145)? */
  usdcRegistered(id: string): Promise<boolean>;
  /** Signature valid and `publicKey` is a full-access key of `accountId` on this network. */
  verifyNep413(m: Nep413): Promise<boolean>;
  complain(job: number, reasonHash: string): Promise<void>;
  /** Is `publicKey` an access key of `accountId` on this network (any permission)? */
  isAccessKey(accountId: string, publicKey: string): Promise<boolean>;
  // transactions; each returns its tx hash
  award(job: number, worker: string, fee: string, bidHash: string, reasonHash: string): Promise<string>;
  /** Shark's wallet sends worker fee + review fee to the contract (`escrow:<job>`, FR-34). */
  escrow(job: number, amount: string): Promise<string>;
  markRefundDue(job: number): Promise<string>;
  finalize(job: number): Promise<string>;
  payRefund(job: number): Promise<string>;
  /** Permissionless keepers for the dispute path (FR-44 to FR-46). */
  settleFailed(job: number): Promise<string>;
  markUnresolved(job: number): Promise<string>;
  releaseUnresolved(job: number): Promise<string>;
  /** Late work: the escrow goes back, then one re-auction or a refund (FR-35). */
  expireWork(job: number): Promise<string>;
  /** Daily treasury keepers (FR-62, FR-63). They revert when the reserve is at its floor or already ran today. */
  fundShark(): Promise<string>;
  payOwners(): Promise<string>;
  retryOwed(id: number): Promise<string>;
  /** x402 (method 3): Shark reports a settled payment, or sends an unmatched one back. The contract checks its balance. */
  markPaidX402(quote: SignedQuote, sig: string, settlement: X402Settlement): Promise<string>;
  returnX402(settlement: X402Settlement): Promise<string>;
  /** Raven's Base balance and gas price in wei, or null when no EVM RPC or address is configured (C2) */
  ravenGas(): Promise<{ balanceWei: string; gasPriceWei: string } | null>;
};

export type X402Settlement = { tx_hash: string; payer: string; amount: string };

export type ChainOpts = {
  rpcUrl: string;
  contractId: string;
  usdcId: string;
  /** Shark's function-call key: award, complain, mark_refund_due (NFR-04). */
  sharkId?: string;
  sharkKey?: string;
  /** Shark's USDC wallet: escrow, and the permissionless keepers. shortcut: a plain testnet account until the OutLayer custody wallet (D-144) */
  walletId?: string;
  walletKey?: string;
  /** Base Sepolia JSON-RPC and Raven's address there, for the payout gas gauge */
  evmRpcUrl?: string;
  ravenEvmAddress?: string;
};

const TGAS = 1_000_000_000_000n;
const txHash = (r: unknown) => (r as { transaction_outcome: { id: string } }).transaction_outcome.id;

export function rpcChain(opts: ChainOpts): Chain {
  const provider = new JsonRpcProvider({ url: opts.rpcUrl });
  const view = <T>(method: string, args: Record<string, unknown> = {}, contractId = opts.contractId) =>
    provider.callFunction({ contractId, method, args, blockQuery: { finality: "final" } }) as Promise<T>;
  const signer = (id?: string, key?: string) => {
    if (!id || !key) throw new Error("this call needs an account and key that are not configured");
    return new Account(id, provider, KeyPairSigner.fromSecretKey(key as KeyPairString));
  };
  const shark = () => signer(opts.sharkId, opts.sharkKey);
  const wallet = () => signer(opts.walletId, opts.walletKey);
  const call = async (who: Account, methodName: string, args: Record<string, unknown>, gas = 30n * TGAS, deposit = 0n, contractId = opts.contractId) =>
    txHash(await who.callFunctionRaw({ contractId, methodName, args, gas, deposit, waitUntil: "FINAL" }));
  return {
    serviceState: () => view<ChainState>("get_service_state"),
    config: () => view<ContractConfig>("get_config"),
    priceFloor: (type) => view<string>("get_price_floor", { job_type: type }),
    workers: () => view<ContractWorker[]>("get_workers"),
    reviewer: () => view<ContractReviewer | null>("get_reviewer"),
    stats: () => view<ContractStats>("get_stats"),
    roles: () => view<ContractRoles>("get_roles"),
    jobs: (from, limit) => view<ContractJob[]>("get_jobs", { from, limit }),
    usdcBalance: (account) => view<string>("ft_balance_of", { account_id: account }, opts.usdcId),
    owed: (from, limit) => view<ContractOwed[]>("get_owed", { from, limit }),
    job: (id) => view<ContractJob | null>("get_job", { job: id }),
    jobByQuote: (quoteId) => view<ContractJob | null>("get_job_by_quote", { quote_id: quoteId }),
    accountExists: (id) =>
      provider.viewAccount({ accountId: id, blockQuery: { finality: "final" } }).then(
        () => true,
        (e: unknown) => {
          if (/UNKNOWN_ACCOUNT|does not exist/i.test(String(e))) return false;
          throw e;
        },
      ),
    usdcRegistered: (id) => view<unknown>("storage_balance_of", { account_id: id }, opts.usdcId).then((b) => b !== null),
    verifyNep413: (m) => verifyNep413(m, provider),
    complain: async (job, reasonHash) => {
      await call(shark(), "complain", { job, reason_hash: reasonHash });
    },
    isAccessKey: (accountId, publicKey) =>
      provider.viewAccessKey({ accountId, publicKey, finalityQuery: { finality: "final" } }).then(
        () => true,
        () => false,
      ),
    award: (job, worker, fee, bidHash, reasonHash) => call(shark(), "award", { job, worker, fee, bid_hash: bidHash, reason_hash: reasonHash }),
    escrow: (job, amount) =>
      call(wallet(), "ft_transfer_call", { receiver_id: opts.contractId, amount, msg: `escrow:${job}` }, 100n * TGAS, 1n, opts.usdcId),
    markRefundDue: (job) => call(shark(), "mark_refund_due", { job }),
    finalize: (job) => call(wallet(), "finalize", { job }, 100n * TGAS),
    payRefund: (job) => call(wallet(), "pay_refund", { job }, 100n * TGAS),
    settleFailed: (job) => call(wallet(), "settle_failed", { job }),
    markUnresolved: (job) => call(wallet(), "mark_unresolved", { job }),
    releaseUnresolved: (job) => call(wallet(), "release_unresolved", { job }, 100n * TGAS),
    expireWork: (job) => call(wallet(), "expire_work", { job }, 100n * TGAS),
    fundShark: () => call(wallet(), "fund_shark", {}, 100n * TGAS),
    payOwners: () => call(wallet(), "pay_owners", {}, 100n * TGAS),
    retryOwed: (id) => call(wallet(), "retry_owed", { id }, 100n * TGAS),
    markPaidX402: (quote, sig, settlement) => call(shark(), "mark_paid_x402", { quote, sig, settlement }, 100n * TGAS),
    ravenGas: async () => {
      if (!opts.evmRpcUrl || !opts.ravenEvmAddress) return null;
      const rpc = async (method: string, params: unknown[]) => {
        const r = await fetch(opts.evmRpcUrl!, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(4_000) });
        const j = (await r.json()) as { result?: string; error?: { message: string } };
        if (!j.result) throw new Error(j.error?.message ?? "no result");
        return BigInt(j.result).toString();
      };
      return { balanceWei: await rpc("eth_getBalance", [opts.ravenEvmAddress, "latest"]), gasPriceWei: await rpc("eth_gasPrice", []) };
    },
    returnX402: (settlement) => call(shark(), "return_x402", { settlement }, 100n * TGAS),
  };
}

/** NEP-413 check: the signature over {message, nonce, recipient} and a full-access key of `accountId`. */
export function verifyNep413(m: Nep413, provider: Pick<Provider, "viewAccessKey">): Promise<boolean> {
  return verifyMessage({
    signerAccountId: m.accountId,
    signerPublicKey: m.publicKey,
    payload: { message: m.message, recipient: m.recipient, nonce: Buffer.from(m.nonce, "base64") },
    signature: Buffer.from(m.signature, "base64"),
    provider: provider as Provider,
  }).then(
    () => true,
    () => false,
  );
}
