# Pixel comparison with Figma · 31 Oct 2026

**What was compared:**
- **Figma:** the four v2.0 frames, exported at 1× (1440 wide): Landing `149:3998`, Order `150:3999`, Job `153:5264` (payer view) and The company `154:3972` (testnet).
- **Ours:** the same pages at 1440 px with reduced motion, in the same state:
  - **Order:** after a mock payment, delivered.
  - **Job:** the payer view.
  - **The company:** testnet mock data.

**How:**
- Each Figma section box comes from `get_metadata`, and each of ours from the DOM.
- Pixels are compared on a canvas: a pixel counts as different when any colour channel differs by more than 48.
- No new packages. The script is kept in the session scratchpad.

**Images:** `docs/web/screens/pixel/*.png` show Figma | ours | diff (red = different) for the sections below. All numbers are in `docs/web/screens/pixel/report.json`.

**How to read the diff %:** sections that are identical in size and layout (nav, footer, company P&L) still differ by **3 to 4%**. That is font anti-aliasing and the live shader, so treat **≤ 5% at equal size as a match**. Size differences (Δw, Δh) are the more reliable signal.

**Status 1 Nov:** every proposed fix (D1, D3 to D7, D9 to D12) is applied. What is left is listed in §4 and is data or design choice, not a code defect.

## 1. Results by section

| Page · section | Figma (w×h) | Ours (w×h) | Δ | Diff | Verdict |
| --- | --- | --- | --- | --- | --- |
| Landing · nav | 1440×99 | 1440×99 | 0 | 4.0% | ✅ match |
| Landing · hero | 1440×850 | 1440×850 | 0 | 13.4% | ✅ after D1 (height and fin placement; rest is the live shader) |
| Landing · what we do | 1440×494 | 1440×494 | 0 | 3.0% | ✅ match after D9 |
| Landing · how it works | 1440×979 | 1440×1416 | h +437 | 7.9% | ✅ by design (D2) |
| Landing · rules | 1440×788 | 1440×787 | h −1 | 4.4% | ✅ match after D9 |
| Landing · auction | 1440×1105 | 1440×1108 | h +3 | 5.5% | ✅ match after D9 |
| Landing · for agents | 1440×751 | 1440×637 | h −114 | 5.1% | ✅ after D3, D9 (gap is the hidden docs button, see §4) |
| Landing · ledger | 1440×661 | 1440×663 | h +2 | 3.7% | ✅ match after D9 |
| Landing · CTA | 1440×360 | 1440×360 | 0 | 5.5% | ✅ match |
| Landing · footer | 1440×75 | 1440×107 | h +32 | 4.1% | ❓ Figma itself differs (D8) |
| Order · header | 1296×181 | 1296×181 (content) | 0 | n/a | ✅ match |
| Order · step 01 | 852×336 | 852×320 | h −16 | 9.0% | ✅ after D4, D5 |
| Order · step 02 | 852×539 | 852×540 | h +1 | 6.0% | ✅ after D5 |
| Order · step 03 | 852×559 | 852×445 | h −114 | 12.1% | ✅ after D6 (register box shows only when needed) |
| Order · step 04 | 852×367 | 852×410 | h +43 | 6.2% | ✅ content (the delivered state shows more than the frame) |
| Order · receipt | 420×702 | 420×678 | h −24 | 10.9% | ✅ after D4 |
| Order · footer | 1440×107 | 1440×107 | 0 | 2.8% | ✅ match |
| Job · header | 1296×181 | 1296×213 (content) | h +32 | 3.6% | ✅ lede 2 lines after D7, rest is the status chips row |
| Job · steps 01 to 05 | 852 wide | 852 wide | h −29 to +2 | 6 to 10% | ✅ after D4 |
| Job · receipt | 420×702 | 420×678 | h −24 | 10.7% | ✅ after D4 |
| Company · P&L | 1296×261 | 1296×261 | 0 | 3.9% | ✅ match |
| Company · price | 800×838 | 800×810 | h −28 | 8.4% | ✅ after D10 |
| Company · owner limits | 472×874 | 472×857 | h −17 | 9.2% | ✅ after D10 |
| Company · auctions | 1296×1046 | 1296×958 | h −88 | 8.2% | ✅ data: Figma shows 6 auctions, the mock 5 |
| Company · workers | 860×1477 | 860×1061 | h −416 | 5.5% | ✅ after D10 (height: see §4) |
| Company · strikes | 412×1477 | 412×1061 | h −416 (same as workers) | 8.4% | ✅ after D11 |
| Company · reserve | 752×750 | 752×718 | h −32 | 8.2% | ✅ after D10, D12 |
| Company · owners | 520×750 | 520×718 | h −32 | 10.0% | ✅ after D10 |
| Company · payouts | 1296×817 | 1296×653 | h −164 | 7.2% | ✅ data: Figma shows 7 payouts, the mock 5 |

## 2. Differences found and what was done

