import test from "node:test";
import assert from "node:assert/strict";
import { iobFraction } from "../../js/calc.js";
import { onBoardEffect, observedCarbs, insulinDrop } from "../../js/glucose-model.js";

const MIN = 60000, HOUR = 3600000;
const NOW = Date.UTC(2026, 9, 29, 15, 41);
const settings = { isfMgdl: 50, peak: 75, dia: 360, absMinutes: () => 180, fallbackRatio: 10 };
const close = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;

test("insulin only: pulls down by what is left of the dose x correction factor, and starts at zero", () => {
  const e = { ts: NOW - 60 * MIN, mealDose: 0, correctionDose: 2, totalCarbs: 0 };
  const r = onBoardEffect([e], settings, NOW, observedCarbs([e], [], settings, NOW));
  const left = 2 * iobFraction(60, 75, 360);
  assert.ok(close(r.iobUnits, left));
  assert.ok(close(r.insulinTotal, -left * 50, 0.5), `${r.insulinTotal} vs ${-left * 50}`);
  assert.equal(r.carbsTotal, 0);
  assert.deepEqual(r.points[0], { t: NOW, insulin: 0, carbs: 0, net: 0 });
  for (let i = 1; i < r.points.length; i++) assert.ok(r.points[i].insulin <= r.points[i - 1].insulin + 1e-9, "only ever falls");
  const atEnd = -insulinDrop([e], NOW, r.points.at(-1).t, 50, 75, 360);
  assert.ok(atEnd - r.insulinTotal < 3, "stops once under 3 mg/dL is left");
  assert.equal(r.points.at(-1).insulin, r.insulinTotal, "the last point carries the full total, so labels and words agree");
});

test("carbs only (a treated low): pushes up by grams left x correction factor / ratio, reaching it when absorbed", () => {
  const e = { ts: NOW - 30 * MIN, totalCarbs: 30, mealDose: 0, correctionDose: 0, noInsulin: true, ratioValue: 15 };
  const obs = observedCarbs([e], [], settings, NOW);
  const r = onBoardEffect([e], settings, NOW, obs);
  assert.ok(close(r.cobGrams, 30 * (1 - 30 / 180)));
  assert.ok(close(r.carbsTotal, r.cobGrams * 50 / 15), String(r.carbsTotal));
  assert.equal(r.insulinTotal, 0);
  assert.equal(r.points.at(-1).carbs, r.carbsTotal);
  assert.ok(r.points.every(p => p.carbs >= 0 && p.carbs <= r.carbsTotal + 1e-9));
});

test("today's case (29 Oct, 15:41): insulin outweighs the carbs about 4 to 1 and the chart ends by early evening", () => {
  const d = (h, m) => Date.UTC(2026, 9, 29, h, m);
  const H = [
    { ts: d(7, 4), totalCarbs: 30.1, mealDose: 2.5, correctionDose: 0, ratioValue: 13 },
    { ts: d(7, 4), entryType: "basal", mealType: "basal", basalDose: 8, mealDose: 0, correctionDose: 0, totalCarbs: 0 },
    { ts: d(11, 39), totalCarbs: 0, mealDose: 0, correctionDose: 1, ratioValue: 7.5 },
    { ts: d(12, 42), totalCarbs: 87.8, mealDose: 11.5, correctionDose: 1, ratioValue: 7.5 },
    { ts: d(15, 16), totalCarbs: 0, mealDose: 0, correctionDose: 1, ratioValue: 15 }];
  const s = { ...settings, absMinutes: () => 190 };
  const r = onBoardEffect(H, s, NOW, observedCarbs(H, [], s, NOW));
  assert.ok(r.iobUnits > 3.4 && r.iobUnits < 3.9, String(r.iobUnits));
  assert.ok(r.insulinTotal < -170 && r.insulinTotal > -195, String(r.insulinTotal));
  assert.ok(r.carbsTotal > 20 && r.carbsTotal < 50, String(r.carbsTotal));
  assert.ok(close(r.net, r.insulinTotal + r.carbsTotal));
  assert.ok(r.end < d(20, 0), new Date(r.end).toISOString());
  for (const p of r.points) assert.ok(close(p.net, p.insulin + p.carbs, 1e-9));
});

test("basal, activity and future entries are left out; nothing on board gives zeros for at least an hour", () => {
  const H = [
    { ts: NOW - HOUR, entryType: "basal", mealType: "basal", basalDose: 16, mealDose: 0, correctionDose: 0, totalCarbs: 0 },
    { ts: NOW - HOUR, entryType: "activity", mealDose: 0, correctionDose: 0, totalCarbs: 0 },
    { ts: NOW + 10 * MIN, totalCarbs: 50, mealDose: 5, correctionDose: 0, ratioValue: 10 }];
  const r = onBoardEffect(H, settings, NOW, observedCarbs(H, [], settings, NOW));
  assert.equal(r.iobUnits, 0); assert.equal(r.insulinTotal, 0); assert.equal(r.carbsTotal, 0);
  assert.equal(r.end, NOW + 60 * MIN);
  assert.ok(r.points.every(p => p.net === 0));
  assert.equal(onBoardEffect(H, { ...settings, isfMgdl: 0 }, NOW, null), null, "no correction factor, no chart");
});

test("matches insulinDrop exactly for the insulin part", () => {
  const H = [{ ts: NOW - 20 * MIN, mealDose: 4, correctionDose: 0.5, totalCarbs: 40, ratioValue: 10 }, { ts: NOW - 200 * MIN, mealDose: 6, correctionDose: 0, totalCarbs: 60, ratioValue: 10 }];
  const r = onBoardEffect(H, settings, NOW, observedCarbs(H, [], settings, NOW));
  r.points.slice(0, -1).forEach(p => assert.ok(close(p.insulin, -insulinDrop(H, NOW, p.t, 50, 75, 360), 1e-9)));
  const last = r.points.at(-1);
  assert.ok(Math.abs(last.insulin - -insulinDrop(H, NOW, last.t, 50, 75, 360)) < 3, "the last point is the total, under 3 mg/dL from the curve");
});
