# hub/ — BeachCombersMania hub files deployed to Hostinger (not Render)

These files run on Hostinger web hosting at `beachcombersmania.online` (document root `public_html`), **not** on this Render service. They live here only so the production copies have git history; Render ignores this folder (nothing in `server.js` reads it).

| Path here | Live path on Hostinger | What |
|---|---|---|
| `hub/reel/index.php` | `public_html/reel/index.php` | Excursion Reel viewer (PHP + vanilla JS). Current: Phase 3f. |
| `hub/app/index.html` | `public_html/app/index.html` | The BCM mobile app (PWA, wrapped as the Android APK). Current: Phase 3g. |
| `hub/notes/*.md` | — | The UPLOAD_MAP for each phase: what changed, why, how it was verified, upload record. |

## Rules

- Deploy is by TUS upload to Hostinger (see any note under `hub/notes/`), only after Bill's explicit "Yes, upload". A merge here deploys nothing.
- Keep this folder in step with what is live: when a file is uploaded to Hostinger, the same bytes go here in the same PR (or the next one).
- Phases 3c, 3e and the earlier app phases went straight to Hostinger before this folder existed; their only history is the `index.backup-*` files in Bill's `BCM_Phase*` folders.
- Secrets never go here: `_bcm_config.php`, `_reel.php` and `bcm-reels/` sit outside `public_html` on Hostinger and are not in this repo.
