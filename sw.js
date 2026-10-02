// Insulin Buddy service worker.
//
// What it does: caches the app shell so it opens offline, and makes sure a new
// deploy is never masked by a stale cache — the exact problem "cache-busting"
// usually refers to.
//
// HOW TO SHIP AN UPDATE: bump CACHE_VERSION below (any change is enough, e.g.
// "2.0.0" -> "2.0.1"). That's it. On the next visit the browser fetches this
// file (browsers always re-check the service worker script itself), sees the
// version differ, installs the new cache, deletes the old one, and reloads the
// open tab automatically. If you forget to bump it, most static files still
// update quickly (network-first, see below) — only the offline fallback copy
// stays old until the version changes.

const CACHE_VERSION = "2.1.0";
const CACHE_NAME = `insulin-buddy-${CACHE_VERSION}`;

// Everything needed to open the app with no network. A missing file here just
// fails to precache (see PRECACHE below) rather than blocking install.
const PRECACHE_URLS = [
  "./",
  "index.html",
  "style.css",
  "app.js",
  "foods_data.js",
  "manifest.json",
  "favicon-16.png",
  "favicon-32.png",
  "icon-192.png",
  "apple-touch-icon.png",
  "js/util.js",
  "js/calc.js",
  "js/state.js",
  "js/nightscout.js",
  "js/diag.js",
  "js/backup.js",
  "js/history.js",
  "js/dialogs.js"
];

self.addEventListener("install", event => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // allSettled, not addAll: one missing/renamed file (e.g. a custom icon
      // name) must not stop the whole app from being cached for offline use.
      await Promise.allSettled(
        PRECACHE_URLS.map(async url => {
          try {
            const res = await fetch(url, { cache: "no-store" });
            if (res.ok) await cache.put(url, res);
          } catch (e) { /* offline during install, or the file doesn't exist -- skip it */ }
        })
      );
      // Take over immediately rather than waiting for every tab to close.
      // For a single-user app, "always run the latest code" beats the usual
      // caution about surprising a page mid-session.
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Cross-origin requests (the Supabase JS CDN, Nightscout, the Supabase API)
  // are left to the browser's own network/HTTP-cache handling. Intercepting
  // them here would risk serving a stale copy of code we don't control, or
  // trying to cache an opaque cross-origin response we can't inspect.
  if (url.origin !== self.location.origin) return;

  const isAppCode = /\.(?:js|css|html)$/.test(url.pathname) || url.pathname === "/" || url.pathname.endsWith("/");

  if (isAppCode) {
    // Network-first: whatever is actually deployed wins whenever the network
    // is reachable, so a normal reload always gets the latest code. The cache
    // is only the offline fallback, not the source of truth.
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          if (fresh.ok) { const cache = await caches.open(CACHE_NAME); cache.put(req, fresh.clone()); }
          return fresh;
        } catch (e) {
          const cached = await caches.match(req, { ignoreSearch: true });
          if (cached) return cached;
          if (req.mode === "navigate") { const shell = await caches.match("index.html"); if (shell) return shell; }
          throw e;
        }
      })()
    );
    return;
  }

  // Everything else (icons, manifest, fonts): cache-first, since these rarely
  // change and don't need to be re-fetched on every load.
  event.respondWith(
    (async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      try {
        const fresh = await fetch(req);
        if (fresh.ok) { const cache = await caches.open(CACHE_NAME); cache.put(req, fresh.clone()); }
        return fresh;
      } catch (e) {
        return cached || Response.error();
      }
    })()
  );
});
