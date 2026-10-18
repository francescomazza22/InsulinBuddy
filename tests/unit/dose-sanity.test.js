import test from "node:test";
import assert from "node:assert/strict";
import { sanityPool, doseSanity } from "../../js/dose-sanity.js";

const NOW = Date.UTC(2026, 9, 18, 12), DAY = 86400000;
const hist = (n, over = {}) => Array.from({ length: n }, (_, i) => ({ ts: NOW - (i + 1) * DAY, mealDose: 6, correctionDose: 0, totalCarbs: 60, ...over }));

test("the pool keeps recent insulin meals only", () => {
  const h = [...hist(3), { ts: NOW - 200 * DAY, mealDose: 5, totalCarbs: 50 }, { ts: NOW - DAY, noInsulin: true, mealDose: 0, totalCarbs: 15 }, { ts: NOW - DAY, entryType: "basal", basalDose: 20 }, { ts: NOW - DAY, mealDose: 12, correctionDose: -1, totalCarbs: 100 }];
  const p = sanityPool(h, NOW);
  assert.equal(p.length, 4);
  assert.deepEqual(p[3], { carbs: 100, meal: 12, total: 11 });
});
test("not enough history: never speaks up", () => assert.equal(doseSanity(sanityPool(hist(5), NOW), { carbs: 60, mealDose: 20, finalDose: 20 }), null));
test("a normal dose is left alone", () => assert.equal(doseSanity(sanityPool(hist(20), NOW), { carbs: 60, mealDose: 6, finalDose: 6 }), null));
test("a dose far above anything recent is flagged (a slipped decimal)", () => {
  const r = doseSanity(sanityPool(hist(20), NOW), { carbs: 60, mealDose: 15, finalDose: 15 });
  assert.equal(r.kind, "big"); assert.match(r.text, /largest was 6 u/);
});
test("a meal of similar size with a much bigger dose than usual is flagged", () => {
  const pool = sanityPool([...hist(12, { totalCarbs: 20, mealDose: 2 }), ...hist(6, { totalCarbs: 60, mealDose: 6 }), ...hist(4, { totalCarbs: 120, mealDose: 12 })], NOW);
  const r = doseSanity(pool, { carbs: 60, mealDose: 9.5, finalDose: 9.5 });
  assert.equal(r.kind, "larger"); assert.match(r.text, /about 6 u/);
});
test("a much smaller dose than usual for the same size meal is flagged", () => {
  const r = doseSanity(sanityPool(hist(20), NOW), { carbs: 60, mealDose: 2.5, finalDose: 2.5 });
  assert.equal(r.kind, "smaller");
});
test("small doses and tiny meals never trigger it", () => {
  assert.equal(doseSanity(sanityPool(hist(20), NOW), { carbs: 5, mealDose: 0.5, finalDose: 0.5 }), null);
  assert.equal(doseSanity(sanityPool(hist(20, { mealDose: 1, totalCarbs: 10 }), NOW), { carbs: 10, mealDose: 2.5, finalDose: 2.5 }), null);
});
