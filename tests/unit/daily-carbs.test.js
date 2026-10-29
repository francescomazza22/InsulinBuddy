import test from "node:test";
import assert from "node:assert/strict";
import { dailyCarbsSummary, dailyCarbsBar } from "../../js/daily-carbs.js";

const at = (daysAgo, h, now) => { const d = new Date(now); return new Date(d.getFullYear(), d.getMonth(), d.getDate() - daysAgo, h, 0).getTime(); };
const NOW = new Date(2026, 9, 29, 15, 0).getTime();   // Thu 29 Oct 2026, 3 pm (the Sunday before was a clock change)
const meal = (daysAgo, h, carbs, over = {}) => ({ id: `m${daysAgo}-${h}`, ts: at(daysAgo, h, NOW), totalCarbs: carbs, mealDose: 1, ...over });

test("today's carbs against the average of earlier days with something logged", () => {
  const h = [meal(0, 8, 40), meal(0, 13, 60), meal(1, 8, 50), meal(1, 19, 150), meal(3, 12, 100)];
  const r = dailyCarbsSummary(h, NOW);
  assert.equal(r.today, 100);
  assert.equal(r.avg, 150);              // (200 + 100) / 2: day 2 had nothing logged and doesn't count
  assert.equal(r.daysUsed, 2);
});

test("only the last 14 complete days; today never counts towards the average", () => {
  const h = [meal(14, 12, 100), meal(15, 12, 900), meal(0, 9, 300)];
  const r = dailyCarbsSummary(h, NOW);
  assert.equal(r.avg, 100);
  assert.equal(r.today, 300);
});

test("basal and activity entries don't count; eating out has no counted carbs but treated lows do", () => {
  const h = [
    meal(1, 8, 60), meal(1, 16, 15, { noInsulin: true, mealType: "snack" }),
    { id: "b", ts: at(1, 22, NOW), entryType: "basal", basalDose: 12, totalCarbs: 0 },
    { id: "a", ts: at(1, 18, NOW), entryType: "activity", minutes: 30, totalCarbs: 999 },
    meal(0, 12, 0, { carbsUnknown: true, mealDose: 5 })
  ];
  const r = dailyCarbsSummary(h, NOW);
  assert.equal(r.avg, 75);
  assert.equal(r.today, 0);
});

test("a day with only a correction or an eating-out meal still counts as a day (0 g)", () => {
  const h = [meal(1, 8, 100), meal(2, 20, 0, { mealType: "correction", correctionDose: 1, mealDose: 0 })];
  assert.equal(dailyCarbsSummary(h, NOW).avg, 50);
});

test("nothing logged before today: no average", () => {
  const r = dailyCarbsSummary([meal(0, 8, 40)], NOW);
  assert.equal(r.avg, null);
  assert.equal(r.daysUsed, 0);
});

test("days follow the local calendar across the clock change (25 Oct 2026)", () => {
  // 23:30 on Sat 24 Oct and 00:30 on Sun 25 Oct are different days.
  const h = [{ id: "x", ts: new Date(2026, 9, 24, 23, 30).getTime(), totalCarbs: 30 }, { id: "y", ts: new Date(2026, 9, 25, 0, 30).getTime(), totalCarbs: 50 }];
  assert.equal(dailyCarbsSummary(h, NOW).daysUsed, 2);
});

test("the bar: logged part, the meal being built on top, never past the end", () => {
  const half = dailyCarbsBar({ today: 90, draft: 30, avg: 180 });
  assert.ok(half.logged === 0.5 && Math.abs(half.draft - 1 / 6) < 1e-9 && half.over === false, JSON.stringify(half));
  const full = dailyCarbsBar({ today: 160, draft: 60, avg: 180 });
  assert.ok(Math.abs(full.logged - 160 / 180) < 1e-9 && Math.abs(full.logged + full.draft - 1) < 1e-9 && full.over);
  assert.deepEqual(dailyCarbsBar({ today: 200, avg: 180 }), { logged: 1, draft: 0, over: true });
  assert.deepEqual(dailyCarbsBar({ today: 50, avg: null }), { logged: 0, draft: 0, over: false });
});
