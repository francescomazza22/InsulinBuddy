import test from "node:test";
import assert from "node:assert/strict";
import { ratioWasApplied, ratioByBracket } from "../../js/calc.js";

const settings = {
  timeRatios: [{ name: "Morning", ratio: 10, color: "#1F9E93", start: "05:30", end: "11:30" }, { name: "Lunch", ratio: 8, color: "#D6A419", start: "11:30", end: "15:00" }, { name: "Night", ratio: 12, color: "#D9534F", start: "23:30", end: "05:30" }],
  activityRatios: [{ name: "Sport", ratio: 18, color: "#8B5CF6" }]
};
const meal = (label, ratio, extra = {}) => ({ mealType: "lunch", ratioLabel: label, ratioValue: ratio, totalCarbs: 50, mealDose: 5, ...extra });

test("the ratio counts only where it decided the meal dose", () => {
  assert.equal(ratioWasApplied(meal("Morning", 10)), true);
  assert.equal(ratioWasApplied(meal("Morning", 10, { noInsulin: true })), false, "a low treated without insulin");
  assert.equal(ratioWasApplied(meal("Morning", 10, { carbsUnknown: true, totalCarbs: 0 })), false, "Eating Out");
  assert.equal(ratioWasApplied(meal("Morning", 10, { totalCarbs: 0, mealDose: 0, correctionDose: 2 })), false, "a correction on its own");
  assert.equal(ratioWasApplied(meal("", null)), false, "no ratio saved (older entry)");
  assert.equal(ratioWasApplied({ entryType: "basal", mealType: "basal", ratioValue: null }), false, "basal");
});

test("average ratio per bracket, with counts and ranges; every current bracket gets a row", () => {
  const entries = [meal("Morning", 10), meal("Morning", 12), meal("Morning", 11), meal("Lunch", 8), meal("Sport", 18),
    meal("Morning", 10, { noInsulin: true }), { mealType: "basal", entryType: "basal" }];
  const r = ratioByBracket(entries, settings);
  assert.deepEqual(r.rows.map(x => x.label), ["Morning", "Lunch", "Night", "Sport"]);
  const m = r.rows[0];
  assert.equal(m.count, 3); assert.equal(m.avg, 11); assert.equal(m.min, 10); assert.equal(m.max, 12); assert.equal(m.current, 10);
  assert.equal(r.rows[2].count, 0); assert.equal(r.rows[2].avg, null, "an unused bracket is still listed");
  assert.equal(r.rows[3].kind, "activity");
  assert.equal(r.total, 5);
});

test("a bracket that no longer exists still shows if it was used; entries without a saved ratio are counted aside", () => {
  const r = ratioByBracket([meal("Brunch", 9), meal("", null), meal("Morning", null)], settings);
  const brunch = r.rows.find(x => x.label === "Brunch");
  assert.ok(brunch && brunch.avg === 9 && brunch.kind === "other");
  assert.equal(r.rows[r.rows.length - 1].label, "Brunch", "after the current brackets");
  assert.equal(r.unrecorded, 2);
});

test("nothing to average gives an empty result, not an error", () => {
  const r = ratioByBracket([], settings);
  assert.equal(r.total, 0); assert.equal(r.unrecorded, 0); assert.equal(r.rows.length, 4);
  assert.deepEqual(ratioByBracket(null, null).rows, []);
});

import { idealRatioByBracket } from "../../js/calc.js";
const H = 3600000, T0 = 1_700_000_000_000;
const dosed = (ts, label, ratio, carbs, dose, extra = {}) => ({ ts, mealType: "lunch", ratioLabel: label, ratioValue: ratio, totalCarbs: carbs, mealDose: dose, correctionDose: 0, noInsulin: false, ...extra });
const low = (ts, carbs) => ({ ts, mealType: "snack", noInsulin: true, totalCarbs: carbs, mealDose: 0, correctionDose: 0 });

