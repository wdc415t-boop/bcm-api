# BCM Phase 3f — Excursion Reel: skip the etiquette slide in-app (2026-11-01)

Nancy's request (2026-11-01): after the intro screen the reel should go straight to the first shell of the excursion. The "Shelling etiquette" slide (live shells go back, leave live sand dollars, fill your holes) is an 8-second stop members have already read. Decision after review with Nancy: **skip it in the app; keep it for public/shared links at 6 seconds** (was 8) — those viewers can pause to read longer.

| File | Destination | What |
|---|---|---|
| `public_html/reel/index.php` | `public_html/reel/index.php` (**overwrite**) | Etiquette slide is only added to the sequence when the reel did **not** open from the app; its duration is 6000 ms. `fromApp` detection moved above the slide list (it was below it, used only by the exit). Phase 3f header line. 30,564 bytes. |
| `public_html/reel/index.backup-2026-11-01-3e.php` | `public_html/reel/index.backup-2026-11-01-3e.php` (new) | Byte copy of the Phase 3e file that was live (29,956 bytes). Restore by copying it back over `index.php`. |

Nothing else changes. The app page, the APK, `_reel.php`, the reel records and `MASTER-SHELL-DB.json` are untouched.

## How it decides

Same test as the Phase 3e exit: **from the app** = previous page was on this site (same-origin referrer) or the page runs as an installed app (iPhone home-screen / Android standalone).

| Opened from | Sequence | Etiquette | Exit pill |
|---|---|---|---|
| The app / installed app | cover → intro (7.3s) → finds (6.5s each) → finale | skipped | "Back to app" |
| Shared link (Facebook, text, browser) | cover → intro → **etiquette 6s** → finds → finale | shown, 6s | "BeachCombersMania" |

Slide counter and progress bar follow the actual sequence (5 slides for a 3-find reel in-app, 6 from a link).

## Local verification (php -S, headless Chromium 390×844)

- `php -l` clean.
- Same-origin launch (`/app/` → Watch): counter `1 / 5`, slide 2 is "Find 1 of 3 · Lightning Whelk", finale shows "← Back to the app" first, pill "Back to app" → `/app/`.
- Direct open: counter `1 / 6`, slide 2 is the etiquette card, progress bar `--dur: 6s`, finale shows "Identify your own finds, free", pill "BeachCombersMania" → `/`.
- No console errors in either mode beyond local-only missing media (predictor video/poster, og-beach.jpg).
- Test reel: `bcm-reels/testreel12345.json` (3 finds, no photos) — local only, not uploaded.

## Not done / later

- `reel/index.php` is still not in git. Phases 3c, 3e and 3f all went straight to Hostinger; the only history is the backup files beside it. Open decision: add a `hub/reel/` folder to `bcm-api` and open **PR #11** (there is no #11 yet — PRs run #1–#10) so the viewer gets a record. Render ignores non-Node folders, so it is safe.
- The app's "▶ Watch" links still use a new-tab target (noted in 3e) — harmless.
- Real-device check is Bill's: open a reel from Nancy's iPhone home-screen app and confirm it goes intro → first shell; open the same reel's share link in Safari and confirm the etiquette card appears for ~6s.

## Upload

Hostinger web hosting, account `u605954531`, domain `beachcombersmania.online`, document root `public_html`. TUS upload via `hosting_files_generate-upload-url` (create 201, patch 204), then clear the Hostinger cache and read the live file back: expect **30,564 bytes** with the Phase 3f header. Status: **done** — see below.

## Verified live (2026-11-01, 16:30 ET)

Bill said "Yes, upload" (new desktop session). `reel/index.php` uploaded by TUS from the Mac (create 201, patch 204, `upload-offset: 30564`), Hostinger cache cleared (`scope: all`), live file read back: **30,564 bytes**, 201 lines, Phase 3f header on line 7 and `if(!fromApp)slides.push({type:"rules",dur:6000})` present. Upload credentials were short-lived and not stored. Note: the live `reel/` folder holds only `index.php` and `analytics-block.html`; the 3e backup exists only in this folder on Bill's Mac.

Phone check (Bill/Nancy): open a reel from the iPhone home-screen app → intro then straight to the first shell; open the same reel's share link in Safari → etiquette card for ~6s.
