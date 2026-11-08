import { test } from "node:test";
import assert from "node:assert/strict";
import { weekdayOf, mealExtrasKcal, addDayOneOff, setDayCount, resetDay, ONE_OFFS_MAX, extraFromFood, extrasForDay, setDayExtra, dayKeyOf, eatingOutEstimates, eatingOutKcalFromInsulin, isCorrectionOnly, todayCalories, calorieRule, calorieSummary, restingKcal, activityKcal, watchKcal, extrasKcal, missingDetails, CALORIE_DEFAULTS } from "../../js/calories.js";
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

test("daily extras per day (2.83.0): a day starts at the usual, a changed day keeps its own counts", () => {
  const rule = calorieRule(me, NOW);   // olive oil 2 tbsp x 119, flat white 1 x 110 = 348 usual
  const today = dayKeyOf(NOW), yday = dayKeyOf(at(1, 12));
  assert.equal(today, "2026-11-03");
  assert.equal(extrasForDay(rule, today).total, 348); assert.equal(extrasForDay(rule, today).adjusted, false);
  // 3 flat whites today, no oil
  let de = setDayExtra(rule, today, "flat-white", 3);
  de = setDayExtra({ ...rule, dayExtras: de }, today, "olive-oil", 0);
  const r2 = calorieRule({ ...me, dayExtras: de }, NOW);
  const t = extrasForDay(r2, today);
  assert.equal(t.total, 330); assert.equal(t.adjusted, true);
  assert.deepEqual(t.items.map(x => [x.id, x.count, x.usual, x.changed]), [["olive-oil", 0, 2, true], ["flat-white", 3, 1, true]]);
  assert.equal(extrasForDay(r2, yday).total, 348);   // other days unchanged
  // Setting it back to the usual drops the day.
  const back = setDayExtra({ ...r2 }, today, "flat-white", 1);
  assert.deepEqual(setDayExtra({ ...r2, dayExtras: back }, today, "olive-oil", 2), {});
  // The summary and today's bar use the day's own amounts.
  const sum = calorieSummary([meal(at(0, 9), 500), meal(at(1, 9), 500)], { calories: { ...me, dayExtras: de } }, { days: 3, now: NOW });
  assert.equal(sum.days[2].extras, 330); assert.equal(sum.days[2].extrasAdjusted, true); assert.equal(sum.days[1].extras, 348);
  assert.equal(todayCalories([meal(at(0, 9), 500)], { calories: { ...me, dayExtras: de } }, NOW, 0).extras, 330);
  // A day adjusted with no meal logged still counts (he said what he had).
  const lone = calorieSummary([], { calories: { ...me, dayExtras: { [yday]: { "flat-white": 2 } } } }, { days: 3, now: NOW });
  assert.equal(lone.days[1].logged, true); assert.equal(lone.days[1].extras, 238 + 220);
});

test("day extras are cleaned: unknown items, bad dates and bad counts dropped; only the latest 120 days kept", () => {
  const raw = { "2026-11-03": { "flat-white": "2,5", "nope": 3, "olive-oil": 99 }, "bad": { "flat-white": 1 }, "2026-11-02": {} };
  for (let i = 0; i < 130; i++) raw[`2025-01-${String((i % 28) + 1).padStart(2, "0")}`.replace("2025-01", `2025-${String(Math.floor(i / 28) + 1).padStart(2, "0")}`)] = { "flat-white": 1 };
  const r = calorieRule({ ...me, dayExtras: raw }, NOW);
  assert.deepEqual(r.dayExtras["2026-11-03"], { "flat-white": 2.5 });
  assert.equal(r.dayExtras.bad, undefined); assert.equal(r.dayExtras["2026-11-02"], undefined);
  assert.ok(Object.keys(r.dayExtras).length <= 120);
  assert.deepEqual(setDayExtra(r, "2026-11-03", "nope", 2), r.dayExtras);   // an unknown item changes nothing
  assert.equal(setDayExtra(r, "2026-11-04", "flat-white", 80)["2026-11-04"]["flat-white"], 50);
});

