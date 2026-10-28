import test from "node:test";
import assert from "node:assert/strict";
import { buildForecastLibrary, forecastRange, momentFeatures, glucoseForecast, forecastSummary, FORECAST_K, LOW_TREAT_MINUTES } from "../../js/glucose-forecast.js";

const MIN = 60000, HOUR = 3600000, DAY = 86400000;
const T0 = Date.UTC(2026, 9, 1, 0, 0, 0);
const settings = { isfMgdl: 50, peak: 75, dia: 360, absMinutes: () => 180, fallbackRatio: 10 };
const readingsFrom = (days, fn, every = 5) => { const out = []; for (let t = T0; t <= T0 + days * DAY; t += every * MIN) out.push({ at: t, mgdl: fn(t) }); return out; };
// a seeded random so failures repeat
const rng = seed => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

test("a glucose that never moves forecasts no movement and a zero-width range", () => {
  const rs = readingsFrom(20, () => 120);
  const now = T0 + 20 * DAY;
  const fc = glucoseForecast([], rs, settings, now);
  assert.ok(fc, "enough history gives a forecast");
  assert.equal(fc.points.length, 9, "now plus 8 steps of 15 min");
  for (const p of fc.points) { assert.equal(Math.round(p.mid), 120); assert.equal(Math.round(p.low), 120); assert.equal(Math.round(p.high), 120); }
});

test("a repeating rise is forecast from the matching phase, not the falling one at the same level", () => {
  // every 4 h: 2 h rising 100 -> 180, then 2 h falling back
  const wave = t => { const m = ((t - T0) / MIN) % 240; return m < 120 ? 100 + (80 * m) / 120 : 180 - (80 * (m - 120)) / 120; };
  const rs = readingsFrom(21, wave);
  const now = T0 + 20 * DAY + 60 * MIN;          // rising, at 140
  const fc = glucoseForecast([], rs.filter(r => r.at <= now), settings, now);
  const at30 = fc.points.find(p => p.minutes === 30);
  assert.ok(Math.abs(fc.start.mgdl - 140) < 1);
  assert.ok(at30.mid > 150 && at30.mid < 166, "rising 20 mg/dL per 30 min: " + at30.mid);
  const at120 = fc.points.find(p => p.minutes === 120);
  assert.ok(at120.mid > 135 && at120.mid < 155, "an hour up to 180 then an hour back down ends near 140: " + at120.mid);
  const at60 = fc.points.find(p => p.minutes === 60);
  assert.ok(at60.mid > 170, "the peak at 180 is an hour ahead: " + at60.mid);
});

test("outcomes not yet known at that time are never used (no peeking)", () => {
  const now = T0 + 10 * DAY;
  const lib = [];
  for (let t = T0; t < now; t += 15 * MIN) {
    const recent = now - t < 2 * HOUR;
    const after = {}; for (let h = 15; h <= 120; h += 15) after[h] = recent ? 500 : 10;
    lib.push({ t, g: 120, trend: 0, insulinLeft: 0, carbsLeft: 0, after });
  }
  const fc = forecastRange(lib, { t: now, g: 120, trend: 0, insulinLeft: 0, carbsLeft: 0 });
  for (const p of fc.points.slice(1)) assert.equal(Math.round(p.mid), 130, `${p.minutes} min uses only outcomes known before now`);
});

test("a moment's outcomes stop at the next thing logged (meal, dose, treated low, basal) but not at an activity", () => {
  const rs = readingsFrom(3, () => 120);
  const meal = { ts: T0 + DAY + 12 * HOUR, totalCarbs: 40, mealDose: 4, ratioValue: 10 };
  const walk = { ts: T0 + 2 * DAY + 12 * HOUR, entryType: "activity", totalCarbs: 0, mealDose: 0 };
  const lib = buildForecastLibrary([meal, walk], rs, settings);
  const before = lib.find(m => m.t === meal.ts - 45 * MIN);
  assert.deepEqual(Object.keys(before.after).map(Number), [15, 30], "only the steps before the meal count");
  const beforeWalk = lib.find(m => m.t === walk.ts - 45 * MIN);
  assert.equal(Object.keys(beforeWalk.after).length, 8, "an activity doesn't cut the stretch short");
});

