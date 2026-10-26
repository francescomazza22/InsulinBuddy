// Activity in the statistics (2.67.0). Pure functions: no DOM, no clock, everything passed in.
//
// Exercise lowers glucose for hours afterwards. A meal eaten shortly before or after it ends lower than the same meal on a
// quiet day, which makes the ratio used look stronger than it really is, and pulls averages and suggested ratios with it.
// So meal-based statistics can leave out (or look only at) meals near a logged activity, a morning breakfast comparison
// shows the difference directly, and a summary card covers the activity itself. All of this describes what happened; none
// of it changes a dose or a setting.

import { ratioWasApplied } from "./calc.js";
import { activityLabel } from "./activity.js";
import { sortReadings, glucoseAt, readingsBetween, median, LOW_MGDL, HIGH_MGDL } from "./insights.js";

const MIN = 60000, HOUR = 3600000, DAY = 86400000;
export const NEAR_BEFORE_HOURS = 2;   // activity ending up to 2 h before the meal...
export const NEAR_AFTER_HOURS = 4;    // ...or starting up to 4 h after it
export const ACTIVITY_FILTERS = ["without", "only", "all"];

const isActivity = e => !!e && e.entryType === "activity" && Number.isFinite(e.ts);
const isBasal = e => !e || e.entryType === "basal" || e.mealType === "basal";
const notMeal = e => isBasal(e) || e.entryType === "activity";
const insulinOf = e => (Number(e.mealDose) || 0) + (Number(e.correctionDose) || 0);
const carbsOf = e => Number(e.totalCarbs) || 0;
const mean = v => { const x = v.filter(Number.isFinite); return x.length ? x.reduce((s, n) => s + n, 0) / x.length : null; };
const endOf = a => a.ts + Math.max(0, Number(a.durationMin) || 0) * MIN;

/** The activities in a list, as [start, end] spans sorted by start. */
export function activitySpans(entries) {
  return (entries || []).filter(isActivity).map(a => ({ a, start: a.ts, end: endOf(a) })).sort((x, y) => x.start - y.start);
}

/**
 * (entry) => true when a logged activity overlaps the time from `beforeHours` before the entry to `afterHours` after it.
 * Activities themselves, basal and anything without a time are never "near activity".
 */
export function nearActivity(entries, { beforeHours = NEAR_BEFORE_HOURS, afterHours = NEAR_AFTER_HOURS } = {}) {
  const spans = activitySpans(entries);
  return e => {
    if (!e || notMeal(e) || !Number.isFinite(e.ts) || !spans.length) return false;
    const w0 = e.ts - beforeHours * HOUR, w1 = e.ts + afterHours * HOUR;
    return spans.some(s => s.end >= w0 && s.start <= w1);
  };
}

/** The skip-predicate a statistic should use for a filter choice: "without" leaves meals near activity out, "only" keeps
 * just those, "all" keeps everything. */
export function activitySkip(filter, near) {
  if (filter === "without") return e => near(e);
  if (filter === "only") return e => !near(e);
  return () => false;
}

/** How many meals (with carbs or insulin) in a list are near an activity, and how many aren't. */
export function countNearActivity(entries, near) {
  let nearN = 0, otherN = 0;
  for (const e of entries || []) {
    if (!e || notMeal(e) || !Number.isFinite(e.ts) || (carbsOf(e) <= 0 && insulinOf(e) <= 0)) continue;
    if (near(e)) nearN++; else otherN++;
  }
  return { near: nearN, other: otherN };
}

