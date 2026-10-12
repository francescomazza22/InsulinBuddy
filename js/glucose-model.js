// What your glucose is doing compared with what the logged insulin alone would do, and what that says about carbs still being
// absorbed. Pure functions: readings ({ at: epoch-ms, mgdl }) and logged entries go in, numbers come out. No DOM, network or clock.
//
// The idea (the same one Loop and similar systems use): insulin lowers glucose by a known amount over time (dose x correction
// factor x how much of the dose has acted so far). Whatever the readings did BEYOND that is attributed to carbs being absorbed,
// converted to grams with the carb effect per gram (correction factor / the ratio used for that meal). It is an ESTIMATE: it
// ignores basal insulin, exercise, stress, illness and sensor error, and it describes the past and a projection, never a dose.
import { iobFraction, cobGrams, absorptionMinutesForEntry, giBand } from "./calc.js";

const MIN = 60000, STEP = 5 * MIN, HOUR = 3600000;
export const MODEL_STEP_MS = STEP;

const isBasal = e => !e || e.entryType === "basal" || e.mealType === "basal";
const carbsOf = e => (isBasal(e) ? 0 : Number(e.totalCarbs) || 0);
const insulinOf = e => (isBasal(e) ? 0 : (Number(e.mealDose) || 0) + (Number(e.correctionDose) || 0));
const median = v => { const a = v.filter(Number.isFinite).sort((x, y) => x - y); if (!a.length) return null; const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };

function lowerBound(sorted, t) { let lo = 0, hi = sorted.length; while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m].at < t) lo = m + 1; else hi = m; } return lo; }
/** Readings sorted by time, junk removed, and lightly smoothed (a 3-point median) so one noisy reading does not read as a swing. */
export function prepareReadings(readings) {
  const s = (readings || []).filter(r => r && Number.isFinite(r.at) && Number.isFinite(r.mgdl)).slice().sort((a, b) => a.at - b.at);
  return s.map((r, i) => ({ at: r.at, mgdl: i > 0 && i < s.length - 1 ? median([s[i - 1].mgdl, r.mgdl, s[i + 1].mgdl]) : r.mgdl }));
}
/** The (smoothed) glucose at time t, taken from the nearest reading within tolMin minutes. */
export function glucoseNear(sorted, t, tolMin = 4) {
  if (!sorted.length) return null;
  const i = lowerBound(sorted, t);
  let best = null, bd = Infinity;
  for (const j of [i - 1, i]) if (sorted[j]) { const d = Math.abs(sorted[j].at - t); if (d < bd) { bd = d; best = sorted[j]; } }
  return best && bd <= tolMin * MIN ? best.mgdl : null;
}

/** How far the logged insulin lowers glucose between t0 and t1 (mg/dL, >= 0): sum over doses of dose x ISF x the share of it acting in that span. */
export function insulinDrop(entries, t0, t1, isfMgdl, peak, dia) {
  let drop = 0;
  for (const e of entries || []) {
    const u = insulinOf(e);
    if (!(u > 0) || !Number.isFinite(e.ts) || e.ts >= t1) continue;
    const a = Math.max(0, (t0 - e.ts) / MIN), b = Math.max(0, (t1 - e.ts) / MIN);
    drop += u * isfMgdl * (iobFraction(a, peak, dia) - iobFraction(b, peak, dia));
  }
  return drop;
}

/** mg/dL of glucose rise per gram of carbs for one entry: the correction factor divided by the ratio that was used for it. */
export function carbEffectPerGram(entry, isfMgdl, fallbackRatio = 10) {
  const r = Number(entry && entry.ratioValue) > 0 ? Number(entry.ratioValue) : fallbackRatio;
  return isfMgdl / r;
}

/**
 * Your readings next to what insulin alone would have done, from the last logged meal or dose until now.
 * Returns { anchor: { t, mgdl }, points: [{ t, expected, actual }], now: { t, expected, actual, gap } } or null.
 */
export function expectedFromInsulin(entries, readings, { isfMgdl, peak, dia, now, maxHours = 6 }) {
  const sorted = prepareReadings(readings);
  if (!sorted.length || !(isfMgdl > 0)) return null;
  const cands = (entries || []).filter(e => !isBasal(e) && Number.isFinite(e.ts) && e.ts <= now && now - e.ts <= maxHours * HOUR && (carbsOf(e) > 0 || insulinOf(e) > 0)).sort((a, b) => b.ts - a.ts);
  for (const e of cands) {
    const g0 = glucoseNear(sorted, e.ts, 10);
    if (g0 == null) continue;
    const points = [];
    for (let t = e.ts; t <= now + 1; t += STEP) {
      const actual = glucoseNear(sorted, t, 4);
      points.push({ t, expected: g0 - insulinDrop(entries, e.ts, t, isfMgdl, peak, dia), actual });
    }
    const last = [...points].reverse().find(p => p.actual != null);
    if (!last || points.filter(p => p.actual != null).length < 4) continue;
    return { anchor: { t: e.ts, mgdl: g0, entry: e }, points, now: { t: last.t, expected: last.expected, actual: last.actual, gap: last.actual - last.expected } };
  }
  return null;
}

