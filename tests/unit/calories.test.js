import { test } from "node:test";
import assert from "node:assert/strict";
import { eatingOutEstimates, eatingOutKcalFromInsulin, isCorrectionOnly, todayCalories, calorieRule, calorieSummary, restingKcal, activityKcal, watchKcal, extrasKcal, missingDetails, CALORIE_DEFAULTS } from "../../js/calories.js";
import { normalizeState } from "../../js/state.js";
import { shiftDay } from "../../js/day-timeline.js";

const NOW = new Date(2026, 10, 3, 18, 0).getTime();   // Tue 3 Nov 2026, 18:00 local
const at = (daysBack, h, m = 0) => { const d = new Date(shiftDay(NOW, -daysBack)); d.setHours(h, m, 0, 0); return d.getTime(); };
const me = { sex: "male", birthYear: 1985, heightCm: 180, weightKg: 75, lifeFactor: 1.3, extras: [
  { id: "olive-oil", name: "Olive oil", unit: "tbsp", kcalPerUnit: 119, perDay: 2 },
  { id: "flat-white", name: "Flat white", unit: "cup", kcalPerUnit: 110, perDay: 1 }
] };
const meal = (ts, kcal, extra = {}) => ({ id: `m-${ts}`, ts, mealType: "lunch", totalCarbs: 40, totalKcal: kcal, items: [{ name: "x", carbs: 40, kcal }], mealDose: 4, ...extra });
const act = (ts, minutes, type, intensity, extra = {}) => ({ id: `a-${ts}`, ts, entryType: "activity", mealType: "activity", activityType: type, intensity, durationMin: minutes, totalCarbs: 0, totalKcal: 0, items: [], ...extra });

test("Mifflin-St Jeor resting needs, and nothing until every detail is set", () => {
  const r = calorieRule(me, NOW);
  // 10*75 + 6.25*180 - 5*41 + 5 = 750 + 1125 - 205 + 5
  assert.equal(restingKcal(r, NOW), 1675);
  assert.equal(restingKcal(calorieRule({ ...me, sex: "female" }, NOW), NOW), 1675 - 166);
  assert.equal(restingKcal(calorieRule({ ...me, weightKg: null }, NOW), NOW), null);
  assert.deepEqual(missingDetails(calorieRule({}, NOW)), ["sex", "year of birth", "height", "weight"]);
});

test("rule cleans and clamps; decimal comma; defaults start with olive oil and flat white at zero a day", () => {
  const r = calorieRule({ sex: "x", birthYear: 2020, heightCm: "180,5", weightKg: 999, lifeFactor: 5 }, NOW);
  assert.equal(r.sex, null); assert.equal(r.birthYear, null); assert.equal(r.heightCm, 180.5); assert.equal(r.weightKg, null);
  assert.equal(r.lifeFactor, 1.3);
  const d = calorieRule(undefined, NOW);
  assert.deepEqual(d.extras.map(x => [x.name, x.perDay]), [["Olive oil", 0], ["Flat white", 0]]);
  const bad = calorieRule({ extras: [{ name: "" }, { name: "Nuts", kcalPerUnit: -3, perDay: "1,5", id: "<b>" }, { name: "Nuts 2", id: "extra-1" }] }, NOW);
  assert.equal(bad.extras.length, 2);
  assert.equal(bad.extras[0].kcalPerUnit, 0); assert.equal(bad.extras[0].perDay, 1.5);
  assert.notEqual(bad.extras[0].id, bad.extras[1].id);
  assert.equal(extrasKcal(calorieRule(me, NOW)).total, 348);
});

test("activity: Watch calories when imported, otherwise net MET estimate from weight", () => {
  const imp = act(at(0, 8), 19, "cycle", "moderate", { source: "appleHealth", note: "From Apple Health · 82 kcal (intensity estimated)" });
  assert.equal(watchKcal(imp), 82);
  assert.deepEqual(activityKcal(imp, 75), { kcal: 82, from: "watch" });
  // A hand-logged 60 min moderate run: (9 - 1) * 75 * 1 = 600
  assert.deepEqual(activityKcal(act(at(0, 8), 60, "run", "moderate"), 75), { kcal: 600, from: "estimate" });
  // Imported but the note was changed by hand: back to the estimate
  assert.equal(activityKcal({ ...imp, note: "nice ride" }, 75).from, "estimate");
  assert.equal(activityKcal(act(at(0, 8), 60, "run", "moderate"), null), null);
  assert.equal(watchKcal({ note: "From Apple Health · 50 kcal" }), null);   // only for imports
});