test("a daily extra from a library food (2.89.0): a serving in grams, or one unit for a quantity food", () => {
  const oil = { name: "Olio extravergine", kcalPer100g: 884, unitBased: false };
  assert.deepEqual((({ name, unit, kcalPerUnit, perDay, noKcal }) => ({ name, unit, kcalPerUnit, perDay, noKcal }))(extraFromFood(oil, 13.5)),
    { name: "Olio extravergine", unit: "13.5 g", kcalPerUnit: 119.3, perDay: 1, noKcal: false });
  const slice = { name: "Pane in cassetta", kcalPer100g: 270, unitBased: true, unitLabel: "slice", gramsPerUnit: 25 };
  const s1 = extraFromFood(slice, 999);   // grams ignored: one slice
  assert.equal(s1.unit, "slice"); assert.equal(s1.kcalPerUnit, 67.5); assert.equal(s1.byUnit, true);
  const none = extraFromFood({ name: "Mystery", kcalPer100g: null }, 50);
  assert.equal(none.kcalPerUnit, 0); assert.equal(none.noKcal, true); assert.equal(none.unit, "50 g");
  assert.equal(extraFromFood({ name: "x".repeat(60), kcalPer100g: 100 }, 0).name.length, 40);
  assert.equal(extraFromFood({ name: "Bread", kcalPer100g: 250 }, 0).unit, "100 g");   // no grams: 100 g
  // and it survives the settings clean-up as a normal extra
  const r = calorieRule({ ...me, extras: [...me.extras, { id: "extra-x", ...extraFromFood(oil, 13.5) }] }, NOW);
  assert.deepEqual(r.extras[2], { id: "extra-x", name: "Olio extravergine", unit: "13.5 g", kcalPerUnit: 119.3, perDay: 1, meals: [], days: [] });
});

test("one-off items for a day (2.91.0): added for that day only, counted, removable, reset with the day", () => {
  const rule = calorieRule(me, NOW);
  const day = "2026-11-02";
  let r = calorieRule({ ...me, ...addDayOneOff(rule, day, { name: "Biscotto", unit: "piece", kcalPerUnit: 45 }, "extra-b1") }, NOW);
  let dx = extrasForDay(r, day);
  assert.equal(dx.total, 348 + 45); assert.equal(dx.adjusted, true);
  const b = dx.items[dx.items.length - 1];
  assert.deepEqual([b.id, b.name, b.count, b.oneOff, b.usual], ["once-extra-b1", "Biscotto", 1, true, 0]);
  assert.equal(extrasForDay(r, "2026-11-03").total, 348);   // other days untouched
  // three biscuits, then a usual item changed too
  r = calorieRule({ ...r, ...setDayCount(r, day, b.id, 3) }, NOW);
  r = calorieRule({ ...r, ...setDayCount(r, day, "flat-white", 0) }, NOW);
  assert.equal(extrasForDay(r, day).total, 238 + 135);
  // the summary counts them on that day, even with no meal logged
  const sum = calorieSummary([], { calories: r }, { days: 3, now: NOW });
  assert.equal(sum.days[1].extras, 373); assert.equal(sum.days[1].logged, true);
  // 0 removes a one-off; reset drops the whole day
  const gone = calorieRule({ ...r, ...setDayCount(r, day, b.id, 0) }, NOW);
  assert.equal(extrasForDay(gone, day).items.some(x => x.oneOff), false);
  const back = calorieRule({ ...r, ...resetDay(r, day) }, NOW);
  assert.equal(extrasForDay(back, day).total, 348); assert.equal(extrasForDay(back, day).adjusted, false);
  // a day holds at most ONE_OFFS_MAX; bad days and nameless items are refused or dropped
  let full = rule;
  for (let i = 0; i < ONE_OFFS_MAX; i++) full = calorieRule({ ...me, ...full, ...addDayOneOff(full, day, { name: `x${i}`, kcalPerUnit: 1 }, `e${i}`) }, NOW);
  assert.equal(addDayOneOff(full, day, { name: "one more", kcalPerUnit: 1 }, "e99"), null);
  assert.equal(addDayOneOff(rule, "nope", { name: "x" }, "e"), null);
  assert.deepEqual(calorieRule({ ...me, dayOneOffs: { [day]: [{ name: "" }, { name: "Ok", kcalPerUnit: 10, count: "1,5" }], bad: [{ name: "x" }] } }, NOW).dayOneOffs,
    { [day]: [{ id: "once-extra-1", name: "Ok", unit: "", kcalPerUnit: 10, count: 1.5 }] });
});

