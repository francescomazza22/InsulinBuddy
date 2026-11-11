import { test } from "node:test";
import assert from "node:assert/strict";
import { missingReport, per100Index, mealNutrients, eatingOutNutrients, extraFigures, dailyGuide, nutrientSummary, compareToGuide, UK_RI } from "../../js/nutrients.js";
import { calorieRule, extraFromFood } from "../../js/calories.js";
import { shiftDay } from "../../js/day-timeline.js";

const NOW = new Date(2026, 10, 3, 18, 0).getTime();
const at = (daysBack, h, m = 0) => { const d = new Date(shiftDay(NOW, -daysBack)); d.setHours(h, m, 0, 0); return d.getTime(); };
const close = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);
const library = [
  { id: "bread", name: "Pane comune", carbs: 65, kcal: 300, protein: 8, fat: 1.5, salt: 1.2 },
  { id: "moz", name: "Mozzarella", carbs: 1, kcal: 250, protein: 18, fat: 19, salt: 0.5 },
  { id: "toms", name: "Pomodori", carbs: 3, kcal: 18, protein: 1, fat: 0.2, salt: null },
  { id: "pasta", name: "Pasta", carbs: 72, kcal: 355, protein: 12.5, fat: 1.5, salt: 0 }
];
const recipes = [{ id: "sauce", name: "Pasta al pomodoro", finalWeight: 500, items: [{ foodId: "pasta", grams: 200 }, { foodId: "toms", grams: 300 }] }];
const me = { sex: "male", birthYear: 1985, heightCm: 180, weightKg: 75, lifeFactor: 1.3, eatingOutMultiplier: 2, eatingOutKcal: 900, extras: [
  { id: "olive-oil", name: "Olive oil", unit: "tbsp", kcalPerUnit: 119, perDay: 2 },
  { id: "choc", name: "Chocolate", unit: "Unit", kcalPerUnit: 80, perDay: 1 }] };

test("a logged food: library figures per 100 g x grams; carbs as logged", () => {
  const idx = per100Index(library, recipes);
  const m = mealNutrients({ totalCarbs: 39, items: [{ refType: "food", refId: "bread", grams: 60 }] }, idx);
  close(m.totals.protein, 4.8); close(m.totals.fat, 0.9); close(m.totals.salt, 0.72); assert.equal(m.totals.carbs, 39);
});

test("a recipe: per 100 g of the dish from its ingredients; an ingredient without a figure is a gap", () => {
  const idx = per100Index(library, recipes);
  const r = idx.get("recipe:sauce");
  close(r.protein, (25 + 3) / 5); close(r.fat, (3 + 0.6) / 5);   // per 100 g of a 500 g dish
  assert.equal(r.missing.salt, 1);                                // tomatoes have no salt figure
  const m = mealNutrients({ totalCarbs: 50, items: [{ refType: "recipe", refId: "sauce", grams: 250 }] }, idx);
  close(m.totals.protein, 14); assert.equal(m.missing.recipeGaps, 1);
  const unknown = mealNutrients({ totalCarbs: 5, items: [{ refType: "food", refId: "gone", grams: 50 }] }, idx);
  assert.deepEqual([unknown.missing.protein, unknown.missing.fat, unknown.missing.salt], [1, 1, 1]);
});

test("eating out: carbs from the insulin, the rest 70% fat / 30% protein, salt 2.5 g per 1,000 kcal", () => {
  const n = eatingOutNutrients({ kcal: 1020, from: "insulin", carbs: 127.5 }, 2);
  close(n.carbs, 127.5); close(n.fat, 510 * 0.7 / 9); close(n.protein, 510 * 0.3 / 4); close(n.salt, 2.55);
  const typed = eatingOutNutrients({ kcal: 800, from: "logged" }, 2);   // no insulin carbs: half the calories from carbs
  close(typed.carbs, 100); close(typed.fat, 400 * 0.7 / 9);
});

test("extras: their own figures, the built-in olive oil / flat white, or none", () => {
  assert.deepEqual(extraFigures({ id: "olive-oil", kcalPerUnit: 119 }), { protein: 0, carbs: 0, fat: 13.5, salt: 0 });
  assert.equal(extraFigures({ id: "olive-oil", kcalPerUnit: 300 }), null);   // not the standard tbsp any more
  assert.equal(extraFigures({ id: "choc", kcalPerUnit: 80 }), null);
  const fromLib = extraFromFood({ name: "Mozzarella", kcalPer100g: 250, carbsPer100g: 1, proteinPer100g: 18, fatPer100g: 19, saltPer100g: 0.5 }, 125);
  assert.deepEqual([fromLib.proteinPerUnit, fromLib.carbsPerUnit, fromLib.fatPerUnit, fromLib.saltPerUnit], [22.5, 1.25, 23.75, 0.63]);
  assert.deepEqual(extraFigures(fromLib), { protein: 22.5, carbs: 1.25, fat: 23.75, salt: 0.63 });
  // and the figures survive the settings clean-up
  const r = calorieRule({ extras: [{ id: "m", ...fromLib }] }, NOW);
  assert.equal(r.extras[0].proteinPerUnit, 22.5);
});

