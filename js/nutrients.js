// Protein, carbs, fat and salt per day against a daily guide (2.102.0). Pure functions; never used for a dose.
//
// Where the figures come from:
//  * a logged food: its library food's protein / fat / salt per 100 g x the grams eaten; carbs as logged on the meal.
//  * a logged recipe: per 100 g of the dish, from its ingredients' library foods (ingredients without a figure count 0
//    and are reported as missing).
//  * an eating-out meal (estimated): carbs from the insulin when its calories came from the insulin, else calories /
//    multiplier / 4; the other calories split 70% fat / 30% protein (a typical restaurant meal); salt 2.5 g per 1,000 kcal.
//  * daily extras: their own per-unit figures (added from the library since 2.102.0), else standard values for the two
//    built-in extras (olive oil, flat white); a hand-typed extra without figures is reported as missing.
// The guide: UK Reference Intakes (adult, 2,000 kcal: fat 70 g, carbohydrate 260 g, protein 50 g, salt 6 g) with fat and
// carbs scaled to the day's calorie need, protein 0.75 g per kg of body weight, salt a 6 g maximum.

import { calorieSummary, extrasForDay, dayKeyOf, calorieRule } from "./calories.js";

export const NUTRIENTS = ["protein", "carbs", "fat", "salt"];
export const UK_RI = { kcal: 2000, protein: 50, carbs: 260, fat: 70, salt: 6 };
export const PROTEIN_G_PER_KG = 0.75;
export const EATING_OUT_SPLIT = { fat: 0.7, protein: 0.3 };   // of the calories that aren't carbs
export const EATING_OUT_SALT_PER_1000_KCAL = 2.5;
// Standard values per unit for the two extras the app starts with (only used when the extra has no figures of its own).
export const BUILTIN_EXTRA_FIGURES = {
  "olive-oil": { refKcal: 119, protein: 0, carbs: 0, fat: 13.5, salt: 0 },        // 1 tbsp
  "flat-white": { refKcal: 110, protein: 6.1, carbs: 8.6, fat: 5.7, salt: 0.2 }   // 1 cup, whole milk
};

const num = v => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const zero = () => ({ protein: 0, carbs: 0, fat: 0, salt: 0 });
const add = (a, b, k = 1) => { for (const n of NUTRIENTS) a[n] += (b[n] || 0) * k; return a; };

/** Per-100 g figures for every library food and recipe: Map "food:<id>" / "recipe:<id>" -> { protein, fat, salt } (null = unknown). */
export function per100Index(library, recipes) {
  const idx = new Map();
  const foods = new Map();
  for (const f of library || []) {
    if (!f || f.id == null) continue;
    const v = { protein: num(f.protein), fat: num(f.fat), salt: num(f.salt), carbs: num(f.carbs) };
    foods.set(f.id, v);
    idx.set(`food:${f.id}`, v);
  }
  for (const r of recipes || []) {
    if (!r || r.id == null || !(Number(r.finalWeight) > 0) || !Array.isArray(r.items)) continue;
    const tot = { protein: 0, fat: 0, salt: 0 }, missing = { protein: 0, fat: 0, salt: 0 };
    for (const it of r.items) {
      const f = it && foods.get(it.foodId);
      const g = Number(it && it.grams) || 0;
      for (const n of ["protein", "fat", "salt"]) {
        if (f && f[n] != null) tot[n] += f[n] * g / 100; else if (g > 0) missing[n] += 1;
      }
    }
    const k = 100 / Number(r.finalWeight);
    idx.set(`recipe:${r.id}`, { protein: tot.protein * k, fat: tot.fat * k, salt: tot.salt * k, missing });
  }
  return idx;
}

/** One logged meal with its foods: { totals, missing: { protein, fat, salt } (items without a figure) }. */
export function mealNutrients(e, idx) {
  const totals = zero(), missing = { protein: 0, fat: 0, salt: 0 };
  totals.carbs = Math.max(0, Number(e && e.totalCarbs) || 0);
  for (const it of (e && Array.isArray(e.items) ? e.items : [])) {
    const g = Number(it && it.grams) || 0;
    if (!(g > 0)) continue;
    const p = idx.get(`${it.refType === "recipe" ? "recipe" : "food"}:${it.refId}`);
    for (const n of ["protein", "fat", "salt"]) {
      if (p && p[n] != null) totals[n] += p[n] * g / 100; else missing[n] += 1;
    }
    if (p && p.missing && (p.missing.protein || p.missing.fat || p.missing.salt)) missing.recipeGaps = (missing.recipeGaps || 0) + 1;
  }
  return { totals, missing };
}

