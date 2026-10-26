import test from "node:test";
import assert from "node:assert/strict";
import { dayBounds, shiftDay, eventKind, dayTimeline, readingNear, stackRows } from "../../js/day-timeline.js";
import { makeActivityEntry } from "../../js/activity.js";

const MIN = 60000, HOUR = 3600000;
const at = (d, h, m = 0) => new Date(2026, 9, d, h, m).getTime();   // October 2026, local time
const meal = (ts, over = {}) => ({ id: "m" + ts, ts, mealType: "breakfast", items: [{ name: "Porridge" }, { name: "Banana" }], totalCarbs: 45, mealDose: 4.5, correctionDose: 0, noInsulin: false, ...over });

test("day bounds are local midnights, including the clock-change day", () => {
  const { start, end } = dayBounds(at(26, 15));
  assert.equal(start, at(26, 0));
  assert.equal(end, at(27, 0));
  const change = dayBounds(at(25, 12));   // 25 Oct 2026: clocks go back in the UK
  assert.equal(change.end, at(26, 0));
  assert.equal(shiftDay(at(26, 15), -1), at(25, 0));
  assert.equal(shiftDay(at(26, 15), 1), at(27, 0));
});

test("each kind of entry becomes the right marker", () => {
  assert.equal(eventKind(meal(at(26, 8))), "meal");
  assert.equal(eventKind(meal(at(26, 8), { noInsulin: true, mealDose: 0 })), "low");
  assert.equal(eventKind({ ts: at(26, 8), items: [], totalCarbs: 0, mealDose: 0, correctionDose: 2 }), "correction");
  assert.equal(eventKind({ ts: at(26, 8), items: [], totalCarbs: 0, mealDose: 0, correctionDose: 0 }), null);
  assert.equal(eventKind({ ts: at(26, 8), entryType: "basal", basalDose: 12 }), "basal");
  assert.equal(eventKind(makeActivityEntry({ type: "cycle", minutes: 19, intensity: "moderate", ts: at(26, 8, 18) })), "activity");
  assert.equal(eventKind(meal(at(26, 8), { carbsUnknown: true, totalCarbs: 0 })), "meal");   // eating out
});

test("a day's events, readings and totals", () => {
  const ride = makeActivityEntry({ type: "cycle", minutes: 19, intensity: "moderate", ts: at(26, 8, 18) });
  const lateWalk = makeActivityEntry({ type: "walk", minutes: 60, intensity: "light", ts: at(25, 23, 30) });   // runs past midnight
  const history = [
    meal(at(26, 7, 30)),
    { id: "b1", ts: at(26, 22), entryType: "basal", basalDose: 12, basalSlot: "pm" },
    { id: "c1", ts: at(26, 15), items: [], totalCarbs: 0, mealDose: 0, correctionDose: 1.5 },
    meal(at(26, 16), { noInsulin: true, mealDose: 0, totalCarbs: 15, items: [{ name: "Juice" }] }),
    ride, lateWalk,
    meal(at(25, 20)), meal(at(27, 7))   // other days
  ];
  const readings = [];
  for (let t = at(25, 22); t < at(27, 2); t += 5 * MIN) readings.push({ at: t, mgdl: t < at(26, 12) ? 120 : t < at(26, 14) ? 200 : 60 });
  const d = dayTimeline(history, readings, at(26, 13));
  assert.deepEqual(d.events.map(e => e.kind), ["activity", "meal", "activity", "correction", "low", "basal"]);
  assert.equal(d.readings.length, 288);
  assert.ok(d.readings.every(r => r.at >= at(26, 0) && r.at < at(27, 0)));
  const m = d.events[1];
  assert.deepEqual([m.carbs, m.insulin, m.foods.join(", ")], [45, 4.5, "Porridge, Banana"]);
  assert.equal(d.events[2].label, "Cycling");
  assert.equal(d.events[2].minutes, 19);
  assert.equal(d.stats.carbs, 60);
  assert.equal(d.stats.bolus, 6);
  assert.equal(d.stats.basal, 12);
  assert.equal(d.stats.activityMinutes, 19 + 30);   // only the half hour of the late walk that falls in this day
  // 144 readings 00:00-11:55 at 120, 24 at 200 (12:00-13:55), 120 at 60
  assert.equal(Math.round(d.stats.tir), 50);
  assert.equal(Math.round(d.stats.highPct), Math.round(24 / 288 * 100));
  assert.equal(Math.round(d.stats.lowPct), Math.round(120 / 288 * 100));
  assert.equal(d.stats.min, 60);
  assert.equal(d.stats.max, 200);
});

test("an empty day", () => {
  const d = dayTimeline([], [], at(26, 12));
  assert.deepEqual(d.events, []);
  assert.equal(d.stats.readings, 0);
  assert.equal(d.stats.tir, null);
  assert.equal(d.stats.avg, null);
});

test("reading near a time", () => {
  const rs = [{ at: at(26, 8), mgdl: 100 }, { at: at(26, 8, 5), mgdl: 110 }, { at: at(26, 9), mgdl: 150 }];
  assert.equal(readingNear(rs, at(26, 8, 4)), 110);
  assert.equal(readingNear(rs, at(26, 8, 30)), null);
  assert.equal(readingNear([], at(26, 8)), null);
});

test("markers close together go into separate rows", () => {
  assert.deepEqual(stackRows([{ x: 10 }, { x: 20 }, { x: 40 }, { x: 22 }, { x: 100 }], 16, 3), [0, 1, 0, 2, 0]);
  assert.deepEqual(stackRows([{ x: 10 }, { x: 11 }, { x: 12 }, { x: 13 }], 16, 2).slice(0, 2), [0, 1]);   // capped at maxRows
  assert.deepEqual(stackRows([]), []);
});
