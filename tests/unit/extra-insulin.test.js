// Extra insulin chosen on top of the calculated dose (2.84.0).
import test from "node:test";
import assert from "node:assert/strict";
import { planDose, planEditDose, cleanExtraUnits, activeAt, idealRatioByBracket, checkDoseConsistency, EXTRA_MAX_UNITS } from "../../js/calc.js";
import { doseBreakdownText, modeChipLabel } from "../../js/calc-labels.js";
import { buildMealEntry } from "../../js/core/meal-entry.js";
import { validateEntry, hasErrors } from "../../js/core/schema.js";
import { doseBadge } from "../../js/history.js";
import { treatmentsForEntry } from "../../js/nightscout.js";

const S = (o = {}) => ({ units: "mgdl", isf: 50, target: 100, rounding: "0.5", maxDose: 15, iobAwareCorrection: false, ...o });

test("planDose: the extra goes on top and the calculated part is untouched", () => {
  const base = planDose({ carbs: 37.5, ratio: 10, settings: S() });
  const plus = planDose({ carbs: 37.5, ratio: 10, extraUnits: 1, settings: S() });
  assert.equal(base.finalDose, 4);                        // 3.75 rounded to 0.5
  assert.equal(plus.finalDose, 5);
  assert.equal(plus.mealDose, 5); assert.equal(plus.correctionDose, 0);
  assert.equal(plus.extraDose, 1); assert.equal(plus.extraInMeal, true);
  assert.equal(plus.mealDose + plus.correctionDose, plus.finalDose, "the parts still add up to the dose");
  // A typed extra is never rounded to the Settings step.
  assert.equal(planDose({ carbs: 30, ratio: 10, extraUnits: 0.3, settings: S() }).finalDose, 3.3);
});

test("planDose: decimal comma, junk, zero and negatives", () => {
  assert.equal(planDose({ carbs: 30, ratio: 10, extraUnits: "0,5", settings: S() }).finalDose, 3.5);
  for (const v of ["abc", "", "-", 0, NaN, null, undefined, "1e3x", "--1"]) {
    const p = planDose({ carbs: 30, ratio: 10, extraUnits: v, settings: S() });
    assert.equal(p.finalDose, 3, String(v)); assert.equal(p.extraDose, 0, String(v));
  }
  assert.equal(cleanExtraUnits(999), EXTRA_MAX_UNITS);
  assert.equal(cleanExtraUnits(-999), -EXTRA_MAX_UNITS);
  assert.equal(cleanExtraUnits("-0,5"), -0.5); assert.equal(cleanExtraUnits("\u22121"), -1);
});

test("planDose (2.85.0): a negative adjustment takes insulin off, never below 0, inside the correction dose", () => {
  const p = planDose({ carbs: 37.5, ratio: 15, extraUnits: -0.5, settings: S() });   // 2.5 u meal
  assert.deepEqual([p.mealDose, p.correctionDose, p.finalDose, p.extraDose, p.extraInMeal], [2.5, -0.5, 2, -0.5, false]);
  assert.equal(p.mealDose + p.correctionDose, p.finalDose);
  const all = planDose({ carbs: 30, ratio: 15, extraUnits: -5, settings: S() });      // only 2 u there
  assert.deepEqual([all.finalDose, all.extraDose, all.correctionDose], [0, -2, -2]);
  const corr = planDose({ carbs: 30, ratio: 15, correction: "auto", glucose: "200", extraUnits: -1, settings: S() });
  assert.deepEqual([corr.mealDose, corr.correctionDose, corr.finalDose], [2, 1, 3]);
  const none = planDose({ carbs: 0, ratio: 15, extraUnits: -1, settings: S() });
  assert.deepEqual([none.finalDose, none.extraDose, none.hasDose], [0, 0, false], "nothing to take off: no entry to log");
  // Re-saving in Edit meal keeps the same dose.
  const e = { noInsulin: false, mealDose: p.mealDose, correctionDose: p.correctionDose, extraDose: p.extraDose, totalCarbs: 37.5, glucose: null };
  const again = planEditDose({ entry: e, totalCarbs: 37.5, ratio: 15, glucoseText: null, settings: S() });
  assert.deepEqual([again.finalDose, again.correctionDose, again.extraDose], [2, -0.5, -0.5]);
  assert.equal(planEditDose({ entry: e, totalCarbs: 37.5, ratio: 15, glucoseText: null, settings: S(), extraUnits: 0 }).finalDose, 2.5);
});

