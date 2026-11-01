"use client";
// D-149 / API-CONTRACT §0.3: one web app, two deployments that never mix. Opens on Testnet; the choice lives in ?network=.
// Every value comes from the network profile (API §5.1 env names). Defaults are the public explorer URLs only.
import { useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import type { Network } from "@shark/shared";

export type { Network };

export type NetworkConfig = {
  id: Network;
  /** Wallet Selector networkId (`testnet` / `mainnet`). */
  networkId: string;
  /** Shark API base URL; empty means "not deployed yet". */
  api: string;
  rpc: string;
  contract: string;
  usdc: string;
  /** Where people get test USDC; empty on mainnet. */
  faucet: string;
  /** Wallet Selector modules offered (comma list), for W6. */
  wallets: string[];
  caption: string;
  /** Where Raven is paid on this deployment. */
  baseChain: string;
  /** Tx explorers for proof links. */
  nearTx: string;
  baseTx: string;
};

// NEXT_PUBLIC_* must be referenced literally so Next can inline them.
export const NETWORKS: Record<Network, NetworkConfig> = {
  testnet: {
    id: "testnet",
    networkId: process.env.NEXT_PUBLIC_TESTNET_NETWORK_ID || "testnet",
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
  mainnet: {
    id: "mainnet",
    networkId: process.env.NEXT_PUBLIC_MAINNET_NETWORK_ID || "mainnet",
    api: process.env.NEXT_PUBLIC_MAINNET_API_URL ?? "",
    rpc: process.env.NEXT_PUBLIC_MAINNET_RPC_URL ?? "",
    contract: process.env.NEXT_PUBLIC_MAINNET_CONTRACT_ID ?? "",
    usdc: process.env.NEXT_PUBLIC_MAINNET_USDC_ID ?? "",
    faucet: process.env.NEXT_PUBLIC_MAINNET_USDC_FAUCET_URL ?? "",
    wallets: (process.env.NEXT_PUBLIC_MAINNET_WALLETS ?? "").split(",").filter(Boolean),
    caption: "Live · small deployment",
    baseChain: "Base",
    nearTx: `${process.env.NEXT_PUBLIC_MAINNET_EXPLORER_URL || "https://nearblocks.io"}/txns/`,
    baseTx: `${process.env.NEXT_PUBLIC_MAINNET_EVM_EXPLORER_URL || "https://basescan.org"}/tx/`,
  },
};

const DEFAULT_NETWORK: Network = process.env.NEXT_PUBLIC_DEFAULT_NETWORK === "mainnet" ? "mainnet" : "testnet";

/** `mock` (fixtures, always Sample) unless explicitly set to `live`. */
export const API_MODE: "mock" | "live" = process.env.NEXT_PUBLIC_API_MODE === "live" ? "live" : "mock";

export function parseNetwork(v: string | null): Network {
  return v === "mainnet" || v === "testnet" ? v : DEFAULT_NETWORK;
}

export function useNetwork() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const network = parseNetwork(params.get("network"));

  const setNetwork = useCallback(
    (next: Network) => {
      if (next === network) return;
      const p = new URLSearchParams(params);
      p.set("network", next);
      queryClient.removeQueries(); // never show one deployment's numbers under the other's label
      router.replace(`${pathname}?${p}`, { scroll: false });
    },
    [network, params, pathname, queryClient, router],
  );

  return { network, config: NETWORKS[network], setNetwork };
}

/** Keeps ?network= (and dev ?mock=) on internal links. */
export function useHref() {
  const params = useSearchParams();
  return (path: string) => {
    const p = new URLSearchParams();
    for (const k of ["network", "mock"]) {
      const v = params.get(k);
      if (v) p.set(k, v);
    }
    const [base, hash] = path.split("#");
    return `${base}${p.size ? `?${p}` : ""}${hash ? `#${hash}` : ""}`;
  };
}
