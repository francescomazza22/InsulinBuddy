// 2.77.2: Settings > Sync said "74 meals loaded" while Insights said 42 meals: the 74 included basal doses and
// activities. Counts now name each kind.
import test from "node:test";
import assert from "node:assert/strict";
import { entryCountText, makeBasalEntry } from "../../js/history.js";
import { makeActivityEntry } from "../../js/activity.js";

const meal = (id, ts) => ({ id, ts, items: [{ name: "Pane" }], totalCarbs: 40, mealDose: 4, correctionDose: 0 });
const T = Date.UTC(2026, 9, 30, 12);

test("meals, basal doses and activities are counted separately; empty kinds are left out", () => {
  const h = [meal("a", T), meal("b", T + 1), makeBasalEntry({ units: 10, ts: T, slot: "am", now: T }), makeActivityEntry({ type: "run", minutes: 30, intensity: "moderate", ts: T, now: T })];
  assert.equal(entryCountText(h), "2 meals · 1 basal dose · 1 activity");
  assert.equal(entryCountText([meal("a", T)]), "1 meal");
  assert.equal(entryCountText([makeBasalEntry({ units: 10, ts: T, slot: "am", now: T }), makeBasalEntry({ units: 18, ts: T + 9, slot: "pm", now: T + 9 })]), "2 basal doses");
});

test("nothing logged says so", () => {
  assert.equal(entryCountText([]), "0 meals");
  assert.equal(entryCountText(undefined), "0 meals");
});
