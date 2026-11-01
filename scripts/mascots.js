// Shark & Co. mascots v0.2 — the single source of truth for every mascot SVG.
// Runs in three places with no changes:
//   1. Node:   node scripts/generate_mascots.mjs assets/brand      (writes the SVG files)
//   2. Figma:  pasted into a use_figma script (no imports, no DOM)
//   3. Web:    import into the Next.js app later (module.exports below)
// Rules (docs/brand/mascots.md): colour says WHO, shape/props say WHAT STATE.
// gain/loss colours are for money only. Every state has a badge in the same slot (bottom-right).

const INK = "#161A22", TILE = "#E9EDF2", WHITE = "#FCFCFD", ACCENT = "#2B59FF", GAIN = "#147A44", LOSS = "#C2362B";
const SHARK = { body: "#6E8BA8", belly: "#EEF2F6" };
const OWL = { body: "#A86B32", face: "#F3E3C8", belly: "#E3C49A", beak: "#E9A23B" };
const RAVEN = { body: "#5E5A86", belly: "#B3AFD6", beak: "#2F2B45", pouch: "#D8B46A" };
const FISH = { body: "#F2B33D", belly: "#FBE3A6" };
const O = `stroke="${INK}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"`;
const svg = (i) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="512" height="512"><rect width="100" height="100" rx="22" fill="${TILE}"/>${i}</svg>`;

// ---------- halftone shadow (dots as real circles: Figma drops SVG <pattern>) ----------
function flat(d) { const t = d.match(/[MCLZ]|-?\d+(?:\.\d+)?/g); const p = []; let i = 0, c = [0, 0], cmd; while (i < t.length) { const k = t[i]; if ("MCLZ".includes(k)) { cmd = k; i++; if (k === "Z") continue; } if (cmd === "M" || cmd === "L") { c = [+t[i], +t[i + 1]]; p.push(c); i += 2; } else if (cmd === "C") { const [x1, y1, x2, y2, x3, y3] = t.slice(i, i + 6).map(Number); const [x0, y0] = c; for (let s = 1; s <= 16; s++) { const u = s / 16, a = (1 - u) ** 3, b = 3 * (1 - u) ** 2 * u, e = 3 * (1 - u) * u * u, f = u ** 3; p.push([a * x0 + b * x1 + e * x2 + f * x3, a * y0 + b * y1 + e * y2 + f * y3]); } c = [x3, y3]; i += 6; } else i++; } return p; }
function inside(x, y, P) { let r = false; for (let k = 0, j = P.length - 1; k < P.length; j = k++) { const [xi, yi] = P[k], [xj, yj] = P[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi) r = !r; } return r; }
function halftone(d, dx, dy) { const P = flat(d), Q = P.map(([x, y]) => [x + dx, y + dy]); const h = 2.6 / Math.SQRT2; let s = ""; for (let row = -5; row < 110; row++) for (let col = -5; col < 110; col++) { const x = col * 2.6 + (row % 2 ? h : 0), y = row * h; if (inside(x, y, P) && !inside(x, y, Q) && [[1.6, 0], [-1.6, 0], [0, 1.6], [0, -1.6]].every(([a, b]) => inside(x + a, y + b, P))) s += `M${(x - 0.62).toFixed(1)},${y.toFixed(1)}a.62,.62 0 1 0 1.24 0a.62,.62 0 1 0-1.24 0`; } return `<path d="${s}" fill="${INK}" opacity="0.5"/>`; }
const shaded = (d, fill, dx, dy, id) => `<clipPath id="${id}"><path d="${d}"/></clipPath><path d="${d}" fill="${fill}"/>` + halftone(d, dx, dy);

// ---------- state badges (shared slot at 81.5, 82) ----------
const ring = (fill) => `<circle cx="81.5" cy="82" r="10" fill="${fill}" stroke="${INK}" stroke-width="2.4"/>`;
const W2 = (w = 2.8) => `stroke="${WHITE}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" fill="none"`;
const I2 = (w = 2.4) => `stroke="${INK}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" fill="none"`;
const tag = (dashed = false) => `<g transform="rotate(-18 81.5 82)"><path d="M72,76 h13 l6,6 l-6,6 h-13 z" fill="${WHITE}" stroke="${INK}" stroke-width="2.2" stroke-linejoin="round" ${dashed ? 'stroke-dasharray="2.4 2"' : ""}/><circle cx="86" cy="82" r="1.4" fill="${INK}"/><path d="M78.5,78.6 v6.8 M80.6,79.6 q-2.2,-1.2 -3.6,0.2 q-1.2,1.6 1.5,2.2 q2.8,0.6 1.6,2.4 q-1.4,1.4 -3.8,0.2" ${I2(1.3)}/></g>`;
const BADGE = {
  bidding: () => tag(),
  lost: () => tag(true) + `<path d="M70,92 L93,72" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>`,
  won: () => `<path d="M76,88 l-3,9 l4,-2 l2,4 l3,-9 M87,88 l3,9 l-4,-2 l-2,4 l-3,-9" fill="${WHITE}" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/>` + ring(WHITE) + `<path d="M81.5,75.5 l1.9,3.9 l4.3,0.6 l-3.1,3 l0.7,4.3 l-3.8,-2 l-3.8,2 l0.7,-4.3 l-3.1,-3 l4.3,-0.6 z" fill="${INK}"/>`,
  auditing: () => [76, 81, 86].map((x, i) => `<circle cx="${x}" cy="86" r="1.8" fill="${INK}" opacity="${(0.35 + i * 0.3).toFixed(2)}"/>`).join(""),
  pass: () => ring(GAIN) + `<path d="M77,82 l3.4,3.6 l6.6,-7.2" ${W2()}/>`,
  disagree: () => ring(WHITE) + `<path d="M81.5,76.5 v6.5" ${I2(3)}/><circle cx="81.5" cy="87.2" r="1.7" fill="${INK}"/>`,
  tiebreak: () => ring(WHITE) + `<path d="M81.5,75.8 v11.4 M77.5,88 h8 M74.5,78.6 h14" ${I2(1.8)}/><path d="M74.5,78.6 l-2.6,5 h5.2 z M88.5,78.6 l-2.6,5 h5.2 z" fill="${INK}"/>`,
  unpaid: () => ring(LOSS) + `<circle cx="81.5" cy="82" r="5" ${W2(2)}/><path d="M76,88 L87,76" ${W2(2.4)}/>`,
  // fee held: coin on a white disc, closed with a small ink padlock (neutral, not money-red)
  unresolved: () => ring(WHITE) + `<circle cx="78.6" cy="79.6" r="5" fill="${WHITE}" stroke="${INK}" stroke-width="2"/><path d="M76.6,79.6 h4" ${I2(1.4)}/><path d="M83.2,84 v-2.2 a2.6,2.6 0 0 1 5.2,0 v2.2" ${I2(1.6)}/><rect x="81.6" y="83.4" width="8.4" height="6.6" rx="1.4" fill="${INK}"/><circle cx="85.8" cy="86.4" r="1" fill="${WHITE}"/>`,
  late: () => `<path d="M71,17 h6 l-6,7 h6 M80,9 h4.5 l-4.5,5 h4.5" fill="none" stroke="${INK}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`,
  suspended: () => `<path d="M77,80 v-3.5 a4.5,4.5 0 0 1 9,0 v3.5" ${I2(2.4)}/><rect x="73.5" y="79" width="16" height="13" rx="2.6" fill="${INK}"/><circle cx="81.5" cy="84.2" r="1.7" fill="${WHITE}"/><path d="M81.5,85 v3" stroke="${WHITE}" stroke-width="1.4" stroke-linecap="round"/>`,
};
const AUDITOR_STATES = ["bidding", "won", "lost", "auditing", "pass", "disagree", "tiebreak", "unpaid", "unresolved", "late", "suspended"];
const STATE_LABEL = { bidding: "Bidding", won: "Won bid", lost: "Lost bid", auditing: "Auditing", pass: "Pass", disagree: "Disagree", tiebreak: "Tie-break", unpaid: "Unpaid", unresolved: "Unresolved", late: "Late", suspended: "Suspended" };

