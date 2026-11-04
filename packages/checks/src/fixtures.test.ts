// Shared fixtures (API §4.3, NFR-02): fixtures/checks/<type>/<case>.json = { brief, source, delivery, expected }.
// The TypeScript checks here and the Rust port in owl/checks must produce the same `expected` for every file.
// `UPDATE_FIXTURES=1 pnpm test` rewrites the files from the cases below; review the diff before committing.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Brief } from "@shark/shared";
import { describe, expect, it } from "vitest";
import { runCodeChecks } from "./index";

const ROOT = join(__dirname, "../../../fixtures/checks");
type Case = { type: "summary" | "thread" | "extract"; name: string; brief: Brief; source?: string; delivery: string };

const code = (id: string, rule: string) => ({ id, kind: "code" as const, rule });
const model = (id: string, rule: string) => ({ id, kind: "model" as const, rule });

const summary = (over: Record<string, unknown> = {}, rules = ["word_count <= 20", "mentions_all", "language == en"]): Brief => ({
  jobType: "summary",
  params: { maxWords: 20, mustMention: ["NEAR Intents", "fees"], language: "en", format: "paragraph", ...over },
  checklist: [...rules.map((r, i) => code(`C${i + 1}`, r)), model("M1", "every claim is supported by the source")],
  deliverableFormat: "text/plain",
});
const thread = (over: Record<string, unknown> = {}): Brief => ({
  jobType: "thread",
  params: { posts: 2, mustInclude: ["https://example.com/launch", "#NEAR", "@example_brand"], tone: "neutral", ...over },
  checklist: [code("C1", "post_count == 2"), code("C2", "post_length <= 280"), code("C3", "includes_all"), code("C4", "no_extra_handles"), model("M1", "on topic")],
  deliverableFormat: "application/json",
});
const FIELDS = [
  { name: "name", type: "string", required: true },
  { name: "price", type: "number", required: true },
  { name: "date", type: "date", required: false },
];
const extract = (over: Record<string, unknown> = {}, records = 3): Brief => ({
  jobType: "extract",
  params: { schema: { fields: FIELDS }, many: true, maxRecords: records, ...over },
  checklist: [code("C1", "json_parses"), code("C2", "matches_schema"), code("C3", "required_fields_filled"), code("C4", "traceable >= 90%"), code("C5", `records <= ${records}`), model("M1", "no invented records")],
  deliverableFormat: "application/json",
});
const CATALOGUE = "Our catalogue: Blue Mug costs 12.50 since 2026-10-01. Red Plate costs 1,200 since 2026-09-15.";
const posts = (...p: string[]) => JSON.stringify({ posts: p });

