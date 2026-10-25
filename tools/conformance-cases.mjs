// The inputs for the conformance suite. `node tools/make-conformance.mjs` runs each one through the real code and writes
// the results to tests/conformance/*.json. Inputs are plain JSON. Times are epoch milliseconds, never Date objects.
import fs from "node:fs";

const MIN = 60000, HOUR = 3600000;
const T0 = Date.UTC(2026, 9, 1, 12, 0, 0);          // 1 Oct 2026 12:00 UTC: a fixed "now" for everything
const S = (o = {}) => ({ units: "mgdl", isf: 50, target: 100, rounding: "0.5", maxDose: 15, iobAwareCorrection: false, ...o });
const MODEL = { insulinModel: { peakMinutes: 75, diaMinutes: 360 }, carbAbsorptionMinutes: { high: 120, medium: 180, low: 240, unknown: 180 } };
const DEFAULTS = { settings: { isf: 50, target: 100, units: "mgdl", rounding: "0.5", maxDose: 15, timeRatios: [{ id: "a", name: "Day", start: "06:00", end: "23:30", ratio: 10 }, { id: "n", name: "Night", start: "23:30", end: "06:00", ratio: 12 }], activityRatios: [], insulinModel: { preset: "rapid", peakMinutes: 75, diaMinutes: 360 }, carbAbsorptionMinutes: { high: 120, medium: 180, low: 240, unknown: 180 } }, library: [], recipes: [], history: [] };
const meal = (id, ts, o = {}) => ({ id, ts, mealType: "lunch", periodName: "day", items: [{ refType: "food", refId: "f1", name: "Rice", grams: 100, carbs: 28, kcal: 130, carbsPer100g: 28, kcalPer100g: 130, gi: 70 }], totalCarbs: 28, totalKcal: 130, glycemicLoad: { value: 70, partial: false }, carbsUnknown: false, mealDose: 2.5, correctionDose: 0, noInsulin: false, glucose: null, ratioLabel: "Day", ratioValue: 10, ...o });
const basal = (id, ts, units, slot) => ({ id, ts, entryType: "basal", mealType: "basal", periodName: slot === "am" ? "morning" : "evening", basalDose: units, basalSlot: slot, items: [], totalCarbs: 0, totalKcal: 0, glycemicLoad: null, mealDose: 0, correctionDose: 0, noInsulin: false, glucose: null, ratioLabel: "", ratioValue: null });
const activity = (id, ts, o = {}) => ({ id, ts, entryType: "activity", mealType: "activity", activityType: "run", activityName: "", durationMin: 45, intensity: "moderate", note: "", items: [], totalCarbs: 0, totalKcal: 0, glycemicLoad: null, mealDose: 0, correctionDose: 0, noInsulin: false, glucose: null, ratioLabel: "", ratioValue: null, ...o });
const stateOf = (o = {}) => ({ schemaVersion: 2, settings: DEFAULTS.settings, settingsUpdatedAt: 0, library: [], recipes: [], history: [], deleted: { history: {}, library: {}, recipes: {} }, ...o });
const round = (x, d = 2) => Number(x.toFixed(d));

// readings built from exact physics, like the model's own tests: a 60 g meal absorbed over `T` minutes, 3 units
function readingsFor({ C = 60, T = 120, g0 = 200, hours = 5, dose = 3 }) {
  const out = [];
  for (let m = -30; m <= hours * 60; m += 5) {
    const absorbed = m <= 0 ? 0 : Math.min(C, C * (m / T));
    const drop = m <= 0 ? 0 : dose * 50 * (1 - iobShape(m));
    out.push({ at: T0 + m * MIN, mgdl: round(g0 + 5 * absorbed - drop, 1) });
  }
  return out;
}
const iobShape = m => { const tp = 75, td = 360; if (m <= 0) return 1; if (m >= td) return 0; const tau = tp * (1 - tp / td) / (1 - 2 * tp / td), a = 2 * tau / td, Sx = 1 / (1 - a + (1 + a) * Math.exp(-td / tau)); return 1 - Sx * (1 - a) * ((m * m / (tau * td * (1 - a)) - m / tau - 1) * Math.exp(-m / tau) + 1); };

const cases = { dose: [], glucose: [], state: [], sync: [], core: [] };
const add = (group, name, fn, ...args) => cases[group].push({ name, fn, args });

// ================= dose =================
for (const g of JSON.parse(fs.readFileSync(new URL("../tests/unit/dose-golden.json", import.meta.url), "utf8")))
  add("dose", `planDose: ${g.name}`, "planDose", { ...g.input, settings: g.settings });

