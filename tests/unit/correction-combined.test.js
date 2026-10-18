// A meal and a correction in one dose: add for a high reading, take off for a low one, or type either by hand.
import test from "node:test";
import assert from "node:assert/strict";
import { planDose, planEditDose, computeDose, roundSignedDose, checkDoseConsistency } from "../../js/calc.js";
import { validateEntry } from "../../js/core/schema.js";

const S = (o = {}) => ({ units: "mgdl", isf: 50, target: 100, rounding: "0.5", maxDose: 25, iobAwareCorrection: false, ...o });
const meal12 = { carbs: 120, ratio: 10 };   // a 12 unit meal

test("a 12 u meal at 300 mg/dL: the correction is ADDED (200 above target / 50 = 4 u), 16 u in all", () => {
  const p = planDose({ ...meal12, correction: "auto", glucose: "300", settings: S() });
  assert.equal(p.mealDose, 12); assert.equal(p.correctionDose, 4); assert.equal(p.finalDose, 16);
  assert.equal(p.reduced, false);
});

test("at 55 mg/dL with 'lower the dose when low' on: about a unit comes OFF the meal (-45 / 50 = -0.9, rounded to -1)", () => {
  const p = planDose({ ...meal12, correction: "auto", glucose: "55", settings: S({ reduceBelowTarget: true }) });
  assert.equal(p.mealDose, 12); assert.equal(p.correctionDose, -1); assert.equal(p.finalDose, 11);
  assert.equal(p.reduced, true);
});

test("with that setting OFF (the default) a low reading changes nothing, exactly as before", () => {
  for (const s of [S(), S({ reduceBelowTarget: false })]) {
    const p = planDose({ ...meal12, correction: "auto", glucose: "55", settings: s });
    assert.equal(p.correctionDose, 0); assert.equal(p.finalDose, 12); assert.equal(p.reduced, false);
  }
});

test("a reading exactly on target, or a high one, is not reduced by the setting", () => {
  assert.equal(planDose({ ...meal12, correction: "auto", glucose: "100", settings: S({ reduceBelowTarget: true }) }).correctionDose, 0);
  assert.equal(planDose({ ...meal12, correction: "auto", glucose: "150", settings: S({ reduceBelowTarget: true }) }).correctionDose, 1);
});

test("insulin on board never shrinks a reduction further", () => {
  const p = planDose({ ...meal12, correction: "auto", glucose: "55", iob: 3, settings: S({ reduceBelowTarget: true, iobAwareCorrection: true }) });
  assert.equal(p.correctionDose, -1); assert.equal(p.iobSubtracted, 0); assert.equal(p.finalDose, 11);
});

test("a typed correction can add or subtract", () => {
  assert.equal(planDose({ ...meal12, correction: "manual", correctionUnits: 1.5, settings: S() }).finalDose, 13.5);
  const down = planDose({ ...meal12, correction: "manual", correctionUnits: -2, settings: S() });
  assert.equal(down.mealDose, 12); assert.equal(down.correctionDose, -2); assert.equal(down.finalDose, 10); assert.equal(down.correctionIsManual, true);
  assert.equal(planDose({ ...meal12, correction: "manual", correctionUnits: 0, settings: S() }).finalDose, 12);   // typing 0 still means no correction
});

test("a reduction can take the dose to zero but never below, and says so", () => {
  const p = planDose({ carbs: 30, ratio: 10, correction: "manual", correctionUnits: -8, settings: S() });
  assert.equal(p.mealDose, 3); assert.equal(p.correctionDose, -3); assert.equal(p.finalDose, 0); assert.equal(p.reductionLimited, true);
  const none = planDose({ carbs: 0, ratio: 10, correction: "manual", correctionUnits: -2, settings: S() });
  assert.equal(none.finalDose, 0); assert.equal(none.hasDose, false);   // nothing to log: a reduction on its own is not a dose
});

test("the parts always add up to the dose that is shown and saved", () => {
  for (const [glucose, set] of [["55", { reduceBelowTarget: true }], ["300", {}], ["90", { reduceBelowTarget: true }], ["180", {}]]) {
    const p = planDose({ ...meal12, correction: "auto", glucose, settings: S(set) });
    assert.equal(Math.round((p.mealDose + p.correctionDose) * 100) / 100, p.finalDose);
    assert.equal(checkDoseConsistency({ mealDose: p.mealDose, correctionDose: p.correctionDose, finalDose: p.finalDose, shownText: p.finalDose.toFixed(1) }), null);
  }
  for (const u of [-2, -0.5, 1, 3]) {
    const p = planDose({ ...meal12, correction: "manual", correctionUnits: u, settings: S() });
    assert.equal(Math.round((p.mealDose + p.correctionDose) * 100) / 100, p.finalDose);
  }
});

