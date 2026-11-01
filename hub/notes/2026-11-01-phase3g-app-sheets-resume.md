# BCM Phase 3g — App: sheets above the menu bar on iPhone, Dining resumes where you left off, dining data fixes, honest scan text (2026-11-01)

Nancy's 2026-11-01 reports, all in the app (`public_html/app/index.html`). The Excursion Reel **viewer** (`reel/index.php`, Phase 3f) is untouched.

| File | Destination | What |
|---|---|---|
| `public_html/app/index.html` | `public_html/app/index.html` (**overwrite**) | Parts A–D below. 3,177,293 bytes. |
| `public_html/app/index.backup-2026-11-01-3d.html` | (local only — restore copy) | Byte copy of the Phase 3d file that is live (3,173,462 bytes). Not uploaded; copy over `index.html` to roll back. |

Nothing else changes: no APK rebuild (the APK wraps the live PWA), no `_reel.php`, no catalog, no hub pages.

## Part A — bottom sheets render above the menu bar (Portal)

**Report:** in the Excursion Reel sheet, "My reels" sits so low on Nancy's iPhone that the last reel's Delete button is under the BCM menu bar; Android is fine.

**Cause:** the sheet (`position:fixed; zIndex:60`) is mounted inside the screens' scroll container (`overflowY:auto`, formerly also `-webkit-overflow-scrolling:touch`), a sibling of the menu bar (`zIndex:30`). iOS WebKit paints a fixed element inside such a scroller within the scroller's own layer: clipped at its bottom edge (78px + the 34px home-indicator inset) and under the menu bar. The sheet's own bottom padding is 28px + 34px, so the Delete row landed in the hidden band. Android has no inset and no such quirk.

**Fix:** a one-line `Portal` (`ReactDOM.createPortal` → `<body>`) wraps the overlay returned by all four `useVisibleViewport` sheets (Excursion Reel, Wrong ID, and the two zIndex-200 sheets), so each sits above the menu bar on every platform. The obsolete `WebkitOverflowScrolling:"touch"` is removed (momentum scrolling has been default since iOS 13). The sheet still scrolls internally when its content is taller than the screen.

## Part B — Dining comes back where you left off (resume)

**Report:** tapping a dining website leaves the app; on return the app is on Home, so looking at a second restaurant means Home → Dining → sub-tab → scroll the alphabetical list again, every time.

**Cause:** the website opens with `window.open(url,'_blank')`, which an iPhone home-screen app hands to Safari; coming back, iOS has usually reloaded the app, which started at `useState("home")` with no memory of where it was. Android keeps the PWA alive in the background, so it never showed. Keeping restaurant sites *inside* the app (an iframe) is not viable — most sites forbid framing — and iOS decides how external links open.

**Fix:** the app saves its place to `localStorage` (`bcm_resume_v1`) as it goes — current screen, and on Dining the sub-tab, area filter, search text and scroll position (saved on scroll, on going to background, and on leaving the page). On a fresh start **within 3 hours** it resumes there, mid-list. Only content screens resume (Dining, Local Info, Tips, Recipes); Camera / Preview / Result never do, and a record older than 3 hours is ignored (next-day opens start on Home as before). Deliberately going Home → Dining later starts at the top, as before; only an app relaunch resumes.

Implementation note: `RestaurantsScreen` is defined inside the root component, so React remounts it whenever the shell re-renders (several times at start-up). The restore therefore reads the live saved record on every mount while the resume is pending, and the resume is only marked finished when the user navigates to another screen.

## Part C — dining / airport data fixes (Nancy's list, each verified from Bill's Mac on 2026-11-01)

| Entry | Was | Now |
|---|---|---|
| Doreen's Cup of Joe | `doreenscupofjoe.com` (owner's Cloudflare firewall blocks visitors); address 1018 N Collier, phone 394-7755 — both wrong | website `doreenscupofjoemarco.com` (their new site); **267 N Collier Blvd**, **(239) 394-2600** (Yelp, TripAdvisor and their site agree) |
| Marco Island Brewery | `marcobrewery.com` → GoDaddy parked | `marcoislandbrewery.com` |
| Fin Bistro | `finbistro.com/home` → 404 | `finbistro.com` (works) |
| Osteria Capri (2 copies) | `osteriacapri.com` — server never answers; address 208 Capri Blvd / 970-5952 wrong | website removed; **387 Capri Blvd**, **(239) 970-5721** (their Facebook, Instagram, OpenTable) |
| Southwest Florida Intl (RSW) (6 copies) | no website | `flylcpa.com` |
| Marco Island Executive Airport | `marcoislandairport.com` → GoDaddy parked; phone 394-3355 | collier.gov Airport Authority page; **(239) 394-8187** (county) |
| Caxambas Park Marina | listed under Dining as "Fresh Seafood" with no website/menu — it is a county boat ramp, not a restaurant | **removed from Dining**. The Boats-tab "Caxambas Park Boat Launch" entry is unchanged. |

Not changed, flagged for a later data audit: three of these seven had wrong addresses/phones, not just dead links — the dining data was AI-generated and has never been audited. The Brewery's phone (app 394-2739, Yelp 970-0461) is unverified and left as is.

## Part D — honest scan-wait text

The identify screen said "Consulting the Gulf… / Our AI marine biologist is analyzing your shell". Nancy asked whether that is what happens; it is not. Now: **"Checking the Shell Guide… / Cook AI is matching your photo against the BeachCombersMania Shell Guide, then getting a second opinion"** — which is what `/api/identify` does (catalog-grounded Claude call, Google Vision hints, OpenRouter second opinion).

## Local verification (headless Chromium, iPhone 390×844, React vendored, network to CDN/API blocked)

18 checks, all passing (re-run after Parts C–D) (`node --check` clean on both inline scripts):
- Fresh launch → Home; resume record written.
- Planted Dining record (scrollTop 700) → launches on Dining, `#bcm-scroll` at 700; still 700 after 1.2s of start-up re-renders.
- Scroll to 1200 + background → record now 1200. Stale (4h) record → Home. Camera record → Home.
- Dining → Home → Dining starts at the top (resume consumed).
- Dining list renders with the Part C data: Doreen's at 267 N Collier, no Caxambas Park Marina card, Brewery and Fin Bistro present, 21 cards with Call buttons, no page errors.
- Excursion Reel sheet mounted *inside* the scroller: overlay is a direct child of `<body>`, `fixed` z 60, sheet bottom edge at 844 = viewport bottom; a hit-test 20px above the screen bottom lands in the sheet, not the menu bar. No page errors.

## Not done / later

- Real-device check is Bill's/Nancy's: (A) Collection → Excursion Reel → scroll "My reels" to the bottom → Delete on the last reel is tappable above the menu bar. (B) Dining → pick a sub-tab, scroll down, tap a website; come back (Done / app switcher) → the app is on Dining at the same spot; tap another website and repeat. Then Home → Dining → list starts at the top.
- The other sheets (Wrong ID etc.) got the same Portal fix untested on device; same mechanism.
- `reel/index.php` (3f) and this file go into `bcm-api` under `hub/` via **PR #11** so the Hostinger-deployed files have history. Render ignores `hub/`.

## Upload

Hostinger web hosting, account `u605954531`, domain `beachcombersmania.online`, document root `public_html`. TUS upload via `hosting_files_generate-upload-url` (create 201, patch 204) to `app/index.html?override=true`, clear the Hostinger cache, read the live file back: expect **3,177,293 bytes** with the Phase 3g comment. Status: _pending Bill's "Yes, upload"._