test("a treated low counts as absorbed in 45 minutes; a meal by its own absorption time", () => {
  const rs = readingsFrom(1, () => 90);
  const low = { ts: T0 + 10 * HOUR, totalCarbs: 20, noInsulin: true, mealDose: 0, ratioValue: 15 };
  const f30 = momentFeatures([low], rs, settings, low.ts + 30 * MIN);
  assert.ok(Math.abs(f30.carbsLeft - (50 / 15) * 20 * (1 - 30 / LOW_TREAT_MINUTES)) < 0.01, String(f30.carbsLeft));
  assert.equal(momentFeatures([low], rs, settings, low.ts + 50 * MIN).carbsLeft, 0);
  const meal = { ts: T0 + 10 * HOUR, totalCarbs: 60, mealDose: 6, ratioValue: 10 };
  const f = momentFeatures([meal], rs, settings, meal.ts + 90 * MIN);
  assert.ok(Math.abs(f.carbsLeft - 5 * 60 * 0.5) < 0.01, "half of 60 g left at 90 of 180 min, 5 mg/dL per g");
  assert.ok(f.insulinLeft > 0 && f.insulinLeft < 6 * 50, "some of the 6 u still to act over the next 2 h");
});

test("no forecast without a recent reading or without enough history", () => {
  const rs = readingsFrom(20, () => 120);
  assert.equal(glucoseForecast([], rs, settings, T0 + 20 * DAY + 30 * MIN), null, "latest reading 30 min old");
  const short = readingsFrom(0.25, () => 120);
  assert.equal(glucoseForecast([], short, settings, T0 + 6 * HOUR), null, `under ${FORECAST_K} past moments per step`);
  assert.equal(glucoseForecast([], [], settings, T0), null);
  assert.equal(glucoseForecast([], rs, { ...settings, isfMgdl: 0 }, T0 + 20 * DAY), null, "no correction factor");
});

test("on noisy random histories the range is ordered, within 40-400 and finite", () => {
  for (let seed = 1; seed <= 5; seed++) {
    const r = rng(seed);
    let g = 120;
    const rs = readingsFrom(16, () => { g = Math.min(390, Math.max(45, g + (r() - 0.5) * 12 + (120 - g) * 0.01)); return g; });
    const entries = [];
    for (let d = 0; d < 16; d++) entries.push({ ts: T0 + d * DAY + 13 * HOUR, totalCarbs: 40 + 60 * r(), mealDose: 4 + 6 * r(), ratioValue: 10 }, { ts: T0 + d * DAY + 16 * HOUR, totalCarbs: 15, noInsulin: true, mealDose: 0, ratioValue: 15 });
    for (const off of [2, 8, 13.5, 16.5, 20]) {
      const now = T0 + 15 * DAY + off * HOUR;
      const fc = glucoseForecast(entries, rs.filter(x => x.at <= now), settings, now);
      assert.ok(fc, `seed ${seed} +${off}h`);
      for (const p of fc.points) {
        assert.ok([p.low, p.mid, p.high].every(Number.isFinite));
        assert.ok(p.low <= p.mid + 1e-9 && p.mid <= p.high + 1e-9, JSON.stringify(p));
        assert.ok(p.low >= 40 && p.high <= 400);
      }
      const s = forecastSummary(fc);
      assert.equal(s.end.minutes, 120);
    }
  }
});

test("the same history in any order gives the same forecast", () => {
  const r = rng(7);
  const rs = readingsFrom(16, t => 120 + 40 * Math.sin((t - T0) / (3 * HOUR)) + (r() - 0.5) * 6);
  const entries = []; for (let d = 0; d < 16; d++) entries.push({ ts: T0 + d * DAY + 12 * HOUR, totalCarbs: 50, mealDose: 5, ratioValue: 10 });
  const now = T0 + 15 * DAY + 13 * HOUR;
  const a = glucoseForecast(entries, rs.filter(x => x.at <= now), settings, now);
  const b = glucoseForecast([...entries].reverse(), rs.filter(x => x.at <= now).reverse(), settings, now);
  assert.deepEqual(a, b);
});