// ------------------------------------------------------------------ breakfast: active mornings vs quiet mornings
const localDayKey = ts => { const d = new Date(ts); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
const hourOf = ts => { const d = new Date(ts); return d.getHours() + d.getMinutes() / 60; };

/**
 * Each day's breakfast (the first dosed meal with carbs between `fromHour` and `toHour`, local time), split by whether a
 * logged activity fell near it (2 h before to 4 h after). For each group: how many, the average ratio used, carbs and dose,
 * glucose at the start, the average rise to the highest reading in 3 h, glucose 3 h later, the lowest in 4 h and how many
 * went below 70. Breakfasts need a starting reading to count.
 */
export function breakfastByActivity(entries, readings, { fromHour = 5, toHour = 11 } = {}) {
  const sorted = sortReadings(readings);
  const near = nearActivity(entries);
  const firstByDay = new Map();
  for (const e of (entries || []).filter(x => x && !notMeal(x) && Number.isFinite(x.ts)).sort((a, b) => a.ts - b.ts)) {
    if (e.noInsulin || insulinOf(e) <= 0 || carbsOf(e) <= 0) continue;
    const h = hourOf(e.ts);
    if (h < fromHour || h >= toHour) continue;
    const k = localDayKey(e.ts);
    if (!firstByDay.has(k)) firstByDay.set(k, e);
  }
  const rows = { active: [], quiet: [] };
  for (const e of firstByDay.values()) {
    const base = glucoseAt(sorted, e.ts, 10);
    if (base == null) continue;
    const win3 = readingsBetween(sorted, e.ts, e.ts + 3 * HOUR), win4 = readingsBetween(sorted, e.ts, e.ts + 4 * HOUR);
    const peak = win3.length >= 6 ? Math.max(...win3.map(r => r.mgdl)) : null;
    const lowest = win4.length >= 6 ? Math.min(...win4.map(r => r.mgdl)) : null;
    (near(e) ? rows.active : rows.quiet).push({
      e, base, rise: peak == null ? null : peak - base, at3h: glucoseAt(sorted, e.ts + 3 * HOUR, 15), lowest,
      low: lowest != null && lowest < LOW_MGDL, ratio: ratioWasApplied(e) ? Number(e.ratioValue) : null
    });
  }
  const sum = v => ({
    n: v.length, avgRatio: mean(v.map(x => x.ratio)), ratioN: v.filter(x => x.ratio != null).length,
    avgCarbs: mean(v.map(x => carbsOf(x.e))), avgDose: mean(v.map(x => insulinOf(x.e))),
    avgStart: mean(v.map(x => x.base)), avgRise: mean(v.map(x => x.rise)), avg3h: mean(v.map(x => x.at3h)),
    avgLowest: mean(v.map(x => x.lowest)), lows: v.filter(x => x.low).length,
    ratioLabels: [...new Set(v.map(x => x.e.ratioLabel).filter(Boolean))]
  });
  return { active: sum(rows.active), quiet: sum(rows.quiet), fromHour, toHour };
}

// ------------------------------------------------------------------ activity summary
/**
 * The activity itself over a period of `days` days ending at `now`: total minutes, minutes a week, active days, a breakdown
 * by activity, and glucose on active days vs rest days (time in range, time low, average) plus the night after each
 * (00:00-06:00 following it: how many nights went low, and the average lowest reading). Day boundaries are local midnights.
 */
export function activitySummary(entries, readings, { days = 14, now = Date.now() } = {}) {
  const sorted = sortReadings(readings);
  const end = localDayKey(now) + DAY;   // the end of today
  const dayKeys = [];
  for (let i = days - 1; i >= 0; i--) { const d = new Date(localDayKey(now)); d.setDate(d.getDate() - i); dayKeys.push(d.getTime()); }
  const start = dayKeys[0];
  const acts = (entries || []).filter(e => isActivity(e) && e.ts >= start && e.ts < end);
  const activeDays = new Set(acts.map(a => localDayKey(a.ts)));
  const totalMin = acts.reduce((s, a) => s + (Number(a.durationMin) || 0), 0);
  const byType = new Map();
  for (const a of acts) {
    const label = activityLabel(a), key = label.toLowerCase();
    if (!byType.has(key)) byType.set(key, { label, n: 0, minutes: 0 });
    const t = byType.get(key); t.n++; t.minutes += Number(a.durationMin) || 0;
  }
  const dayStats = keys => {
    let inR = 0, low = 0, all = 0, sumG = 0, daysWithData = 0;
    const nights = [];
    for (const k of keys) {
      const nextMidnight = new Date(k); nextMidnight.setDate(nextMidnight.getDate() + 1);
      const r = readingsBetween(sorted, k, nextMidnight.getTime() - 1);
      if (r.length >= 72) {   // at least ~6 h of 5-minute readings, so a partly-covered day doesn't skew it
        daysWithData++;
        for (const x of r) { all++; sumG += x.mgdl; if (x.mgdl < LOW_MGDL) low++; else if (x.mgdl <= HIGH_MGDL) inR++; }
      }
      const n0 = nextMidnight.getTime(), n1 = n0 + 6 * HOUR;
      const nr = readingsBetween(sorted, n0, n1);
      if (nr.length >= 36) nights.push({ lowest: Math.min(...nr.map(x => x.mgdl)), low: nr.some(x => x.mgdl < LOW_MGDL) });
    }
    return {
      days: keys.length, daysWithData, readings: all,
      tir: all ? (inR / all) * 100 : null, lowPct: all ? (low / all) * 100 : null, avg: all ? sumG / all : null,
      nights: nights.length, lowNights: nights.filter(x => x.low).length, avgNightLowest: mean(nights.map(x => x.lowest))
    };
  };
  const active = dayKeys.filter(k => activeDays.has(k)), rest = dayKeys.filter(k => !activeDays.has(k));
  return {
    days, sessions: acts.length, totalMinutes: totalMin, minutesPerWeek: (totalMin / days) * 7,
    activeDays: active.length, medianMinutes: median(acts.map(a => Number(a.durationMin) || 0)),
    byType: [...byType.values()].sort((a, b) => b.minutes - a.minutes || a.label.localeCompare(b.label)),
    activeDayStats: dayStats(active), restDayStats: dayStats(rest)
  };
}