// ---------- eyes, shared by both auditors ----------
function eyes(xs, cy, r, st) {
  let p = "";
  for (const [k, cx] of xs.entries()) {
    p += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${WHITE}"/>`;
    const pr = r * 0.44, gl = r * 0.14;
    if (st === "won" || st === "pass") p += `<path d="M${cx - r * 0.55},${cy + r * 0.2} q${r * 0.55},${-r * 0.62} ${r * 1.1},0" fill="none" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>`;
    else if (st === "late" || st === "suspended") p += `<path d="M${cx - r * 0.55},${cy + r * 0.07} h${r * 1.1}" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>`;
    else if (st === "disagree") p += `<circle cx="${cx}" cy="${cy + r * 0.14}" r="${r * 0.25}" fill="${INK}"/>`;
    else {
      const dx = st === "auditing" ? r * 0.36 : st === "tiebreak" ? (k === 0 ? -r * 0.36 : r * 0.36) : st === "bidding" ? r * 0.2 : 0;
      const dy = (st === "lost" || st === "unpaid") ? r * 0.28 : r * 0.06;
      p += `<circle cx="${cx + dx}" cy="${cy + dy}" r="${pr}" fill="${INK}"/><circle cx="${cx + dx - r * 0.17}" cy="${cy + dy - r * 0.24}" r="${gl}" fill="${WHITE}"/>`;
      if (st === "lost") p += `<path d="M${cx - r},${cy - r * 0.1} A${r},${r} 0 0,1 ${cx + r},${cy - r * 0.1} Z" fill="${INK}"/>`;
    }
  }
  return p;
}

