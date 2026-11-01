// Counts shown next to deliveries. Computed in code (DESIGN-HANDOFF §5.3).

export const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

const URL_RE = /https?:\/\/\S+|\b[\w-]+(\.[\w-]+)+\/\S*/g;
const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]|\p{Extended_Pictographic}/u;

/** X weighted length: every link counts 23, CJK and emoji count 2, everything else 1.
 * shortcut: approximates twitter-text, swap in the library if O-21 says the rules differ. */
export function weightedLength(post: string): number {
  let n = 0;
  const rest = post.replace(URL_RE, () => {
    n += 23;
    return "";
  });
  for (const ch of rest) n += WIDE.test(ch) ? 2 : 1;
  return n;
}

/** "j_000042" → "#0042". */
export const jobNo = (orderId: string) => `#${orderId.replace(/^j_0*/, "").padStart(4, "0")}`;