| # | Difference | Proposed fix | Size |
| --- | --- | --- | --- |
| **D4 ✅ fixed 31 Oct** | **Order and Job column widths.** Figma: steps 852, receipt **420**, gap 24. Ours: steps 928, receipt **344**. This one value moves every step and the whole receipt card | **Done:** receipt column 420 px (344 px below 1280 px, so 1024 still fits). Steps are now 852 wide, as in Figma | Small |
| **D5 ✅ fixed 31 Oct** | **Order step 02 is a different layout.** Figma: a compact row (price · max words · quote expires), then the checklist, then one reason line. Ours: the full BriefCard (brief header, params table, guarantee box) inside the step, 444 px taller | **Done:** step 02 is the Figma layout: a price · limit (max words, posts or records) · countdown row, "Shark’s brief · checked by code" and AI checklists, then the one reason line. Change the order / Get a new quote stay below it while unpaid. Step 01 shows the instructions with their label and hint. BriefCard stays in the gallery. The "waiting" label on pending rows was removed 1 Nov (the pending icon already says it) | Medium |
| **D6 ✅ fixed 31 Oct** | **Order step 03.** Figma shows the network as a dashed accent "● TESTNET" badge and keeps the register box visible in the frame. Ours uses an outline chip and shows the register box only when needed (correct per FR-11) | Use the dashed NetworkBadge from Figma. Keep the register box conditional (behaviour wins over the static frame) | Small |
| **D1 ✅ fixed 31 Oct, shader 1 Nov** | **Hero.** Ours is 58 px taller and the proof pills sit about 24 px lower. The halftone fin is drawn live by the shader, so its size and horizon differ from the Figma still | **Done:** 850 px height and pill position. Shader fin is now 0.72 of the hero height, centred at 82% of the width, so its peak shows right of the job card as in the still | Small (height), Medium (shader) |
| **D3 ✅ fixed 31 Oct** | **Landing "For agents".** Figma's 4 points are plain items with dividers, not boxed cards, and "Read the API docs" shows. Ours boxes them and hides the button while `NEXT_PUBLIC_DOCS_URL` is empty | Drop the boxes to match. The button stays hidden until the docs URL exists (intended) | Small |
| **D7 ✅ fixed 31 Oct** | **Job header lede wraps to 3 lines.** Ours caps it at 760 px, Figma uses 820 px | Set max width to 820 px | Tiny |
| **D10 ✅ fixed 1 Nov** | **Company column widths.** Figma uses fixed splits: price 800 / limits 472, workers 860 / strikes 412, reserve 752 / owners 520. Ours use 1fr + fixed or 1fr / 1fr, so they come out 48 to 116 px off | **Done:** `800fr 472fr`, `860fr 412fr`, `752fr 520fr`. Widths match at 1440 and scale down at 1280 and 1024 | Small |
| **D11 ✅ fixed 1 Nov** | **Company strikes pane.** In Figma it stretches to the workers pane height (1477), and its complaints log uses mono titles with muted mono details. Ours ends at its content and uses body text | **Done:** workers and strikes, and reserve and owners, stretch to equal height. The log details are mono | Small |
| **D12 ✅ fixed 1 Nov** | **Reserve bar.** Figma: a light track with an ink fill up to the balance and the floor marker on it. Ours: a full ink bar with the marker | **Done:** a light track with an ink fill. Scale is 5 × the floor (or the balance when bigger), so the floor marker sits at 20% as in Figma | Small |
| **D9 ✅ fixed 1 Nov** | **Spacing drift** of 17 to 167 px on Landing rules, auction and ledger, and Company auctions and payouts. Mostly gaps between blocks and inner card padding (Figma steps use 29 px padding, ours 24) | **Done:** the cause was one missing 20 px gap between every section intro and its content (Figma: lede end + 20). Added to the shared section header. Also: ledger tiles 116 px and rows 50 px with 8 px gaps, the What we do lede on one line, Company pane intros in body text, "how Shark picks" filled grey. Order and Job steps are within 29 px and differ by content, not padding | Medium |
| D2 | **How it works** is 437 px taller under reduced motion, because every step body is shown (the prompt asks for a "numbered list" under reduced motion) | None: intended. With motion on, only the active step opens, as in Figma | none |
| D8 | **Footer.** Figma's Landing footer is 75 px, but the Order, Job and Company footers are 107 px. Ours is 107 px everywhere | None in code. Owner: pick one in Figma | none |

**Expected and not a defect:**
- The mock data shows **SAMPLE** chips where the Figma frame shows **LIVE · from the contract**.
- Order shows "Payment sent" because it was captured after paying.
- Dates and times in the mock differ from the Figma sample.

## 3. Suggested order
All done (1 Nov).

## 4. Left as is (not code defects)
- **Company workers pane (−416 px):** Figma stacks Crab, Raven and Owl in one 472 px column and leaves the right half of the pane empty. Ours uses two columns. Owner: say if you want the single column.
- **For agents (−114 px):** "Read the API docs" stays hidden until `NEXT_PUBLIC_DOCS_URL` is set.
- **Company auctions and payouts:** the mock has fewer rows than the Figma sample.
- **Order step 03 (−114 px):** the register box shows only when the payer needs it (FR-11).
- **How it works (D2) and footer (D8):** as before.