// ---------- SHARK: the employee (tie). State: cage = strikes; decision props: price band, two bids ----------
const SB = "M22,50 C34,33 62,31 80,39 C88,43 92,49 90,55 C87,63 74,71 54,72 C38,73 28,65 22,58 Z";
// Strikes are not money: tally + padlock never use GAIN/LOSS (green/red = money only).
function cage(n) { if (n <= 0) return ""; const b = { 1: 30, 2: 58, 3: 90 }[Math.min(n, 3)]; let g = `<g stroke="${INK}" stroke-linecap="round" fill="none"><path d="M10,8 H90" stroke-width="3.4"/>`; for (let x = 14; x < 91; x += 9) g += `<path d="M${x},8 V${b}" stroke-width="2.4"/>`; if (n >= 3) g += `<path d="M10,${b} H90" stroke-width="3.4"/><path d="M10,50 H90" stroke-width="1.6" opacity="0.6"/>`; g += "</g>"; for (let i = 0; i < 3; i++) g += `<rect x="${64 + i * 9 - 3.4}" y="91" width="6.8" height="4" rx="1" fill="${i < n ? INK : WHITE}" stroke="${INK}" stroke-width="1.2"/>`; if (n >= 3) g += `<path d="M45,56 v-4 a5,5 0 0 1 10,0 v4" fill="none" stroke="${INK}" stroke-width="2.4"/><rect x="42" y="55" width="16" height="12" rx="2.5" fill="${ACCENT}" stroke="${INK}" stroke-width="2.2"/><circle cx="50" cy="60.5" r="1.6" fill="${WHITE}"/>`; return g; }
function shark(n = 0, mood = "neutral", extra = "") {
  const sad = mood === "sad";
  let p = `<g ${O}><path d="M25,51 L7,33 C12,45 12,55 6,71 L25,58 Z" fill="${SHARK.body}"/><path d="M46,36 C48,26 53,19 61,16 C59,25 60,31 65,37 Z" fill="${SHARK.body}"/></g><g stroke="none">${shaded(SB, SHARK.body, 4, -5, "sb")}<g clip-path="url(#sb)"><ellipse cx="60" cy="74" rx="34" ry="12.5" fill="${SHARK.belly}"/></g></g><path d="${SB}" fill="none" ${O}/>`;
  for (const gx of [56, 60.5, 65]) p += `<path d="M${gx},46 q-2.2,4.5 0,9" fill="none" stroke="${INK}" stroke-width="1.8" stroke-linecap="round"/>`;
  p += `<path d="M50,65 C47,74 42,80 35,83 C45,82 54,77 61,68 Z" fill="${SHARK.body}" ${O}/>`;
  p += sad ? `<path d="M71,61 Q79,56 87,60" fill="none" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>` : `<path d="M68,57 Q78,65 88,55 Q80,59 68,57 Z" fill="${WHITE}" stroke="${INK}" stroke-width="2.2" stroke-linejoin="round"/><path d="M71,58.2 l1.6,2 l1.6,-1.6 l1.6,2.2 l1.6,-1.8 l1.6,2 l1.6,-2.1 l1.6,1.4 l1.6,-2.2" fill="none" stroke="${INK}" stroke-width="1.1" stroke-linejoin="round"/>`;
  p += `<circle cx="73" cy="46" r="6" fill="${WHITE}" stroke="${INK}" stroke-width="2.4"/>`;
  p += sad ? `<circle cx="73.4" cy="48" r="2.6" fill="${INK}"/><path d="M66,41 L78,38" stroke="${INK}" stroke-width="2.8" stroke-linecap="round"/>` : `<circle cx="74.4" cy="46.4" r="3" fill="${INK}"/><circle cx="72.9" cy="44.6" r="1.05" fill="${WHITE}"/><path d="M66,38.5 L79,40.5" stroke="${INK}" stroke-width="2.8" stroke-linecap="round"/>`;
  p += `<path d="M66.5,67 L72.5,66 L71.5,70 L67.5,70.6 Z" fill="${ACCENT}" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/><path d="M67.6,70.5 L71.4,70 L73,80 L69.6,83 L66.6,80.6 Z" fill="${ACCENT}" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/>`;
  return svg(p + cage(n) + extra);
}
// Pricing: a price band (ruler) with the current-price marker; the tag hangs from the fin to the marker.
const PRICING = `<path d="M35,83 L41,88" stroke="${INK}" stroke-width="1.4"/><g transform="rotate(8 46 89)"><path d="M38,85 h11 l5,4 l-5,4 h-11 z" fill="${WHITE}" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/><path d="M43.5,86.4 v5.2" stroke="${INK}" stroke-width="1.3" stroke-linecap="round"/></g>`
  + `<rect x="14" y="92.5" width="72" height="4" rx="2" fill="${WHITE}" stroke="${INK}" stroke-width="1.6"/><path d="M14,90 v9 M86,90 v9" stroke="${INK}" stroke-width="1.8" stroke-linecap="round"/><path d="M57,90.5 l-3,-4 h6 z" fill="${INK}"/><rect x="14" y="92.5" width="43" height="4" rx="2" fill="${INK}" opacity="0.25"/>`;