test("day totals: food + extras eaten against resting x factor + activity", () => {
  const history = [
    meal(at(1, 8), 400), meal(at(1, 13), 700),
    act(at(1, 18), 30, "walk", "moderate"),   // (3.5-1)*75*0.5 = 93.75
    { id: "b1", ts: at(1, 21), entryType: "basal", mealType: "basal", basalDose: 10, totalCarbs: 0, totalKcal: 0, items: [] }
  ];
  const s = calorieSummary(history, { calories: me }, { days: 7, now: NOW });
  const y = s.days[s.days.length - 2];
  assert.equal(y.food, 1100);
  assert.equal(y.extras, 348);
  assert.equal(y.eaten, 1448);
  assert.ok(Math.abs(y.target - (1675 * 1.3 + 93.75)) < 1e-9);
  assert.equal(s.avg.daysUsed, 1);
  assert.ok(Math.abs(s.avg.diff - (1448 - (1675 * 1.3 + 93.75))) < 1e-9);
});

test("days with nothing logged get no extras and no average; today and eating-out days are left out of averages", () => {
  const history = [meal(at(2, 13), 600), meal(at(1, 13), 500), meal(at(1, 20), 0, { carbsUnknown: true, items: [] }), meal(at(0, 9), 300)];
  const s = calorieSummary(history, { calories: { ...me, eatingOutKcal: null } }, { days: 7, now: NOW });
  const empty = s.days[0];
  assert.equal(empty.logged, false); assert.equal(empty.extras, 0); assert.equal(empty.diff, null);
  assert.equal(s.days[s.days.length - 2].eatingOut, 1);
  assert.equal(s.avg.daysUsed, 1);
  assert.equal(s.avg.daysEatingOut, 1);
  assert.equal(s.avg.food, 600);
  const today = s.days[s.days.length - 1];
  assert.equal(today.isToday, true); assert.equal(today.food, 300);
});

test("an activity crossing midnight gives each day its share; foods without kcal are counted", () => {
  const start = at(1, 23, 30);
  const s = calorieSummary([act(start, 60, "run", "moderate"), meal(at(1, 12), 500, { items: [{ name: "x", carbs: 30, kcal: 0 }, { name: "y", carbs: 0, kcal: 0 }] })], { calories: me }, { days: 3, now: NOW });
  const [, y, t] = s.days;
  assert.equal(Math.round(y.activity), 300); assert.equal(Math.round(t.activity), 300);
  assert.equal(y.missingKcal, 1);
});

test("without body details: eaten still counts, target is null, activity not estimated unless the Watch measured it", () => {
  const s = calorieSummary([meal(at(1, 12), 500), act(at(1, 18), 30, "walk", "moderate"),
    act(at(1, 19), 20, "cycle", "hard", { source: "appleHealth", note: "From Apple Health · 200 kcal (intensity estimated)" })], {}, { days: 3, now: NOW });
  const y = s.days[1];
  assert.equal(y.eaten, 500); assert.equal(y.target, null); assert.equal(s.avg.target, null);
  assert.equal(y.activity, 200); assert.equal(y.unestimated, 1);
});

test("never changes with dose-only fields and ignores junk", () => {
  const s = calorieSummary([null, { ts: "x" }, meal(at(1, 12), NaN), meal(at(1, 13), -50)], { calories: me }, { days: 3, now: NOW });
  assert.equal(s.days[1].food, 0);
  assert.equal(s.days[1].meals, 2);
});

test("state merge keeps calorie settings key by key", () => {
  const defaults = () => ({ settings: { calories: { ...CALORIE_DEFAULTS }, insulinModel: {}, carbAbsorptionMinutes: {}, basalActivity: {}, basalBaseline: {} }, library: [], recipes: [], history: [] });
  const st = normalizeState({ settings: { calories: { weightKg: 75 } } }, defaults);
  assert.equal(st.settings.calories.weightKg, 75);
  assert.equal(st.settings.calories.lifeFactor, 1.3);
  assert.equal(st.settings.calories.extras.length, 2);
});

