// Ratios over time (2.76.0).
// 1. What each bracket was SET to: every change to a ratio in Settings is recorded in settings.ratioHistory (from 2.76.0 on;
//    nothing earlier was ever saved). Each record is the whole set of ratios at that moment.
// 2. What was USED: every meal dosed by a ratio already saves the ratio and the bracket's name (ratioValue, ratioLabel), so
//    that goes back through the whole log.
// Pure functions; app.js draws the chart (Insights > Trends, "Ratio over time").
import { ratioWasApplied } from "./calc.js";

export const RATIO_HISTORY_MAX = 400;

/** The ratios as they are now: time-of-day brackets, then activity ones. */
export function ratioSnapshot(settings) {
  const s = settings || {};
  const one = kind => r => ({ id: String(r.id), name: String(r.name || ""), ratio: Number(r.ratio), kind });
  return [
    ...(Array.isArray(s.timeRatios) ? s.timeRatios : []).filter(r => r && Number(r.ratio) > 0).map(one("time")),
    ...(Array.isArray(s.activityRatios) ? s.activityRatios : []).filter(r => r && Number(r.ratio) > 0).map(one("activity"))
  ];
}
const sameRatios = (a, b) => JSON.stringify((a || []).map(r => [r.id, r.name, r.ratio])) === JSON.stringify((b || []).map(r => [r.id, r.name, r.ratio]));

/** Adds a record to settings.ratioHistory when any ratio, bracket name, or the set of brackets has changed since the last
 * record (the first call records where things stand). Returns true when it added one. Times and colours don't count. */
export function recordRatioChange(settings, now = Date.now()) {
  if (!settings) return false;
  const snap = ratioSnapshot(settings);
  if (!snap.length) return false;
  const hist = Array.isArray(settings.ratioHistory) ? settings.ratioHistory.filter(isRecord) : [];
  const last = hist[hist.length - 1];
  if (last && sameRatios(last.ratios, snap)) { if (hist.length !== (settings.ratioHistory || []).length) settings.ratioHistory = hist; return false; }
  hist.push({ ts: now, ratios: snap });
  settings.ratioHistory = hist.slice(-RATIO_HISTORY_MAX);
  return true;
}
const isRecord = h => !!h && Number.isFinite(Number(h.ts)) && Array.isArray(h.ratios);

/** Both devices' records, once each, in time order (settings sync keeps the newer side whole, which would drop the
 * other side's records). */
export function mergeRatioHistory(a, b) {
  const seen = new Map();
  for (const h of [...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])]) {
    if (!isRecord(h)) continue;
    const key = `${h.ts}|${JSON.stringify(h.ratios.map(r => [r.id, r.name, r.ratio]))}`;
    if (!seen.has(key)) seen.set(key, h);
  }
  return [...seen.values()].sort((x, y) => x.ts - y.ts).slice(-RATIO_HISTORY_MAX);
}

/**
 * entries: the log. settings: current settings (brackets, colours, ratioHistory). from/to: the period (ms).
 * Returns { brackets: [{ name, kind, color, current, used: [{ ts, ratio }], set: [{ ts, ratio }], count }], unrecorded }.
 *  - used: each meal dosed with that bracket in the period, oldest first.
 *  - set: the recorded setting at `from` (when one is known) and every change in the period, as steps.
 * Brackets are matched by name (what a meal saves). Current brackets come first in Settings order (only those with meals or
 * a recorded change in the period), then brackets no longer in Settings that meals used.
 */
export function ratioTimeline(entries, settings, { from = -Infinity, to = Infinity } = {}) {
  const snap = ratioSnapshot(settings);
  const colours = new Map([...(settings && settings.timeRatios || []), ...(settings && settings.activityRatios || [])].filter(Boolean).map(r => [String(r.name || ""), r.color || null]));
  const byName = new Map();
  const get = (name, kind) => {
    if (!byName.has(name)) {
      const cur = snap.find(r => r.name === name);
      byName.set(name, { name, kind: cur ? cur.kind : kind || "time", color: colours.get(name) || null, current: cur ? cur.ratio : null, used: [], set: [], count: 0 });
    }
    return byName.get(name);
  };
  let unrecorded = 0;
  for (const e of entries || []) {
    if (!e || !Number.isFinite(Number(e.ts)) || e.ts < from || e.ts > to) continue;
    if (!ratioWasApplied(e)) { if (e.ratioValue == null && Number(e.totalCarbs) > 0 && Number(e.mealDose) > 0 && !e.noInsulin && !e.carbsUnknown && e.entryType !== "basal" && e.entryType !== "activity") unrecorded++; continue; }
    const b = get(String(e.ratioLabel || "Unnamed"));
    b.used.push({ ts: Number(e.ts), ratio: Number(e.ratioValue) });
  }
  // Settings steps, matched to brackets by name at the time of each record.
  const hist = (settings && Array.isArray(settings.ratioHistory) ? settings.ratioHistory : []).filter(isRecord).slice().sort((a, b) => a.ts - b.ts);
  const names = new Set([...snap.map(r => r.name), ...byName.keys()]);
  for (const name of names) {
    let atStart = null; const steps = [];
    for (const h of hist) {
      const r = h.ratios.find(x => x.name === name);
      const v = r ? Number(r.ratio) : null;
      if (h.ts <= from) { atStart = v; continue; }
      if (h.ts > to) break;
      const prev = steps.length ? steps[steps.length - 1].ratio : atStart;
      if (v !== prev) steps.push({ ts: h.ts, ratio: v });
    }
    const set = [...(atStart != null && Number.isFinite(from) ? [{ ts: from, ratio: atStart }] : []), ...steps];
    if (set.some(s => s.ratio != null)) get(name).set = set;
  }
  const order = snap.map(r => r.name);
  const brackets = [...byName.values()]
    .filter(b => b.used.length || b.set.some(s => s.ratio != null))
    .map(b => ({ ...b, used: b.used.sort((x, y) => x.ts - y.ts), count: b.used.length }))
    .sort((a, b) => {
      const ia = order.indexOf(a.name), ib = order.indexOf(b.name);
      return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib) || a.name.localeCompare(b.name);
    });
  return { brackets, unrecorded };
}

/** Each change of value in a bracket's used ratios: [{ ts, from, to }] (for the caption: "13 since 7 Oct"). */
export function ratioChanges(used) {
  const out = [];
  for (let i = 1; i < (used || []).length; i++) if (used[i].ratio !== used[i - 1].ratio) out.push({ ts: used[i].ts, from: used[i - 1].ratio, to: used[i].ratio });
  return out;
}
