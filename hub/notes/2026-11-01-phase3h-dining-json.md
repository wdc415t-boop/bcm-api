# BCM Phase 3h — Dining data from the hub: master CSV, link audit, dining.json, app reads it (2026-11-01)

Goal: fixing a restaurant's website becomes a 64 KB JSON upload instead of a 3.2 MB app redeploy, and one file (Bill's dining master CSV) feeds both the app and restaurant-roulette.online.

## Upload set (three files, one "Yes, upload")

| File | Destination | What |
|---|---|---|
| `public_html/assets/dining.json` | `public_html/assets/dining.json` (**new**) | 144 places, 6 regions, 63,847 bytes. Generated from `BCM_Dining_Master.csv` by `build-dining-json.py`. Same shape as the app's embedded `REGIONS_CONFIG` lists. |
| `public_html/app/index.html` | `public_html/app/index.html` (**overwrite**) | Phase 3h app: loads `dining.json` at launch (see below). 3,181,108 bytes. Backup of the live 3g file beside it: `index.backup-2026-11-01-3g.html` (3,177,293 bytes). |
| `public_html/.htaccess` | `public_html/.htaccess` (**overwrite**) | Live content unchanged + one block: `dining.json` gets `Access-Control-Allow-Origin: *` (the Android APK fetches from a `capacitor://` origin) and `Cache-Control: no-cache, must-revalidate`. 1,542 bytes. |

Not uploaded: `BCM_Dining_Master.csv` (private — stays on Bill's Mac / Gmail; it carries prospecting columns), `build-dining-json.py` (in `bcm-api/hub/tools/`).

## How the app loads it (Phase 3h code, module level before `createRoot`)

1. If `localStorage.bcm_dining_v1` holds a cached document, validate and apply it **synchronously before first render**.
2. If there is no cache or it is older than 6 hours, `fetch(BCM_HUB + '/assets/dining.json', {cache:'no-store'})`; on success validate, apply, cache, and dispatch `bcm-dining-updated` → the shell bumps a counter → `RestaurantsScreen` re-derives its lists from `REGIONS_CONFIG` (it already does this on every render; no UI code changed).
3. **Validation is all-or-nothing:** every embedded region must be present, all four lists (`restaurants`, `pizzaPlaces`, `iceCream`, `movies`) must be arrays, every place must have a `name`. Anything else → the document is rejected and the embedded data stays. A corrupt cache entry is discarded.
4. `window.BCM_DINING_SOURCE` reads `embedded`, `cache <generated>` or `hub <generated>` — useful when checking a device.
5. Movies: the sub-tab strip already hides "🎬 Movies" for a region with no theater; an empty-state line was added for the resume edge case. Delivery apps and Getters remain hard-coded.

## Data decisions applied (Bill, 2026-11-01)

- 11 cinema rows → `Active=N` (10 distinct names; Sanibel Community Theater was in two regions). Only Silverspot Cinema (Naples) remains. Curate real theaters later.
- The Green Flash (Captiva), Sunshine Seafood Cafe (Captiva), Traders Store & Café (Sanibel): kept listed, dead/parked website removed. Confirm still open when convenient.
- Caxambas Park Marina: `Active=N` (boat ramp, not a restaurant; removed from the app in 3g).

## Link audit (91 unique URLs, from Bill's Mac, iPhone Safari UA)

104 live · 11 live but bot-blocked to scripts (collier.gov, flylcpa.com, regmovies.com — open fine in a browser) · 7 dead · 2 parked · 32 venues with no website. Details in the master's `WebsiteStatus` / `Recommend` columns.

## Local verification (headless Chromium 390×844, React vendored, hub URL routed to a test server)

Step 4 suite, 16/16: real JSON applied (`hub …`), Marco movies 0 / Naples 1, cached for next launch (count 144), Doreen's at 267 N Collier renders, Movies tab hidden for Marco and Ice Cream still shown, Naples keeps Silverspot only, sentinel name injected via JSON appears in the UI (proves the JSON path feeds the list), 404 → embedded + warning + nothing cached, malformed JSON → embedded with no error, partial document (one region) rejected whole, fresh cache applied before first render with no fetch, stale (7 h) cache applied then refreshed from hub, corrupt cache discarded. 3g regression suite on the same file: 16/16, plus Dining re-entry starts at top and the 3g data checks. `node --check` clean on both inline scripts.

## Maintenance from here

Edit `BCM_Dining_Master.csv` → `python3 build-dining-json.py BCM_Dining_Master.csv dining.json` → upload `dining.json` to `public_html/assets/` → clear cache. Devices pick it up on the next launch (or within 6 hours if the app stays open across launches). Editing the JSON directly works for a one-line fix; a syntax slip is harmless to users (validation fails → embedded data) but silently reverts every other fix, so prefer the CSV → script path. Set `Active=N` to retire a listing; never delete a row.

## Upload

Hostinger web hosting, account `u605954531`, domain `beachcombersmania.online`, document root `public_html`. TUS upload via `hosting_files_generate-upload-url` (create 201, patch 204) for each of the three files, clear the Hostinger cache, read back sizes, fetch `https://beachcombersmania.online/assets/dining.json` and check `access-control-allow-origin: *` and `count: 144`. Status: **LIVE** (uploaded 2026-11-01 on Bill's "Yes, upload").