const entry = (o = {}) => ({ noInsulin: false, mealDose: 3, correctionDose: 0, glucose: null, ...o });
for (const [name, input] of [
  ["ratio chosen, glucose box: recalculated", { entry: entry(), totalCarbs: 50, ratio: 10, glucoseText: "200", settings: S() }],
  ["ratio chosen, glucose box emptied", { entry: entry(), totalCarbs: 50, ratio: 10, glucoseText: "", settings: S() }],
  ["no ratio: the saved meal dose is kept", { entry: entry({ mealDose: 4.25 }), totalCarbs: 80, ratio: 0, glucoseText: null, settings: S() }],
  ["no glucose box: a typed correction is kept", { entry: entry({ correctionDose: 1.3 }), totalCarbs: 40, ratio: 10, glucoseText: null, settings: S() }],
  ["no glucose box, correction from a reading: still capped", { entry: entry({ correctionDose: 9, glucose: 250 }), totalCarbs: 100, ratio: 10, glucoseText: null, settings: S() }],
  ["treating a low: never any insulin", { entry: entry({ noInsulin: true }), totalCarbs: 30, ratio: 10, glucoseText: "250", settings: S() }],
  ["edited carbs over the cap", { entry: entry(), totalCarbs: 250, ratio: 10, glucoseText: "300", settings: S() }],
  ["mmol settings, glucose box in mmol", { entry: entry(), totalCarbs: 30, ratio: 10, glucoseText: "10", settings: S({ units: "mmol", isf: 2.8, target: 6 }) }],
  ["IOB-aware setting is ignored when editing", { entry: entry(), totalCarbs: 0, ratio: 10, glucoseText: "200", settings: S({ iobAwareCorrection: true }) }]
]) add("dose", `planEditDose: ${name}`, "planEditDose", input);

// A meal with a correction that can also take insulin OFF (a low reading, or a typed subtraction). Added in 2.44.0.
for (const [name, input] of [
  ["12 u meal at 300: correction added", { carbs: 120, ratio: 10, correction: "auto", glucose: "300", settings: S({ maxDose: 25 }) }],
  ["12 u meal at 55, lowering on: a unit comes off", { carbs: 120, ratio: 10, correction: "auto", glucose: "55", settings: S({ maxDose: 25, reduceBelowTarget: true }) }],
  ["12 u meal at 55, lowering off: unchanged", { carbs: 120, ratio: 10, correction: "auto", glucose: "55", settings: S({ maxDose: 25 }) }],
  ["at target, lowering on: nothing", { carbs: 120, ratio: 10, correction: "auto", glucose: "100", settings: S({ reduceBelowTarget: true }) }],
  ["low with insulin on board: IOB does not shrink the reduction", { carbs: 120, ratio: 10, correction: "auto", glucose: "55", iob: 3, settings: S({ reduceBelowTarget: true, iobAwareCorrection: true }) }],
  ["low, mmol settings", { carbs: 60, ratio: 10, correction: "auto", glucose: "3", settings: S({ units: "mmol", isf: 2.8, target: 6, reduceBelowTarget: true }) }],
  ["reduction larger than the meal stops at zero", { carbs: 30, ratio: 10, correction: "auto", glucose: "20", settings: S({ reduceBelowTarget: true }) }],
  ["typed correction +1.5", { carbs: 120, ratio: 10, correction: "manual", correctionUnits: 1.5, settings: S({ maxDose: 25 }) }],
  ["typed correction -2", { carbs: 120, ratio: 10, correction: "manual", correctionUnits: -2, settings: S({ maxDose: 25 }) }],
  ["typed correction -8 on a 3 u meal stops at zero", { carbs: 30, ratio: 10, correction: "manual", correctionUnits: -8, settings: S() }],
  ["reduction on a capped meal", { carbs: 200, ratio: 10, correction: "auto", glucose: "55", settings: S({ maxDose: 15, reduceBelowTarget: true }) }],
  ["typed meal 8 u (eating out) with -1", { carbs: 0, ratio: 10, mealUnits: 8, correction: "manual", correctionUnits: -1, settings: S() }],
  ["treating a low ignores a reduction", { carbs: 20, ratio: 10, correction: "auto", glucose: "55", noInsulin: true, settings: S({ reduceBelowTarget: true }) }]
]) add("dose", `planDose: ${name}`, "planDose", input);
add("dose", "planEditDose: a typed reduction is kept", "planEditDose", { entry: entry({ mealDose: 12, correctionDose: -1 }), totalCarbs: 120, ratio: 10, glucoseText: null, settings: S({ maxDose: 25 }) });
for (const [v, step] of [[-0.9, "0.5"], [0.9, "0.5"], [-0.25, "0.5"], [0.25, "0.5"], [-0.24, "0.5"], [-0.75, "0.5"], [-1.04, "0.1"], [0, "0.5"], [-3.3, "1"]])
  add("dose", `roundSignedDose ${v} to ${step}`, "roundSignedDose", v, step);