/**
 * Carbs on board, corrected by what your glucose actually did. Per meal: absorbed grams = the rise the insulin does not
 * explain / the carb effect per gram, handed to the oldest meal still unabsorbed. A meal can never be absorbed slower than
 * "finished by 1.5 x its usual time", so a quiet stretch does not leave carbs hanging forever. With too few readings it
 * falls back to the plain model for that meal.
 *   settings: { isfMgdl, peak, dia, absMinutes: entry => minutes, fallbackRatio }
 */
export function observedCarbs(entries, readings, settings, now) {
  const { isfMgdl, peak, dia, absMinutes, fallbackRatio = 10 } = settings;
  const sorted = prepareReadings(readings);
  const meals = (entries || []).filter(e => carbsOf(e) > 0 && Number.isFinite(e.ts) && e.ts <= now).map(e => {
    const T = absMinutes(e);
    return { e, ts: e.ts, carbs: carbsOf(e), T, csf: carbEffectPerGram(e, isfMgdl, fallbackRatio) };
  }).filter(m => now - m.ts < m.T * 1.5 * MIN).sort((a, b) => a.ts - b.ts);
  if (!meals.length) return { meals: [], cob: 0, modelCob: 0, observed: false, ratePerMin: 0, finishMin: 0, csf: carbEffectPerGram(null, isfMgdl, fallbackRatio) };
  const modelRemaining = (m, t, mult = 1) => cobGrams((t - m.ts) / MIN, m.carbs, m.T * mult);
  meals.forEach(m => { m.absorbed = 0; });
  // observation: step from the first meal to now
  const t0 = meals[0].ts;
  let steps = 0, covered = 0;
  const recent = [];   // [t, grams] absorbed per step, for the recent rate
  for (let t = t0; t + STEP <= now + 1; t += STEP) {
    steps++;
    const g1 = glucoseNear(sorted, t, 3), g2 = glucoseNear(sorted, t + STEP, 3);
    const live = meals.filter(m => m.ts <= t + STEP && m.absorbed < m.carbs - 0.05);
    let grams = 0;
    if (g1 != null && g2 != null) {
      covered++;
      const carbRise = (g2 - g1) + insulinDrop(entries, t, t + STEP, isfMgdl, peak, dia);
      if (live.length && carbRise > 0) {
        let left = carbRise;
        for (const m of live) {   // oldest first
          const take = Math.min(left / m.csf, m.carbs - m.absorbed);
          m.absorbed += take; grams += take; left -= take * m.csf;
          if (left <= 0.01) break;
        }
      }
    }
    // the minimum absorption pace (finished by 1.5 x the usual time)
    for (const m of meals) if (m.ts <= t + STEP) m.absorbed = Math.max(m.absorbed, m.carbs - modelRemaining(m, t + STEP, 1.5));
    recent.push([t + STEP, grams]);
  }
  const observed = steps >= 4 && covered / steps >= 0.6;
  let cob = 0, modelCob = 0;
  for (const m of meals) {
    m.modelRemaining = Math.max(0, modelRemaining(m, now));
    m.remaining = observed ? Math.max(0, m.carbs - m.absorbed) : m.modelRemaining;
    cob += m.remaining; modelCob += m.modelRemaining;
    const modelAbsorbed = m.carbs - m.modelRemaining;
    m.paceVsUsual = observed && modelAbsorbed > 3 ? (m.carbs - m.remaining) / modelAbsorbed : null;
  }
  const rateWindow = 30 * MIN;
  const recentGrams = recent.filter(([t]) => t > now - rateWindow).reduce((s, [, g]) => s + g, 0);
  const ratePerMin = observed ? recentGrams / (rateWindow / MIN) : 0;
  // how long until what is left is gone: at the recent pace if there is one, else the usual pace, never past 1.5 x usual
  const capMin = Math.max(15, ...meals.map(m => (m.ts + m.T * 1.5 * MIN - now) / MIN));
  const usualMin = Math.max(15, ...meals.filter(m => m.remaining > 0.5).map(m => (m.ts + m.T * MIN - now) / MIN));
  const finishMin = cob <= 0.5 ? 0 : Math.min(capMin, ratePerMin > 0.03 ? Math.max(15, cob / ratePerMin) : usualMin);
  const totalRem = meals.reduce((s, m) => s + m.remaining, 0) || 1;
  const csf = meals.reduce((s, m) => s + m.csf * m.remaining, 0) / totalRem;
  return { meals, cob, modelCob, observed, ratePerMin, finishMin, csf };
}

/** Remaining carbs (g) at `offsetMin` minutes from now, falling in a straight line to zero over `finishMin`. */
export function cobAt(obs, offsetMin) {
  if (!obs || obs.cob <= 0.5 || !(obs.finishMin > 0)) return 0;
  return Math.max(0, obs.cob * (1 - offsetMin / obs.finishMin));
}

