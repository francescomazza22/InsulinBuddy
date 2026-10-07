import test from "node:test";
import assert from "node:assert/strict";
import { percentile, dailyPatternBuckets, daysSpanned, estimatedA1c, glucoseSummaryStats, timeInRangeBreakdown, glucoseGuideRows, TIME_IN_RANGE_BANDS } from "../../js/glucose-stats.js";
import { convertGlucose } from "../../js/calc.js";

// ------------------------------------------------------------- percentile
test("percentile: known values against a simple sorted array", () => {
  const arr = [10, 20, 30, 40, 50];
  assert.equal(percentile(arr, 0), 10);
  assert.equal(percentile(arr, 100), 50);
  assert.equal(percentile(arr, 50), 30);
  assert.equal(percentile(arr, 25), 20);
});
test("percentile: edge cases", () => {
  assert.equal(percentile([], 50), null);
  assert.equal(percentile([42], 10), 42);
  assert.equal(percentile([42], 90), 42);
});
test("percentile: interpolates between two values", () => {
  assert.equal(percentile([0, 10], 50), 5);
  assert.equal(percentile([0, 100], 25), 25);
});

// ------------------------------------------------------------- day helpers
const at = (y, mo, d, h, mi) => new Date(y, mo, d, h, mi).getTime();

test("daysSpanned counts distinct local calendar days", () => {
  const readings = [{ at: at(2026, 8, 1, 8, 0), mgdl: 100 }, { at: at(2026, 8, 1, 20, 0), mgdl: 110 }, { at: at(2026, 8, 2, 8, 0), mgdl: 105 }];
  assert.equal(daysSpanned(readings), 2);
  assert.equal(daysSpanned([]), 0);
});

test("estimatedA1c follows the published GMI formula", () => {
  assert.equal(Math.round(estimatedA1c(154) * 100) / 100, 6.99); // GMI's own published reference point (~154 mg/dL -> ~7%)
  assert.equal(estimatedA1c(null), null);
  assert.equal(estimatedA1c(NaN), null);
});

// ------------------------------------------------------------- bucketing
test("dailyPatternBuckets groups by time-of-day across multiple days", () => {
  const readings = [
    { at: at(2026, 8, 1, 8, 0), mgdl: 100 },
    { at: at(2026, 8, 2, 8, 0), mgdl: 120 },
    { at: at(2026, 8, 3, 8, 0), mgdl: 140 },
    { at: at(2026, 8, 1, 20, 0), mgdl: 90 }
  ];
  const buckets = dailyPatternBuckets(readings, 30);
  const morning = buckets.find(b => b.minute === 8 * 60);
  assert.equal(morning.count, 3);
  assert.equal(morning.p50, 120); // median of [100,120,140]
  const evening = buckets.find(b => b.minute === 20 * 60);
  assert.equal(evening.count, 1);
  assert.equal(buckets.every(b => b.count > 0), true, "empty buckets are omitted");
});

test("dailyPatternBuckets ignores invalid entries", () => {
  const buckets = dailyPatternBuckets([{ at: at(2026, 8, 1, 8, 0), mgdl: 100 }, { at: at(2026, 8, 1, 8, 5) }, { mgdl: 100 }, null], 30);
  assert.equal(buckets.length, 1);
  assert.equal(buckets[0].count, 1);
});

test("dailyPatternBuckets bucket count matches the requested granularity", () => {
  // one reading per hour across a whole day -> with 60-minute buckets, 24 distinct buckets
  const readings = Array.from({ length: 24 }, (_, h) => ({ at: at(2026, 8, 1, h, 0), mgdl: 100 + h }));
  const buckets = dailyPatternBuckets(readings, 60);
  assert.equal(buckets.length, 24);
});

// ------------------------------------------------------------- summary stats
test("glucoseSummaryStats computes average, GMI, and time-in-range", () => {
  const readings = [
    { at: at(2026, 8, 1, 8, 0), mgdl: 60 },   // low
    { at: at(2026, 8, 1, 9, 0), mgdl: 100 },  // in range
    { at: at(2026, 8, 1, 10, 0), mgdl: 150 }, // in range
    { at: at(2026, 8, 1, 11, 0), mgdl: 200 }  // high
  ];
  const s = glucoseSummaryStats(readings);
  assert.equal(s.count, 4);
  assert.equal(s.avgMgdl, 127.5);
  assert.equal(s.timeInRangePct, 50);
  assert.equal(s.timeLowPct, 25);
  assert.equal(s.timeHighPct, 25);
  assert.ok(s.gmi > 0);
});

test("glucoseSummaryStats handles no data gracefully", () => {
  const s = glucoseSummaryStats([]);
  assert.equal(s.count, 0);
  assert.equal(s.avgMgdl, null);
  assert.equal(s.gmi, null);
  assert.equal(s.timeInRangePct, null);
});

test("glucoseSummaryStats honors custom low/high thresholds", () => {
  const readings = [{ at: at(2026, 8, 1, 8, 0), mgdl: 65 }, { at: at(2026, 8, 1, 9, 0), mgdl: 65 }];
  assert.equal(glucoseSummaryStats(readings, { low: 60, high: 200 }).timeLowPct, 0);
  assert.equal(glucoseSummaryStats(readings, { low: 70, high: 200 }).timeLowPct, 100);
});

