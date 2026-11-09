import { describe, expect, it } from "vitest";
import { addUsdc, bpsToPct, formatUsdc, fromBase, toBase } from "./money";

describe("money", () => {
  it("toBase", () => {
    expect(toBase("0.075")).toBe(75_000n);
    expect(toBase("1")).toBe(1_000_000n);
    expect(toBase("2.000000")).toBe(2_000_000n);
    expect(toBase("128.00")).toBe(128_000_000n);
    expect(toBase("0.000001")).toBe(1n);
  });

  it("rejects invalid strings", () => {
    for (const bad of ["", "1.", ".5", "-1", "1.0000001", "1e3", " 1", "1,00", "NaN", "0x10"]) {
      expect(() => toBase(bad)).toThrow();
    }
  });

  it("fromBase", () => {
    expect(fromBase(75_000n)).toBe("0.075");
    expect(fromBase(1_000_000n)).toBe("1.00");
    expect(fromBase(1n)).toBe("0.000001");
    expect(fromBase(0n)).toBe("0.00");
    expect(fromBase(-435_000n)).toBe("-0.435");
  });

  it("formatUsdc names test USDC on testnet", () => {
    expect(formatUsdc("1", { network: "testnet" })).toBe("1.00 test USDC");
    expect(formatUsdc("2.000000", { network: "testnet" })).toBe("2.00 test USDC");
    expect(formatUsdc("0.075", { network: "testnet", unit: false })).toBe("0.075");
  });

  it("bpsToPct", () => {
    expect(bpsToPct(1234)).toBe("12.34%");
    expect(bpsToPct(1234, { dp: 1, signed: true })).toBe("+12.3%");
    expect(bpsToPct(1235, { dp: 1 })).toBe("12.4%");
    expect(bpsToPct(-812, { dp: 1 })).toBe("−8.1%");
    expect(bpsToPct(750, { dp: 0 })).toBe("8%");
    expect(bpsToPct(5)).toBe("0.05%");
    expect(() => bpsToPct(1.5)).toThrow();
  });

  it("addUsdc is exact", () => {
    expect(addUsdc("0.1", "0.2")).toBe("0.30");
    expect(addUsdc("46.80", "7.80")).toBe("54.60");
  });
});

describe("OrderRequest (FR-01)", () => {
  it("caps instructions at 2 000 chars and needs a known job type", async () => {
    const { OrderRequest } = await import("./schemas");
    const ok = { jobType: "summary", instructions: "Summarise this.", input: { url: "https://example.com/a" }, payer: "demo-buyer.testnet" };
    expect(OrderRequest.safeParse(ok).success).toBe(true);
    expect(OrderRequest.safeParse({ ...ok, instructions: "x".repeat(2001) }).success).toBe(false);
    expect(OrderRequest.safeParse({ ...ok, jobType: "image" }).success).toBe(false);
  });

  it("keeps every job type's params (summary params used to strip thread params)", async () => {
    const { OrderRequest } = await import("./schemas");
    const base = { instructions: "Do the job.", payer: "demo-buyer.testnet" };
    const thread = { posts: 5, mustInclude: ["#NEAR"], tone: "friendly", topic: "launch" };
    expect(OrderRequest.parse({ ...base, jobType: "thread", params: thread }).params).toEqual(thread);
    const summary = { maxWords: 150, mustMention: ["fees"], language: "en", format: "bullets" };
    expect(OrderRequest.parse({ ...base, jobType: "summary", params: summary }).params).toEqual(summary);
    const extract = { schema: { fields: [{ name: "price", type: "number", required: true }] }, many: true, maxRecords: 10 };
    expect(OrderRequest.parse({ ...base, jobType: "extract", params: extract }).params).toEqual(extract);
    expect(OrderRequest.safeParse({ ...base, jobType: "summary", params: { maxWord: 150 } }).success).toBe(false);
  });
});

describe("v2 Company shapes", () => {
  it("rejects ETH amounts that aren't decimal strings, and keeps returned quotes in the fixture", async () => {
    const { EthAmount, Company } = await import("./schemas");
    const { readFileSync } = await import("node:fs");
    expect(EthAmount.safeParse("0.0042").success).toBe(true);
    expect(EthAmount.safeParse("d42").success).toBe(false);
    expect(EthAmount.safeParse("1e-3").success).toBe(false);
    const c = Company.parse(JSON.parse(readFileSync(new URL("../fixtures/api/company.json", import.meta.url), "utf8")));
    expect(c.prices.recentQuotes.some((q) => q.status === "returned" && q.returnReason)).toBe(true);
    // v2.3 "could" fields may be absent: a v2.2 style company still parses with empty logs.
    const { auctions: _a, incidents: _i, ...v22 } = JSON.parse(readFileSync(new URL("../fixtures/api/company.json", import.meta.url), "utf8"));
    const old = Company.parse({ ...v22, sample: { ...v22.sample, auctions: undefined, incidents: undefined } });
    expect(old.auctions).toEqual([]);
    expect(old.sample.auctions).toBe(true);
    expect(c.owners.openProposals.every((o) => c.owners.proposals.find((p) => p.id === o.id)?.status === "open")).toBe(true);
  });
});
