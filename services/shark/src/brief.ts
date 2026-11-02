// The checkable brief (SRD §8.2, FR-03), feasibility rules, the safety filter (FR-04) and the price (FR-20).
// Rule strings are the list the web maps to copy (apps/web/lib/checklist.ts, gap G12).
import type { Brief, JobType, OrderRequest } from "@shark/shared";
import { HttpError } from "./errors";

type CheckItem = Brief["checklist"][number];
const code = (id: string, rule: string): CheckItem => ({ id, kind: "code", rule });
const model = (id: string, rule: string): CheckItem => ({ id, kind: "model", rule });
const infeasible = (reason: string, message: string) => new HttpError(422, "brief_infeasible", message, { reason });

export function buildBrief(jobType: JobType, raw: OrderRequest["params"]): Brief {
  const p = (raw ?? {}) as Record<string, unknown>;
  if (jobType === "summary") {
    const maxWords = (p.maxWords as number | undefined) ?? 150;
    const mustMention = (p.mustMention as string[] | undefined) ?? [];
    const format = (p.format as "paragraph" | "bullets" | undefined) ?? "paragraph";
    const language = (p.language as string | undefined) ?? "en";
    if (maxWords < 10 * mustMention.length)
      throw infeasible("max_words_vs_must_mention", `${maxWords} words can't cover ${mustMention.length} required points. Reduce the points or raise the limit to ${10 * mustMention.length}.`);
    const checklist = [code("C1", `word_count <= ${maxWords}`)];
    if (mustMention.length) checklist.push(code(`C${checklist.length + 1}`, "mentions_all"));
    checklist.push(code(`C${checklist.length + 1}`, `language == ${language}`));
    if (format === "bullets") checklist.push(code(`C${checklist.length + 1}`, "format == bullets"));
    checklist.push(model("M1", "every claim is supported by the source"), model("M2", "covers the source's main point"));
    return { jobType, params: { maxWords, mustMention, language, format }, checklist, deliverableFormat: format === "bullets" ? "text/markdown" : "text/plain" };
  }
  if (jobType === "thread") {
    const posts = (p.posts as number | undefined) ?? 5;
    const mustInclude = (p.mustInclude as string[] | undefined) ?? [];
    const tone = (p.tone as string | undefined) ?? "neutral";
    if (posts * 280 < 30 * mustInclude.length)
      throw infeasible("posts_vs_must_include", `${posts} posts can't fit ${mustInclude.length} required items. Add posts or remove items.`);
    const checklist = [code("C1", `post_count == ${posts}`), code("C2", "post_length <= 280")];
    if (mustInclude.length) checklist.push(code(`C${checklist.length + 1}`, "includes_all"));
    checklist.push(code(`C${checklist.length + 1}`, "no_extra_handles"), model("M1", "on topic"), model("M2", "no invented facts"));
    return { jobType, params: { posts, mustInclude, tone, ...(p.topic ? { topic: p.topic } : {}) }, checklist, deliverableFormat: "application/json" };
  }
  const schema = p.schema as { fields: { name: string }[] } | undefined;
  if (!schema?.fields?.length) throw new HttpError(400, "invalid_request", "An extraction needs at least one field.", { field: "instructions" });
  const names = schema.fields.map((f) => f.name.trim().toLowerCase());
  if (new Set(names).size !== names.length) throw infeasible("duplicate_fields", "Two fields have the same name. Give each field its own name.");
  const many = (p.many as boolean | undefined) ?? true;
  const maxRecords = (p.maxRecords as number | undefined) ?? 50;
  return {
    jobType,
    params: { schema, many, maxRecords },
    checklist: [
      code("C1", "json_parses"),
      code("C2", "matches_schema"),
      code("C3", "required_fields_filled"),
      code("C4", "traceable >= 90%"),
      code("C5", `records <= ${many ? maxRecords : 1}`),
      model("M1", "no invented records"),
    ],
    deliverableFormat: "application/json",
  };
}

