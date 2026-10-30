import test from "node:test";
import assert from "node:assert/strict";
import { ratioSnapshot, recordRatioChange, mergeRatioHistory, ratioTimeline, ratioChanges, RATIO_HISTORY_MAX } from "../../js/ratio-history.js";

const settings = () => ({
  timeRatios: [
    { id: "tr-morning", name: "Morning", ratio: 12, start: "05:30", end: "11:00", color: "#C93400" },
    { id: "tr-lunch", name: "Lunch", ratio: 7.5, start: "11:00", end: "15:00", color: "#248A3D" }
  ],
  activityRatios: [{ id: "ar-sport", name: "Sport", ratio: 18, color: "#8B5CF6" }]
});
const meal = (ts, label, ratio, over = {}) => ({ id: `m${ts}`, ts, ratioLabel: label, ratioValue: ratio, totalCarbs: 40, mealDose: 3, ...over });
const DAY = 86400000;

test("snapshot: time brackets then activity ones", () => {
  assert.deepEqual(ratioSnapshot(settings()).map(r => [r.name, r.ratio, r.kind]), [["Morning", 12, "time"], ["Lunch", 7.5, "time"], ["Sport", 18, "activity"]]);
});

test("records where things stand, then only real changes", () => {
  const s = settings();
  assert.equal(recordRatioChange(s, 1000), true);
  assert.equal(s.ratioHistory.length, 1);
  assert.equal(recordRatioChange(s, 2000), false, "nothing changed");
  s.timeRatios[0].start = "06:00"; s.timeRatios[0].color = "#000000";
  assert.equal(recordRatioChange(s, 3000), false, "times and colours don't count");
  s.timeRatios[0].ratio = 13;
  assert.equal(recordRatioChange(s, 4000), true);
  assert.deepEqual(s.ratioHistory.map(h => [h.ts, h.ratios[0].ratio]), [[1000, 12], [4000, 13]]);
  s.timeRatios[1].name = "Midday";
  assert.equal(recordRatioChange(s, 5000), true, "a rename is recorded");
  s.timeRatios.push({ id: "tr-night", name: "Night", ratio: 12, start: "23:30", end: "05:30" });
  assert.equal(recordRatioChange(s, 6000), true, "a new bracket is recorded");
});

test("the record is capped", () => {
  const s = settings();
  for (let i = 0; i < RATIO_HISTORY_MAX + 20; i++) { s.timeRatios[0].ratio = 10 + (i % 2); recordRatioChange(s, i); }
  assert.equal(s.ratioHistory.length, RATIO_HISTORY_MAX);
  assert.equal(s.ratioHistory[s.ratioHistory.length - 1].ts, RATIO_HISTORY_MAX + 19);
});

test("two devices' records are merged once each, in order", () => {
  const r = (ts, v) => ({ ts, ratios: [{ id: "a", name: "A", ratio: v, kind: "time" }] });
  const m = mergeRatioHistory([r(1, 10), r(3, 12)], [r(1, 10), r(2, 11), null, { ts: "x" }]);
  assert.deepEqual(m.map(h => h.ts), [1, 2, 3]);
});

test("timeline: ratios used per bracket, from the meals, in the period", () => {
  const s = settings();
  const h = [
    meal(10 * DAY, "Morning", 11), meal(11 * DAY, "Morning", 12), meal(12 * DAY, "Morning", 12), meal(12 * DAY + 5, "Lunch", 8),
    meal(13 * DAY, "Sport", 18), meal(2 * DAY, "Morning", 10),                  // before the period
    meal(11 * DAY + 1, "Old bracket", 9),                                     // a bracket deleted since
    meal(11 * DAY + 2, "Morning", 12, { noInsulin: true }),                   // a treated low: no ratio used
    meal(11 * DAY + 3, null, null),                                           // an old meal with no ratio saved
    { id: "b", ts: 11 * DAY, entryType: "basal", basalDose: 12 }
  ];
  const t = ratioTimeline(h, s, { from: 9 * DAY, to: 14 * DAY });
  assert.deepEqual(t.brackets.map(b => [b.name, b.count]), [["Morning", 3], ["Lunch", 1], ["Sport", 1], ["Old bracket", 1]]);
  const m = t.brackets[0];
  assert.deepEqual(m.used.map(u => u.ratio), [11, 12, 12]);
  assert.equal(m.current, 12);
  assert.equal(m.color, "#C93400");
  assert.equal(t.brackets[3].current, null);
  assert.equal(t.unrecorded, 1);
  assert.deepEqual(ratioChanges(m.used), [{ ts: 11 * DAY, from: 11, to: 12 }]);
});

test("timeline: settings steps, including the value in force when the period starts", () => {
  const s = settings();
  s.ratioHistory = [
    { ts: 5 * DAY, ratios: [{ id: "tr-morning", name: "Morning", ratio: 11, kind: "time" }] },
    { ts: 11 * DAY, ratios: [{ id: "tr-morning", name: "Morning", ratio: 12, kind: "time" }, { id: "tr-lunch", name: "Lunch", ratio: 8, kind: "time" }] },
    { ts: 12 * DAY, ratios: [{ id: "tr-morning", name: "Morning", ratio: 12, kind: "time" }, { id: "tr-lunch", name: "Lunch", ratio: 7.5, kind: "time" }] }
  ];
  const t = ratioTimeline([], s, { from: 9 * DAY, to: 14 * DAY });
  const m = t.brackets.find(b => b.name === "Morning"), l = t.brackets.find(b => b.name === "Lunch");
  assert.deepEqual(m.set, [{ ts: 9 * DAY, ratio: 11 }, { ts: 11 * DAY, ratio: 12 }]);
  assert.deepEqual(l.set, [{ ts: 11 * DAY, ratio: 8 }, { ts: 12 * DAY, ratio: 7.5 }]);
  assert.equal(t.brackets.find(b => b.name === "Sport"), undefined, "no meals and nothing recorded: not shown");
});

test("sync keeps both devices' ratio records (settings are otherwise taken whole from the newer side)", async () => {
  const { mergeStates } = await import("../../js/state.js");
  const base = { isf: 50, target: 100, units: "mgdl", maxDose: 15, timeRatios: [{ id: "a", name: "A", ratio: 10, start: "00:00", end: "00:00" }], activityRatios: [] };
  const rec = (ts, v) => ({ ts, ratios: [{ id: "a", name: "A", ratio: v, kind: "time" }] });
  const local = { schemaVersion: 2, settingsUpdatedAt: 5, settings: { ...base, ratioHistory: [rec(1, 10), rec(4, 12)] }, library: [], recipes: [], history: [] };
  const remote = { schemaVersion: 2, settingsUpdatedAt: 3, settings: { ...base, ratioHistory: [rec(1, 10), rec(2, 11)] }, library: [], recipes: [], history: [] };
  const out = mergeStates(local, remote, () => ({ settings: base, library: [], recipes: [], history: [] }));
  assert.deepEqual(out.settings.ratioHistory.map(h => h.ts), [1, 2, 4]);
});
