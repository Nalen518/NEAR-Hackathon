// Prints the testnet deploy as an ordered list of exact `near` commands, and writes their argument files to
// contracts/deploy/out/ (git-ignored). It signs and sends nothing: you run each command yourself, after you say yes.
//   node contracts/deploy/plan.mjs contracts/deploy/accounts.local.json [--fast-demo]
// --fast-demo shortens the complaint, dispute and review windows to minutes so a demo finishes while you watch.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const [accountsPath] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const fast = process.argv.includes("--fast-demo");
if (!accountsPath) {
  console.error("usage: node contracts/deploy/plan.mjs <accounts.local.json> [--fast-demo]   (copy accounts.example.json first)");
  process.exit(2);
}
const a = JSON.parse(readFileSync(accountsPath, "utf8"));

const need = ["contract", "owner", "guardian", "shark", "wallet", "crab", "raven", "owl", "buyer", "usdc", "quotePublicKey"];
const missing = need.filter((k) => !a[k] || String(a[k]).includes("REPLACE"));
const keys = ["shark", "wallet", "crab", "raven", "owl"].filter((k) => !a.publicKeys?.[k] || String(a.publicKeys[k]).includes("REPLACE"));
if (missing.length || keys.length) {
  console.error(`accounts file still has placeholders: ${[...missing, ...keys.map((k) => `publicKeys.${k}`)].join(", ")}`);
  process.exit(1);
}

// ---- the contract's Config (SRD §8.7 numbers); a check below keeps this list equal to the Rust struct
const band = (min, max) => ({ band_min: min, band_max: max });
const config = {
  extract: band("300000", "1500000"),
  summary: band("200000", "1000000"),
  thread: band("500000", "2000000"),
  worker_cap_bps: 5000,
  review_fee: "50000",
  referral_bps: 750,
  owner_bps: 6000,
  daily_budget: "4000000",
  strike_threshold: 3,
  suspend_threshold: 3,
  max_unresolved_open: 2,
  work_deadline_secs: 600,
  review_deadline_secs: fast ? 300 : 600,
  dispute_window_secs: fast ? 120 : 3600,
  unresolved_timeout_secs: fast ? 3600 : 604800,
  complaint_window_secs: fast ? 300 : 86400,
  job_timeout_secs: 21600,
};
const rust = readFileSync(join(here, "../company/src/lib.rs"), "utf8");
const struct = /pub struct Config \{([\s\S]*?)\n\}/.exec(rust)?.[1] ?? "";
const fields = [...struct.matchAll(/pub (\w+):/g)].map((m) => m[1]).sort();
if (JSON.stringify(fields) !== JSON.stringify(Object.keys(config).sort())) {
  console.error(`this script's config is out of date with contracts/company/src/lib.rs\n  contract: ${fields.join(", ")}\n  script:   ${Object.keys(config).sort().join(", ")}`);
  process.exit(1);
}

const out = join(here, "out");
mkdirSync(out, { recursive: true });
const write = (name, v) => {
  writeFileSync(join(out, name), `${JSON.stringify(v, null, 2)}\n`);
  return `contracts/deploy/out/${name}`;
};
const SEED = "16100000"; // 16.10 test USDC: the reserve floor (12.10) plus one daily budget (SRD §8.7)
const newArgs = write("new.args.json", { owner: a.owner, guardian: a.guardian, shark: a.shark, shark_wallet: a.wallet, quote_pubkey: a.quotePublicKey, usdc: a.usdc, network: "near:testnet", config });
const empty = write("empty.args.json", {});

const KEYCHAIN = "network-config testnet sign-with-legacy-keychain send";
const call = (contract, method, file, gas, deposit, signer) => `near contract call-function as-transaction ${contract} ${method} file-args ${file} prepaid-gas '${gas}' attached-deposit '${deposit}' sign-as ${signer} ${KEYCHAIN}`;
const addKey = (account, methods, pk) => `near account add-key ${account} grant-function-call-access --allowance '1 NEAR' --contract-account-id ${a.contract} --function-names '${methods}' use-manually-provided-public-key ${pk} ${KEYCHAIN}`;

const registered = [a.contract, a.wallet, a.crab, a.raven, a.owl, a.buyer, a.owner];
const steps = [
  ["1. Keys for the services (limited to their own methods, except the wallet which pays escrow and gas; the secret halves are in the .env files)", [
    addKey(a.shark, "award,complain,mark_refund_due,mark_paid_x402,return_x402", a.publicKeys.shark),
    `near account add-key ${a.wallet} grant-full-access use-manually-provided-public-key ${a.publicKeys.wallet} ${KEYCHAIN}`,
    addKey(a.crab, "deliver,dispute", a.publicKeys.crab),
    addKey(a.raven, "deliver,dispute", a.publicKeys.raven),
    addKey(a.owl, "on_review", a.publicKeys.owl),
  ]],
  ["2. Deploy the company contract and run `new` (one transaction)", [
    `near contract deploy ${a.contract} use-file contracts/company/target/near/company.wasm with-init-call new file-args ${newArgs} prepaid-gas '100 Tgas' attached-deposit '0 NEAR' ${KEYCHAIN}`,
  ]],
  ["3. Give the contract a little NEAR (it pays the USDC storage for refunds)", [`near tokens ${a.owner} send-near ${a.contract} '1 NEAR' ${KEYCHAIN}`]],
  ["4. Register every USDC receiver on the token (0.00125 NEAR each, paid by the owner)", registered.map((who) => call(a.usdc, "storage_deposit", write(`storage-${who}.json`, { account_id: who, registration_only: true }), "30 Tgas", "0.00125 NEAR", a.owner))],
  ["5. Register the workers and the reviewer (owner only)", [
    call(a.contract, "register_worker", write("register-crab.json", { id: a.crab, types: ["extract", "summary", "thread"], min_fees: ["100000", "60000", "120000"] }), "100 Tgas", "0 NEAR", a.owner),
    call(a.contract, "register_worker", write("register-raven.json", { id: a.raven, types: ["extract", "summary", "thread"], min_fees: ["140000", "80000", "180000"] }), "100 Tgas", "0 NEAR", a.owner),
    call(a.contract, "register_reviewer", write("register-owl.json", { id: a.owl }), "100 Tgas", "0 NEAR", a.owner),
  ]],
  ["6. Get test USDC from https://faucet.circle.com (Near Testnet): 20 for the owner, a few for the buyer, then:", []],
  ["7. Seed the reserve with 16.10 test USDC, then fund Shark's wallet for the day", [
    call(a.usdc, "ft_transfer_call", write("seed-reserve.json", { receiver_id: a.contract, amount: SEED, msg: "reserve" }), "100 Tgas", "0.000000000000000000000001 NEAR", a.owner),
    call(a.contract, "fund_shark", empty, "100 Tgas", "0 NEAR", a.wallet),
  ]],
];

console.log(`Testnet deploy plan for ${a.contract}${fast ? " (fast demo windows)" : ""}. Nothing below has been run.\n`);
for (const [title, cmds] of steps) {
  console.log(title);
  for (const c of cmds) console.log(`  ${c}`);
  console.log();
}
console.log("Argument files are in contracts/deploy/out/ (git-ignored). Each command that signs needs your yes first.");
