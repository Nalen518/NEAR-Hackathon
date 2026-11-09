"use client";
// NEAR wallet for the Order and Job pages. The user signs in their own wallet; this app never holds keys.
import { useCallback, useRef, useState } from "react";
import { mockChainCall } from "@/mocks/scenarios";
import type { SignedMessage } from "@shark/shared";
import { API_MODE, NETWORKS, type Network } from "./network";

/** One contract call exactly as the API hands it over (§1.1 pay / register, §1.6 faucet). */
export type ContractCall = {
  contract: string;
  method: string;
  args: Record<string, unknown>;
  gas: string; // gas units
  deposit: string; // yoctoNEAR
};

export type Wallet = {
  accountId: string | null;
  busy: boolean;
  /** Resolves with the connected account. */
  connect(): Promise<string>;
  disconnect(): void;
  /** Sends one function call and resolves with the tx hash once the wallet returns. */
  call(c: ContractCall): Promise<string>;
  /** NEP-413 signMessage: proves the account without a transaction (D-166 payer view, complaints). */
  signMessage(message: string): Promise<SignedMessage>;
};

// Live mode uses NEAR Wallet Selector (lib/wallet-live.ts, loaded on first use). Mock mode signs against mocks/scenarios.
const live = () => import("./wallet-live");

export function useWallet(network: Network): Wallet {
  const [accountId, setAccountId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // call() can run right after connect() in the same click, before the re-render; read the account from here.
  const signer = useRef<{ id: string; network: Network } | null>(null);
  const [forNetwork, setForNetwork] = useState(network);
  if (forNetwork !== network) {
    // switching networks re-initialises the wallet (API §0.3 N2)
    setForNetwork(network);
    setAccountId(null);
  }

  const connect = useCallback(async () => {
    if (API_MODE === "live") {
      setBusy(true);
      try {
        const id = await (await live()).connect(network);
        signer.current = { id, network };
        setAccountId(id);
        return id;
      } finally {
        setBusy(false);
      }
    }
    setBusy(true);
    await new Promise((r) => setTimeout(r, 400));
    const id = network === "testnet" ? "demo-buyer.testnet" : "demo-buyer.near";
    signer.current = { id, network };
    setAccountId(id);
    setBusy(false);
    return id;
  }, [network]);

  const call = useCallback(
    async (c: ContractCall) => {
      const id = signer.current?.network === network ? signer.current.id : null;
      if (!id) throw new Error("Connect a NEAR wallet first.");
      setBusy(true);
      try {
        if (API_MODE === "live") return await (await live()).call(network, c);
        await new Promise((r) => setTimeout(r, 700)); // the user approving in their wallet
        return mockChainCall(id, c.method, c.args);
      } finally {
        setBusy(false);
      }
    },
    [network],
  );

  const signMessage = useCallback(
    async (message: string): Promise<SignedMessage> => {
      const id = signer.current?.network === network ? signer.current.id : null;
      if (!id) throw new Error("Connect a NEAR wallet first.");
      setBusy(true);
      try {
        if (API_MODE === "live") return await (await live()).signMessage(network, message);
        await new Promise((r) => setTimeout(r, 500)); // the user approving in their wallet
        const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
        return { accountId: id, publicKey: "ed25519:SAMPLE", signature: "SAMPLE", message, nonce, recipient: NETWORKS[network].contract || "sharkco.testnet" };
      } finally {
        setBusy(false);
      }
    },
    [network],
  );

  const disconnect = useCallback(() => {
    signer.current = null;
    setAccountId(null);
    if (API_MODE === "live") void live().then((w) => w.disconnect(network));
  }, [network]);

  return { accountId, busy, connect, disconnect, call, signMessage };
}
