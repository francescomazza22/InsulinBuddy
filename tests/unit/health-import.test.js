import test from "node:test";
import assert from "node:assert/strict";
import { mapWorkoutLabel, caloriesDuring, estimateIntensity, workoutsToActivities, importIdFor, HEALTH_SOURCE } from "../../js/health-import.js";
import { validateEntry } from "../../js/core/schema.js";
import { activityCheck } from "../../js/activity.js";

const NOW = Date.parse("2026-10-26T09:20:00Z");
// The real workout from Francesco's first Health Webhook delivery (26 Oct 2026).
const RIDE = {
  end_time: "2026-10-26T08:38:04.210Z", id: "922E7762-E693-4D41-AF74-395F7EAB9333", label: "cycling",
  recording_method: "automatically_recorded", source: "com.apple.health.CD898D6E-C5E5-4D63-AF46-2E3202FF66FE",
  start_time: "2026-10-26T08:18:44.696Z", unit: "sessions"
};
const cal = (start, end, value) => ({ start_time: start, end_time: end, unit: "kcal", value });

test("labels map to the app's activity types; unknown ones become a named Other", () => {
  assert.deepEqual(mapWorkoutLabel("cycling"), { type: "cycle", name: "" });
  assert.deepEqual(mapWorkoutLabel("walking"), { type: "walk", name: "" });
  assert.deepEqual(mapWorkoutLabel("traditional_strength_training"), { type: "gym", name: "" });
  assert.deepEqual(mapWorkoutLabel("High Intensity Interval Training"), { type: "hiit", name: "" });
  assert.deepEqual(mapWorkoutLabel("soccer"), { type: "sport", name: "" });
  assert.deepEqual(mapWorkoutLabel("elliptical"), { type: "other", name: "Elliptical" });
  assert.deepEqual(mapWorkoutLabel("stair_climbing"), { type: "other", name: "Stair climbing" });
  assert.deepEqual(mapWorkoutLabel(""), { type: "other", name: "Workout" });
});

test("calories inside a workout count each sample by how much of it overlaps", () => {
  const s = Date.parse("2026-10-26T08:00:00Z"), e = Date.parse("2026-10-26T08:20:00Z");
  const samples = [
    cal("2026-10-26T07:50:00Z", "2026-10-26T08:10:00Z", 20), // half inside -> 10
    cal("2026-10-26T08:10:00Z", "2026-10-26T08:15:00Z", 30), // all inside -> 30
    cal("2026-10-26T08:30:00Z", "2026-10-26T08:40:00Z", 99), // outside
    { ...cal("2026-10-26T08:05:00Z", "2026-10-26T08:06:00Z", 50), unit: "kJ" } // wrong unit, ignored
  ];
  assert.equal(caloriesDuring(s, e, samples), 40);
  assert.equal(caloriesDuring(s, e, []), null);
  assert.equal(caloriesDuring(s, e, [samples[2]]), null);
});

test("intensity from calories per minute; unknown when there are no calories", () => {
  assert.deepEqual(estimateIntensity(20, 60), { intensity: "light", kcal: 60 });     // 3 kcal/min
  assert.deepEqual(estimateIntensity(20, 120), { intensity: "moderate", kcal: 120 }); // 6 kcal/min
  assert.deepEqual(estimateIntensity(20, 200), { intensity: "hard", kcal: 200 });     // 10 kcal/min
  assert.deepEqual(estimateIntensity(20, null), { intensity: "moderate", kcal: null });
});

test("the real ride becomes a valid 19-minute cycling activity starting at its start time", () => {
  const calories = [cal("2026-10-26T08:18:00Z", "2026-10-26T08:39:00Z", 126)];
  const [a, ...rest] = workoutsToActivities([{ sessions: [RIDE], calories }], { now: NOW });
  assert.equal(rest.length, 0);
  assert.equal(a.id, "hk-922E7762-E693-4D41-AF74-395F7EAB9333");
  assert.equal(a.entryType, "activity");
  assert.equal(a.activityType, "cycle");
  assert.equal(a.durationMin, 19);
  assert.equal(a.ts, Date.parse(RIDE.start_time));
  assert.equal(a.intensity, "moderate");
  assert.equal(a.source, HEALTH_SOURCE);
  assert.match(a.note, /From Apple Health · 116 kcal \(intensity estimated\)/);
  // no insulin, carbs or glucose: it can never change a dose
  for (const k of ["totalCarbs", "mealDose", "correctionDose"]) assert.equal(a[k], 0);
  assert.equal(a.glucose, null);
  assert.deepEqual(validateEntry(a), []);
  assert.equal(activityCheck({ type: a.activityType, name: a.activityName, minutes: a.durationMin, intensity: a.intensity, ts: a.ts }, NOW), "");
});

test("never a duplicate: skips workouts already logged, deleted, or repeated across deliveries", () => {
  const id = importIdFor(RIDE.id);
  assert.equal(workoutsToActivities([{ sessions: [RIDE] }], { history: [{ id }], now: NOW }).length, 0);
  assert.equal(workoutsToActivities([{ sessions: [RIDE] }], { deleted: { [id]: NOW - 1000 }, now: NOW }).length, 0);
  assert.equal(workoutsToActivities([{ sessions: [RIDE] }, { sessions: [RIDE] }], { now: NOW }).length, 1);
});

test("short, broken, future or unsafe-id sessions are skipped; several come back oldest first", () => {
  const short = { ...RIDE, id: "A1", end_time: "2026-10-26T08:21:00Z" };            // ~2 min
  const broken = { ...RIDE, id: "A2", end_time: "not a date" };
  const backwards = { ...RIDE, id: "A3", end_time: "2026-10-26T08:00:00Z" };
  const future = { ...RIDE, id: "A4", start_time: "2026-10-26T12:00:00Z", end_time: "2026-10-26T13:00:00Z" };
  const unsafe = { ...RIDE, id: "<script>" };
  const walk = { ...RIDE, id: "B1", label: "walking", start_time: "2026-10-25T17:00:00Z", end_time: "2026-10-25T17:40:00Z" };
  const out = workoutsToActivities([{ sessions: [RIDE, short, broken, backwards, future, unsafe, walk, null] }, { sessions: "nope" }, null], { now: NOW });
  assert.deepEqual(out.map(e => e.id), ["hk-B1", "hk-922E7762-E693-4D41-AF74-395F7EAB9333"]);
  assert.equal(out[0].note, "From Apple Health (intensity not known)");
});
