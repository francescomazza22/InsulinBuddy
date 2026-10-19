import test from "node:test";
import assert from "node:assert/strict";
import { doseBadge } from "../../js/history.js";

test("a plain meal dose is just the number", () => assert.deepEqual(doseBadge({ mealType: "lunch", mealDose: 5, correctionDose: 0, items: [{}] }), { kind: "meal", main: "5 u", sub: "" }));
test("meal plus correction shows the total and the split", () => assert.deepEqual(doseBadge({ mealType: "lunch", mealDose: 2, correctionDose: 1.5, items: [{}] }), { kind: "meal", main: "3.5 u", sub: "2 meal + 1.5 corr." }));
test("a reduction shows the net dose and the cut", () => assert.deepEqual(doseBadge({ mealType: "lunch", mealDose: 3, correctionDose: -1, items: [{}] }), { kind: "meal", main: "2 u", sub: "3 meal − 1 cut" }));
test("a treated low never shows insulin", () => assert.equal(doseBadge({ noInsulin: true, mealDose: 4 }).kind, "low"));
test("a correction-only entry is labelled a correction", () => {
  assert.deepEqual(doseBadge({ mealType: "correction", mealDose: 0, correctionDose: 2, items: [] }), { kind: "correction", main: "2 u", sub: "correction" });
  assert.equal(doseBadge({ mealType: "snack", mealDose: 0, correctionDose: 2, items: [] }).kind, "correction");
});
test("the net can never read below zero", () => assert.equal(doseBadge({ mealType: "lunch", mealDose: 1, correctionDose: -3, items: [{}] }).main, "0 u"));
