import test from "node:test";
import assert from "node:assert/strict";
import {
  roundDose, iobFraction, cobGrams, activeAt, compoundGiInfo, giBand, computeDose,
  niceScale, buildTrendBuckets, summarizeTrends, mealTypeBreakdown, convertGlucose, absorptionMinutesForEntry
, glucoseTrendArrow, glucoseRangeClass, glucoseRangeLabel, capDoseParts, basalByDay, summarizeBasal
} from "../../js/calc.js";

const SETTINGS = {
  isf: 50, target: 100, units: "mgdl", rounding: "0.5", maxDose: 15, iobAwareCorrection: false,
  insulinModel: { preset: "rapid", peakMinutes: 75, diaMinutes: 360 },
  carbAbsorptionMinutes: { high: 120, medium: 180, low: 240, unknown: 180 }
};
import { makeBasalEntry, basalSlotForTime } from "../../js/history.js";
const close = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${a} not within ${eps} of ${b}`);

test("roundDose rounds to the user's step", () => {
  assert.equal(roundDose(1.26, "0.5"), 1.5);
  assert.equal(roundDose(1.24, "0.5"), 1);
  assert.equal(roundDose(1.26, "0.1"), 1.3);
  assert.equal(roundDose(2.4, "1"), 2);
  assert.equal(roundDose(0, "0.5"), 0);
});

test("convertGlucose round-trips and is identity for same unit", () => {
  assert.equal(convertGlucose(120, "mgdl", "mgdl"), 120);
  close(convertGlucose(180, "mgdl", "mmol"), 9.99, 0.01);
  close(convertGlucose(convertGlucose(140, "mgdl", "mmol"), "mmol", "mgdl"), 140, 1e-9);
});

// ---------------------------------------------------------------- IOB
test("IOB curve: exactly 100% at t=0 and exactly 0% at DIA", () => {
  assert.equal(iobFraction(0, 75, 360), 1);
  assert.equal(iobFraction(-5, 75, 360), 1);
  assert.equal(iobFraction(360, 75, 360), 0);
  assert.equal(iobFraction(500, 75, 360), 0);
});

test("IOB curve decreases monotonically across the whole duration", () => {
  for (const [peak, dia] of [[75, 360], [55, 360], [65, 300], [45, 240]]) {
    let prev = 1;
    for (let t = 0; t <= dia; t += 1) {
      const v = iobFraction(t, peak, dia);
      assert.ok(v <= prev + 1e-12, `not monotonic at t=${t} (peak ${peak}, dia ${dia})`);
      assert.ok(v >= 0 && v <= 1);
      prev = v;
    }
  }
});

test("IOB curve matches the published reference points (peak 75, DIA 360)", () => {
  close(iobFraction(75, 75, 360), 0.694, 0.002);
  close(iobFraction(120, 75, 360), 0.450, 0.002);
  close(iobFraction(180, 75, 360), 0.208, 0.002);
  close(iobFraction(300, 75, 360), 0.014, 0.002);
});

test("COB is linear from 100% to 0% over the absorption time", () => {
  assert.equal(cobGrams(0, 40, 120), 40);
  assert.equal(cobGrams(30, 40, 120), 30);
  assert.equal(cobGrams(60, 40, 120), 20);
  assert.equal(cobGrams(120, 40, 120), 0);
  assert.equal(cobGrams(200, 40, 120), 0);
});

test("two overlapping boluses stack, each decaying on its own age", () => {
  const now = Date.now();
  const hist = [
    { ts: now, mealDose: 2, correctionDose: 0, totalCarbs: 0 },
    { ts: now - 60 * 60000, mealDose: 3, correctionDose: 0, totalCarbs: 0 }
  ];
  const expected = 2 + 3 * iobFraction(60, 75, 360);
  close(activeAt(hist, SETTINGS, now).iob, expected, 0.05);
  // 30 minutes later both have moved along their own curves
  const later = now + 30 * 60000;
  const expLater = 2 * iobFraction(30, 75, 360) + 3 * iobFraction(90, 75, 360);
  close(activeAt(hist, SETTINGS, later).iob, expLater, 0.05);
});

test("a 4u dose 165 min ago leaves ~1u; a new 3u on top gives ~4u", () => {
  const now = Date.now();
  const old = { ts: now - 165 * 60000, mealDose: 0, correctionDose: 4, totalCarbs: 0 };
  close(activeAt([old], SETTINGS, now).iob, 1.0, 0.06);
  const fresh = { ts: now, mealDose: 0, correctionDose: 3, totalCarbs: 0 };
  close(activeAt([fresh, old], SETTINGS, now).iob, 4.03, 0.06);
});

test("clear-at times are the last contributing dose/meal's cutoff", () => {
  const now = Date.now();
  const a = { ts: now - 3600000, mealDose: 2, correctionDose: 0, totalCarbs: 30, glycemicLoad: { value: 80 } };
  const r = activeAt([a], SETTINGS, now);
  assert.equal(r.iobClearAt, a.ts + 360 * 60000);
  assert.equal(r.cobClearAt, a.ts + 120 * 60000); // high GI -> 120 min
  const r2 = activeAt([a], SETTINGS, now + 400 * 60000);
  assert.equal(r2.iobClearAt, null);
  assert.equal(r2.cobClearAt, null);
});

test("future-dated entries never count", () => {
  const now = Date.now();
  const r = activeAt([{ ts: now + 3600000, mealDose: 5, correctionDose: 0, totalCarbs: 50 }], SETTINGS, now);
  assert.equal(r.iob, 0);
  assert.equal(r.cob, 0);
});

test("carb absorption follows the compound-GI band, with a default for unknown", () => {
  const cab = SETTINGS.carbAbsorptionMinutes;
  assert.equal(absorptionMinutesForEntry({ glycemicLoad: { value: 75 } }, cab), 120);
  assert.equal(absorptionMinutesForEntry({ glycemicLoad: { value: 60 } }, cab), 180);
  assert.equal(absorptionMinutesForEntry({ glycemicLoad: { value: 40 } }, cab), 240);
  assert.equal(absorptionMinutesForEntry({ glycemicLoad: null }, cab), 180);
  assert.equal(giBand(70), "high"); assert.equal(giBand(69), "medium"); assert.equal(giBand(56), "medium"); assert.equal(giBand(55), "low");
});

// ----------------------------------------------------------------- GI
test("compound GI is carb-weighted and flags partial data", () => {
  const items = [{ gi: 80, carbs: 30 }, { gi: 40, carbs: 10 }];
  assert.deepEqual(compoundGiInfo(items), { value: 70, partial: false });
  const partial = compoundGiInfo([{ gi: 80, carbs: 30 }, { gi: null, carbs: 10 }]);
  assert.deepEqual(partial, { value: 80, partial: true });
  assert.equal(compoundGiInfo([{ gi: null, carbs: 10 }]), null);
  assert.equal(compoundGiInfo([]), null);
});

// --------------------------------------------------------------- dose
test("meal dose = carbs / ratio, rounded to the step", () => {
  const d = computeDose({ carbs: 53.3, ratio: 10, correctionOn: false, settings: SETTINGS });
  close(d.mealPart, 5.33, 0.001);
  assert.equal(d.finalDose, 5.5);
});

test("the user's correction rule: target 150, ISF 50 => BG 175 gives 0.5u", () => {
  const s = { ...SETTINGS, target: 150 };
  const d = computeDose({ carbs: 0, ratio: 10, correctionOn: true, glucose: "175", glucoseUnit: "mgdl", settings: s });
  assert.equal(d.correctionPart, 0.5);
  assert.equal(d.finalDose, 0.5);
  assert.ok(d.lines.some(l => l.includes("(175 − 150) ÷ 50")));
});

test("correction at/below target is zero and explained", () => {
  const d = computeDose({ carbs: 0, ratio: 10, correctionOn: true, glucose: "95", glucoseUnit: "mgdl", settings: SETTINGS });
  assert.equal(d.correctionPart, 0);
  assert.ok(d.lines.some(l => l.includes("at or below")));
});

test("correction on but no reading entered yet says so", () => {
  const d = computeDose({ carbs: 20, ratio: 10, correctionOn: true, glucose: "", settings: SETTINGS });
  assert.equal(d.correctionApplied, false);
  assert.ok(d.lines.some(l => l.includes("no glucose reading")));
});

test("IOB-aware correction subtracts IOB from the correction only, floored at zero", () => {
  const s = { ...SETTINGS, iobAwareCorrection: true };
  const a = computeDose({ carbs: 50, ratio: 10, correctionOn: true, glucose: "200", glucoseUnit: "mgdl", settings: s, iob: 0.5 });
  assert.equal(a.rawCorrection, 2);
  assert.equal(a.iobSubtracted, 0.5);
  assert.equal(a.correctionPart, 1.5);
  assert.equal(a.mealPart, 5); // meal never reduced
  assert.ok(a.lines.some(l => l.includes("Minus active insulin")));
  const b = computeDose({ carbs: 50, ratio: 10, correctionOn: true, glucose: "150", glucoseUnit: "mgdl", settings: s, iob: 9.9 });
  assert.equal(b.correctionPart, 0);
  assert.equal(b.iobSubtracted, 1); // capped at the raw correction
  assert.equal(b.mealPart, 5);
  // setting off: IOB ignored
  const c = computeDose({ carbs: 0, ratio: 10, correctionOn: true, glucose: "200", glucoseUnit: "mgdl", settings: SETTINGS, iob: 5 });
  assert.equal(c.correctionPart, 2);
});

test("max dose caps the total and says so", () => {
  const d = computeDose({ carbs: 300, ratio: 10, correctionOn: false, settings: SETTINGS });
  assert.equal(d.finalDose, 15);
  assert.equal(d.capped, true);
  assert.ok(d.lines.some(l => l.includes("Capped")));
});

test("treating a low records zero insulin whatever the ratio says", () => {
  const d = computeDose({ carbs: 40, ratio: 10, correctionOn: false, noInsulin: true, settings: SETTINGS });
  assert.equal(d.finalDose, 0); assert.equal(d.loggedMeal, 0); assert.equal(d.loggedCorrection, 0);
  assert.equal(d.lines.length, 1);
});

test("mg/dL readings work when the app is set to mmol/L", () => {
  const s = { ...SETTINGS, units: "mmol", target: 6, isf: 2 };
  const d = computeDose({ carbs: 0, ratio: 10, correctionOn: true, glucose: "180", glucoseUnit: "mgdl", settings: s });
  close(d.rawCorrection, (9.99 - 6) / 2, 0.01);
});

test("no ratio means no meal insulin (and never NaN)", () => {
  const d = computeDose({ carbs: 40, ratio: null, correctionOn: false, settings: SETTINGS });
  assert.equal(d.finalDose, 0);
  assert.ok(Number.isFinite(d.mealPart));
});

// ------------------------------------------------------------- trends
test("niceScale picks readable axis steps", () => {
  assert.deepEqual(niceScale(241, 3), { max: 300, step: 100 });
  assert.deepEqual(niceScale(27, 3), { max: 30, step: 10 });
  assert.deepEqual(niceScale(0.7, 3), { max: 1, step: 0.5 });
  assert.deepEqual(niceScale(0, 3), { max: 1, step: 1 });
  assert.deepEqual(niceScale(12, 3), { max: 15, step: 5 });
});

test("trend day buckets survive a clock change (London, 25 Oct 2026)", () => {
  const prevTZ = process.env.TZ;
  process.env.TZ = "Europe/London";
  try {
    const now = new Date("2026-11-05T12:00:00Z").getTime();
    const hist = [];
    for (let k = 0; k < 14; k++) {
      const d = new Date(now); d.setDate(d.getDate() - k); d.setHours(12, 0, 0, 0);
      hist.push({ ts: d.getTime(), totalCarbs: 10, mealDose: 1, correctionDose: 0 });
    }
    const { buckets, inRange } = buildTrendBuckets(hist, 14, now);
    assert.equal(buckets.length, 14);
    assert.equal(inRange.length, 14, "every day with a meal must land in a bucket");
    assert.ok(buckets.every(b => b.entries === 1), "each of the 14 days has exactly one entry");
    // the window really does cross the clock change
    const span = (buckets[13].key - buckets[0].key) / 3600000;
    assert.equal(span, 13 * 24 + 1);
  } finally {
    if (prevTZ === undefined) delete process.env.TZ; else process.env.TZ = prevTZ;
  }
});

test("trend summary: full days only, carbs per unit, corrections and lows", () => {
  const now = new Date("2026-09-28T09:00:00").getTime();
  const at = (k, h) => { const d = new Date(now); d.setDate(d.getDate() - k); d.setHours(h, 0, 0, 0); return d.getTime(); };
  const hist = [
    { mealType: "breakfast", ts: at(0, 1), totalCarbs: 40, mealDose: 4, correctionDose: 0 },            // today (partial)
    { mealType: "lunch", ts: at(1, 12), totalCarbs: 70, mealDose: 7, correctionDose: 1.5 },
    { mealType: "dinner", ts: at(1, 19), totalCarbs: 90, mealDose: 9, correctionDose: 0 },
    { mealType: "snack", ts: at(2, 10), totalCarbs: 15, mealDose: 0, correctionDose: 0, noInsulin: true },
    { mealType: "correction", ts: at(2, 15), totalCarbs: 0, mealDose: 0, correctionDose: 2.5 }
  ];
  const { buckets, inRange, todayKey } = buildTrendBuckets(hist, 7, now);
  const s = summarizeTrends(buckets, inRange, todayKey);
  assert.equal(s.avgDays, 2);                              // yesterday + the day before; today excluded
  close(s.avgCarbs, (160 + 15) / 2, 1e-9);
  close(s.avgDose, (17.5 + 2.5) / 2, 1e-9);
  assert.equal(s.regularMeals, 3);                          // breakfast, lunch, dinner (not the low, not the correction)
  assert.equal(s.corrections, 2);
  assert.equal(s.lows, 1);
  close(s.gPerU, 200 / 20, 0.05);                           // (40+70+90)/(4+7+9)
  assert.equal(s.corrPct, Math.round((4 / 24) * 100));
});

test("trend summary falls back to today when it is the only day with data", () => {
  const now = new Date("2026-09-28T09:00:00").getTime();
  const hist = [{ mealType: "breakfast", ts: now - 3600000, totalCarbs: 60, mealDose: 6, correctionDose: 0 }];
  const { buckets, inRange, todayKey } = buildTrendBuckets(hist, 7, now);
  const s = summarizeTrends(buckets, inRange, todayKey);
  assert.equal(s.usingToday, true);
  assert.equal(s.avgCarbs, 60);
});

test("meal-type breakdown ignores lows and correction-only entries", () => {
  const rows = mealTypeBreakdown([
    { mealType: "lunch", totalCarbs: 60, mealDose: 6, correctionDose: 0 },
    { mealType: "lunch", totalCarbs: 80, mealDose: 8, correctionDose: 1 },
    { mealType: "snack", totalCarbs: 15, mealDose: 0, correctionDose: 0, noInsulin: true },
    { mealType: "correction", totalCarbs: 0, mealDose: 0, correctionDose: 2 }
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].type, "lunch");
  assert.equal(rows[0].count, 2);
  assert.equal(rows[0].avgCarbs, 70);
  assert.equal(rows[0].avgDose, 7.5);
  close(rows[0].gPerU, 140 / 14, 1e-9);
});

// ------------------------------------------------------ live glucose pill
test("glucoseTrendArrow maps Nightscout's direction strings to arrows", () => {
  assert.equal(glucoseTrendArrow("Flat"), "→");
  assert.equal(glucoseTrendArrow("SingleUp"), "↑");
  assert.equal(glucoseTrendArrow("FortyFiveDown"), "↘");
  assert.equal(glucoseTrendArrow("DoubleDown"), "⇊");
  assert.equal(glucoseTrendArrow("NOT COMPUTABLE"), "");
  assert.equal(glucoseTrendArrow(undefined), "");
  assert.equal(glucoseTrendArrow(null), "");
});

test("glucoseRangeClass classifies against the low/high thresholds", () => {
  assert.equal(glucoseRangeClass(65), "low");
  assert.equal(glucoseRangeClass(70), "in-range");   // boundary is inclusive on the in-range side
  assert.equal(glucoseRangeClass(120), "in-range");
  assert.equal(glucoseRangeClass(180), "in-range");
  assert.equal(glucoseRangeClass(181), "high");
  assert.equal(glucoseRangeClass(null), null);
  assert.equal(glucoseRangeClass(undefined), null);
  assert.equal(glucoseRangeClass(NaN), null);
  assert.equal(glucoseRangeClass(50, 60, 160), "low", "custom thresholds are honoured");
  assert.equal(glucoseRangeClass(160, 60, 160), "in-range");
});

test("glucoseRangeLabel gives the LibreLink-style banner text", () => {
  assert.equal(glucoseRangeLabel("low"), "GLUCOSE LOW");
  assert.equal(glucoseRangeLabel("high"), "GLUCOSE HIGH");
  assert.equal(glucoseRangeLabel("in-range"), "GLUCOSE IN RANGE");
  assert.equal(glucoseRangeLabel(null), "");
});

// ------------------------------------------------------ rounding consistency
test("REGRESSION: the total always equals the displayed meal + correction, never a separately-rounded raw sum", () => {
  // 3.15u meal (rounds to "3u") + 0.7u correction (rounds to "0.5u") -- summing the raw values
  // first and rounding THAT lands on 4u, which contradicts the "3u" and "0.5u" shown on screen.
  const r = computeDose({ carbs: 45, ratio: 45 / 3.15, correctionOn: true, glucose: 209, glucoseUnit: "mgdl", settings: { ...SETTINGS, isf: 70, target: 160 } });
  assert.equal(roundDose(r.mealPart), 3, "sanity: meal really does round to 3u");
  assert.equal(roundDose(r.correctionPart), 0.5, "sanity: correction really does round to 0.5u");
  assert.equal(r.loggedMeal, 3);
  assert.equal(r.loggedCorrection, 0.5);
  assert.equal(r.finalDose, 3.5, "must be 3 + 0.5, not roundDose(3.15 + 0.7) = 4");
  assert.equal(r.finalDose, r.loggedMeal + r.loggedCorrection, "the total must always equal the sum of the two displayed parts");
});

test("rounding consistency holds across a wide sweep of carb/ratio/glucose combinations", () => {
  for (let carbs = 10; carbs <= 90; carbs += 7) {
    for (let ratio = 5; ratio <= 25; ratio += 3) {
      for (let glucose = 120; glucose <= 300; glucose += 11) {
        const r = computeDose({ carbs, ratio, correctionOn: true, glucose, glucoseUnit: "mgdl", settings: SETTINGS });
        // No exemption for the capped case. It used to be skipped here ("capping deliberately overrides the
        // sum"), which is exactly how a 15u screen / 19.5u log mismatch got through. The parts must add up to
        // the total that is shown, always, whether or not the cap applied.
        if (r.capped) assert.equal(r.finalDose, SETTINGS.maxDose);
        assert.ok(Math.abs(r.finalDose - (r.loggedMeal + r.loggedCorrection)) < 1e-9,
          `mismatch at carbs=${carbs} ratio=${ratio} glucose=${glucose}: total ${r.finalDose} != ${r.loggedMeal}+${r.loggedCorrection}`);
      }
    }
  }
});

test("maxDose still caps the total correctly with the new rounding order", () => {
  const r = computeDose({ carbs: 200, ratio: 5, correctionOn: true, glucose: 400, glucoseUnit: "mgdl", settings: { ...SETTINGS, maxDose: 10 } });
  assert.equal(r.finalDose, 10);
  assert.equal(r.capped, true);
});

// ------------------------------------------------------------ the max-dose cap
// A meal that calculated to 19.5u showed "15.0" on the dose card (the 15u cap) but was SAVED as 19.5u,
// because only the displayed total was capped and the saved parts were not. The parts must be capped too.
test("REGRESSION: a 19.5u meal under a 15u cap is 15u everywhere -- shown, logged, and in the parts", () => {
  const r = computeDose({ carbs: 156, ratio: 8, correctionOn: false, settings: SETTINGS });   // 156 / 8 = 19.5u
  assert.equal(r.mealPart, 19.5, "sanity: it really does calculate to 19.5u");
  assert.equal(r.finalDose, 15);
  assert.equal(r.loggedMeal, 15, "the saved meal dose must be the capped one (it was 19.5)");
  assert.equal(r.loggedCorrection, 0);
  assert.equal(r.loggedMeal + r.loggedCorrection, r.finalDose);
  assert.equal(r.capped, true);
  assert.equal(r.requestedDose, 19.5, "what it calculated before the cap is still reported");
  assert.ok(r.lines.some(l => /Capped.*15.*19\.5/.test(l)), r.lines.join(" | "));
});

test("capDoseParts: under or exactly at the limit nothing changes and nothing is flagged", () => {
  assert.deepEqual(capDoseParts({ meal: 10, correction: 3, maxDose: 15 }), { meal: 10, correction: 3, total: 13, requested: 13, capped: false, overMax: false });
  const exact = capDoseParts({ meal: 12, correction: 3, maxDose: 15 });
  assert.equal(exact.total, 15); assert.equal(exact.capped, false);
});

test("capDoseParts: a calculated total over the limit is cut to it, correction first, then meal", () => {
  const a = capDoseParts({ meal: 12, correction: 6, maxDose: 15 });
  assert.deepEqual([a.meal, a.correction, a.total, a.requested, a.capped], [12, 3, 15, 18, true], "correction gives way first");
  const b = capDoseParts({ meal: 15, correction: 4.5, maxDose: 15 });
  assert.deepEqual([b.meal, b.correction, b.total], [15, 0, 15], "the correction is dropped entirely before the meal is touched");
  const c = capDoseParts({ meal: 19.5, correction: 0, maxDose: 15 });
  assert.deepEqual([c.meal, c.correction, c.total, c.capped], [15, 0, 15, true], "a meal alone over the limit is cut to it");
  const d = capDoseParts({ meal: 20, correction: 7, maxDose: 15 });
  assert.deepEqual([d.meal, d.correction, d.total], [15, 0, 15]);
});

test("capDoseParts: a dose the person TYPED is never altered, only flagged", () => {
  const r = capDoseParts({ meal: 18, correction: 0, maxDose: 15, typed: true });
  assert.deepEqual([r.meal, r.correction, r.total, r.capped, r.overMax], [18, 0, 18, false, true]);
  const mixed = capDoseParts({ meal: 10, correction: 8, maxDose: 15, typed: true });   // e.g. a calculated meal plus a typed correction
  assert.deepEqual([mixed.meal, mixed.correction, mixed.total, mixed.overMax], [10, 8, 18, true]);
  assert.equal(capDoseParts({ meal: 10, correction: 3, maxDose: 15, typed: true }).overMax, false, "under the limit: no warning");
});

test("capDoseParts: no cap at all when maxDose is 0, missing, negative or junk; inputs are sanitised", () => {
  for (const maxDose of [0, undefined, -5, NaN, null]) {
    const r = capDoseParts({ meal: 40, correction: 10, maxDose });
    assert.deepEqual([r.total, r.capped, r.overMax], [50, false, false], String(maxDose));
  }
  const bad = capDoseParts({ meal: -3, correction: NaN, maxDose: 15 });
  assert.deepEqual([bad.meal, bad.correction, bad.total], [0, 0, 0]);
  const odd = capDoseParts({ meal: 20, correction: 0, maxDose: 14.3 });
  assert.equal(odd.total, 14.3, "a limit that isn't a multiple of the dose step still gives exactly the limit");
});

test("PROPERTY: for any meal, correction and limit, the returned parts add up to the returned total and never exceed a calculated limit", () => {
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < 2000; i++) {
    const meal = Math.round(rnd() * 60) / 2, correction = Math.round(rnd() * 24) / 2;
    const maxDose = [0, 5, 10, 14.3, 15, 20, 35][Math.floor(rnd() * 7)];
    for (const typed of [false, true]) {
      const r = capDoseParts({ meal, correction, maxDose, typed });
      assert.ok(Math.abs(r.total - (r.meal + r.correction)) < 1e-9, `parts != total: ${JSON.stringify({ meal, correction, maxDose, typed, r })}`);
      assert.ok(r.meal >= 0 && r.correction >= 0);
      if (!typed && maxDose > 0) assert.ok(r.total <= maxDose + 1e-9, `calculated dose exceeds the cap: ${JSON.stringify({ meal, correction, maxDose, r })}`);
      if (typed) { assert.equal(r.meal, meal); assert.equal(r.correction, correction); }   // typed doses are never touched
      assert.equal(r.requested, Math.round((meal + correction) * 100) / 100);
    }
  }
});

test("computeDose: the parts add up to the shown total across the cap, with the cap off, and at odd limits", () => {
  for (const maxDose of [0, 8, 12, 14.3, 15, 30]) {
    for (let carbs = 0; carbs <= 300; carbs += 13) {
      for (let glucose = 90; glucose <= 400; glucose += 37) {
        const r = computeDose({ carbs, ratio: 8, correctionOn: true, glucose, glucoseUnit: "mgdl", settings: { ...SETTINGS, maxDose } });
        assert.ok(Math.abs(r.finalDose - (r.loggedMeal + r.loggedCorrection)) < 1e-9,
          `maxDose=${maxDose} carbs=${carbs} glucose=${glucose}: shown ${r.finalDose} but parts are ${r.loggedMeal}+${r.loggedCorrection}`);
        if (maxDose > 0) assert.ok(r.finalDose <= maxDose + 1e-9);
      }
    }
  }
});

// ------------------------------------------------------------ basal must never reach the bolus maths
const basalAt = (units, ts) => makeBasalEntry({ units, ts, slot: "am", now: ts });

test("SAFETY: a basal dose adds nothing to active insulin or carbs, however big or recent", () => {
  const now = Date.now();
  assert.deepEqual(activeAt([basalAt(40, now - 60000)], SETTINGS, now), { iob: 0, cob: 0, iobClearAt: null, cobClearAt: null });
  assert.equal(activeAt([basalAt(200, now)], SETTINGS, now).iob, 0);
  assert.equal(activeAt([basalAt(40, now - 5 * 3600000)], SETTINGS, now).iob, 0);
});

test("SAFETY: active insulin from real meals is identical with and without basal in the history", () => {
  const now = Date.now();
  const meal = { ts: now - 45 * 60000, totalCarbs: 60, mealDose: 4, correctionDose: 1, items: [], glycemicLoad: null };
  const without = activeAt([meal], SETTINGS, now);
  const withBasal = activeAt([basalAt(40, now - 30 * 60000), meal, basalAt(25, now - 3 * 3600000)], SETTINGS, now);
  assert.deepEqual(withBasal, without);
  assert.ok(without.iob > 0, "sanity: the meal itself is contributing");
});

test("buildTrendBuckets/summarizeTrends: basal is not a meal, an entry, or an averaging day", () => {
  const now = new Date(2026, 9, 5, 12).getTime(), day = 86400000;
  const meals = [
    { id: "a", ts: now - 1000, mealType: "lunch", totalCarbs: 60, mealDose: 4, correctionDose: 0, noInsulin: false },
    { id: "b", ts: now - day, mealType: "lunch", totalCarbs: 40, mealDose: 3, correctionDose: 0, noInsulin: false }
  ];
  const plain = buildTrendBuckets(meals, 7, now);
  const mixed = buildTrendBuckets([basalAt(14, now - 500), ...meals, basalAt(16, now - 3 * day)], 7, now);
  assert.deepEqual(mixed.buckets.map(b => b.entries), plain.buckets.map(b => b.entries), "per-day entry counts");
  assert.deepEqual(mixed.buckets.map(b => b.carbs), plain.buckets.map(b => b.carbs));
  assert.equal(mixed.inRange.length, 2, "basal isn't in the in-range list");
  assert.deepEqual(summarizeTrends(mixed.buckets, mixed.inRange, mixed.todayKey), summarizeTrends(plain.buckets, plain.inRange, plain.todayKey));
});

// ------------------------------------------------------------ basal trend (the Daily basal insulin chart)
const dayStart = (daysAgo, h = 0, m = 0) => { const d = new Date(2026, 9, 7 - daysAgo, h, m, 0, 0); return d.getTime(); };
const keysFor = n => Array.from({ length: n }, (_, i) => dayStart(n - 1 - i));          // oldest first, like the charts
const bDose = (units, slot, daysAgo, h) => ({ ...makeBasalEntry({ units, ts: dayStart(daysAgo, h), slot, now: dayStart(daysAgo, h) }) });

test("basalByDay: adds morning and evening up separately, per day, over the given day buckets", () => {
  const keys = keysFor(5);
  const m = basalByDay([bDose(14, "am", 2, 8), bDose(16, "pm", 2, 20), bDose(15, "am", 1, 8), bDose(18, "pm", 1, 20)], keys);
  assert.deepEqual(m.get(dayStart(2)), { am: 14, pm: 16, total: 30, count: 2 });
  assert.deepEqual(m.get(dayStart(1)), { am: 15, pm: 18, total: 33, count: 2 });
  assert.deepEqual(m.get(dayStart(0)), { am: 0, pm: 0, total: 0, count: 0 }, "a day with no doses is an empty bucket, not missing");
  assert.deepEqual([...m.keys()], keys, "same keys, same order as the other charts' buckets");
});

test("basalByDay: two doses in the same slot on one day are summed; a split dose is just two entries", () => {
  const m = basalByDay([bDose(10, "am", 0, 8), bDose(4, "am", 0, 11)], keysFor(3));
  assert.deepEqual(m.get(dayStart(0)), { am: 14, pm: 0, total: 14, count: 2 });
});

test("basalByDay: meals, zero/negative/missing doses and days outside the range are ignored", () => {
  const meal = { ts: dayStart(1, 12), mealDose: 6, correctionDose: 2, totalCarbs: 60 };
  const m = basalByDay([meal, bDose(0, "am", 1, 8), bDose(-3, "am", 1, 9), { ...bDose(14, "am", 1, 10), basalDose: undefined }, bDose(14, "am", 9, 8), null, undefined], keysFor(3));
  assert.deepEqual([...m.values()].map(v => v.total), [0, 0, 0]);
});

test("basalByDay: a dose with no slot is placed by its time (before 14:00 morning), and that matches the logging rule at every hour", () => {
  const noSlot = (h, m = 0) => ({ ...bDose(10, "am", 0, h), basalSlot: undefined, ts: dayStart(0, h, m) });
  const at = (h, m = 0) => basalByDay([noSlot(h, m)], keysFor(1)).get(dayStart(0));
  assert.equal(at(13, 59).am, 10); assert.equal(at(14, 0).pm, 10); assert.equal(at(0, 30).am, 10); assert.equal(at(23, 59).pm, 10);
  for (let h = 0; h < 24; h++) assert.equal(at(h).am > 0 ? "am" : "pm", basalSlotForTime(dayStart(0, h)), `hour ${h}: the chart and the logging sheet disagree about morning/evening`);
});

test("summarizeBasal: no basal in the period means no chart", () => {
  const keys = keysFor(7);
  assert.equal(summarizeBasal(basalByDay([], keys), keys, keys[6]).hasData, false);
});

test("summarizeBasal: the average uses complete days only, so a half-finished today doesn't drag it down", () => {
  const keys = keysFor(5), today = keys[4];
  const m = basalByDay([bDose(14, "am", 3, 8), bDose(16, "pm", 3, 20), bDose(15, "am", 2, 8), bDose(17, "pm", 2, 20), bDose(14, "am", 0, 8)], keys);
  const s = summarizeBasal(m, keys, today);
  assert.equal(s.hasData, true);
  assert.equal(s.avg, 31, "(30 + 32) / 2, with today's lone morning dose left out");
  assert.equal(s.avgDays, 2); assert.equal(s.usingToday, false);
  assert.equal(s.doses, 5, "but every logged dose is counted");
  assert.equal(s.max, 32);
});

test("summarizeBasal: if today is the only day with a dose, it is used rather than showing nothing", () => {
  const keys = keysFor(7), m = basalByDay([bDose(14, "am", 0, 8)], keys), s = summarizeBasal(m, keys, keys[6]);
  assert.equal(s.avg, 14); assert.equal(s.usingToday, true); assert.equal(s.avgDays, 1);
});

test("summarizeBasal: morning and evening averages are each over the days that HAVE that dose (an unlogged one isn't a zero)", () => {
  const keys = keysFor(5), today = keys[4];
  const m = basalByDay([bDose(14, "am", 3, 8), bDose(16, "pm", 3, 20), bDose(16, "am", 2, 8) /* no evening that day */, bDose(18, "pm", 1, 20) /* no morning */], keys);
  const s = summarizeBasal(m, keys, today);
  assert.equal(s.avgAm, 15, "(14 + 16) / 2, not divided by 3 days");
  assert.equal(s.avgPm, 17, "(16 + 18) / 2");
  assert.equal(s.avg, (30 + 16 + 18) / 3, "the daily total average does count each day that has any dose");
});
