// Glucose insights: pure functions over logged entries and stored CGM readings ({ at: epoch-ms, mgdl }).
// No DOM, no network, no clock: everything a test (or the Trends cards) needs is passed in. These describe what
// HAPPENED after meals and doses. They are patterns to talk through with a care team, never dosing instructions.
import { MGDL_PER_MMOL, ratioWasApplied } from "./calc.js";
import { activityLabel } from "./activity.js";

const MIN = 60000, HOUR = 3600000;
export const LOW_MGDL = 70, HIGH_MGDL = 180;

const isBasal = e => !e || e.entryType === "basal" || e.mealType === "basal";
// Logged physical activity (2.65.0) is not a meal or a dose either: no carbs, no insulin, kept out of every meal figure.
const notMeal = e => isBasal(e) || e.entryType === "activity";
const insulinOf = e => (Number(e.mealDose) || 0) + (Number(e.correctionDose) || 0);
const carbsOf = e => Number(e.totalCarbs) || 0;
const mid = (a, b) => (a + b) / 2;

export function median(values) {
  const v = (values || []).filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : mid(v[m - 1], v[m]);
}
export function quantile(values, q) {
  const v = (values || []).filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!v.length) return null;
  if (v.length === 1) return v[0];
  const i = q * (v.length - 1), lo = Math.floor(i), hi = Math.ceil(i);
  return v[lo] + (v[hi] - v[lo]) * (i - lo);
}
const mean = v => (v.length ? v.reduce((s, x) => s + x, 0) / v.length : null);

/** Readings sorted by time, with junk removed. */
export function sortReadings(readings) {
  return (readings || []).filter(r => r && Number.isFinite(r.at) && Number.isFinite(r.mgdl)).slice().sort((a, b) => a.at - b.at);
}
function lowerBound(sorted, t) {
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m].at < t) lo = m + 1; else hi = m; }
  return lo;
}
/** The reading nearest to time t, if one lies within tolMin minutes. */
export function glucoseAt(sorted, t, tolMin = 10) {
  if (!sorted.length) return null;
  const i = lowerBound(sorted, t);
  let best = null, bd = Infinity;
  for (const j of [i - 1, i]) if (sorted[j]) { const d = Math.abs(sorted[j].at - t); if (d < bd) { bd = d; best = sorted[j]; } }
  return best && bd <= tolMin * MIN ? best.mgdl : null;
}
/** Readings with t0 <= at <= t1. */
export function readingsBetween(sorted, t0, t1) {
  const out = [];
  for (let i = lowerBound(sorted, t0); i < sorted.length && sorted[i].at <= t1; i++) out.push(sorted[i]);
  return out;
}
const classify = g => (g < LOW_MGDL ? "low" : g > HIGH_MGDL ? "high" : "in");

/** Meals that carried insulin and a usable baseline reading. Each gets its baseline glucose. */
// `skip` (2.67.0): an optional (entry) => boolean for meals to leave out, e.g. ones eaten near a logged activity
// (js/activity-stats.js). Only the meals being described are skipped; neighbouring entries still count as context.
const NO_SKIP = () => false;
function dosedMeals(entries, sorted, { needCarbs = true, skip = NO_SKIP } = {}) {
  return (entries || []).filter(e => e && !notMeal(e) && Number.isFinite(e.ts) && insulinOf(e) > 0 && !e.noInsulin && (!needCarbs || carbsOf(e) > 0) && !skip(e))
    .map(e => ({ e, base: glucoseAt(sorted, e.ts, 10) })).filter(x => x.base != null);
}
const groupLabel = e => e.ratioLabel || "Other";
const enoughCoverage = (sorted, t0, t1, minFrac = 0.5, expectedGapMin = 5) => readingsBetween(sorted, t0, t1).length >= ((t1 - t0) / (expectedGapMin * MIN)) * minFrac;

