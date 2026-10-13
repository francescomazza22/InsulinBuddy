import test from "node:test";
import assert from "node:assert/strict";
import { iobFraction } from "../../js/calc.js";
import { insulinDrop, expectedFromInsulin, observedCarbs, cobAt, projectGlucose, learnAbsorption, prepareReadings, glucoseNear, carbEffectPerGram, gapSummary } from "../../js/glucose-model.js";

const MIN = 60000, HOUR = 3600000;
const ISF = 50, PEAK = 75, DIA = 360, RATIO = 10;
const T0 = Date.UTC(2026, 9, 1, 12, 0, 0);
// a meal of C grams with C/RATIO units, glucose built from exact linear absorption over `T` minutes
function scenario({ C = 60, T = 120, g0 = 110, hours = 5, ts = T0, extraRise = 0 }) {
  const dose = C / RATIO;
  const entry = { ts, totalCarbs: C, mealDose: dose, correctionDose: 0, ratioValue: RATIO, glycemicLoad: { value: 75 } };
  const readings = [];
  for (let m = -30; m <= hours * 60; m += 5) {
    const t = ts + m * MIN;
    const absorbed = m <= 0 ? 0 : Math.min(C, C * (m / T));
    const g = g0 + (ISF / RATIO) * absorbed - (m <= 0 ? 0 : dose * ISF * (1 - iobFraction(m, PEAK, DIA))) + extraRise;
    readings.push({ at: t, mgdl: g });
  }
  return { entry, entries: [entry], readings };
}
const settings = (absMin = 120) => ({ isfMgdl: ISF, peak: PEAK, dia: DIA, absMinutes: () => absMin, fallbackRatio: RATIO });

test("insulin drop: the whole dose over DIA is dose x ISF, and nothing before the dose", () => {
  const e = { ts: T0, mealDose: 2, correctionDose: 0 };
  assert.ok(Math.abs(insulinDrop([e], T0, T0 + DIA * MIN, ISF, PEAK, DIA) - 100) < 0.01);
  assert.equal(insulinDrop([e], T0 - HOUR, T0, ISF, PEAK, DIA), 0);
  const half = insulinDrop([e], T0, T0 + 120 * MIN, ISF, PEAK, DIA);
  assert.ok(half > 20 && half < 100);
  assert.equal(insulinDrop([{ ts: T0, entryType: "basal", mealDose: 5 }], T0, T0 + HOUR, ISF, PEAK, DIA), 0, "basal is ignored");
});

test("expected-from-insulin: glucose that only moves with insulin tracks the expected line, and a carb rise shows as a positive gap", () => {
  const s = scenario({ C: 0.0001 });   // effectively insulin only, near-zero carbs
  const e = { ...s.entry, totalCarbs: 1, mealDose: 2 };
  const readings = []; for (let m = -30; m <= 180; m += 5) readings.push({ at: T0 + m * MIN, mgdl: 140 - (m <= 0 ? 0 : 2 * ISF * (1 - iobFraction(m, PEAK, DIA))) });
  const r = expectedFromInsulin([e], readings, { isfMgdl: ISF, peak: PEAK, dia: DIA, now: T0 + 120 * MIN });
  assert.ok(r && Math.abs(r.now.gap) < 1.5, JSON.stringify(r && r.now));
  const carby = scenario({ C: 60, T: 120 });
  const r2 = expectedFromInsulin(carby.entries, carby.readings, { isfMgdl: ISF, peak: PEAK, dia: DIA, now: T0 + 120 * MIN });
  assert.ok(r2.now.gap > 150, "60 g at 5 per g is a 300 mg/dL rise, less nothing: gap " + r2.now.gap);
  assert.equal(gapSummary(r2.now.gap).kind, "above");
  assert.equal(gapSummary(-30).kind, "below");
  assert.equal(gapSummary(5).kind, "tracking");
  assert.equal(expectedFromInsulin(carby.entries, [], { isfMgdl: ISF, peak: PEAK, dia: DIA, now: T0 }), null);
});

test("observed carbs: a meal absorbed at the usual pace matches the plain model", () => {
  const s = scenario({ C: 60, T: 120 });
  const now = T0 + 60 * MIN;
  const o = observedCarbs(s.entries, s.readings.filter(r => r.at <= now), settings(120), now);
  assert.equal(o.observed, true);
  assert.ok(Math.abs(o.cob - 30) < 4, "about half left at 60 of 120 min: " + o.cob);
  assert.ok(Math.abs(o.cob - o.modelCob) < 4);
});

test("observed carbs: a fast meal (done in 60 min) is seen as fast even though the model says 180 min", () => {
  const s = scenario({ C: 60, T: 60 });
  const now = T0 + 60 * MIN;
  const o = observedCarbs(s.entries, s.readings.filter(r => r.at <= now), settings(180), now);
  assert.ok(o.modelCob > 35, "the plain model still thinks " + o.modelCob);
  assert.ok(o.cob < 10, "but the readings show it is nearly all absorbed: " + o.cob);
  assert.ok(o.meals[0].paceVsUsual > 1.3);
});

