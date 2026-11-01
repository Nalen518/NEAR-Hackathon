// Read-only views of the company contract (API §3.2 "Views"). The contract is the source of truth
// for state and money; Shark only caches it. Base units stay strings until `fromBase`.
import type { JobType } from "@shark/shared";

export type ChainState = "ok" | "paused" | "caged" | "closed";

/** `get_config` as the contract returns it (SRD §8.4, U128 as strings). */
export type ContractConfig = {
  types: Record<JobType, { band_min: string; band_max: string }>;
  worker_cap_bps: number;
  review_fee: string;
  referral_bps: number;
  owner_bps: number;
  daily_budget: string;
  strike_threshold: number;
  suspend_threshold: number;
  max_unresolved_open: number;
  unresolved_timeout_secs: number;
  work_deadline_secs: number;
  review_deadline_secs: number;
  dispute_window_secs: number;
  complaint_window_secs: number;
  job_timeout_secs: number;
};

export type Chain = {
  serviceState(): Promise<ChainState>;
  config(): Promise<ContractConfig>;
  priceFloor(type: JobType): Promise<string>;
};

export function rpcChain(rpcUrl: string, contractId: string): Chain {
  async function view<T>(method: string, args: object = {}): Promise<T> {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "shark",
        method: "query",
        params: {
          request_type: "call_function",
          finality: "final",
          account_id: contractId,
          method_name: method,
          args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
        },
      }),
    });
    const body = (await res.json()) as { result?: { result: number[] }; error?: unknown };
    if (!body.result) throw new Error(`RPC ${method}: ${JSON.stringify(body.error)}`);
    return JSON.parse(Buffer.from(body.result.result).toString("utf8")) as T;
  }
  return {
    serviceState: () => view<ChainState>("get_service_state"),
    config: () => view<ContractConfig>("get_config"),
    priceFloor: (type) => view<string>("get_price_floor", { job_type: type }),
  };
}