// ------------------------------------------------------------------ 1. glucose after meals
/**
 * The typical glucose curve after a dosed meal, per ratio bracket (and for all meals together): at every
 * `stepMin` minutes after the injection, the median and the 25th-75th percentile band across meals.
 */
export function postMealCurves(entries, readings, { hours = 4, stepMin = 15, minMeals = 3, skip = NO_SKIP } = {}) {
  const sorted = sortReadings(readings);
  const steps = Math.floor((hours * 60) / stepMin);
  const groups = new Map();
  const add = (label, series) => { if (!groups.has(label)) groups.set(label, []); groups.get(label).push(series); };
  let meals = 0;
  for (const { e, base } of dosedMeals(entries, sorted, { skip })) {
    if (!enoughCoverage(sorted, e.ts, e.ts + hours * HOUR)) continue;
    const series = [];
    for (let k = 0; k <= steps; k++) series.push(glucoseAt(sorted, e.ts + k * stepMin * MIN, Math.max(5, stepMin / 2)));
    series[0] = base;
    meals++;
    add("All meals", series);
    add(groupLabel(e), series);
  }
  const out = [];
  for (const [label, list] of groups) {
    const points = [];
    for (let k = 0; k <= steps; k++) {
      const col = list.map(s => s[k]).filter(v => v != null);
      points.push({ minute: k * stepMin, n: col.length, p25: quantile(col, 0.25), p50: median(col), p75: quantile(col, 0.75) });
    }
    out.push({ label, count: list.length, enough: list.length >= minMeals, points });
  }
  out.sort((a, b) => (a.label === "All meals" ? -1 : b.label === "All meals" ? 1 : b.count - a.count));
  return { groups: out, meals, hours, stepMin };
}

// ------------------------------------------------------------------ 2. outcome after meals, by bracket
/** Where glucose was `afterHours` after each dosed meal: below, in or above range, per bracket. */
export function outcomeByBracket(entries, readings, { afterHours = 3, skip = NO_SKIP } = {}) {
  const sorted = sortReadings(readings);
  const groups = new Map();
  for (const { e, base } of dosedMeals(entries, sorted, { skip })) {
    const g = glucoseAt(sorted, e.ts + afterHours * HOUR, 15);
    if (g == null) continue;
    const lowWin = readingsBetween(sorted, e.ts + HOUR, e.ts + (afterHours + 1) * HOUR).some(r => r.mgdl < LOW_MGDL);
    const key = groupLabel(e);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ base, g, cls: classify(g), lowWin });
  }
  const mk = (label, v) => ({
    label, n: v.length,
    low: v.filter(x => x.cls === "low").length, inRange: v.filter(x => x.cls === "in").length, high: v.filter(x => x.cls === "high").length,
    anyLow: v.filter(x => x.lowWin).length, avgStart: mean(v.map(x => x.base)), avgEnd: mean(v.map(x => x.g))
  });
  const rows = [...groups].map(([l, v]) => mk(l, v)).sort((a, b) => b.n - a.n);
  const all = [...groups.values()].flat();
  return { rows, total: all.length, all: all.length ? mk("All meals", all) : null, afterHours };
}

// ------------------------------------------------------------------ 3. foods that cause trouble
/**
 * Per food: the average rise (peak within 3 h minus the starting reading) and how often a low followed within
 * 4 h, counting only meals where that food made up most (60%+) of the carbs, so one food isn't blamed for another's.
 */
