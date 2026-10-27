// Stress test of the dose maths (2.68.4): thousands of random and awkward inputs through planDose / planEditDose /
// computeDose, checking rules that must ALWAYS hold. Seeded, so any failure reproduces exactly (the seed is in the message).
import test from "node:test";
import assert from "node:assert/strict";
import { planDose, planEditDose, computeDose, checkDoseConsistency, convertDosingSetting, convertGlucose, roundDose, roundSignedDose, capDoseParts, MGDL_PER_MMOL } from "../../js/calc.js";

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const N = Number(process.env.STRESS_N || 4000);
const EPS = 1e-9;
const pick = (r, list) => list[Math.floor(r() * list.length)];
const isStep = (v, step) => Math.abs(v / step - Math.round(v / step)) < 1e-6;

function randomSettings(r) {
  const units = r() < 0.5 ? "mgdl" : "mmol";
  const mg = { isf: Math.round(10 + r() * 90), target: Math.round(80 + r() * 60) };
  return {
    units,
    isf: units === "mgdl" ? mg.isf : convertDosingSetting(mg.isf, "mgdl", "mmol"),
    target: units === "mgdl" ? mg.target : convertDosingSetting(mg.target, "mgdl", "mmol"),
    rounding: pick(r, ["0.1", "0.5", "1", "0.05", "0.25"]),
    maxDose: pick(r, [0, 0, 5, 10, 15, 25, 7.5, 12.3]),
    iobAwareCorrection: r() < 0.5, reduceBelowTarget: r() < 0.5
  };
}
function randomCarbs(r) { return pick(r, [0, 0, 0.4, 5, 12.5, 30, 45.7, 60, 90, 150, 300, 1000]) * (r() < 0.2 ? r() : 1); }
function randomGlucose(r, units) {
  const mg = pick(r, [40, 55, 70, 85, 100, 120, 150, 180, 250, 400, 600]) + Math.round(r() * 20);
  return units === "mmol" ? Math.round(mg / MGDL_PER_MMOL * 10) / 10 : mg;
}

test(`planDose: always a sensible dose (${N} random cases)`, () => {
  for (let i = 0; i < N; i++) {
    const seed = 1000 + i, r = rng(seed);
    const settings = randomSettings(r);
    const step = parseFloat(settings.rounding) || 0.5;
    const carbs = randomCarbs(r), ratio = pick(r, [0, 3, 5, 8, 10, 12.5, 15, 20, 40]);
    const mode = pick(r, ["off", "auto", "auto", "manual"]);
    const glucose = randomGlucose(r, settings.units);
    const correctionUnits = pick(r, [0, 0.5, 1, 2.25, -0.5, -1, -3, 7]);
    const iob = pick(r, [0, 0, 0.5, 2, 6]);
    const noInsulin = r() < 0.1;
    const eatingOut = r() < 0.1 ? pick(r, [0, 1, 3.5, 20]) : null;
    const args = { carbs: eatingOut != null ? 0 : carbs, ratio: eatingOut != null ? 0 : ratio, mealUnits: eatingOut, correction: mode, glucose: String(glucose), glucoseUnit: settings.units, correctionUnits, iob, noInsulin, settings };
    const p = planDose(args);
    const ctx = `seed ${seed}: ${JSON.stringify({ ...args, settings })} -> ${JSON.stringify({ meal: p.mealDose, corr: p.correctionDose, final: p.finalDose })}`;
    for (const k of ["mealDose", "correctionDose", "finalDose", "requested"]) assert.ok(Number.isFinite(p[k]), `${k} not finite, ${ctx}`);
    assert.ok(p.finalDose >= 0, `negative dose, ${ctx}`);
    assert.ok(p.mealDose >= 0, `negative meal part, ${ctx}`);
    assert.ok(Math.abs(p.finalDose - Math.max(0, Math.round((p.mealDose + p.correctionDose) * 100) / 100)) < EPS, `parts don't add up, ${ctx}`);
    if (noInsulin) { assert.equal(p.finalDose, 0, ctx); assert.equal(p.mealDose, 0, ctx); assert.equal(p.correctionDose, 0, ctx); continue; }
    if (p.correctionDose < 0) assert.ok(-p.correctionDose <= p.mealDose + EPS, `reduction bigger than the meal, ${ctx}`);
    const anyTyped = eatingOut != null || (mode === "manual" && correctionUnits !== 0);
    if (settings.maxDose > 0 && !anyTyped) assert.ok(p.finalDose <= settings.maxDose + EPS, `over the maximum, ${ctx}`);
    if (!anyTyped && !p.capped) {
      assert.ok(isStep(p.mealDose, step), `meal not on the ${step} step, ${ctx}`);
      assert.ok(isStep(p.correctionDose, step) || p.reductionLimited, `correction not on the step, ${ctx}`);
    }
    if (mode !== "auto" || !(settings.reduceBelowTarget)) assert.ok(p.correctionDose >= 0 || mode === "manual", `negative correction without reduce-below-target, ${ctx}`);
    if (mode === "auto" && settings.iobAwareCorrection) assert.ok(p.correctionPart >= -EPS || settings.reduceBelowTarget, `IOB made a correction negative, ${ctx}`);
    // What is shown (one decimal) passes the last check before saving.
    assert.equal(checkDoseConsistency({ mealDose: p.mealDose, correctionDose: p.correctionDose, finalDose: p.finalDose, shownText: p.finalDose.toFixed(Math.abs(p.finalDose * 10 - Math.round(p.finalDose * 10)) < EPS ? 1 : 2) }), null, `consistency check refuses it, ${ctx}`);
    // The step-by-step text uses the very same numbers.
    if (mode !== "manual" && eatingOut == null) {
      const c = computeDose({ carbs: args.carbs, ratio: args.ratio, correctionOn: mode === "auto", glucose: args.glucose, glucoseUnit: settings.units, settings, iob, noInsulin });
      assert.equal(c.finalDose, p.finalDose, `computeDose differs, ${ctx}`);
    }
  }
});

