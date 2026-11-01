import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createSharkClient, NetworkMismatchError } from "./client";

const fixture = (f: string) => readFileSync(join(__dirname, "../fixtures/api", f), "utf8");
const serve = (body: string, status = 200): typeof fetch => async () => new Response(body, { status, headers: { "Content-Type": "application/json" } });

describe("network binding (API §0.3 N1)", () => {
  it("accepts a response from the selected network", async () => {
    const c = createSharkClient("http://x", serve(fixture("health.json")), "near:testnet");
    await expect(c.health()).resolves.toMatchObject({ network: "near:testnet" });
  });
  it("rejects a response that states the other network", async () => {
    const c = createSharkClient("http://x", serve(fixture("company.json")), "near:mainnet");
    await expect(c.company()).rejects.toBeInstanceOf(NetworkMismatchError);
  });
  it("checks the signed quote's network on a 402", async () => {
    const c = createSharkClient("http://x", serve(fixture("quote-402.json"), 402), "near:mainnet");
    await expect(c.order402({ jobType: "summary", instructions: "x", payer: "a.near" }, "k")).rejects.toBeInstanceOf(NetworkMismatchError);
  });
  it("skips the check when no network is expected", async () => {
    const c = createSharkClient("http://x", serve(fixture("company.json")));
    await expect(c.company()).resolves.toBeTruthy();
  });
});
