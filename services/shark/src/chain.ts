// The company contract and NEAR RPC, as Shark sees them (API §3.2). The contract is the source of truth
// for state and money; Shark only reads it and sends the few calls its function-call key allows.
import type { JobType } from "@shark/shared";
import { Account, JsonRpcProvider, KeyPairSigner, type KeyPairString, type Provider } from "near-api-js";
import { verifyMessage } from "near-api-js/nep413";

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
  complaint_window_secs: number;
  job_timeout_secs: number;
};

export type JobState = "paid" | "awarded" | "review" | "revision" | "delivered" | "complaint_review" | "finalized" | "refund_due" | "refunded";

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
  state: JobState;
  paid_at: number;
  worker: string | null;
  worker_fee: string;
  escrowed: boolean;
  round: number;
  delivery_hash: string | null;
  awarded_at: number | null;
  delivered_at: number | null;
  reviewed_at: number | null;
  complaint_until: number | null;
  complaint_hash: string | null;
  codes: string[];
  review_fee: string;
  referral_bps: number;
  owner_bps: number;
};

export type ContractWorker = { id: string; types: JobType[]; min_fees: string[]; suspended: boolean };

/** NEP-413 `signMessage` output (API §1.5a), nonce and signature base64. */
export type Nep413 = { accountId: string; publicKey: string; signature: string; message: string; nonce: string; recipient: string };

export type Chain = {
  serviceState(): Promise<ChainState>;
  config(): Promise<ContractConfig>;
  priceFloor(type: JobType): Promise<string>;
  workers(): Promise<ContractWorker[]>;
  job(id: number): Promise<ContractJob | null>;
  jobByQuote(quoteId: string): Promise<ContractJob | null>;
  accountExists(id: string): Promise<boolean>;
  /** Registered on the USDC token (NEP-145)? */
  usdcRegistered(id: string): Promise<boolean>;
  /** Signature valid and `publicKey` is a full-access key of `accountId` on this network. */
  verifyNep413(m: Nep413): Promise<boolean>;
  complain(job: number, reasonHash: string): Promise<void>;
};

export function rpcChain(opts: { rpcUrl: string; contractId: string; usdcId: string; sharkId?: string; sharkKey?: string }): Chain {
  const provider = new JsonRpcProvider({ url: opts.rpcUrl });
  const view = <T>(method: string, args: Record<string, unknown> = {}, contractId = opts.contractId) =>
    provider.callFunction({ contractId, method, args, blockQuery: { finality: "final" } }) as Promise<T>;
  const shark = () => {
    if (!opts.sharkId || !opts.sharkKey) throw new Error("Shark's account and key are not configured");
    return new Account(opts.sharkId, provider, KeyPairSigner.fromSecretKey(opts.sharkKey as KeyPairString));
  };
  return {
    serviceState: () => view<ChainState>("get_service_state"),
    config: () => view<ContractConfig>("get_config"),
    priceFloor: (type) => view<string>("get_price_floor", { job_type: type }),
    workers: () => view<ContractWorker[]>("get_workers"),
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
      await shark().callFunction({ contractId: opts.contractId, methodName: "complain", args: { job, reason_hash: reasonHash }, gas: 30_000_000_000_000n });
    },
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