add("dose", "checkDoseConsistency with a reduction", "checkDoseConsistency", { mealDose: 12, correctionDose: -1, finalDose: 11, shownText: "11.0" });

for (const [meal_, corr, max, typed] of [[3, 1, 15, false], [12, 6, 15, false], [20, 0, 15, false], [10, 2, 0, false], [20, 0, 15, true], [3, 15, 15, true], [0, 0, 5, false], [7.5, 7.5, 15, false], [5, 2.5, 6, false]])
  add("dose", `capDoseParts meal ${meal_} + correction ${corr}, max ${max}${typed ? ", typed" : ""}`, "capDoseParts", { meal: meal_, correction: corr, maxDose: max, typed });
for (const [v, step] of [[5.33, "0.5"], [6.25, "0.5"], [6.24, "0.5"], [0.24, "0.5"], [0.25, "0.5"], [2.34, "0.5"], [5.33, "0.1"], [5.35, "0.1"], [5.33, "1"], [5.5, "1"], [0, "0.5"], [10.74, "0.5"], [3.3, "bad"], [1.05, "0.1"]])
  add("dose", `roundDose ${v} to ${step}`, "roundDose", v, step);
for (const [v, from, to] of [[100, "mgdl", "mgdl"], [180, "mgdl", "mmol"], [10, "mmol", "mgdl"], [5.5, "mmol", "mgdl"], [70, "mgdl", "mmol"], [0, "mgdl", "mmol"], [400, "mgdl", "mmol"]])
  add("dose", `convertGlucose ${v} ${from}->${to}`, "convertGlucose", v, from, to);
for (const t of ["1.5", "1,5", ",5", ".5", "2.", "abc", "", "  3 ", "1.2.3", "-1", "10", "0", null, "1e2"])
  add("dose", `parseDecimalInput ${JSON.stringify(t)}`, "parseDecimalInput", t);
for (const c of [{ mealDose: 3, correctionDose: 0.5, finalDose: 3.5, shownText: "3.5" }, { mealDose: 3.25, correctionDose: 0, finalDose: 3.25, shownText: "3.3" }, { mealDose: 3, correctionDose: 4, finalDose: 3.5, shownText: "3.5" }, { mealDose: 3, correctionDose: 0.5, finalDose: 3.5, shownText: "15.0" }, { mealDose: null, correctionDose: 0, finalDose: 0, shownText: "0.0" }, { mealDose: -1, correctionDose: 0, finalDose: 0, shownText: "0.0" }, { mealDose: 0, correctionDose: 0, finalDose: 0, shownText: "0.0", noInsulin: true }, { mealDose: 2, correctionDose: 0, finalDose: 0, shownText: "0.0", noInsulin: true }])
  add("dose", `checkDoseConsistency ${JSON.stringify(c)}`, "checkDoseConsistency", c);
for (const [peak, dia] of [[75, 360], [55, 300]]) for (const m of [-5, 0, 10, 30, 60, peak, 120, 180, 240, 299, 300, 359, 360, 400])
  add("dose", `iobFraction ${m} min (peak ${peak}, DIA ${dia})`, "iobFraction", m, peak, dia);
for (const [m, c, a] of [[-5, 50, 180], [0, 50, 180], [45, 50, 180], [90, 50, 180], [179, 50, 180], [180, 50, 180], [240, 50, 180]])
  add("dose", `cobGrams ${m} min, ${c} g, ${a} min absorption`, "cobGrams", m, c, a);
for (const items of [[], [{ gi: 70, carbs: 30 }], [{ gi: 70, carbs: 30 }, { gi: 30, carbs: 30 }], [{ gi: 80, carbs: 20 }, { gi: null, carbs: 40 }], [{ gi: 50, carbs: 0 }], [{ gi: null, carbs: 25 }]])
  add("dose", `compoundGiInfo ${JSON.stringify(items)}`, "compoundGiInfo", items);
for (const gi of [0, 55, 56, 69, 70, 100]) add("dose", `giBand ${gi}`, "giBand", gi);
for (const [name, e] of [["no GL", {}], ["high", { glycemicLoad: { value: 80 } }], ["medium", { glycemicLoad: { value: 60 } }], ["low", { glycemicLoad: { value: 30 } }]])
  add("dose", `absorptionMinutesForEntry ${name}`, "absorptionMinutesForEntry", e, MODEL.carbAbsorptionMinutes);
