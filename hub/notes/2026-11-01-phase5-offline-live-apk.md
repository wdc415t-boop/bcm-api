# BCM Phase 5 — Offline-first for the live app: precaching service worker (5a) + APK that loads the live URL (5b) (2026-11-01, 23:30 ET)

Bill asked for a new APK after Phase 4b. Checking the October build notes corrected an assumption in the v3 handoff: **the Android APK bundles a copy of the app page** (Capacitor `webDir: www`, no live URL), so the installed APK has been running the **Phase 1g page from Oct 29** — none of 3g / 3h / 4 / 4a / 4b reached it. Bill's Android tests tonight went through Chrome / the home-screen PWA.

Decision (Bill, 23:14 ET): **B** — rebuild the APK once to load the live `https://beachcombersmania.online/app/`, so every future upload reaches APK users with no rebuild. Condition: it must still work with no cell signal. Hence 5a first.

## 5a — Service worker v2 with precache (two files, one "Yes, upload")

| File | Destination | What |
|---|---|---|
| `sw.js` | `public_html/sw.js` (**overwrite**) | `SW_VERSION` → `bcm-app-v2`. On install, precaches everything in `precache.json` (best-effort, 6 at a time). Caches the three CDN scripts (React, ReactDOM, jsPDF) cache-first with background refresh. Existing rules unchanged: `/app/` network-first with cached fallback; `/app/assets/` cache-first with refresh. Old `bcm-app-v1` caches deleted on activate. 4543 bytes. |
| `app/assets/precache.json` | `public_html/app/assets/precache.json` (**new**) | 133 URLs (`/app/`, 124 species pictures, 8 funnel UI pictures) + 3 CDN scripts. Generated from the live `app/assets/img` listing; cross-checked: all 124 `MASTER_SHELL_DB.imagePath` values present. 6983 bytes. **Regenerate when species pictures are added** (and bump `SW_VERSION` to force a re-precache). |

Effect: after one launch on Wi-Fi (~10 MB), the PWA on iPhone/Android and the 5b APK work fully offline — Shell ID by Sight included — which is what the bundled APK gave and the PWA never had.

### Verification (headless Chromium, `tests/offline-test.js`, 9/9)

Worker registers (root scope, covers `/app/`); precache fills 132 pictures + 3 CDN scripts in the assets cache and the app page in the shell cache; **with the server refusing connections and the browser offline:** reload serves the app page, React boots, the home screen renders, a species picture and a UI picture fetch from cache, Shell ID by Sight opens at STEP 1 and its four option pictures resolve; back online, a changed page shows on the next load; no page errors.

## 5b — APK loading the live URL (needs Bill's Desktop folder)

The build project is `~/Desktop/BeachCombersMania` (Capacitor, `build-bcm-apk.sh`, `keystore.properties`; release keystore also copied under `BCM_AndroidDownload-2026-10-22/android/keystore/`). Live download page shows version code 8 → next is **9**. This session's folder-access request was blocked by the permission guard; Bill grants it with **"Add folder"** in the Claude desktop app.

Plan once granted: `capacitor.config.json` → `"server": {"url": "https://beachcombersmania.online/app/", "cleartext": false}`; keep `appId` / signing; `versionCode 9`, `versionName 1.4`; build in the cloud container (JDK + Gradle 8.14 present, Google SDK hosts reachable) or via the project's own script; upload `android/BeachCombersMania.apk` + update `android/index.html` (version, date, size, SHA-256, code 9).

**Caveat for existing APK users:** the webview origin changes from the bundled app to `beachcombersmania.online`, so a local-only collection saved inside the old APK does not carry over on that phone. Paid accounts get theirs back from the cloud (Phase 4). Known APK users today: Bill (collection not worth keeping, per Oct 30 notes); Nancy is on iPhone.

## Status

5a: _pending Bill's "Yes, upload"._  5b: _pending Desktop folder access._
