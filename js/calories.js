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
    perDay: per == null ? 0 : Math.round(per * 100) / 100
  };
}

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
    extras
  };
}

// 2.83.0 let each day have its own extras (dayExtras); 2.90.0 took that out again at Francesco's request ("convoluted to
// manage on a daily basis"): every logged day gets the usual amounts. A stored dayExtras is ignored and dropped on save.

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
    out.push({ key: start, end, isToday: start === todayStart, food: 0, meals: 0, eatingOut: 0, unknownMeals: 0, assumedKcal: 0, eatingOutMeals: [], missingKcal: 0, activity: 0, activities: [], unestimated: 0 });
  }
  const from = out[0].key, to = out[out.length - 1].end;
  const dayOf = ts => out.find(d => ts >= d.key && ts < d.end);
  const eo = eatingOutEstimates(history, rule);
  for (const e of history || []) {
    if (!e || typeof e !== "object") continue;
    const ts = Number(e.ts);
    if (!Number.isFinite(ts)) continue;
    if (e.entryType === "activity") {
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
    d.meals += 1;
    if (isCorrectionOnly(e)) continue;   // no food (2.82.0: even one logged with Eating Out on, which used to add a whole meal)
    if (e.carbsUnknown) {
      // Eating out: its foods aren't logged. Worked out from its insulin (2.82.0), else the fixed figure, else unknown.
      d.eatingOut += 1;
      const est = eo.get(e.id);
      if (est && est.kcal != null) { d.food += est.kcal; d.assumedKcal += est.kcal; d.eatingOutMeals.push(est); } else d.unknownMeals += 1;
      continue;
    }
    d.food += foodKcal(e);
    d.missingKcal += kcalMissing(e);
  }
  for (const d of out) {
    const rest = restingKcal(rule, d.key);
    d.logged = d.meals > 0;
    d.extras = d.logged ? extras.total : 0;   // the usual amounts, on every day you logged a meal
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
export function todayCalories(history, settings, now = Date.now(), draftKcal = 0) {
  const s = calorieSummary(history, settings, { days: 1, now });
  const d = s.days[0];
  if (!d || d.target == null || !(d.target > 0)) return null;
  const draft = Math.max(0, Number(draftKcal) || 0);
  const extras = s.extras.total;
  const target = Math.max(0, d.target - extras);
  const eaten = d.food;
  const fill = target > 0 ? Math.min(1, eaten / target) : (eaten > 0 ? 1 : 0);
  const withDraft = target > 0 ? Math.min(1, (eaten + draft) / target) : (eaten + draft > 0 ? 1 : 0);
  return { eaten, draft, target, needed: d.target, extras, activity: d.activity, logged: d.logged, fill, draftFill: withDraft - fill, over: eaten + draft > target };
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