add("dose", "activeAt: one meal 1 hour ago", "activeAt", [meal("a", T0 - HOUR, { mealDose: 4, totalCarbs: 40 })], MODEL, T0);
add("dose", "activeAt: stacked meals and a correction", "activeAt", [meal("a", T0 - 30 * MIN, { mealDose: 3, totalCarbs: 30 }), meal("b", T0 - 2 * HOUR, { mealDose: 5, totalCarbs: 60, glycemicLoad: { value: 30 } }), meal("c", T0 - 90 * MIN, { mealDose: 0, correctionDose: 2, totalCarbs: 0, items: [] })], MODEL, T0);
add("dose", "activeAt: everything has worn off", "activeAt", [meal("a", T0 - 7 * HOUR, { mealDose: 4, totalCarbs: 40 })], MODEL, T0);
add("dose", "activeAt: an entry in the future is ignored", "activeAt", [meal("a", T0 + HOUR)], MODEL, T0);
add("dose", "activeAt: empty history", "activeAt", [], MODEL, T0);

// ================= glucose =================
const E1 = meal("m1", T0, { mealDose: 3, totalCarbs: 60, ratioValue: 10 });
const READ = readingsFor({});
const baseModel = { isfMgdl: 50, peak: 75, dia: 360 };
add("glucose", "expectedFromInsulin: a 60 g meal, 2 h in", "expectedFromInsulin", [E1], READ, { ...baseModel, now: T0 + 120 * MIN });
add("glucose", "expectedFromInsulin: no readings", "expectedFromInsulin", [E1], [], { ...baseModel, now: T0 + 120 * MIN });
add("glucose", "expectedFromInsulin: nothing logged recently", "expectedFromInsulin", [E1], READ, { ...baseModel, now: T0 + 9 * HOUR });
const basals = [-5, -4, -3, -2, -1].map((d, i) => basal("b" + i, T0 + d * 24 * HOUR - 4 * HOUR, 16, "pm"));
add("glucose", "expectedFromInsulin: usual basal changes nothing", "expectedFromInsulin", [E1], READ, { ...baseModel, now: T0 + 120 * MIN, basalEntries: [...basals, basal("b9", T0 - 2 * HOUR, 16, "pm")] });
add("glucose", "expectedFromInsulin: 4 extra basal units lower the line", "expectedFromInsulin", [E1], READ, { ...baseModel, now: T0 + 120 * MIN, basalEntries: [...basals, basal("b9", T0 - 2 * HOUR, 20, "pm")] });
add("glucose", "expectedFromInsulin: very large dose hits the floor", "expectedFromInsulin", [meal("big", T0, { mealDose: 12, totalCarbs: 0 })], READ, { ...baseModel, now: T0 + 4 * HOUR });
add("glucose", "basalContext: needs 3 doses per slot", "basalContext", [basal("x1", T0 - 3 * HOUR, 16, "am"), basal("x2", T0 - 2 * HOUR, 16, "am")]);
add("glucose", "basalContext: both slots give a 12 h period", "basalContext", [...[1, 2, 3].map(i => basal("am" + i, T0 - i * 24 * HOUR, 12, "am")), ...[1, 2, 3].map(i => basal("pm" + i, T0 - i * 24 * HOUR - 12 * HOUR, 14, "pm")), basal("last", T0 - HOUR, 15, "pm")]);
add("glucose", "basalDrop: 2 extra units over half the period", "basalDrop", { logged: 1, usual: { am: null, pm: 14 }, periodMs: 12 * HOUR, doses: [{ ts: T0, units: 16, slot: "pm", extra: 2 }] }, T0, T0 + 6 * HOUR, 50);
add("glucose", "insulinDrop: whole dose over its duration", "insulinDrop", [{ ts: T0, mealDose: 2, correctionDose: 0 }], T0, T0 + 360 * MIN, 50, 75, 360);
add("glucose", "insulinDrop: basal entries are ignored", "insulinDrop", [{ ts: T0, entryType: "basal", mealDose: 5 }], T0, T0 + HOUR, 50, 75, 360);
for (const gap of [-40, -14, 0, 14, 15, 60, 160]) add("glucose", `gapSummary ${gap}`, "gapSummary", gap);
add("glucose", "prepareReadings: sorts, drops junk, smooths a spike", "prepareReadings", [{ at: T0 + 10 * MIN, mgdl: 120 }, { at: T0, mgdl: 100 }, { at: T0 + 5 * MIN, mgdl: 220 }, { at: null, mgdl: 5 }, { at: T0 + 15 * MIN, mgdl: 124 }, { at: T0 + 20 * MIN, mgdl: 126 }]);
add("glucose", "glucoseNear: within tolerance", "glucoseNear", [{ at: T0, mgdl: 100 }, { at: T0 + 5 * MIN, mgdl: 110 }], T0 + 3 * MIN, 4);
add("glucose", "glucoseNear: too far away", "glucoseNear", [{ at: T0, mgdl: 100 }], T0 + 30 * MIN, 4);
const obsSet = { isfMgdl: 50, peak: 75, dia: 360, absMinutes: 120, fallbackRatio: 10 };
add("glucose", "observedCarbs: usual pace, 1 h in", "observedCarbs", [E1], READ.filter(r => r.at <= T0 + 60 * MIN), obsSet, T0 + 60 * MIN);
add("glucose", "observedCarbs: no readings falls back to the plain model", "observedCarbs", [E1], [], obsSet, T0 + 60 * MIN);
add("glucose", "observedCarbs: nothing logged", "observedCarbs", [], READ, obsSet, T0 + 60 * MIN);
add("glucose", "observedCarbs: fast meal", "observedCarbs", [E1], readingsFor({ T: 60 }).filter(r => r.at <= T0 + 60 * MIN), { ...obsSet, absMinutes: 180 }, T0 + 60 * MIN);
add("glucose", "cobAt: halfway through the finish time", "cobAt", { cob: 40, finishMin: 80 }, 40);
add("glucose", "cobAt: nothing left", "cobAt", { cob: 0.2, finishMin: 80 }, 10);
add("glucose", "projectGlucose: 30 min after a meal", "projectGlucose", [E1], READ.filter(r => r.at <= T0 + 30 * MIN), obsSet, T0 + 30 * MIN);
add("glucose", "projectGlucose: stale reading gives nothing", "projectGlucose", [E1], READ.filter(r => r.at <= T0), obsSet, T0 + 60 * MIN);
const vals = [55, 64, 72, 95, 110, 130, 150, 175, 182, 210, 260];
const rd = vals.map((v, i) => ({ at: T0 + i * 5 * MIN, mgdl: v }));
for (const p of [0, 10, 25, 50, 75, 90, 100]) add("glucose", `percentile ${p} of a sorted list`, "percentile", [...vals], p);
add("glucose", "percentile: empty", "percentile", [], 50);
add("glucose", "percentile: single value", "percentile", [100], 90);
for (const m of [null, 100, 154, 200]) add("glucose", `estimatedA1c ${m}`, "estimatedA1c", m);
add("glucose", "glucoseSummaryStats: mixed day", "glucoseSummaryStats", rd);
add("glucose", "glucoseSummaryStats: custom range", "glucoseSummaryStats", rd, { low: 80, high: 160 });
add("glucose", "glucoseSummaryStats: no readings", "glucoseSummaryStats", []);
add("glucose", "timeInRangeBreakdown: the standard bands", "timeInRangeBreakdown", rd);
for (const v of [[], [5], [1, 3], [3, 1, 2], [1, 2, 3, 4], [1, NaN, 3]]) add("glucose", `median ${JSON.stringify(v)}`, "median", v);
for (const q of [0, 0.25, 0.5, 0.9, 1]) add("glucose", `quantile ${q}`, "quantile", [10, 20, 30, 40, 50], q);

