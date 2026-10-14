// Proves the single dose function (planDose / planEditDose) gives exactly what the two old, separate copies of the maths gave:
// the calculator screen's recompute() and the edit-meal sheet's editDoseParts(). The "oracle" functions below are those
// old copies, transcribed as they were. Thousands of random cases must agree to the last digit.
import test from "node:test";
import assert from "node:assert/strict";
import { planDose, planEditDose, roundDose, capDoseParts, convertGlucose } from "../../js/calc.js";
import { parseDecimalInput } from "../../js/util.js";

// --- the old calculator screen maths (app.js recompute, before 2.34.0) ---
function oracleCalculator(i) {
  const s = i.settings;
  const carbs = i.eatingOutOn ? 0 : i.carbs;
  let mealPart = i.ratio > 0 ? carbs / i.ratio : 0;
  let mealPartIsManual = false;
  if (i.eatingOutOn) {
    const m = parseDecimalInput(i.eatingOutText);
    mealPart = !isNaN(m) && m > 0 ? m : 0;
    mealPartIsManual = true;
  }
  let correctionPart = 0, iobSubtracted = 0, rawCorrectionPart = 0, correctionIsManual = false;
  if (i.correctionOn && i.correctionManual) {
    const manual = parseDecimalInput(i.manualText);
    if (!isNaN(manual) && manual > 0) { correctionPart = manual; correctionIsManual = true; }
  } else if (i.correctionOn) {
    const bg = parseFloat(i.glucoseText);
    if (!isNaN(bg) && bg > 0 && s.isf > 0) {
      const inUnit = convertGlucose(bg, i.glucoseUnit, s.units);
      rawCorrectionPart = Math.max(0, (inUnit - s.target) / s.isf);
      if (s.iobAwareCorrection) iobSubtracted = Math.min(rawCorrectionPart, i.iob);
      correctionPart = rawCorrectionPart - iobSubtracted;
    }
  }
  let meal = mealPartIsManual ? Math.round(mealPart * 100) / 100 : roundDose(mealPart, s.rounding);
  let corr = correctionIsManual ? Math.round(correctionPart * 100) / 100 : roundDose(correctionPart, s.rounding);
  const cap = capDoseParts({ meal, correction: corr, maxDose: s.maxDose, typed: mealPartIsManual || correctionIsManual });
  meal = cap.meal; corr = cap.correction;
  let finalDose = Math.max(0, cap.total);
  if (i.noInsulinOn) { finalDose = 0; meal = 0; corr = 0; }
  const hasSomethingToLog = i.noInsulinOn ? carbs > 0 : (carbs > 0 || correctionPart > 0 || mealPart > 0);
  return { meal, corr, finalDose, requested: cap.requested, capped: cap.capped && !i.noInsulinOn, overMax: !i.noInsulinOn && cap.overMax, hasSomethingToLog };
}
// --- the old edit sheet maths (app.js editDoseParts, before 2.34.0) ---
function oracleEdit({ entry, totalCarbs, ratio, glucoseText, settings }) {
  let correction, correctionTyped = false;
  if (entry.noInsulin) correction = 0;
  else if (glucoseText != null) {
    const g = parseFloat(glucoseText);
    correction = g > 0 ? roundDose(Math.max(0, (g - settings.target) / settings.isf), settings.rounding) : 0;
  } else {
    correction = entry.correctionDose || 0;
    correctionTyped = correction > 0 && entry.glucose == null;
  }
  const meal = entry.noInsulin ? 0 : (ratio ? roundDose(totalCarbs / ratio, settings.rounding) : (entry.mealDose || 0));
  return capDoseParts({ meal, correction, maxDose: settings.maxDose, typed: correctionTyped });
}

// small deterministic random generator so a failure can be replayed
let seed = 12345;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const pick = a => a[Math.floor(rnd() * a.length)];
const num = (lo, hi, dp = 1) => Number((lo + rnd() * (hi - lo)).toFixed(dp));
const texts = ["", "0", "1", "1.5", "1,5", ",5", ".5", "2.25", "abc", "-1", "12", "20"];