export function foodImpact(entries, readings, { minMeals = 2, skip = NO_SKIP } = {}) {
  const sorted = sortReadings(readings);
  const per = new Map();
  for (const { e, base } of dosedMeals(entries, sorted, { skip })) {
    const total = carbsOf(e);
    if (!total) continue;
    const win = readingsBetween(sorted, e.ts, e.ts + 3 * HOUR);
    if (win.length < 6) continue;
    const peak = Math.max(...win.map(r => r.mgdl));
    const lowAfter = readingsBetween(sorted, e.ts + HOUR, e.ts + 4 * HOUR).some(r => r.mgdl < LOW_MGDL);
    for (const it of e.items || []) {
      const name = String(it.name || "").trim();
      if (!name || it.refType === "quick") continue;
      if ((Number(it.carbs) || 0) / total < 0.6) continue;
      if (!per.has(name)) per.set(name, []);
      per.get(name).push({ rise: peak - base, peak, lowAfter, dose: insulinOf(e), carbs: total });
    }
  }
  const rows = [...per].filter(([, v]) => v.length >= minMeals).map(([name, v]) => ({
    name, n: v.length, avgRise: mean(v.map(x => x.rise)), avgPeak: mean(v.map(x => x.peak)),
    lowPct: (v.filter(x => x.lowAfter).length / v.length) * 100, avgDose: mean(v.map(x => x.dose)), avgCarbs: mean(v.map(x => x.carbs))
  }));
  return {
    rows,
    biggestRise: rows.slice().sort((a, b) => b.avgRise - a.avgRise).slice(0, 5),
    mostLows: rows.filter(r => r.lowPct > 0).sort((a, b) => b.lowPct - a.lowPct || b.n - a.n).slice(0, 5)
  };
}

// ------------------------------------------------------------------ 4. correction effectiveness
/**
 * Corrections given on their own (no carbs, no other food or insulin in the 4 h around them): how far glucose
 * fell per unit. The median is "your effective correction factor", to compare with the one set in Settings.
 */
export function correctionEffectiveness(entries, readings, { isfMgdl = null, skip = NO_SKIP } = {}) {
  const sorted = sortReadings(readings);
  const all = (entries || []).filter(e => e && !notMeal(e) && Number.isFinite(e.ts));
  const events = [];
  for (const e of all) {
    const units = insulinOf(e);
    if (e.noInsulin || units <= 0 || carbsOf(e) > 0 || skip(e)) continue;
    const base = glucoseAt(sorted, e.ts, 10);
    if (base == null || base <= LOW_MGDL + 30) continue;
    const clash = all.some(o => o !== e && ((o.ts > e.ts - 3 * HOUR && o.ts < e.ts && insulinOf(o) > 0) || (o.ts > e.ts && o.ts <= e.ts + 4 * HOUR && (insulinOf(o) > 0 || carbsOf(o) > 0))));
    if (clash) continue;
    const after = glucoseAt(sorted, e.ts + 3 * HOUR, 15);
    if (after == null) continue;
    events.push({ ts: e.ts, units, start: base, end: after, drop: base - after, perUnit: (base - after) / units });
  }
  const per = events.map(x => x.perUnit);
  return { n: events.length, medianPerUnit: median(per), meanPerUnit: mean(per), isfMgdl, events: events.sort((a, b) => b.ts - a.ts) };
}

// ------------------------------------------------------------------ 5. insulin-on-board stacking
/** Meals taken while insulin from an earlier dose (within 4 h) was still active, versus meals taken clean. */
export function iobStacking(entries, readings, { windowHours = 4, skip = NO_SKIP } = {}) {
  const sorted = sortReadings(readings);
  const doses = (entries || []).filter(e => e && !notMeal(e) && !e.noInsulin && insulinOf(e) > 0 && Number.isFinite(e.ts));
  const stacked = [], clean = [];
  for (const { e, base } of dosedMeals(entries, sorted, { skip })) {
    const g = glucoseAt(sorted, e.ts + 3 * HOUR, 15);
    if (g == null) continue;
    const min = Math.min(...readingsBetween(sorted, e.ts, e.ts + 4 * HOUR).map(r => r.mgdl));
    const prior = doses.filter(o => o !== e && o.ts < e.ts && e.ts - o.ts <= windowHours * HOUR);
    const rec = { base, g, min, priorUnits: prior.reduce((s, o) => s + insulinOf(o), 0) };
    (prior.length ? stacked : clean).push(rec);
  }
  const sum = v => ({
    n: v.length, avgStart: mean(v.map(x => x.base)), avgEnd: mean(v.map(x => x.g)),
    lowPct: v.length ? (v.filter(x => x.min < LOW_MGDL).length / v.length) * 100 : null,
    highPct: v.length ? (v.filter(x => x.g > HIGH_MGDL).length / v.length) * 100 : null,
    avgPriorUnits: mean(v.map(x => x.priorUnits))
  });
  return { stacked: sum(stacked), clean: sum(clean), windowHours };
}

