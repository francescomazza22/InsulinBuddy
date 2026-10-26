// One day at a glance (2.68.0): the glucose readings for a local calendar day together with everything logged that day
// (meals, corrections, low treatments, basal, activities), plus the day's totals. Pure functions; app.js draws it.

import { activityLabel, intensityLabel } from "./activity.js";

const MIN = 60000;
export const DAY_LOW = 70, DAY_HIGH = 180;

/** Local midnight at or before `ts`, and the next local midnight (23 or 25 hours later on clock-change days). */
export function dayBounds(ts) {
  const d = new Date(ts);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
  return { start, end };
}
/** The local midnight `n` days after (negative: before) the day containing `ts`. */
export function shiftDay(ts, n) {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime();
}

const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
const isBasal = e => e.entryType === "basal" || e.mealType === "basal";
const isActivity = e => e.entryType === "activity";

/** What kind of marker a logged entry is: "basal", "activity", "low" (carbs, no insulin), "meal" (carbs with insulin),
 * "correction" (insulin only), or null for anything with neither. */
export function eventKind(e) {
  if (!e || !Number.isFinite(e.ts)) return null;
  if (isBasal(e)) return num(e.basalDose) > 0 ? "basal" : null;
  if (isActivity(e)) return num(e.durationMin) > 0 ? "activity" : null;
  const carbs = num(e.totalCarbs), insulin = num(e.mealDose) + num(e.correctionDose);
  if (e.noInsulin) return carbs > 0 ? "low" : null;
  if (carbs > 0 || e.carbsUnknown) return "meal";
  return insulin !== 0 ? "correction" : null;
}

/**
 * Everything for one day. `dayStart` is any time in the day. Readings ({ at, mgdl }) and entries outside the day are
 * ignored, except an activity that started the day before and runs past midnight (drawn from midnight).
 * Returns { start, end, readings, events, stats }; events are oldest first.
 */
export function dayTimeline(history, readings, dayStart) {
  const { start, end } = dayBounds(dayStart);
  const rs = (readings || []).filter(r => r && Number.isFinite(r.at) && Number.isFinite(r.mgdl) && r.at >= start && r.at < end).sort((a, b) => a.at - b.at);
  const events = [];
  for (const e of history || []) {
    const kind = eventKind(e);
    if (!kind) continue;
    if (kind === "activity") {
      const t1 = e.ts + num(e.durationMin) * MIN;
      if (t1 <= start || e.ts >= end) continue;
      events.push({ kind, t: e.ts, t1, entry: e, label: activityLabel(e), intensity: intensityLabel(e.intensity), minutes: Math.round(num(e.durationMin)), note: e.note || "" });
      continue;
    }
    if (e.ts < start || e.ts >= end) continue;
    if (kind === "basal") { events.push({ kind, t: e.ts, entry: e, units: num(e.basalDose), slot: e.basalSlot || null }); continue; }
    const insulin = Math.round((num(e.mealDose) + num(e.correctionDose)) * 100) / 100;
    events.push({
      kind, t: e.ts, entry: e, mealType: e.mealType || null, carbs: num(e.totalCarbs), insulin, carbsUnknown: !!e.carbsUnknown,
      foods: (e.items || []).map(i => i && i.name).filter(Boolean)
    });
  }
  events.sort((a, b) => a.t - b.t);
  // Time in range from the readings themselves (each reading counts the same; the CGM records evenly).
  const n = rs.length;
  const low = rs.filter(r => r.mgdl < DAY_LOW).length, high = rs.filter(r => r.mgdl > DAY_HIGH).length;
  const sum = (kinds, f) => events.filter(x => kinds.includes(x.kind)).reduce((s, x) => s + f(x), 0);
  const stats = {
    readings: n,
    tir: n ? ((n - low - high) / n) * 100 : null, lowPct: n ? (low / n) * 100 : null, highPct: n ? (high / n) * 100 : null,
    avg: n ? rs.reduce((s, r) => s + r.mgdl, 0) / n : null,
    min: n ? Math.min(...rs.map(r => r.mgdl)) : null, max: n ? Math.max(...rs.map(r => r.mgdl)) : null,
    carbs: Math.round(sum(["meal", "low"], x => x.carbs)),
    bolus: Math.round(sum(["meal", "correction"], x => Math.max(0, x.insulin)) * 100) / 100,
    basal: Math.round(sum(["basal"], x => x.units) * 100) / 100,
    activityMinutes: sum(["activity"], x => Math.round((Math.min(x.t1, end) - Math.max(x.t, start)) / MIN))
  };
  return { start, end, readings: rs, events, stats };
}

/** The reading nearest `t` within `tolMin` minutes, or null. `sorted` must be oldest first. */
export function readingNear(sorted, t, tolMin = 10) {
  let best = null, bd = Infinity;
  for (const r of sorted) { const d = Math.abs(r.at - t); if (d < bd) { bd = d; best = r; } else if (r.at > t) break; }
  return best && bd <= tolMin * MIN ? best.mgdl : null;
}

/**
 * Puts markers in rows so none overlap: each item ({ x }) goes in the first row whose last marker is at least `gap` to the
 * left, up to `maxRows` (after that, the row with the most room). Returns the row index for each item, in input order.
 */
export function stackRows(items, gap = 16, maxRows = 3) {
  const order = items.map((it, i) => ({ x: it.x, i })).sort((a, b) => a.x - b.x || a.i - b.i);
  const last = [];
  const rows = new Array(items.length);
  for (const { x, i } of order) {
    let r = last.findIndex(lx => x - lx >= gap);
    if (r < 0) r = last.length < maxRows ? last.length : last.indexOf(Math.min(...last));
    last[r] = x; rows[i] = r;
  }
  return rows;
}
