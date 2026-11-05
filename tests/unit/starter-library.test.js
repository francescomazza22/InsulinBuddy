// The starter library (2.86.0): foods_data.js no longer carries the old Base44 export, so a brand-new device has nothing
// of its own to merge into the account: what arrives with sign-in is exactly the account's library.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { normalizeState, mergeStates } from "../../js/state.js";

const src = readFileSync(new URL("../../foods_data.js", import.meta.url), "utf8");

test("foods_data.js defines SEED_FOODS as an empty list and nothing else", () => {
  const ctx = {};
  vm.runInNewContext(src, ctx);
  assert.ok(Array.isArray(ctx.SEED_FOODS));
  assert.equal(ctx.SEED_FOODS.length, 0);
  assert.equal(ctx.SEED_RECIPES, undefined, "the old raw Base44 recipes are gone too");
});

test("a fresh device merged with the account ends with exactly the account's library", () => {
  const defaults = () => ({ settings: { isf: 50, target: 100, units: "mgdl", rounding: "0.5", maxDose: 15, timeRatios: [{ id: "a", name: "All day", start: "00:00", end: "24:00", ratio: 10 }] }, library: [], recipes: [], history: [] });
  const fresh = normalizeState({}, defaults);
  assert.equal(fresh.library.length, 0);
  // The account deleted "Dummy meal" long ago (its marker pruned after 90 days) and edited Farina.
  const cloud = { schemaVersion: 2, settingsUpdatedAt: 1, settings: defaults().settings, recipes: [], history: [],
    library: [{ id: "far", name: "Farina", carbs: 78, kcal: 369, updatedAt: 5 }], deleted: { history: {}, library: {}, recipes: {} } };
  const merged = mergeStates(fresh, cloud, defaults);
  assert.deepEqual(merged.library.map(f => [f.id, f.carbs]), [["far", 78]]);
});