test("the guide: UK Reference Intakes, fat and carbs scaled to the day's need, protein 0.75 g/kg, salt 6 g", () => {
  const g = dailyGuide({ weightKg: 75 }, 2400);
  close(g.fat, 84); close(g.carbs, 312); close(g.protein, 56.25); assert.equal(g.salt, 6);
  const plain = dailyGuide({}, null);
  assert.deepEqual([plain.protein, plain.carbs, plain.fat, plain.salt], [UK_RI.protein, UK_RI.carbs, UK_RI.fat, UK_RI.salt]);
  assert.equal(compareToGuide("protein", 40, 56), "lower"); assert.equal(compareToGuide("fat", 80, 84), "about right");
  assert.equal(compareToGuide("carbs", 400, 312), "higher"); assert.equal(compareToGuide("salt", 6.5, 6), "higher"); assert.equal(compareToGuide("salt", 3, 6), "within");
});

test("a day: meals + eating out + extras, later meals not yet, gaps reported; averages over complete days", () => {
  const history = [
    { id: "b", ts: at(1, 8), mealType: "breakfast", totalCarbs: 39, totalKcal: 180, items: [{ refType: "food", refId: "bread", grams: 60, kcal: 180 }], mealDose: 4 },
    { id: "eo", ts: at(1, 13), mealType: "lunch", carbsUnknown: true, items: [], totalCarbs: 0, totalKcal: 0, mealDose: 10, correctionDose: 0, ratioValue: 8 },
    { id: "t", ts: at(0, 8), mealType: "breakfast", totalCarbs: 39, totalKcal: 180, items: [{ refType: "food", refId: "bread", grams: 60, kcal: 180 }], mealDose: 4 },
    { id: "later", ts: at(0, 20), mealType: "dinner", totalCarbs: 72, totalKcal: 355, items: [{ refType: "food", refId: "pasta", grams: 100, kcal: 355 }], mealDose: 7 }
  ];
  const s = nutrientSummary(history, { calories: me }, library, recipes, { days: 2, now: NOW });
  const [y, t] = s.days;
  // yesterday: bread 4.8 g protein + eating out (10u x 8 = 80 g carbs, 640 kcal: 320 of it fat/protein) + oil 27 g fat
  close(y.totals.carbs, 39 + 80); close(y.totals.protein, 4.8 + 320 * 0.3 / 4); close(y.totals.fat, 0.9 + 320 * 0.7 / 9 + 27);
  assert.equal(y.estimated, 1); assert.deepEqual(y.missing.extras, ["Chocolate"]);
  // today: the 20:00 pasta isn't counted yet
  close(t.totals.carbs, 39); close(t.totals.protein, 4.8);
  assert.equal(s.avg.daysUsed, 1); close(s.avg.totals.carbs, 119); assert.equal(s.avg.daysEstimated, 1);
  close(y.guide.fat, 70 * y.needKcal / 2000); close(y.guide.protein, 56.25);
});

test("missing figures (2.103.0): foods eaten recently first, recipes with gaps, deleted foods, extras without a breakdown", () => {
  const lib = [
    { id: "ban", name: "Banana", kcal: 89, protein: 1.1, fat: 0.3, salt: null },
    { id: "flour", name: "Farina", kcal: null, protein: null, fat: null, salt: null },
    { id: "ok", name: "Pasta", kcal: 355, protein: 12.5, fat: 1.5, salt: 0 },
    { id: "rare", name: "Senape", kcal: 70, protein: null, fat: 4, salt: 2.5 }
  ];
  const recs = [{ id: "bb", name: "Banana Bread", finalWeight: 600, items: [{ foodId: "flour", name: "Farina", grams: 200 }, { foodId: "ban", grams: 300 }, { foodId: null, name: "Pancakes", grams: 100 }, { foodId: "x", name: "Old sugar", grams: 50 }] },
    { id: "fine", name: "Pasta al sugo", finalWeight: 300, items: [{ foodId: "ok", grams: 100 }] }];
  const hist = [
    { ts: at(1, 8), items: [{ refType: "food", refId: "ban", grams: 120, name: "Banana" }, { refType: "recipe", refId: "bb", grams: 50, name: "Banana Bread" }] },
    { ts: at(2, 8), items: [{ refType: "food", refId: "ban", grams: 100, name: "Banana" }, { refType: "food", refId: "deleted", grams: 30, name: "Old crackers" }] },
    { ts: at(40, 8), items: [{ refType: "food", refId: "rare", grams: 10, name: "Senape" }] }   // older than 30 days
  ];
  const extras = [{ id: "olive-oil", name: "Olive oil", kcalPerUnit: 119 }, { id: "choc", name: "Chocolate", kcalPerUnit: 80 }];
  const r = missingReport(hist, lib, recs, extras, { days: 30, now: NOW });
  assert.deepEqual(r.eatenFoods.map(x => [x.name, x.missing.join(","), x.times]), [["Banana", "salt", 2]]);
  assert.deepEqual(r.otherFoods.map(x => x.name), ["Farina", "Senape"]);
  assert.deepEqual(r.recipes.map(x => [x.name, x.times, x.problems.map(p => `${p.name}: ${p.issue}`)]), [["Banana Bread", 1, [
    "Farina: no kcal, protein, fat, salt", "Banana: no salt", "Pancakes: not linked to a library food", "Old sugar: no longer in your library"]]]);
  assert.deepEqual(r.gone.map(x => [x.name, x.times]), [["Old crackers", 1]]);
  assert.deepEqual(r.extras.map(x => x.name), ["Chocolate"]);
  assert.equal(r.total, 3 + 1 + 1 + 1);
});