// ================= state =================
const m1 = meal("m1", T0 - 5 * HOUR, { updatedAt: 100 }), m2 = meal("m2", T0 - 3 * HOUR, { updatedAt: 200 }), m3 = meal("m3", T0 - HOUR, { updatedAt: 300 });
add("state", "normalizeState: nothing at all", "normalizeState", null, DEFAULTS);
add("state", "normalizeState: partial settings keep the defaults", "normalizeState", { settings: { isf: 40, insulinModel: { peakMinutes: 60 } }, history: [m1] }, DEFAULTS);
add("state", "normalizeState: junk types are replaced", "normalizeState", { settings: "x", library: "no", recipes: 5, history: {}, deleted: { history: { m9: 5 }, library: 3 } }, DEFAULTS);
add("state", "mergeStates: a stale device does not overwrite meals logged elsewhere", "mergeStates", stateOf({ history: [m1] }), stateOf({ history: [m1, m2, m3] }), DEFAULTS);
add("state", "mergeStates: the newer edit wins", "mergeStates", stateOf({ history: [{ ...m2, mealDose: 9, updatedAt: 500 }] }), stateOf({ history: [m2] }), DEFAULTS);
add("state", "mergeStates: a delete sticks even when the other side is stale", "mergeStates", stateOf({ history: [m1], deleted: { history: { m2: 400 }, library: {}, recipes: {} } }), stateOf({ history: [m1, m2] }), DEFAULTS);
add("state", "mergeStates: an edit after the delete brings it back", "mergeStates", stateOf({ history: [], deleted: { history: { m2: 150 }, library: {}, recipes: {} } }), stateOf({ history: [m2] }), DEFAULTS);
add("state", "mergeStates: equal stamps, the cloud copy wins", "mergeStates", stateOf({ history: [{ ...m2, mealDose: 7 }] }), stateOf({ history: [{ ...m2, mealDose: 8 }] }), DEFAULTS);
add("state", "mergeStates: newer settings win", "mergeStates", stateOf({ settings: { ...DEFAULTS.settings, isf: 40 }, settingsUpdatedAt: 900 }), stateOf({ settings: { ...DEFAULTS.settings, isf: 60 }, settingsUpdatedAt: 500 }), DEFAULTS);
add("state", "mergeStates: no remote copy", "mergeStates", stateOf({ history: [m1] }), null, DEFAULTS);
add("state", "mergeStates: foods and recipes merge too", "mergeStates", stateOf({ library: [{ id: "f1", name: "Rice", carbs: 28, updatedAt: 10 }] }), stateOf({ library: [{ id: "f2", name: "Bread", carbs: 49, updatedAt: 20 }], recipes: [{ id: "r1", name: "Bowl", items: [], updatedAt: 5 }] }), DEFAULTS);
add("state", "stampChanges: a new meal is stamped, an edit is stamped, an untouched one is not", "stampChanges", stateOf({ history: [m1, { ...m2, mealDose: 9 }, meal("new", T0)] }), stateOf({ history: [m1, m2] }), 1000);
add("state", "stampChanges: a removed meal leaves a deletion marker", "stampChanges", stateOf({ history: [m1] }), stateOf({ history: [m1, m2] }), 1000);
add("state", "stampChanges: changed settings bump settingsUpdatedAt", "stampChanges", stateOf({ settings: { ...DEFAULTS.settings, isf: 45 } }), stateOf(), 1000);
add("state", "stampChanges: an undo cancels the earlier deletion", "stampChanges", stateOf({ history: [m1, m2], deleted: { history: { m2: 500 }, library: {}, recipes: {} } }), stateOf({ history: [m1] }), 1000);
add("state", "prepareRestoredState: the snapshot wins, newer meals get deletion markers", "prepareRestoredState", stateOf({ history: [m1] }), stateOf({ history: [m1, m2, m3] }), DEFAULTS, 2000);
add("state", "statesEquivalent: same", "statesEquivalent", stateOf({ history: [m1] }), stateOf({ history: [m1] }));
add("state", "statesEquivalent: a different stamp", "statesEquivalent", stateOf({ history: [m1] }), stateOf({ history: [{ ...m1, updatedAt: 101 }] }));
add("state", "unexplainedEmptying: all deliberately deleted", "unexplainedEmptying", stateOf({ deleted: { history: { a: 1, b: 2 }, library: {}, recipes: {} } }), ["a", "b"]);
add("state", "unexplainedEmptying: one was not", "unexplainedEmptying", stateOf({ deleted: { history: { a: 1 }, library: {}, recipes: {} } }), ["a", "b"]);
add("state", "unexplainedEmptying: history is not empty", "unexplainedEmptying", stateOf({ history: [m1] }), ["a"]);
add("state", "pruneTombstones: old markers go, recent ones stay", "pruneTombstones", stateOf({ deleted: { history: { old: 1, recent: 99 * 24 * HOUR }, library: {}, recipes: {} } }), 100 * 24 * HOUR, 90 * 24 * HOUR);

