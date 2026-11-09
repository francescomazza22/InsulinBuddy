// Calories per day (2.78.0): what was eaten against an estimate of what the day needed. Pure functions only; never feeds a dose.
//
// Eaten  = the kcal of every logged meal and treated low (their foods' own figures), an assumed figure per eating-out meal
//          (2.78.3, if set), + the person's daily extras, the things
//          with no carbs that never get logged (olive oil, flat whites, ...), each "N a day" at a kcal they can change.
// Needed = resting needs (Mifflin-St Jeor, from sex, age, height, weight) x a daily-life factor (everyday moving, NOT exercise)
//          + the logged activities: the Watch's active calories for an Apple Health import, otherwise an estimate from
//          the activity's type, intensity, minutes and weight ((MET - 1) x kg x hours, i.e. above resting, like the Watch).
// Everything here is an estimate and the UI says so.

import { dayBounds, shiftDay } from "./day-timeline.js";
import { isNonMealEntry } from "./history.js";

export const CALORIE_LIMITS = {
  heightCm: [120, 230], weightKg: [30, 250], eatingOutKcal: [0, 5000], eatingOutMultiplier: [1, 5], lifeFactor: [1.1, 1.8], kcalPerUnit: [0, 2000], perDay: [0, 50],
  minAge: 14, maxAge: 110, extrasMax: 12, nameMax: 40, unitMax: 12
};
export const LIFE_FACTORS = [
  { value: 1.2, label: "Mostly sitting", hint: "desk all day, little walking" },
  { value: 1.3, label: "Some walking", hint: "desk job, commute on foot" },
  { value: 1.4, label: "On my feet a lot", hint: "lots of walking or standing" },
  { value: 1.5, label: "Very active job", hint: "physical work most of the day" }
];
export const CALORIE_DEFAULTS = {
  sex: null, birthYear: null, heightCm: null, weightKg: null, lifeFactor: 1.3,
  eatingOutKcal: 900,   // 2.78.3: assumed kcal for each eating-out meal (its foods aren't logged); null = don't count them.
                        // 2.82.0: only used when the meal has no insulin (or no ratio) to work it out from
  eatingOutMultiplier: 2,   // 2.82.0: eating out kcal = carbs from the insulin x 4 kcal/g x this; null = always the fixed figure
  extras: [
    { id: "olive-oil", name: "Olive oil", unit: "tbsp", kcalPerUnit: 119, perDay: 0 },
    { id: "flat-white", name: "Flat white", unit: "cup", kcalPerUnit: 110, perDay: 0 }
  ]
};

// MET by activity type and intensity (Compendium of Physical Activities, rounded). Net kcal = (MET - 1) x kg x hours.
export const ACTIVITY_METS = {
  walk: { light: 2.8, moderate: 3.5, hard: 5 },
  run: { light: 6, moderate: 9, hard: 11.5 },
  cycle: { light: 4, moderate: 6.8, hard: 10 },
  gym: { light: 3.5, moderate: 5, hard: 6 },
  hiit: { light: 6, moderate: 8, hard: 10 },
  swim: { light: 5, moderate: 7, hard: 9.8 },
  sport: { light: 4, moderate: 6.5, hard: 8 },
  yoga: { light: 2.3, moderate: 3, hard: 4 },
  other: { light: 3, moderate: 4.5, hard: 7 }
};

const SAFE_ID = /^[A-Za-z0-9_.:-]{1,64}$/;
const toNum = v => { const n = typeof v === "string" ? Number(v.trim().replace(",", ".")) : v; return typeof n === "number" && isFinite(n) ? n : null; };
const inRange = (v, [lo, hi]) => { const n = toNum(v); return n != null && n >= lo && n <= hi ? n : null; };
const clean = (s, max) => String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, max);