// ------------------------------------------------------ time-in-range bands
test("timeInRangeBreakdown sorts readings into the 5 standard ADA consensus bands", () => {
  const readings = [
    { at: 1, mgdl: 300 },  // very high
    { at: 2, mgdl: 200 },  // high
    { at: 3, mgdl: 120 },  // target
    { at: 4, mgdl: 120 },  // target
    { at: 5, mgdl: 60 },   // low
    { at: 6, mgdl: 40 }    // very low
  ];
  const b = timeInRangeBreakdown(readings);
  assert.equal(b.length, 5);
  assert.deepEqual(b.map(x => x.key), ["veryHigh", "high", "target", "low", "veryLow"]); // high-to-low order
  const byKey = Object.fromEntries(b.map(x => [x.key, x]));
  assert.equal(byKey.veryHigh.count, 1); assert.equal(Math.round(byKey.veryHigh.pct), 17);
  assert.equal(byKey.target.count, 2); assert.equal(Math.round(byKey.target.pct), 33);
  assert.equal(byKey.veryLow.count, 1);
});

test("timeInRangeBreakdown: band boundaries are inclusive at the edges (70 and 180 are Target)", () => {
  const b = timeInRangeBreakdown([{ at: 1, mgdl: 70 }, { at: 2, mgdl: 180 }, { at: 3, mgdl: 69 }, { at: 4, mgdl: 181 }]);
  const byKey = Object.fromEntries(b.map(x => [x.key, x]));
  assert.equal(byKey.target.count, 2);
  assert.equal(byKey.low.count, 1);
  assert.equal(byKey.high.count, 1);
});

test("timeInRangeBreakdown handles no data without dividing by zero", () => {
  const b = timeInRangeBreakdown([]);
  assert.ok(b.every(x => x.pct === 0 && x.count === 0));
});

test("timeInRangeBreakdown percentages always sum to ~100", () => {
  const readings = Array.from({ length: 37 }, (_, i) => ({ at: i, mgdl: 50 + i * 10 }));
  const b = timeInRangeBreakdown(readings);
  const total = b.reduce((s, x) => s + x.pct, 0);
  assert.ok(Math.abs(total - 100) < 0.01, total);
});

test("timeInRangeBreakdown accepts a custom band list", () => {
  const custom = [{ key: "hi", label: "Hi", low: 100, high: Infinity }, { key: "lo", label: "Lo", low: -Infinity, high: 99 }];
  const b = timeInRangeBreakdown([{ at: 1, mgdl: 150 }, { at: 2, mgdl: 50 }], custom);
  assert.equal(b.length, 2);
  assert.equal(b[0].count, 1); assert.equal(b[1].count, 1);
});

test("TIME_IN_RANGE_BANDS covers the full range with no gaps or overlaps", () => {
  const sorted = TIME_IN_RANGE_BANDS.slice().sort((a, b) => a.low - b.low);
  for (let i = 1; i < sorted.length; i++) assert.equal(sorted[i].low, sorted[i - 1].high + 1, `gap/overlap between ${sorted[i-1].key} and ${sorted[i].key}`);
});

// ------------------------------------------------------------- glucoseGuideRows
test("glucoseGuideRows: defaults to 40..400 mg/dL in steps of 10 (37 rows)", () => {
  const rows = glucoseGuideRows();
  assert.equal(rows.length, 37);
  assert.equal(rows[0].mgdl, 40);
  assert.equal(rows[rows.length - 1].mgdl, 400);
  for (let i = 1; i < rows.length; i++) assert.equal(rows[i].mgdl - rows[i - 1].mgdl, 10, `step before row ${i}`);
});

test("glucoseGuideRows: mmol/L matches known reference conversions", () => {
  const at = mg => glucoseGuideRows().find(r => r.mgdl === mg).mmol;
  assert.equal(at(40), 2.2);
  assert.equal(at(70), 3.9);   // the bottom of the target range
  assert.equal(at(100), 5.5);
  assert.equal(at(180), 10.0); // the top of the target range
  assert.equal(at(400), 22.2);
});

test("glucoseGuideRows: mmol/L is one decimal, always rising, and agrees with the app's own converter", () => {
  const rows = glucoseGuideRows();
  rows.forEach((r, i) => {
    assert.ok(Math.abs(r.mmol * 10 - Math.round(r.mmol * 10)) < 1e-9, `${r.mgdl} -> ${r.mmol} should be one decimal`);
    assert.ok(Math.abs(r.mmol - convertGlucose(r.mgdl, "mgdl", "mmol")) <= 0.05 + 1e-9, `${r.mgdl} disagrees with convertGlucose`);
    if (i > 0) assert.ok(r.mmol > rows[i - 1].mmol, `${r.mgdl} should be higher than the row before`);
  });
});

test("glucoseGuideRows: every row is tagged with the same band Time in Range would put it in", () => {
  const band = mg => glucoseGuideRows().find(r => r.mgdl === mg).band;
  assert.equal(band(40), "veryLow");
  assert.equal(band(50), "veryLow");
  assert.equal(band(60), "low");
  assert.equal(band(70), "target");
  assert.equal(band(180), "target");
  assert.equal(band(190), "high");
  assert.equal(band(250), "high");
  assert.equal(band(260), "veryHigh");
  assert.equal(band(400), "veryHigh");
  // and no row falls through the cracks
  assert.ok(glucoseGuideRows().every(r => TIME_IN_RANGE_BANDS.some(b => b.key === r.band)));
});

test("glucoseGuideRows: honours a custom range and step, and rejects nonsense", () => {
  assert.deepEqual(glucoseGuideRows(100, 120, 10).map(r => r.mgdl), [100, 110, 120]);
  assert.deepEqual(glucoseGuideRows(40, 55, 10).map(r => r.mgdl), [40, 50]);   // doesn't overshoot the end
  assert.deepEqual(glucoseGuideRows(40, 400, 0), []);
  assert.deepEqual(glucoseGuideRows(40, 400, -10), []);
  assert.deepEqual(glucoseGuideRows(400, 40, 10), []);
});
