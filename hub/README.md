# hub/ — BeachCombersMania hub files deployed to Hostinger (not Render)

These files run on Hostinger web hosting at `beachcombersmania.online` (document root `public_html`), **not** on this Render service. They live here only so the production copies have git history; Render ignores this folder (nothing in `server.js` reads it).

| Path here | Live path on Hostinger | What |
|---|---|---|
| `hub/reel/index.php` | `public_html/reel/index.php` | Excursion Reel viewer (PHP + vanilla JS). Current: Phase 3f. |
| `hub/app/index.html` | `public_html/app/index.html` | The BCM mobile app (PWA, wrapped as the Android APK). Current: Phase 3h (reads `assets/dining.json` at launch, embedded data as fallback). |
| `hub/assets/dining.json` | `public_html/assets/dining.json` | Dining tab data, generated from Bill's private master CSV by `hub/tools/build-dining-json.py`. Current: Phase 3h, 144 places. |
| `hub/root/.htaccess` | `public_html/.htaccess` | Apache rules for the hub root (config protection, cache headers, CORS for `dining.json`). |
| `hub/notes/*.md` | — | The UPLOAD_MAP for each phase: what changed, why, how it was verified, upload record. |

## Rules

- Deploy is by TUS upload to Hostinger (see any note under `hub/notes/`), only after Bill's explicit "Yes, upload". A merge here deploys nothing.
- Keep this folder in step with what is live: when a file is uploaded to Hostinger, the same bytes go here in the same PR (or the next one).
- Phases 3c, 3e and the earlier app phases went straight to Hostinger before this folder existed; their only history is the `index.backup-*` files in Bill's `BCM_Phase*` folders.
- Secrets never go here: `_bcm_config.php`, `_reel.php` and `bcm-reels/` sit outside `public_html` on Hostinger and are not in this repo.

## Where accounts actually live (settled 2026-11-01)

The app signs in through the hub: `bcmAuth.login()` posts to `beachcombersmania.online/_auth.php`, backed by the Hostinger MariaDB assigned to the domain. The `users` / `subscriptions` / `shell_collections` tables in this repo's `db.js` (SQLite on Render's ephemeral disk) are **not** what the app uses; treat them as vestigial. Server-side shell collections (Phase 4) belong beside `_auth.php` / `_reel.php` on the hub, in that same database.
