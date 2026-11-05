// Recipes vs the foods they are made of (2.86.0): link by exact name, find changed figures, update only when asked.
import test from "node:test";
import assert from "node:assert/strict";
import { linkIngredients, staleIngredients, refreshIngredients, refreshEffect, recipesUsingFood, staleText, ingredientFood } from "../../js/recipe-check.js";

// Francesco's Banana Bread as saved (5 Nov 2026), with Farina at 90 inside the recipe and 78 in the Library.
const library = () => [
  { id: "zuc", name: "Zucchero", carbs: 100, kcal: 400 },
  { id: "cio", name: "Cioccolata", carbs: 60, kcal: 555 },
  { id: "far", name: "Farina", carbs: 78, kcal: 369 },
  { id: "ban", name: "Banana", carbs: 23, kcal: 89 },
  { id: "pb", name: "Peanut Butter", carbs: 20, kcal: 590 },
  { id: "uov", name: "Uova (per single piece)", carbs: 0, kcal: 136 }
];
const bananaBread = () => ({
  id: "r1", name: "Banana Bread", finalWeight: 647,
  items: [
    { foodId: "zuc", name: "Zucchero", grams: 96, carbsPer100g: 100, kcalPer100g: 400 },
    { foodId: "cio", name: "Cioccolata", grams: 30, carbsPer100g: 60, kcalPer100g: 555 },
    { foodId: "far", name: "Farina", grams: 90, carbsPer100g: 90, kcalPer100g: 369 },
    { foodId: "ban", name: "Banana", grams: 297, carbsPer100g: 23, kcalPer100g: 89 },
    { foodId: "pb", name: "Peanut Butter", grams: 84, carbsPer100g: 20, kcalPer100g: 590 },
    { foodId: "uov", name: "Uova (per single piece)", grams: 50, carbsPer100g: 0, kcalPer100g: 136 }
  ]
});

test("finds the one ingredient whose food changed, with before and after", () => {
  const s = staleIngredients(bananaBread(), library());
  assert.equal(s.length, 1);
  assert.equal(s[0].idx, 2);
  assert.deepEqual([s[0].carbsChanged, s[0].kcalChanged], [true, false]);
  assert.deepEqual(s[0].from, { carbs: 90, kcal: 369 });
  assert.deepEqual(s[0].to, { carbs: 78, kcal: 369 });
  assert.equal(staleText(s[0]), "Farina: carbs 90 → 78 g per 100 g");
});

test("updating changes only the stale figures and gives his real totals", () => {
  const r = bananaBread(), lib = library();
  const s = staleIngredients(r, lib);
  const items = refreshIngredients(r.items, s);
  assert.equal(items[2].carbsPer100g, 78);
  assert.equal(items[2].grams, 90); assert.equal(items[2].foodId, "far"); assert.equal(items[2].name, "Farina");
  for (const i of [0, 1, 3, 4, 5]) assert.deepEqual(items[i], r.items[i]);
  assert.notEqual(items, r.items, "a copy: the recipe itself is untouched until saved");
  assert.equal(r.items[2].carbsPer100g, 90);
  const { before, after } = refreshEffect(r, s, lib);
  assert.equal(before.totalCarbs, 280.1); assert.equal(before.carbsPer100g, 43.3);
  assert.equal(after.totalCarbs, 269.3); assert.equal(after.carbsPer100g, 41.6);
  assert.equal(staleIngredients({ ...r, items }, lib).length, 0, "nothing left to update");
});

test("small rounding differences and a food that lost its kcal don't count", () => {
  const lib = library();
  lib[2] = { ...lib[2], carbs: 90.04, kcal: 369.4 };
  assert.equal(staleIngredients(bananaBread(), lib).length, 0);
  lib[2] = { ...lib[2], carbs: 90, kcal: null };
  assert.equal(staleIngredients(bananaBread(), lib).length, 0, "updating would throw the recipe's kcal away");
  const r = bananaBread(); r.items[2].kcalPer100g = null;
  lib[2] = { ...lib[2], kcal: 369 };
  const s = staleIngredients(r, lib);
  assert.equal(s.length, 1); assert.deepEqual([s[0].carbsChanged, s[0].kcalChanged], [false, true]);
  assert.equal(staleText(s[0]), "Farina: kcal not set → 369 per 100 g");
});

test("unlinked or deleted foods are never stale and never guessed", () => {
  const r = bananaBread();
  r.items[2].foodId = null;
  r.items[0].foodId = "gone";
  assert.equal(staleIngredients(r, library()).length, 0);
  assert.equal(ingredientFood(r.items[0], library()), null);
  assert.deepEqual(staleIngredients(null, library()), []);
  assert.deepEqual(staleIngredients({ items: [["Farina", 90, 90, 369]] }, library()), [], "raw seed arrays are skipped");
});

test("links by exact name only, one match only, and never changes figures", () => {
  const lib = [...library(), { id: "pane1", name: "Pane", carbs: 50 }, { id: "pane2", name: "pane ", carbs: 55 }];
  const r = { name: "X", items: [
    { foodId: null, name: " farina ", grams: 10, carbsPer100g: 90, kcalPer100g: 369 },   // case and spaces: links
    { foodId: "gone", name: "Banana", grams: 10, carbsPer100g: 23, kcalPer100g: 89 },     // dead link: relinks
    { foodId: null, name: "Pane", grams: 10, carbsPer100g: 50 },                          // two foods called Pane: left alone
    { foodId: null, name: "Farin", grams: 10, carbsPer100g: 70 },                         // partial name: left alone
    { foodId: "zuc", name: "Sugar", grams: 10, carbsPer100g: 100 },                       // already linked: kept
    { foodId: null, name: "", grams: 10, carbsPer100g: 0 }
  ] };
  const before = JSON.parse(JSON.stringify(r.items));
  assert.equal(linkIngredients(r, lib), 2);
  assert.deepEqual(r.items.map(i => i.foodId), ["far", "ban", null, null, "zuc", null]);
  r.items.forEach((it, i) => { assert.equal(it.carbsPer100g, before[i].carbsPer100g); assert.equal(it.grams, before[i].grams); assert.equal(it.name, before[i].name); });
  assert.equal(linkIngredients(r, lib), 0, "running again changes nothing");
  assert.equal(linkIngredients(null, lib), 0);
});

test("recipesUsingFood lists the recipes linked to a food", () => {
  const a = bananaBread(), b = { id: "r2", name: "Sfrappole", items: [{ foodId: "far", grams: 200, carbsPer100g: 90 }] }, c = { id: "r3", name: "Salad", items: [] };
  assert.deepEqual(recipesUsingFood([a, b, c], "far").map(r => r.id), ["r1", "r2"]);
  assert.deepEqual(recipesUsingFood([a, b, c], "nope"), []);
});
