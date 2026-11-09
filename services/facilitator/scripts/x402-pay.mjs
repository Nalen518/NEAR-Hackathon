// Pays one Shark order the way a bot would, over x402 (method 3): ask for a quote, read the PAYMENT-REQUIRED header,
// sign the NEP-366 delegated ft_transfer with the buyer's key, and send it back as PAYMENT-SIGNATURE. Our facilitator
// relays and settles it. The buyer key comes from the git-ignored .env.buyer (X402_BUYER_ID, X402_BUYER_KEY) and is
// never printed. It spends test USDC: run it only with the owner's yes.
//   node --env-file=.env.buyer scripts/x402-pay.mjs [shark url]
import { createClientNearSigner, ExactNearScheme } from "@x402/near";

const shark = (process.argv[2] ?? "http://localhost:8787").replace(/\/$/, "");
const accountId = process.env.X402_BUYER_ID;
const secretKey = process.env.X402_BUYER_KEY;
if (!accountId || !secretKey) {
  console.error("X402_BUYER_ID and X402_BUYER_KEY must be set (node --env-file=.env.buyer ...)");
  process.exit(2);
}
const decode = (h) => JSON.parse(Buffer.from(h, "base64").toString("utf8"));
const encode = (v) => Buffer.from(JSON.stringify(v)).toString("base64");

const body = JSON.stringify({ jobType: "summary", payer: accountId, instructions: "Summarise this in about 40 words.", input: { text: "x402 lets an agent pay for an HTTP request in one round trip. The server answers 402 with what it wants, the client signs a payment and sends it back, and a facilitator settles it on chain. On NEAR the payment is a signed delegate action, so the payer needs no gas of its own." } });
const headers = { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() };

const first = await fetch(`${shark}/v1/orders`, { method: "POST", headers, body });
const required = first.headers.get("PAYMENT-REQUIRED");
if (first.status !== 402 || !required) throw new Error(`expected a 402 with PAYMENT-REQUIRED, got ${first.status}`);
const pr = decode(required);
const accepted = pr.accepts[0];
console.log(`quote ${accepted.extra?.quoteId}: ${Number(accepted.amount) / 1e6} USDC to ${accepted.payTo}, network ${accepted.network}`);

const scheme = new ExactNearScheme(createClientNearSigner({ accountId, secretKey, rpcUrls: { [accepted.network]: process.env.TESTNET_RPC_URL ?? "https://rpc.testnet.fastnear.com" } }));
const signed = await scheme.createPaymentPayload(pr.x402Version, accepted);
const payment = { x402Version: pr.x402Version, resource: pr.resource, accepted, payload: signed.payload };

const paid = await fetch(`${shark}/v1/orders`, { method: "POST", headers: { ...headers, "PAYMENT-SIGNATURE": encode(payment) }, body });
const response = paid.headers.get("PAYMENT-RESPONSE");
console.log(`Shark answered ${paid.status}:`, JSON.stringify(await paid.json()));
if (response) console.log("PAYMENT-RESPONSE:", JSON.stringify(decode(response)));