/** One extra, cleaned, or null when it can't be used (no name). */
export function cleanExtra(x, i = 0) {
  if (!x || typeof x !== "object") return null;
  const name = clean(x.name, CALORIE_LIMITS.nameMax);
  if (!name) return null;
  const kcal = inRange(x.kcalPerUnit, CALORIE_LIMITS.kcalPerUnit);
  const per = inRange(x.perDay, CALORIE_LIMITS.perDay);
  return {
    id: typeof x.id === "string" && SAFE_ID.test(x.id) ? x.id : `extra-${i}`,
    name, unit: clean(x.unit, CALORIE_LIMITS.unitMax),
    kcalPerUnit: kcal == null ? 0 : Math.round(kcal * 10) / 10,
    perDay: per == null ? 0 : Math.round(per * 100) / 100,
    meals: cleanMeals(x),   // 2.95.0: [] = every logged day; else the meals it goes with, its amount split evenly between them
    days: cleanDays(x.days)   // 2.98.0: [] = every day of the week; else only those weekdays (0 = Sunday … 6 = Saturday)
  };
}
// 2.94.0 had one `meal` ("any" or a meal type); 2.95.0 keeps a list, so a coffee can go with breakfast and lunch.
export const MEAL_KINDS = ["breakfast", "lunch", "dinner", "snack"];
// Weekdays as numbers 0 (Sunday) … 6 (Saturday), like the ratio brackets' days; all seven is the same as none (every day).
function cleanDays(raw) {
  if (!Array.isArray(raw)) return [];
  const d = [0, 1, 2, 3, 4, 5, 6].filter(n => raw.some(v => Number(v) === n));
  return d.length === 7 ? [] : d;
}
/** The weekday (0 = Sunday) of a "YYYY-MM-DD" local date. */
export function weekdayOf(dayKey) {
  const [y, m, d] = String(dayKey).split("-").map(Number);
  return new Date(y, m - 1, d).getDay();
}
/** Is an extra used on that date at all (its weekdays)? */
export const extraOnDay = (x, dayKey) => !(x.days && x.days.length) || x.days.includes(weekdayOf(dayKey));
function cleanMeals(x) {
  const raw = Array.isArray(x.meals) ? x.meals : x.meal && x.meal !== "any" ? [x.meal] : [];
  return MEAL_KINDS.filter(m => raw.includes(m));   // known ones, in the day's order, no repeats
}
// 2.94.0: an extra can belong to meals (mozzarella with lunch): it counts only when those meals are logged with their
// foods (an eating-out meal doesn't count: its estimate already covers everything eaten). With several meals (2.95.0) each
// logged meal brings its share: 2 coffees with breakfast and lunch = 1 each, so a day with only breakfast counts 1.
export const EXTRA_MEALS = ["any", "breakfast", "lunch", "dinner", "snack"];

/** The calorie settings, cleaned and clamped; anything unusable is null (not set). */
export function calorieRule(c, now = Date.now()) {
  const o = c && typeof c === "object" ? c : {};
  const year = new Date(now).getFullYear();
  const by = toNum(o.birthYear);
  const birthYear = by != null && Number.isInteger(by) && year - by >= CALORIE_LIMITS.minAge && year - by <= CALORIE_LIMITS.maxAge ? by : null;
  const extrasIn = Array.isArray(o.extras) ? o.extras : CALORIE_DEFAULTS.extras;
  const seen = new Set();
  const extras = [];
  extrasIn.forEach((x, i) => {
    const e = cleanExtra(x, i);
    if (!e || extras.length >= CALORIE_LIMITS.extrasMax) return;
    while (seen.has(e.id)) e.id += "x";
    seen.add(e.id);
    extras.push(e);
  });
  const lf = inRange(o.lifeFactor, CALORIE_LIMITS.lifeFactor);
  const eo = "eatingOutKcal" in o ? inRange(o.eatingOutKcal, CALORIE_LIMITS.eatingOutKcal) : CALORIE_DEFAULTS.eatingOutKcal;
  const em = "eatingOutMultiplier" in o ? inRange(o.eatingOutMultiplier, CALORIE_LIMITS.eatingOutMultiplier) : CALORIE_DEFAULTS.eatingOutMultiplier;
  const h = inRange(o.heightCm, CALORIE_LIMITS.heightCm), w = inRange(o.weightKg, CALORIE_LIMITS.weightKg);
  return {
    sex: o.sex === "male" || o.sex === "female" ? o.sex : null,
    birthYear,
    heightCm: h == null ? null : Math.round(h * 10) / 10,
    weightKg: w == null ? null : Math.round(w * 10) / 10,
    lifeFactor: lf == null ? CALORIE_DEFAULTS.lifeFactor : Math.round(lf * 100) / 100,
    eatingOutKcal: eo == null ? null : Math.round(eo),
    eatingOutMultiplier: em == null ? null : Math.round(em * 100) / 100,
    extras,
    dayExtras: cleanDayExtras(o.dayExtras, extras),
    dayOneOffs: cleanDayOneOffs(o.dayOneOffs)
  };
}

