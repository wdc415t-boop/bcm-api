/* BeachCombersMania service worker (Phase 2c, 2026-10-30; Phase 5 precache 2026-11-01)
 * Registered by /app/index.html as /sw.js. It only ever touches requests under /app/ on this origin,
 * plus the three CDN scripts the app page needs (React, ReactDOM, jsPDF):
 *   - navigations to /app/      : network first, cached copy when offline
 *   - /app/assets/*             : cache first, refreshed in the background (species photos, region data)
 *   - the CDN scripts           : cache first, refreshed in the background
 * Phase 5 (2026-11-01): on install the worker PRECACHES the app page, every species / UI picture and the CDN
 * scripts listed in /app/assets/precache.json (~10 MB once), so Shell ID by Sight works with no signal after the
 * first launch — the behaviour the bundled APK had, now for the PWA and for an APK that loads the live URL.
 * Precaching is best-effort: a missing picture never blocks install. Everything else (the landing site, predictor,
 * reels, _auth.php and other PHP, the Render API, fonts) passes straight through untouched.
 * Bump SW_VERSION when the caching rules change; bump precache.json's "version" when the picture set changes.
 */
const SW_VERSION = 'bcm-app-v2';
const SHELL_CACHE = SW_VERSION + '-shell';
const ASSET_CACHE = SW_VERSION + '-assets';
const APP_PATH = '/app/';
const PRECACHE_MANIFEST = '/app/assets/precache.json';
const CDN_HOSTS = ['cdnjs.cloudflare.com'];

async function precache() {
  let manifest = null;
  try { manifest = await (await fetch(PRECACHE_MANIFEST, { cache: 'no-store' })).json(); } catch (e) { return; }
  const shell = await caches.open(SHELL_CACHE);
  const assets = await caches.open(ASSET_CACHE);
  const jobs = [];
  for (const u of (manifest.urls || [])) {
    if (u === APP_PATH) jobs.push(fetch(new Request(APP_PATH, { cache: 'reload' })).then((r) => { if (r && r.ok) return shell.put(APP_PATH, r); }).catch(() => null));
    else jobs.push(assets.match(u).then((hit) => hit ? null : fetch(u).then((r) => { if (r && r.ok) return assets.put(u, r); }).catch(() => null)));
  }
  for (const u of (manifest.cdn || [])) {
    jobs.push(assets.match(u).then((hit) => hit ? null : fetch(u).then((r) => { if (r && r.ok) return assets.put(u, r); }).catch(() => null)));
  }
  // a few at a time so a phone on Wi-Fi is not hammered; failures are ignored (runtime caching fills gaps later)
  const queue = jobs.slice();
  const workers = Array.from({ length: 6 }, async () => { while (queue.length) { await queue.shift(); } });
  await Promise.all(workers);
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache());
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('bcm-app-') && k !== SHELL_CACHE && k !== ASSET_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function cacheFirstRefresh(req, key) {
  return caches.open(ASSET_CACHE).then(async (cache) => {
    const cached = await cache.match(key || req);
    const network = fetch(req).then((res) => { if (res && res.ok) cache.put(key || req, res.clone()); return res; }).catch(() => null);
    return cached || (await network) || Response.error();
  });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (CDN_HOSTS.includes(url.host)) {                       // React / ReactDOM / jsPDF: cache first, refresh behind
    event.respondWith(cacheFirstRefresh(req, url.href));
    return;
  }
  if (url.origin !== self.location.origin || !url.pathname.startsWith(APP_PATH)) return;   // not ours: let the browser handle it

  if (req.mode === 'navigate' || url.pathname === APP_PATH || url.pathname === APP_PATH + 'index.html') {
    // App shell: always try the network so deploys show up at once; fall back to the cached page offline.
    event.respondWith(
      fetch(req).then((res) => {
        if (res && res.ok) caches.open(SHELL_CACHE).then((c) => c.put(APP_PATH, res.clone())).catch(() => null);
        return res;
      }).catch(() => caches.match(APP_PATH))
    );
    return;
  }

  if (url.pathname.startsWith(APP_PATH + 'assets/')) {
    // Species photos and region JSON: serve from cache, refresh in the background. Precached on install (Phase 5).
    event.respondWith(cacheFirstRefresh(req));
  }
});

self.addEventListener('message', (event) => { if (event.data === 'skipWaiting') self.skipWaiting(); });
