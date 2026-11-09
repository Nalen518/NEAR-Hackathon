"use client";
// Live wallet (W6): NEAR Wallet Selector. Loaded only when NEXT_PUBLIC_API_MODE=live, so mock builds stay small.
// Popup and extension wallets only: a redirect wallet (MyNearWallet) would leave the page and lose the quote.
import { actionCreators, setupWalletSelector, type WalletSelector } from "@near-wallet-selector/core";
import { setupHereWallet } from "@near-wallet-selector/here-wallet";
import { setupIntearWallet } from "@near-wallet-selector/intear-wallet";
import { setupMeteorWallet } from "@near-wallet-selector/meteor-wallet";
import { setupModal, type WalletSelectorModal } from "@near-wallet-selector/modal-ui";
import "@near-wallet-selector/modal-ui/styles.css";
import type { SignedMessage } from "@shark/shared";
import { NETWORKS, type Network } from "./network";
import type { ContractCall } from "./wallet";

const MODULES = { "meteor-wallet": setupMeteorWallet, "here-wallet": setupHereWallet, "intear-wallet": setupIntearWallet } as const;

/** NEXT_PUBLIC_<NET>_WALLETS: comma separated ids from MODULES. Empty means all of them. */
function modulesFor(network: Network) {
  const wanted = NETWORKS[network].wallets.filter((w): w is keyof typeof MODULES => w in MODULES);
  return (wanted.length ? wanted : (Object.keys(MODULES) as (keyof typeof MODULES)[])).map((id) => MODULES[id]());
}

const selectors = new Map<Network, Promise<{ selector: WalletSelector; modal: WalletSelectorModal }>>();

function selectorFor(network: Network) {
  let s = selectors.get(network);
  if (!s) {
    const net = NETWORKS[network];
    if (!net.rpc) return Promise.reject(new Error(`NEXT_PUBLIC_${network.toUpperCase()}_RPC_URL isn’t set.`));
    const explorerUrl = net.nearTx.replace(/\/txns\/$/, "");
    // Wallet Selector wants "testnet" / "mainnet", not the CAIP-2 id ("near:testnet") the env may hold
    s = setupWalletSelector({ network: { networkId: network, nodeUrl: net.rpc, helperUrl: "", explorerUrl, indexerUrl: "" }, modules: modulesFor(network) }).then((selector) => ({
      selector,
      modal: setupModal(selector, {}),
    }));
    selectors.set(network, s);
  }
  return s;
}

const active = (selector: WalletSelector) => selector.store.getState().accounts.find((a) => a.active)?.accountId ?? null;

/** Opens the wallet picker unless an account is already signed in. Rejects if the picker is closed without one. */
export async function connect(network: Network): Promise<string> {
  const { selector, modal } = await selectorFor(network);
  const signedIn = active(selector);
  if (signedIn) return signedIn;
  return new Promise<string>((resolve, reject) => {
    const subs = [
      selector.on("signedIn", ({ accounts }) => done(() => (accounts[0] ? resolve(accounts[0].accountId) : reject(new Error("The wallet returned no account."))))),
      modal.on("onHide", ({ hideReason }) => hideReason === "user-triggered" && done(() => reject(new Error("No wallet was connected. Nothing was shared.")))),
    ];
    const done = (f: () => void) => {
      subs.forEach((s) => s.remove());
      f();
    };
    modal.show();
  });
}

export async function disconnect(network: Network) {
  const s = selectors.get(network);
  if (!s) return;
  const { selector } = await s;
  if (selector.isSignedIn()) await (await selector.wallet()).signOut();
}

/** One function call, signed and sent by the user's wallet. Resolves with the tx hash. */
export async function call(network: Network, c: ContractCall): Promise<string> {
  const { selector } = await selectorFor(network);
  const wallet = await selector.wallet();
  const outcome = await wallet.signAndSendTransaction({
    receiverId: c.contract,
    actions: [actionCreators.functionCall(c.method, c.args, BigInt(c.gas), BigInt(c.deposit))],
  });
  if (!outcome) throw new Error("The wallet didn’t return the transaction. Check it in your wallet.");
  return outcome.transaction.hash;
}

/** NEP-413 signMessage as Shark checks it (API §1.5a): recipient is the contract id, nonce 32 random bytes, base64. */
export async function signMessage(network: Network, message: string): Promise<SignedMessage> {
  const { selector } = await selectorFor(network);
  const wallet = await selector.wallet();
  const recipient = NETWORKS[network].contract;
  if (!recipient) throw new Error("The contract id isn’t set for this network.");
  const nonce = crypto.getRandomValues(new Uint8Array(32));
  // The wallets read the nonce as bytes (Array.from), so a Uint8Array works without a Buffer polyfill.
  const res = await wallet.signMessage({ message, recipient, nonce: nonce as unknown as Buffer });
  if (!res) throw new Error("The wallet didn’t return a signature. Nothing was shared.");
  return { accountId: res.accountId, publicKey: res.publicKey, signature: res.signature, message, nonce: btoa(String.fromCharCode(...nonce)), recipient };
}
