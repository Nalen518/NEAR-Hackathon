import { describe, expect, it } from "vitest";
import { checkLabel } from "./checklist";
import { jobNo, timeLeft, weightedLength, wordCount } from "./text";

describe("delivery counts", () => {
  it("weights links as 23 and emoji as 2", () => {
    expect(weightedLength("hi")).toBe(2);
    expect(weightedLength("go https://example.com/launch now")).toBe(3 + 23 + 4);
    expect(weightedLength("see example.com/launch")).toBe(4 + 23);
    expect(weightedLength("🚀")).toBe(2);
  });
  it("counts words and job numbers", () => {
    expect(wordCount("  one two\nthree ")).toBe(3);
    expect(jobNo("j_000042")).toBe("#0042");
    expect(jobNo("j_012345")).toBe("#12345");
  });
});

describe("checklist copy map", () => {
  it("maps the API's summary rules and falls back to the raw rule", () => {
    expect(checkLabel({ rule: "word_count <= 150" })).toBe("Word count is 150 or fewer");
    expect(checkLabel({ rule: "mentions_all" }, { mustMention: ["NEAR Intents", "fees"] })).toBe("Mentions “NEAR Intents” and “fees”");
    expect(checkLabel({ rule: "language == en" })).toBe("Written in English");
    expect(checkLabel({ rule: "something_new" })).toBe("something_new");
  });
});

describe("timeLeft", () => {
  it.each([
    [24 * 3_600_000, "24 h"],
    [3_600_000 + 1, "1 h"],
    [299_000, "4 min"],
    [59_999, "59 s"],
    [-5, "0 s"],
  ])("%d ms → %s", (ms, out) => expect(timeLeft(ms)).toBe(out));
});