/** An eating-out meal's estimate from its calorie estimate (see calories.js eatingOutEstimates). */
export function eatingOutNutrients(est, multiplier) {
  const kcal = est && Number(est.kcal) > 0 ? Number(est.kcal) : 0;
  if (!kcal) return zero();
  const m = Number(multiplier) > 0 ? Number(multiplier) : 2;
  const carbs = est.from === "insulin" && Number(est.carbs) > 0 ? Number(est.carbs) : kcal / m / 4;
  const rest = Math.max(0, kcal - carbs * 4);
  return { carbs, fat: rest * EATING_OUT_SPLIT.fat / 9, protein: rest * EATING_OUT_SPLIT.protein / 4, salt: kcal / 1000 * EATING_OUT_SALT_PER_1000_KCAL };
}

/** Per-unit figures of an extra: its own, else the built-in standard values, else null (no breakdown). */
export function extraFigures(x) {
  if (x && NUTRIENTS.some(n => num(x[`${n}PerUnit`]) != null)) {
    const o = {}; for (const n of NUTRIENTS) o[n] = num(x[`${n}PerUnit`]) || 0; return o;
  }
  const b = x && BUILTIN_EXTRA_FIGURES[x.id];
  if (b && Number(x.kcalPerUnit) > 0 && Math.abs(Number(x.kcalPerUnit) - b.refKcal) / b.refKcal <= 0.3) return { protein: b.protein, carbs: b.carbs, fat: b.fat, salt: b.salt };
  return null;
}

/** The day's guide: { protein, carbs, fat, salt, scaledTo (kcal), proteinFrom: "weight" | "guide" }. */
export function dailyGuide(rule, needKcal) {
  const kcal = Number(needKcal) > 0 ? Number(needKcal) : UK_RI.kcal;
  const s = kcal / UK_RI.kcal;
  const w = Number(rule && rule.weightKg);
  return { protein: w > 0 ? w * PROTEIN_G_PER_KG : UK_RI.protein, carbs: UK_RI.carbs * s, fat: UK_RI.fat * s, salt: UK_RI.salt, scaledTo: kcal, proteinFrom: w > 0 ? "weight" : "guide" };
}

/**
 * Per day (like calorieSummary, same days and rules: meals logged for later aren't counted yet): totals { protein, carbs,
 * fat, salt }, parts { meals, eatingOut, extras }, guide, estimated (eating out counted), missing { protein, fat, salt
 * (logged foods without a figure), extras (extras without a breakdown), recipeGaps }. avg over complete logged days.
 */
export function nutrientSummary(history, settings, library, recipes, { days = 14, now = Date.now() } = {}) {
  const sum = calorieSummary(history, settings, { days, now });
  const rule = sum.rule;
  const idx = per100Index(library, recipes);
  const byId = new Map((history || []).filter(e => e && e.id != null).map(e => [e.id, e]));
  const out = sum.days.map(d => {
    const parts = { meals: zero(), eatingOut: zero(), extras: zero() };
    const missing = { protein: 0, fat: 0, salt: 0, extras: [], recipeGaps: 0 };
    let estimated = 0;
    for (const x of d.entries) {
      if (x.kind === "eatout") {
        if (x.est && x.est.kcal != null) { add(parts.eatingOut, eatingOutNutrients(x.est, rule.eatingOutMultiplier)); estimated += 1; }
        continue;
      }
      const e = byId.get(x.id);
      if (!e) continue;
      const m = mealNutrients(e, idx);
      add(parts.meals, m.totals);
      for (const n of ["protein", "fat", "salt"]) missing[n] += m.missing[n];
      missing.recipeGaps += m.missing.recipeGaps || 0;
    }
    if (d.logged) {
      const dx = extrasForDay(rule, dayKeyOf(d.key), d.mealTypes);
      for (const it of dx.items) {
        if (!(it.counted > 0)) continue;
        const f = extraFigures(it);
        if (!f) { missing.extras.push(it.name); continue; }
        add(parts.extras, f, it.count * (it.share == null ? 1 : it.share));
      }
    }
    const totals = add(add(add(zero(), parts.meals), parts.eatingOut), parts.extras);
    return { key: d.key, isToday: d.isToday, logged: d.logged, unknownMeals: d.unknownMeals, totals, parts, estimated, missing, guide: dailyGuide(rule, d.target), needKcal: d.target };
  });
  const used = out.filter(d => d.logged && !d.isToday && d.unknownMeals === 0);
  const mean = f => (used.length ? used.reduce((s, d) => s + f(d), 0) / used.length : null);
  const avg = { daysUsed: used.length, daysEstimated: used.filter(d => d.estimated > 0).length, totals: {}, guide: {} };
  for (const n of NUTRIENTS) { avg.totals[n] = mean(d => d.totals[n]); avg.guide[n] = mean(d => d.guide[n]); }
  return { days: out, avg, rule };
}