test("planDose: never through a low treatment; with a correction and a reduction", () => {
  assert.equal(planDose({ carbs: 20, ratio: 10, extraUnits: 2, noInsulin: true, settings: S() }).finalDose, 0);
  const corr = planDose({ carbs: 30, ratio: 10, correction: "auto", glucose: "200", extraUnits: 1, settings: S() });
  assert.deepEqual([corr.mealDose, corr.correctionDose, corr.finalDose], [4, 2, 6]);
  // 12 u meal, 1 u off for a low reading, then 1 u extra: the reduction works on the calculated meal only.
  const red = planDose({ carbs: 120, ratio: 10, correction: "auto", glucose: "55", extraUnits: 1, settings: S({ maxDose: 25, reduceBelowTarget: true }) });
  assert.deepEqual([red.mealDose, red.correctionDose, red.finalDose], [13, -1, 12]);
});

test("planDose: the cap applies to the calculation, the extra goes over it and is flagged", () => {
  const p = planDose({ carbs: 200, ratio: 10, extraUnits: 2, settings: S({ maxDose: 15 }) });
  assert.equal(p.capped, true); assert.equal(p.overMax, true);
  assert.equal(p.finalDose, 17); assert.equal(p.requested, 22);
  const under = planDose({ carbs: 100, ratio: 10, extraUnits: 2, settings: S({ maxDose: 15 }) });
  assert.equal(under.overMax, false); assert.equal(under.finalDose, 12);
});

test("planDose: with nothing to eat the extra goes into the correction, so it logs as a correction", () => {
  const p = planDose({ carbs: 0, ratio: 10, correction: "auto", glucose: "250", extraUnits: 1, settings: S() });
  assert.deepEqual([p.mealDose, p.correctionDose, p.finalDose, p.extraInMeal], [0, 4, 4, false]);
  const alone = planDose({ carbs: 0, ratio: 10, extraUnits: 1, settings: S() });
  assert.equal(alone.hasDose, true); assert.equal(alone.finalDose, 1);
});

test("the saved entry: extraDose sits inside mealDose, so every insulin total counts it unchanged", () => {
  const computed = planDose({ carbs: 30, ratio: 10, extraUnits: 1, settings: S() });
  const entry = buildMealEntry({ now: new Date(1_700_000_000_000), mealType: "lunch", periodEntry: null, ratioEntry: { name: "Lunch", ratio: 10 },
    items: [{ refType: "food", refId: "f1", name: "Rice", grams: 100, carbsPer100g: 30, kcalPer100g: 130, carbs: 30, kcal: 130 }],
    eatingOut: false, noInsulin: false, computed: { ...computed, carbs: 30 }, glucoseVal: null });
  assert.equal(entry.mealDose, 4); assert.equal(entry.extraDose, 1);
  assert.equal(hasErrors(validateEntry(entry)), false);
  assert.equal(checkDoseConsistency({ mealDose: entry.mealDose, correctionDose: entry.correctionDose, finalDose: computed.finalDose, shownText: "4.0" }), null);
  // Insulin on board counts the whole 4 u straight after logging.
  const settings = { insulinModel: { diaMinutes: 300, peakMinutes: 75 }, carbAbsorptionMinutes: { high: 120, medium: 180, low: 240, unknown: 180 } };
  assert.ok(Math.abs(activeAt([entry], settings, entry.ts + 1).iob - 4) < 0.01);
  // Nightscout gets the whole dose, in the usual shape.
  const [t] = treatmentsForEntry(entry);
  assert.equal(t.treatment.insulin, 4);
  // No extra: no field at all (older entries stay exactly as they were).
  const plain = buildMealEntry({ now: new Date(1_700_000_000_000), mealType: "lunch", periodEntry: null, ratioEntry: null, items: [], eatingOut: false, noInsulin: false, computed: planDose({ carbs: 30, ratio: 10, settings: S() }), glucoseVal: null });
  assert.equal("extraDose" in plain, false);
});

test("schema: a negative extraDose (taken off) is valid, a non-number isn't", () => {
  const e = { id: "h-1", ts: 1_700_000_000_000, mealType: "lunch", items: [], totalCarbs: 30, mealDose: 3, correctionDose: -1, extraDose: -1 };
  assert.equal(hasErrors(validateEntry(e)), false);
  assert.equal(hasErrors(validateEntry({ ...e, extraDose: "x" })), true);
});

