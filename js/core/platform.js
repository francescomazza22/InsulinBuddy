// Everything the app needs from the device that differs between a web page and a real iOS app, behind one object.
// The rest of the code asks `platform`, never `navigator` or a plugin directly, so a native build only swaps this object.
//
//   platform.kind                 "web" | "native"
//   platform.capabilities()       { scheduledNotifications, health, biometrics, haptics, share, ... }: what works on this device
//   platform.files.save(name, text, mime)            -> Promise<boolean>   give the person a file (download / share sheet)
//   platform.clipboard.copy(text)                    -> Promise<boolean>
//   platform.notifications.permission()              -> Promise<"granted"|"denied"|"prompt"|"unsupported">
//   platform.notifications.request()                 -> Promise<same>
//   platform.notifications.schedule({ id, at, title, body }) -> Promise<{ scheduled, reason? }>   fires even when the app is closed
//   platform.notifications.cancel(id)                -> Promise<void>
//   platform.health.available()                      -> boolean            true only where Apple Health can be reached
//   platform.health.requestAccess(types)             -> Promise<{ ok, reason? }>   types: "insulin" | "carbs" | "glucose"
//   platform.health.writeInsulin({ id, ts, units, kind })   kind: "bolus" | "basal"   -> Promise<{ ok, id?, reason? }>
//   platform.health.writeCarbs({ id, ts, grams })    -> Promise<{ ok, id?, reason? }>
//   platform.health.remove(id)                       -> Promise<{ ok, reason? }>
//   platform.health.readGlucose({ fromMs, toMs })    -> Promise<{ ok, readings: [{ at, mgdl }], reason? }>
//   platform.biometrics.available()                  -> Promise<boolean>
//   platform.haptics.tap(kind)                       kind: "light" | "success" | "warning"
//   platform.openLink(url)
//
// The web implementation below is what the app runs today. A native app supplies the same shape (Capacitor plugins or Swift).
// Anything a platform cannot do answers { ok: false, reason: "unsupported" } (or false), never throws.

export const PLATFORM_PORTS = {
  files: ["save"], clipboard: ["copy"], notifications: ["permission", "request", "schedule", "cancel"],
  health: ["available", "requestAccess", "writeInsulin", "writeCarbs", "remove", "readGlucose"], biometrics: ["available"], haptics: ["tap"]
};
export function assertPlatform(p) {
  if (!p || !p.kind || typeof p.capabilities !== "function" || typeof p.openLink !== "function") throw new Error("Not a platform object");
  for (const [port, methods] of Object.entries(PLATFORM_PORTS)) {
    if (!p[port]) throw new Error(`Platform is missing ${port}`);
    for (const m of methods) if (typeof p[port][m] !== "function") throw new Error(`Platform is missing ${port}.${m}()`);
  }
  return p;
}

const UNSUPPORTED = Object.freeze({ ok: false, reason: "unsupported" });

/** The browser / home-screen PWA. */
export function createWebPlatform(win = globalThis) {
  const nav = win.navigator || {}, doc = win.document;
  const p = {
    kind: "web",
    capabilities() {
      return {
        scheduledNotifications: false,        // a web page can't fire a notification when it is closed (iOS needs a server push)
        health: false,                        // Apple Health is only reachable from a native app
        biometrics: !!(win.PublicKeyCredential),
        haptics: typeof nav.vibrate === "function",
        share: typeof nav.share === "function",
        clipboard: !!(nav.clipboard && nav.clipboard.writeText)
      };
    },
    files: {
      async save(filename, text, mime) {
        try {
          const blob = new win.Blob([text], { type: mime || "text/plain" });
          const url = win.URL.createObjectURL(blob);
          const a = doc.createElement("a");
          a.href = url; a.download = filename; a.click();
          win.URL.revokeObjectURL(url);
          return true;
        } catch { return false; }
      }
    },
    clipboard: {
      async copy(text) {
        try { if (nav.clipboard && nav.clipboard.writeText) { await nav.clipboard.writeText(text); return true; } } catch { /* fall through to the older way */ }
        try {
          const ta = doc.createElement("textarea");
          ta.value = text; ta.setAttribute("readonly", ""); ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;";
          doc.body.appendChild(ta); ta.select();
          const ok = doc.execCommand("copy");
          ta.remove();
          return ok;
        } catch { return false; }
      }
    },
    notifications: {
      async permission() { return "unsupported"; },
      async request() { return "unsupported"; },
      async schedule() { return { scheduled: false, reason: "unsupported" }; },
      async cancel() {}
    },
    health: {
      available: () => false,
      async requestAccess() { return UNSUPPORTED; },
      async writeInsulin() { return UNSUPPORTED; },
      async writeCarbs() { return UNSUPPORTED; },
      async remove() { return UNSUPPORTED; },
      async readGlucose() { return { ok: false, readings: [], reason: "unsupported" }; }
    },
    biometrics: {
      async available() {
        try { return !!(win.PublicKeyCredential && await win.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()); } catch { return false; }
      }
    },
    haptics: { tap(kind) { try { if (typeof nav.vibrate === "function") nav.vibrate(kind === "warning" ? [20, 40, 20] : 10); } catch { /* nothing to do */ } } },
    openLink(url) { try { win.open(url, "_blank", "noopener"); } catch { /* blocked */ } }
  };
  return p;
}

/** A platform that records what it was asked and can be told what is available: for tests, and for trying native behaviour on the web. */
export function createMemoryPlatform({ health = false, notifications = false, permission = "granted", biometrics = false } = {}) {
  const calls = [];
  const samples = new Map();          // id -> sample (Health)
  const scheduled = new Map();        // id -> notification
  let n = 0;
  const log = (name, arg) => { calls.push([name, arg]); };
  const p = {
    kind: "memory", calls, samples, scheduled,
    capabilities: () => ({ scheduledNotifications: notifications, health, biometrics, haptics: true, share: false, clipboard: true }),
    files: { async save(name, text, mime) { log("files.save", { name, text, mime }); return true; } },
    clipboard: { async copy(text) { log("clipboard.copy", text); return true; } },
    notifications: {
      async permission() { return notifications ? permission : "unsupported"; },
      async request() { return notifications ? permission : "unsupported"; },
      async schedule(x) { log("notifications.schedule", x); if (!notifications) return { scheduled: false, reason: "unsupported" }; scheduled.set(x.id, x); return { scheduled: true }; },
      async cancel(id) { log("notifications.cancel", id); scheduled.delete(id); }
    },
    health: {
      available: () => health,
      async requestAccess(types) { log("health.requestAccess", types); return health ? { ok: true } : UNSUPPORTED; },
      async writeInsulin(s) { log("health.writeInsulin", s); if (!health) return UNSUPPORTED; const id = "hk" + (++n); samples.set(id, { type: "insulin", ...s }); return { ok: true, id }; },
      async writeCarbs(s) { log("health.writeCarbs", s); if (!health) return UNSUPPORTED; const id = "hk" + (++n); samples.set(id, { type: "carbs", ...s }); return { ok: true, id }; },
      async remove(id) { log("health.remove", id); if (!health) return UNSUPPORTED; samples.delete(id); return { ok: true }; },
      async readGlucose(r) { log("health.readGlucose", r); return health ? { ok: true, readings: [] } : { ok: false, readings: [], reason: "unsupported" }; }
    },
    biometrics: { async available() { return biometrics; } },
    haptics: { tap(kind) { log("haptics.tap", kind); } },
    openLink(url) { log("openLink", url); }
  };
  return p;
}