test("meal extras (2.94.0): mozzarella with lunch counts only on a day lunch is logged with its foods", () => {
  const withMozz = { ...me, extras: [...me.extras, { id: "mozz", name: "Mozzarella", unit: "ball", kcalPerUnit: 250, perDay: 1, meal: "lunch" }] };
  const rule = calorieRule(withMozz, NOW);
  assert.deepEqual(rule.extras[2].meals, ["lunch"]);   // a 2.94.0 save ({ meal: "lunch" }) reads as one meal
  assert.deepEqual(calorieRule({ ...me, extras: [{ name: "x", meal: "brunch" }] }, NOW).extras[0].meals, []);
  const lunch = ts => meal(ts, 600, { mealType: "lunch" }), dinner = ts => meal(ts, 700, { mealType: "dinner" });
  const sum = calorieSummary([lunch(at(2, 13)), dinner(at(1, 20)), meal(at(0, 13), 0, { mealType: "lunch", carbsUnknown: true, items: [], mealDose: 10, ratioValue: 9 })], { calories: withMozz }, { days: 3, now: NOW });
  assert.equal(sum.days[0].extras, 348 + 250);   // lunch logged: every-day extras + mozzarella
  assert.equal(sum.days[1].extras, 348);         // dinner only: no mozzarella
  assert.equal(sum.days[2].extras, 348);         // an eating-out lunch doesn't bring it
  // today: every-day extras set aside, mozzarella eaten once lunch is logged; while building lunch it joins the draft
  const before = todayCalories([meal(at(0, 8), 300, { mealType: "breakfast" })], { calories: withMozz }, NOW, 500, "lunch");
  assert.equal(before.extras, 348); assert.equal(before.eaten, 300); assert.equal(before.draftExtras, 250); assert.equal(before.draft, 750);
  assert.equal(todayCalories([meal(at(0, 8), 300, { mealType: "breakfast" })], { calories: withMozz }, NOW, 0, "lunch").draft, 0);   // nothing being built
  const after = todayCalories([lunch(at(0, 13))], { calories: withMozz }, NOW, 400, "lunch");
  assert.equal(after.eaten, 850); assert.equal(after.draftExtras, 0);   // already counted with the first lunch
  assert.equal(mealExtrasKcal(rule, "2026-11-03", "dinner", new Set(["lunch"])), 0);
  // the day sheet sees which apply
  const dx = extrasForDay(rule, "2026-11-02", new Set(["dinner"]));
  assert.deepEqual(dx.items.map(x => [x.id, x.applies]), [["olive-oil", true], ["flat-white", true], ["mozz", false]]);
  assert.equal(dx.total, 348); assert.equal(dx.aside, 348); assert.equal(dx.withMeals, 0);
});

test("an extra across several meals (2.95.0): its amount is split evenly, each logged meal brings its share", () => {
  const coffee = { id: "cof", name: "Coffee", unit: "cup", kcalPerUnit: 110, perDay: 2, meals: ["lunch", "breakfast", "lunch", "nope"] };
  const set = { ...me, extras: [coffee] };
  const rule = calorieRule(set, NOW);
  assert.deepEqual(rule.extras[0].meals, ["breakfast", "lunch"]);   // known meals, in the day's order, once each
  const b = ts => meal(ts, 300, { mealType: "breakfast" }), l = ts => meal(ts, 600, { mealType: "lunch" });
  const sum = calorieSummary([b(at(2, 8)), l(at(2, 13)), b(at(1, 8)), meal(at(0, 20), 500, { mealType: "dinner" })], { calories: set }, { days: 3, now: NOW });
  assert.equal(sum.days[0].extras, 220);   // breakfast + lunch: both coffees
  assert.equal(sum.days[1].extras, 110);   // only breakfast: half
  assert.equal(sum.days[2].extras, 0);     // dinner only: none
  const dx = extrasForDay(rule, "2026-11-02", new Set(["breakfast"]));
  assert.deepEqual([dx.items[0].logged, dx.items[0].share, dx.items[0].counted], [["breakfast"], 0.5, 110]);
  // today: breakfast logged (110 counted), building lunch brings the other 110
  const t = todayCalories([b(at(0, 8))], { calories: set }, NOW, 400, "lunch");
  assert.equal(t.eaten, 300 + 110); assert.equal(t.draftExtras, 110); assert.equal(t.extras, 0);
  // a changed count for the day is split the same way (3 cups over two meals = 1.5 each)
  const r3 = calorieRule({ ...set, dayExtras: { "2026-11-02": { cof: 3 } } }, NOW);
  assert.equal(extrasForDay(r3, "2026-11-02", new Set(["lunch"])).withMeals, 165);
});

