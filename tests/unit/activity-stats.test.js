import test from "node:test";
import assert from "node:assert/strict";
import { nearActivity, activitySkip, countNearActivity, breakfastByActivity, activitySummary } from "../../js/activity-stats.js";
import { postMealCurves, outcomeByBracket, foodImpact, correctionEffectiveness, iobStacking } from "../../js/insights.js";
import { idealRatioByBracket } from "../../js/calc.js";
import { makeActivityEntry } from "../../js/activity.js";

process.env.TZ = process.env.TZ || "Europe/London";
const MIN = 60000, HOUR = 3600000, DAY = 86400000;
// Local-time helper: day 0 = Monday 5 Oct 2026.
const at = (day, h, m = 0) => new Date(2026, 9, 5 + day, h, m).getTime();
let n = 0;
const meal = (ts, over = {}) => ({ id: `m${++n}`, ts, mealType: "breakfast", items: [{ name: "Porridge", grams: 60, carbs: 40, refType: "food" }], totalCarbs: 40, mealDose: 4, correctionDose: 0, noInsulin: false, ratioLabel: "Breakfast", ratioValue: 10, ...over });
const ride = (ts, minutes = 20, over = {}) => ({ ...makeActivityEntry({ type: "cycle", minutes, intensity: "moderate", ts, now: ts }), id: `a${++n}`, ...over });
// Readings every 5 minutes: `fn(t)` gives mg/dL.
function readings(from, to, fn) { const out = []; for (let t = from; t <= to; t += 5 * MIN) out.push({ at: t, mgdl: fn(t) }); return out; }

test("near activity: from 2 h before the meal to 4 h after it, by overlap", () => {
  const m = meal(at(0, 8));
  const cases = [
    [ride(at(0, 5, 30), 20), false],   // ended 5:50, more than 2 h before
    [ride(at(0, 5, 50), 20), true],    // ends 6:10, inside 2 h before
    [ride(at(0, 8, 18), 19), true],    // the commute right after breakfast
    [ride(at(0, 11, 50), 30), true],   // starts within 4 h after
    [ride(at(0, 12, 10), 30), false]   // starts more than 4 h after
  ];
  for (const [a, want] of cases) assert.equal(nearActivity([m, a])(m), want, new Date(a.ts).toTimeString());
  assert.equal(nearActivity([m])(m), false);
  const a = ride(at(0, 8, 18));
  assert.equal(nearActivity([m, a])(a), false, "an activity is never itself 'near activity'");
  assert.equal(nearActivity([m, a])({ entryType: "basal", ts: at(0, 8), basalDose: 10 }), false);
});

test("filter choices and counts", () => {
  const m1 = meal(at(0, 8)), m2 = meal(at(1, 8)), a = ride(at(0, 8, 18));
  const near = nearActivity([m1, m2, a]);
  assert.equal(activitySkip("without", near)(m1), true);
  assert.equal(activitySkip("without", near)(m2), false);
  assert.equal(activitySkip("only", near)(m1), false);
  assert.equal(activitySkip("only", near)(m2), true);
  assert.equal(activitySkip("all", near)(m1), false);
  assert.deepEqual(countNearActivity([m1, m2, a, { entryType: "basal", ts: at(0, 9) }], near), { near: 1, other: 1 });
});

// Two weeks: weekday breakfasts followed by a ride (glucose falls to ~75), weekend ones without (glucose rises to ~190).
function fortnight() {
  const entries = [], rs = [];
  for (let d = 0; d < 14; d++) {
    const weekend = d % 7 >= 5;
    const b = meal(at(d, 7, 30));
    entries.push(b);
    if (!weekend) entries.push(ride(at(d, 8, 18), 20));
    const base = 130;
    rs.push(...readings(at(d, 0), at(d, 23, 55), t => {
      const h = (t - b.ts) / HOUR;
      if (h < 0 || h > 5) return base;
      return weekend ? base + 60 * Math.sin(Math.min(h, 3) / 3 * Math.PI / 2) : base - 55 * Math.sin(Math.min(h, 3) / 3 * Math.PI / 2);
    }));
  }
  return { entries, rs };
}

