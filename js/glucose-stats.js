import { MGDL_PER_MMOL } from "./calc.js";
import { dayKeyFromTs } from "./util.js";

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
    if (!r || typeof r.mgdl !== "number" || typeof r.at !== "number") continue;
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
    if (!r || typeof r.at !== "number") continue;
    days.add(dayKeyFromTs(r.at));
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
export const TIME_IN_RANGE_BANDS = [
  { key: "veryHigh", label: "Very High", low: 251, high: Infinity },
  { key: "high", label: "High", low: 181, high: 250 },
  { key: "target", label: "Target", low: 70, high: 180 },
  { key: "low", label: "Low", low: 54, high: 69 },
  { key: "veryLow", label: "Very Low", low: -Infinity, high: 53 }
];

/** Rows for a mg/dL <-> mmol/L reference table (default 40..400 in steps of 10). Each row carries the
 * standard band it falls in -- the same bands Time in Range uses -- so the table can colour-code itself
 * without re-deriving them, and always agrees with the charts. mmol/L uses the app's own conversion
 * constant, rounded to one decimal. Index-based rather than accumulating, so steps never drift. */
export function glucoseGuideRows(fromMgdl = 40, toMgdl = 400, step = 10) {
  if (!(step > 0) || toMgdl < fromMgdl) return [];
  const count = Math.floor((toMgdl - fromMgdl) / step + 1e-9) + 1;
  return Array.from({ length: count }, (_, i) => {
    const mgdl = fromMgdl + i * step;
    const band = TIME_IN_RANGE_BANDS.find(b => mgdl >= b.low && mgdl <= b.high);
    return { mgdl, mmol: Math.round((mgdl / MGDL_PER_MMOL) * 10) / 10, band: band ? band.key : null };
  });
}

/** What % of readings fall in each standard band. `bands` defaults to the ADA consensus bands
 * above, but accepts a custom list (same shape) for a different breakdown. */
export function timeInRangeBreakdown(readings, bands = TIME_IN_RANGE_BANDS) {
  const values = (readings || []).filter(r => r && typeof r.mgdl === "number").map(r => r.mgdl);
  const count = values.length;
  return bands.map(b => {
    const n = values.filter(v => v >= b.low && v <= b.high).length;
    return { key: b.key, label: b.label, low: b.low, high: b.high, count: n, pct: count === 0 ? 0 : (n / count) * 100 };
  });
}

/** Summary stats for a stretch of readings: average, estimated A1c, and time in/below/above
 * a range (70-180 mg/dL by default, the same clinical convention used elsewhere in the app). */
export function glucoseSummaryStats(readings, { low = 70, high = 180 } = {}) {
  const values = (readings || []).filter(r => r && typeof r.mgdl === "number").map(r => r.mgdl);
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
