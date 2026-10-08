// js/foods.js and js/ratios.js: the food-list and time-of-day ratio logic, moved out of app.js and made pure.
import { test } from "node:test";
import assert from "node:assert/strict";
import { recipeTotals, pickableItems } from "../../js/foods.js";
import { toMinutes, inTimeRange, timeRatioAt } from "../../js/ratios.js";

const library = [
  { id: "f1", name: "Bread", carbs: 50, kcal: 260, usageCount: 2 },
  { id: "f2", name: "Slice", carbs: 30, kcal: 270, unitBased: true, unitLabel: "slice", gramsPerUnit: 110 }
];

test("recipeTotals: per-ingredient snapshot, falling back to the library for old recipes", () => {
  const t = recipeTotals({ items: [{ foodId: "f1", grams: 300, carbsPer100g: 50, kcalPer100g: 260 }], finalWeight: 500 });
  assert.deepEqual(t, { totalCarbs: 150, totalKcal: 780, carbsPer100g: 30, kcalPer100g: 156 });
  const old = recipeTotals({ items: [{ foodId: "f1", grams: 300 }], finalWeight: 500 }, library);
  assert.equal(old.totalCarbs, 150);
  assert.equal(recipeTotals({ items: [{ foodId: "f1", grams: 100, carbsPer100g: 50 }] }).carbsPer100g, null, "no final weight yet");
});

test("pickableItems: recipes first, only recipes with a final weight, unit-based foods keep their unit", () => {
  const recipes = [{ id: "r1", name: "Cake", items: [{ foodId: "f1", grams: 100, carbsPer100g: 50 }], finalWeight: 200 }, { id: "r2", name: "Draft", items: [], finalWeight: null }];
  const items = pickableItems(library, recipes);
  assert.deepEqual(items.map(i => i.id), ["recipe:r1", "food:f1", "food:f2"]);
  assert.equal(items[0].carbsPer100g, 25);
  assert.equal(items[2].unitBased, true);
  assert.equal(items[2].gramsPerUnit, 110);
});

test("time ranges, including one that wraps past midnight", () => {
  assert.equal(toMinutes("13:30"), 810);
  assert.equal(inTimeRange(toMinutes("23:45"), "23:30", "05:30"), true);
  assert.equal(inTimeRange(toMinutes("05:30"), "23:30", "05:30"), false, "end is exclusive");
  assert.equal(inTimeRange(toMinutes("12:00"), "08:00", "08:00"), true, "same start and end = all day");
  const ratios = [
    { id: "m", start: "05:30", end: "11:00", ratio: 10 },
    { id: "n", start: "23:30", end: "05:30", ratio: 12 }
  ];
  const at = hhmm => { const d = new Date(2026, 9, 8); d.setHours(...hhmm.split(":").map(Number)); return d; };
  assert.equal(timeRatioAt(ratios, at("07:00")).id, "m");
  assert.equal(timeRatioAt(ratios, at("02:00")).id, "n");
  assert.equal(timeRatioAt(ratios, at("15:00")).id, "m", "a gap falls back to the first range");
  assert.equal(timeRatioAt([], at("15:00")), null);
});