test("observed carbs: a slow meal (240 min) is seen as slow, and capped at 1.5 x usual", () => {
  const s = scenario({ C: 60, T: 240 });
  const now = T0 + 90 * MIN;
  const o = observedCarbs(s.entries, s.readings.filter(r => r.at <= now), settings(120), now);
  assert.ok(o.cob > 25, "still lots left after 90 min: " + o.cob);
  const late = observedCarbs(s.entries, s.readings, settings(120), T0 + 4.5 * HOUR);
  assert.ok(late.cob <= 0.5, "past 1.5 x 120 min nothing is left on board: " + late.cob);
});

test("observed carbs: with no readings it falls back to the plain model and says so", () => {
  const s = scenario({ C: 60, T: 120 });
  const now = T0 + 60 * MIN;
  const o = observedCarbs(s.entries, [], settings(120), now);
  assert.equal(o.observed, false);
  assert.ok(Math.abs(o.cob - 30) < 0.5);
});

test("a flat glucose after a dosed meal means the carbs were covered, not that none were absorbed", () => {
  // insulin exactly cancels the carbs, as it should for a well-matched dose
  const s = scenario({ C: 60, T: 120 });
  const flatReadings = []; for (let m = -30; m <= 300; m += 5) flatReadings.push({ at: T0 + m * MIN, mgdl: 110 });
  // glucose flat but the insulin has been acting: the "unexplained rise" is the carbs, so they are absorbed at the insulin's pace
  const o = observedCarbs(s.entries, flatReadings, settings(120), T0 + 190 * MIN);
  assert.ok(o.cob < 1, "by 190 min (past 1.5 x usual), flat glucose under insulin means the carbs are accounted for: " + o.cob);
});

test("projection: carbs raise, insulin lowers, both run out, and it starts at the latest reading", () => {
  const s = scenario({ C: 60, T: 120 });
  const now = T0 + 30 * MIN;
  const reads = s.readings.filter(r => r.at <= now);
  const p = projectGlucose(s.entries, reads, settings(120), now);
  assert.ok(p && p.start.mgdl === reads[reads.length - 1].mgdl);
  assert.ok(p.points.length > 10);
  assert.ok(p.high.mgdl > p.start.mgdl, "carbs still to come push it up first");
  // against the exact truth
  const truth = s.readings.find(r => r.at === now + 90 * MIN).mgdl;
  const at90 = p.points.find(q => q.t === p.start.t + 90 * MIN).mgdl;
  assert.ok(Math.abs(at90 - truth) < 35, `projection ${Math.round(at90)} vs truth ${Math.round(truth)}`);
  assert.equal(projectGlucose(s.entries, reads, settings(120), now + 40 * MIN), null, "a stale reading gives no projection");
  assert.equal(projectGlucose(s.entries, [], settings(120), now), null);
});

test("projection with only insulin on board heads down, never invents carbs", () => {
  const e = { ts: T0, mealDose: 2, correctionDose: 0 };
  const reads = [{ at: T0 + 55 * MIN, mgdl: 200 }, { at: T0 + 60 * MIN, mgdl: 195 }];
  const p = projectGlucose([e], reads, settings(), T0 + 60 * MIN);
  assert.ok(p.end.mgdl < 195 && p.low.mgdl === p.end.mgdl);
  assert.ok(p.obs.cob === 0);
});

test("learned absorption: recovers the true time for each band from clean meals, and needs 3 meals", () => {
  const mk = (i, C, T, gi) => { const s = scenario({ C, T, ts: T0 + i * 8 * HOUR, hours: 5 }); s.entry.glycemicLoad = { value: gi }; return s; };
  const sets = [mk(0, 50, 90, 80), mk(1, 60, 100, 80), mk(2, 55, 95, 80), mk(3, 60, 200, 40), mk(4, 70, 210, 40)];
  const entries = sets.map(s => s.entry), readings = sets.flatMap(s => s.readings);
  const out = learnAbsorption(entries, readings, { isfMgdl: ISF, peak: PEAK, dia: DIA, now: T0 + 10 * 24 * HOUR });
  assert.ok(out.high && Math.abs(out.high.minutes - 95) <= 15 && out.high.n === 3, JSON.stringify(out.high));
  assert.equal(out.low, null, "only 2 low-GI meals: not enough");
  assert.equal(out.counts.low, 2);
});