test("leaving out meals near activity changes the meal statistics; 'all' is exactly the old result", () => {
  const { entries, rs } = fortnight();
  const near = nearActivity(entries);
  const all = outcomeByBracket(entries, rs, { afterHours: 3 });
  const without = outcomeByBracket(entries, rs, { afterHours: 3, skip: activitySkip("without", near) });
  const only = outcomeByBracket(entries, rs, { afterHours: 3, skip: activitySkip("only", near) });
  assert.deepEqual(outcomeByBracket(entries, rs, { afterHours: 3, skip: activitySkip("all", near) }), all);
  assert.equal(all.total, 14);
  assert.equal(without.total, 4);   // the four weekend breakfasts
  assert.equal(only.total, 10);
  assert.ok(without.all.avgEnd > 180 && only.all.avgEnd < 80, `${without.all.avgEnd} / ${only.all.avgEnd}`);
  assert.equal(postMealCurves(entries, rs, { skip: activitySkip("without", near) }).meals, 4);
  assert.equal(iobStacking(entries, rs, { skip: activitySkip("only", near) }).clean.n, 10);
  assert.equal(foodImpact(entries, rs, { skip: activitySkip("without", near) }).rows[0].n, 4);
});

test("corrections near an activity can be left out too", () => {
  const c = { id: "c1", ts: at(0, 15), items: [], totalCarbs: 0, mealDose: 0, correctionDose: 2, noInsulin: false };
  const a = ride(at(0, 16), 30);
  const rs = readings(at(0, 12), at(0, 20), t => (t < c.ts ? 220 : 220 - Math.min(3, (t - c.ts) / HOUR) * 30));
  const near = nearActivity([c, a]);
  assert.equal(correctionEffectiveness([c, a], rs).n, 1);
  assert.equal(correctionEffectiveness([c, a], rs, { skip: activitySkip("without", near) }).n, 0);
});

test("ideal ratio: a skipped meal's low is not moved onto an earlier meal", () => {
  const early = meal(at(0, 7)), late = meal(at(0, 9)), low = { id: "l1", ts: at(0, 10), items: [{ name: "Juice", carbs: 15 }], totalCarbs: 15, mealDose: 0, correctionDose: 0, noInsulin: true };
  const a = ride(at(0, 9, 30), 30);
  const entries = [early, late, low, a];
  // With `late` left out (near the ride), its low must stay with it, not land on `early`.
  const skipLate = e => e === late;
  const res = idealRatioByBracket(entries, { timeRatios: [{ name: "Breakfast", ratio: 10 }] }, 3, { skip: skipLate });
  const row = res.rows.find(r => r.label === "Breakfast");
  assert.equal(row.count, 1);
  assert.equal(row.affected, 0);
  assert.equal(row.ideal, 10);
  // Default (nothing skipped) is unchanged.
  const full = idealRatioByBracket(entries, { timeRatios: [{ name: "Breakfast", ratio: 10 }] }, 3);
  assert.equal(full.rows[0].count, 2);
  assert.equal(full.rows[0].affected, 1);
});

test("breakfast comparison: active mornings vs quiet mornings", () => {
  const { entries, rs } = fortnight();
  const b = breakfastByActivity(entries, rs);
  assert.equal(b.active.n, 10);
  assert.equal(b.quiet.n, 4);
  assert.ok(b.active.avg3h < 80 && b.quiet.avg3h > 180, `${b.active.avg3h} / ${b.quiet.avg3h}`);
  assert.ok(b.quiet.avgRise > 50 && b.active.avgRise < 5);
  assert.equal(b.active.avgRatio, 10);
  assert.deepEqual(b.active.ratioLabels, ["Breakfast"]);
  // only the first dosed meal from 05:00 to 11:00 counts as breakfast
  const extra = [...entries, meal(at(0, 10)), meal(at(1, 4)), meal(at(2, 12))];
  assert.equal(breakfastByActivity(extra, rs).active.n + breakfastByActivity(extra, rs).quiet.n, 14);
});

test("activity summary: minutes, active days, types, and glucose on active vs rest days and the nights after", () => {
  const { entries, rs } = fortnight();
  entries.push({ ...makeActivityEntry({ type: "walk", minutes: 45, intensity: "light", ts: at(5, 15), now: at(5, 15) }), id: "w1" });
  const s = activitySummary(entries, rs, { days: 14, now: at(13, 20) });
  assert.equal(s.sessions, 11);
  assert.equal(s.totalMinutes, 10 * 20 + 45);
  assert.equal(Math.round(s.minutesPerWeek), Math.round((245 / 14) * 7));
  assert.equal(s.activeDays, 11);
  assert.deepEqual(s.byType.map(t => [t.label, t.n, t.minutes]), [["Cycling", 10, 200], ["Walk", 1, 45]]);
  assert.equal(s.activeDayStats.days, 11);
  assert.equal(s.restDayStats.days, 3);
  assert.ok(s.activeDayStats.tir > 90);
  assert.equal(s.activeDayStats.lowNights, 0);
  assert.ok(s.activeDayStats.nights >= 10);   // the night after today hasn't happened
  // Older activities are outside the period.
  assert.equal(activitySummary(entries, rs, { days: 7, now: at(13, 20) }).sessions, 5);
});
