// Counts shared by the web (shown next to deliveries) and the review checks, so both always agree.

const URL_RE = /https?:\/\/\S+|\b[\w-]+(\.[\w-]+)+\/\S*/g;

/** X's weights (twitter-text v3): code points up to U+10FF, U+2000 to U+200D, U+2010 to U+201F and U+2032 to U+2037 count 1,
 * every other code point counts 2 (so CJK and emoji are 2), and every link counts 23.
 * shortcut: an emoji sequence (a family, a skin tone) counts per code point, where X counts the whole sequence as 2; fix it
 * if a real thread is ever refused for it (O-21). The Rust port in owl/checks has the same ranges. */
export function weightedLength(post: string): number {
  let n = 0;
  const rest = post.replace(URL_RE, () => {
    n += 23;
    return "";
  });
  for (const ch of rest) {
    const cp = ch.codePointAt(0)!;
    const light = cp <= 0x10ff || (cp >= 0x2000 && cp <= 0x200d) || (cp >= 0x2010 && cp <= 0x201f) || (cp >= 0x2032 && cp <= 0x2037);
    n += light ? 1 : 2;
  }
  return n;
}
