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

// ---- 2.66.1: a workout and its calories can arrive in different deliveries ----
import { awaitingIntensity, intensityUpdates, UNKNOWN_INTENSITY_NOTE, INBOX_KEEP_MS } from "../../js/health-import.js";

test("an import without calories waits for them; an edited or old one doesn't", () => {
  const [a] = workoutsToActivities([{ sessions: [RIDE] }], { now: NOW });
  assert.equal(a.note, UNKNOWN_INTENSITY_NOTE);
  assert.equal(awaitingIntensity(a, NOW), true);
  assert.equal(awaitingIntensity({ ...a, note: "my own note" }, NOW), false);       // edited by hand: left alone
  assert.equal(awaitingIntensity({ ...a, source: undefined }, NOW), false);        // logged by hand
  assert.equal(awaitingIntensity(a, a.ts + INBOX_KEEP_MS + 1), false);             // too old for its calories to still be there
});

test("calories that arrive later fill in the intensity and the note", () => {
  const [a] = workoutsToActivities([{ sessions: [RIDE] }], { now: NOW });
  const later = [cal("2026-10-26T08:18:00Z", "2026-10-26T08:39:00Z", 210)];   // ~10 kcal/min
  assert.deepEqual(intensityUpdates([a], later), [{ id: a.id, intensity: "hard", note: "From Apple Health · 190 kcal (intensity estimated)" }]);
  assert.deepEqual(intensityUpdates([a], [cal("2026-10-26T10:00:00Z", "2026-10-26T10:05:00Z", 5)]), []);   // not during the ride
});

test("calories from another delivery are used when the workout is first added", () => {
  const calories = [cal("2026-10-26T08:18:00Z", "2026-10-26T08:39:00Z", 60)];
  const [a] = workoutsToActivities([{ sessions: [RIDE] }, { sessions: [], calories }], { now: NOW });
  assert.equal(a.intensity, "light");
  assert.match(a.note, /55 kcal \(intensity estimated\)/);
});

// ---- 2.75.1: Health Webhook sent the same delivery twice (30 Oct 2026, ids 24 and 25, one second apart) ----
{
  const { caloriesDuring: cal, workoutsToActivities: w2a, intensityUpdates: upd, mayBeDoubleCounted, estimatedKcal } = await import("../../js/health-import.js");
  // The 10:02:48-10:09:00 ride: Apple Watch says 39 active kcal, sent as 104 samples of 0.375 kcal.
  const start = Date.parse("2026-10-30T10:02:48.147Z"), end = Date.parse("2026-10-30T10:09:00.595Z");
  const samples = Array.from({ length: 104 }, (_, i) => {
    const a = start + i * 3500;
    return { id: `S-${i}`, unit: "kcal", value: 0.375, start_time: new Date(a).toISOString(), end_time: new Date(a + 3500).toISOString() };
  });
  const session = { id: "6F401C94-C3ED-46EB-9BF8-B05F7886A916", label: "cycling", start_time: new Date(start).toISOString(), end_time: new Date(end).toISOString() };
  const delivery = () => ({ sessions: [session], calories: samples.map(s => ({ ...s })) });

  test("2.75.1: the same delivery twice counts its calories once (39 kcal, not 78)", () => {
    assert.equal(Math.round(cal(start, end, [...samples, ...samples])), 39);
    const [ride] = w2a([delivery(), delivery()], { now: end + 600000 });
    assert.equal(ride.note, "From Apple Health · 39 kcal (intensity estimated)");
    assert.equal(ride.intensity, "moderate");                     // 39 kcal in 6 min = 6.5 a minute; 78 read as hard
  });

  test("2.75.1: samples without an id are matched on their times and value", () => {
    const noId = samples.map(({ id, ...s }) => s);
    assert.equal(Math.round(cal(start, end, [...noId, ...noId])), 39);
    // two different samples that happen to have the same value are both counted
    assert.equal(cal(0, 10, [{ unit: "kcal", value: 1, start_time: new Date(0).toISOString(), end_time: new Date(5).toISOString() }, { unit: "kcal", value: 1, start_time: new Date(5).toISOString(), end_time: new Date(10).toISOString() }]), 2);
  });

  test("2.75.1: an untouched import that was doubled is corrected; an edited one is left alone", () => {
    const now = end + 3600000;
    const doubled = { id: "hk-" + session.id, entryType: "activity", source: "appleHealth", ts: start, durationMin: 6, intensity: "hard", note: "From Apple Health · 78 kcal (intensity estimated)" };
    assert.equal(estimatedKcal(doubled), 78);
    assert.ok(mayBeDoubleCounted(doubled, now));
    assert.deepEqual(upd([doubled], [...samples, ...samples]), [{ id: doubled.id, intensity: "moderate", note: "From Apple Health · 39 kcal (intensity estimated)" }]);
    const edited = { ...doubled, intensity: "light" };            // changed by hand: no longer the estimate's intensity
    assert.equal(estimatedKcal(edited), null);
    assert.equal(mayBeDoubleCounted(edited, now), false);
    assert.deepEqual(upd([edited], samples), []);
    const renamed = { ...doubled, note: "Commute" };
    assert.equal(mayBeDoubleCounted(renamed, now), false);
  });

  test("2.75.1: a correct estimate is never raised (some samples may already be tidied away)", () => {
    const right = { id: "hk-x", entryType: "activity", source: "appleHealth", ts: start, durationMin: 6, intensity: "moderate", note: "From Apple Health · 39 kcal (intensity estimated)" };
    assert.deepEqual(upd([right], samples), []);                         // same figure: nothing to do
    assert.deepEqual(upd([right], [...samples, ...samples.map(s => ({ ...s, id: s.id + "b" }))]), []);   // more calories found: left as it is
    assert.equal(mayBeDoubleCounted(right, start + 3 * 86400000), false);   // too old to re-check
  });
}