const CASES: Case[] = [
  { type: "summary", name: "pass", brief: summary(), delivery: "NEAR Intents lets people swap across chains and the fees are low for everyone." },
  { type: "summary", name: "fail_length_items_language", brief: summary(), delivery: "Ceci est un résumé très long qui ne parle pas du sujet demandé et qui dépasse la limite de mots fixée pour ce travail précis." },
  { type: "summary", name: "other_language_passes_untested", brief: summary({ language: "fr" }, ["language == fr"]), delivery: "Un court résumé en français." },
  { type: "summary", name: "bullets_pass", brief: summary({ format: "bullets" }, ["format == bullets"]), delivery: "- one\n- two\n3. three" },
  { type: "summary", name: "bullets_fail", brief: summary({ format: "bullets" }, ["format == bullets"]), delivery: "one paragraph only" },
  { type: "summary", name: "mention_is_case_and_space_insensitive", brief: summary({ mustMention: ["NEAR Intents"] }, ["mentions_all"]), delivery: "near   INTENTS is mentioned." },
  { type: "summary", name: "unknown_rule_fails_closed", brief: summary({}, ["word_count >= 1"]), delivery: "text" },
  { type: "thread", name: "pass", brief: thread(), delivery: posts("We launched today with @example_brand #NEAR", "Read more https://example.com/launch") },
  { type: "thread", name: "fail_count_length_items_handles", brief: thread(), delivery: posts(`${"x".repeat(281)} @someone_else`) },
  { type: "thread", name: "a_link_counts_23", brief: thread(), delivery: posts(`${"a".repeat(250)} https://example.com/${"x".repeat(200)} #NEAR @example_brand`, "b") },
  { type: "thread", name: "emoji_count_2", brief: thread({ mustInclude: [] }), delivery: posts("😀".repeat(140), "😀".repeat(141)) },
  { type: "thread", name: "cjk_count_2", brief: thread({ mustInclude: [] }), delivery: posts("語".repeat(140), "語".repeat(141)) },
  { type: "thread", name: "not_json", brief: thread(), delivery: "post one\npost two" },
  { type: "extract", name: "pass", brief: extract(), source: CATALOGUE, delivery: JSON.stringify([{ name: "Blue Mug", price: 12.5, date: "2026-10-01" }, { name: "Red Plate", price: 1200, date: null }]) },
  { type: "extract", name: "fail_schema_trace_count", brief: extract(), source: CATALOGUE, delivery: JSON.stringify([{ name: "Blue Mug", price: "12.50" }, { name: "", price: 3 }, { name: "Green Bowl", price: 99 }, { name: "Red Plate", price: 1200, colour: "red" }]) },
  { type: "extract", name: "not_json", brief: extract(), source: CATALOGUE, delivery: "Blue Mug, 12.50" },
  { type: "extract", name: "one_record_when_many_is_false", brief: extract({ many: false }), source: CATALOGUE, delivery: JSON.stringify({ name: "Blue Mug", price: 12.5 }) },
  { type: "extract", name: "dates_must_be_real_iso_dates", brief: extract({ many: true }), source: "A 2026-02-30 B 2026-10-01 C 2024-02-29 D 2026-13-01 E 2026-10-01T09:30:00Z F Oct 1", delivery: JSON.stringify([{ name: "A", price: 1, date: "2026-02-30" }, { name: "B", price: 1, date: "2026-10-01" }, { name: "C", price: 1, date: "2024-02-29" }, { name: "D", price: 1, date: "2026-13-01" }, { name: "E", price: 1, date: "2026-10-01T09:30:00Z" }, { name: "F", price: 1, date: "Oct 1" }]) },
  { type: "extract", name: "numbers_match_the_source_ignoring_commas_and_zeros", brief: extract(), source: "Total 1,234,567.80 and 0.5 and 12", delivery: JSON.stringify([{ name: "Total 1,234,567.80", price: 1234567.8 }, { name: "Half", price: 0.50 }, { name: "Twelve", price: 12.0 }]) },
  { type: "extract", name: "url_and_enum_types", brief: { ...extract(), params: { schema: { fields: [{ name: "link", type: "url", required: true }, { name: "kind", type: "enum", required: true, values: ["a", "b"] }] }, many: true, maxRecords: 3 } }, source: "https://example.com/x a", delivery: JSON.stringify([{ link: "https://example.com/x", kind: "a" }, { link: "ftp://nope", kind: "c" }]) },
];

const file = (c: Case) => join(ROOT, c.type, `${c.name}.json`);

describe("shared fixtures (TypeScript side)", () => {
  if (process.env.UPDATE_FIXTURES) {
    it("rewrites fixtures/checks from the cases", () => {
      for (const c of CASES) {
        mkdirSync(join(ROOT, c.type), { recursive: true });
        writeFileSync(file(c), `${JSON.stringify({ brief: c.brief, source: c.source ?? "", delivery: c.delivery, expected: runCodeChecks(c.brief, c.source ?? "", c.delivery) }, null, 2)}\n`);
      }
    });
    return;
  }
  for (const type of ["summary", "thread", "extract"]) {
    for (const f of readdirSync(join(ROOT, type)).filter((x) => x.endsWith(".json"))) {
      it(`${type}/${f}`, () => {
        const fx = JSON.parse(readFileSync(join(ROOT, type, f), "utf8")) as { brief: Brief; source: string; delivery: string; expected: unknown };
        expect(runCodeChecks(fx.brief, fx.source, fx.delivery)).toEqual(fx.expected);
      });
    }
  }
  it("every case has a fixture file", () => {
    for (const c of CASES) expect(() => readFileSync(file(c), "utf8"), file(c)).not.toThrow();
  });
});