test("planEditDose: re-saving keeps the extra; changing it changes only the extra", () => {
  const e = { noInsulin: false, mealDose: 4, correctionDose: 0, extraDose: 1, totalCarbs: 30, glucose: null };
  const same = planEditDose({ entry: e, totalCarbs: 30, ratio: 10, glucoseText: null, settings: S() });
  assert.deepEqual([same.mealDose, same.finalDose, same.extraDose], [4, 4, 1]);
  const more = planEditDose({ entry: e, totalCarbs: 30, ratio: 10, glucoseText: null, settings: S(), extraUnits: 2 });
  assert.equal(more.finalDose, 5);
  const none = planEditDose({ entry: e, totalCarbs: 30, ratio: 10, glucoseText: null, settings: S(), extraUnits: 0 });
  assert.equal(none.finalDose, 3);
  // No ratio: the saved meal dose (4.25 incl. 0.75 extra) is not counted twice.
  const noRatio = planEditDose({ entry: { ...e, mealDose: 4.25, extraDose: 0.75 }, totalCarbs: 80, ratio: 0, glucoseText: null, settings: S() });
  assert.equal(noRatio.finalDose, 4.25);
});

test("ideal ratio: an extra chosen at the meal counts as insulin the meal needed", () => {
  // 30 g at 1:10 = 3 u, plus 1 u extra: 30 g were matched by 4 u -> 1:7.5.
  const meal = { ts: 1_700_000_000_000, mealType: "lunch", ratioLabel: "Lunch", ratioValue: 10, totalCarbs: 30, mealDose: 4, correctionDose: 0, extraDose: 1, noInsulin: false };
  const r = idealRatioByBracket([meal], { timeRatios: [{ name: "Lunch", ratio: 10 }], activityRatios: [] }, 3);
  const row = r.rows.find(x => x.label === "Lunch");
  assert.ok(Math.abs(row.ideal - 7.5) < 1e-9, String(row.ideal));
  assert.equal(row.withExtra, 1); assert.equal(row.withCorrections, 0, "an extra is not reported as a correction");
});

test("words: dose card breakdown, mode chip and log badge show the extra apart", () => {
  assert.equal(doseBreakdownText({ mealDose: 4, correctionDose: 0, extraDose: 1 }), "Meal 3 u + 1 u extra");
  assert.equal(doseBreakdownText({ mealDose: 4, correctionDose: 2, extraDose: 1 }), "Meal 3 u + correction 2 u + 1 u extra");
  assert.equal(doseBreakdownText({ mealDose: 2.5, correctionDose: -0.5, extraDose: -0.5, extraInMeal: false }), "Meal 2.5 u \u2212 0.5 u less");
  assert.equal(doseBreakdownText({ mealDose: 2, correctionDose: 1, extraDose: -1, extraInMeal: false }), "Meal 2 u + correction 2 u \u2212 1 u less");
  assert.equal(doseBreakdownText({ mealDose: 3, correctionDose: 1 }), "Meal 3 u + correction 1 u", "unchanged without an extra");
  assert.equal(doseBreakdownText({ mealDose: 3 }), null);
  assert.equal(doseBreakdownText({ mealDose: 0, correctionDose: 4, extraDose: 1, extraInMeal: false }), "Correction 3 u + 1 u extra");
  assert.equal(modeChipLabel({ extraOn: true, hasFood: true }), "Meal", "an adjustment lights the chip but keeps its words (and width)");
  assert.equal(modeChipLabel({ extraOn: true, correctionOn: true, hasFood: true }), "Meal + correction");
  assert.equal(modeChipLabel({ extraOn: true, eatingOutOn: true }), "Eating out");
  assert.equal(doseBadge({ mealDose: 4, correctionDose: 0, extraDose: 1, items: [{}] }).sub, "3 meal + 1 extra");
  assert.equal(doseBadge({ mealDose: 4, correctionDose: 0, items: [{}] }).sub, "", "unchanged without an extra");
  assert.equal(doseBadge({ mealDose: 2.5, correctionDose: -0.5, extraDose: -0.5, items: [{}] }).sub, "2.5 meal \u2212 0.5 less");
  assert.equal(doseBadge({ mealDose: 2.5, correctionDose: -0.5, extraDose: -0.5, items: [{}] }).main, "2 u");
});
