import test from "node:test";
import assert from "node:assert/strict";
import { validateEntry, validateFood, validateRecipe, validateSettings, validateState, hasErrors, summarizeProblems, isBasal } from "../../js/core/schema.js";
import { buildMealEntry } from "../../js/core/meal-entry.js";
import { makeBasalEntry } from "../../js/history.js";
import { normalizeState } from "../../js/state.js";

const settings = () => ({ isf: 50, target: 100, units: "mgdl", maxDose: 15, timeRatios: [{ id: "a", name: "Day", start: "06:00", end: "23:30", ratio: 10 }] });
const items = [{ refType: "food", refId: "f1", name: "Rice", grams: 100, carbs: 28, kcal: 130 }];
const realMeal = () => buildMealEntry({ now: new Date(2026, 0, 1, 13), mealType: "lunch", periodEntry: { name: "Day" }, ratioEntry: { name: "Day", ratio: 10 }, items, eatingOut: false, noInsulin: false, computed: { mealDose: 2.8, correctionDose: 0 }, glucoseVal: null });

test("what the app itself builds always passes the contract", () => {
  assert.deepEqual(validateEntry(realMeal()), []);
  const eatingOut = buildMealEntry({ now: new Date(), mealType: "dinner", periodEntry: null, ratioEntry: null, items, eatingOut: true, noInsulin: false, computed: { mealDose: 3, correctionDose: 0, capped: true, requested: 5 }, glucoseVal: 140 });
  assert.deepEqual(validateEntry(eatingOut), []);
  assert.deepEqual(validateEntry(makeBasalEntry({ units: 16, ts: Date.now(), slot: "pm" })), []);
});
test("a brand-new default state passes", () => {
  const st = normalizeState({}, () => ({ settings: settings(), library: [{ id: "f1", name: "Rice", carbs: 28 }] }));
  st.history.push(realMeal());
  assert.deepEqual(validateState(st), []);
});
test("entries: missing id or time, and a dose that is text, are errors", () => {
  const e = realMeal();
  assert.ok(hasErrors(validateEntry({ ...e, id: "" })));
  assert.ok(hasErrors(validateEntry({ ...e, ts: undefined })));
  assert.ok(hasErrors(validateEntry({ ...e, mealDose: "2" })));
  assert.ok(hasErrors(validateEntry({ ...e, items: null })));
  assert.ok(hasErrors(validateEntry(null)));
});
test("entries: an unknown meal type is only a warning", () => {
  const p = validateEntry({ ...realMeal(), mealType: "brunch" });
  assert.equal(p.length, 1);
  assert.equal(p[0].severity, "warn");
  assert.ok(!hasErrors(p));
});
test("basal: needs a dose, recognises both markers", () => {
  const b = makeBasalEntry({ units: 16, ts: 1, slot: "am" });
  assert.ok(isBasal(b));
  assert.ok(hasErrors(validateEntry({ ...b, basalDose: -1 })));
  assert.ok(hasErrors(validateEntry({ ...b, basalDose: undefined })));
  assert.equal(validateEntry({ ...b, basalSlot: "noon" })[0].severity, "warn");
});
test("foods and recipes", () => {
  assert.deepEqual(validateFood({ name: "Rice", carbs: 28, kcal: null, gi: 70 }), []);
  assert.ok(hasErrors(validateFood({ name: " ", carbs: 5 })));
  assert.ok(hasErrors(validateFood({ name: "x" })));
  assert.equal(validateFood({ name: "Biscuit", carbs: 50, unitBased: true })[0].severity, "warn");
  assert.deepEqual(validateRecipe({ name: "Bowl", finalWeight: 300, items: [{ grams: 100, carbsPer100g: 10 }] }), []);
  assert.ok(hasErrors(validateRecipe({ name: "Bowl", items: [{ grams: "x" }] })));
  assert.ok(hasErrors(validateRecipe({ name: "Bowl" })));
});
test("settings: ratios and units", () => {
  assert.deepEqual(validateSettings(settings()), []);
  assert.ok(hasErrors(validateSettings({ ...settings(), units: "furlongs" })));
  assert.ok(hasErrors(validateSettings({ ...settings(), timeRatios: [] })));
  assert.ok(hasErrors(validateSettings({ ...settings(), timeRatios: [{ start: "6am", end: "12:00", ratio: 10 }] })));
});
test("state: duplicate ids are caught and the summary reads plainly", () => {
  const st = { settings: settings(), library: [], recipes: [], history: [realMeal(), realMeal()] };
  const p = validateState(st);
  assert.ok(p.some(x => /duplicate/.test(x.message)));
  assert.match(summarizeProblems(p), /1 error/);
  assert.equal(summarizeProblems([]), "clean");
});
