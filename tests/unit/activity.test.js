// Logged physical activity (2.65.0): the helpers, and the promise that an activity can never change a dose, active insulin,
// carbs on board, trends or any meal figure. Each "leak" test computes a figure with and without activities in the log and
// requires the two to be identical.
import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTIVITY_TYPES, INTENSITIES, activityLabel, describeActivity, formatDuration, activityCheck, makeActivityEntry,
  applyActivityEdit, lastActivity, isActivityEntry, activityNsNote
} from "../../js/activity.js";
import { activeAt, buildTrendBuckets, mealTypeBreakdown, ratioByBracket, idealRatioByBracket, ratioWasApplied } from "../../js/calc.js";
import { dosingSummary, insulinStats, recentDistinctMeals, matchesQuery, isNonMealEntry, makeBasalEntry } from "../../js/history.js";
import { sanityPool } from "../../js/dose-sanity.js";
import { weekdayWeekend, outcomeByBracket, overnightStats, iobStacking, lowTreatmentUsual, correctionEffectiveness } from "../../js/insights.js";
import { expectedFromInsulin, observedCarbs, projectGlucose } from "../../js/glucose-model.js";
import { glucoseForecast } from "../../js/glucose-forecast.js";
import { treatmentsForEntry } from "../../js/nightscout.js";
import { healthTarget } from "../../js/core/health-target.js";
import { validateEntry } from "../../js/core/schema.js";

globalThis.__HEALTH_EXPORT_TEST__ = true;
const { flattenHistoryEntries } = await import("../../supabase/functions/health-export/index.ts");

const MIN = 60000, HOUR = 3600000;
const NOW = new Date(2026, 9, 20, 13, 0, 0).getTime();
const SETTINGS = {
  isf: 50, target: 100, units: "mgdl", rounding: "0.5", maxDose: 15, iobAwareCorrection: false,
  insulinModel: { preset: "rapid", peakMinutes: 75, diaMinutes: 360 },
  carbAbsorptionMinutes: { high: 120, medium: 180, low: 240, unknown: 180 },
  timeRatios: [{ id: "d", name: "Day", start: "06:00", end: "23:30", ratio: 10 }], activityRatios: [{ id: "s", name: "Sport", ratio: 15 }]
};
let n = 0;
const meal = (ts, o = {}) => ({ id: "m" + n++, ts, mealType: "lunch", periodName: "day", items: [{ refType: "food", refId: "f1", name: "Rice", grams: 100, carbs: 50 }], totalCarbs: 50, totalKcal: 300, mealDose: 5, correctionDose: 0, noInsulin: false, glucose: 120, ratioLabel: "Day", ratioValue: 10, ...o });
const act = (ts, o = {}) => ({ ...makeActivityEntry({ type: "run", minutes: 45, intensity: "moderate", ts, now: ts + 1 + n++ }), ...o });

// Ten days of meals, a low treatment, a correction and basal; and the same log with activities in between.
const base = [];
for (let d = 0; d < 10; d++) {
  const day = NOW - d * 24 * HOUR;
  base.push(meal(day - 5 * HOUR, { mealType: "breakfast" }), meal(day - HOUR), meal(day + 6 * HOUR - 24 * HOUR, { mealType: "dinner", ratioLabel: d % 2 ? "Sport" : "Day", ratioValue: d % 2 ? 15 : 10 }));
  base.push(makeBasalEntry({ units: 16, ts: day - 3 * HOUR, slot: "am", now: day - 3 * HOUR + 7 }));
}
base.push(meal(NOW - 30 * MIN, { noInsulin: true, mealDose: 0, totalCarbs: 15, mealType: "snack" }));
base.push(meal(NOW - 2 * HOUR, { items: [], totalCarbs: 0, mealType: "correction", mealDose: 0, correctionDose: 1.5, glucose: 220 }));
const acts = [];
for (let d = 0; d < 12; d++) acts.push(act(NOW - d * 24 * HOUR - 90 * MIN, { activityType: ["run", "walk", "gym", "other"][d % 4], activityName: d % 4 === 3 ? "Climbing" : "", intensity: ["light", "moderate", "hard"][d % 3] }));
acts.push(act(NOW - 20 * MIN));   // one still going on
const sortNew = l => l.slice().sort((a, b) => b.ts - a.ts);
const WITHOUT = sortNew(base), WITH = sortNew([...base, ...acts]);

const readings = [];
for (let t = NOW - 11 * 24 * HOUR; t <= NOW; t += 5 * MIN) readings.push({ at: t, mgdl: 110 + 60 * Math.sin(t / (3 * HOUR)) });

const same = (name, f) => test(`an activity changes nothing: ${name}`, () => assert.deepEqual(f(WITH), f(WITHOUT)));

