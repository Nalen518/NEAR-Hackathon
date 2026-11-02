// Deterministic code checks per job type (SRD §8.2, FR-41). Owl runs them before its model check; Shark uses
// the same results for `reviews[].checks[].detail` (v2.3 P4). Model checks (kind "model") are not run here.
// `detail` is UI copy: at most 40 characters, no semicolons or dashes (D-170).
import { weightedLength, type Brief } from "@shark/shared";

export type ReviewCode = "FAIL_FORMAT" | "FAIL_SCHEMA" | "FAIL_LENGTH" | "FAIL_MISSING_ITEM" | "FAIL_TRACEABILITY" | "FAIL_FAITHFULNESS" | "FAIL_OFF_TOPIC" | "FAIL_SAFETY";
export type CheckResult = { id: string; pass: boolean; detail: string; code?: ReviewCode };
export type CodeChecks = { checks: CheckResult[]; codes: ReviewCode[] };

type Params = Record<string, unknown>;
type Field = { name: string; type: "string" | "number" | "date" | "url" | "enum"; required: boolean; values?: string[] };

const words = (s: string) => (s.match(/\S+/g) ?? []).length;
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const found = (n: number, of: number) => (of === 2 && n === 2 ? "both found" : n === of ? "all found" : `${n} of ${of} found`);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// A few of the most common English words; real English prose is full of them.
const EN = new Set("the a an and or of to in on for is are was were be it this that with as by at from not but have has".split(" "));
function looksEnglish(text: string): boolean {
  const ws = text.toLowerCase().match(/[a-z']+/g) ?? [];
  if (ws.length < 8) return true; // too short to judge
  return ws.filter((w) => EN.has(w)).length / ws.length >= 0.12;
}

function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

function fieldOk(f: Field, v: unknown): boolean {
  if (v === null || v === undefined) return true; // presence is required_fields_filled's job
  switch (f.type) {
    case "number":
      return typeof v === "number" && Number.isFinite(v);
    case "string":
      return typeof v === "string";
    case "date":
      return typeof v === "string" && !Number.isNaN(Date.parse(v));
    case "url":
      return typeof v === "string" && /^https?:\/\/\S+$/.test(v);
    case "enum":
      return typeof v === "string" && (f.values ?? []).includes(v);
  }
}

/** A value counts as traceable when its text (or a number's digits) appears in the normalized snapshot. */
function traceable(v: unknown, source: string): boolean {
  if (typeof v === "number") {
    const digits = source.replace(/(\d)[,\s](?=\d{3}\b)/g, "$1");
    return digits.includes(String(v)) || digits.includes(v.toFixed(2));
  }
  return typeof v === "string" && source.includes(norm(v));
}

/** Runs every `kind: "code"` item of the brief against the delivery. Unknown rules fail closed. */
export function runCodeChecks(brief: Brief, source: string, delivery: string): CodeChecks {
  const p = brief.params as Params;
  const checks: CheckResult[] = [];
  const add = (id: string, pass: boolean, detail: string, code: ReviewCode) => checks.push({ id, pass, detail, ...(pass ? {} : { code }) });
  const items = brief.checklist.filter((c) => c.kind === "code");

  if (brief.jobType === "summary") {
    const text = delivery.trim();
    for (const { id, rule } of items) {
      let m: RegExpMatchArray | null;
      if ((m = rule.match(/^word_count <= (\d+)$/))) {
        const n = words(text);
        add(id, n <= Number(m[1]), plural(n, "word"), "FAIL_LENGTH");
      } else if (rule === "mentions_all") {
        const terms = (p.mustMention as string[] | undefined) ?? [];
        const n = terms.filter((t) => norm(text).includes(norm(t))).length;
        add(id, n === terms.length, found(n, terms.length), "FAIL_MISSING_ITEM");
      } else if ((m = rule.match(/^language == (\w+)$/))) {
        // shortcut: only English is detected; any other language passes untested until a detector is added
        add(id, m[1] !== "en" || looksEnglish(text), m[1], "FAIL_FORMAT");
      } else if (rule === "format == bullets") {
        const lines = text.split("\n").filter((l) => l.trim());
        const bullets = lines.filter((l) => /^\s*([-*•]|\d+[.)])\s+/.test(l)).length;
        add(id, lines.length >= 2 && bullets === lines.length, plural(bullets, "bullet"), "FAIL_FORMAT");
      } else add(id, false, "unknown rule", "FAIL_FORMAT");
    }
    return finish(checks);
  }

  const json = parseJson(delivery);

  if (brief.jobType === "thread") {
    const posts = json.ok && Array.isArray((json.value as { posts?: unknown })?.posts) ? ((json.value as { posts: unknown[] }).posts.filter((x) => typeof x === "string") as string[]) : null;
    const all = (posts ?? []).join("\n");
    const allowed = new Set(((p.mustInclude as string[] | undefined) ?? []).flatMap((x) => x.match(/@\w+/g) ?? []).map((h) => h.toLowerCase()));
    for (const { id, rule } of items) {
      let m: RegExpMatchArray | null;
      if (!posts) add(id, false, "not a thread", "FAIL_FORMAT");
      else if ((m = rule.match(/^post_count == (\d+)$/))) add(id, posts.length === Number(m[1]), plural(posts.length, "post"), "FAIL_FORMAT");
      else if (rule === "post_length <= 280") {
        const longest = Math.max(0, ...posts.map(weightedLength));
        add(id, longest <= 280, `longest ${longest}`, "FAIL_LENGTH");
      } else if (rule === "includes_all") {
        const items2 = (p.mustInclude as string[] | undefined) ?? [];
        const n = items2.filter((x) => norm(all).includes(norm(x))).length;
        add(id, n === items2.length, found(n, items2.length), "FAIL_MISSING_ITEM");
      } else if (rule === "no_extra_handles") {
        const extra = [...new Set((all.match(/@\w+/g) ?? []).map((h) => h.toLowerCase()))].filter((h) => !allowed.has(h));
        add(id, extra.length === 0, extra.length ? plural(extra.length, "extra handle") : "none extra", "FAIL_SAFETY");
      } else add(id, false, "unknown rule", "FAIL_FORMAT");
    }
    return finish(checks);
  }

  // extract
  const fields = ((p.schema as { fields?: Field[] } | undefined)?.fields ?? []) as Field[];
  const many = p.many !== false;
  const records: Record<string, unknown>[] | null = !json.ok
    ? null
    : many
      ? Array.isArray(json.value) && json.value.every((r) => r && typeof r === "object" && !Array.isArray(r))
        ? (json.value as Record<string, unknown>[])
        : null
      : json.value && typeof json.value === "object" && !Array.isArray(json.value)
        ? [json.value as Record<string, unknown>]
        : null;
  const src = norm(source);
  for (const { id, rule } of items) {
    let m: RegExpMatchArray | null;
    if (rule === "json_parses") add(id, json.ok, json.ok ? "valid JSON" : "not JSON", "FAIL_FORMAT");
    else if (!records) add(id, false, json.ok ? "wrong shape" : "not JSON", rule === "matches_schema" ? "FAIL_SCHEMA" : "FAIL_FORMAT");
    else if (rule === "matches_schema") {
      const names = new Set(fields.map((f) => f.name));
      const bad = records.filter((r) => Object.keys(r).some((k) => !names.has(k)) || fields.some((f) => !fieldOk(f, r[f.name]))).length;
      add(id, bad === 0, bad ? `${plural(bad, "record")} off schema` : plural(records.length, "record"), "FAIL_SCHEMA");
    } else if (rule === "required_fields_filled") {
      const req = fields.filter((f) => f.required);
      const missing = records.filter((r) => req.some((f) => r[f.name] === null || r[f.name] === undefined || r[f.name] === "")).length;
      add(id, missing === 0, missing ? `${plural(missing, "record")} missing` : "all filled", "FAIL_SCHEMA");
    } else if ((m = rule.match(/^traceable >= (\d+)%$/))) {
      const values = records.flatMap((r) => fields.map((f) => r[f.name])).filter((v) => typeof v === "string" || typeof v === "number");
      const pct = values.length ? Math.floor((100 * values.filter((v) => traceable(v, src)).length) / values.length) : 100;
      add(id, pct >= Number(m[1]), `${pct}% found`, "FAIL_TRACEABILITY");
    } else if ((m = rule.match(/^records <= (\d+)$/))) add(id, records.length <= Number(m[1]), plural(records.length, "record"), "FAIL_LENGTH");
    else add(id, false, "unknown rule", "FAIL_FORMAT");
  }
  return finish(checks);
}

function finish(checks: CheckResult[]): CodeChecks {
  return { checks, codes: [...new Set(checks.flatMap((c) => (c.code ? [c.code] : [])))] };
}

/** Which fail code a failed model check (kind "model") reports. Owl reports it and Shark reads it back. */
export const MODEL_RULE_CODES: Record<string, ReviewCode> = {
  "every claim is supported by the source": "FAIL_FAITHFULNESS",
  "covers the source's main point": "FAIL_MISSING_ITEM",
  "on topic": "FAIL_OFF_TOPIC",
  "no invented facts": "FAIL_FAITHFULNESS",
  "no invented records": "FAIL_FAITHFULNESS",
};
