// Works out the Base (EVM) address that Chain Signatures gives a NEAR account for a path, so it can be funded with
// Base Sepolia ETH for Raven's payout gas. It only reads: it asks the MPC contract for its root key and signs nothing.
//   node scripts/derive-address.mjs <predecessor account> <path> [near rpc url] [signer account]
//   e.g. node scripts/derive-address.mjs sharkco.testnet base-payouts
// The derivation is the MPC contract's own (near/mpc kdf.rs): child = root + sha3_256("near-mpc-recovery v0.1.0 epsilon
// derivation:<account>,<path>") * G. `--check` also asks the contract's `derived_public_key` and refuses a mismatch.
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256, sha3_256 } from "@noble/hashes/sha3";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import { pathToFileURL } from "node:url";

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const base58 = (s) => {
  let n = 0n;
  for (const c of s) n = n * 58n + BigInt(B58.indexOf(c));
  return n;
};

/** "secp256k1:<base58 of x||y>" (NEAR's key format) → the curve point */
export const pointOf = (key) => {
  const hex = base58(key.replace(/^secp256k1:/, "")).toString(16).padStart(128, "0");
  return secp256k1.ProjectivePoint.fromHex(`04${hex}`);
};

/** The key the MPC network signs with for `predecessor` and `path`, from the contract's root key. */
export function deriveChildKey(rootKey, predecessor, path) {
  const tweak = BigInt(`0x${bytesToHex(sha3_256(utf8ToBytes(`near-mpc-recovery v0.1.0 epsilon derivation:${predecessor},${path}`)))}`);
  return pointOf(rootKey).add(secp256k1.ProjectivePoint.BASE.multiply(tweak));
}

/** EIP-55 checksummed EVM address of a curve point */
export function evmAddress(point) {
  const addr = bytesToHex(keccak_256(point.toRawBytes(false).slice(1)).slice(12));
  const hash = bytesToHex(keccak_256(utf8ToBytes(addr)));
  return `0x${[...addr].map((c, i) => (parseInt(hash[i], 16) >= 8 ? c.toUpperCase() : c)).join("")}`;
}

const view = async (rpc, account, method, args = {}) => {
  const res = await fetch(rpc, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", finality: "final", account_id: account, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") } }),
    signal: AbortSignal.timeout(20_000),
  });
  const j = await res.json();
  if (!j.result?.result) throw new Error(`${account}.${method} failed: ${JSON.stringify(j.error ?? j).slice(0, 200)}`);
  return JSON.parse(Buffer.from(j.result.result).toString());
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [predecessor, path, rpc = "https://rpc.testnet.near.org", signer = "v1.signer-prod.testnet"] = process.argv.slice(2).filter((a) => a !== "--check");
  if (!predecessor || !path) {
    console.error("usage: node scripts/derive-address.mjs <predecessor account> <path> [near rpc url] [signer account] [--check]");
    process.exit(2);
  }
  if (!/\.testnet$/.test(signer) && !process.env.ALLOW_MAINNET) {
    console.error(`${signer} is not a testnet signer. This project uses testnet only.`);
    process.exit(2);
  }
  const root = await view(rpc, signer, "public_key");
  const child = deriveChildKey(root, predecessor, path);
  if (process.argv.includes("--check")) {
    const theirs = await view(rpc, signer, "derived_public_key", { path, predecessor, domain_id: 0 });
    if (!pointOf(theirs).equals(child)) {
      console.error(`MISMATCH: the contract says ${theirs}, this script derived another key. Do not fund the address.`);
      process.exit(1);
    }
    console.log(`checked against ${signer}.derived_public_key: same key`);
  }
  console.log(`${predecessor} + "${path}" on ${signer}`);
  console.log(`Base address: ${evmAddress(child)}`);
}
