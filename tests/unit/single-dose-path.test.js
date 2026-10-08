// The Calculator and the Edit Meal sheet now both get their dose from computeDose (via calculatorDose and
// recalculateEntryDose). These tests pin that down two ways:
//   1. against REFERENCE copies of the two calculations as they were written in app.js before (v2.10.5), over
//      thousands of random inputs, so the move to one path provably changed nothing it wasn't meant to;
//   2. the two intended differences in Edit Meal, and the properties every dose must have.
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeDose, calculatorDose, recalculateEntryDose, capDoseParts, roundDose, convertGlucose } from "../../js/calc.js";
import { parseDecimalInput } from "../../js/util.js";

// ---------------------------------------------------------------- reference implementations (v2.10.5 app.js)
function refCalculator({ carbs, ratio, settings, currentIob, noInsulinOn, eatingOutOn, eatingOutText, correctionOn, correctionManual, manualText, glucoseText, glucoseUnit }) {
  carbs = eatingOutOn ? 0 : carbs;
  let mealPart = ratio > 0 ? carbs / ratio : 0;
  let mealPartIsManual = false;
  if (eatingOutOn) {
    const manualMeal = parseDecimalInput(eatingOutText);
    mealPart = !isNaN(manualMeal) && manualMeal > 0 ? manualMeal : 0;
    mealPartIsManual = true;
  }
  let correctionPart = 0, iobSubtracted = 0, rawCorrectionPart = 0, correctionIsManual = false;
  if (correctionOn && correctionManual) {
    const manual = parseDecimalInput(manualText);
    if (!isNaN(manual) && manual > 0) { correctionPart = manual; correctionIsManual = true; }
  } else if (correctionOn) {
    const bg = parseFloat(glucoseText);
    if (!isNaN(bg) && bg > 0 && settings.isf > 0) {
      const bgInSettingsUnit = convertGlucose(bg, glucoseUnit, settings.units);
      rawCorrectionPart = Math.max(0, (bgInSettingsUnit - settings.target) / settings.isf);
      if (settings.iobAwareCorrection) iobSubtracted = Math.min(rawCorrectionPart, currentIob);
      correctionPart = rawCorrectionPart - iobSubtracted;
    }
  }
  let loggedMealDose = mealPartIsManual ? Math.round(mealPart * 100) / 100 : roundDose(mealPart, settings.rounding);
  let loggedCorrectionDose = correctionIsManual ? Math.round(correctionPart * 100) / 100 : roundDose(correctionPart, settings.rounding);
  const cap = capDoseParts({ meal: loggedMealDose, correction: loggedCorrectionDose, maxDose: settings.maxDose, typed: mealPartIsManual || correctionIsManual });
  loggedMealDose = cap.meal; loggedCorrectionDose = cap.correction;
  let finalDose = Math.max(0, cap.total);
  if (noInsulinOn) { finalDose = 0; loggedMealDose = 0; loggedCorrectionDose = 0; }
  return {
    finalDose, loggedMeal: loggedMealDose, loggedCorrection: loggedCorrectionDose,
    capped: cap.capped && !noInsulinOn, overMax: cap.overMax && !noInsulinOn, requested: cap.requested,
    rawCorrection: rawCorrectionPart, iobSubtracted, correctionPart, mealPart,
    hasSomethingToLog: noInsulinOn ? carbs > 0 : (carbs > 0 || correctionPart > 0 || mealPart > 0)
  };
}

function refEdit({ entry, totalCarbs, glucoseText, selectedRatioValue, settings }) {
  let correction, correctionTyped = false;
  if (entry.noInsulin) correction = 0;
  else if (glucoseText != null) {
    const g = parseFloat(glucoseText);
    correction = g > 0 ? roundDose(Math.max(0, (g - settings.target) / settings.isf), settings.rounding) : 0;
  } else {
    correction = entry.correctionDose || 0;
    correctionTyped = correction > 0 && entry.glucose == null;
  }
  const meal = entry.noInsulin ? 0 : (selectedRatioValue ? roundDose(totalCarbs / selectedRatioValue, settings.rounding) : (entry.mealDose || 0));
  return capDoseParts({ meal, correction, maxDose: settings.maxDose, typed: correctionTyped });
}

