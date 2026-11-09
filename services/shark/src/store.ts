// Shark's own records (ARCHITECTURE §5): quotes, uploads, used NEP-413 nonces, complaints. Money and job
// state live in the contract; losing this file never puts money at risk.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { StoredReceipt } from "./events";

export type QuoteRow = {
  id: string;
  idem: string | null;
  body_hash: string;
  created_at: number;
  expires_at: number;
  payer: string;
  job_type: string;
  price: string;
  reason: string;
  instructions: string;
  brief: string;
  input: string;
  response: string;
};

export type FileRow = { id: string; hash: string; bytes: number; pages: number; words: number };

export type BidRow = { account: string; price: string; etaSecs: number; state: "winner" | "lost" | "busy" | "late" | "invalid" };
/** One auction per job (FR-30 to FR-34). Tx hashes are kept so the job page can link them. */
export type AuctionRow = {
  job_id: number;
  cap: string;
  bids: BidRow[];
  winner: string | null;
  reason: string;
  reason_hash: string;
  bid_hash: string | null;
  award_tx: string | null;
  escrow_tx: string | null;
  /** When the escrow was last sent (unix seconds); older rows have none */
  escrow_at?: number;
  round_sent: number;
  at: number;
  /** This is the second auction, after the first worker was late (FR-35) */
  reauction?: boolean;
};

