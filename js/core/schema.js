// The data contract in code. docs/DATA-CONTRACT.md is the same thing in words; keep them in step.
// Validators never throw and never change data: they return a list of problems, each { path, severity, message }.
//   severity "error"  -> the record would break something (no id, no time, a dose that isn't a number). Imports skip these.
//   severity "warn"   -> unusual but the app copes (an unknown meal type, a missing optional field).
// A native app should run the same checks on anything it reads, from a backup, the cloud or another device.
export const CONTRACT_VERSION = 1;
export const MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack", "correction", "basal", "activity"];
export const BASAL_SLOTS = ["am", "pm"];
export const UNITS = ["mgdl", "mmol"];

const isNum = v => typeof v === "number" && Number.isFinite(v);
const isStr = v => typeof v === "string";
const isObj = v => v && typeof v === "object" && !Array.isArray(v);
const problem = (path, severity, message) => ({ path, severity, message });

function numberField(out, o, path, key, { required = false, nullable = false, min } = {}) {
  const v = o[key];
  if (v == null) { if (required && !(nullable && v === null)) out.push(problem(`${path}.${key}`, "error", "is missing")); return; }
  if (!isNum(v)) { out.push(problem(`${path}.${key}`, "error", `should be a number, got ${typeof v}`)); return; }
  if (min != null && v < min) out.push(problem(`${path}.${key}`, "error", `should not be below ${min}`));
}

// An id is a short run of letters, digits and - _ . : -- every id the app makes fits. Anything else (quotes, angle brackets,
// spaces) can only have come from a hand-made or tampered file, and is refused so it can never reach the page as markup.
export const SAFE_ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const idProblem = (v, path) => !isStr(v) || !v ? problem(`${path}.id`, "error", "needs a text id")
  : !SAFE_ID.test(v) ? problem(`${path}.id`, "error", "has characters an id can't contain") : null;

export function isBasal(entry) { return !!entry && (entry.entryType === "basal" || entry.mealType === "basal"); }
export function isActivity(entry) { return !!entry && entry.entryType === "activity"; }
export const ACTIVITY_INTENSITIES = ["light", "moderate", "hard"];

// One history record: a meal/correction, or a basal dose.
export function validateEntry(e, path = "entry") {
  const out = [];
  if (!isObj(e)) return [problem(path, "error", "is not an object")];
  { const p = idProblem(e.id, path); if (p) out.push(p); }
  numberField(out, e, path, "ts", { required: true });
  if (isBasal(e)) {
    numberField(out, e, path, "basalDose", { required: true, min: 0 });
    if (e.basalSlot != null && !BASAL_SLOTS.includes(e.basalSlot)) out.push(problem(`${path}.basalSlot`, "warn", `unknown slot "${e.basalSlot}"`));
    return out;
  }
  // A logged activity (2.65.0): no food or insulin, just what, how long and how hard.
  if (isActivity(e)) {
    numberField(out, e, path, "durationMin", { required: true, min: 0 });
    if (!isStr(e.activityType) || !e.activityType) out.push(problem(`${path}.activityType`, "warn", "is missing"));
    if (e.intensity != null && !ACTIVITY_INTENSITIES.includes(e.intensity)) out.push(problem(`${path}.intensity`, "warn", `unknown intensity "${e.intensity}"`));
    for (const k of ["activityName", "note"]) if (e[k] != null && !isStr(e[k])) out.push(problem(`${path}.${k}`, "warn", "should be text"));
    return out;
  }
  if (!isStr(e.mealType)) out.push(problem(`${path}.mealType`, "warn", "is missing"));
  else if (!MEAL_TYPES.includes(e.mealType)) out.push(problem(`${path}.mealType`, "warn", `unknown meal type "${e.mealType}"`));
  if (!Array.isArray(e.items)) out.push(problem(`${path}.items`, "error", "should be a list"));
  else e.items.forEach((it, i) => {
    if (!isObj(it)) { out.push(problem(`${path}.items[${i}]`, "error", "is not an object")); return; }
    if (!isStr(it.name)) out.push(problem(`${path}.items[${i}].name`, "warn", "is missing"));
    numberField(out, it, `${path}.items[${i}]`, "grams", { min: 0 });
    numberField(out, it, `${path}.items[${i}]`, "carbs", { min: 0 });
  });
  for (const k of ["totalCarbs", "totalKcal", "mealDose"]) numberField(out, e, path, k, { min: 0 });
  numberField(out, e, path, "correctionDose", { min: -1000 });   // negative = insulin taken off the meal because glucose was low (or typed as a subtraction)
  for (const k of ["glucose", "ratioValue", "cappedFrom"]) numberField(out, e, path, k, { nullable: true });
  if (e.noInsulin != null && typeof e.noInsulin !== "boolean") out.push(problem(`${path}.noInsulin`, "warn", "should be true or false"));
  if (e.ns != null && !isObj(e.ns)) out.push(problem(`${path}.ns`, "warn", "should be an object"));
  return out;
}

