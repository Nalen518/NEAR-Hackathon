"use client";
// The build is testnet only (owner, 9 Nov): one Shark, one contract, test USDC. Every value comes from the testnet
// profile (API §5.1 env names). Defaults are the public explorer URLs only.
import { useSearchParams } from "next/navigation";
import type { Network } from "@shark/shared";

export type { Network };

export type NetworkConfig = {
  id: Network;
  /** Shark API base URL; empty means "not deployed yet". */
  api: string;
  rpc: string;
  contract: string;
  usdc: string;
  /** Where people get test USDC. */
  faucet: string;
  /** Wallet Selector modules offered (comma list). */
  wallets: string[];
  caption: string;
  /** Where Raven is paid. */
  baseChain: string;
  /** Tx explorers for proof links. */
  nearTx: string;
  baseTx: string;
};

// NEXT_PUBLIC_* must be referenced literally so Next can inline them.
export const NETWORKS: Record<Network, NetworkConfig> = {
  testnet: {
    id: "testnet",
    api: process.env.NEXT_PUBLIC_TESTNET_API_URL ?? "",
    rpc: process.env.NEXT_PUBLIC_TESTNET_RPC_URL ?? "",
    contract: process.env.NEXT_PUBLIC_TESTNET_CONTRACT_ID ?? "",
    usdc: process.env.NEXT_PUBLIC_TESTNET_USDC_ID ?? "",
    faucet: process.env.NEXT_PUBLIC_TESTNET_USDC_FAUCET_URL ?? "",
    wallets: (process.env.NEXT_PUBLIC_TESTNET_WALLETS ?? "").split(",").filter(Boolean),
    caption: "Testnet · test USDC",
    baseChain: "Base Sepolia",
    nearTx: `${process.env.NEXT_PUBLIC_TESTNET_EXPLORER_URL || "https://testnet.nearblocks.io"}/txns/`,
    baseTx: `${process.env.NEXT_PUBLIC_TESTNET_EVM_EXPLORER_URL || "https://sepolia.basescan.org"}/tx/`,
  },
};

/** `mock` (fixtures, always Sample) unless explicitly set to `live`. */
export const API_MODE: "mock" | "live" = process.env.NEXT_PUBLIC_API_MODE === "live" ? "live" : "mock";

const NETWORK: Network = "testnet";

export function useNetwork() {
  return { network: NETWORK, config: NETWORKS[NETWORK] };
}

/** Keeps dev ?mock= on internal links. */
export function useHref() {
  const params = useSearchParams();
  return (path: string) => {
    const mock = params.get("mock");
    const [base, hash] = path.split("#");
    return `${base}${mock ? `?mock=${mock}` : ""}${hash ? `#${hash}` : ""}`;
  };
}
