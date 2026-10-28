import test from "node:test";
import assert from "node:assert/strict";
import { basalActivityRule, activitiesBeforeBasal, basalActivitySuggestion, BASAL_ACTIVITY_DEFAULTS, computeDose } from "../../js/calc.js";
import { makeActivityEntry } from "../../js/activity.js";
import { makeBasalEntry } from "../../js/history.js";
import { normalizeState } from "../../js/state.js";

const MIN = 60000;
const DOSE = Date.UTC(2026, 9, 28, 21, 0);   // the basal dose is taken at 21:00
const act = (startMinBefore, minutes, intensity, type = "run") =>
  makeActivityEntry({ type, minutes, intensity, ts: DOSE - startMinBefore * MIN, now: DOSE - startMinBefore * MIN + 1 });
const RULE = { enabled: true, lookbackMin: 60, minMinutes: 30, reducePct: 20 };

test("rule: defaults, limits, and no percentage means no suggestion", () => {
  assert.deepEqual(basalActivityRule(undefined), { ...BASAL_ACTIVITY_DEFAULTS });
  assert.deepEqual(basalActivityRule({ enabled: "yes", lookbackMin: 5, minMinutes: 999, reducePct: 80 }), { enabled: false, lookbackMin: 15, minMinutes: 240, reducePct: 50 });
  assert.equal(basalActivityRule({ reducePct: "" }).reducePct, null);
  assert.equal(basalActivityRule({ reducePct: null }).reducePct, null);
  assert.equal(basalActivityRule({ reducePct: "abc" }).reducePct, null);
  assert.equal(basalActivityRule({ reducePct: 0 }).reducePct, 1);
  assert.equal(basalActivityRule({ reducePct: 12.6 }).reducePct, 13);
  assert.equal(basalActivitySuggestion(10, { ...RULE, reducePct: null }, "0.5"), null);
});

test("finds moderate/hard activity of at least the minimum length in the look-back window", () => {
  const run = act(75, 45, "hard");               // 19:45-20:30, finished 30 min before
  const found = activitiesBeforeBasal([run], DOSE, RULE);
  assert.equal(found.length, 1);
  assert.equal(found[0].entry, run);
  assert.equal(found[0].minutesBefore, 30);
});

test("ignores light, too short, too early, after the dose, and anything that isn't an activity", () => {
  const history = [
    act(50, 40, "light"),                       // light
    act(40, 25, "hard"),                        // 25 min < 30
    act(200, 60, "hard"),                       // ended 140 min before, outside 60
    act(-10, 45, "hard"),                       // starts after the dose
    makeBasalEntry({ units: 10, ts: DOSE - 30 * MIN, slot: "pm" }),
    { id: "m1", ts: DOSE - 30 * MIN, entryType: undefined, mealType: "dinner", durationMin: 60, intensity: "hard" }
  ];
  assert.deepEqual(activitiesBeforeBasal(history, DOSE, RULE), []);
});

test("window edges: ending exactly at the edge counts; starting before the window but running into it counts; still going counts", () => {
  assert.equal(activitiesBeforeBasal([act(90, 30, "moderate")], DOSE, RULE).length, 1, "ended exactly 60 min before");
  assert.equal(activitiesBeforeBasal([act(91, 30, "moderate")], DOSE, RULE).length, 0, "ended 61 min before");
  assert.equal(activitiesBeforeBasal([act(150, 120, "moderate")], DOSE, RULE)[0].minutesBefore, 30, "long ride overlapping the window");
  assert.equal(activitiesBeforeBasal([act(20, 60, "hard")], DOSE, RULE)[0].minutesBefore, 0, "still going when the dose is taken");
  assert.equal(activitiesBeforeBasal([act(30, 30, "hard")], DOSE, RULE).length, 1, "exactly the minimum length");
});