test("ideal ratio: low-treatment carbs within the window are counted into the meal before them", () => {
  // 50 g at 1:10 (5 u), then 15 g to treat a low 2 h later: the same 5 u would have matched 65 g -> 1:13
  const r = idealRatioByBracket([dosed(T0, "Morning", 10, 50, 5), low(T0 + 2 * H, 15)], settings, 3);
  const m = r.rows[0];
  assert.equal(m.used, 10); assert.ok(Math.abs(m.ideal - 13) < 1e-9, String(m.ideal));
  assert.equal(m.affected, 1); assert.equal(m.rescueCarbs, 15); assert.equal(r.lowsCounted, 1); assert.equal(r.rescueCarbs, 15);
});

test("ideal ratio: a low outside the window, or before any injection, is not counted", () => {
  const r = idealRatioByBracket([low(T0 - H, 15), dosed(T0, "Morning", 10, 50, 5), low(T0 + 3.5 * H, 15)], settings, 3);
  assert.equal(r.rows[0].ideal, 10); assert.equal(r.rows[0].affected, 0);
  assert.equal(r.lowsCounted, 0); assert.equal(r.lowsUnattached, 2);
  assert.ok(idealRatioByBracket([dosed(T0, "Morning", 10, 50, 5), low(T0 + 3.5 * H, 15)], settings, 4).rows[0].affected === 1, "a wider window reaches it");
});

test("ideal ratio: the low is credited to the nearest injection before it, never twice", () => {
  const r = idealRatioByBracket([dosed(T0, "Morning", 10, 50, 5), dosed(T0 + 2 * H, "Lunch", 8, 40, 5), low(T0 + 3 * H, 12)], settings, 3);
  assert.equal(r.rows[0].affected, 0, "the earlier meal gets nothing");
  assert.equal(r.rows[1].affected, 1); assert.ok(Math.abs(r.rows[1].ideal - 8 * 52 / 40) < 1e-9);
  assert.equal(r.lowsCounted, 1);
});

test("ideal ratio: a low after a correction-only dose or an Eating Out entry has no ratio to adjust, so is set aside", () => {
  const corr = { ts: T0, mealType: "correction", noInsulin: false, totalCarbs: 0, mealDose: 0, correctionDose: 2, ratioLabel: "Morning", ratioValue: 10 };
  const r = idealRatioByBracket([corr, low(T0 + H, 15)], settings, 3);
  assert.equal(r.lowsCounted, 0); assert.equal(r.lowsUnattached, 1);
});

test("ideal ratio: with no lows it equals the ratio used, and brackets are the same as the other card", () => {
  const r = idealRatioByBracket([dosed(T0, "Morning", 10, 50, 5), dosed(T0 + 24 * H, "Morning", 12, 60, 5)], settings, 3);
  assert.equal(r.rows[0].ideal, r.rows[0].used); assert.equal(r.rows[0].used, 11);
  assert.deepEqual(r.rows.map(x => x.label), ["Morning", "Lunch", "Night", "Sport"]);
  assert.equal(idealRatioByBracket(null, null).rows.length, 0);
});

import { buildTrendBuckets } from "../../js/calc.js";
test("daily carbs are split into meal carbs and low-treatment carbs", () => {
  const now = new Date(2026, 9, 10, 18, 0).getTime();
  const at = h => new Date(2026, 9, 10, h, 0).getTime();
  const hist = [
    { id: "a", ts: at(8), mealType: "breakfast", totalCarbs: 50, mealDose: 5, correctionDose: 0 },
    { id: "b", ts: at(11), mealType: "snack", noInsulin: true, totalCarbs: 15, mealDose: 0, correctionDose: 0 },
    { id: "c", ts: at(13), mealType: "lunch", totalCarbs: 60, mealDose: 6, correctionDose: 0 }
  ];
  const { buckets } = buildTrendBuckets(hist, 3, now);
  const today = buckets[buckets.length - 1];
  assert.equal(today.carbs, 125); assert.equal(today.mealCarbs, 110); assert.equal(today.lowCarbs, 15);
  assert.equal(buckets[0].mealCarbs, 0); assert.equal(buckets[0].lowCarbs, 0);
});