test("planDose: more carbs or higher glucose never means less insulin (monotonic)", () => {
  for (let i = 0; i < N / 2; i++) {
    const seed = 50000 + i, r = rng(seed);
    const settings = randomSettings(r);
    const ratio = pick(r, [5, 8, 10, 15]);
    const g = randomGlucose(r, settings.units);
    const base = { ratio, correction: "auto", glucoseUnit: settings.units, settings, iob: 0 };
    let prev = -1;
    for (const carbs of [0, 10, 20, 35, 50, 80, 120, 200]) {
      const d = planDose({ ...base, carbs, glucose: String(g) }).finalDose;
      assert.ok(d >= prev - EPS, `seed ${seed}: ${carbs} g gave ${d} u, less than ${prev} u for fewer carbs (${JSON.stringify(settings)})`);
      prev = d;
    }
    prev = -1;
    const gs = settings.units === "mmol" ? [3, 4, 5, 6, 8, 10, 14, 20] : [50, 70, 90, 110, 150, 200, 280, 400];
    for (const gg of gs) {
      const d = planDose({ ...base, carbs: 40, glucose: String(gg) }).finalDose;
      assert.ok(d >= prev - EPS, `seed ${seed}: glucose ${gg} gave ${d} u, less than ${prev} u at a lower reading (${JSON.stringify(settings)})`);
      prev = d;
    }
  }
});

test("planDose: the same reading in mg/dL or mmol/L gives the same dose", () => {
  for (let i = 0; i < N / 2; i++) {
    const seed = 90000 + i, r = rng(seed);
    const settings = { ...randomSettings(r), units: "mgdl" };
    settings.isf = Math.round(10 + r() * 90); settings.target = Math.round(80 + r() * 60);
    const mg = Math.round(60 + r() * 300);
    const a = planDose({ carbs: 40, ratio: 10, correction: "auto", glucose: String(mg), glucoseUnit: "mgdl", settings });
    // The same reading typed in mmol/L (one decimal, as a meter shows it) while Settings stay in mg/dL.
    const mmolTyped = Math.round(mg / MGDL_PER_MMOL * 10) / 10;
    const b = planDose({ carbs: 40, ratio: 10, correction: "auto", glucose: String(mmolTyped), glucoseUnit: "mmol", settings });
    const step = parseFloat(settings.rounding) || 0.5;
    // mmol/L to one decimal is up to 0.05 mmol/L = 0.9 mg/dL off: worth 0.9/ISF units, plus one rounding step.
    const gap = Math.abs(mmolTyped * MGDL_PER_MMOL - mg) / settings.isf;
    assert.ok(Math.abs(a.finalDose - b.finalDose) <= step + gap + EPS, `seed ${seed}: ${mg} mg/dL -> ${a.finalDose} u, ${mmolTyped} mmol/L -> ${b.finalDose} u`);
  }
});

