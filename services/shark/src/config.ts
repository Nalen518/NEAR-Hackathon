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
  /** Signs quotes only (NFR-04). NEAR key format "ed25519:..." */
  quoteKey: string;
  /** Shark's account and function-call key, for complain/award/... (optional until those calls are needed) */
  sharkId: string | null;
  sharkKey: string | null;
  fileStorePath: string;
  rateLimitPerMin: number;
  /** Agent accounts → the names the web shows (API §5.1 `<NET>_*_ID`). */
  agents: { crab: string | null; raven: string | null; owl: string | null };
  trezuUrl: string | null;
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
    quoteKey: env.SHARK_QUOTE_KEY ?? (() => { throw new Error("SHARK_QUOTE_KEY is not set"); })(),
    sharkId: env[`${NET}_SHARK_ID`] || null,
    sharkKey: env.SHARK_FN_KEY || null,
    fileStorePath: env.FILE_STORE_PATH ?? "./data",
    rateLimitPerMin: Number(env.RATE_LIMIT_PER_MIN ?? 30),
    agents: { crab: env[`${NET}_CRAB_ID`] || null, raven: env[`${NET}_RAVEN_ID`] || null, owl: env[`${NET}_OWL_ID`] || null },
    trezuUrl: env[`${NET}_TREZU_URL`] || null,
  };
}
