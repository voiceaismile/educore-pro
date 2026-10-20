/**
 * =========================================================================
 * 📲 EDUCORE PRO — Service Worker (offline-first shell caching)
 * =========================================================================
 * Strategy: cache-first for same-origin GET requests, network fallback.
 * Firebase / Realtime-DB / Firestore URLs are NEVER cached (live data).
 * Non-GET requests and cross-origin API calls pass straight through.
 * Cache version: bump CACHE_NAME on breaking shell changes.
 * =========================================================================
 */

const CACHE_NAME = "educore-v1";

/** Hosts / URL patterns that must always hit the network. */
const NETWORK_ONLY = [
  "firebaseio.com",
  "firestore.googleapis.com",
  "firebasestorage.googleapis.com",
  "identitytoolkit.googleapis.com",
  "securetoken.googleapis.com",
  "googleapis.com"
];

function isNetworkOnly(url) {
  return NETWORK_ONLY.some((h) => url.includes(h));
}

self.addEventListener("install", (event) => {
  // Activate immediately; page will cache assets on first use.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Only handle simple same-origin GETs; everything else passes through.
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (isNetworkOnly(req.url)) return;

  event.respondWith(
    caches.match(req, { ignoreSearch: false }).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        // Cache only healthy, basic (same-origin) responses.
        if (res && res.ok && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return res;
      }).catch(() => {
        // Offline and nothing cached: let the page handle it.
        return caches.match("./index.html").then((fallback) => fallback || Response.error());
      });
    })
  );
});
