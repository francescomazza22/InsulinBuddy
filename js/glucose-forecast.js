// Where glucose is likely to be in the next 2 hours, from what YOUR glucose did next at similar moments in the past.
// Pure functions: readings ({ at: epoch-ms, mgdl }) and logged entries go in, numbers come out. No DOM, network or clock.
//
// Why not insulin-and-carbs maths (projectGlucose, before 2.71.0): backtested on 30 days of real readings (28 Oct 2026), it
// did worse than simply assuming "no change" at every horizon (2 h: off by 45 mg/dL on average vs 31), whatever timing
// settings were tried. This method beat "no change" at every horizon (2 h: 24), and its 80% range held the real value
// about 78% of the time. See claude/projection.md in the project docs.
//
// How it works:
//   1. Every 15 minutes through your history is a "moment". Each is described by four things: the glucose then, its trend
//      over the previous 30 min, the insulin still to act over the next 2 h and the carbs still to absorb (both in mg/dL,
//      through your correction factor and the ratio used).
//   2. For each moment we note what glucose did 15, 30 ... 120 min later, but only if nothing was logged in between (no
//      meal, dose or treated low), so the result means "if you don't eat or dose again".
//   3. Now is described the same way; the 40 most similar moments give, per step ahead, the middle (median) change and the
//      range 80% of them stayed within. Those changes are added to your current reading.
// It describes your own past, not a guarantee, and never suggests a dose.
import { iobFraction, cobGrams } from "./calc.js";

const MIN = 60000;
export const FORECAST_STEP_MIN = 15;                     // spacing of the moments and of the steps ahead
export const FORECAST_HORIZON_MIN = 120;
export const FORECAST_K = 40;                            // similar moments used
export const FORECAST_WEIGHTS = { g: 25, trend: 15, insulin: 60, carbs: 60 };   // mg/dL that count as "one unit" of difference
export const LOW_TREAT_MINUTES = 45;                     // a treated low (carbs with no insulin) is absorbed fast
export const FORECAST_QUANTILES = [0.1, 0.5, 0.9];
const TREND_MIN = 30, STALE_MIN = 10, OUTCOME_TOL_MIN = 5;

const isNonMeal = e => !e || e.entryType === "basal" || e.mealType === "basal" || e.entryType === "activity";
const carbsOf = e => (isNonMeal(e) ? 0 : Number(e.totalCarbs) || 0);
const insulinOf = e => (isNonMeal(e) ? 0 : (Number(e.mealDose) || 0) + (Number(e.correctionDose) || 0));

function lowerBound(sorted, t) { let lo = 0, hi = sorted.length; while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m].at < t) lo = m + 1; else hi = m; } return lo; }
function cleanReadings(readings) {
  return (readings || []).filter(r => r && Number.isFinite(r.at) && Number.isFinite(r.mgdl) && r.mgdl > 0).slice().sort((a, b) => a.at - b.at);
}
/** The reading closest to t within tolMin minutes (raw, not smoothed), or null. */
function readingNear(sorted, t, tolMin) {
  const i = lowerBound(sorted, t);
  let best = null, bd = Infinity;
  for (const j of [i - 1, i]) if (sorted[j]) { const d = Math.abs(sorted[j].at - t); if (d < bd) { bd = d; best = sorted[j]; } }
  return best && bd <= tolMin * MIN ? best : null;
}
/** Latest reading at or before t, if it is at most STALE_MIN old. */
function latestAt(sorted, t) {
  const i = lowerBound(sorted, t + 1) - 1;
  return i >= 0 && t - sorted[i].at <= STALE_MIN * MIN ? sorted[i] : null;
}
/** Change in mg/dL over the last TREND_MIN minutes, from a least-squares line (one noisy reading can't make a trend). */
function trendAt(sorted, t) {
  const a = lowerBound(sorted, t - TREND_MIN * MIN), b = lowerBound(sorted, t + 1);
  if (b - a < 3 || sorted[b - 1].at - sorted[a].at < 15 * MIN) return null;
  let mx = 0, my = 0;
  for (let i = a; i < b; i++) { mx += sorted[i].at; my += sorted[i].mgdl; }
  mx /= b - a; my /= b - a;
  let num = 0, den = 0;
  for (let i = a; i < b; i++) { num += (sorted[i].at - mx) * (sorted[i].mgdl - my); den += (sorted[i].at - mx) ** 2; }
  return den ? (num / den) * TREND_MIN * MIN : null;
}

