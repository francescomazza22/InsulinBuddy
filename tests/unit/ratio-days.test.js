import test from "node:test";
import assert from "node:assert/strict";
import { ratioAt, ratioMatch, bracketDays, daysLabel } from "../../js/core/time.js";
import { validateSettings } from "../../js/core/schema.js";

const morning = { id: "m", name: "Morning", start: "06:00", end: "11:00", ratio: 10 };
const sunday = { id: "s", name: "Sunday morning", start: "06:00", end: "11:00", ratio: 14, days: [0] };
const wfh = { id: "w", name: "Home day", start: "07:00", end: "10:00", ratio: 12, days: [3, 0] };
const evening = { id: "e", name: "Evening", start: "11:00", end: "06:00", ratio: 8 };
const list = [morning, sunday, wfh, evening];
// 2026-10-18 is a Sunday, 10-19 Monday, 10-21 Wednesday
const at = (day, h, m = 0) => new Date(2026, 9, day, h, m);

test("a day-limited bracket beats the every-day one on its day only", () => {
  assert.equal(ratioAt(list, at(18, 8)).id, "s");
  assert.equal(ratioAt(list, at(19, 8)).id, "m");
});
test("fewer days is more specific: Sunday-only beats a Wed+Sun bracket on Sunday, which beats everyday on Wednesday", () => {
  assert.equal(ratioAt(list, at(18, 8)).id, "s");
  assert.equal(ratioAt(list, at(21, 8)).id, "w");
  assert.equal(ratioAt(list, at(21, 6, 30)).id, "m");   // outside the Wed bracket hours
});
test("brackets that wrap midnight still work", () => {
  assert.equal(ratioAt(list, at(19, 23)).id, "e");
  assert.equal(ratioAt(list, at(19, 3)).id, "e");
});
test("ratioMatch is null when nothing covers the time, and ratioAt falls back to an every-day bracket", () => {
  const gap = [{ id: "a", name: "A", start: "08:00", end: "09:00", ratio: 9, days: [0] }, morning];
  assert.equal(ratioMatch([gap[0]], 8 * 60 + 30, 1), null);
  assert.equal(ratioAt([gap[0], { ...morning, start: "09:00", end: "10:00" }], at(19, 8, 30)).id, "m");
});
test("bracketDays treats empty / all seven as every day and daysLabel reads well", () => {
  assert.deepEqual(bracketDays({ days: [] }), []);
  assert.deepEqual(bracketDays({ days: [0, 1, 2, 3, 4, 5, 6] }), []);
  assert.equal(daysLabel({ days: [5, 4, 3, 2, 1] }), "Mon\u2013Fri");
  assert.equal(daysLabel({ days: [0] }), "Sun");
  assert.equal(daysLabel({}), "");
});
test("old data without days behaves exactly as before", () => {
  const old = [morning, evening];
  assert.equal(ratioAt(old, at(18, 8)).id, "m");
});
test("schema accepts days and rejects nonsense", () => {
  const base = { isf: 50, target: 100, maxDose: 20, units: "mgdl", timeRatios: [{ ...morning, days: [0] }] };
  assert.ok(!validateSettings(base, "s").some(p => p.severity === "error" && /days/.test(p.path)));
  base.timeRatios = [{ ...morning, days: [9] }];
  assert.ok(validateSettings(base, "s").some(p => /days/.test(p.path)));
});
