# 2026-11-03 — Phase 6 / 6b: Home menu tune-up + in-app weekly forecast — LIVE 2026-11-03 15:08 ET

Files (same bytes as Hostinger): `hub/app/index.html`, `hub/root/_forecast.php` (new in the mirror), `hub/root/forecast/index.php` (new in the mirror).

- Home screen rebuilt as ten dark cards (Identify, Upload, Shell ID by Sight, Tides, Collection, Excursion Reel, Shelling Tips,
  Beach Conditions, Map, Dining) — `homeCard()`, `HOME_STYLE="dark"`. Pass-type banner and bottom bar unchanged.
- Beach Conditions → `ForecastSheet`: `GET /_forecast.php?latest=<beach-slug>` (newest Monday-digest snapshot for the region's beach;
  `PREDICTOR_BEACH_FOR_REGION`), rendered in-app; "Open full report / Share" opens `/forecast/?r=TOKEN`. Empty state offers the Predictor.
  The old `BeachConditionsModal` (canned season text) is unreachable but still in the file.
- `_forecast.php`: `?latest=<slug>` JSON (404 when none, 400 bad slug); snapshot caps whatToBring 40→80, avoidTimes 60→120.
- `forecast/index.php`: `/forecast/?latest=<slug>` permanent "this week" link; friendly message when none.
- Tides card deep-links Beach Explorer → Tides tab + region's station (`explorerTab`/`explorerStation` lifted to root).
  Reel card opens Collection with the sheet open; reel sheet has a sticky ✕ header and sticky Cancel/Publish.
  Directions → Apple Maps on iOS / Google Maps https elsewhere (`openDirectionsTo`). "Shell Guide" renamed "Shelling Tips". Help text updated.
- Known: Nov 2 digest got HTTP 502 (malformed model JSON) for Naples Beach; `_forecast_weekly.php` does not retry — candidate follow-up.
- Rollback: the three `*.backup-2026-11-03-*` files in `BCM_Phase6-HomeMenu-2026-11-03/public_html/`.

## Phase 6c — Monday digest retry (live 2026-11-03 15:19 ET)
`hub/root/_forecast_weekly.php` (13,847 B, same bytes as Hostinger): each beach gets up to 3 forecast calls, 25 s apart (`BCM_WEEKLY_RETRIES`, `BCM_WEEKLY_RETRY_WAIT` optional in `_bcm_config.php`), before it is listed under "Not available this run". Dry-run tested against a stub API (Naples fails once → recovered on try 2; a beach that always fails → reported after 3 tries). Cron unchanged (Mondays 7:00 AM ET). Backup: `_forecast_weekly.backup-2026-11-03-2a.php` in the Phase 6 folder.

## Phase 6d — Tides in-app, no browser hops (live 2026-11-03 15:49 ET)
`hub/app/index.html` (3,220,087 B, same bytes as Hostinger). Home → Tides opens `TideSheet`: NOAA CO-OPS predictions API (hourly curve + hi/lo list, 7 days, stations 8725110 / 8725520 / 8725362, three lowest lows marked). NOAA's page cannot be framed (X-Frame-Options SAMEORIGIN), so the chart is drawn in-app. Forecast sheet shares via `navigator.share` (copy-link fallback); "Open in browser" is a small link. Dark cards drop `backdrop-filter`. Reason: Bill's phone test — Tides landed on the Explorer tab, and the app froze after returning from the NOAA page and the forecast share page. Backup: `index.backup-2026-11-03-6b.html` in the Phase 6 folder.

## Phase 6e + 6f — iPad layout (live 2026-11-03 18:29 ET)
`hub/app/index.html` (3,220,653 B, same bytes as Hostinger). The sunset banner and the regional beach photo are both `flex:1` with a 150 px minimum and `object-fit: cover`, so they share any spare height equally and the ten cards sit in the middle with an 8 px gap above and below (Bill's iPad showed empty bands around a fixed 160 px photo; Nancy asked for top/bottom symmetry). Phones have no spare height, so they look as before. Marco Island's beach photo is only 800×439 (others 1440–2048 px wide) — a sharper one would help on 12.9" iPads. Backup: `index.backup-2026-11-03-6d.html` in the Phase 6 folder. Patches: `tests/patch-phase6e.py`, `tests/patch-phase6f.py`.

## Phase 6g — iPad photo crop (live 2026-11-03 ~20:35 ET)
`hub/app/index.html` (3,222,811 B) and `hub/reel/index.php` (31,156 B), same bytes as Hostinger. Bill's iPad showed "about 60 %" of the photos in the shell guide and the excursion reels. Cause: every full-width photo in the app is a fixed 200 px strip with `object-fit: cover` (2:1 on a phone, 4:1 on an 820 px iPad), and the reel page switches to its two-column layout above 760 px, which turns an upright iPad's photo into a tall narrow column. Fix, app: in the mobile shell at ≥600 px (`.bcm-mshell` root class + media query) the Sight result cards, the guide's expanded photo, the Identify preview/result and the Collection detail photo show whole (`object-fit: contain`) over a blurred copy of themselves (`heroBlur()`); phones and the desktop frame are untouched. Fix, reel: portrait screens use the stacked layout (`(orientation:portrait)` added to the 760 px query) and from 600 px the find photo is contain-on-blur. Backups in the Phase 6 folder: `index.backup-2026-11-03-6f.html`, `reel/index.backup-2026-11-03-3f.php`. Patches `tests/patch-phase6g.py`, `tests/patch-phase6g-reel.py`; shots `tests/shots/6g-*`.

## Phase 6h — Android home scroll + sheet ✕ headers (live 2026-11-03 ~21:05 ET)
`hub/app/index.html` (3,223,265 B, same bytes as Hostinger). (1) Bill's Android home screen scrolled by about one header line: on narrower phones "My Shell Collection" wrapped to two lines and the two 150 px photo minimums left no slack. The card is now "My Shells" (help text too) and on screens ≤800 px high the sunset banner and beach photo may shrink to 120 px (`.bcm-mshell .bcm-photo` media rule); taller phones and iPads keep 150 px and measure exactly as before. (2) Nancy: the Tides and Excursion Reel sheets' sticky ✕ header covered the first row. Cause: `margin-top:-18px` on a sticky element inside an 18 px-padded sheet — browsers keep the sticky *margin* box in the scrollport, so the header was pushed 18 px down. Tides, Beach Conditions and Reel sheets now have no top padding and the header no negative margin. Backup: `index.backup-2026-11-03-6g.html` in the Phase 6 folder; patch `tests/patch-phase6h.py`; shots `tests/shots/6h-*`.

## Phase 6i — Home measures itself (Galaxy A16), live 2026-11-03 ~21:45 ET
`hub/app/index.html` (3,224,281 B, same bytes as Hostinger). Bill's Samsung Galaxy A16 still scrolled about half a line after 6h: it is taller than the 800 px cut-off, and Samsung's font scaling makes each row a little taller. Instead of another threshold, a `useEffect` in the root measures the screen container (`.bcm-screen`) after each render and on resize; if the home column is taller than the screen it adds `bcm-tight`, and `.bcm-mshell .bcm-tight .bcm-photo{min-height:110px}` lets the sunset banner and beach photo give. Screens that fit never get the class (iPhone 14 and iPad measure identical to 6h). Backup: `index.backup-2026-11-03-6h.html`; patch `tests/patch-phase6i.py`.