// Hiring: two bid cards held by the fin, the chosen one has a tick.
const card = (x, y, r, tick) => `<g transform="rotate(${r} ${x + 8} ${y + 6})"><rect x="${x}" y="${y}" width="16" height="12" rx="1.8" fill="${WHITE}" stroke="${INK}" stroke-width="1.8"/><path d="M${x + 3},${y + 4} h7 M${x + 3},${y + 7.5} h10" stroke="${INK}" stroke-width="1.3" stroke-linecap="round"/>${tick ? `<circle cx="${x + 15}" cy="${y + 1}" r="3.4" fill="${INK}"/><path d="M${x + 13.4},${y + 1.1} l1.1,1.1 l2.1,-2.3" stroke="${WHITE}" stroke-width="1.2" fill="none" stroke-linecap="round"/>` : ""}</g>`;
const HIRING = card(14, 80, -10, false) + card(32, 84, 6, true);

// ---------- OWL: auditor #1 (glasses), audits in an OutLayer TEE, paid on NEAR ----------
const OB = "M50,22 C70,22 79,40 79,58 C79,76 67,88 50,88 C33,88 21,76 21,58 C21,40 30,22 50,22 Z";
function owlBody(st) {
  let p = `<g ${O} fill="${OWL.body}"><path d="M31,30 L28,15 L42,25 Z"/><path d="M69,30 L72,15 L58,25 Z"/><path d="M23,52 C12,60 13,74 22,82 C24,72 26,64 27,56 Z"/><path d="M77,52 C88,60 87,74 78,82 C76,72 74,64 73,56 Z"/></g><g stroke="none">${shaded(OB, OWL.body, 5, -5, "ob")}<g clip-path="url(#ob)"><ellipse cx="50" cy="74" rx="20" ry="17" fill="${OWL.belly}"/></g></g><path d="${OB}" fill="none" ${O}/>`;
  for (const [x, y] of [[44, 70], [56, 70], [50, 78]]) p += `<path d="M${x - 3},${y} l3,3 l3,-3" fill="none" stroke="${INK}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`;
  p += `<path d="M50,36 C44,30 30,31 28,43 C27,53 36,58 50,55 C64,58 73,53 72,43 C70,31 56,30 50,36 Z" fill="${OWL.face}" stroke="${INK}" stroke-width="2.2"/>`;
  p += eyes([39, 61], 44, 7.2, st);
  p += `<g fill="none" stroke="${INK}"><circle cx="39" cy="44" r="8.6" stroke-width="2.8"/><circle cx="61" cy="44" r="8.6" stroke-width="2.8"/><path d="M47.6,43 q2.4,-2 4.8,0" stroke-width="2.4"/></g>`;
  if (st === "disagree") p += `<path d="M31,33 L45,37 M69,33 L55,37" stroke="${INK}" stroke-width="2.8" stroke-linecap="round"/>`;
  if (st === "auditing") p += `<path d="M30,33.5 L44,32.5" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/>`;
  if (st === "unpaid") p += `<path d="M31,35 L44,32 M69,35 L56,32" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>`;
  p += `<path d="M46.5,52 L53.5,52 L50,58.5 Z" fill="${OWL.beak}" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/>`;
  for (const fx of [42, 58]) p += `<path d="M${fx - 4},88 l2,-3 l2,3 l2,-3 l2,3" fill="${OWL.beak}" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>`;
  return p;
}
// ---------- RAVEN: auditor #2 (crest, long dark beak, coin pouch), paid in USDC on Base via Chain Signatures ----------
const RB = "M50,25 C67,25 76,41 76,58 C76,76 65,88 50,88 C35,88 24,76 24,58 C24,41 33,25 50,25 Z";
function ravenBody(st) {
  let p = `<g ${O} fill="${RAVEN.body}"><path d="M50,27 L57,10 L57.5,21 L66,13 L62,27 Z"/><path d="M26,50 C15,60 17,78 29,87 C27,74 27,62 30,54 Z"/><path d="M74,50 C85,60 83,78 71,87 C73,74 73,62 70,54 Z"/><path d="M43,85 L50,97 L57,85 Z"/></g><g stroke="none">${shaded(RB, RAVEN.body, 5, -5, "rb")}<g clip-path="url(#rb)"><ellipse cx="50" cy="76" rx="18" ry="15" fill="${RAVEN.belly}"/></g></g><path d="${RB}" fill="none" ${O}/>`;
  for (const [x, y] of [[45, 72], [55, 72]]) p += `<path d="M${x - 2.6},${y} l2.6,2.6 l2.6,-2.6" fill="none" stroke="${INK}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`;
  p += eyes([40, 60], 42, 6, st).replace(/<circle cx="(\d+(?:\.\d+)?)" cy="42" r="6" fill="#FCFCFD"\/>/g, (m) => m.replace("/>", ` stroke="${INK}" stroke-width="2.4"/>`));
  // sharp brows (default), angry on disagree, worried on unpaid, none when happy/asleep
  if (st === "disagree") p += `<path d="M32,32 L46,36.5 M68,32 L54,36.5" stroke="${INK}" stroke-width="2.8" stroke-linecap="round"/>`;
  else if (st === "unpaid") p += `<path d="M33,35 L45,32 M67,35 L55,32" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/>`;
  else if (!["won", "pass", "late", "suspended"].includes(st)) p += `<path d="M33,33.5 L46,35.5 M67,33.5 L54,35.5" stroke="${INK}" stroke-width="2.8" stroke-linecap="round"/>`;
  p += `<path d="M44.5,48 L55.5,48 L50,64 Z" fill="${RAVEN.beak}" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/><path d="M45.8,52 L54.2,52" stroke="${WHITE}" stroke-width="0.9" opacity="0.6"/>`;
  // coin pouch with a chain link (the Chain Signatures payout), attached at the left hip
  p += `<path d="M27,76 C25,70 30,66 33,67 C36,66 41,70 39,76 C38,82 28,82 27,76 Z" fill="${RAVEN.pouch}" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/><path d="M29.5,67.5 q3.5,2.6 7,0" fill="none" stroke="${INK}" stroke-width="1.6" stroke-linecap="round"/><rect x="28.6" y="72.2" width="5.2" height="3.4" rx="1.7" fill="none" stroke="${INK}" stroke-width="1.3"/><rect x="32.2" y="74" width="5.2" height="3.4" rx="1.7" fill="none" stroke="${INK}" stroke-width="1.3"/>`;
  for (const fx of [43, 57]) p += `<path d="M${fx - 3},89 l1.5,-2.5 l1.5,2.5 l1.5,-2.5 l1.5,2.5" fill="${RAVEN.beak}" stroke="${INK}" stroke-width="1.4" stroke-linejoin="round"/>`;
  return p;
}
function auditor(kind, st) {
  const body = kind === "owl" ? owlBody(st) : ravenBody(st);
  return svg((st === "lost" ? `<g opacity="0.5">${body}</g>` : body) + BADGE[st]());
}