export function validateFood(f, path = "food") {
  const out = [];
  if (!isObj(f)) return [problem(path, "error", "is not an object")];
  if (!isStr(f.name) || !f.name.trim()) out.push(problem(`${path}.name`, "error", "needs a name"));
  if (f.id != null) { const p = idProblem(f.id, path); if (p) out.push(p); }
  numberField(out, f, path, "carbs", { required: true, min: 0 });          // per 100 g
  for (const k of ["kcal", "protein", "fat", "salt", "gi", "gramsPerUnit"]) numberField(out, f, path, k, { nullable: true, min: 0 });
  if (f.unitBased && !(isNum(f.gramsPerUnit) && f.gramsPerUnit > 0)) out.push(problem(`${path}.gramsPerUnit`, "warn", "a per-unit food needs grams per unit"));
  return out;
}

export function validateRecipe(r, path = "recipe") {
  const out = [];
  if (!isObj(r)) return [problem(path, "error", "is not an object")];
  if (!isStr(r.name) || !r.name.trim()) out.push(problem(`${path}.name`, "error", "needs a name"));
  if (r.id != null) { const p = idProblem(r.id, path); if (p) out.push(p); }
  if (!Array.isArray(r.items)) { out.push(problem(`${path}.items`, "error", "should be a list")); return out; }
  r.items.forEach((it, i) => {
    if (!isObj(it)) { out.push(problem(`${path}.items[${i}]`, "error", "is not an object")); return; }
    numberField(out, it, `${path}.items[${i}]`, "grams", { required: true, min: 0 });
    numberField(out, it, `${path}.items[${i}]`, "carbsPer100g", { nullable: true, min: 0 });
  });
  numberField(out, r, path, "finalWeight", { nullable: true, min: 0 });
  numberField(out, r, path, "slices", { nullable: true, min: 0 });   // how many slices the whole dish is cut into (optional)
  return out;
}

export function validateSettings(s, path = "settings") {
  const out = [];
  if (!isObj(s)) return [problem(path, "error", "is not an object")];
  numberField(out, s, path, "isf", { required: true, min: 1 });
  numberField(out, s, path, "target", { required: true, min: 1 });
  numberField(out, s, path, "maxDose", { required: true, min: 0 });
  if (!UNITS.includes(s.units)) out.push(problem(`${path}.units`, "error", `should be one of ${UNITS.join(", ")}`));
  if (!Array.isArray(s.timeRatios) || !s.timeRatios.length) out.push(problem(`${path}.timeRatios`, "error", "needs at least one ratio bracket"));
  else s.timeRatios.forEach((r, i) => {
    numberField(out, r, `${path}.timeRatios[${i}]`, "ratio", { required: true, min: 0.1 });
    for (const k of ["start", "end"]) if (!/^\d{1,2}:\d{2}$/.test(String(r[k]))) out.push(problem(`${path}.timeRatios[${i}].${k}`, "error", "should look like 07:30"));
    if (r.days !== undefined && (!Array.isArray(r.days) || r.days.some(d => !Number.isInteger(d) || d < 0 || d > 6))) out.push(problem(`${path}.timeRatios[${i}].days`, "error", "should be a list of weekday numbers 0 (Sun) to 6 (Sat)"));
  });
  return out;
}

// The whole saved state (also what a backup file holds).
export function validateState(st) {
  const out = [];
  if (!isObj(st)) return [problem("state", "error", "is not an object")];
  out.push(...validateSettings(st.settings));
  for (const [key, fn] of [["library", validateFood], ["recipes", validateRecipe], ["history", validateEntry]]) {
    if (!Array.isArray(st[key])) { out.push(problem(key, "error", "should be a list")); continue; }
    const seen = new Set();
    st[key].forEach((item, i) => {
      out.push(...fn(item, `${key}[${i}]`));
      if (item && item.id != null) { if (seen.has(item.id)) out.push(problem(`${key}[${i}].id`, "error", `duplicate id ${item.id}`)); seen.add(item.id); }
    });
  }
  return out;
}

export const hasErrors = problems => problems.some(p => p.severity === "error");
export function summarizeProblems(problems) {
  const errors = problems.filter(p => p.severity === "error").length;
  const warnings = problems.length - errors;
  if (!problems.length) return "clean";
  const first = problems[0];
  return `${errors} error${errors === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"} (first: ${first.path} ${first.message})`;
}