// ---- Daily extras adjusted per day (2.83.0) ----
// Each day starts at the usual amounts (perDay); a day he changes keeps its own counts, stored by local date:
// dayExtras = { "2026-11-05": { "flat-white": 2, ... } }. Only known extras, 0..50 each, the latest DAY_EXTRAS_KEEP days.
export const DAY_EXTRAS_KEEP = 120;
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
/** Local calendar date of a time, as "YYYY-MM-DD". */
export function dayKeyOf(ts) {
  const d = new Date(ts), p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function cleanDayExtras(raw, extras) {
  if (!raw || typeof raw !== "object") return {};
  const ids = new Set(extras.map(x => x.id));
  const days = Object.keys(raw).filter(k => DAY_KEY.test(k)).sort().slice(-DAY_EXTRAS_KEEP);
  const out = {};
  for (const k of days) {
    const v = raw[k];
    if (!v || typeof v !== "object") continue;
    const day = {};
    for (const [id, n] of Object.entries(v)) {
      const c = inRange(n, CALORIE_LIMITS.perDay);
      if (ids.has(id) && c != null) day[id] = Math.round(c * 100) / 100;
    }
    if (Object.keys(day).length) out[k] = day;
  }
  return out;
}
// One-off items for a single day (2.91.0): something had just that day (from the library), not in the usual list.
// dayOneOffs = { "2026-11-06": [{ id, name, unit, kcalPerUnit, count }] }, at most ONE_OFFS_MAX a day, same 120 days.
export const ONE_OFFS_MAX = 12;
function cleanDayOneOffs(raw) {
  if (!raw || typeof raw !== "object") return {};
  const days = Object.keys(raw).filter(k => DAY_KEY.test(k)).sort().slice(-DAY_EXTRAS_KEEP);
  const out = {};
  for (const k of days) {
    if (!Array.isArray(raw[k])) continue;
    const seen = new Set(), list = [];
    raw[k].forEach((x, i) => {
      const e = cleanExtra(x ? { ...x, perDay: x.count } : x, i);
      if (!e || list.length >= ONE_OFFS_MAX) return;
      if (!/^once-/.test(e.id)) e.id = `once-${e.id}`;
      while (seen.has(e.id)) e.id += "x";
      seen.add(e.id);
      if (e.perDay > 0) list.push({ id: e.id, name: e.name, unit: e.unit, kcalPerUnit: e.kcalPerUnit, count: e.perDay });
    });
    if (list.length) out[k] = list;
  }
  return out;
}
/** The extras for one day: [{ ...extra, count, usual, kcal, changed, oneOff }], total and whether the day was adjusted.
 * The usual list first (at that day's own counts), then that day's one-off items. */
// mealsOnDay (2.94.0): the meal types logged that day with their foods (a Set). Each item gets meals ([] = every day),
// logged (its meals logged that day), share (fraction that counts: logged / meals), counted (kcal x share), applies.
// total = what counts that day; aside = every-day extras + one-offs; withMeals = the meal extras' counted kcal.
export function extrasForDay(rule, dayKey, mealsOnDay = null) {
  const own = (rule.dayExtras || {})[dayKey] || {};
  const items = rule.extras.map(x => {
    // 2.98.0: on a weekday it isn't used, its usual amount that day is 0 (a count set for the day still wins).
    const onDay = extraOnDay(x, dayKey), usual = onDay ? x.perDay : 0;
    const count = Object.prototype.hasOwnProperty.call(own, x.id) ? own[x.id] : usual;
    const meals = Array.isArray(x.meals) ? x.meals : [];
    const logged = meals.filter(m => !!mealsOnDay && mealsOnDay.has(m));
    const share = meals.length ? logged.length / meals.length : 1;
    const kcal = x.kcalPerUnit * count;
    return { ...x, meals, logged, share, usual, onDay, count, kcal, counted: kcal * share, changed: count !== usual, oneOff: false, applies: share > 0 };
  });
  for (const o of (rule.dayOneOffs || {})[dayKey] || []) {
    const kcal = o.kcalPerUnit * o.count;
    items.push({ id: o.id, name: o.name, unit: o.unit, kcalPerUnit: o.kcalPerUnit, perDay: 0, usual: 0, count: o.count, kcal, counted: kcal, changed: true, oneOff: true, meals: [], logged: [], share: 1, applies: true });
  }
  const sum = (list, f) => list.reduce((s, x) => s + x[f], 0);
  const aside = sum(items.filter(x => !x.meals.length), "kcal");
  const withMeals = sum(items.filter(x => x.meals.length), "counted");
  return { items, total: aside + withMeals, aside, withMeals, adjusted: items.some(x => x.changed) };
}
/** kcal the meal being built (mealType) brings in: each extra's share for that meal, if that meal isn't logged yet. */
export function mealExtrasKcal(rule, dayKey, mealType, mealsOnDay = null) {
  if (!mealType || mealType === "any" || (mealsOnDay && mealsOnDay.has(mealType))) return 0;
  return extrasForDay(rule, dayKey, null).items.filter(x => x.meals.includes(mealType)).reduce((s, x) => s + x.kcal / x.meals.length, 0);
}
/** { dayOneOffs } with a one-off item added to a day (or null when that day is full). */
export function addDayOneOff(rule, dayKey, spec, id) {
  if (!DAY_KEY.test(dayKey)) return null;
  const all = { ...(rule.dayOneOffs || {}) };
  const list = [...(all[dayKey] || [])];
  if (list.length >= ONE_OFFS_MAX) return null;
  const e = cleanExtra({ ...spec, perDay: spec.count || 1, id }, list.length);
  if (!e) return null;
  list.push({ id: /^once-/.test(e.id) ? e.id : `once-${e.id}`, name: e.name, unit: e.unit, kcalPerUnit: e.kcalPerUnit, count: e.perDay || 1 });
  all[dayKey] = list;
  return { dayOneOffs: all };
}
/** The settings patch for one count on a day: a usual extra (dayExtras) or a one-off (dayOneOffs; 0 removes it). */
export function setDayCount(rule, dayKey, id, count) {
  const one = ((rule.dayOneOffs || {})[dayKey] || []).find(o => o.id === id);
  if (!one) return { dayExtras: setDayExtra(rule, dayKey, id, count) };
  const c = Math.max(0, Math.min(CALORIE_LIMITS.perDay[1], Math.round(Number(count) * 100) / 100 || 0));
  const all = { ...(rule.dayOneOffs || {}) };
  const list = all[dayKey].map(o => (o.id === id ? { ...o, count: c } : o)).filter(o => o.count > 0);
  if (list.length) all[dayKey] = list; else delete all[dayKey];
  return { dayOneOffs: all };
}
/** The settings patch that puts a day back to the usual amounts (its own counts and one-offs dropped). */
export function resetDay(rule, dayKey) {
  const dayExtras = { ...(rule.dayExtras || {}) }, dayOneOffs = { ...(rule.dayOneOffs || {}) };
  delete dayExtras[dayKey]; delete dayOneOffs[dayKey];
  return { dayExtras, dayOneOffs };
}
/** dayExtras with one count set for a day (a count equal to the usual drops it, so the day follows the usual again). */
export function setDayExtra(rule, dayKey, id, count) {
  const x = rule.extras.find(e => e.id === id);
  const all = { ...(rule.dayExtras || {}) };
  if (!x || !DAY_KEY.test(dayKey)) return all;
  const day = { ...(all[dayKey] || {}) };
  const c = Math.max(CALORIE_LIMITS.perDay[0], Math.min(CALORIE_LIMITS.perDay[1], Math.round(Number(count) * 100) / 100 || 0));
  if (c === (extraOnDay(x, dayKey) ? x.perDay : 0)) delete day[id]; else day[id] = c;   // the usual for that weekday
  if (Object.keys(day).length) all[dayKey] = day; else delete all[dayKey];
  return all;
}

/** What is still missing for a target: [] when everything is set. */
export function missingDetails(rule) {
  const out = [];
  if (!rule.sex) out.push("sex");
  if (rule.birthYear == null) out.push("year of birth");
  if (rule.heightCm == null) out.push("height");
  if (rule.weightKg == null) out.push("weight");
  return out;
}

/** Resting needs in kcal/day (Mifflin-St Jeor), or null when a detail is missing. Age is the age reached that year. */
export function restingKcal(rule, at = Date.now()) {
  if (missingDetails(rule).length) return null;
  const age = new Date(at).getFullYear() - rule.birthYear;
  const v = 10 * rule.weightKg + 6.25 * rule.heightCm - 5 * age + (rule.sex === "male" ? 5 : -161);
  return Math.max(0, v);
}

/** Extras per day: [{ ...extra, kcal }] and the total. */
export function extrasKcal(rule) {
  const items = rule.extras.map(x => ({ ...x, kcal: x.kcalPerUnit * x.perDay }));
  return { items, total: items.reduce((s, x) => s + x.kcal, 0) };
}

/** The Watch's active calories, read from the note an Apple Health import writes ("From Apple Health · 82 kcal ..."). */
export function watchKcal(e) {
  if (!e || e.source !== "appleHealth" || typeof e.note !== "string") return null;
  const m = /^From Apple Health · (\d+) kcal\b/.exec(e.note);
  return m ? Number(m[1]) : null;
}

/** kcal burned by one activity entry above resting: { kcal, from: "watch" | "estimate" } or null (no weight to estimate with). */
export function activityKcal(e, weightKg) {
  if (!e || e.entryType !== "activity" || !(Number(e.durationMin) > 0)) return null;
  const w = watchKcal(e);
  if (w != null) return { kcal: w, from: "watch" };
  if (!(weightKg > 0)) return null;
  const mets = ACTIVITY_METS[e.activityType] || ACTIVITY_METS.other;
  const met = mets[e.intensity] || mets.moderate;
  return { kcal: Math.max(0, met - 1) * weightKg * (Number(e.durationMin) / 60), from: "estimate" };
}

const foodKcal = e => (Number.isFinite(Number(e.totalKcal)) ? Math.max(0, Number(e.totalKcal)) : 0);
/** Foods with carbs but no calorie figure (they count 0 kcal, so the day reads low). */
const kcalMissing = e => (Array.isArray(e.items) ? e.items : []).filter(i => i && !(Number(i.kcal) > 0) && Number(i.carbs) > 0).length;

// ---- Eating out from the insulin (2.82.0) ----
// An eating-out meal has no foods logged, but its insulin says roughly how many carbs it had: units x the meal's ratio
// (grams per unit). Corrections logged in the next few hours (until the next meal) were usually for carbs the first dose
// missed, so they are added at the same meal's ratio. Those carbs give 4 kcal per gram; restaurant food carries fat and
// protein too, so the carb calories are multiplied (2 by default: half the calories from carbs). With no insulin or no
// ratio saved, the fixed figure stands in. Never feeds a dose.
export const KCAL_PER_G_CARB = 4;
export const EATING_OUT_CORRECTION_HOURS = 4;

/** A correction-only entry (no food): "correction" meals, including ones logged while Eating Out was still switched on. */
export const isCorrectionOnly = e => !!e && !isNonMealEntry(e) && (e.mealType === "correction" || (!(Number(e.mealDose) > 0) && !(Number(e.totalCarbs) > 0) && Number(e.correctionDose) > 0));
const isEatingOutMeal = e => !!e && !isNonMealEntry(e) && !!e.carbsUnknown && !isCorrectionOnly(e);

/** kcal for an eating-out meal from its units and ratio; null when there's nothing to work it out from. */
export function eatingOutKcalFromInsulin(units, ratio, multiplier) {
  if (!(units > 0) || !(ratio > 0) || !(multiplier > 0)) return null;
  return units * ratio * KCAL_PER_G_CARB * multiplier;
}

/**
 * Map of eating-out meal id -> { kcal, from: "insulin" | "fixed" | null, units, corrUnits, corrections, ratio, carbs }.
 * from null (kcal null) = not counted (no fixed figure set). Each correction belongs to at most one meal: the latest
 * eating-out meal within EATING_OUT_CORRECTION_HOURS before it, with no other meal logged in between.
 */
export function eatingOutEstimates(history, rule) {
  const list = (history || []).filter(e => e && typeof e === "object" && Number.isFinite(Number(e.ts)) && !isNonMealEntry(e))
    .slice().sort((a, b) => Number(a.ts) - Number(b.ts));
  const out = new Map();
  let open = null;   // the eating-out meal corrections are still being added to
  for (const e of list) {
    const ts = Number(e.ts);
    if (open && ts - open.ts > EATING_OUT_CORRECTION_HOURS * 3600000) open = null;
    if (isCorrectionOnly(e)) {
      if (open) { const c = Math.max(0, Number(e.correctionDose) || 0); open.est.corrUnits += c; if (c > 0) open.est.corrections += 1; }
      continue;
    }
    if (isEatingOutMeal(e) && Number(e.knownKcal) > 0) {
      // 2.96.0: calories typed when it was logged (a menu, an app) beat any estimate; later corrections aren't added to it.
      out.set(e.id, { kcal: Math.round(Number(e.knownKcal)), from: "logged", units: Math.max(0, Number(e.mealDose) || 0), corrUnits: 0, corrections: 0, ratio: Number(e.ratioValue) > 0 ? Number(e.ratioValue) : null, carbs: null });
      open = null;
      continue;
    }
    if (isEatingOutMeal(e)) {
      // A reduction for a low reading is meal insulin not taken; a correction for a high one at the time isn't food.
      const units = Math.max(0, (Number(e.mealDose) || 0) + Math.min(0, Number(e.correctionDose) || 0));
      const ratio = Number(e.ratioValue) > 0 ? Number(e.ratioValue) : null;
      const est = { kcal: null, from: null, units, corrUnits: 0, corrections: 0, ratio, carbs: null };
      out.set(e.id, est);
      open = { ts, est };
      continue;
    }
    open = null;   // a meal with its own foods: later corrections are for that one
  }
  for (const est of out.values()) {
    if (est.from === "logged") continue;
    const k = rule.eatingOutMultiplier != null ? eatingOutKcalFromInsulin(est.units + est.corrUnits, est.ratio, rule.eatingOutMultiplier) : null;
    if (k != null) { est.kcal = k; est.from = "insulin"; est.carbs = (est.units + est.corrUnits) * est.ratio; }
    else if (rule.eatingOutKcal != null) { est.kcal = rule.eatingOutKcal; est.from = "fixed"; }
  }
  return out;
}

/**
 * Per local day over the last `days` days (today last): eaten (food + extras) against needed (resting x factor + activity).
 * Returns { days: [...], avg, rule, resting, extras } -- see the fields below. Averages use complete days with a meal logged
 * and no eating-out meal (its calories are unknown); today is left out (still going).
 */
export function calorieSummary(history, settings, { days = 14, now = Date.now() } = {}) {
  const rule = calorieRule(settings && settings.calories, now);
  const extras = extrasKcal(rule);
  const todayStart = dayBounds(now).start;
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const start = shiftDay(now, -i), end = shiftDay(start, 1);
    out.push({ key: start, end, isToday: start === todayStart, food: 0, meals: 0, eatingOut: 0, unknownMeals: 0, assumedKcal: 0, eatingOutMeals: [], mealTypes: new Set(), missingKcal: 0, activity: 0, activities: [], unestimated: 0, later: [], laterKcal: 0, entries: [] });
  }
  const from = out[0].key, to = out[out.length - 1].end;
  const dayOf = ts => out.find(d => ts >= d.key && ts < d.end);
  const eo = eatingOutEstimates(history, rule);
  for (const e of history || []) {
    if (!e || typeof e !== "object") continue;
    const ts = Number(e.ts);
    if (!Number.isFinite(ts)) continue;
    if (e.entryType === "activity") {
      if (ts > now) continue;   // 2.99.0: a workout logged ahead counts once it has started
      const mins = Number(e.durationMin);
      if (!(mins > 0)) continue;
      const aEnd = ts + mins * 60000;
      if (aEnd <= from || ts >= to) continue;
      const k = activityKcal(e, rule.weightKg);
      // An activity crossing midnight gives each day its share.
      for (const d of out) {
        const part = Math.min(aEnd, d.end) - Math.max(ts, d.key);
        if (part <= 0) continue;
        const share = part / (mins * 60000);
        if (k) { d.activity += k.kcal * share; d.activities.push({ id: e.id, kcal: k.kcal * share, from: k.from, minutes: mins * share, entry: e }); }
        else d.unestimated += 1;
      }
      continue;
    }
    if (isNonMealEntry(e)) continue;
    if (ts < from || ts >= to) continue;
    const d = dayOf(ts);
    if (!d) continue;
    if (ts > now) {
      // 2.99.0: a meal logged for later (time set ahead) isn't counted until its time has passed, and doesn't bring in
      // its meal's extras yet; it's listed so the day can say so.
      if (!isCorrectionOnly(e)) {
        const est = e.carbsUnknown ? eo.get(e.id) : null;
        const k = e.carbsUnknown ? (est && est.kcal != null ? est.kcal : 0) : foodKcal(e);
        d.later.push({ id: e.id, ts, kcal: k, mealType: e.mealType });
        d.laterKcal += k;
      }
      continue;
    }
    d.meals += 1;
    if (isCorrectionOnly(e)) continue;   // no food (2.82.0: even one logged with Eating Out on, which used to add a whole meal)
    if (e.carbsUnknown) {
      // Eating out: its foods aren't logged. Worked out from its insulin (2.82.0), else the fixed figure, else unknown.
      d.eatingOut += 1;
      const est = eo.get(e.id);
      if (est && est.kcal != null) { d.food += est.kcal; d.assumedKcal += est.kcal; d.eatingOutMeals.push(est); } else d.unknownMeals += 1;
      d.entries.push({ id: e.id, ts, mealType: e.mealType, kind: "eatout", kcal: est && est.kcal != null ? est.kcal : null, est: est || null });   // 2.100.0: for the day's breakdown
      continue;
    }
    d.food += foodKcal(e);
    d.entries.push({ id: e.id, ts, mealType: e.mealType, kind: e.noInsulin ? "low" : "food", kcal: foodKcal(e), items: (Array.isArray(e.items) ? e.items : []).map(i => ({ name: i && i.name, kcal: Number(i && i.kcal) > 0 ? Number(i.kcal) : 0 })), missing: kcalMissing(e) });
    d.missingKcal += kcalMissing(e);
    if (EXTRA_MEALS.includes(e.mealType)) d.mealTypes.add(e.mealType);   // 2.94.0: meal extras follow the meals logged
  }
  for (const d of out) {
    const rest = restingKcal(rule, d.key);
    d.logged = d.meals > 0;
    // Extras on a day you were logging, at that day's own amounts when you changed them (2.83.0). A day you adjusted
    // counts as logged even with no meal: you said what you had.
    const dx = extrasForDay(rule, dayKeyOf(d.key), d.mealTypes);
    d.extrasAdjusted = dx.adjusted;
    if (dx.adjusted) d.logged = true;
    d.extras = d.logged ? dx.total : 0;
    d.eaten = d.food + d.extras;
    d.resting = rest;
    d.life = rest == null ? null : rest * rule.lifeFactor;
    d.target = d.life == null ? null : d.life + d.activity;
    d.diff = d.target == null || !d.logged ? null : d.eaten - d.target;
  }
  const used = out.filter(d => d.logged && !d.isToday && d.unknownMeals === 0);
  const mean = f => (used.length ? used.reduce((s, d) => s + f(d), 0) / used.length : null);
  const hasTarget = used.length > 0 && used.every(d => d.target != null);
  const avg = {
    daysUsed: used.length,
    daysEatingOut: out.filter(d => d.logged && !d.isToday && d.unknownMeals > 0).length,   // left out: eating out with no assumption
    daysAssumed: used.filter(d => d.eatingOut > 0).length,   // counted with the assumed eating-out kcal
    eaten: mean(d => d.eaten), food: mean(d => d.food), extras: mean(d => d.extras), activity: mean(d => d.activity),
    target: hasTarget ? mean(d => d.target) : null,
    diff: hasTarget ? mean(d => d.diff) : null
  };
  return { days: out, avg, rule, resting: restingKcal(rule, now), extras };
}

