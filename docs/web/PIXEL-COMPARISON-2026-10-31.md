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

**Fixed so far:** D1 (height: hero is 850, pills sit 67 px from the bottom), D3 (plain points with a top rule, body text), D4, D5, D6 (dashed network badge), D7 (Order and Job ledes 820 px, 2 lines). The rest waits for your choice.

## 1. Results by section

| Page · section | Figma (w×h) | Ours (w×h) | Δ | Diff | Verdict |
| --- | --- | --- | --- | --- | --- |
| Landing · nav | 1440×99 | 1440×99 | 0 | 4.0% | ✅ match |
| Landing · hero | 1440×850 | 1440×850 | 0 | 14.2% | ✅ after D1 (rest is the live shader) |
| Landing · what we do | 1440×494 | 1440×502 | h +8 | 4.5% | ✅ match |
| Landing · how it works | 1440×979 | 1440×1416 | h +437 | 7.9% | ✅ by design (D2) |
| Landing · rules | 1440×788 | 1440×767 | h −21 | 7.1% | ⚠ spacing (D9) |
| Landing · auction | 1440×1105 | 1440×1088 | h −17 | 6.0% | ✅ close |
| Landing · for agents | 1440×751 | 1440×617 | h −134 | 8.6% | ✅ after D3 (gap is the hidden docs button and spacing, D9) |
| Landing · ledger | 1440×661 | 1440×632 | h −29 | 4.3% | ⚠ spacing (D9) |
| Landing · CTA | 1440×360 | 1440×360 | 0 | 5.5% | ✅ match |
| Landing · footer | 1440×75 | 1440×107 | h +32 | 4.1% | ❓ Figma itself differs (D8) |
| Order · header | 1296×181 | 1296×181 (content) | 0 | n/a | ✅ match |
| Order · step 01 | 852×336 | 852×320 | h −16 | 9.0% | ✅ after D4, D5 |
| Order · step 02 | 852×539 | 852×540 | h +1 | 6.0% | ✅ after D5 |
| Order · step 03 | 852×559 | 852×445 | h −114 | 12.1% | ✅ after D6 (register box shows only when needed) |
| Order · step 04 | 852×367 | 852×410 | h +43 | 6.2% | ⚠ spacing (D9) |
| Order · receipt | 420×702 | 420×678 | h −24 | 10.9% | ✅ after D4 |
| Order · footer | 1440×107 | 1440×107 | 0 | 2.8% | ✅ match |
| Job · header | 1296×181 | 1296×213 (content) | h +32 | 3.6% | ✅ lede 2 lines after D7, rest is spacing (D9) |
| Job · steps 01 to 05 | 852 wide | 852 wide | h −29 to +2 | 6 to 10% | ✅ after D4 |
| Job · receipt | 420×702 | 420×678 | h −24 | 10.7% | ✅ after D4 |
| Company · P&L | 1296×261 | 1296×261 | 0 | 3.9% | ✅ match |
| Company · price | 800×838 | 752×802 | w −48 | 9.3% | ⚠ D10 |
| Company · owner limits | 472×874 | 520×827 | w +48 | 9.4% | ⚠ D10 |
| Company · auctions | 1296×1046 | 1296×955 | h −91 | 8.3% | ⚠ spacing (D9) |
| Company · workers | 860×1477 | 832×1033 | w −28, h −444 | 6.0% | ⚠ D10, D11 |
| Company · strikes | 412×1477 | 440×694 | w +28, h **−783** | 15.8% | ⚠ see D11 |
| Company · reserve | 752×750 | 636×531 | w **−116** | 12.9% | ⚠ D10, D12 |
| Company · owners | 520×750 | 636×686 | w **+116** | 8.9% | ⚠ D10 |
| Company · payouts | 1296×817 | 1296×650 | h −167 | 7.4% | ⚠ spacing (D9) |

## 2. Differences found (proposed fixes, not applied)

