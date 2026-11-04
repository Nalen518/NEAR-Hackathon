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
  x402ApiKey: string | null;
  /** Indexer that lists the calls our contract received (events.ts); null turns the reader off */
  eventsUrl: string | null;
  /** Where agents reach this Shark, for the x402 `resource` (ARCHITECTURE §9 `PUBLIC_BASE_URL`) */
  publicBaseUrl: string;
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
  /** Worker RFQ endpoints by account (API §2.1). */
  workerUrls: Record<string, string>;
  /** Shark's USDC wallet for escrow and keepers (FR-34). shortcut: a testnet account key until the OutLayer wallet */
  walletId: string | null;
  walletKey: string | null;
  /** Base Sepolia RPC and Raven's address on it; both null until the owner gives them */
  evmRpcUrl: string | null;
  ravenEvmAddress: string | null;
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
    x402ApiKey: env[`${NET}_X402_API_KEY`] || null,
    eventsUrl: (env[`${NET}_EVENTS_URL`] ?? (network === "testnet" ? "https://api-testnet.nearblocks.io" : "https://api.nearblocks.io")) === "off" ? null : (env[`${NET}_EVENTS_URL`] ?? (network === "testnet" ? "https://api-testnet.nearblocks.io" : "https://api.nearblocks.io")),
    publicBaseUrl: (env.PUBLIC_BASE_URL ?? "http://localhost:8787").replace(/\/$/, ""),
    webOrigins: (env.WEB_ORIGINS ?? "http://localhost:3100,http://localhost:3000").split(",").map((s) => s.trim()).filter(Boolean),
    version: env.SHARK_VERSION ?? "0.1.0",
    quoteKey: env.SHARK_QUOTE_KEY ?? (() => { throw new Error("SHARK_QUOTE_KEY is not set"); })(),
    sharkId: env[`${NET}_SHARK_ID`] || null,
    sharkKey: env.SHARK_FN_KEY || null,
    fileStorePath: env.FILE_STORE_PATH ?? "./data",
    rateLimitPerMin: Number(env.RATE_LIMIT_PER_MIN ?? 30),
    agents: { crab: env[`${NET}_CRAB_ID`] || null, raven: env[`${NET}_RAVEN_ID`] || null, owl: env[`${NET}_OWL_ID`] || null },
    trezuUrl: env[`${NET}_TREZU_URL`] || null,
    workerUrls: Object.fromEntries(
      (["CRAB", "RAVEN"] as const).flatMap((w) => (env[`${NET}_${w}_ID`] && env[`${NET}_${w}_URL`] ? [[env[`${NET}_${w}_ID`]!, env[`${NET}_${w}_URL`]!]] : [])),
    ),
    walletId: env[`${NET}_SHARK_WALLET_ID`] || null,
    walletKey: env.SHARK_WALLET_KEY || null,
    evmRpcUrl: env[`${NET}_EVM_RPC_URL`] || null,
    ravenEvmAddress: env[`${NET}_RAVEN_EVM_ADDRESS`] || null,
  };
}