function randomSettings() {
  const units = pick(["mgdl", "mmol"]);
  return {
    units, isf: pick([20, 35, 50, 60, 0]), target: units === "mmol" ? pick([5, 5.5, 6]) : pick([90, 100, 110]),
    rounding: pick(["0.1", "0.5", "1"]), maxDose: pick([0, 5, 10, 15, 20]), iobAwareCorrection: rnd() < 0.4
  };
}

test("calculator screen: planDose matches the old recompute() on 20,000 random cases", () => {
  for (let n = 0; n < 20000; n++) {
    const settings = randomSettings();
    const glucoseUnit = pick(["mgdl", "mmol"]);       // the screen always has a unit once correction is on
    const i = {
      settings, carbs: rnd() < 0.1 ? 0 : num(0, 250), ratio: pick([0, 5, 8, 10, 12, 15, 18]),
      eatingOutOn: rnd() < 0.15, eatingOutText: pick(texts),
      correctionOn: rnd() < 0.6, correctionManual: rnd() < 0.3, manualText: pick(texts),
      glucoseText: rnd() < 0.15 ? "" : String(glucoseUnit === "mmol" ? num(3, 25) : num(50, 450, 0)), glucoseUnit,
      iob: rnd() < 0.5 ? 0 : num(0, 6, 2), noInsulinOn: rnd() < 0.1
    };
    const old = oracleCalculator(i);
    const eo = i.eatingOutOn;
    const m = parseDecimalInput(i.eatingOutText);
    const plan = planDose({
      carbs: eo ? 0 : i.carbs, ratio: i.ratio, mealUnits: eo ? (!isNaN(m) && m > 0 ? m : 0) : null,
      correction: i.correctionOn ? (i.correctionManual ? "manual" : "auto") : "off",
      glucose: i.glucoseText, glucoseUnit, correctionUnits: parseDecimalInput(i.manualText), iob: i.iob, noInsulin: i.noInsulinOn, settings
    });
    const got = { meal: plan.mealDose, corr: plan.correctionDose, finalDose: plan.finalDose, requested: plan.requested, capped: plan.capped, overMax: plan.overMax, hasSomethingToLog: plan.hasDose };
    if (i.noInsulinOn) old.requested = 0;   // the one deliberate difference: nothing was requested when no insulin is recorded (never displayed)
    assert.deepEqual(got, old, "case " + n + " " + JSON.stringify(i));
  }
});

test("edit sheet: planEditDose matches the old editDoseParts() on 20,000 random cases", () => {
  for (let n = 0; n < 20000; n++) {
    const settings = { ...randomSettings(), iobAwareCorrection: false };
    settings.isf = settings.isf || 50;                // the old code divided by zero here; the new one treats it as no correction
    const noInsulin = rnd() < 0.1;
    const hasGlucose = rnd() < 0.5;
    const entry = {
      noInsulin, mealDose: num(0, 12, 2), correctionDose: rnd() < 0.5 ? 0 : num(0, 8, 2),
      glucose: hasGlucose ? num(80, 300, 0) : null
    };
    const input = {
      entry, totalCarbs: num(0, 250), ratio: pick([0, null, 8, 10, 12, 15]),
      glucoseText: rnd() < 0.5 ? String(num(60, 400, 0)) : (rnd() < 0.2 ? "" : null), settings
    };
    const old = oracleEdit(input);
    const plan = planEditDose(input);
    assert.deepEqual(
      { meal: plan.mealDose, correction: plan.correctionDose, total: plan.finalDose, requested: plan.requested, capped: plan.capped, overMax: plan.overMax },
      { meal: old.meal, correction: old.correction, total: old.total, requested: old.requested, capped: old.capped, overMax: old.overMax },
      "case " + n + " " + JSON.stringify(input)
    );
  }
});
