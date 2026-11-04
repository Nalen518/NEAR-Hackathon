// Places an order against a running Shark and prints the one command that pays it (method 1), until the web has a
// real wallet. It signs and sends nothing. The quote is good for 10 minutes.
//   node scripts/order.mjs <shark url> <payer account> <summary|thread|extract> "<instructions>" ["<text to work from>"]
// e.g. node scripts/order.mjs http://localhost:8787 demo-buyer.testnet summary "Summarise in 100 words." "Some text ..."
import { mkdirSync, writeFileSync } from "node:fs";

const [base, payer, jobType, instructions, text] = process.argv.slice(2);
if (!base || !payer || !jobType || !instructions) {
  console.error('usage: node scripts/order.mjs <shark url> <payer account> <summary|thread|extract> "<instructions>" ["<text>"]');
  process.exit(2);
}
const body = { jobType, instructions, payer, ...(text ? { input: { text } } : {}) };
const res = await fetch(`${base.replace(/\/$/, "")}/v1/orders`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify(body) });
const json = await res.json();
if (res.status !== 402) {
  console.error(`Shark answered ${res.status}: ${json.error} - ${json.message}`);
  if (json.details) console.error(JSON.stringify(json.details));
  process.exit(1);
}
const dir = ".orders"; // relative on purpose: a printed absolute path breaks on a folder name with a space
mkdirSync(dir, { recursive: true });
const file = `${dir}/${json.quoteId}.pay.json`;
writeFileSync(file, `${JSON.stringify(json.pay.args)}\n`);
console.log(`quote ${json.quoteId}: ${json.price} test USDC for a ${json.jobType} ("${json.priceReason}"), good until ${json.expiresAt}`);
console.log(`checks: ${json.brief.checklist.map((c) => `${c.id}=${c.rule}`).join(" | ")}`);
if (json.register) console.log(`!! ${payer} is not registered on the USDC token yet: run its storage_deposit first (deploy plan step 4)`);
console.log(`\nPay it (you sign, from this folder):\n  near contract call-function as-transaction ${json.pay.token} ft_transfer_call file-args ${file} prepaid-gas '100 Tgas' attached-deposit '0.000000000000000000000001 NEAR' sign-as ${payer} network-config testnet sign-with-legacy-keychain send`);
console.log(`\nThen watch it:\n  curl ${base}/v1/quotes/${json.quoteId}`);
