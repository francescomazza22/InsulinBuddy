// Turns the raw diagnostics log into something a person can read, and decides when sync is "stuck" enough to flag.
// Pure: it only reads what it is given.
import { timeAgo } from "../util.js";

export const AREA_NAMES = {
  outbox: "Nightscout sending", nightscout: "Nightscout", sync: "Cloud sync", state: "Saving your data", storage: "Device storage",
  dose: "Dose check", backup: "Backups", library: "Food library", boot: "Start-up", window: "App error", promise: "App error", csp: "Blocked content"
};
export const areaName = area => AREA_NAMES[area] || (area ? area[0].toUpperCase() + area.slice(1) : "App");

/**
 * Log entries ({ t, level, area, msg }, oldest first) -> rows newest first, with runs of the same message folded into one
 * ("x12") so a retry loop reads as one line instead of fifty.
 * Row: { level, area, areaName, msg, count, t (latest), firstT, ago }
 */
export function groupEvents(entries, { now = Date.now(), errorsOnly = false, limit = 100 } = {}) {
  const rows = [];
  for (const e of entries || []) {
    if (errorsOnly && e.level !== "error" && e.level !== "warn") continue;
    const last = rows[rows.length - 1];
    if (last && last.level === e.level && last.area === e.area && last.msg === e.msg) { last.count++; last.t = e.t; continue; }
    rows.push({ level: e.level, area: e.area, areaName: areaName(e.area), msg: e.msg, count: 1, t: e.t, firstT: e.t });
  }
  return rows.reverse().slice(0, limit).map(r => ({ ...r, ago: timeAgo(r.t, now) }));
}

/** Counts for the header of the log: errors, warnings, and the newest error. */
export function logHealth(entries) {
  const errors = (entries || []).filter(e => e.level === "error");
  return { errors: errors.length, warnings: (entries || []).filter(e => e.level === "warn").length, lastError: errors.length ? errors[errors.length - 1] : null };
}

export const STUCK_AFTER_MS = 30 * 60 * 1000;
/**
 * Should the Settings tab show a red dot? Yes when a destination reports a real problem (sync summary level "problem"),
 * or when entries have been waiting to send for a long time while the device is online. Being offline is not a fault.
 * input: { level, online, oldestWaitingAt, now }
 */
export function isSyncStuck({ level, online = true, oldestWaitingAt = null, now = Date.now() }, thresholdMs = STUCK_AFTER_MS) {
  if (level === "problem") return true;
  if (level === "pending" && online && oldestWaitingAt != null && now - oldestWaitingAt > thresholdMs) return true;
  return false;
}