// ---------- verdict emblems (not characters) ----------
function verdictShark() { const fin = "M30,64 C36,46 46,26 64,18 C60,34 62,50 72,64 Z"; return svg(`<g stroke="none">${shaded(fin, SHARK.body, 5, -4, "vf")}</g><path d="${fin}" fill="none" ${O}/><path d="M8,66 q7,-5 14,0 t14,0 t14,0 t14,0 t14,0 t14,0" fill="none" ${O}/><path d="M18,76 q7,-5 14,0 t14,0 t14,0 t14,0" fill="none" stroke="${INK}" stroke-width="2" stroke-linecap="round" opacity="0.55"/><path d="M76,58 l8,-6 M78,63 l10,-3" stroke="${INK}" stroke-width="2" stroke-linecap="round"/><rect x="64" y="80" width="26" height="12" rx="6" fill="${GAIN}" stroke="${INK}" stroke-width="2"/><path d="M77,89 v-6 m-3,3 l3,-3 l3,3" fill="none" stroke="${WHITE}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`); }
function verdictFish() { const b = "M22,58 C26,44 40,36 56,36 C70,36 80,46 80,58 C80,70 70,79 56,79 C40,79 26,71 22,58 Z"; return svg(`<path d="M78,4 V50" stroke="${INK}" stroke-width="1.4"/><path d="M8,44 L24,58 L8,72 Z" fill="${FISH.body}" ${O}/><path d="M48,37 C50,28 58,24 64,26 C62,30 62,34 64,38 Z" fill="${FISH.body}" ${O}/><g stroke="none">${shaded(b, FISH.body, 4, -5, "fb")}<g clip-path="url(#fb)"><ellipse cx="54" cy="78" rx="28" ry="11" fill="${FISH.belly}"/></g></g><path d="${b}" fill="none" ${O}/><circle cx="64" cy="51" r="7" fill="${WHITE}" stroke="${INK}" stroke-width="2.4"/><circle cx="65" cy="52.5" r="2" fill="${INK}"/><path d="M57.5,41 L70,44.5" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/><path d="M72.5,38 q3.2,4 0,6.4 q-3.2,-2.4 0,-6.4 Z" fill="${WHITE}" stroke="${INK}" stroke-width="1.5"/><ellipse cx="78.5" cy="62" rx="2.6" ry="3.4" fill="${INK}"/><path d="M78,50 V60 a4,4 0 0 0 8,0 l-2,-2" fill="none" stroke="${INK}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><rect x="10" y="82" width="26" height="12" rx="6" fill="${LOSS}" stroke="${INK}" stroke-width="2"/><path d="M23,85 v6 m-3,-3 l3,3 l3,-3" fill="none" stroke="${WHITE}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`); }