// ---------------------------------------------------------------- random inputs (seeded, so failures reproduce)
function rng(seed) { return () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }; }
const pick = (r, list) => list[Math.floor(r() * list.length)];
const typedText = r => pick(r, ["", "0", "1.5", "1,5", "2", ".5", "12", "abc", "1.2.3", "3,25", "20", " 4 "]);
function randomSettings(r) {
  const units = pick(r, ["mgdl", "mmol"]);
  return {
    units, rounding: pick(r, ["0.1", "0.5", "1"]), maxDose: pick(r, [0, 5, 10, 15, 25]),
    isf: units === "mmol" ? pick(r, [1.5, 2.8, 3]) : pick(r, [30, 50, 80]),
    target: units === "mmol" ? pick(r, [5.5, 6]) : pick(r, [100, 110]),
    iobAwareCorrection: r() < 0.5
  };
}

test("Calculator: calculatorDose matches the v2.10.5 Calculator on 5000 random meals", () => {
  const r = rng(42);
  for (let i = 0; i < 5000; i++) {
    const settings = randomSettings(r);
    const mode = pick(r, ["plain", "eatingOut", "noInsulin"]);
    const correctionOn = mode !== "noInsulin" && r() < 0.6;
    const correctionManual = correctionOn && r() < 0.4;
    const glucoseUnit = pick(r, ["mgdl", "mmol"]);
    const input = {
      carbs: Math.round(r() * 2000) / 10, ratio: pick(r, [0, 6, 8, 10, 12.5, 15]), settings, currentIob: Math.round(r() * 60) / 10,
      noInsulinOn: mode === "noInsulin", eatingOutOn: mode === "eatingOut", eatingOutText: typedText(r),
      correctionOn, correctionManual, manualText: typedText(r), glucoseUnit,
      glucoseText: pick(r, ["", "abc", glucoseUnit === "mmol" ? (3 + r() * 20).toFixed(1) : String(Math.round(60 + r() * 340))])
    };
    const ref = refCalculator(input);
    const got = calculatorDose({
      carbs: input.carbs, ratio: input.ratio, settings, iob: input.currentIob, noInsulin: input.noInsulinOn,
      eatingOut: input.eatingOutOn, eatingOutDose: parseDecimalInput(input.eatingOutText),
      correctionOn, correctionManual, correctionDose: parseDecimalInput(input.manualText),
      glucose: input.glucoseText, glucoseUnit
    });
    const msg = JSON.stringify(input);
    assert.equal(got.finalDose, ref.finalDose, "finalDose " + msg);
    assert.equal(got.loggedMeal, ref.loggedMeal, "loggedMeal " + msg);
    assert.equal(got.loggedCorrection, ref.loggedCorrection, "loggedCorrection " + msg);
    assert.equal(got.capped, ref.capped, "capped " + msg);
    assert.equal(got.overMax, ref.overMax, "overMax " + msg);
    if (ref.capped || ref.overMax) assert.equal(got.requestedDose, ref.requested, "requested " + msg);
    assert.equal(got.rawCorrection, ref.rawCorrection, "rawCorrection " + msg);
    assert.equal(got.iobSubtracted, ref.iobSubtracted, "iobSubtracted " + msg);
    assert.equal(got.correctionPart, ref.correctionPart, "correctionPart " + msg);
    assert.equal(got.mealPart, ref.mealPart, "mealPart " + msg);
  }
});

test("Edit Meal: recalculateEntryDose matches the v2.10.5 edit sheet wherever the old one could re-calculate", () => {
  const r = rng(7);
  let compared = 0;
  for (let i = 0; i < 5000; i++) {
    const settings = randomSettings(r);
    const hadGlucose = r() < 0.5;
    const entry = {
      noInsulin: r() < 0.15, carbsUnknown: false,
      mealDose: Math.round(r() * 200) / 10, correctionDose: pick(r, [0, 0, 1, 1.5, 2.25, 6]),
      glucose: hadGlucose ? 150 : null
    };
    const ratio = pick(r, [6, 8, 10, 15]);   // the old sheet kept a no-ratio meal dose uncapped-but-cappable: see below
    const totalCarbs = Math.round(r() * 2000) / 10;
    const glucoseText = hadGlucose ? pick(r, ["", "0", "abc", String(Math.round(60 + r() * 300))]) : null;
    const ref = refEdit({ entry, totalCarbs, glucoseText, selectedRatioValue: ratio, settings });
    const got = recalculateEntryDose({ entry, carbs: totalCarbs, ratio, glucose: glucoseText, settings });
    const msg = JSON.stringify({ entry, totalCarbs, glucoseText, ratio, settings });
    assert.equal(got.loggedMeal, ref.meal, "meal " + msg);
    assert.equal(got.loggedCorrection, ref.correction, "correction " + msg);
    assert.equal(got.finalDose, ref.total, "total " + msg);
    assert.equal(got.capped, ref.capped, "capped " + msg);
    assert.equal(got.overMax, ref.overMax, "overMax " + msg);
    compared++;
  }
  assert.equal(compared, 5000);
});