test("eating out with calories typed (2.96.0): the typed figure beats the estimate, and later corrections aren't added", () => {
  const rule = calorieRule({ ...me }, NOW);
  const h = [{ id: "l", ts: at(1, 12, 31), mealType: "lunch", carbsUnknown: true, items: [], totalCarbs: 0, totalKcal: 0, mealDose: 14, correctionDose: 0, ratioValue: 7.5, knownKcal: 850.4 },
    { id: "c", ts: at(1, 13, 52), mealType: "correction", items: [], totalCarbs: 0, totalKcal: 0, mealDose: 0, correctionDose: 3, ratioValue: 7.5 }];
  const est = eatingOutEstimates(h, rule).get("l");
  assert.equal(est.kcal, 850); assert.equal(est.from, "logged"); assert.equal(est.corrUnits, 0);
  assert.equal(calorieSummary(h, { calories: me }, { days: 3, now: NOW }).days[1].food, 850);
  // with the multiplier off and no fixed figure it still counts (it was typed)
  assert.equal(eatingOutEstimates(h, calorieRule({ ...me, eatingOutMultiplier: null, eatingOutKcal: null }, NOW)).get("l").kcal, 850);
  // 0 or missing = not known: back to the insulin estimate
  assert.equal(eatingOutEstimates([{ ...h[0], knownKcal: 0 }, h[1]], rule).get("l").kcal, 1020);
});

test("extras on some weekdays only (2.98.0): other days count 0, a count set for the day still wins", () => {
  // NOW is Tue 3 Nov 2026. Mozzarella Mon–Fri; flat white weekends only.
  assert.equal(weekdayOf("2026-11-03"), 2); assert.equal(weekdayOf("2026-11-01"), 0);
  const set = { ...me, extras: [
    { id: "olive-oil", name: "Olive oil", unit: "tbsp", kcalPerUnit: 119, perDay: 2 },
    { id: "mozz", name: "Mozzarella", unit: "ball", kcalPerUnit: 250, perDay: 1, days: [5, 1, 2, 3, 4, 4, 9] },
    { id: "fw", name: "Flat white", unit: "cup", kcalPerUnit: 110, perDay: 1, days: [0, 6] } ] };
  const rule = calorieRule(set, NOW);
  assert.deepEqual(rule.extras.map(x => x.days), [[], [1, 2, 3, 4, 5], [0, 6]]);   // cleaned and ordered
  assert.deepEqual(calorieRule({ ...me, extras: [{ name: "x", days: [0, 1, 2, 3, 4, 5, 6] }] }, NOW).extras[0].days, []);   // all seven = every day
  const tue = extrasForDay(rule, "2026-11-03"), sun = extrasForDay(rule, "2026-11-01");
  assert.equal(tue.total, 238 + 250); assert.equal(sun.total, 238 + 110);
  const fwTue = tue.items.find(x => x.id === "fw");
  assert.deepEqual([fwTue.onDay, fwTue.usual, fwTue.count, fwTue.changed], [false, 0, 0, false]);
  // a flat white on a Tuesday after all: set for that day, counted, and back to 0 = back to usual
  const r2 = calorieRule({ ...set, ...setDayCount(rule, "2026-11-03", "fw", 1) }, NOW);
  assert.equal(extrasForDay(r2, "2026-11-03").total, 238 + 250 + 110); assert.equal(extrasForDay(r2, "2026-11-03").adjusted, true);
  assert.deepEqual(setDayCount(r2, "2026-11-03", "fw", 0).dayExtras, {});
  // summary and today follow the weekday
  const sum = calorieSummary([meal(at(0, 9), 500), meal(at(2, 9), 500)], { calories: set }, { days: 3, now: NOW });
  assert.equal(sum.days[2].extras, 488); assert.equal(sum.days[0].extras, 348);   // Tue / Sun
  assert.equal(todayCalories([meal(at(0, 9), 500)], { calories: set }, NOW, 0).extras, 488);
});
