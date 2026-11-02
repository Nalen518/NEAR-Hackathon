import type { Brief } from "@shark/shared";
import { describe, expect, it } from "vitest";
import { runCodeChecks, type CodeChecks } from "./index";

const summary: Brief = {
  jobType: "summary",
  params: { maxWords: 20, mustMention: ["NEAR Intents", "fees"], language: "en", format: "paragraph" },
  checklist: [
    { id: "C1", kind: "code", rule: "word_count <= 20" },
    { id: "C2", kind: "code", rule: "mentions_all" },
    { id: "C3", kind: "code", rule: "language == en" },
    { id: "M1", kind: "model", rule: "every claim is supported by the source" },
  ],
  deliverableFormat: "text/plain",
};
const thread: Brief = {
  jobType: "thread",
  params: { posts: 2, mustInclude: ["https://example.com/launch", "#NEAR", "@example_brand"], tone: "neutral" },
  checklist: [
    { id: "C1", kind: "code", rule: "post_count == 2" },
    { id: "C2", kind: "code", rule: "post_length <= 280" },
    { id: "C3", kind: "code", rule: "includes_all" },
    { id: "C4", kind: "code", rule: "no_extra_handles" },
    { id: "M1", kind: "model", rule: "on topic" },
  ],
  deliverableFormat: "application/json",
};
const extract: Brief = {
  jobType: "extract",
  params: { schema: { fields: [{ name: "name", type: "string", required: true }, { name: "price", type: "number", required: true }, { name: "date", type: "date", required: false }] }, many: true, maxRecords: 3 },
  checklist: [
    { id: "C1", kind: "code", rule: "json_parses" },
    { id: "C2", kind: "code", rule: "matches_schema" },
    { id: "C3", kind: "code", rule: "required_fields_filled" },
    { id: "C4", kind: "code", rule: "traceable >= 90%" },
    { id: "C5", kind: "code", rule: "records <= 3" },
    { id: "M1", kind: "model", rule: "no invented records" },
  ],
  deliverableFormat: "application/json",
};
const catalogue = "Our catalogue: Blue Mug costs 12.50 since 2026-10-01. Red Plate costs 1,200 since 2026-09-15.";

const details = (r: CodeChecks) => r.checks.map((c) => c.detail);
function copyOk(r: CodeChecks) {
  for (const d of details(r)) {
    expect(d.length).toBeLessThanOrEqual(40);
    expect(d).not.toMatch(/[;—–]|\w-\w/); // D-170
  }
}

describe("summary", () => {
  it("passes with details", () => {
    const r = runCodeChecks(summary, "", "NEAR Intents lets users swap across chains and the fees are low for everyone.");
    expect(r.codes).toEqual([]);
    expect(details(r)).toEqual(["14 words", "both found", "en"]);
    expect(r.checks.map((c) => c.id)).toEqual(["C1", "C2", "C3"]); // model checks are Owl's
    copyOk(r);
  });
  it("fails length, missing items and language", () => {
    const r = runCodeChecks(summary, "", "Ceci est un résumé très long qui ne parle pas du sujet demandé et qui dépasse la limite de mots fixée pour ce travail précis.");
    expect(r.codes).toEqual(["FAIL_LENGTH", "FAIL_MISSING_ITEM", "FAIL_FORMAT"]);
    expect(details(r)[1]).toBe("0 of 2 found");
    copyOk(r);
  });
  it("checks bullets when asked", () => {
    const b: Brief = { ...summary, checklist: [{ id: "C1", kind: "code", rule: "format == bullets" }] };
    expect(runCodeChecks(b, "", "- one\n- two").codes).toEqual([]);
    expect(runCodeChecks(b, "", "one paragraph only").codes).toEqual(["FAIL_FORMAT"]);
  });
});

describe("thread", () => {
  const ok = JSON.stringify({ posts: ["We launched today with @example_brand #NEAR", "Read more https://example.com/launch"] });
  it("passes with details", () => {
    const r = runCodeChecks(thread, "", ok);
    expect(r.codes).toEqual([]);
    expect(details(r)).toEqual(["2 posts", "longest 43", "all found", "none extra"]);
    copyOk(r);
  });
  it("fails count, length, items and extra handles", () => {
    const r = runCodeChecks(thread, "", JSON.stringify({ posts: ["x".repeat(281) + " @someone_else"] }));
    expect(r.codes).toEqual(["FAIL_FORMAT", "FAIL_LENGTH", "FAIL_MISSING_ITEM", "FAIL_SAFETY"]);
    copyOk(r);
  });
  it("a link counts 23 however long it is", () => {
    const long = `${"a".repeat(250)} https://example.com/${"x".repeat(200)}`;
    expect(runCodeChecks(thread, "", JSON.stringify({ posts: [long, "b"] })).checks[1]).toMatchObject({ pass: true, detail: "longest 274" });
  });
  it("not JSON fails every check as format", () => {
    expect(runCodeChecks(thread, "", "post one\npost two").codes).toEqual(["FAIL_FORMAT"]);
  });
});

describe("extract", () => {
  const good = [
    { name: "Blue Mug", price: 12.5, date: "2026-10-01" },
    { name: "Red Plate", price: 1200, date: null },
  ];
  it("passes with details", () => {
    const r = runCodeChecks(extract, catalogue, JSON.stringify(good));
    expect(r.codes).toEqual([]);
    expect(details(r)).toEqual(["valid JSON", "2 records", "all filled", "100% found", "2 records"]);
    copyOk(r);
  });
  it("fails schema, required fields, traceability and record count", () => {
    const bad = [
      { name: "Blue Mug", price: "12.50" }, // price as a string: off schema
      { name: "", price: 3 }, // missing name
      { name: "Green Bowl", price: 99 }, // invented
      { name: "Red Plate", price: 1200, colour: "red" }, // extra key
    ];
    const r = runCodeChecks(extract, catalogue, JSON.stringify(bad));
    expect(r.codes).toEqual(["FAIL_SCHEMA", "FAIL_TRACEABILITY", "FAIL_LENGTH"]);
    copyOk(r);
  });
  it("not JSON is a format fail", () => {
    expect(runCodeChecks(extract, catalogue, "Blue Mug, 12.50").codes).toEqual(["FAIL_FORMAT", "FAIL_SCHEMA"]);
  });
  it("one record when many is false", () => {
    const one: Brief = { ...extract, params: { ...extract.params, many: false } };
    expect(runCodeChecks(one, catalogue, JSON.stringify(good[0])).codes).toEqual([]);
  });
});

it("an unknown rule fails closed", () => {
  const b: Brief = { ...summary, checklist: [{ id: "C9", kind: "code", rule: "word_count >= 1" }] };
  expect(runCodeChecks(b, "", "text").checks[0]).toMatchObject({ pass: false, detail: "unknown rule", code: "FAIL_FORMAT" });
});