const S = { units: "mgdl", rounding: "0.5", maxDose: 15, isf: 50, target: 100, iobAwareCorrection: false };

test("Edit Meal: an Eating Out entry keeps its typed meal dose (the old sheet showed 0u for it)", () => {
  const entry = { carbsUnknown: true, mealDose: 5, correctionDose: 0, glucose: null };
  const d = recalculateEntryDose({ entry, carbs: 0, ratio: 10, glucose: null, settings: S });
  assert.equal(d.loggedMeal, 5);
  assert.equal(d.finalDose, 5);
  assert.equal(d.mealTyped, true);
  const old = refEdit({ entry, totalCarbs: 0, glucoseText: null, selectedRatioValue: 10, settings: S });
  assert.equal(old.total, 0, "the old sheet re-calculated it from 0g of carbs");
});

test("Edit Meal: a meal logged with no ratio keeps its dose exactly, even over the cap (it can't be re-calculated)", () => {
  const entry = { mealDose: 18, correctionDose: 0, glucose: null };
  const d = recalculateEntryDose({ entry, carbs: 90, ratio: null, glucose: null, settings: S });
  assert.equal(d.finalDose, 18);
  assert.equal(d.overMax, true);
  assert.equal(d.capped, false);
});

test("Edit Meal: today's active insulin is never subtracted from a past meal's correction", () => {
  const entry = { mealDose: 0, correctionDose: 2, glucose: 200 };
  const d = recalculateEntryDose({ entry, carbs: 0, ratio: 10, glucose: "200", settings: { ...S, iobAwareCorrection: true } });
  assert.equal(d.iobSubtracted, 0);
  assert.equal(d.loggedCorrection, 2);
});

test("Treating a Low: no insulin, and nothing is reported as capped even when the carbs would exceed the cap", () => {
  const d = computeDose({ carbs: 300, ratio: 10, correctionOn: false, settings: S, noInsulin: true });
  assert.equal(d.finalDose, 0);
  assert.equal(d.loggedMeal, 0);
  assert.equal(d.capped, false);
  assert.equal(d.overMax, false);
});

test("every dose: the logged parts add up to the dose shown, and a calculated dose never exceeds the cap", () => {
  const r = rng(99);
  for (let i = 0; i < 3000; i++) {
    const settings = randomSettings(r);
    const d = calculatorDose({
      carbs: r() * 300, ratio: pick(r, [6, 10, 15]), settings, iob: r() * 5,
      correctionOn: r() < 0.5, glucose: String(Math.round(60 + r() * 340)), glucoseUnit: "mgdl"
    });
    assert.equal(Math.round((d.loggedMeal + d.loggedCorrection) * 100) / 100, d.finalDose);
    if (settings.maxDose > 0) assert.ok(d.finalDose <= settings.maxDose, JSON.stringify({ settings, d }));
  }
});

test("computeDose without the new typed inputs behaves exactly as before (callers and tests that predate them)", () => {
  const d = computeDose({ carbs: 60, ratio: 10, correctionOn: true, glucose: "200", glucoseUnit: "mgdl", settings: S });
  assert.equal(d.loggedMeal, 6);
  assert.equal(d.loggedCorrection, 2);
  assert.equal(d.finalDose, 8);
  assert.equal(d.mealTyped, false);
  assert.equal(d.correctionTyped, false);
  assert.ok(d.lines[0].startsWith("Meal: 60 g ÷ 10"));
});
