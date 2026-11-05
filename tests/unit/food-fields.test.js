// Food fields (2.86.0): where the figures come from, and unit names that are names, not amounts.
import test from "node:test";
import assert from "node:assert/strict";
import { FOOD_SOURCES, foodSource, cleanUnitLabel } from "../../js/core/food-fields.js";
import { parseLibraryFile, mergeLibrary } from "../../js/core/library.js";
import { validateFood } from "../../js/core/schema.js";

test("source reads label / estimate, anything else is not said", () => {
  assert.deepEqual(FOOD_SOURCES.map(o => o.id), ["", "label", "estimate"]);
  for (const v of ["label", " Label ", "pack label", "etichetta"]) assert.equal(foodSource(v), "label", v);
  for (const v of ["estimate", "Estimated", "stima"]) assert.equal(foodSource(v), "estimate", v);
  for (const v of ["", null, undefined, "guess", "lab"]) assert.equal(foodSource(v), null, String(v));
});

test("unit names drop a leading 1, nothing else", () => {
  assert.equal(cleanUnitLabel("1 bag"), "bag");
  assert.equal(cleanUnitLabel("  slice "), "slice");
  assert.equal(cleanUnitLabel("1"), "1");
  assert.equal(cleanUnitLabel("10 pack"), "10 pack");
  assert.equal(cleanUnitLabel("12 biscuits"), "12 biscuits");
  assert.equal(cleanUnitLabel(null), "");
});

test("schema accepts the two sources and empty, warns on anything else", () => {
  for (const source of [undefined, null, "label", "estimate"]) assert.deepEqual(validateFood({ name: "Rice", carbs: 28, source }), [], String(source));
  const p = validateFood({ name: "Rice", carbs: 28, source: "guess" });
  assert.equal(p.length, 1); assert.equal(p[0].severity, "warn");
});

test("library files: a source column is read; an older file without it never wipes a saved source", () => {
  const head = "name,carbs_per_100g";
  const withCol = parseLibraryFile("Food_export.csv", `${head},source\n"Farina","78","label"\n"Torta","40","estimate"\n"Riso","76",""`);
  assert.deepEqual(withCol.foods.map(f => f.source), ["label", "estimate", null]);
  const old = parseLibraryFile("Food_export.csv", `${head}\n"Farina","78"`);
  assert.equal("source" in old.foods[0], false);
  const library = [{ id: "far", name: "Farina", carbs: 76, source: "label" }];
  mergeLibrary(library, [], old, p => p + "x");
  assert.equal(library[0].carbs, 78); assert.equal(library[0].source, "label");
});