/**
 * The four things that describe a moment. entries: logged history (any order); settings: { isfMgdl, peak, dia, absMinutes, fallbackRatio }.
 * insulinLeft: how far the logged meal/correction insulin will still lower glucose over the next 2 h (mg/dL, >= 0).
 * carbsLeft:   how far the carbs not yet absorbed would still raise it (mg/dL, >= 0); treated lows count as absorbed in 45 min.
 */
export function momentFeatures(meals, sorted, settings, t) {
  const r = latestAt(sorted, t);
  if (!r) return null;
  const trend = trendAt(sorted, r.at);
  if (trend == null) return null;
  const { isfMgdl, peak, dia, absMinutes, fallbackRatio = 10 } = settings;
  const end = r.at + FORECAST_HORIZON_MIN * MIN;
  let insulinLeft = 0, carbsLeft = 0;
  for (const e of meals) {
    if (e.ts > r.at) break;                            // meals are sorted by time
    const age = (r.at - e.ts) / MIN;
    const u = insulinOf(e);
    if (u > 0 && age < dia) insulinLeft += u * isfMgdl * (iobFraction(age, peak, dia) - iobFraction((end - e.ts) / MIN, peak, dia));
    const c = carbsOf(e);
    if (c > 0) {
      const T = e.noInsulin ? LOW_TREAT_MINUTES : absMinutes(e);
      if (age < T) {
        const ratio = Number(e.ratioValue) > 0 ? Number(e.ratioValue) : fallbackRatio;
        carbsLeft += (isfMgdl / ratio) * cobGrams(age, c, T);
      }
    }
  }
  return { t: r.at, g: r.mgdl, trend, insulinLeft, carbsLeft };
}

const prepareEntries = entries => (entries || []).filter(e => e && Number.isFinite(e.ts) && !isNonMeal(e) && (carbsOf(e) > 0 || insulinOf(e) > 0)).sort((a, b) => a.ts - b.ts);
// Anything logged except activity ends a moment's "clean" stretch (meals, doses, treated lows, basal).
const loggedTimes = entries => (entries || []).filter(e => e && Number.isFinite(e.ts) && e.entryType !== "activity").map(e => e.ts).sort((a, b) => a - b);

/**
 * Past moments with what followed them. Built from `entries` (the whole history) and `readings` (at least a couple of weeks).
 * Returns [{ t, g, trend, insulinLeft, carbsLeft, after: { 15: change|undefined, 30: ..., 120: ... } }].
 */
export function buildForecastLibrary(entries, readings, settings, { until = Infinity } = {}) {
  const sorted = cleanReadings(readings);
  if (sorted.length < 2 || !(settings && settings.isfMgdl > 0)) return [];
  const meals = prepareEntries(entries), logged = loggedTimes(entries);
  const step = FORECAST_STEP_MIN * MIN;
  const first = Math.ceil(sorted[0].at / step) * step, last = Math.min(until, sorted[sorted.length - 1].at);
  const lib = [];
  for (let t = first; t <= last; t += step) {
    const f = momentFeatures(meals, sorted, settings, t);
    if (!f) continue;
    let lo = 0, hi = logged.length;   // first thing logged after this moment
    while (lo < hi) { const m = (lo + hi) >> 1; if (logged[m] <= f.t) lo = m + 1; else hi = m; }
    const nextLogged = lo < logged.length ? logged[lo] : Infinity;
    const after = {};
    let any = false;
    for (let h = FORECAST_STEP_MIN; h <= FORECAST_HORIZON_MIN; h += FORECAST_STEP_MIN) {
      const at = f.t + h * MIN;
      if (nextLogged <= at || at > last) continue;
      const r = readingNear(sorted, at, OUTCOME_TOL_MIN);
      if (r) { after[h] = r.mgdl - f.g; any = true; }
    }
    if (any) lib.push({ ...f, after });
  }
  return lib;
}

function quantile(sortedVals, p) {
  const i = (sortedVals.length - 1) * p, l = Math.floor(i), u = Math.min(sortedVals.length - 1, l + 1);
  return sortedVals[l] + (sortedVals[u] - sortedVals[l]) * (i - l);
}

/**
 * The likely range from now. `now` = the moment's features (momentFeatures), `library` = buildForecastLibrary.
 * Only past moments whose outcome was already known at `now.t` are used. Returns null without enough history, else
 * { start: { t, mgdl }, points: [{ t, minutes, low, mid, high }], used, nearest } with points from 0 to 120 min (mg/dL).
 */