test("learned absorption: ignores meals with other carbs nearby, tiny meals, and ones without 4 hours of readings", () => {
  const a = scenario({ C: 60, T: 100, ts: T0 }), b = scenario({ C: 60, T: 100, ts: T0 + HOUR });   // overlapping meals
  const r = learnAbsorption([a.entry, b.entry], [...a.readings, ...b.readings], { isfMgdl: ISF, peak: PEAK, dia: DIA, now: T0 + 20 * HOUR });
  assert.equal(r.counts.high, 0);
  const tiny = scenario({ C: 8, T: 60 });
  assert.equal(learnAbsorption(tiny.entries, tiny.readings, { isfMgdl: ISF, peak: PEAK, dia: DIA, now: T0 + 20 * HOUR }).counts.high, 0);
  const recent = scenario({ C: 60, T: 100 });
  assert.equal(learnAbsorption(recent.entries, recent.readings, { isfMgdl: ISF, peak: PEAK, dia: DIA, now: T0 + 2 * HOUR }).counts.high, 0);
});

test("helpers: smoothing removes a single spike; carb effect per gram is ISF over the ratio used", () => {
  const r = prepareReadings([{ at: 0, mgdl: 100 }, { at: 5 * MIN, mgdl: 100 }, { at: 10 * MIN, mgdl: 300 }, { at: 15 * MIN, mgdl: 100 }, { at: 20 * MIN, mgdl: 100 }]);
  assert.equal(r[2].mgdl, 100);
  assert.equal(glucoseNear(r, 7 * MIN, 4), 100);
  assert.equal(glucoseNear(r, 60 * MIN, 4), null);
  assert.equal(carbEffectPerGram({ ratioValue: 10 }, 50), 5);
  assert.equal(carbEffectPerGram({}, 50, 8), 6.25);
  assert.equal(cobAt({ cob: 40, finishMin: 80 }, 40), 20);
  assert.equal(cobAt({ cob: 40, finishMin: 80 }, 100), 0);
});

test("basal: a usual dose changes nothing; a short or extra dose moves the line; needs 3 doses to know 'usual'", async () => {
  const { basalContext, basalDrop, EXPECTED_FLOOR } = await import("../../js/glucose-model.js");
  const bas = (ts, u, slot = "am") => ({ ts, entryType: "basal", mealType: "basal", basalDose: u, basalSlot: slot });
  const usual = [bas(T0 - 72 * HOUR, 20), bas(T0 - 48 * HOUR, 20), bas(T0 - 24 * HOUR, 20)];
  const ctx = basalContext(usual);
  assert.equal(ctx.usual.am, 20); assert.equal(ctx.usual.pm, null);
  assert.equal(basalDrop(ctx, T0 - 24 * HOUR, T0, ISF), 0, "usual doses cancel the liver");
  const extra = basalContext([...usual, bas(T0, 22)]);
  const d = basalDrop(extra, T0, T0 + 12 * HOUR, ISF);
  assert.ok(Math.abs(d - 2 * ISF * 0.5) < 0.01, "2 u extra over 24 h, half of it in 12 h: " + d);
  const short = basalContext([...usual, bas(T0, 18)]);
  assert.ok(basalDrop(short, T0, T0 + 24 * HOUR, ISF) < 0, "a short dose lets glucose rise");
  assert.equal(basalContext([bas(T0, 25), bas(T0 + HOUR, 10)]).usual.am, null, "fewer than 3: no usual known");
});

test("expected line: floored, and basal status is reported", () => {
  const e = { ts: T0, mealDose: 6, correctionDose: 0 };
  const reads = []; for (let m = -10; m <= 240; m += 5) reads.push({ at: T0 + m * MIN, mgdl: 100 });
  const bas = (ts, u) => ({ ts, entryType: "basal", mealType: "basal", basalDose: u, basalSlot: "am" });
  const r = expectedFromInsulin([e], reads, { isfMgdl: ISF, peak: PEAK, dia: DIA, now: T0 + 4 * HOUR });
  assert.equal(r.basal.status, "none");
  assert.ok(r.capped && Math.min(...r.points.map(p => p.expected)) >= 40);
  const old = [bas(T0 - 90 * HOUR, 20), bas(T0 - 66 * HOUR, 20), bas(T0 - 42 * HOUR, 20)];
  assert.equal(expectedFromInsulin([e], reads, { isfMgdl: ISF, peak: PEAK, dia: DIA, now: T0 + 4 * HOUR, basalEntries: old }).basal.status, "missing");
  const ok = [...old, bas(T0 - 2 * HOUR, 20)];
  assert.equal(expectedFromInsulin([e], reads, { isfMgdl: ISF, peak: PEAK, dia: DIA, now: T0 + 4 * HOUR, basalEntries: ok }).basal.status, "usual");
  const big = [...old, bas(T0 + HOUR, 24)];
  const rb = expectedFromInsulin([e], reads, { isfMgdl: ISF, peak: PEAK, dia: DIA, now: T0 + 4 * HOUR, basalEntries: big });
  assert.equal(rb.basal.status, "adjusted");
});