test("helpers: labels, durations and descriptions", () => {
  assert.equal(ACTIVITY_TYPES.at(-1).id, "other");
  assert.deepEqual(INTENSITIES.map(i => i.id), ["light", "moderate", "hard"]);
  assert.equal(formatDuration(45), "45 min");
  assert.equal(formatDuration(60), "1 h");
  assert.equal(formatDuration(95), "1 h 35 min");
  const e = makeActivityEntry({ type: "cycle", minutes: 62.4, intensity: "hard", ts: NOW, note: "  hilly   loop ", now: NOW + 5 });
  assert.equal(e.id, `h-${NOW + 5}`);
  assert.equal(e.durationMin, 62);
  assert.equal(e.note, "hilly loop");
  assert.equal(describeActivity(e), "Cycling · 1 h 2 min · Hard");
  assert.equal(activityNsNote(e), "Activity: Cycling · 1 h 2 min · Hard (hilly loop)");
  const o = makeActivityEntry({ type: "other", name: "Climbing", minutes: 30, intensity: "light", ts: NOW });
  assert.equal(activityLabel(o), "Climbing");
  // A name typed while "Other" was picked is dropped if the type is changed to a listed one.
  assert.equal(makeActivityEntry({ type: "run", name: "Climbing", minutes: 30, intensity: "light", ts: NOW }).activityName, "");
  assert.ok(isActivityEntry(o) && isNonMealEntry(o) && !isActivityEntry(meal(NOW)));
});

test("an activity entry has every meal field present and zero", () => {
  const e = makeActivityEntry({ type: "walk", minutes: 20, intensity: "light", ts: NOW });
  assert.deepEqual([e.items, e.totalCarbs, e.totalKcal, e.mealDose, e.correctionDose, e.noInsulin, e.glucose, e.ratioValue], [[], 0, 0, 0, 0, false, null, null]);
  assert.deepEqual(validateEntry(e), []);
});

test("activityCheck refuses what can't be saved", () => {
  const ok = { type: "run", minutes: 30, intensity: "moderate", ts: NOW - HOUR };
  assert.equal(activityCheck(ok, NOW), "");
  assert.match(activityCheck({ ...ok, type: "" }, NOW), /what you did/);
  assert.match(activityCheck({ ...ok, type: "other" }, NOW), /name/);
  assert.equal(activityCheck({ ...ok, type: "other", name: "Climbing" }, NOW), "");
  assert.match(activityCheck({ ...ok, minutes: NaN }, NOW), /how long/);
  assert.match(activityCheck({ ...ok, minutes: 0 }, NOW), /how long/);
  assert.match(activityCheck({ ...ok, minutes: 24 * 60 + 1 }, NOW), /24 hours/);
  assert.match(activityCheck({ ...ok, intensity: "" }, NOW), /how hard/);
  assert.match(activityCheck({ ...ok, ts: NaN }, NOW), /started/);
  assert.match(activityCheck({ ...ok, ts: NOW + HOUR }, NOW), /future/);
});

test("editing keeps the id; lastActivity finds the usual duration and intensity", () => {
  const e = makeActivityEntry({ type: "run", minutes: 30, intensity: "light", ts: NOW - 3 * HOUR, now: NOW });
  applyActivityEdit(e, { type: "other", name: "Padel", minutes: 75, intensity: "hard", ts: NOW - 2 * HOUR, note: "doubles" });
  assert.equal(e.id, `h-${NOW}`);
  assert.deepEqual([e.activityType, e.activityName, e.durationMin, e.intensity, e.ts, e.note], ["other", "Padel", 75, "hard", NOW - 2 * HOUR, "doubles"]);
  const log = [act(NOW - 5 * HOUR, { durationMin: 40, intensity: "hard" }), act(NOW - 50 * HOUR, { durationMin: 20 }), e, meal(NOW)];
  assert.deepEqual(lastActivity(log, "run"), { minutes: 40, intensity: "hard", ts: NOW - 5 * HOUR });
  assert.equal(lastActivity(log, "swim"), null);
  assert.equal(lastActivity(log, "other", "padel").minutes, 75);
  assert.equal(lastActivity(log, "other", "Squash"), null);
});

test("the log search finds activities by type, intensity and note", () => {
  const e = makeActivityEntry({ type: "swim", minutes: 40, intensity: "moderate", ts: NOW, note: "open water" });
  for (const q of ["swim", "swimming", "exercise", "moderate", "open water", "activity"]) assert.ok(matchesQuery(e, q, () => ""), q);
  assert.ok(!matchesQuery(e, "basal", () => ""));
});

