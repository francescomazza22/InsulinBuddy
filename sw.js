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
// open tab automatically. If you forget to bump it, app files still update
// within a load or two (stale-while-revalidate, see below), but a version bump
// is what guarantees every file switches over together.
//
// `node tools/release.mjs` sets CACHE_VERSION (from js/changelog.js) and the
// PRECACHE_URLS list below for you.

const CACHE_VERSION = "2.11.0";
const CACHE_NAME = `insulin-buddy-${CACHE_VERSION}`;

// Everything needed to open the app with no network. A missing file here just
// fails to precache (see the install handler) rather than blocking install.
// The Abstract background artwork is left out on purpose: it is only downloaded
// if that pattern is chosen (it is then cached on first use).
const PRECACHE_URLS = [
  "./",
  "index.html",
  "app.js",
  "styles/base.css",
  "styles/calculator.css",
  "styles/components.css",
  "styles/history.css",
  "styles/library.css",
  "styles/patterns.css",
  "styles/print.css",
  "styles/report.css",
  "styles/responsive.css",
  "styles/settings.css",
  "styles/utilities.css",
  "js/backup.js",
  "js/calc.js",
  "js/changelog.js",
  "js/constants.js",
  "js/crypto.js",
  "js/diag.js",
  "js/dialogs.js",
  "js/foods.js",
  "js/glucose-stats.js",
  "js/history.js",
  "js/keys.js",
  "js/nightscout.js",
  "js/ratios.js",
  "js/services/cloud.js",
  "js/services/diagnostics.js",
  "js/services/glucose-data.js",
  "js/services/lock.js",
  "js/services/nightscout-sync.js",
  "js/services/store.js",
  "js/state.js",
  "js/ui/charts.js",
  "js/ui/dom.js",
  "js/ui/icons.js",
  "js/ui/sheets.js",
  "js/ui/toast.js",
  "js/util.js",
  "js/views/active-insulin.js",
  "js/views/basal.js",
  "js/views/calculator.js",
  "js/views/edit-meal.js",
  "js/views/glucose-guide.js",
  "js/views/glucose.js",
  "js/views/history-log.js",
  "js/views/library.js",
  "js/views/report.js",
  "js/views/settings-data.js",
  "js/views/settings-general.js",
  "js/views/settings.js",
  "js/views/shell.js",
  "js/views/trends.js",
  "assets/patterns/pattern-doodles-dark.svg",
  "assets/patterns/pattern-doodles-light.svg",
  "foods_data.js",
  "manifest.json",
  "assets/icons/apple-touch-icon.png",
  "assets/icons/favicon-16.png",
  "assets/icons/favicon-32.png",
  "assets/icons/icon-192.png",
  "assets/icons/icon-512.png"
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
