# BCM Phase 4a — Cloud Collection hotfix: Shell by Sight images travel between devices (2026-11-01, 21:15 ET)

Nancy's report after Phase 4 went live: shared accounts, shared reels and photo-scanned shells all sync, but a shell picked with **Shell by Sight** (the offline match) shows its image only on the device it was picked on; the other device shows the placeholder.

**Cause:** Shell by Sight does not take a photo — it stores the path of the bundled species image (`assets/img/shells/<species>.webp`, present on every device) in `image_data`. The Phase 4 sync only shipped real JPEG photos, so the server saw "no photo" and the other device got an empty image.

**Fix (app only, `bcmSync`):** a non-photo `image_data` string is carried in the record as `image_ref`; a receiving device uses the ref when there is no photo; a device that already has the path repairs a server record that predates the fix; a device that is missing the image fills it from the server ref. Nothing uploads — the image is already bundled. `_collection.php` unchanged.

| File | Destination | What |
|---|---|---|
| `public_html/app/index.html` | `public_html/app/index.html` (**overwrite**) | Phase 4a. 3195340 bytes. Backup of the live Phase 4 file beside it: `index.backup-2026-11-01-4.html` (3,194,456 bytes). |

## Verification

End-to-end (real `_collection.php` under `php -S`, two devices on one paid login) **24/24** — the 20 Phase 4 checks plus: Shell-by-Sight record reaches the server with `image_ref` and no photo; the other device shows the bundled image path; a server record stripped of its ref (as a pre-fix sync would leave it) is repaired by the device that has the path; a device missing the image fills it from the server ref. Regression: 3g 16/16, 3h 16/16, dining checks pass. `node --check` clean.

## Phone check

On either device, pick a shell with Shell by Sight → open the other device (reopen the app) → the species image shows. Shells picked by sight **before** this fix repair themselves: open the app on the device that picked them, then reopen the other.

## Upload

TUS upload of `app/index.html` (create 201, patch 204, offset 3195340), cache clear, read back. Status: **LIVE** (uploaded 2026-11-01 on Bill's "Yes, upload").