same("active insulin and carbs on board", h => activeAt(h, SETTINGS, NOW));
same("daily trends", h => buildTrendBuckets(h, 14, NOW));
same("meal-type breakdown", h => mealTypeBreakdown(h));
same("ratio by bracket", h => ratioByBracket(h, SETTINGS));
same("ideal ratio by bracket", h => idealRatioByBracket(h, SETTINGS));
same("ratio was applied", h => h.map(ratioWasApplied).filter(Boolean).length);
same("clinic dosing summary", h => dosingSummary(h, NOW - 14 * 24 * HOUR));
same("insulin stats", h => insulinStats(h, NOW - 14 * 24 * HOUR));
same("recent meals row", h => recentDistinctMeals(h, 6).map(e => e.id));
same("dose sanity pool", h => sanityPool(h, NOW));
same("weekday vs weekend and activity ratios", h => weekdayWeekend(h, readings, SETTINGS));
same("outcome by bracket", h => outcomeByBracket(h, readings));
same("overnight stats", h => overnightStats(h, readings));
same("insulin stacking", h => iobStacking(h, readings));
same("usual low treatment", h => lowTreatmentUsual(h));
same("correction effectiveness", h => correctionEffectiveness(h, readings, { isfMgdl: 50 }));
same("expected from insulin", h => expectedFromInsulin(h, readings, { isfMgdl: 50, peak: 75, dia: 360, now: NOW }));
same("observed carbs", h => observedCarbs(h, readings, { isfMgdl: 50, peak: 75, dia: 360, absMinutes: () => 180, fallbackRatio: 10 }, NOW));
same("glucose projection", h => projectGlucose(h, readings, { isfMgdl: 50, peak: 75, dia: 360, absMinutes: () => 180, fallbackRatio: 10 }, NOW));
same("glucose forecast", h => glucoseForecast(h, readings, { isfMgdl: 50, peak: 75, dia: 360, absMinutes: () => 180, fallbackRatio: 10 }, NOW));
same("Apple Health Shortcut export", h => flattenHistoryEntries(h, NOW - 14 * 24 * HOUR, { includeBasal: true }));

test("Nightscout gets an activity as a plain Note, never insulin or carbs", () => {
  for (const format of ["combined", "split"]) {
    const parts = treatmentsForEntry(acts[3], { format });
    assert.equal(parts.length, 1);
    const t = parts[0].treatment;
    assert.equal(t.eventType, "Note");
    assert.ok(!("insulin" in t) && !("carbs" in t) && !("glucose" in t));
    assert.equal(t.notes, "Activity: Climbing · 45 min · Light");
  }
});

test("Apple Health (native) gets nothing for an activity", () => {
  assert.deepEqual(healthTarget({}).partsFor(acts[0]), []);
});

import { activityGlucose, activityImpact } from "../../js/insights.js";

test("activityGlucose: start, end, change and the lowest reading up to 6 h after", () => {
  const T = NOW - 12 * HOUR;
  // 140 at the start, falling 1 mg/dL a minute for the 45 minutes, down to 75 two hours after, then back up.
  const rs = [];
  for (let t = T - HOUR; t <= T + 10 * HOUR; t += 5 * MIN) {
    const m = (t - T) / MIN;
    rs.push({ at: t, mgdl: m < 0 ? 140 : m <= 45 ? 140 - m : m <= 165 ? 95 - (m - 45) / 6 : 75 + (m - 165) / 10 });
  }
  const e = makeActivityEntry({ type: "run", minutes: 45, intensity: "moderate", ts: T });
  const g = activityGlucose(e, rs);
  assert.equal(g.start, 140); assert.equal(g.end, 95); assert.equal(g.change, -45);
  assert.equal(g.lowest, 75); assert.equal(g.lowestAt, T + 165 * MIN); assert.equal(g.low, false); assert.equal(g.covered, true);
  // A dip to 65 more than 6 h after the end doesn't count; one inside the window does.
  assert.equal(activityGlucose(e, [...rs, { at: T + 45 * MIN + 7 * HOUR, mgdl: 65 }]).low, false);
  assert.equal(activityGlucose(e, [...rs, { at: T + 45 * MIN + 5 * HOUR, mgdl: 65 }]).low, true);
  // No readings: nothing is made up.
  assert.deepEqual(activityGlucose(e, []), { start: null, end: null, change: null, covered: false, lowest: null, lowestAt: null, low: false });
});

test("activityImpact groups by activity and intensity, busiest first, and skips activities without readings", () => {
  const rs = [];
  const log = [];
  const add = (d, type, intensity, drop, name = "") => {
    const T = NOW - d * 24 * HOUR;
    log.push(makeActivityEntry({ type, name, minutes: 30, intensity, ts: T, now: T + d }));
    for (let t = T - 30 * MIN; t <= T + 7 * HOUR; t += 5 * MIN) rs.push({ at: t, mgdl: t <= T ? 150 : t <= T + 30 * MIN ? 150 - drop * (t - T) / (30 * MIN) : 150 - drop });
  };
  add(1, "run", "moderate", 40); add(2, "run", "hard", 90); add(3, "run", "moderate", 20);
  add(4, "walk", "light", 10); add(5, "other", "hard", 30, "Climbing");
  log.push(makeActivityEntry({ type: "swim", minutes: 30, intensity: "light", ts: NOW - 20 * 24 * HOUR }));   // no readings that far back
  const out = activityImpact([...log, ...WITHOUT], rs);
  assert.deepEqual(out.map(r => r.label), ["Run", "Climbing", "Walk"]);
  const run = out[0];
  assert.equal(run.n, 3); assert.equal(run.avgStart, 150); assert.equal(run.avgChange, -50);
  assert.equal(run.lows, 1);   // the hard run fell to 60
  assert.deepEqual(run.byIntensity.map(b => [b.intensity, b.n, b.avgChange]), [["moderate", 2, -30], ["hard", 1, -90]]);
});