test("his look-back and minimum settings are used", () => {
  const walk = act(150, 60, "moderate", "walk");   // ended 90 min before
  assert.equal(activitiesBeforeBasal([walk], DOSE, RULE).length, 0);
  assert.equal(activitiesBeforeBasal([walk], DOSE, { ...RULE, lookbackMin: 120 }).length, 1);
  assert.equal(activitiesBeforeBasal([walk], DOSE, { ...RULE, lookbackMin: 120, minMinutes: 75 }).length, 0);
});

test("newest first, and a bad dose time finds nothing", () => {
  const a = act(100, 50, "hard"), b = act(40, 30, "moderate");
  assert.deepEqual(activitiesBeforeBasal([a, b], DOSE, RULE).map(x => x.entry), [b, a]);
  assert.deepEqual(activitiesBeforeBasal([a, b], NaN, RULE), []);
  assert.deepEqual(activitiesBeforeBasal(null, DOSE, RULE), []);
});

test("suggestion: his % off, rounded to the pen step, half-steps to the smaller dose", () => {
  assert.deepEqual(basalActivitySuggestion(10, RULE, "0.5"), { units: 8, fromUnits: 10, pct: 20, exact: 8, changed: true });
  assert.equal(basalActivitySuggestion(8, RULE, "0.5").units, 6.5);       // 6.4 -> 6.5
  assert.equal(basalActivitySuggestion(8, RULE, "1").units, 6);           // 6.4 -> 6
  assert.equal(basalActivitySuggestion(8, RULE, "0.1").units, 6.4);
  assert.equal(basalActivitySuggestion(12.5, { ...RULE, reducePct: 50 }, "0.5").units, 6);   // 6.25: exact half-step goes down
  assert.equal(basalActivitySuggestion(9, { ...RULE, reducePct: 50 }, "1").units, 4);        // 4.5 goes down
  const tiny = basalActivitySuggestion(8, { ...RULE, reducePct: 5 }, "1");
  assert.equal(tiny.units, 8); assert.equal(tiny.changed, false); assert.equal(tiny.exact, 7.6);
  for (const bad of [0, -2, NaN, null, undefined, "8"]) assert.equal(basalActivitySuggestion(bad, RULE, "0.5"), null);
});

test("never more than 50% off and never below zero, for any dose and step", () => {
  for (let u = 0.5; u <= 80; u += 0.5) for (const step of ["0.1", "0.5", "1"]) for (const pct of [1, 10, 25, 50, 99]) {
    const s = basalActivitySuggestion(u, { ...RULE, reducePct: pct }, step);
    assert.ok(s.units >= 0 && s.units <= u, `${u} ${step} ${pct}`);
    assert.ok(s.units >= u * 0.5 - Number(step) / 2 - 1e-9, `at most 50% off (plus rounding): ${u} ${step} ${pct} -> ${s.units}`);
  }
});

test("settings: an old saved state gets the default rule; a saved rule survives a reload", () => {
  const defaults = () => ({ settings: { basalActivity: { ...BASAL_ACTIVITY_DEFAULTS }, insulinModel: {}, carbAbsorptionMinutes: {} }, library: [], recipes: [], history: [] });
  assert.deepEqual(normalizeState({ settings: {} }, defaults).settings.basalActivity, BASAL_ACTIVITY_DEFAULTS);
  assert.deepEqual(normalizeState({ settings: { basalActivity: { enabled: true, reducePct: 20 } } }, defaults).settings.basalActivity, { ...BASAL_ACTIVITY_DEFAULTS, enabled: true, reducePct: 20 });
});

test("the meal dose is not touched by the rule or by activity", () => {
  const settings = { isf: 50, target: 100, units: "mgdl", rounding: "0.5", maxDose: 15, iobAwareCorrection: false };
  const a = computeDose({ carbs: 60, ratio: 10, correctionOn: true, glucose: "180", glucoseUnit: "mgdl", iob: 0, settings });
  const b = computeDose({ carbs: 60, ratio: 10, correctionOn: true, glucose: "180", glucoseUnit: "mgdl", iob: 0, settings: { ...settings, basalActivity: RULE } });
  assert.equal(a.finalDose, 7.5);   // 6u for 60 g at 1u:10g + 1.6u correction, rounded
  assert.deepEqual(a, b);
});
