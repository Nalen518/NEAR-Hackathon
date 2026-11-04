import { describe, expect, it } from "vitest";
import { orderFor, toPublic } from "../mocks/scenarios";
import { mergePayerView } from "./payer-view";

const at = Date.parse("2026-11-05T08:13:02Z");

describe("mergePayerView", () => {
  it("keeps the private parts and takes the status from the public view", () => {
    const payer = orderFor("j_000042", "testnet", "ok", at);
    const pub = toPublic(orderFor("j_000042", "testnet", "complaint_review", at));
    const o = mergePayerView(payer, pub);
    expect(o.view).toBe("payer");
    expect(o.status).toBe("complaint_review");
    expect(o.instructions).toBe(payer.instructions);
    expect(o.delivery).toEqual(payer.delivery);
  });

  it("hides the delivery once the job is refunded (A9)", () => {
    const payer = orderFor("j_000042", "testnet", "ok", at);
    expect(payer.delivery).not.toBeNull();
    const o = mergePayerView(payer, toPublic(orderFor("j_000042", "testnet", "complaint_upheld", at)));
    expect(o.status).toBe("refunded");
    expect(o.delivery).toBeNull();
  });
});
