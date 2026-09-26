// Service worker — turns the site into an installable PWA and gives a
// cached fallback when offline. Bump CACHE_VERSION whenever shipped HTML/
// JS/CSS changes shape so old caches get evicted on next visit.
//
// Strategy:
//   • App-shell assets (HTML/CSS/JS/icons): cache-first, with background
//     network refresh on cache hit.
//   • Same-origin /data/*.json (local dev): network-first; cache the
//     response so the last-seen fixtures show up offline.
//   • jsDelivr-hosted /data/*.json (production fetches): cache-first with
//     background refresh, same as the app shell. jsDelivr sends CORS
//     headers for this repo, so the response is a real, readable 'cors'
//     response — not an opaque one — and safe to store. This is what lets
//     a relaunch show last-seen fixtures instantly instead of waiting on
//     the network, while the cache quietly catches up in the background.
//   • Anything else: network-first with cache fallback.

const CACHE_VERSION = 'v7';
const APP_SHELL_CACHE = `fhc-shell-${CACHE_VERSION}`;
const DATA_CACHE = `fhc-data-${CACHE_VERSION}`;

// Matches https://cdn.jsdelivr.net/gh/<owner>/<repo>@<ref>/weekly-fixture/data/<file>.json
const JSDELIVR_DATA_PATTERN = /^https:\/\/cdn\.jsdelivr\.net\/gh\/[^/]+\/[^/]+@[^/]+\/weekly-fixture\/data\/[^/]+\.json$/;

const APP_SHELL = [
    '/',
    '/index.html',
    '/subscribe.html',
    '/404.html',
    '/css/styles.css',
    '/js/app.js',
    '/js/subscribe.js',
    '/js/subscribe-block.js',
    '/icons/favicon.svg',
    '/icons/favicon-96x96.png',
    '/icons/apple-touch-icon.png',
    '/icons/web-app-manifest-192x192.png',
    '/icons/web-app-manifest-512x512.png',
    '/icons/site.webmanifest',
    '/images/logos/FHC.png',
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(APP_SHELL_CACHE).then(cache =>
            // Best-effort: ignore individual fetch failures so a single 404
            // doesn't tank the whole install.
            Promise.all(APP_SHELL.map(url =>
                cache.add(url).catch(err => {
                    console.warn(`[sw] failed to cache ${url}:`, err.message);
                })
            ))
        ).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(
                keys
                    .filter(k => k !== APP_SHELL_CACHE && k !== DATA_CACHE)
                    .map(k => caches.delete(k))
            )
        ).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    const req = event.request;
    if (req.method !== 'GET') return;

    const url = new URL(req.url);
    const sameOrigin = url.origin === self.location.origin;

    // Same-origin data (local dev via `npm run dev`) — network first, fall
    // back to cached version offline.
    if (sameOrigin && url.pathname.startsWith('/data/')) {
        event.respondWith(networkFirst(req, DATA_CACHE));
        return;
    }

    // Production data, served cross-origin from jsDelivr — cache first,
    // refresh in the background, so a relaunch shows last-seen fixtures
    // immediately instead of waiting on the network round trip.
    if (JSDELIVR_DATA_PATTERN.test(req.url)) {
        event.respondWith(cacheFirst(req, DATA_CACHE));
        return;
    }

    // Any other cross-origin request — let the browser handle it normally.
    if (!sameOrigin) return;

    // App-shell assets — cache first, refresh in the background.
    event.respondWith(cacheFirst(req, APP_SHELL_CACHE));
});

async function cacheFirst(request, cacheName) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);
    if (cached) {
        // Refresh the cache in the background so the user sees fresh assets
        // on the next visit without waiting on the network this time.
        fetch(request).then(res => {
            if (res && res.ok) cache.put(request, res.clone());
        }).catch(() => { /* offline — keep using the cached copy */ });
        return cached;
    }
    try {
        const res = await fetch(request);
        if (res && res.ok) cache.put(request, res.clone());
        return res;
    } catch (err) {
        // Final fallback: try the navigation root so users land on something.
        if (request.mode === 'navigate') {
            const fallback = await cache.match('/');
            if (fallback) return fallback;
        }
        throw err;
    }
}

async function networkFirst(request, cacheName) {
    const cache = await caches.open(cacheName);
    try {
        const res = await fetch(request);
        if (res && res.ok) cache.put(request, res.clone());
        return res;
    } catch (err) {
        const cached = await cache.match(request);
        if (cached) return cached;
        throw err;
    }
}