/**
 * Glucose projected forward from the latest reading, assuming no further food or insulin:
 *   now - the insulin still to act + the rise from the carbs still to absorb.
 * Returns { start: { t, mgdl }, points: [{ t, mgdl }], low: { t, mgdl }, high: { t, mgdl }, end, observed } or null.
 */
export function projectGlucose(entries, readings, settings, now, { maxHours = 6, staleMin = 15 } = {}) {
  const { isfMgdl, peak, dia } = settings;
  const sorted = prepareReadings(readings);
  const lastRaw = [...(readings || [])].filter(r => r && Number.isFinite(r.at) && Number.isFinite(r.mgdl) && r.at <= now).sort((a, b) => b.at - a.at)[0];
  if (!lastRaw || now - lastRaw.at > staleMin * MIN || !(isfMgdl > 0)) return null;
  const obs = observedCarbs(entries, readings, settings, now);
  const t0 = lastRaw.at;
  const g0 = lastRaw.mgdl;
  const insulinTail = Math.max(0, ...(entries || []).filter(e => insulinOf(e) > 0 && e.ts <= now).map(e => e.ts + dia * MIN - now)) / MIN;
  const horizonMin = Math.min(maxHours * 60, Math.max(30, Math.ceil(Math.max(insulinTail, obs.finishMin) / 5) * 5));
  const points = [];
  for (let m = 0; m <= horizonMin; m += 5) {
    const t = t0 + m * MIN;
    points.push({ t, mgdl: g0 - insulinDrop(entries, t0, t, isfMgdl, peak, dia) + (t >= now ? obs.csf * (obs.cob - cobAt(obs, (t - now) / MIN)) : 0) });
  }
  const low = points.reduce((a, p) => (p.mgdl < a.mgdl ? p : a), points[0]);
  const high = points.reduce((a, p) => (p.mgdl > a.mgdl ? p : a), points[0]);
  return { start: { t: t0, mgdl: g0 }, points, low, high, end: points[points.length - 1], observed: obs.observed, obs, horizonMin };
}

/**
 * How long, in YOUR readings, carbs take to be absorbed, per glycaemic band. For each clean meal (no other carbs nearby, 4 hours of
 * readings), glucose with the insulin effect added back shows the carbs alone: it climbs and then levels off, and the time it takes
 * to reach 90% of that climb, divided by 0.9, is the absorption time. The result per band is the median, only with 3+ meals.
 * Returns { high, medium, low, unknown } each { minutes, n } or null.
 */
export function learnAbsorption(entries, readings, { isfMgdl, peak, dia, now }) {
  const sorted = prepareReadings(readings);
  const out = { high: [], medium: [], low: [], unknown: [] };
  if (!sorted.length || !(isfMgdl > 0)) return { high: null, medium: null, low: null, unknown: null };
  const list = (entries || []).filter(e => !isBasal(e) && Number.isFinite(e.ts)).sort((a, b) => a.ts - b.ts);
  for (const e of list) {
    const c = carbsOf(e);
    if (c < 15 || e.noInsulin || e.ts + 4 * HOUR > now) continue;
    if (list.some(o => o !== e && carbsOf(o) > 0 && o.ts > e.ts - 4 * HOUR && o.ts < e.ts + 4 * HOUR)) continue;
    const g0 = glucoseNear(sorted, e.ts, 10);
    if (g0 == null) continue;
    const curve = [];
    let have = 0;
    for (let m = 5; m <= 240; m += 5) {
      const t = e.ts + m * MIN, g = glucoseNear(sorted, t, 4);
      if (g != null) have++;
      curve.push({ m, v: g == null ? null : g - g0 + insulinDrop(entries, e.ts, t, isfMgdl, peak, dia) });
    }
    if (have / curve.length < 0.8) continue;
    const vals = curve.filter(p => p.v != null);
    const peakV = Math.max(...vals.map(p => p.v));
    if (peakV < 25) continue;                        // too small a rise to time reliably
    const hit = vals.find(p => p.v >= 0.9 * peakV);
    const minutes = Math.min(360, Math.max(45, hit.m / 0.9));
    const band = e.glycemicLoad && Number.isFinite(Number(e.glycemicLoad.value)) ? giBand(Number(e.glycemicLoad.value)) : "unknown";
    out[band].push(minutes);
  }
  const res = {};
  for (const k of Object.keys(out)) res[k] = out[k].length >= 3 ? { minutes: Math.round(median(out[k]) / 5) * 5, n: out[k].length } : null;
  res.counts = Object.fromEntries(Object.keys(out).map(k => [k, out[k].length]));
  return res;
}

/** Plain-English reading of the gap between your glucose and what insulin alone would give (units: the person's own). */
export function gapSummary(gapMgdl, minGap = 15) {
  if (!Number.isFinite(gapMgdl)) return { kind: "none" };
  if (gapMgdl >= minGap) return { kind: "above" };
  if (gapMgdl <= -minGap) return { kind: "below" };
  return { kind: "tracking" };
}
