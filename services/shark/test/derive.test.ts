import { secp256k1 } from "@noble/curves/secp256k1";
import { describe, expect, it } from "vitest";
// @ts-expect-error a plain script with no types
import { deriveChildKey, evmAddress, pointOf } from "../scripts/derive-address.mjs";

// Read from v1.signer-prod.testnet: public_key, and derived_public_key for sharkco.testnet and the path base-payouts.
const ROOT = "secp256k1:4NfTiv3UsGahebgTaHyD9vF8KYKMBnfd6kh94mK6xv8fGBiJB8TBtFMP5WWXz6B89Ac1fbpzPwAvoyQebemHFwx3";
const DERIVED = "secp256k1:3JfACrTPQM7WEgxKwwjS3pWK5GgmHbecupyAat9vnJn9hpmkxQW9RRjttUgR9FRvCe1c1ERRz5DvfQzckRQ58AzV";

describe("Chain Signatures address (scripts/derive-address.mjs)", () => {
  it("derives the same key the MPC contract reports for an account and a path", () => {
    expect(deriveChildKey(ROOT, "sharkco.testnet", "base-payouts").equals(pointOf(DERIVED))).toBe(true);
    expect(deriveChildKey(ROOT, "sharkco.testnet", "other").equals(pointOf(DERIVED))).toBe(false);
    expect(deriveChildKey(ROOT, "other.testnet", "base-payouts").equals(pointOf(DERIVED))).toBe(false);
  });
  it("turns a key into the checksummed EVM address (private key 1 is the well known 0x7E5F...)", () => {
    expect(evmAddress(secp256k1.ProjectivePoint.BASE)).toBe("0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf");
    expect(evmAddress(pointOf(DERIVED))).toBe("0x3A3Fa9e6Df65F800ea24a99ad9191fa18b611440");
  });
});

describe("gas gauge config", () => {
  it("reads Base Sepolia from the public RPC on testnet unless another is set, and needs the address", async () => {
    const { loadConfig } = await import("../src/config");
    const env = { SHARK_NETWORK: "testnet", TESTNET_RPC_URL: "x", TESTNET_CONTRACT_ID: "c", TESTNET_USDC_ID: "u", SHARK_QUOTE_KEY: "k" };
    expect(loadConfig(env)).toMatchObject({ evmRpcUrl: "https://sepolia.base.org", payoutEvmAddress: null });
    expect(loadConfig({ ...env, TESTNET_EVM_RPC_URL: "https://base.example", TESTNET_PAYOUT_EVM_ADDRESS: "0xabc" })).toMatchObject({ evmRpcUrl: "https://base.example", payoutEvmAddress: "0xabc" });
  });
});
