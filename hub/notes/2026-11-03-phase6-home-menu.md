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
