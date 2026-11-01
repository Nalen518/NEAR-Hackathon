#!/usr/bin/env python3
# SUPERSEDED (v0.2): scripts/mascots.js is now the single source of truth.
# Run `node scripts/generate_mascots.mjs assets/brand` instead. Kept for history only.
"""Shark & Co. mascot generator.

Parametric SVGs, no dependencies. Geometry and colours follow docs/brand/mascots.md.
Every character lives in a 100x100 unit box with ~8 units of padding.

    python3 scripts/generate_mascots.py assets/brand

Rule (borrowed from HelloFugu, adapted):
  * colour says WHO the character is (Shark / Owl / Fish never change colour)
  * shape + props say the STATE (cage height = strikes, stamp shape = audit result)
"""
import os
import sys

OUT = sys.argv[1] if len(sys.argv) > 1 else "."

# ---- tokens (keep in sync with docs/brand/tokens.json) ----------------------
INK = "#161A22"        # outlines + text, never pure black
PAPER = "#F5F6F8"      # page background
TILE = "#E9EDF2"       # avatar tile
WHITE = "#FCFCFD"      # eye whites, teeth (never pure white)
ACCENT = "#2B59FF"     # "Sonar" brand accent: the Shark's tie, links, focus
GAIN = "#147A44"       # money up   (Shark verdict, Owl PASS)
LOSS = "#C2362B"       # money down (Fish verdict, Owl FAIL, cage lock)

SHARK = dict(body="#6E8BA8", belly="#EEF2F6")
OWL = dict(body="#A86B32", face="#F3E3C8", belly="#E3C49A")
FISH = dict(body="#F2B33D", belly="#FBE3A6")

SW = 3  # outline width in units


def svg(inner, bg=TILE, defs=""):
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="512" height="512">'
        f"<defs>{defs}</defs>"
        f'<rect width="100" height="100" rx="22" fill="{bg}"/>'
        f"{inner}</svg>"
    )


# Halftone dots: the shadow is a dot field, not a flat block (KOLlateral's dither DNA
# applied to Fugu-style flat vector). The dots are emitted as real circles (one path)
# instead of an SVG <pattern>, because Figma's SVG import drops pattern fills.
DOT_PITCH = 2.6
DOT_R = 0.62


def _flatten(d, steps=16):
    """Polygon from a path made of M / C / L / Z commands (absolute)."""
    import re
    toks = re.findall(r"[MCLZ]|-?\d+(?:\.\d+)?", d)
    pts, i, cur, cmd = [], 0, (0.0, 0.0), None
    while i < len(toks):
        t = toks[i]
        if t in "MCLZ":
            cmd = t
            i += 1
            if t == "Z":
                continue
        if cmd == "M" or cmd == "L":
            cur = (float(toks[i]), float(toks[i + 1]))
            pts.append(cur)
            i += 2
        elif cmd == "C":
            x1, y1, x2, y2, x3, y3 = map(float, toks[i:i + 6])
            x0, y0 = cur
            for k in range(1, steps + 1):
                s = k / steps
                a, b, c, e = (1 - s) ** 3, 3 * (1 - s) ** 2 * s, 3 * (1 - s) * s * s, s ** 3
                pts.append((a * x0 + b * x1 + c * x2 + e * x3, a * y0 + b * y1 + c * y2 + e * y3))
            cur = (x3, y3)
            i += 6
        else:
            i += 1
    return pts