// ------------------------------------------------------------------ 6. overnight and basal
/**
 * Each night (00:00-06:00 local) with no food or bolus insulin in the hours before it: glucose at the start, at the
 * end, the drift between, and the lowest/highest reading, alongside the last basal dose logged before it.
 */
export function overnightStats(entries, readings, { startHour = 0, endHour = 6, quietFromHour = -3 } = {}) {
  const sorted = sortReadings(readings);
  if (!sorted.length) return { nights: [], n: 0 };
  const basals = (entries || []).filter(e => e && isBasal(e) && Number.isFinite(e.ts) && Number(e.basalDose) > 0).sort((a, b) => a.ts - b.ts);
  const events = (entries || []).filter(e => e && !notMeal(e) && Number.isFinite(e.ts) && (carbsOf(e) > 0 || insulinOf(e) > 0));
  const first = new Date(sorted[0].at), last = new Date(sorted[sorted.length - 1].at);
  const nights = [];
  for (let d = new Date(first.getFullYear(), first.getMonth(), first.getDate()); d <= last; d.setDate(d.getDate() + 1)) {
    const t0 = new Date(d.getFullYear(), d.getMonth(), d.getDate(), startHour).getTime();
    const t1 = new Date(d.getFullYear(), d.getMonth(), d.getDate(), endHour).getTime();
    if (t1 > last.getTime()) continue;
    if (events.some(e => e.ts >= t0 + quietFromHour * HOUR && e.ts <= t1)) continue;     // food or bolus disturbed the night
    const win = readingsBetween(sorted, t0, t1);
    if (win.length < ((t1 - t0) / (5 * MIN)) * 0.5) continue;
    const gs = readingsBetween(sorted, t0, t0 + 30 * MIN).map(r => r.mgdl), ge = readingsBetween(sorted, t1 - 30 * MIN, t1).map(r => r.mgdl);
    if (!gs.length || !ge.length) continue;
    const start = median(gs), end = median(ge);
    const basal = basals.filter(b => b.ts <= t0 && t0 - b.ts <= 30 * HOUR).pop() || null;
    nights.push({ date: t0, start, end, drift: end - start, min: Math.min(...win.map(r => r.mgdl)), max: Math.max(...win.map(r => r.mgdl)), low: win.some(r => r.mgdl < LOW_MGDL), basal: basal ? Number(basal.basalDose) : null });
  }
  const byBasal = new Map();
  for (const n of nights) if (n.basal != null) { const k = Math.round(n.basal * 2) / 2; if (!byBasal.has(k)) byBasal.set(k, []); byBasal.get(k).push(n); }
  return {
    nights, n: nights.length,
    avgDrift: mean(nights.map(n => n.drift)), avgStart: mean(nights.map(n => n.start)), avgEnd: mean(nights.map(n => n.end)),
    lowNights: nights.filter(n => n.low).length,
    byBasal: [...byBasal].map(([dose, v]) => ({ dose, n: v.length, avgDrift: mean(v.map(x => x.drift)), lows: v.filter(x => x.low).length })).sort((a, b) => a.dose - b.dose)
  };
}

