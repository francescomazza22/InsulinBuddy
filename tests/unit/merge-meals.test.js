// Merging meals (2.105.0): what a merged meal holds, what can't be merged, and the promise that merging never changes
// active insulin or carbs (they keep the real times of the meals it was made from).
import test from "node:test";
import assert from "node:assert/strict";
import { mergeMeals, mergeBlockReason, mergeSources } from "../../js/merge-meals.js";
import { activeAt, activeParts } from "../../js/calc.js";
import { validateEntry } from "../../js/core/schema.js";

const MIN = 60000, T = Date.UTC(2026, 10, 15, 12, 0);
const item = (name, grams, carbs, kcal, extra = {}) => ({ refType: "food", refId: "f-" + name, name, grams, quantity: null, unitLabel: null, gramsPerUnit: null, gi: 50, carbsPer100g: 0, kcalPer100g: 0, carbs, kcal, ...extra });
const meal = (id, mins, items, mealDose, correctionDose = 0, extra = {}) => ({
  id, ts: T + mins * MIN, mealType: "lunch", periodName: "lunch", items, totalCarbs: items.reduce((s, i) => s + i.carbs, 0),
  totalKcal: items.reduce((s, i) => s + i.kcal, 0), glycemicLoad: { value: 50, partial: false }, carbsUnknown: false,
  mealDose, correctionDose, noInsulin: false, glucose: 140, ratioLabel: "Lunch", ratioValue: 10, ns: { status: "synced", ids: { carbs: "c-" + id, bolus: "b-" + id } }, ...extra
});
const settings = { insulinModel: { diaMinutes: 300, peakMinutes: 75 }, carbAbsorptionMinutes: { high: 120, medium: 180, low: 240, unknown: 180 } };

test("a merged meal: earliest time, foods combined, carbs and doses added up, nothing recalculated", () => {
  const a = meal("h-1", 0, [item("Pasta", 100, 30, 150), item("Bread", 40, 20, 100)], 5, 0.5);
  const b = meal("h-2", 40, [item("Pasta", 50, 15, 75), item("Apple", 150, 18, 80)], 3.5, 0, { glucose: 190, mealType: "snack", ratioValue: 12 });
  const m = mergeMeals([b, a], { id: "h-new" });
  assert.equal(m.id, "h-new");
  assert.equal(m.ts, a.ts);
  assert.equal(m.mealType, "lunch");
  assert.deepEqual(m.items.map(i => [i.name, i.grams, i.carbs, i.kcal]), [["Pasta", 150, 45, 225], ["Bread", 40, 20, 100], ["Apple", 150, 18, 80]]);
  assert.equal(m.totalCarbs, 83);
  assert.equal(m.totalKcal, 405);
  assert.equal(m.mealDose, 8.5);
  assert.equal(m.correctionDose, 0.5);
  assert.equal(m.glucose, 140, "the reading before the first part");
  assert.equal(m.ratioValue, 10);
  assert.equal(m.ns, undefined, "the merged meal is not a Nightscout record of its own");
  assert.deepEqual(m.mergedFrom.map(s => s.id), ["h-1", "h-2"]);
  assert.deepEqual(m.mergedFrom[0].ns, a.ns, "the originals keep their Nightscout ids");
  assert.deepEqual(validateEntry(m).filter(p => p.level === "error"), []);
});

test("quantity foods add up their quantity and lose a single-portion label; extra insulin adds up", () => {
  const slice = extra => item("Cake", 60, 30, 200, { quantity: 1, unitLabel: "slice", gramsPerUnit: 60, ...extra });
  const a = meal("h-1", 0, [slice({ portion: "1/2", quantity: 0.5, grams: 30, carbs: 15, kcal: 100 })], 2, 0, { extraDose: 0.5 });
  const b = meal("h-2", 30, [slice({ portion: "1/2", quantity: 0.5, grams: 30, carbs: 15, kcal: 100 })], 1.5, 0, { extraDose: 0.5 });
  const m = mergeMeals([a, b], { id: "x" });
  assert.equal(m.items.length, 1);
  assert.equal(m.items[0].quantity, 1);
  assert.equal(m.items[0].grams, 60);
  assert.equal(m.items[0].portion, undefined);
  assert.equal(m.extraDose, 1);
  // the originals were not touched
  assert.equal(a.items[0].portion, "1/2");
  assert.equal(a.items[0].quantity, 0.5);
});

test("merging a merged meal keeps the flat list of originals", () => {
  const a = meal("h-1", 0, [item("A", 10, 10, 10)], 1), b = meal("h-2", 10, [item("B", 10, 10, 10)], 1), c = meal("h-3", 20, [item("C", 10, 10, 10)], 1);
  const ab = mergeMeals([a, b], { id: "ab" });
  const abc = mergeMeals([ab, c], { id: "abc" });
  assert.deepEqual(abc.mergedFrom.map(s => s.id), ["h-1", "h-2", "h-3"]);
  assert.deepEqual(mergeSources(abc).map(s => s.id), ["h-1", "h-2", "h-3"]);
  assert.deepEqual(mergeSources(c).map(s => s.id), ["h-3"]);
});

test("what can't be merged, and why", () => {
  const a = meal("h-1", 0, [item("A", 10, 10, 10)], 1), b = meal("h-2", 10, [item("B", 10, 10, 10)], 1);
  assert.equal(mergeBlockReason([a, b]), null);
  assert.match(mergeBlockReason([a]), /at least two/);
  assert.match(mergeBlockReason([a, { id: "bas", ts: T, entryType: "basal", mealType: "basal", basalDose: 18 }]), /Only meals/);
  assert.match(mergeBlockReason([a, { ...b, carbsUnknown: true }]), /eating-out/);
  assert.match(mergeBlockReason([a, { ...b, noInsulin: true, mealDose: 0 }]), /treated low/);
  assert.equal(mergeBlockReason([{ ...a, noInsulin: true }, { ...b, noInsulin: true }]), null);
  assert.match(mergeBlockReason([a, a]), /twice/);
});

test("active insulin and carbs are exactly the same before and after a merge, at every moment", () => {
  const a = meal("h-1", 0, [item("Pasta", 100, 60, 300)], 6, 1);
  const b = meal("h-2", 45, [item("Cake", 60, 30, 200)], 3);
  const c = meal("h-3", 95, [item("Apple", 150, 18, 80)], 1.5);
  const before = [c, b, a];
  const after = [mergeMeals([a, b, c], { id: "m" })];
  for (let mins = -10; mins <= 420; mins += 5) {
    const t = T + mins * MIN;
    assert.deepEqual(activeAt(after, settings, t), activeAt(before, settings, t), `at +${mins} min`);
  }
  // Read at the merged meal's own time it would show too little: the reason the parts are used.
  const naive = activeAt(after.map(({ mergedFrom, ...e }) => e), settings, T + 120 * MIN);
  assert.ok(naive.iob < activeAt(before, settings, T + 120 * MIN).iob);
});

test("an edited merged meal is read as it now stands", () => {
  const a = meal("h-1", 0, [item("A", 50, 40, 10)], 4), b = meal("h-2", 60, [item("B", 50, 20, 10)], 2);
  const m = mergeMeals([a, b], { id: "m" });
  assert.equal(activeParts(m).length, 2);
  assert.deepEqual(activeParts({ ...m, mealDose: 7 }), [{ ...m, mealDose: 7 }]);
  assert.equal(activeParts({ ...m, totalCarbs: 70 }).length, 1);
  assert.equal(activeParts(a).length, 1);
});