/**
 * Today so far, for the slim bar in the dose card (2.79.0; 2.79.1: extras set aside rather than added up front).
 * Returns { eaten, draft, target, needed, extras, activity, logged, fill, draftFill, over } or null without a target.
 * eaten = food logged today only. The daily extras are taken off the target instead (target = what is left for food:
 * resting x everyday moving + activity logged today - extras), because adding all of them at breakfast made the morning
 * read as if the whole day's oil and coffees had already been had. needed = the full day's figure. draftKcal = the meal
 * being put together.
 */
// 2.94.0: every-day extras are set aside from the target as before; meal extras count as eaten once their meal is logged,
// and the ones for the meal being built (draftMealType) join the draft.
export function todayCalories(history, settings, now = Date.now(), draftKcal = 0, draftMealType = null) {
  const s = calorieSummary(history, settings, { days: 1, now });
  const d = s.days[0];
  if (!d || d.target == null || !(d.target > 0)) return null;
  const dayKey = dayKeyOf(now);
  const dx = extrasForDay(s.rule, dayKey, d.mealTypes);
  const draftExtras = Number(draftKcal) > 0 ? mealExtrasKcal(s.rule, dayKey, draftMealType, d.mealTypes) : 0;
  const draft = Math.max(0, Number(draftKcal) || 0) + draftExtras;
  const extras = dx.aside;   // 2.83.0: today's own amounts
  const target = Math.max(0, d.target - extras);
  const eaten = d.food + dx.withMeals;
  const fill = target > 0 ? Math.min(1, eaten / target) : (eaten > 0 ? 1 : 0);
  const withDraft = target > 0 ? Math.min(1, (eaten + draft) / target) : (eaten + draft > 0 ? 1 : 0);
  return { eaten, draft, draftExtras, mealExtras: dx.withMeals, target, needed: d.target, extras, activity: d.activity, logged: d.logged, later: d.later, laterKcal: d.laterKcal, fill, draftFill: withDraft - fill, over: eaten + draft > target };
}

