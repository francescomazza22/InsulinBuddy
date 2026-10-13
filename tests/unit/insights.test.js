import test from "node:test";
import assert from "node:assert/strict";
import { median, quantile, glucoseAt, postMealCurves, outcomeByBracket, foodImpact, correctionEffectiveness, iobStacking, overnightStats, weekdayWeekend, lowTreatmentUsual, lastTimesFor, isfToMgdl, readingsBetween, sortReadings } from "../../js/insights.js";

const MIN = 60000, H = 3600000;
const T0 = new Date(2026, 9, 5, 12, 0).getTime();          // Mon 5 Oct 2026, 12:00 local
const day = n => n * 24 * H;
// a reading every 5 min between from and to, glucose = f(minutes since from)
const series = (from, to, f) => { const out = []; for (let t = from; t <= to; t += 5 * MIN) out.push({ at: t, mgdl: f((t - from) / MIN) }); return out; };
const meal = (id, ts, o = {}) => ({ id, ts, mealType: "lunch", items: [{ refType: "food", refId: "f1", name: "Pasta", grams: 100, carbs: 50 }], totalCarbs: 50, mealDose: 5, correctionDose: 0, noInsulin: false, ratioLabel: "Lunch", ratioValue: 10, ...o });

test("median and quantile", () => {
  assert.equal(median([3, 1, 2]), 2); assert.equal(median([1, 2, 3, 4]), 2.5); assert.equal(median([]), null);
  assert.equal(quantile([1, 2, 3, 4, 5], 0.5), 3); assert.equal(quantile([0, 10], 0.25), 2.5);
});

test("glucoseAt: nearest reading, only within tolerance", () => {
  const r = sortReadings([{ at: 0, mgdl: 100 }, { at: 10 * MIN, mgdl: 120 }]);
  assert.equal(glucoseAt(r, 4 * MIN, 10), 100); assert.equal(glucoseAt(r, 6 * MIN, 10), 120);
  assert.equal(glucoseAt(r, 60 * MIN, 10), null); assert.equal(glucoseAt([], 0), null);
  assert.equal(readingsBetween(r, 0, 5 * MIN).length, 1);
});

test("post-meal curve: median per step, grouped by bracket, needs a baseline", () => {
  // glucose 100 at the injection, rising 1 mg/dL per minute to 160 at +60, then flat
  const f = m => 100 + Math.min(60, m);
  const entries = [0, 1, 2].map(i => meal("m" + i, T0 + day(i)));
  const readings = [0, 1, 2].flatMap(i => series(T0 + day(i) - 30 * MIN, T0 + day(i) + 5 * H, m => f(m - 30)));
  const res = postMealCurves(entries, readings, { hours: 4, stepMin: 15 });
  const all = res.groups.find(g => g.label === "All meals");
  assert.equal(res.meals, 3); assert.equal(all.count, 3); assert.equal(all.enough, true);
  assert.equal(all.points[0].p50, 100); assert.equal(all.points[4].p50, 160); assert.equal(all.points[16].p50, 160);
  assert.ok(res.groups.some(g => g.label === "Lunch"));
  // no readings near the injection -> the meal is ignored
  assert.equal(postMealCurves([meal("x", T0 + day(10))], readings).meals, 0);
});

test("outcome by bracket: low / in / high at +3 h", () => {
  const mk = (i, end) => ({ e: meal("o" + i, T0 + day(i)), r: series(T0 + day(i) - 10 * MIN, T0 + day(i) + 5 * H, m => (m < 190 ? 120 : end)) });
  const cases = [mk(0, 60), mk(1, 120), mk(2, 250), mk(3, 120)];
  const res = outcomeByBracket(cases.map(c => c.e), cases.flatMap(c => c.r));
  assert.equal(res.total, 4);
  const row = res.rows[0];
  assert.deepEqual([row.low, row.inRange, row.high], [1, 2, 1]);
  assert.equal(res.all.n, 4);
});

test("food impact: attributes rise only to the dominant food, needs two meals", () => {
  const rise = m => 100 + Math.min(80, m * 1.0);   // peaks at 180 -> rise 80
  const entries = [0, 1].map(i => meal("p" + i, T0 + day(i)));
  entries.push(meal("mixed", T0 + day(2), { items: [{ refType: "food", name: "Pasta", carbs: 20 }, { refType: "food", name: "Bread", carbs: 30 }], totalCarbs: 50 }));
  const readings = [0, 1, 2].flatMap(i => series(T0 + day(i) - 5 * MIN, T0 + day(i) + 5 * H, m => rise(m - 5)));
  const res = foodImpact(entries, readings);
  const pasta = res.rows.find(r => r.name === "Pasta");
  assert.equal(pasta.n, 2); assert.ok(Math.abs(pasta.avgRise - 80) < 1.5, String(pasta.avgRise));
  assert.equal(res.rows.find(r => r.name === "Bread"), undefined);
  assert.equal(res.mostLows.length, 0);
});