test("planDose: a glucose typed with a decimal comma means the same as with a point", () => {
  const settings = { units: "mmol", isf: 2.5, target: 6, rounding: "0.1", maxDose: 0, iobAwareCorrection: false, reduceBelowTarget: true };
  for (const [comma, point] of [["7,5", "7.5"], ["12,8", "12.8"], ["4,2", "4.2"], [" 9,0 ", "9.0"]]) {
    const a = planDose({ carbs: 30, ratio: 10, correction: "auto", glucose: comma, glucoseUnit: "mmol", settings });
    const b = planDose({ carbs: 30, ratio: 10, correction: "auto", glucose: point, glucoseUnit: "mmol", settings });
    assert.equal(a.finalDose, b.finalDose, `"${comma}" gave ${a.finalDose} u but "${point}" gave ${b.finalDose} u`);
    assert.equal(a.correctionDose, b.correctionDose, comma);
  }
  // Junk is no reading at all (no correction), never a partial number.
  for (const junk of ["", "abc", "7,5,1", "1e3", "-5", "∞"]) {
    const p = planDose({ carbs: 30, ratio: 10, correction: "auto", glucose: junk, glucoseUnit: "mmol", settings });
    assert.equal(p.correctionApplied, false, `"${junk}" was read as a reading`);
    assert.equal(p.finalDose, 3, junk);
  }
});

test("planEditDose: re-saving a meal unchanged gives back the same dose", () => {
  for (let i = 0; i < N / 2; i++) {
    const seed = 130000 + i, r = rng(seed);
    const settings = randomSettings(r);
    const ratio = pick(r, [5, 8, 10, 15]), carbs = randomCarbs(r);
    const g = randomGlucose(r, settings.units);
    const withG = r() < 0.5;
    const first = planDose({ carbs, ratio, correction: withG ? "auto" : "off", glucose: String(g), glucoseUnit: settings.units, settings: { ...settings, iobAwareCorrection: false } });
    const entry = { mealDose: first.mealDose, correctionDose: first.correctionDose, glucose: withG ? g : null, noInsulin: false };
    const again = planEditDose({ entry, totalCarbs: carbs, ratio, glucoseText: withG ? String(g) : null, settings });
    assert.equal(again.finalDose, first.finalDose, `seed ${seed}: logged ${first.finalDose} u, edit preview ${again.finalDose} u (${JSON.stringify({ carbs, ratio, g, withG, settings })})`);
    // A treated low never carries insulin; no ratio keeps the saved meal dose.
    assert.equal(planEditDose({ entry: { ...entry, noInsulin: true }, totalCarbs: carbs, ratio, glucoseText: null, settings }).finalDose, 0);
    const kept = planEditDose({ entry: { ...entry, correctionDose: 0 }, totalCarbs: carbs, ratio: 0, glucoseText: null, settings: { ...settings, maxDose: 0 } });
    assert.equal(kept.mealDose, Math.round(entry.mealDose * 100) / 100, `seed ${seed}: no ratio should keep the meal dose`);
  }
});

test("rounding helpers and the cap", () => {
  for (let i = 0; i < N; i++) {
    const r = rng(170000 + i), v = (r() - 0.5) * 40, step = pick(r, ["0.1", "0.5", "1", "0.05"]);
    const a = roundDose(Math.abs(v), step), b = roundSignedDose(v, step);
    assert.ok(Math.abs(Math.abs(v) - a) <= parseFloat(step) / 2 + EPS, `roundDose(${v}, ${step}) = ${a}`);
    assert.equal(Math.abs(b), a, `signed rounding of ${v} isn't symmetric`);
    assert.ok(!Object.is(b, -0), `roundSignedDose(${v}) gave -0`);
    const m = Math.abs(v), c = r() * 5, max = pick(r, [0, 3, 8, 15]);
    const cap = capDoseParts({ meal: m, correction: c, maxDose: max });
    if (max > 0) assert.ok(cap.total <= max + EPS);
    assert.ok(cap.meal >= 0 && cap.correction >= 0 && Math.abs(cap.total - Math.round((cap.meal + cap.correction) * 100) / 100) < EPS);
    if (cap.capped) assert.ok(cap.correction <= c + EPS && cap.meal <= m + EPS, "the cap only ever takes away");
  }
});

test("unit conversions round-trip", () => {
  for (let mg = 20; mg <= 600; mg += 1) {
    assert.ok(Math.abs(convertGlucose(convertGlucose(mg, "mgdl", "mmol"), "mmol", "mgdl") - mg) < 1e-9);
    const back = convertDosingSetting(convertDosingSetting(mg, "mgdl", "mmol"), "mmol", "mgdl");
    assert.ok(Math.abs(back - mg) <= 1, `${mg} mg/dL setting came back as ${back}`);
  }
});
