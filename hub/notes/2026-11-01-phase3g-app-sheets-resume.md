# BCM Phase 3g — App: sheets above the menu bar on iPhone + Dining comes back where you left off (2026-11-01)

Two iPhone reports from Nancy (2026-11-01), both in the app (`public_html/app/index.html`). The Excursion Reel **viewer** (`reel/index.php`, Phase 3f) is untouched.

| File | Destination | What |
|---|---|---|
| `public_html/app/index.html` | `public_html/app/index.html` (**overwrite**) | Parts A and B below. 3177444 bytes. |
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

## Local verification (headless Chromium, iPhone 390×844, React vendored, network to CDN/API blocked)

17 checks, all passing (`node --check` clean on both inline scripts):
- Fresh launch → Home; resume record written.
- Planted Dining record (scrollTop 700) → launches on Dining, `#bcm-scroll` at 700; still 700 after 1.2s of start-up re-renders.
- Scroll to 1200 + background → record now 1200. Stale (4h) record → Home. Camera record → Home.
- Dining → Home → Dining starts at the top (resume consumed).
- Excursion Reel sheet mounted *inside* the scroller: overlay is a direct child of `<body>`, `fixed` z 60, sheet bottom edge at 844 = viewport bottom; a hit-test 20px above the screen bottom lands in the sheet, not the menu bar. No page errors.

## Not done / later

- Real-device check is Bill's/Nancy's: (A) Collection → Excursion Reel → scroll "My reels" to the bottom → Delete on the last reel is tappable above the menu bar. (B) Dining → pick a sub-tab, scroll down, tap a website; come back (Done / app switcher) → the app is on Dining at the same spot; tap another website and repeat. Then Home → Dining → list starts at the top.
- The other sheets (Wrong ID etc.) got the same Portal fix untested on device; same mechanism.
- `reel/index.php` (3f) and this file go into `bcm-api` under `hub/` via **PR #11** so the Hostinger-deployed files have history. Render ignores `hub/`.

## Upload

Hostinger web hosting, account `u605954531`, domain `beachcombersmania.online`, document root `public_html`. TUS upload via `hosting_files_generate-upload-url` (create 201, patch 204) to `app/index.html?override=true`, clear the Hostinger cache, read the live file back: expect **3177444 bytes** with the Phase 3g comment. Status: _pending Bill's "Yes, upload"._
