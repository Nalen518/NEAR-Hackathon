// Shark's own records (ARCHITECTURE §5): quotes, uploads, used NEP-413 nonces, complaints. Money and job
// state live in the contract; losing this file never puts money at risk.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

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
    create table if not exists nonces (nonce text primary key, at int);
    create table if not exists complaints (payer text, at int);
    create table if not exists auctions (job_id int primary key, row text);
    create table if not exists kv (key text primary key, value text);
  `);
  const blob = (hash: string) => join(dir, "files", hash.replace(/^sha256:/, ""));
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
    /** false when the nonce was used before (replay). */
    useNonce: (nonce: string, at: number) => {
      try {
        db.prepare("insert into nonces values (?, ?)").run(nonce, at);
        return true;
      } catch {
        return false;
      }
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
    kv: (key: string) => (db.prepare("select value from kv where key = ?").get(key) as { value: string } | undefined)?.value ?? null,
    setKv: (key: string, value: string) => db.prepare("insert or replace into kv values (?, ?)").run(key, value),
    putAuction: (a: AuctionRow) => db.prepare("insert or replace into auctions values (?, ?)").run(a.job_id, JSON.stringify(a)),
    auction: (jobId: number): AuctionRow | undefined => {
      const r = db.prepare("select row from auctions where job_id = ?").get(jobId) as { row: string } | undefined;
      return r && JSON.parse(r.row);
    },
  };
}

export type Store = ReturnType<typeof openStore>;
