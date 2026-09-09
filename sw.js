// Insulin Buddy — service worker
// Caches the app shell so the app can still open with no connectivity
// (e.g. a lift, a tunnel). Data sync is handled separately in app.js —
// this file is only about the app being able to LOAD offline at all.
//
// Bump CACHE_NAME whenever you change any of the cached files, so the
// offline fallback copy doesn't go stale indefinitely.
const CACHE_NAME = "insulin-buddy-v1";

const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./foods_data.js",
  "./manifest.json",
  "./favicon-16.png",
  "./favicon-32.png",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"
];

self.addEventListener("install", event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .catch(err => console.error("Service worker: failed to cache app shell", err))
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first for everything in the app shell: when you're online you
// always get the latest version (and the cache quietly refreshes for next
// time you're offline); when the network fails, fall back to whatever was
// last cached. Supabase's own API traffic is left alone entirely — that
// always needs a live network round-trip, caching it wouldn't make sense.
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.hostname.endsWith("supabase.co")) return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
