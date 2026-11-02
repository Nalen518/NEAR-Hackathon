// The contract re-serializes the quote and verifies these exact bytes (contracts/company `canonical_quote_bytes`).
import { baseDecode, KeyPair } from "near-api-js";
import { describe, expect, it } from "vitest";
import { canonicalJson, sha256, signQuote, ulid, type SignedQuote } from "../src/quote";

const quote: SignedQuote = {
  quote_id: "q_A",
  network: "near:testnet",
  job_type: "summary",
  price: "600000",
  payer: "buyer.testnet",
  input_hash: "sha256:i",
  brief_hash: "sha256:b",
  referrer: "ref.testnet",
  expires_at: 2000,
};

describe("signed quote", () => {
  it("canonical bytes match the Rust contract", () => {
    expect(canonicalJson(quote)).toBe(
      '{"brief_hash":"sha256:b","expires_at":2000,"input_hash":"sha256:i","job_type":"summary","network":"near:testnet","payer":"buyer.testnet","price":"600000","quote_id":"q_A","referrer":"ref.testnet"}',
    );
  });
  it("a null referrer stays in the bytes, as serde writes Option::None", () => {
    expect(canonicalJson({ ...quote, referrer: null })).toContain('"referrer":null');
  });
  it("the signature verifies against the quote public key over sha256(domain + canonical)", () => {
    const key = KeyPair.fromRandom("ed25519");
    const sig = signQuote(quote, key.toString());
    expect(sig).toMatch(/^ed25519:/);
    const bytes = baseDecode(sig.slice("ed25519:".length));
    expect(bytes.length).toBe(64);
    expect(key.verify(sha256(`sharkco:quote:v2|${canonicalJson(quote)}`), bytes)).toBe(true);
  });
  it("ulid is 26 Crockford characters and sorts by time", () => {
    const a = ulid(1_000);
    const b = ulid(2_000);
    expect(a).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(a < b).toBe(true);
  });
});
