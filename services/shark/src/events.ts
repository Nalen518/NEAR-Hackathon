// The event reader: Shark's view of what happened on chain, from the receipts the company contract received
// (method, arguments, status, transaction hash, time). A public indexer is the source; if it is down the API still
// works and the transaction links and payout list stay as they were.
// shortcut: the indexer gives no event logs, so payouts are derived from the call that triggers them (see ledger.ts);
// switch to NEP-297 logs from a node or a paid indexer when the amounts need to be exact (owners' payouts).
import type { Store } from "./store";

export type StoredReceipt = {
  receipt_id: string;
  /** hash of the transaction that started it all: the one to link */
  tx: string;
  method: string;
  ok: boolean;
  /** unix seconds */
  at: number;
  predecessor: string;
  args: Record<string, unknown>;
  job: number | null;
  /** quote id, for payments (`ft_on_transfer` with `pay:`) and x402 reports */
  quote: string | null;
};

export type ReceiptSource = {
  /** Newest first. `cursor` continues from the previous page. */
  /** `known` receipts are returned without their arguments, which saves a request for each. */
  page(cursor: string | null, known?: (receiptId: string) => boolean): Promise<{ receipts: StoredReceipt[]; next: string | null }>;
};

/** A payment the contract received that no job came out of, long enough ago that the token has given it back (FR-06). */
export const RETURN_AFTER_SECS = 90;
export const isReturned = (pay: StoredReceipt | undefined, hasJob: boolean, now: number) => !!pay && pay.ok && !hasJob && now - pay.at > RETURN_AFTER_SECS;

/** Pulls the job and quote an incoming call belongs to out of its arguments. */
export function classify(method: string, args: Record<string, unknown>): { job: number | null; quote: string | null } {
  if (method === "ft_on_transfer") {
    const msg = typeof args.msg === "string" ? args.msg : "";
    if (msg.startsWith("escrow:")) return { job: Number(msg.slice(7)) || null, quote: null };
    if (msg.startsWith("pay:")) {
      try {
        const body = JSON.parse(Buffer.from(msg.slice(4), "base64").toString("utf8")) as { quote?: { quote_id?: string } };
        return { job: null, quote: body.quote?.quote_id ?? null };
      } catch {
        return { job: null, quote: null };
      }
    }
    return { job: null, quote: null };
  }
  if (method === "mark_paid_x402") return { job: null, quote: (args.quote as { quote_id?: string } | undefined)?.quote_id ?? null };
  return { job: typeof args.job === "number" ? args.job : null, quote: null };
}

type V3Action = { action: string; method?: string; args?: { args_json?: Record<string, unknown> | null; args_base64?: string | null } | null };
type V3Receipt = {
  receipt_id: string;
  transaction_hash?: string;
  predecessor_account_id: string;
  receiver_account_id: string;
  block?: { block_timestamp: string };
  included_in_block_timestamp?: string;
  actions?: V3Action[];
  outcome?: { status?: boolean };
  receipts?: V3Receipt[];
};

const argsOf = (a?: V3Action): Record<string, unknown> => {
  if (a?.args?.args_json && typeof a.args.args_json === "object") return a.args.args_json;
  try {
    return a?.args?.args_base64 ? (JSON.parse(Buffer.from(a.args.args_base64, "base64").toString("utf8")) as Record<string, unknown>) : {};
  } catch {
    return {}; // arguments that are not JSON (a raw call) carry nothing we use
  }
};

const findReceipt = (tree: V3Receipt[], id: string): V3Receipt | undefined => {
  for (const r of tree) {
    const hit = r.receipt_id === id ? r : findReceipt(r.receipts ?? [], id);
    if (hit) return hit;
  }
};

/**
 * NearBlocks API v3 (v1 and v2 were retired on 5 Nov 2026). The account's receipt list carries no call arguments, so for
 * a receipt Shark has not stored yet the transaction's receipt tree is read once (`/v3/txns/{hash}/receipts`).
 * shortcut: one extra request per new transaction on a keyless API; a burst of new transactions can hit its rate limit,
 * the page then fails as a whole and the next sync a minute later retries it. Use an API key beyond demo volume.
 */
export function nearblocksSource(baseUrl: string, account: string, fetchImpl: typeof fetch = (...a) => fetch(...a)): ReceiptSource {
  const base = baseUrl.replace(/\/$/, "");
  const get = async <T>(path: string): Promise<T> => {
    const res = await fetchImpl(`${base}${path}`, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`indexer answered ${res.status}`);
    return (await res.json()) as T;
  };
  return {
    async page(cursor, known = () => false) {
      const body = await get<{ data?: V3Receipt[]; meta?: { next_page?: string | null } }>(`/v3/accounts/${account}/receipts?limit=25${cursor ? `&next=${encodeURIComponent(cursor)}` : ""}`);
      const trees = new Map<string, Promise<V3Receipt[]>>(); // one detail request per transaction
      const receipts: StoredReceipt[] = [];
      for (const t of body.data ?? []) {
        const a = t.actions?.[0];
        if (t.receiver_account_id !== account || a?.action !== "FUNCTION_CALL" || !a.method || !t.transaction_hash) continue;
        const tx = t.transaction_hash;
        let args: Record<string, unknown> = {};
        if (!known(t.receipt_id)) {
          if (!trees.has(tx)) trees.set(tx, get<{ data?: V3Receipt[] | V3Receipt }>(`/v3/txns/${tx}/receipts`).then((d) => (Array.isArray(d.data) ? d.data : d.data ? [d.data] : [])));
          args = argsOf(findReceipt(await trees.get(tx)!, t.receipt_id)?.actions?.[0]);
        }
        receipts.push({
          receipt_id: t.receipt_id,
          tx,
          method: a.method,
          ok: t.outcome?.status === true,
          at: Math.floor(Number(BigInt(t.block?.block_timestamp ?? t.included_in_block_timestamp ?? "0") / 1_000_000_000n)),
          predecessor: t.predecessor_account_id,
          args,
          ...classify(a.method, args),
        });
      }
      return { receipts, next: body.meta?.next_page ?? null };
    },
  };
}

/** Stores new receipts, newest pages first, and stops once a whole page was already known. Returns how many were new. */
export async function syncReceipts(source: ReceiptSource, store: Store, maxPages = 4): Promise<number> {
  let fresh = 0;
  let cursor: string | null = null;
  for (let i = 0; i < maxPages; i++) {
    const { receipts, next } = await source.page(cursor, (id) => store.hasReceipt(id));
    const added = receipts.filter((r) => store.putReceipt(r)).length;
    fresh += added;
    if (added < receipts.length || !next || !receipts.length) break;
    cursor = next;
  }
  return fresh;
}
