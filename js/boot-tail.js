// Moved out of index.html so the page can run with a strict Content Security Policy (no inline scripts allowed).
// The loading-screen safety net and the service worker registration, at the end of <body>.
  /* The "Loading" cover is visible from the very first paint (so a slow start never shows an empty app) and app.js hides it
     once it has something to show. This is only a safety net in case app.js never runs at all. */
  setTimeout(function () { var l = document.getElementById("loading-screen"); if (l) l.hidden = true; }, 12000);
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(err => console.error("Service worker registration failed:", err));
    });
    // A new deploy activates a new worker (see sw.js's CACHE_VERSION); reload
    // once so the tab actually picks up the update instead of running the old
    // code until the next manual refresh. The flag stops a reload loop if the
    // controller changes more than once in a session.
    //
    // Only an UPDATE needs this. If a worker already controlled the page when it
    // loaded, a new one taking over means newer code is waiting. On a first visit
    // (or after the saved copy was cleared) nothing controls the page yet and it
    // has just come from the network, so the worker taking control changes
    // nothing: reloading then only made the page flash and load twice about 300ms
    // after opening, and threw away anything started in that first moment.
    const hadController = !!navigator.serviceWorker.controller;
    let swReloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!hadController || swReloaded) return;
      swReloaded = true;
      location.reload();
    });
  }