// ================= sync (Nightscout) =================
const tEntry = (o = {}) => meal("t1", T0, { mealDose: 3, correctionDose: 0.5, totalCarbs: 40, items: [{ name: "Rice" }, { name: "Chicken" }], ...o });
for (const format of ["combined", "split"]) {
  add("sync", `treatmentsForEntry ${format}: meal with insulin`, "treatmentsForEntry", tEntry(), { format });
  add("sync", `treatmentsForEntry ${format}: carbs only`, "treatmentsForEntry", tEntry({ mealDose: 0, correctionDose: 0 }), { format });
  add("sync", `treatmentsForEntry ${format}: insulin only`, "treatmentsForEntry", tEntry({ totalCarbs: 0, items: [] }), { format });
  add("sync", `treatmentsForEntry ${format}: correction with a glucose reading`, "treatmentsForEntry", tEntry({ glucose: 210 }), { format });
  add("sync", `treatmentsForEntry ${format}: glucose in mmol/L`, "treatmentsForEntry", tEntry({ glucose: 11.7 }), { format, units: "mmol" });
  add("sync", `treatmentsForEntry ${format}: nothing to send but a note`, "treatmentsForEntry", tEntry({ mealDose: 0, correctionDose: 0, totalCarbs: 0, items: [] }), { format });
}
add("sync", "treatmentsForEntry: basal goes as a Note, never as insulin", "treatmentsForEntry", basal("bb", T0, 16, "pm"), { format: "combined" });
add("sync", "treatmentsForEntry: an activity goes as a Note, no insulin or carbs", "treatmentsForEntry", activity("aa", T0, { activityType: "other", activityName: "Climbing", intensity: "hard", durationMin: 90, note: "indoor wall" }), { format: "split" });
add("sync", "treatmentsForEntry: basal morning", "treatmentsForEntry", basal("bb", T0, 12.5, "am"), { format: "split" });
for (const u of ["https://x.ns.example.com/?token=abc-123", "https://x.ns.example.com/", "https://x.ns.example.com///?token=a%20b&x=1", "", null, "https://x.example.com/?foo=1&token=zzz"]) {
  add("sync", `nsToken ${JSON.stringify(u)}`, "nsToken", u);
  add("sync", `nsBaseUrl ${JSON.stringify(u)}`, "nsBaseUrl", u);
  add("sync", `nsConfigured ${JSON.stringify(u)}`, "nsConfigured", u);
}
for (const b of [{ _id: "abc" }, [{ _id: "abc" }], { identifier: "id9" }, { result: { identifier: "r1" } }, {}, null, "text"]) add("sync", `extractNsId ${JSON.stringify(b)}`, "extractNsId", b);
add("sync", "entriesToGlucoseRows: filters junk and duplicates", "entriesToGlucoseRows", [{ sgv: 120, date: T0, direction: "Flat" }, { sgv: 121, date: T0 }, { mbg: 99, date: T0 + 5 * MIN }, { sgv: 0, date: T0 + 10 * MIN }, { sgv: "x", date: T0 }, { sgv: 130 }, null], "user-1");