// ------------------------------------------------------------------ 7. weekday vs weekend, and activity
const isWeekend = ts => { const d = new Date(ts).getDay(); return d === 0 || d === 6; };
/** Daily totals and 3-hour outcomes for weekdays vs weekends, plus how activity ratios compare with everyday ones. */
export function weekdayWeekend(entries, readings, settings = {}) {
  const sorted = sortReadings(readings);
  const meals = (entries || []).filter(e => e && !notMeal(e) && Number.isFinite(e.ts));
  const build = list => {
    const days = new Set(list.map(e => new Date(e.ts).toDateString()));
    const dosed = list.filter(e => !e.noInsulin && insulinOf(e) > 0);
    const outs = dosed.map(e => glucoseAt(sorted, e.ts + 3 * HOUR, 15)).filter(v => v != null);
    const ratios = list.filter(ratioWasApplied).map(e => Number(e.ratioValue));
    return {
      days: days.size, meals: dosed.length,
      carbsPerDay: days.size ? list.reduce((s, e) => s + carbsOf(e), 0) / days.size : null,
      insulinPerDay: days.size ? list.reduce((s, e) => s + insulinOf(e), 0) / days.size : null,
      mealsPerDay: days.size ? dosed.length / days.size : null,
      avgRatio: mean(ratios), n3h: outs.length,
      avg3h: mean(outs), lowPct: outs.length ? (outs.filter(v => v < LOW_MGDL).length / outs.length) * 100 : null, highPct: outs.length ? (outs.filter(v => v > HIGH_MGDL).length / outs.length) * 100 : null
    };
  };
  const activityNames = new Set((settings.activityRatios || []).map(r => r.name));
  const split = (pred) => build(meals.filter(pred));
  const activityRows = [];
  for (const name of activityNames) {
    const v = meals.filter(e => e.ratioLabel === name && ratioWasApplied(e));
    if (!v.length) continue;
    const outs = v.map(e => glucoseAt(sorted, e.ts + 3 * HOUR, 15)).filter(x => x != null);
    activityRows.push({ label: name, n: v.length, avgRatio: mean(v.map(e => Number(e.ratioValue))), avgCarbs: mean(v.map(carbsOf)), avg3h: mean(outs), n3h: outs.length, lowPct: outs.length ? (outs.filter(x => x < LOW_MGDL).length / outs.length) * 100 : null });
  }
  const everyday = meals.filter(e => !activityNames.has(e.ratioLabel) && ratioWasApplied(e));
  const eOuts = everyday.map(e => glucoseAt(sorted, e.ts + 3 * HOUR, 15)).filter(x => x != null);
  return {
    weekday: split(e => !isWeekend(e.ts)), weekend: split(e => isWeekend(e.ts)), activity: activityRows,
    everyday: { n: everyday.length, avgRatio: mean(everyday.map(e => Number(e.ratioValue))), avg3h: mean(eOuts), n3h: eOuts.length, lowPct: eOuts.length ? (eOuts.filter(x => x < LOW_MGDL).length / eOuts.length) * 100 : null }
  };
}

// ------------------------------------------------------------------ features that reuse the same history
/** What you usually eat to treat a low: the carbs from your own low-treatment entries (food with no insulin). */
export function lowTreatmentUsual(entries, { recent = 12 } = {}) {
  const list = (entries || []).filter(e => e && !notMeal(e) && e.noInsulin && carbsOf(e) > 0 && Number.isFinite(e.ts)).sort((a, b) => b.ts - a.ts).slice(0, recent);
  return { n: list.length, medianCarbs: median(list.map(carbsOf)), minCarbs: list.length ? Math.min(...list.map(carbsOf)) : null, maxCarbs: list.length ? Math.max(...list.map(carbsOf)) : null };
}

