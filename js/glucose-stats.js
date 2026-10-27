import { MGDL_PER_MMOL } from "./calc.js";

// A usable reading has a real time and a real value (2.68.4): a reading whose value is NaN used to be counted as IN RANGE
// (NaN is neither below 70 nor above 180), lifting time in range and blanking the average.
const usable = r => !!r && Number.isFinite(r.mgdl) && Number.isFinite(r.at);

// Pure glucose statistics for the History > Glucose tab. Takes plain readings
// ({ at: epoch-ms, mgdl }) so it's fully testable without any DOM, network, or Date-object
// pitfalls -- callers own the actual data fetching.

/** Linear-interpolation percentile (the common convention for continuous data), 0-100. */
export function percentile(sortedValues, p) {
  if (!sortedValues || sortedValues.length === 0) return null;
  if (sortedValues.length === 1) return sortedValues[0];
  const idx = (p / 100) * (sortedValues.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return sortedValues[lo];
  return sortedValues[lo] + (sortedValues[hi] - sortedValues[lo]) * (idx - lo);
}

/**
 * Buckets readings by time-of-day (minute-of-day, wrapping every 24h) across however many
 * days they span, then computes percentiles per bucket -- the shape a "daily pattern" band
 * chart needs. bucketMinutes must divide 1440 evenly (default 30 -> 48 buckets/day).
 * Empty buckets are omitted (no readings fell in that slot across the whole range).
 */
export function dailyPatternBuckets(readings, bucketMinutes = 30) {
  const n = Math.round(1440 / bucketMinutes);
  const groups = Array.from({ length: n }, () => []);
  for (const r of readings || []) {
    if (!usable(r)) continue;
    const d = new Date(r.at);
    const minuteOfDay = d.getHours() * 60 + d.getMinutes();
    const bucket = Math.min(n - 1, Math.floor(minuteOfDay / bucketMinutes));
    groups[bucket].push(r.mgdl);
  }
  const out = [];
  groups.forEach((vals, i) => {
    if (vals.length === 0) return;
    const sorted = vals.slice().sort((a, b) => a - b);
    out.push({
      minute: i * bucketMinutes,
      count: sorted.length,
      p5: percentile(sorted, 5), p10: percentile(sorted, 10), p25: percentile(sorted, 25), p50: percentile(sorted, 50),
      p75: percentile(sorted, 75), p90: percentile(sorted, 90), p95: percentile(sorted, 95)
    });
  });
  return out;
}

/** How many distinct calendar days (local time) the readings span -- used to decide whether
 * there's enough data for a meaningful pattern (CGM reports conventionally want >= 5 days). */
export function daysSpanned(readings) {
  const days = new Set();
  for (const r of readings || []) {
    if (!usable(r)) continue;
    const d = new Date(r.at);
    days.add(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
  }
  return days.size;
}

/** GMI (Glucose Management Indicator): a published, standard estimate of A1c from mean
 * glucose (Bergenstal et al. 2018) -- informational only, not a substitute for a lab A1c. */
export function estimatedA1c(meanMgdl) {
  if (meanMgdl == null || !Number.isFinite(meanMgdl)) return null;
  return 3.31 + 0.02392 * meanMgdl;
}

// The standard ADA/ATTD consensus "time in ranges" bands (Battelino et al. 2019), the same
// breakdown Dexcom Clarity and FreeStyle LibreLink reports use. Ordered high-to-low to match
// how those reports are conventionally displayed (very high at the top).
// `test` decides membership (2.68.4) so the bands meet with no gaps for readings with decimals (69.5, 180.4, 53.5 used to fall
// in no band, so the percentages didn't add up to 100); for whole numbers it is exactly the low-high labels. The edges match
// glucoseSummaryStats and extendedGlucoseStats: under 70 is low, over 180 is high.
export const TIME_IN_RANGE_BANDS = [
  { key: "veryHigh", label: "Very High", low: 251, high: Infinity, test: v => v > 250 },
  { key: "high", label: "High", low: 181, high: 250, test: v => v > 180 && v <= 250 },
  { key: "target", label: "Target", low: 70, high: 180, test: v => v >= 70 && v <= 180 },
  { key: "low", label: "Low", low: 54, high: 69, test: v => v >= 54 && v < 70 },
  { key: "veryLow", label: "Very Low", low: -Infinity, high: 53, test: v => v < 54 }
];
const inBand = (v, b) => (typeof b.test === "function" ? b.test(v) : v >= b.low && v <= b.high);

/** Rows for a mg/dL <-> mmol/L reference table (default 40..400 in steps of 10). Each row carries the
 * standard band it falls in -- the same bands Time in Range uses -- so the table can colour-code itself
 * without re-deriving them, and always agrees with the charts. mmol/L uses the app's own conversion
 * constant, rounded to one decimal. Index-based rather than accumulating, so steps never drift. */
export function glucoseGuideRows(fromMgdl = 40, toMgdl = 400, step = 10) {
  if (!(step > 0) || toMgdl < fromMgdl) return [];
  const count = Math.floor((toMgdl - fromMgdl) / step + 1e-9) + 1;
  return Array.from({ length: count }, (_, i) => {
    const mgdl = fromMgdl + i * step;
    const band = TIME_IN_RANGE_BANDS.find(b => inBand(mgdl, b));
    return { mgdl, mmol: Math.round((mgdl / MGDL_PER_MMOL) * 10) / 10, band: band ? band.key : null };
  });
}

/** What % of readings fall in each standard band. `bands` defaults to the ADA consensus bands
 * above, but accepts a custom list (same shape) for a different breakdown. */
export function timeInRangeBreakdown(readings, bands = TIME_IN_RANGE_BANDS) {
  const values = (readings || []).filter(usable).map(r => r.mgdl);
  const count = values.length;
  return bands.map(b => {
    const n = values.filter(v => inBand(v, b)).length;
    return { key: b.key, label: b.label, low: b.low, high: b.high, count: n, pct: count === 0 ? 0 : (n / count) * 100 };
  });
}

/** Summary stats for a stretch of readings: average, estimated A1c, and time in/below/above
 * a range (70-180 mg/dL by default, the same clinical convention used elsewhere in the app). */
export function glucoseSummaryStats(readings, { low = 70, high = 180 } = {}) {
  const values = (readings || []).filter(usable).map(r => r.mgdl);
  const count = values.length;
  if (count === 0) return { count: 0, days: 0, avgMgdl: null, gmi: null, timeInRangePct: null, timeLowPct: null, timeHighPct: null };
  const avgMgdl = values.reduce((s, v) => s + v, 0) / count;
  const lowCount = values.filter(v => v < low).length;
  const highCount = values.filter(v => v > high).length;
  return {
    count,
    days: daysSpanned(readings),
    avgMgdl,
    gmi: estimatedA1c(avgMgdl),
    timeInRangePct: ((count - lowCount - highCount) / count) * 100,
    timeLowPct: (lowCount / count) * 100,
    timeHighPct: (highCount / count) * 100
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// The full set of figures a FreeStyle Libre (LibreView AGP) report and Gluroo show, worked out from the same readings.
// Everything here is plain arithmetic on what is already loaded: nothing runs until the Statistics view is opened.

const sortedByTime = readings => (readings || []).filter(usable).sort((a, b) => a.at - b.at);
const mean = a => a.reduce((s, v) => s + v, 0) / a.length;

/** The usual gap between readings in minutes (the median of the gaps up to an hour): 5 for most CGMs, 15 for Libre. */
export function readingIntervalMinutes(readings) {
  const s = sortedByTime(readings), gaps = [];
  for (let i = 1; i < s.length; i++) { const g = (s[i].at - s[i - 1].at) / 60000; if (g > 0 && g <= 60) gaps.push(g); }
  if (gaps.length === 0) return 15;
  gaps.sort((a, b) => a - b);
  return Math.max(1, Math.round(percentile(gaps, 50)));
}

/** ADAG estimated average glucose -> eA1c, the figure Gluroo and older meters label "A1c" (GMI above is the CGM-specific one). */
export function eA1c(meanMgdl) {
  if (meanMgdl == null || !Number.isFinite(meanMgdl)) return null;
  return (meanMgdl + 46.7) / 28.7;
}

/** Stretches where glucose stayed beyond a threshold for at least minMinutes (the consensus counts 15). A reading stands for one
 * interval, and a gap longer than two intervals ends the stretch (the sensor was off, so nothing is assumed). */
export function glucoseEvents(readings, test, { minMinutes = 15, intervalMin } = {}) {
  const s = sortedByTime(readings);
  const step = intervalMin || readingIntervalMinutes(s), maxGap = step * 2 * 60000;
  const events = [];
  let start = null, last = null;
  const close = () => { if (start != null) { const mins = (last - start) / 60000 + step; if (mins >= minMinutes) events.push({ at: start, minutes: mins }); } start = null; };
  for (const r of s) {
    if (test(r.mgdl)) {
      if (start != null && r.at - last > maxGap) close();
      if (start == null) start = r.at;
      last = r.at;
    } else close();
  }
  close();
  return { count: events.length, avgMinutes: events.length ? mean(events.map(e => e.minutes)) : 0, longestMinutes: events.length ? Math.max(...events.map(e => e.minutes)) : 0, events };
}

/**
 * Libre/AGP-style statistics. The ranges are the international consensus ones: very low < 54, low 54-69, target 70-180,
 * tight 70-140, high 181-250, very high > 250 (mg/dL). Sensor use is how much of the time between the first and last reading
 * actually has a reading; the AGP report wants at least 70% of 14 days, so `enough` says whether the picture is trustworthy.
 */
export function extendedGlucoseStats(readings, { wantDays = 14 } = {}) {
  const s = sortedByTime(readings);
  const count = s.length;
  if (count === 0) return { count: 0 };
  const values = s.map(r => r.mgdl), sorted = values.slice().sort((a, b) => a - b);
  const avg = mean(values);
  const sd = Math.sqrt(mean(values.map(v => (v - avg) ** 2)));
  const pct = fn => (values.filter(fn).length / count) * 100;
  const intervalMin = readingIntervalMinutes(s);
  const spanMin = (s[count - 1].at - s[0].at) / 60000 + intervalMin;
  const expected = Math.max(1, spanMin / intervalMin);
  const days = daysSpanned(s);
  const sensorActivePct = Math.min(100, (count / expected) * 100);
  const veryLow = glucoseEvents(s, v => v < 54, { intervalMin }), low = glucoseEvents(s, v => v < 70, { intervalMin });
  const veryHigh = glucoseEvents(s, v => v > 250, { intervalMin });
  const perDay = dailyStats(s);
  return {
    count, days, intervalMin, avgMgdl: avg, medianMgdl: percentile(sorted, 50), sdMgdl: sd, cvPct: avg > 0 ? (sd / avg) * 100 : null,
    minMgdl: sorted[0], maxMgdl: sorted[count - 1], gmi: estimatedA1c(avg), eA1c: eA1c(avg),
    pct: { veryLow: pct(v => v < 54), low: pct(v => v >= 54 && v < 70), target: pct(v => v >= 70 && v <= 180), tight: pct(v => v >= 70 && v <= 140), high: pct(v => v > 180 && v <= 250), veryHigh: pct(v => v > 250), belowRange: pct(v => v < 70), aboveRange: pct(v => v > 180) },
    sensorActivePct, readingsPerDay: count / Math.max(1, days),
    enough: days >= wantDays * 0.5 && sensorActivePct >= 70,
    lowEvents: { count: low.count, avgMinutes: low.avgMinutes, longestMinutes: low.longestMinutes },
    veryLowEvents: { count: veryLow.count, avgMinutes: veryLow.avgMinutes, longestMinutes: veryLow.longestMinutes },
    veryHighEvents: { count: veryHigh.count, avgMinutes: veryHigh.avgMinutes },
    meanDailyRangeMgdl: perDay.length ? mean(perDay.map(d => d.maxMgdl - d.minMgdl)) : null,
    cvOnTarget: avg > 0 ? (sd / avg) * 100 <= 36 : null
  };
}

/** One row per calendar day (local time), oldest first, with a small set of points for a sparkline (at most `maxPoints`). */
export function dailyStats(readings, { maxPoints = 96 } = {}) {
  const s = sortedByTime(readings), byDay = new Map();
  for (const r of s) { const d = new Date(r.at), k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(r); }
  return [...byDay.entries()].map(([day, rs]) => {
    const v = rs.map(r => r.mgdl), n = v.length, avg = mean(v), stride = Math.max(1, Math.ceil(n / maxPoints));
    const points = rs.filter((_, i) => i % stride === 0).map(r => { const d = new Date(r.at); return { minute: d.getHours() * 60 + d.getMinutes(), mgdl: r.mgdl }; });
    return { day, count: n, avgMgdl: avg, minMgdl: Math.min(...v), maxMgdl: Math.max(...v), targetPct: (v.filter(x => x >= 70 && x <= 180).length / n) * 100, lowPct: (v.filter(x => x < 70).length / n) * 100, highPct: (v.filter(x => x > 180).length / n) * 100, points };
  });
}

/**
 * Round numbers for a glucose chart's value scale, in the person's own unit: every 20/25/50/100 mg/dL or every
 * 1/2/3/5 mmol/L, whichever gives at most `maxTicks` labels (7, so mmol/L can count in 2s) between the axis ends (given in mg/dL). Each tick carries
 * its mg/dL position (for plotting) and its label in the display unit.
 * @returns {{mgdl:number, label:string}[]}
 */
export function glucoseAxisTicks(minMgdl, maxMgdl, units = "mgdl", maxTicks = 7) {
  if (!(maxMgdl > minMgdl)) return [];
  const mmol = units === "mmol";
  const lo = mmol ? minMgdl / MGDL_PER_MMOL : minMgdl, hi = mmol ? maxMgdl / MGDL_PER_MMOL : maxMgdl;
  const steps = mmol ? [1, 2, 3, 5] : [20, 25, 50, 100];
  const count = s => Math.floor(hi / s + 1e-9) - Math.ceil(lo / s - 1e-9) + 1;
  const step = steps.find(s => count(s) <= maxTicks) || steps[steps.length - 1];
  const out = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9; v += step) {
    if (v <= 0) continue;
    out.push({ mgdl: mmol ? v * MGDL_PER_MMOL : v, label: String(v) });
  }
  return out;
}