def _inside(x, y, poly):
    n, j, res = len(poly), len(poly) - 1, False
    for k in range(n):
        xi, yi = poly[k]
        xj, yj = poly[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi:
            res = not res
        j = k
    return res


def halftone(shape_d, dx, dy):
    """Dots inside the shape but outside the shape shifted by (dx, dy): a lower-left crescent."""
    poly = _flatten(shape_d)
    shifted = [(x + dx, y + dy) for x, y in poly]
    h = DOT_PITCH / 2 ** 0.5  # 45-degree grid
    d = []
    for row in range(-5, 110):
        for col in range(-5, 110):
            x = col * DOT_PITCH + (h if row % 2 else 0)
            y = row * h
            # keep a small inset so dots never touch the outline
            if _inside(x, y, poly) and not _inside(x, y, shifted) and \
               all(_inside(x + ox, y + oy, poly) for ox, oy in ((1.6, 0), (-1.6, 0), (0, 1.6), (0, -1.6))):
                d.append(f"M{x - DOT_R:.1f},{y:.1f}a{DOT_R},{DOT_R} 0 1 0 {2 * DOT_R:g} 0"
                         f"a{DOT_R},{DOT_R} 0 1 0-{2 * DOT_R:g} 0")
    return f'<path d="{"".join(d)}" fill="{INK}" opacity="0.5"/>'


def shaded(shape_d, fill, dx, dy, cid):
    """Fill a shape, then add a halftone shadow crescent on the lower-left side."""
    return (
        f'<clipPath id="{cid}"><path d="{shape_d}"/></clipPath>'
        f'<path d="{shape_d}" fill="{fill}"/>'
        + halftone(shape_d, dx, dy)
    )


# =============================================================================
# SHARK - the employee. Sales + analyst. Signature prop: a necktie.
# State channel: the cage. strikes 0..3 lowers a cage from the top.
# =============================================================================
SHARK_BODY = ("M22,50 C34,33 62,31 80,39 C88,43 92,49 90,55 "
              "C87,63 74,71 54,72 C38,73 28,65 22,58 Z")
SHARK_TAIL = "M25,51 L7,33 C12,45 12,55 6,71 L25,58 Z"
SHARK_DORSAL = "M46,36 C48,26 53,19 61,16 C59,25 60,31 65,37 Z"
SHARK_PEC = "M50,65 C47,74 42,80 35,83 C45,82 54,77 61,68 Z"


def shark(strikes=0, mood="neutral"):
    p = []
    o = f'stroke="{INK}" stroke-width="{SW}" stroke-linejoin="round" stroke-linecap="round"'
    p.append(f'<g {o}>')
    p.append(f'<path d="{SHARK_TAIL}" fill="{SHARK["body"]}"/>')
    p.append(f'<path d="{SHARK_DORSAL}" fill="{SHARK["body"]}"/>')
    p.append("</g>")
    # body with belly + halftone shadow, outline on top
    p.append('<g stroke="none">')
    p.append(shaded(SHARK_BODY, SHARK["body"], 4, -5, "sb"))
    p.append(f'<g clip-path="url(#sb)"><ellipse cx="60" cy="74" rx="34" ry="12.5" '
             f'fill="{SHARK["belly"]}"/></g>')
    p.append("</g>")
    p.append(f'<path d="{SHARK_BODY}" fill="none" {o}/>')
    # gills
    for gx in (56, 60.5, 65):
        p.append(f'<path d="M{gx},46 q-2.2,4.5 0,9" fill="none" stroke="{INK}" '
                 f'stroke-width="1.8" stroke-linecap="round"/>')
    # pectoral fin in front of belly
    p.append(f'<path d="{SHARK_PEC}" fill="{SHARK["body"]}" {o}/>')
    # mouth: white grin with zigzag teeth
    if mood == "sad":
        p.append(f'<path d="M71,61 Q79,56 87,60" fill="none" stroke="{INK}" '
                 f'stroke-width="2.4" stroke-linecap="round"/>')
    else:
        p.append(f'<path d="M68,57 Q78,65 88,55 Q80,59 68,57 Z" fill="{WHITE}" '
                 f'stroke="{INK}" stroke-width="2.2" stroke-linejoin="round"/>')
        p.append(f'<path d="M71,58.2 l1.6,2 l1.6,-1.6 l1.6,2.2 l1.6,-1.8 l1.6,2 l1.6,-2.1 '
                 f'l1.6,1.4 l1.6,-2.2" fill="none" stroke="{INK}" stroke-width="1.1" '
                 f'stroke-linejoin="round"/>')
    # eye + glint (+ brow that carries mood)
    p.append(f'<circle cx="73" cy="46" r="6" fill="{WHITE}" stroke="{INK}" stroke-width="2.4"/>')
    if mood == "sad":
        p.append(f'<circle cx="73.4" cy="48" r="2.6" fill="{INK}"/>')
        p.append(f'<path d="M66,41 L78,38" stroke="{INK}" stroke-width="2.8" stroke-linecap="round"/>')
    else:
        p.append(f'<circle cx="74.4" cy="46.4" r="3" fill="{INK}"/>')
        p.append(f'<circle cx="72.9" cy="44.6" r="1.05" fill="{WHITE}"/>')
        p.append(f'<path d="M66,38.5 L79,40.5" stroke="{INK}" stroke-width="2.8" stroke-linecap="round"/>')
    # signature prop: necktie (the "& Co."), attached under the jaw
    p.append(f'<path d="M66.5,67 L72.5,66 L71.5,70 L67.5,70.6 Z" fill="{ACCENT}" '
             f'stroke="{INK}" stroke-width="1.8" stroke-linejoin="round"/>')
    p.append(f'<path d="M67.6,70.5 L71.4,70 L73,80 L69.6,83 L66.6,80.6 Z" fill="{ACCENT}" '
             f'stroke="{INK}" stroke-width="1.8" stroke-linejoin="round"/>')
    p.append(cage(strikes))
    return svg("".join(p))


def cage(strikes):
    """Strike channel. 0 = free, 1/2 = cage lowering, 3 = closed + padlock."""
    if strikes <= 0:
        return ""
    bottom = {1: 30, 2: 58, 3: 90}[min(strikes, 3)]
    g = [f'<g stroke="{INK}" stroke-linecap="round" fill="none">']
    g.append(f'<path d="M10,8 H90" stroke-width="3.4"/>')  # top rail
    for x in range(14, 91, 9):
        g.append(f'<path d="M{x},8 V{bottom}" stroke-width="2.4"/>')
    if strikes >= 3:
        g.append(f'<path d="M10,{bottom} H90" stroke-width="3.4"/>')
        g.append(f'<path d="M10,50 H90" stroke-width="1.6" opacity="0.6"/>')
    g.append("</g>")
    # strike tally: three slots top-right, filled = strike
    for i in range(3):
        cx = 64 + i * 9
        filled = i < strikes
        g.append(f'<rect x="{cx - 3.4}" y="91" width="6.8" height="4" rx="1" '
                 f'fill="{LOSS if filled else WHITE}" stroke="{INK}" stroke-width="1.2"/>')
    if strikes >= 3:  # padlock
        g.append(f'<path d="M45,56 v-4 a5,5 0 0 1 10,0 v4" fill="none" stroke="{INK}" stroke-width="2.4"/>')
        g.append(f'<rect x="42" y="55" width="16" height="12" rx="2.5" fill="{LOSS}" '
                 f'stroke="{INK}" stroke-width="2.2"/>')
        g.append(f'<circle cx="50" cy="60.5" r="1.6" fill="{WHITE}"/>')
    return "".join(g)


# =============================================================================
# OWL - the auditor. Recomputes every verdict inside a TEE.
# Signature prop: thick round glasses. State channel: eyes + a stamp.
# =============================================================================
OWL_BODY = "M50,22 C70,22 79,40 79,58 C79,76 67,88 50,88 C33,88 21,76 21,58 C21,40 30,22 50,22 Z"


def owl(state="auditing"):
    o = f'stroke="{INK}" stroke-width="{SW}" stroke-linejoin="round" stroke-linecap="round"'
    p = []
    # ear tufts + wings behind body
    p.append(f'<g {o} fill="{OWL["body"]}">'
             '<path d="M31,30 L28,15 L42,25 Z"/><path d="M69,30 L72,15 L58,25 Z"/>'
             '<path d="M23,52 C12,60 13,74 22,82 C24,72 26,64 27,56 Z"/>'
             '<path d="M77,52 C88,60 87,74 78,82 C76,72 74,64 73,56 Z"/></g>')
    p.append('<g stroke="none">')
    p.append(shaded(OWL_BODY, OWL["body"], 5, -5, "ob"))
    p.append(f'<g clip-path="url(#ob)"><ellipse cx="50" cy="74" rx="20" ry="17" fill="{OWL["belly"]}"/></g>')
    p.append("</g>")
    p.append(f'<path d="{OWL_BODY}" fill="none" {o}/>')
    # belly chevrons (feathers)
    for (x, y) in ((44, 70), (56, 70), (50, 78)):
        p.append(f'<path d="M{x - 3},{y} l3,3 l3,-3" fill="none" stroke="{INK}" stroke-width="1.6" '
                 f'stroke-linecap="round" stroke-linejoin="round"/>')
    # face disc
    p.append(f'<path d="M50,36 C44,30 30,31 28,43 C27,53 36,58 50,55 C64,58 73,53 72,43 '
             f'C70,31 56,30 50,36 Z" fill="{OWL["face"]}" stroke="{INK}" stroke-width="2.2"/>')
    # eyes (inside glasses)
    for cx in (39, 61):
        p.append(f'<circle cx="{cx}" cy="44" r="7.2" fill="{WHITE}"/>')
        if state == "auditing":   # pupils scanning right
            p.append(f'<circle cx="{cx + 2.6}" cy="44.5" r="3.2" fill="{INK}"/>')
            p.append(f'<circle cx="{cx + 1.4}" cy="42.8" r="1" fill="{WHITE}"/>')
        elif state == "pass":     # content, eyes closed upward arcs
            p.append(f'<path d="M{cx - 4},45.5 q4,-4.5 8,0" fill="none" stroke="{INK}" '
                     f'stroke-width="2.4" stroke-linecap="round"/>')
        elif state == "fail":     # pin pupils, stern
            p.append(f'<circle cx="{cx}" cy="45" r="1.8" fill="{INK}"/>')
        elif state == "timeout":  # asleep
            p.append(f'<path d="M{cx - 4},44.5 h8" stroke="{INK}" stroke-width="2.4" stroke-linecap="round"/>')
    # glasses: the signature prop (thick frames + bridge)
    p.append(f'<g fill="none" stroke="{INK}"><circle cx="39" cy="44" r="8.6" stroke-width="2.8"/>'
             f'<circle cx="61" cy="44" r="8.6" stroke-width="2.8"/>'
             f'<path d="M47.6,43 q2.4,-2 4.8,0" stroke-width="2.4"/></g>')
    if state == "fail":
        p.append(f'<path d="M31,33 L45,37 M69,33 L55,37" stroke="{INK}" stroke-width="2.8" stroke-linecap="round"/>')
    if state == "auditing":
        p.append(f'<path d="M30,33.5 L44,32.5" stroke="{INK}" stroke-width="2.6" stroke-linecap="round"/>')
    # beak
    p.append(f'<path d="M46.5,52 L53.5,52 L50,58.5 Z" fill="#E9A23B" stroke="{INK}" '
             f'stroke-width="1.8" stroke-linejoin="round"/>')
    # feet
    for fx in (42, 58):
        p.append(f'<path d="M{fx - 4},88 l2,-3 l2,3 l2,-3 l2,3" fill="#E9A23B" stroke="{INK}" '
                 f'stroke-width="1.6" stroke-linejoin="round"/>')
    # stamp: shape carries the result, colour is a bonus
    if state == "pass":
        p.append(stamp(GAIN, f'<path d="M77,82 l3.4,3.6 l6.6,-7.2" fill="none" stroke="{WHITE}" '
                 f'stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>'))
    elif state == "fail":
        p.append(stamp(LOSS, f'<path d="M78,78 l7,7 m0,-7 l-7,7" fill="none" stroke="{WHITE}" '
                 f'stroke-width="2.8" stroke-linecap="round"/>'))
    elif state == "timeout":  # "z z" drawn as paths so it survives SVG import without fonts
        p.append(f'<path d="M71,17 h6 l-6,7 h6 M80,9 h4.5 l-4.5,5 h4.5" fill="none" stroke="{INK}" '
                 f'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>')
    elif state == "auditing":
        # magnifier sweep mark (three dots = working)
        for i, x in enumerate((76, 81, 86)):
            p.append(f'<circle cx="{x}" cy="86" r="1.8" fill="{INK}" opacity="{0.35 + i * 0.3:.2f}"/>')
    return svg("".join(p))


def stamp(color, glyph):
    return (f'<circle cx="81.5" cy="82" r="10" fill="{color}" stroke="{INK}" stroke-width="2.4"/>'
            + glyph)


# =============================================================================
# Verdict emblems. Deliberately NOT the employee Shark, so "Shark the agent"
# and "Shark the verdict" never get confused.
#   SHARK verdict = a fin cutting through the water   (the call made money)
#   FISH  verdict = a fish with a hook in its lip     (the call lost money)
# =============================================================================
def verdict_shark():
    p = []
    o = f'stroke="{INK}" stroke-width="{SW}" stroke-linejoin="round" stroke-linecap="round"'
    fin = "M30,64 C36,46 46,26 64,18 C60,34 62,50 72,64 Z"
    p.append('<g stroke="none">' + shaded(fin, SHARK["body"], 5, -4, "vf") + "</g>")
    p.append(f'<path d="{fin}" fill="none" {o}/>')
    # water: two wave lines, wake behind the fin
    p.append(f'<path d="M8,66 q7,-5 14,0 t14,0 t14,0 t14,0 t14,0 t14,0" fill="none" {o}/>')
    p.append(f'<path d="M18,76 q7,-5 14,0 t14,0 t14,0 t14,0" fill="none" stroke="{INK}" '
             f'stroke-width="2" stroke-linecap="round" opacity="0.55"/>')
    p.append(f'<path d="M76,58 l8,-6 M78,63 l10,-3" stroke="{INK}" stroke-width="2" stroke-linecap="round"/>')
    # up-arrow chip: shape says "up", colour says "gain"
    p.append(f'<rect x="64" y="80" width="26" height="12" rx="6" fill="{GAIN}" stroke="{INK}" stroke-width="2"/>')
    p.append(f'<path d="M77,89 v-6 m-3,3 l3,-3 l3,3" fill="none" stroke="{WHITE}" stroke-width="2" '
             f'stroke-linecap="round" stroke-linejoin="round"/>')
    return svg("".join(p))


def verdict_fish():
    p = []
    o = f'stroke="{INK}" stroke-width="{SW}" stroke-linejoin="round" stroke-linecap="round"'
    body = "M22,58 C26,44 40,36 56,36 C70,36 80,46 80,58 C80,70 70,79 56,79 C40,79 26,71 22,58 Z"
    # fishing line from the top + hook in the lip
    p.append(f'<path d="M78,4 V50" stroke="{INK}" stroke-width="1.4"/>')
    p.append(f'<path d="M8,44 L24,58 L8,72 Z" fill="{FISH["body"]}" {o}/>')
    p.append(f'<path d="M48,37 C50,28 58,24 64,26 C62,30 62,34 64,38 Z" fill="{FISH["body"]}" {o}/>')
    p.append('<g stroke="none">' + shaded(body, FISH["body"], 4, -5, "fb"))
    p.append(f'<g clip-path="url(#fb)"><ellipse cx="54" cy="78" rx="28" ry="11" fill="{FISH["belly"]}"/></g></g>')
    p.append(f'<path d="{body}" fill="none" {o}/>')
    # worried eye + brow tilted up in the middle + sweat
    p.append(f'<circle cx="64" cy="51" r="7" fill="{WHITE}" stroke="{INK}" stroke-width="2.4"/>')
    p.append(f'<circle cx="65" cy="52.5" r="2" fill="{INK}"/>')
    p.append(f'<path d="M57.5,41 L70,44.5" stroke="{INK}" stroke-width="2.6" stroke-linecap="round"/>')
    p.append(f'<path d="M72.5,38 q3.2,4 0,6.4 q-3.2,-2.4 0,-6.4 Z" fill="{WHITE}" stroke="{INK}" stroke-width="1.5"/>')
    # open mouth with hook
    p.append(f'<ellipse cx="78.5" cy="62" rx="2.6" ry="3.4" fill="{INK}"/>')
    p.append(f'<path d="M78,50 V60 a4,4 0 0 0 8,0 l-2,-2" fill="none" stroke="{INK}" stroke-width="2.2" '
             f'stroke-linecap="round" stroke-linejoin="round"/>')
    # down-arrow chip
    p.append(f'<rect x="10" y="82" width="26" height="12" rx="6" fill="{LOSS}" stroke="{INK}" stroke-width="2"/>')
    p.append(f'<path d="M23,85 v6 m-3,-3 l3,3 l3,-3" fill="none" stroke="{WHITE}" stroke-width="2" '
             f'stroke-linecap="round" stroke-linejoin="round"/>')
    return svg("".join(p))


FILES = {
    "shark.svg": shark(0),
    "shark-strike-1.svg": shark(1),
    "shark-strike-2.svg": shark(2),
    "shark-caged.svg": shark(3, mood="sad"),
    "owl.svg": owl("auditing"),
    "owl-pass.svg": owl("pass"),
    "owl-fail.svg": owl("fail"),
    "owl-timeout.svg": owl("timeout"),
    "verdict-shark.svg": verdict_shark(),
    "verdict-fish.svg": verdict_fish(),
}

if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    for name, data in FILES.items():
        with open(os.path.join(OUT, name), "w") as f:
            f.write(data)
    print(f"wrote {len(FILES)} files to {OUT}")
