# Hero shader spike (local only — D-065)

Hand-written WebGL background for the landing hero: the brand fin and sea in halftone dots on paper, with a pointer lens. No library. Built 25 Oct as a local spike; **do not push**. Copy into the repo on 1 Nov.

| File | What it is |
| --- | --- |
| `hero-shader.ts` | The engine (framework-free). `createHeroShader(canvas, options)` → `{ setOptions, destroy, fps }`, or `null` when WebGL is missing. |
| `HeroShader.tsx` | Next.js client component wrapper with a static-image fallback. |
| `demo.html` | Stand-alone demo of the hero with a tuning panel (also published as a private artifact). |

## On 1 Nov
1. Copy `hero-shader.ts` and `HeroShader.tsx` to `apps/web/components/hero/`.
2. Export a still of the Figma hero (Landing v1.0, node `30:517`) to `apps/web/public/brand/hero-still.png` for the fallback.
3. Give the hero a min height of ~820 px and ≥ 200 px bottom padding so the sea (bottom 17%) stays below the CTAs.
4. In the hero section: `<HeroShader className="absolute inset-0" fallbackSrc="/brand/hero-still.png" />` with the copy on `z-10`.

## What it does
- **Drawing:** fin = brand path from `scripts/mascots.js` (`verdictShark`) drawn to a small mask texture; sea = wave rows following a moving surface; slow noise drift around the fin, kept right of the text column (`textRight`, default 46% of the width).
- **Style:** `dots` (halftone, brand default) or `bayer` (ordered-dither squares).
- **Lens:** under the pointer the field lifts and a finer dot grid fades in (eased).
- **Budget:** ≤ 30 fps; DPR ≤ 1.5, lowered automatically if the device can't keep up; paused when off-screen (IntersectionObserver) or when the tab is hidden; one still frame under `prefers-reduced-motion`; recovers from WebGL context loss.
- **Screens:** desktop and laptop only (≥ 1024 px wide); no phone layout, per D-050.
- **Colour:** ink on paper only. `tint` (accent in the mid-tones) is off by default because accent is reserved for CTAs, links and focus.

## Options
`style`, `cell` (px, default 7), `lens`, `tint` (0–1), `fps` (30), `maxDpr` (1.5), `reducedMotion`, `colors {paper, ink, accent}`, `horizon` (0.17), `textRight` (0.46).

## Not copied from KOLlateral
Written from scratch. Different technique (halftone dots of a brand shape, not a full-screen noise dither), different palette, no scanlines.
