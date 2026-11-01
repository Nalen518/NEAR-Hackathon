// One Shark host serves exactly one network (API §0.3 N1). Every on-chain value comes from that
// network's profile (`<NET>_*` env vars, API §5.1). Nothing falls back to the other network.
import type { Network } from "@shark/shared";

export type Config = {
  network: Network;
  /** CAIP-2, e.g. "near:testnet". */
  networkId: "near:testnet" | "near:mainnet";
  rpcUrl: string;
  contractId: string;
  usdcId: string;
  usdcFaucetUrl: string | null;
  x402FacilitatorUrl: string | null;
  webOrigins: string[];
  version: string;
};

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const network = env.SHARK_NETWORK;
  if (network !== "testnet" && network !== "mainnet") throw new Error("SHARK_NETWORK must be testnet or mainnet");
  const NET = network.toUpperCase();
  const need = (name: string): string => {
    const v = env[`${NET}_${name}`];
    if (!v) throw new Error(`${NET}_${name} is not set`);
    return v;
  };
  return {
    network,
    networkId: `near:${network}`,
    rpcUrl: need("RPC_URL"),
    contractId: need("CONTRACT_ID"),
    usdcId: need("USDC_ID"),
    usdcFaucetUrl: env[`${NET}_USDC_FAUCET_URL`] || null,
    x402FacilitatorUrl: env[`${NET}_X402_FACILITATOR_URL`] || null,
    webOrigins: (env.WEB_ORIGINS ?? "http://localhost:3100,http://localhost:3000").split(",").map((s) => s.trim()).filter(Boolean),
    version: env.SHARK_VERSION ?? "0.1.0",
  };
}