// ---------- catalogue: [component name, file name, description, svg] ----------
const AUDITOR_DESC = { bidding: "holds a price tag · sending a bid", won: "rosette · won the auction", lost: "faded + struck tag · lost the auction", auditing: "eyes scan · checking the maths", pass: "✓ stamp · agrees with Shark", disagree: "! stamp · disagrees → tie-break", tiebreak: "scales · eyes on both sides · second opinion", unpaid: "crossed coin · was wrong, fee withheld", unresolved: "padlocked coin · fee held until a tie-break", late: "asleep · missed the deadline", suspended: "lock · too many lost disputes" };
const MASCOTS = [
  ["Shark/Strikes=0", "shark", "0 strikes · free, taking orders", shark(0)],
  ["Shark/Strikes=1", "shark-strike-1", "cage at 30% · one lost dispute", shark(1)],
  ["Shark/Strikes=2", "shark-strike-2", "cage at 58% · one strike from cage", shark(2)],
  ["Shark/Strikes=3 Caged", "shark-caged", "3 strikes · new jobs refused", shark(3, "sad")],
  ["Shark/Pricing", "shark-pricing", "tag on the owners' price band", shark(0, "neutral", PRICING)],
  ["Shark/Hiring", "shark-hiring", "holds two bids, picks one", shark(0, "neutral", HIRING)],
  ...AUDITOR_STATES.map((s) => [`Owl/${STATE_LABEL[s]}`, `owl-${s}`, AUDITOR_DESC[s], auditor("owl", s)]),
  ...AUDITOR_STATES.map((s) => [`Raven/${STATE_LABEL[s]}`, `raven-${s}`, AUDITOR_DESC[s], auditor("raven", s)]),
  ["Verdict/Shark", "verdict-shark", "the call made money · up chip", verdictShark()],
  ["Verdict/Fish", "verdict-fish", "the call lost money · hooked fish", verdictFish()],
];

if (typeof module !== "undefined") module.exports = { MASCOTS, shark, auditor, verdictShark, verdictFish, AUDITOR_STATES, STATE_LABEL, COLORS: { INK, TILE, WHITE, ACCENT, GAIN, LOSS, SHARK, OWL, RAVEN, FISH } };
