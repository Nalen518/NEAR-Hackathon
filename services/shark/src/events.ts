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
  page(cursor: string | null): Promise<{ receipts: StoredReceipt[]; next: string | null }>;
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

type NearblocksReceipt = {
  receipt_id: string;
  transaction_hash: string;
  predecessor_account_id: string;
  receiver_account_id: string;
  block_timestamp: string;
  actions?: { action: string; method?: string; args?: string | null }[];
  outcomes?: { status?: boolean };
};

/** NearBlocks API v1: `GET /v1/account/{id}/receipts?order=desc&per_page=25[&cursor=...]`. Needs no key at low volume. */
export function nearblocksSource(baseUrl: string, account: string, fetchImpl: typeof fetch = (...a) => fetch(...a)): ReceiptSource {
  return {
    async page(cursor) {
      const url = `${baseUrl.replace(/\/$/, "")}/v1/account/${account}/receipts?order=desc&per_page=25${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`indexer answered ${res.status}`);
      const body = (await res.json()) as { cursor?: string; txns?: NearblocksReceipt[] };
      const receipts = (body.txns ?? []).flatMap((t): StoredReceipt[] => {
        const a = t.actions?.[0];
        if (t.receiver_account_id !== account || a?.action !== "FUNCTION_CALL" || !a.method) return [];
        let args: Record<string, unknown> = {};
        try {
          args = a.args ? (JSON.parse(a.args) as Record<string, unknown>) : {};
        } catch {
          // arguments that are not JSON (a raw call) carry nothing we use
        }
        return [
          {
            receipt_id: t.receipt_id,
            tx: t.transaction_hash,
            method: a.method,
            ok: t.outcomes?.status === true,
            at: Math.floor(Number(BigInt(t.block_timestamp) / 1_000_000_000n)),
            predecessor: t.predecessor_account_id,
            args,
            ...classify(a.method, args),
          },
        ];
      });
      return { receipts, next: body.cursor ?? null };
    },
  };
}

/** Stores new receipts, newest pages first, and stops once a whole page was already known. Returns how many were new. */
export async function syncReceipts(source: ReceiptSource, store: Store, maxPages = 4): Promise<number> {
  let fresh = 0;
  let cursor: string | null = null;
  for (let i = 0; i < maxPages; i++) {
    const { receipts, next } = await source.page(cursor);
    const added = receipts.filter((r) => store.putReceipt(r)).length;
    fresh += added;
    if (added < receipts.length || !next || !receipts.length) break;
    cursor = next;
  }
  return fresh;
}