test("eating out: an assumed kcal per meal counts the day in full (default 900); none set leaves it out", () => {
  const history = [meal(at(2, 13), 600), meal(at(1, 13), 500), meal(at(1, 20), 0, { carbsUnknown: true, items: [] }), meal(at(1, 21), 0, { carbsUnknown: true, items: [] })];
  assert.equal(calorieRule({}, NOW).eatingOutKcal, 900);
  const s = calorieSummary(history, { calories: { ...me, eatingOutKcal: 1100 } }, { days: 7, now: NOW });
  const y = s.days[s.days.length - 2];
  assert.equal(y.food, 500 + 2 * 1100); assert.equal(y.assumedKcal, 2200); assert.equal(y.unknownMeals, 0); assert.equal(y.eatingOut, 2);
  assert.equal(s.avg.daysUsed, 2); assert.equal(s.avg.daysAssumed, 1); assert.equal(s.avg.daysEatingOut, 0);
  const none = calorieSummary(history, { calories: { ...me, eatingOutKcal: null } }, { days: 7, now: NOW });
  assert.equal(none.days[none.days.length - 2].food, 500); assert.equal(none.avg.daysUsed, 1); assert.equal(none.avg.daysEatingOut, 1);
  assert.equal(calorieRule({ eatingOutKcal: "1,5e9" }, NOW).eatingOutKcal, null);
});

test("today's bar: food logged against what is left for food once the day's extras are set aside (2.79.1)", () => {
  const needed = 1675 * 1.3 + 600;   // a 60 min moderate run today
  const h = [meal(at(0, 9), 500), act(at(0, 7), 60, "run", "moderate")];
  const t = todayCalories(h, { calories: me }, NOW, 400);
  assert.equal(t.eaten, 500); assert.equal(t.draft, 400); assert.equal(t.extras, 348);
  assert.ok(Math.abs(t.needed - needed) < 1e-9); assert.ok(Math.abs(t.target - (needed - 348)) < 1e-9);
  assert.ok(Math.abs(t.fill - 500 / (needed - 348)) < 1e-9); assert.ok(Math.abs(t.draftFill - 400 / (needed - 348)) < 1e-9); assert.equal(t.over, false);
  // His 3 Nov morning: 243 + 632 food, 886 of extras. The bar says 875, not 1,761.
  const fr = { ...me, lifeFactor: 1.2, extras: [{ name: "Olive oil", kcalPerUnit: 119, perDay: 4 }, { name: "Flat white", kcalPerUnit: 110, perDay: 3 }, { name: "Chocolate", kcalPerUnit: 80, perDay: 1 }] };
  const day = todayCalories([meal(at(0, 7), 243), meal(at(0, 12), 632)], { calories: fr }, NOW, 0);
  assert.equal(day.eaten, 875); assert.equal(day.extras, 886); assert.ok(Math.abs(day.target - (1675 * 1.2 - 886)) < 1e-9);
  assert.equal(todayCalories([], { calories: me }, NOW, 0).eaten, 0);
  const big = todayCalories([meal(at(0, 9), 3000)], { calories: me }, NOW, 500);
  assert.equal(big.over, true); assert.equal(big.fill + big.draftFill, 1);
  assert.equal(todayCalories(h, { calories: { extras: [] } }, NOW, 0), null);   // no details, no bar
});

// 2.82.0: eating out worked out from the insulin.
const eatOut = (id, ts, units, ratio, extra = {}) => ({ id, ts, mealType: "lunch", carbsUnknown: true, items: [], totalCarbs: 0, totalKcal: 0, mealDose: units, correctionDose: 0, ratioValue: ratio, ...extra });
const corr = (id, ts, units, extra = {}) => ({ id, ts, mealType: "correction", items: [], totalCarbs: 0, totalKcal: 0, mealDose: 0, correctionDose: units, ratioValue: 9, ...extra });

test("eating out from insulin: his 4 Nov lunch, 14u at 1u:7.5g plus a 3u correction 81 min later = 1,020 kcal", () => {
  const rule = calorieRule({ ...me }, NOW);
  assert.equal(rule.eatingOutMultiplier, 2);   // the default
  const h = [eatOut("l", at(1, 12, 31), 14, 7.5), corr("c", at(1, 13, 52), 3, { ratioValue: 7.5, glucose: 302.7 })];
  const est = eatingOutEstimates(h, rule).get("l");
  assert.deepEqual({ units: est.units, corrUnits: est.corrUnits, corrections: est.corrections, ratio: est.ratio, carbs: est.carbs, kcal: est.kcal, from: est.from },
    { units: 14, corrUnits: 3, corrections: 1, ratio: 7.5, carbs: 127.5, kcal: 1020, from: "insulin" });
  const y = calorieSummary([...h, meal(at(1, 8), 300)], { calories: me }, { days: 3, now: NOW }).days[1];
  assert.equal(y.food, 300 + 1020); assert.equal(y.assumedKcal, 1020); assert.equal(y.unknownMeals, 0);
  assert.equal(eatingOutKcalFromInsulin(14, 7.5, 2), 840);
  assert.equal(eatingOutKcalFromInsulin(0, 7.5, 2), null);
});

