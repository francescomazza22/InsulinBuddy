import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { recipeTotals, repairRecipe } from "../../js/core/library.js";
import { SEED_RECIPES } from "../../js/seed-recipes.js";

// A fresh library (new device or reset) used to copy SEED_RECIPES in raw: items as [name, grams, carbs, kcal]
// arrays and no final weight, so their totals came out blank and they couldn't be used in the Calculator.
const raw = () => structuredClone(SEED_RECIPES.find(r => /Where Pancakes/.test(r.name)));

test("seed recipes: a raw copy is repaired into readable ingredients with the right totals", () => {
  const r = raw();
  assert.ok(Number.isNaN(recipeTotals(r, []).totalCarbs), "raw copy is unreadable before the repair");
  assert.equal(repairRecipe(r, []), true);
  assert.deepEqual(r.items[0], { foodId: null, name: "Pancakes (plain, American style)", grams: 180, carbsPer100g: 27, kcalPer100g: 227 });
  assert.equal(r.finalWeight, 340);
  const t = recipeTotals(r, []);
  assert.equal(t.totalCarbs, 81.4);
  assert.equal(t.carbsPer100g, 23.9);
  assert.equal(typeof r.id, "string");
  assert.ok(!("key" in r));
});

test("seed recipes: repair links ingredients to library foods by name and leaves good recipes alone", () => {
  const r = raw();
  repairRecipe(r, [{ id: "food-1", name: "pancakes (plain, american style)", carbs: 99 }]);
  assert.equal(r.items[0].foodId, "food-1");
  assert.equal(r.items[0].carbsPer100g, 27, "keeps the recipe's own rate");
  const good = { id: "recipe-x", name: "Mine", finalWeight: 200, items: [{ foodId: null, name: "Rice", grams: 200, carbsPer100g: 28, kcalPer100g: 130 }] };
  const before = JSON.stringify(good);
  assert.equal(repairRecipe(good, []), false);
  assert.equal(JSON.stringify(good), before);
});

test("seed recipes: a new library no longer starts with raw copies", () => {
  const src = fs.readFileSync(new URL("../../app.js", import.meta.url), "utf8");
  assert.ok(!/recipes:\s*structuredClone\([^)]*SEED_RECIPES/.test(src), "defaultState must not copy SEED_RECIPES raw");
  assert.match(src, /repairRecipe\(/);
});