test("correction effectiveness: isolated corrections only, per unit", () => {
  const corr = { id: "c1", ts: T0, mealType: "correction", items: [], totalCarbs: 0, mealDose: 0, correctionDose: 2, noInsulin: false };
  const readings = series(T0 - 10 * MIN, T0 + 5 * H, m => (m < 10 ? 200 : 200 - ((m - 10) / 170) * 100)); // 100 lower by +3h
  const res = correctionEffectiveness([corr], readings, { isfMgdl: 50 });
  assert.equal(res.n, 1); assert.ok(Math.abs(res.medianPerUnit - 50) < 5, String(res.medianPerUnit));
  // a meal within 4 h makes it not isolated
  assert.equal(correctionEffectiveness([corr, meal("m", T0 + 2 * H)], readings).n, 0);
  // an earlier dose within 3 h too
  assert.equal(correctionEffectiveness([corr, meal("m", T0 - H)], readings).n, 0);
  assert.equal(isfToMgdl(2.8, "mmol") > 50, true); assert.equal(isfToMgdl(50, "mgdl"), 50);
});

test("IOB stacking splits meals by an earlier dose in the last 4 h", () => {
  const a = meal("a", T0), b = meal("b", T0 + 2 * H), c = meal("c", T0 + day(1));
  const readings = series(T0 - 10 * MIN, T0 + day(1) + 5 * H, () => 120);
  const res = iobStacking([a, b, c], readings);
  assert.equal(res.stacked.n, 1); assert.equal(res.clean.n, 2); assert.equal(res.stacked.avgPriorUnits, 5);
});

test("overnight: drift, quiet nights only, linked to the last basal", () => {
  const d0 = new Date(2026, 9, 5).getTime();
  const night = (n, start, end) => series(d0 + day(n), d0 + day(n) + 6 * H + 30 * MIN, m => start + ((end - start) * Math.min(m, 360)) / 360);
  const readings = [...night(1, 100, 130), ...night(2, 110, 110), ...night(3, 120, 60)];
  const basal = [{ id: "b1", ts: d0 + day(1) - 4 * H, entryType: "basal", mealType: "basal", basalDose: 20, totalCarbs: 0 }];
  // night 2 is disturbed by a late snack at 22:30 the evening before (within 3 h of 00:00 start)
  const snack = meal("s", d0 + day(2) - 90 * MIN);
  const res = overnightStats([...basal, snack], readings);
  assert.equal(res.n, 2, JSON.stringify(res.nights.map(n => n.date)));
  const n1 = res.nights.find(n => n.date === d0 + day(1));
  assert.ok(Math.abs(n1.drift - 30) < 3); assert.equal(n1.basal, 20);
  assert.equal(res.lowNights, 1);
  assert.equal(res.byBasal.length, 1); assert.equal(res.byBasal[0].dose, 20);
});

test("weekday vs weekend and activity ratios", () => {
  const sat = new Date(2026, 9, 10, 12).getTime();           // Saturday
  const entries = [meal("w1", T0), meal("w2", T0 + day(1)), meal("e1", sat), meal("sp", T0 + day(2), { ratioLabel: "Sport", ratioValue: 18 })];
  const readings = series(T0 - H, sat + 5 * H, () => 150);
  const res = weekdayWeekend(entries, readings, { activityRatios: [{ name: "Sport", ratio: 18 }] });
  assert.equal(res.weekend.days, 1); assert.equal(res.weekday.days, 3); assert.equal(res.weekend.carbsPerDay, 50);
  assert.equal(res.activity.length, 1); assert.equal(res.activity[0].avgRatio, 18); assert.equal(res.everyday.avgRatio, 10);
});

test("low-treatment usual: median of your own treatments", () => {
  const lows = [15, 20, 15, 30].map((g, i) => meal("l" + i, T0 + i * H, { noInsulin: true, mealDose: 0, totalCarbs: g }));
  const r = lowTreatmentUsual([...lows, meal("big", T0 + 9 * H)]);
  assert.equal(r.n, 4); assert.equal(r.medianCarbs, 17.5); assert.equal(r.minCarbs, 15); assert.equal(r.maxCarbs, 30);
  assert.equal(lowTreatmentUsual([]).medianCarbs, null);
});

test("last times: newest first, with the glucose 3 h on", () => {
  const entries = [0, 1, 2, 3].map(i => meal("k" + i, T0 + day(i)));
  const readings = series(T0 - H, T0 + day(3) + 5 * H, m => 100);
  const res = lastTimesFor(entries, readings, { refId: "f1" }, 3);
  assert.equal(res.length, 3); assert.equal(res[0].ts, T0 + day(3)); assert.equal(res[0].dose, 5);
  assert.equal(lastTimesFor(entries, readings, { name: "pasta" }, 2).length, 2);
  assert.equal(lastTimesFor(entries, readings, { name: "nothing" }).length, 0);
});
