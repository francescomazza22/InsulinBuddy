import test from "node:test";
import assert from "node:assert/strict";
import { extendedGlucoseStats, glucoseEvents, readingIntervalMinutes, eA1c, dailyStats } from "../../js/glucose-stats.js";
import { insulinStats } from "../../js/history.js";

const T0 = new Date(2026, 9, 1, 0, 0).getTime(), MIN = 60000;
// Readings every `step` minutes from a list of values
const series = (vals, step = 15, t0 = T0) => vals.map((mgdl, i) => ({ at: t0 + i * step * MIN, mgdl }));

test("interval is the usual gap (15 for Libre, 5 for most others)", () => {
  assert.equal(readingIntervalMinutes(series([100, 110, 120, 130], 15)), 15);
  assert.equal(readingIntervalMinutes(series([100, 110, 120, 130], 5)), 5);
});
test("eA1c uses the ADAG formula and GMI stays separate", () => {
  assert.ok(Math.abs(eA1c(154) - 7.0) < 0.01);
  const s = extendedGlucoseStats(series([154, 154, 154, 154]));
  assert.ok(Math.abs(s.eA1c - 7.0) < 0.01 && Math.abs(s.gmi - (3.31 + 0.02392 * 154)) < 1e-9);
});
test("mean, median, SD, CV, min and max", () => {
  const s = extendedGlucoseStats(series([100, 120, 140, 160, 180]));
  assert.equal(s.avgMgdl, 140); assert.equal(s.medianMgdl, 140); assert.equal(s.minMgdl, 100); assert.equal(s.maxMgdl, 180);
  assert.ok(Math.abs(s.sdMgdl - Math.sqrt(800)) < 1e-9);
  assert.ok(Math.abs(s.cvPct - (Math.sqrt(800) / 140) * 100) < 1e-9);
  assert.equal(s.cvOnTarget, true);
});
test("time in ranges adds up to 100 and tight range is 70-140", () => {
  const s = extendedGlucoseStats(series([50, 60, 100, 130, 150, 200, 260, 300]));
  const p = s.pct;
  assert.equal(p.veryLow, 12.5); assert.equal(p.low, 12.5); assert.equal(p.target, 37.5); assert.equal(p.tight, 25); assert.equal(p.high, 12.5); assert.equal(p.veryHigh, 25);
  assert.ok(Math.abs(p.veryLow + p.low + p.target + p.high + p.veryHigh - 100) < 1e-9);
  assert.equal(p.belowRange, 25); assert.equal(p.aboveRange, 37.5);
});
test("sensor use: a full day of 15-minute readings is 100%, half of them is about 50%", () => {
  const full = extendedGlucoseStats(series(Array(96).fill(110), 15));
  assert.equal(Math.round(full.sensorActivePct), 100); assert.equal(Math.round(full.readingsPerDay), 96);
  const withHole = series(Array(96).fill(110), 15).filter((_, i) => i < 24 || i >= 72);   // 12 hours missing in the middle
  const h = extendedGlucoseStats(withHole).sensorActivePct;
  assert.ok(h > 45 && h < 55, String(h));
});
test("low events need 15 minutes, a gap ends the event, and very low is counted on its own", () => {
  const r = series([100, 65, 60, 100, 100, 50, 100, 100], 15);
  const low = glucoseEvents(r, v => v < 70);
  assert.equal(low.count, 2); assert.equal(low.longestMinutes, 30);
  assert.equal(glucoseEvents(r, v => v < 54).count, 1);
  const brief = series([100, 65, 100, 100], 5);
  assert.equal(glucoseEvents(brief, v => v < 70).count, 0, "one 5-minute reading is under 15 minutes");
  const gapped = [{ at: T0, mgdl: 60 }, { at: T0 + 240 * MIN, mgdl: 60 }];
  assert.equal(glucoseEvents(gapped, v => v < 70, { intervalMin: 15 }).count, 2, "a long gap does not join two lows into one");
});
test("daily rows split by local day with a capped set of points", () => {
  const d1 = series(Array(96).fill(100), 15), d2 = series(Array(96).fill(200), 15, T0 + 24 * 60 * MIN);
  const rows = dailyStats([...d2, ...d1], { maxPoints: 24 });
  assert.equal(rows.length, 2); assert.equal(rows[0].avgMgdl, 100); assert.equal(rows[1].highPct, 100); assert.ok(rows[0].points.length <= 24);
});
test("no readings: nothing to report", () => assert.deepEqual(extendedGlucoseStats([]), { count: 0 }));

const NOW = Date.now(), DAY = 86400000;
const meal = (i, over = {}) => ({ id: "m" + i, ts: NOW - i * 3600000, mealType: "lunch", totalCarbs: 50, mealDose: 5, correctionDose: 0, noInsulin: false, ...over });
test("insulin stats: split, per meal, effective ratio, corrections and reductions", () => {
  const h = [meal(1), meal(2, { correctionDose: 2 }), meal(3, { mealDose: 6, correctionDose: -1 }),
    { id: "b1", ts: NOW - 1000, entryType: "basal", mealType: "basal", basalDose: 20 },
    meal(4, { noInsulin: true, mealDose: 0, totalCarbs: 15 })];
  const s = insulinStats(h, NOW - DAY);
  assert.equal(s.avgDailyBolus, 5 + 7 + 5); assert.equal(s.avgDailyBasal, 20); assert.equal(s.tdd, 37);
  assert.equal(Math.round(s.basalPct), 54); assert.equal(Math.round(s.bolusPct), 46);
  assert.equal(s.mealsPerDay, 3); assert.equal(Math.round(s.avgMealBolus * 100) / 100, 5.33);
  assert.equal(Math.round(s.effectiveCarbRatio * 10) / 10, 9.4);
  assert.equal(s.correctionCount, 1); assert.equal(s.reductionCount, 1); assert.equal(s.largestDose, 7);
  assert.equal(s.lowsTreated, 1); assert.equal(s.avgLowCarbs, 15);
});
test("insulin stats without basal logged leave the split empty", () => {
  const s = insulinStats([meal(1)], NOW - DAY);
  assert.equal(s.basalPct, null); assert.equal(s.tdd, 5);
});
