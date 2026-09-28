// A small persistent event log so problems (sync, Nightscout, errors) can be
// diagnosed from the phone instead of guessed at. Credentials are redacted
// before anything is stored, and a report never includes meal history.

import { redact } from "./util.js";

export function createDiag({ storage = null, key = "insulinBuddy.diag", max = 150, now = () => Date.now(), secrets = () => [] } = {}) {
  let items = [];
  try { items = JSON.parse(storage && storage.getItem(key)) || []; } catch { items = []; }
  if (!Array.isArray(items)) items = [];

  const persist = () => { try { if (storage) storage.setItem(key, JSON.stringify(items)); } catch { /* non-fatal */ } };

  const diag = {
    log(level, area, message) {
      const msg = redact(typeof message === "string" ? message : (message && message.message) || JSON.stringify(message), secrets()).slice(0, 400);
      items.push({ t: now(), level, area, msg });
      if (items.length > max) items = items.slice(items.length - max);
      persist();
    },
    entries() { return items.slice(); },
    count() { return items.length; },
    errorCount() { return items.filter(i => i.level === "error").length; },
    clear() { items = []; persist(); },

    /** Plain-text report for pasting into a message. `context` is { label: value }. */
    report(context = {}) {
      const iso = ms => new Date(ms).toISOString().replace("T", " ").replace(/\.\d+Z$/, "Z");
      const head = Object.entries(context).map(([k, v]) => `${k}: ${redact(String(v), secrets())}`);
      const lines = items.map(i => `${iso(i.t)} [${i.level}] ${i.area}: ${i.msg}`);
      return ["Insulin Buddy diagnostics", `generated: ${iso(now())}`, ...head, "", lines.length ? "recent events (oldest first):" : "no events recorded", ...lines].join("\n");
    }
  };
  return diag;
}

/** Route uncaught errors and CSP violations into the log. */
export function hookGlobalErrors(win, diag) {
  win.addEventListener("error", e => diag.log("error", "window", `${e.message || "error"} @ ${(e.filename || "").split("/").pop()}:${e.lineno || 0}`));
  win.addEventListener("unhandledrejection", e => diag.log("error", "promise", (e.reason && e.reason.message) || String(e.reason)));
  win.addEventListener("securitypolicyviolation", e => diag.log("error", "csp", `blocked ${e.violatedDirective}: ${e.blockedURI}`));
}
