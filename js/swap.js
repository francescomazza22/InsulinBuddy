// Swap foods on a meal already dosed for (2.74.0). The insulin is taken, so the carbs it covered are fixed: the person
// changes the foods (more of one, less of another, a new one) and ONE food they pick takes up whatever carbs are left,
// so the total still matches the bolus. No insulin is worked out here: the dose never changes.

/** Carbs in `grams` of an item, from its carbs per 100 g (2 decimals, as the rest of the app stores them). */
export function carbsForGrams(item, grams) {
  if (!item || item.carbsPer100g == null || !Number.isFinite(Number(grams))) return Number(item && item.carbs) || 0;
  return Math.round(Number(item.carbsPer100g) * Math.max(0, Number(grams))) / 100;
}

/** Whether a food can be the one that changes: it must have carbs per 100 g above zero. */
export function canAdjust(item) {
  return !!item && item.carbsPer100g != null && Number(item.carbsPer100g) > 0;
}

/**
 * target: carbs the bolus covered (g). items: [{ name, grams, carbs, carbsPer100g, ... }]. adjustIdx: the food that changes.
 * Returns { items, adjustGrams, others, status, over }:
 *  - status "ok": the adjusting food is set so the total is the target; its carbs are exactly what is left (its grams are
 *    rounded to the nearest gram for weighing, which moves the real carbs by well under 1 g).
 *  - status "over": the other foods already have more carbs than the bolus covered; the adjusting food is 0 g and `over`
 *    says by how much (g carbs) the others need to come down.
 *  - status "none": no food chosen to change, or the chosen one has no carbs to adjust with.
 * The input items are not changed.
 */
export function solveSwap({ target, items, adjustIdx }) {
  const out = items.map(i => ({ ...i }));
  const t = Math.max(0, Number(target) || 0);
  const adj = out[adjustIdx];
  const others = round2(out.reduce((s, it, k) => s + (k === adjustIdx ? 0 : Number(it.carbs) || 0), 0));
  if (!canAdjust(adj)) return { items: out, adjustGrams: null, others, status: "none", over: 0 };
  const left = round2(t - others);
  if (left < 0) {
    setGrams(adj, 0); adj.carbs = 0;
    return { items: out, adjustGrams: 0, others, status: "over", over: round2(-left) };
  }
  const grams = Math.round(left * 100 / Number(adj.carbsPer100g));
  setGrams(adj, grams);
  adj.carbs = left;
  return { items: out, adjustGrams: grams, others, status: "ok", over: 0 };
}

/** Sets an item's grams; a food weighed by count (1/2 a pitta) becomes a plain gram amount once its amount changes. */
export function setGrams(item, grams) {
  item.grams = Math.max(0, Math.round(Number(grams) || 0));
  delete item.quantity; delete item.unitLabel; delete item.portion;
  item.kcal = item.kcalPer100g ? Math.round(Number(item.kcalPer100g) * item.grams) / 100 : (item.kcalPer100g === 0 ? 0 : item.kcal);
  return item;
}

function round2(x) { return Math.round(x * 100) / 100; }
