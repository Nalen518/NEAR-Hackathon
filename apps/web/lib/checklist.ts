// Brief checklist `rule` strings → UI copy (DESIGN-HANDOFF §8: keep this map in one file).
// Summary rules are from API-CONTRACT §1.2. Extract and thread rules are our guess from SRD §8.2
// (gap G12): the backend must confirm the exact strings. Unknown rules fall back to the raw rule.
import type { Brief, CheckItem } from "@shark/shared";

type Params = Brief["params"];
const list = (v: unknown) => (Array.isArray(v) ? v.map((x) => `“${String(x)}”`).join(" and ") : "");
const LANG: Record<string, string> = { en: "English" };

const RULES: [RegExp, (m: RegExpMatchArray, p: Params) => string][] = [
  [/^word_count <= (\d+)$/, (m) => `Word count is ${m[1]} or fewer`],
  [/^mentions_all$/, (_m, p) => `Mentions ${list(p.mustMention) || "every required term"}`],
  [/^language == (\w+)$/, (m) => `Written in ${LANG[m[1]] ?? m[1]}`],
  [/^format == (\w+)$/, (m) => `Written as a ${m[1] === "bullets" ? "bullet list" : m[1]}`],
  [/^every claim is supported by the source$/, () => "Every claim is supported by the source"],
  [/^covers the source's main point$/, () => "Covers the article’s main point"],
  // extract (SRD §8.2)
  [/^json_parses$/, () => "Output is valid JSON"],
  [/^matches_schema$/, () => "Every record matches the schema"],
  [/^required_fields_filled$/, () => "Required fields are filled"],
  [/^traceable >= (\d+)%$/, (m) => `At least ${m[1]}% of values appear in the source`],
  [/^records <= (\d+)$/, (m) => `${m[1]} records or fewer`],
  [/^no invented records$/, () => "No invented records"],
  // thread (SRD §8.2)
  [/^post_count == (\d+)$/, (m) => `Exactly ${m[1]} posts`],
  [/^post_length <= 280$/, () => "Each post is 280 characters or fewer"],
  [/^includes_all$/, (_m, p) => `Includes ${list(p.mustInclude) || "every required item"}`],
  [/^no_extra_handles$/, () => "No extra @handles"],
  [/^on topic$/, () => "Stays on topic"],
  [/^no invented facts$/, () => "Invents no facts"],
];

export function checkLabel(item: Pick<CheckItem, "rule">, params: Params = {}): string {
  for (const [re, f] of RULES) {
    const m = item.rule.match(re);
    if (m) return f(m, params);
  }
  return item.rule;
}