test("the maximum dose still caps what is ADDED; a reduction is applied on top of the capped meal", () => {
  const over = planDose({ carbs: 200, ratio: 10, correction: "auto", glucose: "55", settings: S({ maxDose: 15, reduceBelowTarget: true }) });
  assert.equal(over.mealDose, 15); assert.equal(over.correctionDose, -1); assert.equal(over.finalDose, 14); assert.equal(over.capped, true);
  const up = planDose({ carbs: 120, ratio: 10, correction: "auto", glucose: "400", settings: S({ maxDose: 15 }) });
  assert.equal(up.finalDose, 15); assert.equal(up.correctionDose, 3); assert.equal(up.capped, true);   // unchanged behaviour
});

test("a typed meal dose (Eating Out) takes a reduction too, and is not capped or altered", () => {
  const p = planDose({ carbs: 0, ratio: 10, mealUnits: 8, correction: "manual", correctionUnits: -1, settings: S() });
  assert.equal(p.mealDose, 8); assert.equal(p.correctionDose, -1); assert.equal(p.finalDose, 7);
});

test("treating a low still means no insulin at all, whatever else is set", () => {
  const p = planDose({ carbs: 20, ratio: 10, correction: "auto", glucose: "55", noInsulin: true, settings: S({ reduceBelowTarget: true }) });
  assert.equal(p.finalDose, 0); assert.equal(p.correctionDose, 0); assert.equal(p.reduced, false);
});

test("rounding a reduction is symmetrical with rounding an addition, and never gives -0", () => {
  assert.equal(roundSignedDose(-0.9, "0.5"), -1); assert.equal(roundSignedDose(0.9, "0.5"), 1);
  assert.equal(roundSignedDose(-0.25, "0.5"), -0.5); assert.equal(roundSignedDose(0.25, "0.5"), 0.5);
  assert.equal(roundSignedDose(-0.75, "0.5"), -1);
  assert.ok(Object.is(roundSignedDose(-0.1, "0.5"), 0));
  assert.equal(roundSignedDose(-1.04, "0.1"), -1);
});

test("computeDose explains a reduction in plain words", () => {
  const r = computeDose({ ...meal12, correctionOn: true, glucose: "55", glucoseUnit: "mgdl", settings: S({ reduceBelowTarget: true }) });
  const text = r.lines.join(" | ");
  assert.match(text, /Low: \(55 − 100\) ÷ 50 = -0\.9 u, taken off the meal dose/);
  assert.match(text, /Meal 12 u − reduction 1 u = 11\.0 u/);
  assert.equal(r.finalDose, 11);
});

test("editing a saved meal keeps a reduction that was typed, and recalculates one from a reading", () => {
  const entry = { noInsulin: false, mealDose: 12, correctionDose: -1, glucose: null };
  const kept = planEditDose({ entry, totalCarbs: 120, ratio: 10, glucoseText: null, settings: S() });
  assert.equal(kept.correctionDose, -1); assert.equal(kept.finalDose, 11);
  const fromReading = planEditDose({ entry: { ...entry, glucose: 55 }, totalCarbs: 120, ratio: 10, glucoseText: "55", settings: S({ reduceBelowTarget: true }) });
  assert.equal(fromReading.correctionDose, -1);
});

test("the schema accepts a negative correction part but still refuses a negative meal or total carbs", () => {
  const e = { id: "x", ts: 1, mealType: "lunch", items: [], totalCarbs: 10, totalKcal: 0, mealDose: 3, correctionDose: -1, noInsulin: false };
  assert.deepEqual(validateEntry(e).filter(p => p.severity === "error"), []);
  assert.ok(validateEntry({ ...e, mealDose: -1 }).some(p => p.severity === "error"));
});

import { buildTrendBuckets, summarizeTrends } from "../../js/calc.js";
test("trends and report totals: a reduction counts against meal insulin, never as a negative correction", () => {
  const now = Date.now();
  const h = [
    { id: "a", ts: now - 3600000, mealType: "lunch", totalCarbs: 100, mealDose: 12, correctionDose: -1, noInsulin: false },
    { id: "b", ts: now - 7200000, mealType: "dinner", totalCarbs: 50, mealDose: 5, correctionDose: 2, noInsulin: false }
  ];
  const { buckets, inRange, todayKey } = buildTrendBuckets(h, 3, now);
  const today = buckets[buckets.length - 1];
  assert.equal(today.meal, 16); assert.equal(today.corr, 2); assert.equal(today.dose, 18);   // 12-1 + 5 ; 2 ; 11 + 7
  const s = summarizeTrends(buckets, inRange, todayKey);
  assert.equal(s.totalMealIns, 16); assert.equal(s.totalCorrIns, 2); assert.equal(s.totalIns, 18);
  assert.equal(s.corrPct, 11);
});
