import test from "node:test";
import assert from "node:assert/strict";
import { parsePortion, FRACTION_CHIPS, WHOLE_CHIP } from "../../js/portion.js";

const BREAD = { dishWeight: 614, slices: 12 };

test("plain grams still work, with a point or a comma, for foods and recipes", () => {
  assert.deepEqual(parsePortion("80"), { ok: true, grams: 80, kind: "grams", label: null, share: null });
  assert.equal(parsePortion("87,5").grams, 87.5, "a comma is a decimal, never 875");
  assert.equal(parsePortion("77", BREAD).grams, 77);
  assert.equal(parsePortion("0").ok, false);
  assert.equal(parsePortion("   ").empty, true);
});

test("fractions of a recipe become that share of the dish's weight", () => {
  const r = parsePortion("1/8", BREAD);
  assert.equal(r.ok, true); assert.equal(r.kind, "fraction"); assert.equal(r.label, "1/8");
  assert.equal(r.grams, 76.8, "614 / 8 = 76.75, shown to 0.1 g");
  assert.equal(parsePortion("1/3", BREAD).grams, 204.7);
  assert.equal(parsePortion("2 / 3", BREAD).grams, 409.3);
  assert.equal(parsePortion("⅓", BREAD).label, "1/3", "the single-character fractions work too");
  assert.equal(parsePortion("1/1", BREAD).grams, 614, "the whole dish");
});

test("a batch weight changes the grams, not the share of the dish", () => {
  const heavy = parsePortion("1/8", { dishWeight: 700, slices: 12 });
  assert.equal(heavy.grams, 87.5);
  assert.equal(heavy.share, 1 / 8);
});

test("slices use the recipe's slice count", () => {
  assert.equal(parsePortion("2 slices", BREAD).grams, 102.3);
  assert.equal(parsePortion("1 slice", BREAD).label, "1 slice");
  assert.equal(parsePortion("1,5 fette", BREAD).grams, 76.8, "Italian and decimal comma");
  assert.match(parsePortion("2 slices", { dishWeight: 614 }).error, /no number of slices yet/);
  assert.match(parsePortion("13 slices", BREAD).error, /more than all of it/);
});

test("nonsense is refused with a reason, never guessed", () => {
  assert.match(parsePortion("1/0", BREAD).error, /divide by 0/);
  assert.match(parsePortion("9/8", BREAD).error, /more than the whole dish/);
  assert.match(parsePortion("0/4", BREAD).error, /greater than 0/);
  assert.match(parsePortion("abc", BREAD).error, /grams, a fraction/);
});

test("fractions and slices are only for recipes", () => {
  assert.match(parsePortion("1/8").error, /work for recipes/);
  assert.match(parsePortion("2 slices").error, /work for recipes/);
});

test("the quick buttons are the five common fractions", () => {
  assert.deepEqual(FRACTION_CHIPS.map(([n, d]) => `${n}/${d}`), ["1/2", "1/3", "1/4", "1/6", "1/8"]);
});

test("'Whole' (or all, intero, 1/1) is the whole dish", () => {
  for (const w of ["Whole", "whole", "all", "intero", "intera", "tutto", "1/1"]) {
    const p = parsePortion(w, { dishWeight: 800 });
    assert.equal(p.ok, true, w); assert.equal(p.grams, 800, w); assert.equal(p.share, 1, w);
  }
  assert.equal(parsePortion("Whole", { dishWeight: 800 }).label, "Whole");
  assert.equal(parsePortion("whole", { dishWeight: null }).ok, false, "only for recipes");
  assert.equal(WHOLE_CHIP, "Whole");
});

import { parseQuantity, QUANTITY_CHIPS } from "../../js/portion.js";
test("quantity foods: whole numbers, decimals and fractions of a unit", () => {
  assert.deepEqual(QUANTITY_CHIPS, ["1", "1/2", "1/3", "1/4", "1/6", "1/8"]);
  assert.deepEqual(parseQuantity("2"), { ok: true, quantity: 2, label: null });
  assert.equal(parseQuantity("1,5").quantity, 1.5, "a comma is a decimal");
  assert.deepEqual(parseQuantity("1/2"), { ok: true, quantity: 0.5, label: "1/2" });
  assert.equal(parseQuantity("1/3").quantity, 1 / 3, "kept exact, not rounded to 0.3");
  assert.deepEqual(parseQuantity("½"), { ok: true, quantity: 0.5, label: "1/2" });
  assert.deepEqual(parseQuantity("1 1/2"), { ok: true, quantity: 1.5, label: "1 1/2" });
  assert.deepEqual(parseQuantity("1½"), { ok: true, quantity: 1.5, label: "1 1/2" });
  assert.equal(parseQuantity("3/2").quantity, 1.5, "more than one unit is fine for a quantity");
  assert.equal(parseQuantity("").empty, true);
  assert.match(parseQuantity("0").error, /greater than 0/);
  assert.match(parseQuantity("0/4").error, /greater than 0/);
  assert.match(parseQuantity("1/0").error, /divide by 0/);
  assert.match(parseQuantity("two").error, /how many/);
  assert.match(parseQuantity("-1").error, /how many|greater than 0/);
});