/** "lower" | "about right" | "higher" for one nutrient against its guide (within 10%: about right; salt: a maximum). */
export function compareToGuide(nutrient, value, guide) {
  if (!(guide > 0) || value == null) return null;
  const r = value / guide;
  if (nutrient === "salt") return r > 1 ? "higher" : "within";
  return r < 0.9 ? "lower" : r > 1.1 ? "higher" : "about right";
}

export { calorieRule };

// ---- Missing figures (2.103.0) ----
// What stops the calorie and nutrient figures being complete, with what you eat most first: library foods without kcal /
// protein / fat / salt (eaten in the last `days` days first, then the rest), recipes whose ingredients lack figures or
// aren't linked to a library food, logged foods that are no longer in the library, and daily extras without a breakdown.
export const CHECKED_FIELDS = ["kcal", "protein", "fat", "salt"];
const blank = v => v == null || v === "" || !Number.isFinite(Number(v));
export function missingReport(history, library, recipes, extras, { days = 30, now = Date.now() } = {}) {
  const from = now - days * 86400000;
  const foods = new Map((library || []).filter(f => f && f.id != null).map(f => [f.id, f]));
  const recs = new Map((recipes || []).filter(r => r && r.id != null).map(r => [r.id, r]));
  const eaten = new Map();     // "food:id" / "recipe:id" -> { times, lastTs, name }
  const gone = new Map();      // logged refs no longer in the library
  for (const e of history || []) {
    const ts = Number(e && e.ts);
    if (!Number.isFinite(ts) || ts < from || ts > now || !Array.isArray(e.items)) continue;
    for (const it of e.items) {
      if (!it || it.refId == null) continue;
      const key = `${it.refType === "recipe" ? "recipe" : "food"}:${it.refId}`;
      const exists = it.refType === "recipe" ? recs.has(it.refId) : foods.has(it.refId);
      const map = exists ? eaten : gone;
      const cur = map.get(key) || { times: 0, lastTs: 0, name: it.name || "", refType: it.refType === "recipe" ? "recipe" : "food", refId: it.refId };
      cur.times += 1; cur.lastTs = Math.max(cur.lastTs, ts); if (!cur.name && it.name) cur.name = it.name;
      map.set(key, cur);
    }
  }
  const foodRows = [];
  for (const f of foods.values()) {
    const missing = CHECKED_FIELDS.filter(k => blank(f[k]));
    if (!missing.length) continue;
    const u = eaten.get(`food:${f.id}`);
    foodRows.push({ id: f.id, name: f.name || "", missing, times: u ? u.times : 0, lastTs: u ? u.lastTs : null });
  }
  const recipeRows = [];
  for (const r of recs.values()) {
    if (!Array.isArray(r.items)) continue;
    const problems = [];
    for (const it of r.items) {
      if (!it) continue;
      if (it.foodId == null) { problems.push({ name: it.name || "", issue: "not linked to a library food" }); continue; }
      const f = foods.get(it.foodId);
      if (!f) { problems.push({ name: it.name || "", issue: "no longer in your library" }); continue; }
      const m = CHECKED_FIELDS.filter(k => blank(f[k]));
      if (m.length) problems.push({ name: f.name || it.name || "", issue: `no ${m.join(", ")}`, foodId: f.id });
    }
    if (!problems.length) continue;
    const u = eaten.get(`recipe:${r.id}`);
    recipeRows.push({ id: r.id, name: r.name || "", problems, times: u ? u.times : 0, lastTs: u ? u.lastTs : null });
  }
  const byUse = (a, b) => b.times - a.times || (b.lastTs || 0) - (a.lastTs || 0) || a.name.localeCompare(b.name);
  foodRows.sort(byUse); recipeRows.sort(byUse);
  const noBreakdown = (extras || []).filter(x => x && !extraFigures(x)).map(x => ({ id: x.id, name: x.name }));
  return {
    eatenFoods: foodRows.filter(r => r.times > 0), otherFoods: foodRows.filter(r => r.times === 0),
    recipes: recipeRows, gone: [...gone.values()].sort(byUse), extras: noBreakdown,
    total: foodRows.length + recipeRows.length + gone.size + noBreakdown.length
  };
}
