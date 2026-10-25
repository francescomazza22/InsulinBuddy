import test from "node:test";
import assert from "node:assert/strict";
import { toMinutes, inRange, ratioAt, autoMealType, formatDuration, clampNum, normalizeTime } from "../../js/core/time.js";
import { toCsv, parseCsv, splitCsvLine, recipeTotals, parseLibraryFile, mergeLibrary } from "../../js/core/library.js";
import { buildMealEntry, adjustUsage } from "../../js/core/meal-entry.js";

test("time: ranges wrap past midnight, equal bounds mean all day", () => {
  assert.equal(toMinutes("07:30"), 450);
  assert.ok(inRange(60, "22:00", "06:00"));
  assert.ok(!inRange(720, "22:00", "06:00"));
  assert.ok(inRange(5, "00:00", "00:00"));
});
test("time: normalizeTime keeps only whole, valid times as HH:MM", () => {
  assert.equal(normalizeTime("07:30"), "07:30");
  assert.equal(normalizeTime("7:30"), "07:30");
  assert.equal(normalizeTime("13:30:00"), "13:30");
  assert.equal(normalizeTime("13:30:00.000"), "13:30");
  assert.equal(normalizeTime("00:00"), "00:00");
  assert.equal(normalizeTime("23:59"), "23:59");
  for (const bad of ["", "   ", null, undefined, "24:00", "12:60", "12", "12:3", "ab:cd", "12:30 pm"]) assert.equal(normalizeTime(bad), null, String(bad));
});
test("time: ratioAt picks the bracket, falls back to the first", () => {
  const list = [{ name: "Morning", start: "06:00", end: "12:00" }, { name: "Rest", start: "12:00", end: "06:00" }];
  assert.equal(ratioAt(list, new Date(2026, 0, 1, 8, 0)).name, "Morning");
  assert.equal(ratioAt(list, new Date(2026, 0, 1, 23, 0)).name, "Rest");
  assert.equal(ratioAt([], new Date()), null);
});
test("time: meal type, duration, clamp", () => {
  assert.equal(autoMealType(new Date(2026, 0, 1, 8, 0)), "breakfast");
  assert.equal(autoMealType(new Date(2026, 0, 1, 19, 0)), "dinner");
  assert.equal(autoMealType(new Date(2026, 0, 1, 23, 0)), "snack");
  assert.equal(formatDuration(90 * 60000), "1h30");
  assert.equal(formatDuration(120 * 60000), "2h");
  assert.equal(formatDuration(5 * 60000), "5m");
  assert.equal(clampNum(15, 0, 10), 10);
});
test("csv: quotes, commas and round trip", () => {
  assert.deepEqual(splitCsvLine('a,"b,c","d ""q"""'), ["a", "b,c", 'd "q"']);
  const csv = toCsv([{ name: 'Jam "x"', carbs: 60 }], ["name", "carbs"]);
  assert.deepEqual(parseCsv(csv), [{ name: 'Jam "x"', carbs: "60" }]);
});
test("recipeTotals uses saved rates, else the library", () => {
  const lib = [{ id: "f1", carbs: 50, kcal: 200 }];
  const r = { finalWeight: 200, items: [{ grams: 100, carbsPer100g: 10, kcalPer100g: 100 }, { grams: 100, foodId: "f1" }] };
  const t = recipeTotals(r, lib);
  assert.equal(t.totalCarbs, 60);
  assert.equal(t.totalKcal, 300);
  assert.equal(t.carbsPer100g, 30);
});
test("import: foods added and updated by name, recipes linked to ingredients", () => {
  const library = [{ id: "f1", name: "Rice", carbs: 1, usageCount: 4 }];
  const recipes = [];
  const foods = parseLibraryFile("foods.csv", "name,carbs_per_100g,is_favorite\nrice,28,yes\nBread,49,\n");
  const ids = (() => { let n = 0; return p => p + (++n); })();
  let res = mergeLibrary(library, recipes, foods, ids);
  assert.deepEqual(res, { foodsAdded: 1, foodsUpdated: 1, recipesAdded: 0, recipesUpdated: 0 });
  assert.equal(library[0].id, "f1");
  assert.equal(library[0].carbs, 28);
  assert.equal(library[0].favorite, true);
  const rec = parseLibraryFile("r.json", JSON.stringify({ recipes: [{ name: "Bowl", items: [{ name: "bread", grams: 50 }] }] }));
  res = mergeLibrary(library, recipes, rec, ids);
  assert.equal(res.recipesAdded, 1);
  assert.equal(recipes[0].items[0].foodId, library[1].id);
  assert.throws(() => parseLibraryFile("x.json", "{nope"));
});
test("meal entry: eating out saves no items; cap is recorded; usage goes up and down", () => {
  const now = new Date(2026, 0, 1, 19, 0);
  const items = [{ refType: "food", refId: "f1", name: "Rice", grams: 100, carbs: 28, kcal: 130 }];
  const computed = { mealDose: 2.5, correctionDose: 0, capped: true, requested: 4 };
  const e = buildMealEntry({ now, mealType: "dinner", periodEntry: { name: "Evening" }, ratioEntry: { name: "Evening", ratio: 10 }, items, eatingOut: false, noInsulin: false, computed, glucoseVal: null });
  assert.equal(e.totalCarbs, 28);
  assert.equal(e.cappedFrom, 4);
  assert.equal(e.periodName, "evening");
  assert.equal(e.ratioValue, 10);
  const out = buildMealEntry({ now, mealType: "dinner", periodEntry: null, ratioEntry: null, items, eatingOut: true, noInsulin: false, computed: { mealDose: 3, correctionDose: 0 }, glucoseVal: null });
  assert.deepEqual(out.items, []);
  assert.equal(out.totalCarbs, 0);
  assert.equal(out.carbsUnknown, true);
  assert.ok(!("cappedFrom" in out));
  const lib = [{ id: "f1" }], recs = [];
  adjustUsage(lib, recs, [{ refType: "food", refId: "f1" }], +1);
  assert.equal(lib[0].usageCount, 1);
  adjustUsage(lib, recs, [{ refType: "food", refId: "f1" }], -1);
  assert.equal(lib[0].usageCount, 0);
  adjustUsage(lib, recs, [{ refType: "food", refId: "f1" }], -1);
  assert.equal(lib[0].usageCount, 0);
});
