# Shark & Co. — Mascot spec v0.2

**Date:** 23 Oct 2026 · **Source of truth:** `scripts/mascots.js` → `node scripts/generate_mascots.mjs assets/brand` (the Python generator is superseded)
**Companion:** `tokens.json` (colours, fonts, radius, motion)

Method borrowed from HelloFugu (`docs/brand/characters.md` + `generate-svg.py`): spec first, geometry second, every visual state maps to a real contract state. Look borrowed from KOLlateral: light cool paper, ink outlines, halftone dots instead of flat shadows. Hero structure borrowed from HelloFugu: split pane + showcase card + proof pills.

---

## 0. The one rule

> **Colour says WHO. Shape and props say WHAT STATE.**

- Shark is always steel blue, Owl always brown, Fish always yellow. A colour never changes because of a state.
- State is carried by things that survive grayscale and 48 px: the cage height, the stamp shape (✓ / ✕), the arrow direction on a verdict chip, the eyes.
- `gain` green and `loss` red are used for **money only** (verdict, bps, refunds). Strikes are not money: they use ink. Never for buttons or decoration.

## 1. Family rules

| Aspect | Rule |
|---|---|
| Frame | 100×100 unit box, rounded tile (`rx 22`, `tile #E9EDF2`), ~8 u padding |
| Outline | 3 u, `ink #161A22`, round joins and caps. Never pure black |
| Fill | Flat colour + one lighter belly shape clipped to the body |
| Shadow | **Halftone dot field** (2.6 u pitch, 45°, 55% opacity) in a lower-left crescent. This is the KOLlateral dither DNA |
| Eyes | White circle, ink pupil, one white glint at ten o'clock |
| Prop | Exactly one per character, attached to the body: Shark = tie, Owl = glasses, Fish = hook |
| Facing | Characters in profile face **right** (toward the content / CTA) |

## 2. Characters

### 🦈 Shark: the employee (sales + analyst)
- **Temperament:** a confident salesman with a grin. Talks in numbers.
- **Silhouette:** torpedo body, tall dorsal fin, crescent tail. The only character with a triangle on top.
- **Prop:** accent-blue **necktie** (the "& Co."). It's the only place the brand accent appears on a mascot.
- **State channel: the cage = strikes** (mirrors `strike_threshold` in the contract)

| Strikes | Visual | Contract meaning |
|---|---|---|
| 0 | No cage, grin | Free, taking orders |
| 1 | Cage lowered to 30%, one ink tally slot | One Owl disagreement |
| 2 | Cage at 58%, two ink slots | One strike from cage |
| 3 | Cage closed + bottom rail + accent-blue padlock, frown | **Caged**: `create_order` rejects until an owner resets |

Shape progression (cage height) works without colour. The padlock appears only at 3.

### 🦉 Owl: the auditor (recomputes in a TEE)
- **Temperament:** a pedantic accountant. Never jokes. Speaks in proofs.
- **Silhouette:** upright egg with two ear tufts. The only vertical character.
- **Prop:** thick round **glasses**.
- **State channel: eyes + stamp** (mirrors the order state machine)

| Owl state | Eyes | Stamp | Order state |
|---|---|---|---|
| `auditing` | Pupils looking right, one brow up | Three dots (working) | `Judged`, waiting for callback |
| `pass` | Closed happy arcs | Green circle **✓** | `Audited` → settleable |
| `fail` | Pin pupils, angry brows | Red circle **✕** | `Refunded` + Shark strike |
| `timeout` | Flat closed lines, "z z" | None | `Refunded` (audit timeout) |

### Verdict emblems (not characters)
These are deliberately **not** the employee Shark, so "Shark the agent" and "Shark the verdict" are never confused.

| Verdict | Emblem | Chip |
|---|---|---|
| **SHARK**: the call made money | A dorsal fin cutting through water | Green chip, **up** arrow |
| **FISH**: the call lost money | A worried yellow fish with a **hook in its lip** (it got hooked by the call) | Red chip, **down** arrow |

## 3. Mandatory tests before an asset ships
1. Render at 48×48, grayscale: shark / caged shark / owl pass / owl fail / fin / fish must all be told apart.
2. Each state also exists as text next to it (chip or label). No state lives only in the picture.
3. `aria-label` is a full sentence, e.g. *"Shark, 2 of 3 strikes. One more disagreement locks new orders."*
4. Under `prefers-reduced-motion`, nothing moves and nothing is lost.

## 4. Motion (web)
- The cage **drops** 420 ms ease-out when a strike lands. It never animates up on its own (only an owner reset lifts it).
- Owl `auditing`: the three dots pulse in sequence. `pass`/`fail` stamps pop in (scale 0.9 → 1).
- The hero showcase card flips in once, then bobs (Fugu pattern). The caged state is **still**.

## 5. Open items
- O-M1: the shark tail outline is slightly uneven at 512 px. Polish once in Figma, then port the path back.
- O-M2: Owners (humans) have no mascot yet. Proposal: a plain ink silhouette with a hard hat, used only on the dashboard.
- O-M3: a logo mark (Shark fin + "& Co." wordmark) is still to be designed.


---

## v0.2 additions (SRD v0.2: auditor auction, Chain Signatures payouts)

### 🐦‍⬛ Raven: auditor #2
- **Who:** independent auditor business, paid in USDC on **Base via Chain Signatures**.
- **Colours:** body `#5E5A86` (violet-slate), belly `#B3AFD6`, beak `#2F2B45`, pouch `#D8B46A`. Not green, red or accent blue; distinct from Shark, Owl and Fish in grayscale.
- **Silhouette:** upright egg like Owl, but a **swept crest** (no ear tufts), **long dark beak**, pointed tail. No glasses.
- **Prop:** a **coin pouch with a chain link** at the left hip (the cross-chain payout).

### Auditor states (same set for Owl and Raven)
Every state has a badge in the same slot (bottom-right), so the glyph shape alone tells the state. Body colour never changes.

| State | Eyes | Badge | Contract meaning |
| --- | --- | --- | --- |
| Bidding | looking at the job | price tag (`$`) | replied to the RFQ |
| Won bid | happy arcs | rosette with star | awarded the job |
| Lost bid | lids down, whole body faded | struck, dashed tag | another bid won |
| Auditing | scanning right + brow | three dots | escrow funded, audit running |
| Pass | happy arcs | green ✓ (money: fee released) | agrees with Shark |
| Disagree | pin pupils, angry brows | ink **!** (not red: not money) | disagrees → tie-break |
| Tie-break | one eye each side | balance scales | hired as second opinion |
| Unpaid | worried brows, eyes down | red crossed coin (money withheld) | lost the dispute, fee withheld |
| Unresolved | neutral eyes | white disc, coin closed with a small ink padlock (not red: fee held, not lost) | disagreed, no tie-breaker free; customer refunded, fee held until a tie-break (SRD v1.0) |
| Late | asleep + "z z" | — | missed the deadline → re-auction |
| Suspended | flat closed | ink lock | `disputes_lost ≥ suspend_threshold` |

### Shark decision states
| State | Prop | Meaning |
| --- | --- | --- |
| Pricing | price tag hanging onto the owners' **price band** ruler, marker inside min–max | `set_price` (max once per hour, with a reason) |
| Hiring | two bid cards, the chosen one ticked | `award` to the winning auditor |

Strike/cage states are unchanged. The old `owl.svg / owl-fail.svg / owl-timeout.svg` files are v0.1 leftovers (now `owl-auditing / owl-disagree / owl-late`).
