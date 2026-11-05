// Recipes and the foods they are made of (2.86.0).
// A recipe keeps its own copy of each ingredient's carbs and kcal per 100 g, so editing a recipe later never changes a
// meal already logged and a deleted food doesn't break the recipe. The cost was silence: when a food's figures were
// corrected in the Library, recipes made with it kept the old ones (Farina was 76 in the Library and 90 in Banana Bread).
// These pure functions find those ingredients and bring them up to date, but only when asked: nothing here runs on its own.
import { recipeTotals } from "./core/library.js";

const num = v => (typeof v === "number" && Number.isFinite(v) ? v : null);
const sameName = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();

/** The library food an ingredient points at, or null (no link, or the food was deleted). */
export function ingredientFood(item, library) {
  if (!item || item.foodId == null) return null;
  return (library || []).find(f => f && f.id === item.foodId) || null;
}

/** Links ingredients with no (or a dead) food link to the library food of exactly the same name (any case), when exactly
 *  one food has that name. Changes only `foodId`, never the figures. Returns how many it linked. */
export function linkIngredients(recipe, library) {
  if (!recipe || !Array.isArray(recipe.items)) return 0;
  let n = 0;
  for (const it of recipe.items) {
    if (!it || typeof it !== "object" || Array.isArray(it)) continue;
    if (ingredientFood(it, library)) continue;
    const name = String(it.name || "").trim();
    if (!name) continue;
    const matches = (library || []).filter(f => f && f.id != null && sameName(f.name, name));
    if (matches.length === 1) { it.foodId = matches[0].id; n++; }
  }
  return n;
}

/** Ingredients whose linked food now has different carbs (more than 0.05 g apart) or kcal per 100 g (more than 0.5 apart,
 *  or kcal known in the Library and not in the recipe). A food that lost its kcal doesn't count: updating would drop it. */
export function staleIngredients(recipe, library) {
  if (!recipe || !Array.isArray(recipe.items)) return [];
  const out = [];
  recipe.items.forEach((it, idx) => {
    if (!it || typeof it !== "object" || Array.isArray(it)) return;
    const f = ingredientFood(it, library);
    if (!f) return;
    const fc = num(f.carbs), fk = num(f.kcal), sc = num(it.carbsPer100g), sk = num(it.kcalPer100g);
    const carbsChanged = fc != null && (sc == null || Math.abs(fc - sc) > 0.05);
    const kcalChanged = fk != null && (sk == null || Math.abs(fk - sk) > 0.5);
    if (!carbsChanged && !kcalChanged) return;
    out.push({ idx, name: it.name || f.name, foodName: f.name, carbsChanged, kcalChanged,
      from: { carbs: sc, kcal: sk }, to: { carbs: carbsChanged ? fc : sc, kcal: kcalChanged ? fk : sk } });
  });
  return out;
}

/** A copy of the ingredient list with the given stale ingredients brought up to the Library's figures.
 *  Grams, names and links stay as they are. */
export function refreshIngredients(items, stale) {
  const byIdx = new Map((stale || []).map(s => [s.idx, s]));
  return (items || []).map((it, idx) => {
    const s = byIdx.get(idx);
    if (!s) return { ...it };
    return { ...it, carbsPer100g: s.to.carbs, kcalPer100g: s.to.kcal };
  });
}

/** What updating would do to the whole dish: totals before and after (carbs per 100 g needs a final weight). */
export function refreshEffect(recipe, stale, library) {
  const before = recipeTotals(recipe, library);
  const after = recipeTotals({ ...recipe, items: refreshIngredients(recipe.items, stale) }, library);
  return { before, after };
}

/** Recipes that use a food (by link). */
export function recipesUsingFood(recipes, foodId) {
  return (recipes || []).filter(r => r && Array.isArray(r.items) && r.items.some(it => it && it.foodId === foodId));
}

/** "Farina: carbs 90 → 78 g per 100 g" / "…, kcal 350 → 369" for one stale ingredient. */
export function staleText(s) {
  const parts = [];
  const show = v => (v == null ? "not set" : String(Math.round(v * 10) / 10));
  if (s.carbsChanged) parts.push(`carbs ${show(s.from.carbs)} → ${show(s.to.carbs)} g`);
  if (s.kcalChanged) parts.push(`kcal ${show(s.from.kcal)} → ${show(s.to.kcal)}`);
  return `${s.name}: ${parts.join(", ")} per 100 g`;
}