// ---- 2.68.2: follow-up corrections count too (Francesco: "it should include all the treating lows and the correction") ----
const corrAt = (ts, units) => ({ ts, mealType: "correction", noInsulin: false, totalCarbs: 0, items: [], mealDose: 0, correctionDose: units });
test("ideal ratio: a correction after a meal means the meal needed more insulin", () => {
  // 50 g at 1:10 (5 u), then 1.5 u to correct a high 2 h later: 6.5 u matched 50 g -> 1:7.7
  const r = idealRatioByBracket([dosed(T0, "Morning", 10, 50, 5), corrAt(T0 + 2 * H, 1.5)], settings, 3);
  const m = r.rows[0];
  assert.ok(Math.abs(m.ideal - 10 * 50 / (50 + 15)) < 1e-9, String(m.ideal));
  assert.equal(m.affected, 1); assert.equal(m.extraUnits, 1.5);
  assert.equal(r.correctionsCounted, 1); assert.equal(r.correctionUnits, 1.5);
});
test("ideal ratio: a low treated after a follow-up correction still belongs to the meal", () => {
  // meal 50 g / 5 u, correction 1 u at +1.5 h, then 15 g for a low at +2.5 h: 6 u matched 65 g -> 1:10.8
  const r = idealRatioByBracket([dosed(T0, "Morning", 10, 50, 5), corrAt(T0 + 1.5 * H, 1), low(T0 + 2.5 * H, 15)], settings, 3);
  assert.ok(Math.abs(r.rows[0].ideal - 10 * 65 / (50 + 10)) < 1e-9, String(r.rows[0].ideal));
  assert.equal(r.lowsCounted, 1); assert.equal(r.correctionsCounted, 1); assert.equal(r.lowsUnattached, 0);
});
test("ideal ratio: the correction part of the NEXT meal, within the window, counts for the meal before", () => {
  // high again at the next meal 2.5 h later, so 1 u of correction was added to it: that is the first meal's shortfall
  const r = idealRatioByBracket([dosed(T0, "Morning", 10, 50, 5), dosed(T0 + 2.5 * H, "Lunch", 8, 40, 5, { correctionDose: 1 })], settings, 3);
  assert.ok(Math.abs(r.rows[0].ideal - 10 * 50 / (50 + 10)) < 1e-9, String(r.rows[0].ideal));
  assert.equal(r.rows[1].ideal, 8, "a meal's own mealtime correction is for the starting glucose, not its carbs");
});
test("ideal ratio: corrections outside the window, with no meal before, or after an Eating Out entry are set aside", () => {
  const settings2 = settings;
  const late = idealRatioByBracket([dosed(T0, "Morning", 10, 50, 5), corrAt(T0 + 3.5 * H, 1)], settings2, 3);
  assert.equal(late.rows[0].ideal, 10); assert.equal(late.correctionsCounted, 0); assert.equal(late.correctionsUnattached, 1);
  const alone = idealRatioByBracket([corrAt(T0, 2)], settings2, 3);
  assert.equal(alone.correctionsUnattached, 1);
  const eatingOut = { ts: T0 + H, mealType: "dinner", carbsUnknown: true, noInsulin: false, totalCarbs: 0, mealDose: 3, correctionDose: 0 };
  const eo = idealRatioByBracket([dosed(T0, "Morning", 10, 50, 5), eatingOut, corrAt(T0 + 2 * H, 1), low(T0 + 2.5 * H, 10)], settings2, 3);
  assert.equal(eo.rows[0].ideal, 10, "the correction and low follow the Eating Out meal, which has no ratio");
  assert.equal(eo.correctionsUnattached, 1); assert.equal(eo.lowsUnattached, 1);
});