// ---- Daily extras from the food library (2.89.0) ----
/**
 * A daily extra made from a library food or recipe (as the Calculator's pick list describes it: kcalPer100g, unitBased,
 * unitLabel, gramsPerUnit). A food logged by quantity becomes "1 <its unit>" at its kcal per unit; anything else becomes a
 * serving of `grams` g ("15 g"). Returns { name, unit, kcalPerUnit, perDay: 1, noKcal } -- noKcal when the food has no
 * calorie figure (the extra then counts 0 until one is typed).
 */
export function extraFromFood(item, grams) {
  const name = clean(item && item.name, CALORIE_LIMITS.nameMax) || "Food";
  const per100 = Number(item && item.kcalPer100g);
  const noKcal = !(per100 > 0);
  const byUnit = !!(item && item.unitBased && Number(item.gramsPerUnit) > 0);
  const g = byUnit ? Number(item.gramsPerUnit) : Math.max(1, Math.min(2000, Number(grams) || 100));
  const unit = byUnit ? clean(item.unitLabel || "unit", CALORIE_LIMITS.unitMax) : clean(`${Math.round(g * 10) / 10} g`, CALORIE_LIMITS.unitMax);
  const kcal = noKcal ? 0 : Math.round(per100 * g / 100 * 10) / 10;
  return { name, unit, kcalPerUnit: Math.min(CALORIE_LIMITS.kcalPerUnit[1], kcal), perDay: 1, noKcal, byUnit, grams: g };
}

/** The meal types logged on a local day with their foods (not eating out, not corrections): which meal extras apply. */
export function mealTypesForDay(history, dayKey, now = Date.now()) {
  const out = new Set();
  for (const e of history || []) {
    if (!e || !Number.isFinite(Number(e.ts)) || isNonMealEntry(e) || e.carbsUnknown || isCorrectionOnly(e)) continue;
    if (Number(e.ts) > now) continue;   // 2.99.0: not yet
    if (EXTRA_MEALS.includes(e.mealType) && dayKeyOf(Number(e.ts)) === dayKey) out.add(e.mealType);
  }
  return out;
}