export function forecastRange(library, now, { k = FORECAST_K, weights = FORECAST_WEIGHTS } = {}) {
  if (!now || !library || !library.length) return null;
  const dist = m => ((m.g - now.g) / weights.g) ** 2 + ((m.trend - now.trend) / weights.trend) ** 2
    + ((m.insulinLeft - now.insulinLeft) / weights.insulin) ** 2 + ((m.carbsLeft - now.carbsLeft) / weights.carbs) ** 2;
  const scored = library.filter(m => m.t < now.t).map(m => ({ m, d: dist(m) })).sort((a, b) => a.d - b.d);
  const points = [{ t: now.t, minutes: 0, low: now.g, mid: now.g, high: now.g }];
  let used = Infinity;
  for (let h = FORECAST_STEP_MIN; h <= FORECAST_HORIZON_MIN; h += FORECAST_STEP_MIN) {
    const known = [];
    for (const s of scored) {
      const v = s.m.after[h];
      if (v === undefined || s.m.t + h * MIN > now.t) continue;   // that outcome wasn't known yet at `now`
      known.push(v);
      if (known.length >= k) break;
    }
    if (known.length < k) return null;
    known.sort((a, b) => a - b);
    const [lo, mid, hi] = FORECAST_QUANTILES.map(p => quantile(known, p));
    const clamp = v => Math.min(400, Math.max(40, now.g + v));
    points.push({ t: now.t + h * MIN, minutes: h, low: clamp(lo), mid: clamp(mid), high: clamp(hi) });
    used = Math.min(used, known.length);
  }
  // Each step ahead comes from its own set of moments, so neighbouring steps can jitter; average each with its neighbours
  // (the start stays the real reading, the last step averages with the one before) so the band reads as one shape.
  const raw = points.map(p => ({ ...p }));
  for (let i = 1; i < points.length; i++) {
    const nb = [raw[i - 1], raw[i], raw[i + 1]].filter(Boolean).filter(p => p.minutes > 0);
    for (const key of ["low", "mid", "high"]) points[i][key] = nb.reduce((s, p) => s + p[key], 0) / nb.length;
  }
  return { start: { t: now.t, mgdl: now.g }, points, used, librarySize: library.length };
}

/** One call for the app: the likely range from the latest reading, or null (no recent reading, or under ~2 weeks of history). */
export function glucoseForecast(entries, readings, settings, nowMs, { library } = {}) {
  const sorted = cleanReadings(readings);
  const lib = library || buildForecastLibrary(entries, sorted, settings, { until: nowMs });
  const f = momentFeatures(prepareEntries(entries), sorted, settings, nowMs);
  return f ? forecastRange(lib, f) : null;
}

/**
 * How well the range has done on your own recent past: every `every`-th moment of the last `days` days that has a 2-hour
 * outcome is forecast from what was known at the time and checked against what happened.
 * Returns { checked, held (share 0-1 inside the range), error (avg |middle - real|), flatError (avg |no change - real|) } or null.
 */
export function forecastTrackRecord(library, { days = 14, every = 2 } = {}) {
  if (!library || !library.length) return null;
  const last = library[library.length - 1].t, from = last - days * 86400000;
  let checked = 0, held = 0, err = 0, flat = 0, i = 0;
  for (const m of library) {
    if (m.t < from || m.after[FORECAST_HORIZON_MIN] === undefined) continue;
    if (i++ % every) continue;
    const fc = forecastRange(library, m);
    if (!fc) continue;
    const real = m.g + m.after[FORECAST_HORIZON_MIN], p = fc.points[fc.points.length - 1];
    checked++;
    if (real >= p.low && real <= p.high) held++;
    err += Math.abs(p.mid - real); flat += Math.abs(m.after[FORECAST_HORIZON_MIN]);
  }
  return checked ? { checked, held: held / checked, error: err / checked, flatError: flat / checked } : null;
}

/** Plain-English summary pieces for the chart caption. */
export function forecastSummary(fc) {
  if (!fc) return null;
  const end = fc.points[fc.points.length - 1];
  const lowest = fc.points.reduce((a, p) => (p.low < a.low ? p : a), fc.points[1]);
  return { end, lowRisk: lowest.low < 70, lowest };
}
