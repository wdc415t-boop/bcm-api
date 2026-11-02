# BCM Phase 4 — Cloud Collection: shells follow the login (2026-11-01)

Nancy's ask: her shell collection should be available on the iPad (bigger screen, to show her sister), not tied to the phone it was saved on. Excursion Reels already lived on the server keyed to the account; now the collection does too. Decisions (Bill, 2026-11-01): **paid accounts only** (JWT scope `single` or `all`), **500 shells per account**.

## Upload set (two files, one "Yes, upload")

| File | Destination | What |
|---|---|---|
| `public_html/_collection.php` | `public_html/_collection.php` (**new**) | The cloud collection API. 11446 bytes. Same pattern as `_reel.php`: BCM JWT (HS256, `BCM_JWT_SECRET` from `_bcm_config.php`) identifies the owner; records as JSON + photos as JPEG under `<folder above public_html>/bcm-collections/<owner>/` (created on first write; optional `BCM_COLLECTION_DIR` override). |
| `public_html/app/index.html` | `public_html/app/index.html` (**overwrite**) | Phase 4 app: `bcmSync` layer around the IndexedDB helpers. 3194456 bytes. Backup of the live 3h file beside it: `index.backup-2026-11-01-3h.html` (3,181,108 bytes). |

Nothing else changes: no `.htaccess`, no `_auth.php`, no Render, no database schema.

## API (`_collection.php`, all calls need `Authorization: Bearer <BCM JWT>`)

| Call | Does |
|---|---|
| `GET ?list=1[&region=marco]` | the owner's shells (records only, no photos) + count/limit |
| `GET ?cid=X&img=1` | the shell's JPEG (owner only) |
| `POST {action:'put', shell:{cid, region, updated, data}, photo_b64?}` | upsert; older copy never overwrites newer; photo stored if valid |
| `POST {action:'patch', cid, updated, data:{user_notes?, tags?}}` | last-write-wins on `updated` |
| `POST {action:'delete', cid}` | removes record + photo |

Gates and caps: no/invalid/expired token → 401; scope not `single`/`all` → 403 `plan`; 500 shells/account; photo ≤ 600 KB JPEG ≤ 1600 px (the app saves 1568 px); record ≤ 24 KB; `image_data` and local `id` are stripped server-side; cid must be 12–24 alphanumerics (no path tricks).

## App (`bcmSync`, next to the IndexedDB helpers)

- IndexedDB bumped to **v2** with a `cid` index. Every shell saved gets a `cid`, `region`, `updated`; shells saved before Phase 4 get a cid on the first sync.
- `dbAdd/dbDelete/dbDeleteMultiple/dbClearAll/dbUpdateNotes/dbUpdateTags` keep their names and behaviour (local first); the originals are `_db…Local`. No UI call site changed.
- A localStorage queue (`bcm_sync_queue_v1`) carries put/patch/delete to the server; it survives offline and restarts; 401/403/5xx keep the item, 400 drops it with a console warning.
- `pull()` merges the server list for the current region: new shells are added **with their photo fetched and stored locally** (print, reels, offline keep working); newer notes/tags win by timestamp; a shell that was synced and is gone from the server was deleted elsewhere → removed here; legacy shells get cids and are pushed.
- Runs on start, on sign-in, when the app comes back online, and when it becomes visible after 10+ minutes. One sync at a time (a request during a sync runs once more after it). `window.bcmSync.state` / `.lastError` for checking a device.
- Guests and free accounts: unchanged, local only; they never call `_collection.php`.

## Verification

- **Server**, under `php -S` with real HS256 tokens (20 checks): 401 for no/bad/expired token; 403 for free scope; owner isolation; put stores photo and strips `image_data`/`id`; list filters by region; photo served and 404 when absent; patch newer applied / older ignored; older put keeps newer data and photo; oversize photo and path-traversal cid rejected; delete removes record and photo.
- **End to end**, real `_collection.php` behind the app in headless Chromium, 390×844 (20 checks): paid login enables sync; two legacy shells on "phone" A get cids and reach the server with photos; fresh "iPad" B pulls both with photos on first launch and the Collection screen shows them; notes edited on B appear on A; a delete on A disappears from B; a shell saved on B while **offline** is queued, then flushed when back online and arrives on A with its photo; tags from A reach B; a free account saves locally, queues nothing and makes zero server calls; a synced photo is canvas-safe (reel thumbnails). No page errors.
- **Found and fixed by the test:** the first build pulled each shell three times on a new device — `bcm-auth-change` fires more than once at start-up and each firing started a pull. Now one sync at a time, plus a re-check by cid before any insert.
- **Regression:** 3g suite 16/16, 3h suite 16/16, resume and dining checks pass on the Phase 4 file. `node --check` clean; `php -l` clean.

## Not done / later

- No sync indicator in the UI yet; `bcmSync.state` is console-only. A small "Synced ✓ / Syncing…" line on the Collection header is a 15-minute follow-up if Nancy wants reassurance.
- Disk: worst case 500 × 600 KB = 300 MB per paid account; glance at hosting disk once there are ~50 members.
- First sync of an existing collection uploads every photo once (≈ 200–400 KB each); on cellular this is a one-time cost.
- Real-device check is Nancy's: see Upload.

## Upload

Hostinger web hosting, account `u605954531`, domain `beachcombersmania.online`, document root `public_html`. TUS upload (create 201, patch 204) for both files, clear cache, read back sizes; then `GET /_collection.php` without a token must answer **401** JSON. Phone check: on Nancy's iPhone (paid account) open the app → her existing shells upload on first launch (allow a minute on Wi-Fi); then sign in on the iPad → Collection fills with the same shells and photos. Add a shell on one device, see it on the other after reopening. Status: _pending Bill's "Yes, upload"._
