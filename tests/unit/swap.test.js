import test from "node:test";
import assert from "node:assert/strict";
import { solveSwap, carbsForGrams, canAdjust, setGrams } from "../../js/swap.js";

const food = (name, grams, per100, extra = {}) => ({ name, grams, carbsPer100g: per100, carbs: Math.round(per100 * grams) / 100, kcalPer100g: 100, kcal: grams, ...extra });

test("the example: 60 g carbs of pasta and bread; add rice, bread adjusts", () => {
  // Pasta 100 g (30 g carbs) + bread 60 g at 50/100 (30 g carbs) = 60 g, the bolus. Add 50 g rice at 28/100 (14 g carbs).
  const items = [food("Pasta", 100, 30), food("Bread", 60, 50), food("Rice", 50, 28)];
  const r = solveSwap({ target: 60, items, adjustIdx: 1 });
  assert.equal(r.status, "ok");
  assert.equal(r.others, 44);
  assert.equal(r.adjustGrams, 32);                       // 16 g carbs left / 0.5 = 32 g of bread
  assert.equal(r.items[1].carbs, 16);
  assert.equal(r.items.reduce((s, i) => s + i.carbs, 0), 60, "the total is exactly what the bolus covered");
  assert.equal(items[1].grams, 60, "the input is not changed");
});

test("the adjusting food's grams are rounded for weighing, its carbs are exactly what is left", () => {
  const r = solveSwap({ target: 45, items: [food("Apple", 100, 12), food("Oats", 40, 66)], adjustIdx: 1 });
  assert.equal(r.items[1].carbs, 33);
  assert.equal(r.adjustGrams, 50);                       // 33 / 0.66 = 50
  const r2 = solveSwap({ target: 45, items: [food("Apple", 100, 12), food("Oats", 40, 61)], adjustIdx: 1 });
  assert.equal(r2.adjustGrams, 54);                      // 33 / 0.61 = 54.1
  assert.ok(Math.abs(carbsForGrams(r2.items[1], r2.adjustGrams) - 33) < 0.5, "rounding the grams moves the real carbs by under half a gram");
});

test("the other foods already have more carbs than the bolus covered", () => {
  const r = solveSwap({ target: 40, items: [food("Pizza", 150, 30), food("Salad", 100, 5)], adjustIdx: 1 });
  assert.equal(r.status, "over");
  assert.equal(r.over, 5);                               // pizza alone is 45 g
  assert.equal(r.items[1].grams, 0);
  assert.equal(r.items[1].carbs, 0);
});

test("exactly at the target leaves the adjusting food at 0 g, which is fine", () => {
  const r = solveSwap({ target: 30, items: [food("Pasta", 100, 30), food("Bread", 60, 50)], adjustIdx: 1 });
  assert.equal(r.status, "ok");
  assert.equal(r.adjustGrams, 0);
});

test("a food with no carbs, or no carbs per 100 g, can't be the one that changes", () => {
  assert.equal(canAdjust(food("Cheese", 30, 0)), false);
  assert.equal(canAdjust({ name: "Typed carbs", carbs: 20, carbsPer100g: null }), false);
  assert.equal(canAdjust(food("Bread", 30, 50)), true);
  const r = solveSwap({ target: 50, items: [food("Bread", 60, 50), food("Cheese", 30, 0)], adjustIdx: 1 });
  assert.equal(r.status, "none");
  assert.equal(solveSwap({ target: 50, items: [food("Bread", 60, 50)], adjustIdx: -1 }).status, "none");
});

test("a food counted in pieces becomes grams once its amount changes", () => {
  const pitta = food("Pitta", 60, 55, { quantity: 1, unitLabel: "pitta", gramsPerUnit: 60, portion: "1" });
  const r = solveSwap({ target: 50, items: [food("Hummus", 50, 14), pitta], adjustIdx: 1 });
  assert.equal(r.items[1].quantity, undefined);
  assert.equal(r.items[1].unitLabel, undefined);
  assert.equal(r.items[1].grams, 78);                    // 43 / 0.55 = 78.2
  assert.equal(r.items[1].kcal, 78);
});

test("setGrams and carbsForGrams", () => {
  const b = food("Bread", 60, 50);
  setGrams(b, "40.4");
  assert.equal(b.grams, 40);
  assert.equal(carbsForGrams(b, 40), 20);
  assert.equal(carbsForGrams(b, -5), 0);
});
