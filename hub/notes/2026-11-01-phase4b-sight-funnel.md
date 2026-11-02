# BCM Phase 4b — Shell ID by Sight: sharper results, Start Over at the top, "Fill in the blanks" retired (2026-11-01, 23:05 ET)

Bill's report (22:53 ET): Advanced Search → **Fill in the blanks** never seems to return anything; **Shell ID by Sight** "digs deeper" after Start Over and feels unreliable; only **Pick visually** clearly works.

## What the data showed (124 species, scoring code evaluated offline — `tests/funnel-analysis.js`)

- **Fill in the blanks** = exact-match AND across six raw database fields with dropdowns showing tokens like `auger`, `collar`, `extra-large`. **59% of all two-filter combinations return zero.** Working as coded; wrong design. Retired.
- **Shell ID by Sight** ranks well — 114/124 species land in the top 8 when answered with their own attributes — but the pass bar (score > 20) let 60–122 of 124 species through on every path ("Showing top 8 of 111 matches"), and **Start Over reset the steps without scrolling up**, leaving the user at the bottom of step 1: the "digging deeper" feeling.
- **Pick visually** (species cheat sheet) works; it is now the only Advanced Search.

## Changes (app only)

| File | Destination | What |
|---|---|---|
| `public_html/app/index.html` | `public_html/app/index.html` (**overwrite**) | Phase 4b. 3195514 bytes. Backup of the live 4a file beside it: `index.backup-2026-11-01-4a.html` (3,195,340 bytes). |

1. Full 4-step paths require **score ≥ 70** (structure + at least one strong attribute agree); Flat/Disc and Tube fast-track keep their own bar (≥ 40). Results list shows **12** (was 8). On the data: median **21** candidates per path (was 92), never zero, **117/124** species appear in the shown list when answered correctly (was 114).
2. **Scroll to top** on every step change and on Start Over (`#bcm-scroll`).
3. Both "Try Advanced Search → Fill in the blanks" links removed; "Advanced Search → Pick visually" stays on step 1 and on the results page. The `AdvancedSearch` dropdown screen's code remains in the file, unreachable (zero risk; revivable as a tolerant filter if ever wanted). Results caption now reads "Showing the top 12 of N likely matches. Not here? Browse all species below."

## Verification (headless Chromium 390×844)

Funnel suite 12/12 (`tests/funnel-test.js`): opens at STEP 1; no "Fill in the blanks" link, "Pick visually" present; step 2 reached with scrollTop 0 after scrolling down first; Spiral → Smooth → Banded → Medium shows "top 12 of 24" with True Tulip and Banded Tulip listed; results page at top; Start Over from the bottom of results → STEP 1 at scrollTop 0; Disc fast-track still lists Sand Dollar and urchins; Pick visually opens the cheat sheet (Junonia, Lightning Whelk, Alphabet Cone); all 122 paths evaluated in-page: min 2, median 21, max 85; no page errors. Regression: 3g 16/16, 3h 16/16, Phase 4 cloud e2e 24/24 on this file. `node --check` clean.

## Caveat (stated before building)

The bar is judged against the database's own labels. A worn shell can make "Smooth & Glossy" vs "Heavily Ribbed" a coin flip; with the 70 bar, getting **two** of the three attributes wrong drops the right species out of the list (before, it was merely buried). Nancy's real use is the test. Fallback if it feels too strict: `minScore` 60 (median 38 candidates, 114/124).

## Phone check

Home → Shell ID by Sight → answer four steps → a short list (a dozen or fewer); scroll down, tap **Start Over** → step 1 at the top. The only Advanced Search link is Pick visually. Flat/Disc → sand dollars and urchins.

## Upload

TUS upload of `app/index.html` (201 / 204, offset 3195514), cache clear, read back. Status: **LIVE** (uploaded 2026-11-01 on Bill's "Yes, upload").
