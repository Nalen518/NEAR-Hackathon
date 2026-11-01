// Copy rule D-170: no semicolons, em or en dashes, or hyphenated words in UI strings we write.
// Scans JSX text and string literals with a space (UI copy) in app/ and components/.
// Exempt: technical identifiers (accounts, URLs, headers, NEP-413, hashes), class names, comments.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOTS = ["app", "components"].map((d) => join(__dirname, "..", d));
const ALLOW = /^(https?:|[\w.-]+\.(testnet|near|com)\b|PAYMENT-\w+|Retry-After|Idempotency-Key|NEP-\d+|x402|sha256:|ed25519:|text\/|application\/|[\w-]+\.svg$)/;
const HYPHEN = /\b[A-Za-z]+-[A-Za-z]+\b/;
const SKIP_ATTR = new Set(["className", "src", "href", "id", "htmlFor", "key", "role", "type", "name", "data-name", "style"]);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? (f === "dev" ? [] : files(p)) : /\.tsx$/.test(f) ? [p] : [];
  });
}

/** A Tailwind class list, not copy: lowercase tokens, most with a dash or a colon. */
const isClassList = (t: string) => {
  const w = t.trim().split(/\s+/);
  return w.every((x) => /^[a-z0-9:[\]/.%#()_!-]+$/.test(x)) && w.filter((x) => /[-:]/.test(x)).length * 2 >= w.length;
};

function badWords(raw: string): string[] {
  const text = raw.replace(/&[a-z]+;/g, "&");
  const out: string[] = [];
  if (isClassList(text)) return out;
  if (/[;—–]/.test(text)) out.push(text.match(/[;—–]/)![0]);
  for (const w of text.split(/\s+/)) if (HYPHEN.test(w) && !ALLOW.test(w.replace(/^[“"(]+|[”").,:]+$/g, ""))) out.push(w);
  return out;
}

function scan(file: string): string[] {
  const src = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const hits: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isJsxAttribute(n) && SKIP_ATTR.has(n.name.getText())) return;
    if (ts.isImportDeclaration(n) || ts.isTypeNode(n) || ts.isCallExpression(n) && /^(cx|useQuery|replace|startsWith|match|split)/.test(n.expression.getText().split(".").pop() ?? "")) return;
    const text = ts.isJsxText(n) ? n.text : (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && / /.test(n.text) ? n.text : ts.isTemplateExpression(n) && / /.test(n.head.text + n.templateSpans.map((s) => s.literal.text).join("")) ? n.head.text + n.templateSpans.map((s) => s.literal.text).join(" ") : null;
    if (text && text.trim()) for (const b of badWords(text)) hits.push(`${file.split(/[\/]/).slice(-2).join("/")}: “${b}” in “${text.trim().slice(0, 60)}”`);
    ts.forEachChild(n, visit);
  };
  visit(src);
  return hits;
}

describe("copy rule D-170", () => {
  it("UI strings have no semicolons, dashes or hyphenated words", () => {
    const hits = ROOTS.flatMap(files).flatMap(scan);
    expect(hits).toEqual([]);
  });
});

describe("copy lint self check", () => {
  it("flags dashes, semicolons and hyphenated words, but not identifiers or class lists", () => {
    expect(badWords("a one-time fee")).toEqual(["one-time"]);
    expect(badWords("wait; then go — now")).not.toEqual([]);
    expect(badWords("paid by demo-buyer.testnet with PAYMENT-SIGNATURE")).toEqual([]);
    expect(badWords("mono-data inline-flex text-ink")).toEqual([]);
    expect(ROOTS.flatMap(files).length).toBeGreaterThan(10);
  });
});
