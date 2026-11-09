// Signed quotes (API §1.2), canonical JSON and ids. The contract re-serializes the quote with serde and
// checks the same bytes, so canonical JSON here must match contracts/company exactly (see quote.test.ts).
import { createHash, randomBytes } from "node:crypto";
import type { JobType } from "@shark/shared";
import { baseEncode, KeyPair, type KeyPairString } from "near-api-js";

/** Keys sorted, no spaces, UTF-8 (API §0). */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(v);
}

export const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest();
export const sha256Ref = (data: string | Uint8Array) => `sha256:${sha256(data).toString("hex")}`;

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/** ULID: 48 bit time + 80 bit randomness, Crockford base32, sortable. */
export function ulid(now = Date.now()): string {
  let time = "";
  for (let t = now, i = 0; i < 10; i++, t = Math.floor(t / 32)) time = CROCKFORD[t % 32] + time;
  const rnd = randomBytes(16);
  let rand = "";
  for (let i = 0; i < 16; i++) rand += CROCKFORD[rnd[i] % 32];
  return time + rand;
}

export type SignedQuote = {
  quote_id: string;
  network: "near:testnet";
  job_type: JobType;
  /** base units */
  price: string;
  payer: string;
  input_hash: string;
  brief_hash: string;
  referrer: string | null;
  expires_at: number;
};

/** `ed25519_sign(quote_key, sha256("sharkco:quote:v2|" + canonical_json(quote)))` as "ed25519:<base58>". */
export function signQuote(quote: SignedQuote, quoteKey: string): string {
  const { signature } = KeyPair.fromString(quoteKey as KeyPairString).sign(sha256(`sharkco:quote:v2|${canonicalJson(quote)}`));
  return `ed25519:${baseEncode(signature)}`;
}
