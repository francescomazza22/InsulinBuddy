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

const CACHE_VERSION = "2.4.2";
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
  "js/dialogs.js",
  "js/crypto.js",
  "js/glucose-stats.js"
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
    // Stale-while-revalidate: the cached copy answers immediately (this is most of what
    // made boot feel slow -- every single load was waiting on a fresh network round-trip
    // for ~13 files before the app could even start). A real update still reaches you
    // promptly: bumping CACHE_VERSION changes sw.js itself, which the browser always
    // re-checks on navigation regardless of this strategy, which installs a new cache and
    // reloads the open tab automatically (see the controllerchange listener in index.html)
    // -- so you still get new code within one reload, same as before, you just aren't
    // paying for a network round-trip on every single load to get it.
    // `cache: "no-store"` on the revalidation fetch is deliberate: it bypasses the browser's
    // own HTTP cache, not just this service worker's -- otherwise a host's cache-control
    // headers could serve a stale response even though this code's intent is "always check".
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const cached = await caches.match(req, { ignoreSearch: true });
        const revalidate = fetch(req, { cache: "no-store" })
          .then(fresh => { if (fresh.ok) cache.put(req, fresh.clone()); return fresh; })
          .catch(() => null);
        if (cached) { event.waitUntil(revalidate); return cached; }
        const fresh = await revalidate;
        if (fresh) return fresh;
        if (req.mode === "navigate") { const shell = await caches.match("index.html"); if (shell) return shell; }
        return Response.error();
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