// ================= core =================
const goodEntry = meal("v1", T0);
add("core", "validateEntry: a sound meal", "validateEntry", goodEntry);
add("core", "validateEntry: a sound basal", "validateEntry", basal("v2", T0, 16, "pm"));
add("core", "validateEntry: a sound activity", "validateEntry", activity("v3", T0));
add("core", "validateEntry: an activity with no duration", "validateEntry", activity("v4", T0, { durationMin: undefined }));
for (const [n, e] of [["no id", { ...goodEntry, id: "" }], ["no time", { ...goodEntry, ts: undefined }], ["text dose", { ...goodEntry, mealDose: "2" }], ["no items list", { ...goodEntry, items: null }], ["unknown meal type", { ...goodEntry, mealType: "brunch" }], ["negative basal", { ...basal("v3", T0, 16, "am"), basalDose: -1 }], ["odd slot", { ...basal("v3", T0, 16, "am"), basalSlot: "noon" }], ["not an object", 5]])
  add("core", `validateEntry: ${n}`, "validateEntry", e);
add("core", "validateFood: sound", "validateFood", { name: "Rice", carbs: 28, kcal: 130, gi: 70 });
for (const [n, f] of [["blank name", { name: " ", carbs: 5 }], ["no carbs", { name: "x" }], ["unit food without grams", { name: "Biscuit", carbs: 50, unitBased: true }]]) add("core", `validateFood: ${n}`, "validateFood", f);
add("core", "validateRecipe: sound", "validateRecipe", { name: "Bowl", finalWeight: 300, items: [{ grams: 100, carbsPer100g: 10 }] });
add("core", "validateRecipe: bad grams and no list", "validateRecipe", { name: "Bowl", items: [{ grams: "x" }] });
add("core", "validateRecipe: no items", "validateRecipe", { name: "Bowl" });
add("core", "validateSettings: sound", "validateSettings", DEFAULTS.settings);
for (const [n, s] of [["bad units", { ...DEFAULTS.settings, units: "furlongs" }], ["no ratios", { ...DEFAULTS.settings, timeRatios: [] }], ["bad time", { ...DEFAULTS.settings, timeRatios: [{ start: "6am", end: "12:00", ratio: 10 }] }]]) add("core", `validateSettings: ${n}`, "validateSettings", s);
add("core", "validateState: duplicate ids", "validateState", { settings: DEFAULTS.settings, library: [], recipes: [], history: [goodEntry, goodEntry] });
const be = { nowMs: T0, mealType: "lunch", periodEntry: { name: "Day" }, ratioEntry: { name: "Day", ratio: 10 }, items: [{ refType: "food", refId: "f1", name: "Rice", grams: 100, carbs: 28, kcal: 130, carbsPer100g: 28, kcalPer100g: 130, gi: 70 }], eatingOut: false, noInsulin: false, computed: { mealDose: 2.5, correctionDose: 0 }, glucoseVal: null };
add("core", "buildMealEntry: a normal meal", "buildMealEntry", be);
add("core", "buildMealEntry: Eating Out saves no items and no carbs", "buildMealEntry", { ...be, eatingOut: true, computed: { mealDose: 3, correctionDose: 0 } });
add("core", "buildMealEntry: a capped dose records what it was before", "buildMealEntry", { ...be, computed: { mealDose: 12, correctionDose: 3, capped: true, requested: 19.5 }, glucoseVal: 250 });
add("core", "buildMealEntry: treating a low", "buildMealEntry", { ...be, noInsulin: true, computed: { mealDose: 0, correctionDose: 0 } });
add("core", "adjustUsage: up", "adjustUsage", [{ id: "f1", usageCount: 2 }], [{ id: "r1" }], [{ refType: "food", refId: "f1" }, { refType: "recipe", refId: "r1" }], 1);
add("core", "adjustUsage: down never goes below zero", "adjustUsage", [{ id: "f1", usageCount: 0 }], [], [{ refType: "food", refId: "f1" }], -1);
add("core", "makeBasalEntry", "makeBasalEntry", { units: 16.456, ts: T0, slot: "pm", now: T0 + 5000 });
for (const [u, last] of [[16, { units: 16, ts: T0 }], [0, null], [250, null], [4.1, { units: 41, ts: T0 }], [41, { units: 4.1, ts: T0 }], [16.5, { units: 16, ts: T0 }], [120, null], [NaN, null]])
  add("core", `basalDoseCheck ${u} vs ${JSON.stringify(last)}`, "basalDoseCheck", u, last);