export function openStore(dir: string) {
  mkdirSync(join(dir, "files"), { recursive: true });
  const db = new DatabaseSync(join(dir, "shark.db"));
  db.exec(`
    create table if not exists quotes (id text primary key, idem text, body_hash text, created_at int, expires_at int,
      payer text, job_type text, price text, reason text, instructions text, brief text, input text, response text);
    create index if not exists quotes_idem on quotes(idem);
    create table if not exists files (id text primary key, hash text, bytes int, pages int, words int);
    create table if not exists payer_nonces (nonce text primary key, scope text, at int);
    create table if not exists complaints (payer text, at int);
    create table if not exists auctions (job_id int primary key, row text);
    create table if not exists kv (key text primary key, value text);
    create table if not exists receipts (receipt_id text primary key, tx text, method text, ok int, at int, predecessor text, args text, job int, quote text);
    create index if not exists receipts_job on receipts(job);
    create index if not exists receipts_quote on receipts(quote);
  `);
  // a signature older than 5 minutes is refused anyway, so a day-old nonce guards nothing
  db.prepare("delete from payer_nonces where at < ?").run(Math.floor(Date.now() / 1000) - 86_400);
  type ReceiptRow = Omit<StoredReceipt, "ok" | "args"> & { ok: number; args: string };
  const toReceipt = (r: ReceiptRow): StoredReceipt => ({ ...r, ok: !!r.ok, args: JSON.parse(r.args) });
  // a hash becomes a file name, and workers choose some hashes (deliver, reasons), so only letters and digits are allowed:
  // no "..", slash or backslash can reach a file outside files/
  const blob = (hash: string) => {
    if (!/^(sha256:)?[0-9a-zA-Z]+$/.test(hash)) throw new Error("not a file hash");
    return join(dir, "files", hash.replace(/^sha256:/, ""));
  };
  return {
    putQuote: (q: QuoteRow) =>
      db
        .prepare("insert into quotes values (:id,:idem,:body_hash,:created_at,:expires_at,:payer,:job_type,:price,:reason,:instructions,:brief,:input,:response)")
        .run(q),
    quote: (id: string) => db.prepare("select * from quotes where id = ?").get(id) as QuoteRow | undefined,
    quoteByIdem: (idem: string, since: number) =>
      db.prepare("select * from quotes where idem = ? and created_at >= ? order by created_at desc limit 1").get(idem, since) as QuoteRow | undefined,
    putFile: (f: FileRow) => db.prepare("insert into files values (:id,:hash,:bytes,:pages,:words)").run(f),
    file: (id: string) => db.prepare("select * from files where id = ?").get(id) as FileRow | undefined,
    /** Content-addressed blobs: snapshots, briefs, deliveries, reasons (D-131). */
    putBlob: (hash: string, text: string) => writeFileSync(blob(hash), text, "utf8"),
    blob: (hash: string): string | null => {
      try {
        return readFileSync(blob(hash), "utf8");
      } catch {
        return null;
      }
    },
    /** Remembers a NEP-413 nonce with what it was used for. false for a replay: the nonce was used before, unless
     * `reusable` and it is the same `scope` (account, order and kind), which the web needs to refresh the payer view. */
    useNonce: (nonce: string, at: number, scope: string, reusable: boolean) => {
      if (Number(db.prepare("insert or ignore into payer_nonces values (?, ?, ?)").run(nonce, scope, at).changes) > 0) return true;
      return reusable && (db.prepare("select scope from payer_nonces where nonce = ?").get(nonce) as { scope: string }).scope === scope;
    },
    complaintsSince: (payer: string, since: number) =>
      (db.prepare("select count(*) as n from complaints where payer = ? and at >= ?").get(payer, since) as { n: number }).n,
    addComplaint: (payer: string, at: number) => db.prepare("insert into complaints values (?, ?)").run(payer, at),
    /** Newest first. */
    recentQuotes: (limit: number) =>
      db.prepare("select id, created_at, expires_at, job_type, price, reason from quotes order by created_at desc, rowid desc limit ?").all(limit) as Pick<
        QuoteRow,
        "id" | "created_at" | "expires_at" | "job_type" | "price" | "reason"
      >[],
    /** Newest first. */
    auctions: (limit: number): AuctionRow[] =>
      (db.prepare("select row from auctions order by json_extract(row, '$.at') desc, job_id desc limit ?").all(limit) as { row: string }[]).map((r) => JSON.parse(r.row)),
    /** false when this receipt was stored before */
    putReceipt: (r: StoredReceipt) =>
      Number(
        db
          .prepare("insert or ignore into receipts values (?,?,?,?,?,?,?,?,?)")
          .run(r.receipt_id, r.tx, r.method, r.ok ? 1 : 0, r.at, r.predecessor, JSON.stringify(r.args), r.job, r.quote).changes,
      ) > 0,
    hasReceipt: (id: string) => !!db.prepare("select 1 from receipts where receipt_id = ?").get(id),
    /** Oldest first: the calls about this job. */
    receiptsForJob: (job: number) => (db.prepare("select * from receipts where job = ? order by at, rowid").all(job) as ReceiptRow[]).map(toReceipt),
    /** The payment that carried this quote (ft_on_transfer with pay:), if the contract received one. */
    payReceiptForQuote: (quote: string) => {
      const r = db.prepare("select * from receipts where quote = ? and method = 'ft_on_transfer' order by at desc limit 1").get(quote) as ReceiptRow | undefined;
      return r && toReceipt(r);
    },
    /** Newest first. */
    recentReceipts: (methods: string[], limit: number) =>
      (db.prepare(`select * from receipts where ok = 1 and method in (${methods.map(() => "?").join(",")}) order by at desc, rowid desc limit ?`).all(...methods, limit) as ReceiptRow[]).map(toReceipt),
    kv: (key: string) => (db.prepare("select value from kv where key = ?").get(key) as { value: string } | undefined)?.value ?? null,
    setKv: (key: string, value: string) => db.prepare("insert or replace into kv values (?, ?)").run(key, value),
    /** Forgets the "first seen" notes under `prefix` for things that are no longer true (a paid refund, a retried payout) */
    keepSeen: (prefix: string, keep: (string | number)[]) => {
      const live = new Set(keep.map((k) => `${prefix}${k}`));
      for (const { key } of db.prepare("select key from kv where key like ?").all(`${prefix}%`) as { key: string }[])
        if (!live.has(key)) db.prepare("delete from kv where key = ?").run(key);
    },
    putAuction: (a: AuctionRow) => db.prepare("insert or replace into auctions values (?, ?)").run(a.job_id, JSON.stringify(a)),
    auction: (jobId: number): AuctionRow | undefined => {
      const r = db.prepare("select row from auctions where job_id = ?").get(jobId) as { row: string } | undefined;
      return r && JSON.parse(r.row);
    },
  };
}

export type Store = ReturnType<typeof openStore>;