/** Ways to make an infeasible brief feasible (C3, gap G21), same rules the web offers. Each gets a price by the caller. */
export function infeasibleFixes(jobType: JobType, raw: OrderRequest["params"]): { label: string; params: Record<string, unknown> }[] {
  const p = { ...((raw ?? {}) as Record<string, unknown>) };
  const fixes: { label: string; params: Record<string, unknown> }[] = [];
  if (jobType === "summary") {
    const n = ((p.mustMention as string[] | undefined) ?? []).length;
    const maxWords = (p.maxWords as number | undefined) ?? 150;
    const raise = Math.min(500, Math.max(10 * n, maxWords * 2));
    if (raise >= 10 * n) fixes.push({ label: `Raise the limit to ${raise} words`, params: { ...p, maxWords: raise } });
    const keep = Math.floor(maxWords / 10);
    if (keep >= 1 && keep < n) fixes.push({ label: `Keep ${keep} required ${keep === 1 ? "point" : "points"}`, params: { ...p, mustMention: (p.mustMention as string[]).slice(0, keep) } });
  } else if (jobType === "thread") {
    const n = ((p.mustInclude as string[] | undefined) ?? []).length;
    const posts = (p.posts as number | undefined) ?? 5;
    const need = Math.ceil((30 * n) / 280);
    if (need <= 10) fixes.push({ label: `Use ${Math.max(need, 2)} posts`, params: { ...p, posts: Math.max(need, 2) } });
    const keep = Math.floor((posts * 280) / 30);
    if (keep >= 1 && keep < n) fixes.push({ label: `Keep ${keep} required items`, params: { ...p, mustInclude: (p.mustInclude as string[]).slice(0, keep) } });
  }
  return fixes;
}

// shortcut: a pattern list until NEAR AI's classifier is wired in (needs NEARAI_API_KEY, FR-04)
const HARMFUL = [/\bphishing\b/i, /\bmalware\b/i, /\bransomware\b/i, /\bkeylogger\b/i, /\bdox+(ing)?\b/i, /\bharass/i, /\bimpersonat/i, /\bspam campaign\b/i, /\bscam\b/i, /\bsteal (passwords|credentials)\b/i];
export function refuseHarmful(instructions: string) {
  if (HARMFUL.some((re) => re.test(instructions)))
    throw new HttpError(422, "job_refused", "Shark doesn't take this kind of job. Nothing was charged.");
}

/** Price in base units inside [max(band min, floor), band max] from the size of the job (FR-20). */
export function priceJob(brief: Brief, size: { pages: number }, band: { min: bigint; max: bigint }, floor: bigint): { price: bigint; reason: string } {
  const step = 50_000n; // 0.05 per unit of work
  const pages = BigInt(size.pages);
  const p = brief.params as Record<string, unknown>;
  let units: bigint;
  const parts: string[] = [];
  if (size.pages) parts.push(`${size.pages} ${size.pages === 1 ? "page" : "pages"}`);
  if (brief.jobType === "summary") {
    const n = (p.mustMention as string[]).length;
    units = pages + BigInt(n);
    if (n) parts.push(`${n} required ${n === 1 ? "point" : "points"}`);
  } else if (brief.jobType === "thread") {
    const posts = p.posts as number;
    const n = (p.mustInclude as string[]).length;
    units = pages + BigInt(2 * (posts - 1)) + BigInt(n);
    parts.push(`${posts} posts`);
    if (n) parts.push(`${n} required ${n === 1 ? "item" : "items"}`);
  } else {
    const fields = (p.schema as { fields: unknown[] }).fields.length;
    units = pages + BigInt(fields);
    parts.push(`${fields} ${fields === 1 ? "field" : "fields"}`);
  }
  const low = band.min > floor ? band.min : floor;
  let price = band.min + units * step;
  if (price < low) price = low;
  if (price > band.max) price = band.max;
  return { price, reason: parts.join(", ") };
}