/** The last few times a given food (by library id, else by name) was logged: when, how much, dose, and glucose 3 h on. */
export function lastTimesFor(entries, readings, { refId = null, name = "" } = {}, count = 3) {
  const sorted = sortReadings(readings);
  const nm = String(name || "").trim().toLowerCase();
  const hit = it => (refId && it.refId === refId) || (nm && String(it.name || "").trim().toLowerCase() === nm);
  return (entries || []).filter(e => e && !notMeal(e) && Number.isFinite(e.ts) && (e.items || []).some(hit))
    .sort((a, b) => b.ts - a.ts).slice(0, count).map(e => {
      const it = e.items.find(hit);
      return {
        ts: e.ts, grams: it.grams ?? null, quantity: it.quantity ?? null, unitLabel: it.unitLabel ?? null, ...(it.portion ? { portion: it.portion } : {}),
        totalCarbs: carbsOf(e), dose: insulinOf(e), noInsulin: !!e.noInsulin, alone: e.items.length === 1,
        start: glucoseAt(sorted, e.ts, 10), after3h: glucoseAt(sorted, e.ts + 3 * HOUR, 15)
      };
    });
}

// ------------------------------------------------------------------ 8. logged physical activity (2.65.0)
export const ACTIVITY_AFTER_HOURS = 6;
/**
 * Glucose around one logged activity: the reading when it started and when it ended, the change in between, and the lowest
 * reading from the start to `afterHours` after the end (with whether that dipped below 70). Fields are null where there were
 * no readings close enough; `covered` is false when there isn't a start and an end reading to compare.
 */
export function activityGlucose(entry, readings, { afterHours = ACTIVITY_AFTER_HOURS, presorted = false } = {}) {
  const sorted = presorted ? readings : sortReadings(readings);
  const t0 = entry.ts, t1 = entry.ts + (Number(entry.durationMin) || 0) * MIN;
  const start = glucoseAt(sorted, t0, 15), end = glucoseAt(sorted, t1, 15);
  const window = readingsBetween(sorted, t0, t1 + afterHours * HOUR);
  const lowest = window.length ? window.reduce((m, r) => (r.mgdl < m.mgdl ? r : m)) : null;
  return {
    start, end, change: start != null && end != null ? end - start : null, covered: start != null && end != null,
    lowest: lowest ? lowest.mgdl : null, lowestAt: lowest ? lowest.at : null, low: !!lowest && lowest.mgdl < LOW_MGDL
  };
}

/**
 * What logged activities did to glucose, per activity (Run, Walk, a named Other...): how many have readings around them, the
 * average reading at the start, the average change from start to end, the average lowest reading from the start to 6 hours after,
 * and how many dipped below 70 in that time. Each also gets the same figures split by intensity. Busiest activity first.
 * Only activities with a start and an end reading count. Describes what happened; never dosing advice.
 */
export function activityImpact(entries, readings, { afterHours = ACTIVITY_AFTER_HOURS } = {}) {
  const sorted = sortReadings(readings);
  const groups = new Map();
  for (const e of entries || []) {
    if (!e || e.entryType !== "activity" || !Number.isFinite(e.ts)) continue;
    const g = activityGlucose(e, sorted, { afterHours, presorted: true });
    if (!g.covered) continue;
    const label = activityLabel(e);
    const key = label.toLowerCase();
    if (!groups.has(key)) groups.set(key, { label, rows: [] });
    groups.get(key).rows.push({ e, g });
  }
  const summarise = rows => ({
    n: rows.length,
    avgStart: mean(rows.map(r => r.g.start)), avgChange: mean(rows.map(r => r.g.change)),
    avgLowest: mean(rows.map(r => r.g.lowest).filter(Number.isFinite)), lows: rows.filter(r => r.g.low).length,
    avgMinutes: mean(rows.map(r => Number(r.e.durationMin) || 0))
  });
  return [...groups.values()].map(({ label, rows }) => ({
    label, ...summarise(rows),
    byIntensity: ["light", "moderate", "hard"].map(i => ({ intensity: i, rows: rows.filter(r => r.e.intensity === i) })).filter(x => x.rows.length).map(x => ({ intensity: x.intensity, ...summarise(x.rows) }))
  })).sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
}

/** mmol/L-per-unit settings -> mg/dL per unit. */
export const isfToMgdl = (isf, units) => (units === "mmol" ? Number(isf) * MGDL_PER_MMOL : Number(isf));