| # | Difference | Proposed fix | Size |
| --- | --- | --- | --- |
| **D4 ✅ fixed 31 Oct** | **Order and Job column widths.** Figma: steps 852, receipt **420**, gap 24. Ours: steps 928, receipt **344**. This one value moves every step and the whole receipt card | **Done:** receipt column 420 px (344 px below 1280 px, so 1024 still fits). Steps are now 852 wide, as in Figma | Small |
| **D5 ✅ fixed 31 Oct** | **Order step 02 is a different layout.** Figma: a compact row (price · max words · quote expires), then the checklist, then one reason line. Ours: the full BriefCard (brief header, params table, guarantee box) inside the step, 444 px taller | **Done:** step 02 is the Figma layout: a price · limit (max words, posts or records) · countdown row, "Shark’s brief · checked by code" and AI checklists, then the one reason line. Change the order / Get a new quote stay below it while unpaid. Step 01 shows the instructions with their label and hint. BriefCard stays in the gallery. **Small leftover:** pending rows show "waiting" on the right, which Figma doesn't | Medium |
| **D6 ✅ fixed 31 Oct** | **Order step 03.** Figma shows the network as a dashed accent "● TESTNET" badge and keeps the register box visible in the frame. Ours uses an outline chip and shows the register box only when needed (correct per FR-11) | Use the dashed NetworkBadge from Figma. Keep the register box conditional (behaviour wins over the static frame) | Small |
| **D1 ✅ height fixed 31 Oct** | **Hero.** Ours is 58 px taller and the proof pills sit about 24 px lower. The halftone fin is drawn live by the shader, so its size and horizon differ from the Figma still | Match the 850 px height and pill position. Optionally tune the shader's fin scale and horizon (`horizon`, fin height 0.6) to the still | Small (height), Medium (shader) |
| **D3 ✅ fixed 31 Oct** | **Landing "For agents".** Figma's 4 points are plain items with dividers, not boxed cards, and "Read the API docs" shows. Ours boxes them and hides the button while `NEXT_PUBLIC_DOCS_URL` is empty | Drop the boxes to match. The button stays hidden until the docs URL exists (intended) | Small |
| **D7 ✅ fixed 31 Oct** | **Job header lede wraps to 3 lines.** Ours caps it at 760 px, Figma uses 820 px | Set max width to 820 px | Tiny |
| **D10** | **Company column widths.** Figma uses fixed splits: price 800 / limits 472, workers 860 / strikes 412, reserve 752 / owners 520. Ours use 1fr + fixed or 1fr / 1fr, so they come out 48 to 116 px off | Use the Figma ratios (for example `grid-cols-[800fr_472fr]`) so they also scale down at 1280 and 1024 | Small |
| **D11** | **Company strikes pane.** In Figma it stretches to the workers pane height (1477), and its complaints log uses mono titles with muted mono details. Ours ends at its content and uses body text | Stretch both panes to equal height. Use the Figma log type styles | Small |
| **D12** | **Reserve bar.** Figma: a light track with an ink fill up to the balance and the floor marker on it. Ours: a full ink bar with the marker | Draw a track plus fill (fill = balance relative to a scale max), as in Figma | Small |
| **D9** | **Spacing drift** of 17 to 167 px on Landing rules, auction and ledger, and Company auctions and payouts. Mostly gaps between blocks and inner card padding (Figma steps use 29 px padding, ours 24) | One pass setting section paddings and gaps to the Figma values | Medium |
| D2 | **How it works** is 437 px taller under reduced motion, because every step body is shown (the prompt asks for a "numbered list" under reduced motion) | None: intended. With motion on, only the active step opens, as in Figma | none |
| D8 | **Footer.** Figma's Landing footer is 75 px, but the Order, Job and Company footers are 107 px. Ours is 107 px everywhere | None in code. Owner: pick one in Figma | none |

**Expected and not a defect:**
- The mock data shows **SAMPLE** chips where the Figma frame shows **LIVE · from the contract**.
- Order shows "Payment sent" because it was captured after paying.
- Dates and times in the mock differ from the Figma sample.

## 3. Suggested order
1. ~~D4 and D5~~ done.
2. D10, D11, D12: Company layout.
3. ~~D3, D6, D7, D1 (height only)~~ done.
4. D9: a spacing pass.
5. D1 (shader tuning): optional.