add("core", "lastBasalDose: newest in the slot", "lastBasalDose", [basal("a", T0 - 3 * HOUR, 15, "pm"), basal("b", T0 - HOUR, 16, "pm"), basal("c", T0, 12, "am")], "pm");
add("core", "recipeTotals: saved rates and a live lookup", "recipeTotals", { finalWeight: 200, items: [{ grams: 100, carbsPer100g: 10, kcalPer100g: 100 }, { grams: 100, foodId: "f1" }] }, [{ id: "f1", carbs: 50, kcal: 200 }]);
add("core", "recipeTotals: no final weight", "recipeTotals", { items: [{ grams: 50, carbsPer100g: 20, kcalPer100g: 80 }] }, []);
add("core", "toCsv: quotes and commas", "toCsv", [{ name: 'Jam "x", sweet', carbs: 60 }], ["name", "carbs"]);
add("core", "parseCsv: quoted fields", "parseCsv", 'name,carbs\n"Jam ""x"", sweet",60\nRice,28\n');
add("core", "parseLibraryFile: foods csv", "parseLibraryFile", "foods.csv", "name,carbs_per_100g,calories_per_100g,is_favorite,unit_label,grams_per_unit\nRice,28,130,yes,,\nBiscuit,50,450,,biscuit,12\n");
add("core", "parseLibraryFile: recipes csv", "parseLibraryFile", "recipes.csv", 'name,ingredients,final_weight\nBowl,"[{""food_name"":""Rice"",""weight_grams"":100,""carbs_per_100g"":28}]",250\n');
add("core", "parseLibraryFile: json", "parseLibraryFile", "x.json", JSON.stringify({ foods: [{ name: "A", carbs: 1 }], recipes: [{ name: "R", items: [] }] }));
add("core", "mergeLibrary: update by name, add new, link recipe ingredients", "mergeLibrary", [{ id: "f1", name: "Rice", carbs: 1, usageCount: 4 }], [], { foods: [{ name: "rice", carbs: 28 }, { name: "Bread", carbs: 49 }], recipes: [{ name: "Bowl", items: [{ name: "bread", grams: 50 }] }] });
for (const [clock, label] of [[{ hour: 6, minute: 0 }, "morning start"], [{ hour: 12, minute: 0 }, "midday"], [{ hour: 23, minute: 45 }, "night"], [{ hour: 2, minute: 0 }, "small hours"]])
  add("core", `ratioAt ${label}`, "ratioAt", DEFAULTS.settings.timeRatios, clock);
add("core", "ratioAt: no brackets", "ratioAt", [], { hour: 12 });
for (const [h, m] of [[4, 59], [5, 0], [10, 29], [10, 30], [14, 29], [14, 30], [17, 59], [18, 0], [22, 29], [22, 30], [0, 0]])
  add("core", `autoMealType ${h}:${String(m).padStart(2, "0")}`, "autoMealType", { hour: h, minute: m });
for (const [s, e, m] of [["22:00", "06:00", 60], ["22:00", "06:00", 720], ["06:00", "12:00", 360], ["06:00", "12:00", 720], ["00:00", "00:00", 5]]) add("core", `inRange ${m} in ${s}-${e}`, "inRange", m, s, e);
for (const t of ["00:00", "06:30", "23:59"]) add("core", `toMinutes ${t}`, "toMinutes", t);
for (const ms of [0, 5 * MIN, HOUR, 90 * MIN, 2 * HOUR, 125 * MIN, -MIN]) add("core", `formatDuration ${ms}`, "formatDuration", ms);
for (const [n, lo, hi] of [[5, 0, 10], [-1, 0, 10], [11, 0, 10]]) add("core", `clampNum ${n}`, "clampNum", n, lo, hi);

export const CASES = cases;
