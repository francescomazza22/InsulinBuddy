import test from "node:test";
import assert from "node:assert/strict";
import { fillMissingFoodDetails, stillBlank, FOOD_REFERENCE, PUBLISHED_GI, applyPublishedGi } from "../../js/food-reference.js";

const mk = (name, over = {}) => ({ id: "f-" + name, name, carbs: 50, kcal: 200, fat: null, protein: null, salt: null, gi: null, ...over });

test("fills blanks, case-insensitively, and records what it estimated", () => {
  const lib = [mk("CROISSANT"), mk("Lettuce", { kcal: 15 })];
  const r = fillMissingFoodDetails(lib);
  assert.equal(lib[0].gi, 67); assert.deepEqual(lib[0].estimated, ["gi"]);
  assert.equal(lib[1].gi, 15);
  assert.equal(r.changes.find(c => c.name === "CROISSANT").confidence, "H");
  assert.equal(r.foodsTouched, 2);
});
test("never overwrites anything already entered, including a real 0", () => {
  const lib = [mk("Mozzarella", { fat: 30, protein: 0, salt: 0.9 }), mk("Banana", { gi: 62, salt: 0 })];
  fillMissingFoodDetails(lib);
  assert.equal(lib[0].fat, 30); assert.equal(lib[0].protein, 0); assert.equal(lib[0].salt, 0.9);
  assert.equal(lib[1].gi, 62); assert.equal(lib[1].salt, 0);
});
test("running it twice changes nothing the second time", () => {
  const lib = [mk("Haribo Starmix treat size", { kcal: null }), mk("Parmiggiano Reggiano")];
  const a = fillMissingFoodDetails(lib), snap = JSON.stringify(lib);
  const b = fillMissingFoodDetails(lib);
  assert.ok(a.changes.length >= 5); assert.equal(b.changes.length, 0); assert.equal(JSON.stringify(lib), snap);
});
test("foods it does not know, and zero-carb foods' GI, stay blank", () => {
  const lib = [mk("Mystery bar"), mk("Salmone Fresco", { carbs: 0 })];
  fillMissingFoodDetails(lib);
  assert.equal(lib[0].gi, null); assert.equal(lib[1].gi, null);
  const left = stillBlank(lib);
  assert.ok(left.find(x => x.name === "Mystery bar").missing.includes("gi"));
});
test("every GI in the table is plausible and every value is a number", () => {
  for (const [name, r] of Object.entries(FOOD_REFERENCE)) {
    if (r.gi) { assert.ok(r.gi[0] >= 5 && r.gi[0] <= 100 && ["H", "M"].includes(r.gi[1]), name); }
    for (const k of ["fat", "protein", "salt", "kcal"]) if (r[k] !== undefined) assert.ok(typeof r[k] === "number" && r[k] >= 0, `${name} ${k}`);
    if (r.fat !== undefined) assert.ok(r.fat <= 100, name);
  }
});

test("published GI values: applied to blanks only, any case, not marked estimated; never contradict the reference", () => {
  const lib = [{ id: 1, name: "mela", gi: null }, { id: 2, name: "Banana", gi: 40 }, { id: 3, name: "Unknown thing", gi: null }];
  assert.equal(applyPublishedGi(lib), 1);
  assert.equal(lib[0].gi, 36); assert.equal(lib[1].gi, 40); assert.equal(lib[2].gi, null);
  assert.equal(lib[0].estimated, undefined);
  assert.equal(applyPublishedGi(lib), 0);
  for (const [name, gi] of Object.entries(PUBLISHED_GI)) { const r = FOOD_REFERENCE[name.toLowerCase()]; if (r && r.gi) assert.equal(r.gi[0], gi, name); }
  assert.equal(stillBlank([{ id: 9, name: "Mela", gi: null, fat: 0.2, protein: 0.3, salt: 0, kcal: 52 }]).length, 0);
});
