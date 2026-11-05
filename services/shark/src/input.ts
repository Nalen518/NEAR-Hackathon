// Input snapshots (FR-02, D-130): fetch a URL once, or take an upload or pasted text, extract plain text,
// enforce the limits and hash it. Workers and Owl only ever see this snapshot.
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { extractText, getDocumentProxy } from "unpdf";
import { HttpError } from "./errors";

export const MAX_BYTES = 2 * 1024 * 1024;
export const MAX_PAGES = 20;
export const MAX_WORDS = 40_000;
const WORDS_PER_PAGE = 500;

export type Snapshot = { text: string; pages: number; words: number };

const tooLarge = (what: string) => new HttpError(413, "input_too_large", `The input is too large (${what}). The limit is 2 MB, 20 pages or 40 000 words. Nothing was charged.`);
const unreadable = (why: string) => new HttpError(422, "input_unreadable", `Shark can't read this input: ${why}. Nothing was charged.`);

export const countWords = (text: string) => (text.match(/\S+/g) ?? []).length;

export function snapshotText(text: string, pages?: number): Snapshot {
  const clean = text.replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (!clean) throw unreadable("it has no text");
  const words = countWords(clean);
  const p = pages ?? Math.max(1, Math.ceil(words / WORDS_PER_PAGE));
  if (words > MAX_WORDS) throw tooLarge(`${words} words`);
  if (p > MAX_PAGES) throw tooLarge(`${p} pages`);
  return { text: clean, pages: p, words };
}

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|li|h[1-6]|tr|br|section|article)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

export async function pdfToSnapshot(bytes: Uint8Array): Promise<Snapshot> {
  let doc: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    doc = await getDocumentProxy(bytes);
  } catch {
    throw unreadable("the PDF could not be opened");
  }
  // the page count is known once the file is open, so a 2 MB file of thousands of tiny pages is refused before any text is read
  if (doc.numPages > MAX_PAGES) throw tooLarge(`${doc.numPages} pages`);
  let res: { totalPages: number; text: string };
  try {
    res = await extractText(doc, { mergePages: true });
  } catch {
    throw unreadable("the PDF could not be opened");
  }
  if (!res.text.trim()) throw unreadable("the PDF has no text layer");
  return snapshotText(res.text, res.totalPages);
}

/** Text from a file by its name or type: PDF, HTML, TXT, MD. */
export async function fileToSnapshot(bytes: Uint8Array, name: string, type: string): Promise<Snapshot> {
  if (bytes.byteLength > MAX_BYTES) throw tooLarge("over 2 MB");
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (ext === "pdf" || type === "application/pdf") return pdfToSnapshot(bytes);
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  if (ext === "html" || ext === "htm" || type === "text/html") return snapshotText(htmlToText(text));
  if (["txt", "md", "markdown"].includes(ext) || type.startsWith("text/")) return snapshotText(text);
  throw unreadable("only PDF, HTML, TXT and MD files are accepted");
}

/** Public means: not private, loopback, link local, shared, multicast or reserved. For IPv6 only global addresses (2000::/3) pass,
 * minus 6to4 (2002::) and Teredo (2001:0::), which carry an IPv4 address inside, and every ::ffff: form is refused. */
function isPrivate(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    return !/^[23]/.test(v) || v.startsWith("2002:") || v.startsWith("2001:0:") || v.startsWith("2001::");
  }
  const [a, b, c] = ip.split(".").map(Number);
  return (
    a === 10 || a === 127 || a === 0 || a >= 224 ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19)) || (a === 192 && b === 0 && c === 0)
  );
}

/** Customer URLs are untrusted: http(s) only, public addresses only, checked again on every redirect. */
async function assertPublic(url: URL) {
  if (url.protocol !== "https:" && url.protocol !== "http:") throw unreadable("only http and https links work");
  if (url.port && url.port !== "80" && url.port !== "443") throw unreadable("only links on the normal web ports 80 and 443 work");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const ips = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => { throw unreadable("the site can't be found"); })).map((r) => r.address);
  if (ips.some(isPrivate)) throw unreadable("the link points to a private address");
}

// shortcut: the address is checked before connecting, so a DNS answer that changes in between (rebinding) is not caught; pin the IP via a custom agent before mainnet-lite
export async function fetchSnapshot(raw: string, fetchImpl: typeof fetch = fetch): Promise<Snapshot> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new HttpError(400, "invalid_request", "That link is not a valid URL.", { field: "source" });
  }
  let res: Response | undefined;
  for (let hop = 0; hop < 4; hop++) {
    await assertPublic(url);
    res = await fetchImpl(url, { redirect: "manual", signal: AbortSignal.timeout(10_000), headers: { "User-Agent": "SharkCo/0.1 (+snapshot)" } }).catch(() => {
      throw unreadable("the site did not answer");
    });
    const loc = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!loc) break;
    url = new URL(loc, url);
    res = undefined;
  }
  if (!res) throw unreadable("too many redirects");
  if (!res.ok) throw unreadable(`the site answered ${res.status}`);
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) throw tooLarge("over 2 MB");
  const bytes = await readCapped(res);
  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim();
  if (type === "application/pdf") return pdfToSnapshot(bytes);
  const text = new TextDecoder().decode(bytes);
  return snapshotText(type === "text/html" || /<html/i.test(text.slice(0, 500)) ? htmlToText(text) : text);
}

async function readCapped(res: Response): Promise<Uint8Array> {
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel();
      throw tooLarge("over 2 MB");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