test("corrections count only within 4 h and until the next meal; each goes to the latest eating-out meal", () => {
  const rule = calorieRule({ ...me }, NOW);
  // 27 Oct: lunch 13u at 9, corrections after 1.5 h and 2.3 h -> both count.
  let e = eatingOutEstimates([eatOut("l", at(1, 13, 6), 13, 9), corr("a", at(1, 14, 38), 1.5), corr("b", at(1, 15, 26), 2.5)], rule).get("l");
  assert.equal(e.corrUnits, 4); assert.equal(e.kcal, 17 * 9 * 4 * 2);
  // 24 Oct: dinner then a correction 4 h 20 later -> not counted.
  e = eatingOutEstimates([eatOut("d", at(1, 18, 25), 12, 15), corr("x", at(1, 22, 45), 0.5)], rule).get("d");
  assert.equal(e.corrUnits, 0); assert.equal(e.kcal, 12 * 15 * 8);
  // A meal with its own foods in between takes the later correction.
  e = eatingOutEstimates([eatOut("d", at(1, 12), 10, 9), meal(at(1, 13), 200), corr("y", at(1, 14), 2)], rule).get("d");
  assert.equal(e.corrUnits, 0);
  // 31 Oct: two eating-out entries an hour apart; a correction after both belongs to the later one only.
  const two = eatingOutEstimates([eatOut("a", at(1, 20, 27), 12, 15), eatOut("b", at(1, 21, 38), 6, 15), corr("z", at(1, 22, 30), 2)], rule);
  assert.equal(two.get("a").corrUnits, 0); assert.equal(two.get("b").corrUnits, 2);
  // A correction BEFORE the meal (14 Oct 17:28) is not food for it.
  e = eatingOutEstimates([corr("p", at(1, 17, 28), 2), eatOut("d", at(1, 19, 39), 9, 15)], rule).get("d");
  assert.equal(e.corrUnits, 0);
  // A correction made at the meal for a high reading isn't food; a reduction for a low one is insulin not taken.
  assert.equal(eatingOutEstimates([eatOut("h", at(1, 12), 10, 9, { correctionDose: 2 })], rule).get("h").units, 10);
  assert.equal(eatingOutEstimates([eatOut("h", at(1, 12), 10, 9, { correctionDose: -1 })], rule).get("h").units, 9);
});

test("a correction logged with Eating Out still on (14 Oct 20:50) is a correction, not a 900 kcal meal", () => {
  const rule = calorieRule({ ...me }, NOW);
  const odd = corr("odd", at(1, 20, 50), 4, { carbsUnknown: true, ratioValue: 15 });
  assert.equal(isCorrectionOnly(odd), true);
  const h = [eatOut("d", at(1, 19, 39), 9, 15), odd];
  const est = eatingOutEstimates(h, rule);
  assert.equal(est.has("odd"), false); assert.equal(est.get("d").corrUnits, 4); assert.equal(est.get("d").kcal, 13 * 15 * 8);
  const y = calorieSummary(h, { calories: me }, { days: 3, now: NOW }).days[1];
  assert.equal(y.eatingOut, 1); assert.equal(y.food, 13 * 15 * 8);
  // Before 2.82.0 a lone correction like that added a whole fixed meal; now it adds nothing.
  assert.equal(calorieSummary([odd], { calories: me }, { days: 3, now: NOW }).days[1].food, 0);
});

test("no insulin, no ratio or the multiplier switched off: the fixed figure (or unknown when that's empty too)", () => {
  const h = [eatOut("n", at(1, 12), 0, 9), eatOut("r", at(1, 19), 8, null)];
  let est = eatingOutEstimates(h, calorieRule({ ...me }, NOW));
  assert.equal(est.get("n").from, "fixed"); assert.equal(est.get("n").kcal, 900); assert.equal(est.get("r").from, "fixed");
  est = eatingOutEstimates([eatOut("m", at(1, 12), 10, 9)], calorieRule({ ...me, eatingOutMultiplier: null }, NOW));
  assert.equal(est.get("m").from, "fixed");
  est = eatingOutEstimates([eatOut("m", at(1, 12), 0, 9)], calorieRule({ ...me, eatingOutKcal: null }, NOW));
  assert.equal(est.get("m").kcal, null);
  assert.equal(calorieRule({ eatingOutMultiplier: "2,5" }, NOW).eatingOutMultiplier, 2.5);
  assert.equal(calorieRule({ eatingOutMultiplier: 9 }, NOW).eatingOutMultiplier, null);
});
