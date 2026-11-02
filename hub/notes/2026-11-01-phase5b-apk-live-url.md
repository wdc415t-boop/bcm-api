# BCM Phase 5b — Android APK 1.7 (loads the live app) — UPLOAD MAP

Built 2026-11-01 23:49 ET in the cloud container (JDK 21, Gradle 8.14.3, AGP 8.13, SDK 36).
Signed with the existing release key (cert SHA-256 bc874263…f72319 — identical to the live 1.6 APK, so it installs as an update).

| Local file (BCM_Phase5-OfflineLiveAPK-2026-11-01/) | Hostinger path (public_html/) | Bytes | Status |
|---|---|---|---|
| public_html/android/BeachCombersMania.apk | android/BeachCombersMania.apk | 11,658,360 | LIVE 2026-11-01 23:56 ET |
| public_html/android/index.html | android/index.html | 11,225 | LIVE 2026-11-01 23:56 ET |

APK: com.beachcombersmania.app · versionCode 9 · versionName 1.7 · SHA-256 712d39358f2ea7de2423fdf7486478a7f4b09a2b84286f0e479e03b3f69c9f05
Change: capacitor.config.json now has server.url = https://beachcombersmania.online/app/ (cleartext false). The APK no longer bundles a copy of the page; it shows whatever is live, and the Phase 5a service worker precaches it for offline use after the first online launch.

Project files changed on the Mac (Desktop/BeachCombersMania): capacitor.config.json, android/app/build.gradle (versionCode 9, versionName "1.7").
Backups: capacitor.config.json.bak-1.6, android/app/build.gradle.bak-1.6.
Cleanup: delete Desktop/BeachCombersMania/_junk-apk-src-staging.tgz (staging tarball, 24 MB).

Caveat (known, accepted): the old APK ran from origin https://localhost; 1.7 runs from https://beachcombersmania.online. Local-only data (free accounts' collections, settings) in the old APK is not visible to 1.7. Paid accounts restore from the cloud collection on login.

## How the APK is built now (Phase 5b)
- Source project: Mac `~/Desktop/BeachCombersMania` (Capacitor 8.2, appId com.beachcombersmania.app). Release keystore + `android/keystore.properties` live there only — never in this repo.
- `capacitor.config.json` → `server.url = https://beachcombersmania.online/app/`. The APK is a thin shell: it loads the live PWA, and the Phase 5a `sw.js` precache makes it work offline after the first online launch. Rebuilding the APK is only needed for native changes (plugins, icon, permissions) — web changes go live by uploading `public_html/app/index.html`.
- Build: `./build-bcm-apk.sh` on the Mac (needs Homebrew openjdk@21 + Android SDK), or in a Linux container: JDK 21, Gradle 8.14, cmdline-tools + `platforms;android-36` + `build-tools;36.0.0`, `npx -p @capacitor/cli@8.2.0 cap sync android`, `gradle assembleRelease`. Maven Central may 429 behind a proxy — rerun with `--max-workers=1` until the cache is warm.
- Every public release must increase `versionCode` (now 9). Verify with `apksigner verify --print-certs` that the signer is `O=Cook AI Ventures LLC` (cert SHA-256 bc87426375488b9d8918b5f9c5076c83171a38fad3e0e82ac57f0056d2f72319).
