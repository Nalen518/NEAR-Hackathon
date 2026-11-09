// Runs our x402 facilitator for one NEAR network. Env names follow API-CONTRACT §5.1.
import { serve } from "@hono/node-server";
import { x402Facilitator } from "@x402/core/facilitator";
import { createFacilitatorNearSigner } from "@x402/near";
import { ExactNearScheme } from "@x402/near/exact/facilitator";
import { createFacilitatorApp } from "./app";

const env = process.env;
const net = env.SHARK_NETWORK;
if (net !== "testnet") throw new Error("SHARK_NETWORK must be testnet"); // the build is testnet only
const NET = net.toUpperCase();
const need = (name: string) => env[name] || (() => { throw new Error(`${name} is not set`); })();

const network = `near:${net}` as const;
const signer = createFacilitatorNearSigner({
  relayers: [{ accountId: need(`${NET}_X402_RELAYER_ID`), secretKey: need("X402_RELAYER_KEY") as `ed25519:${string}` }],
  rpcUrls: { [network]: need(`${NET}_RPC_URL`) },
});
const core = new x402Facilitator().register(network, new ExactNearScheme(signer));

const app = createFacilitatorApp({
  core,
  apiKeys: [need("X402_API_KEY")],
  policy: { network, asset: need(`${NET}_USDC_ID`), payTo: need(`${NET}_CONTRACT_ID`) },
});
const port = Number(env.PORT || 8790);
serve({ fetch: app.fetch, port }, () => console.log(JSON.stringify({ level: "info", msg: "facilitator listening", port, network })));
