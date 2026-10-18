// A gentle second opinion on a dose, never a block: it compares today's dose with what you actually took before.
// Pure and cheap (no timers, no DOM): the caller runs it only when the dose is recalculated, and the history is reduced
// to a small list once and reused until the history changes, so typing never rescans everything.

const DAY = 86400000;
export const SANITY_WINDOW_DAYS = 90;

/** Compact, recent, insulin-carrying meals: [{ carbs, meal, total }]. */
export function sanityPool(history, now) {
  const since = now - SANITY_WINDOW_DAYS * DAY, out = [];
  for (const e of history || []) {
    if (!e || e.entryType === "basal" || e.noInsulin || typeof e.ts !== "number" || e.ts < since || e.ts > now) continue;
    const meal = Number(e.mealDose) || 0, corr = Number(e.correctionDose) || 0, total = meal + corr;
    if (!(total > 0)) continue;
    out.push({ carbs: e.carbsUnknown ? 0 : Number(e.totalCarbs) || 0, meal, total });
  }
  return out;
}

const median = a => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const r1 = v => Math.round(v * 10) / 10;

/**
 * @param pool    from sanityPool
 * @param dose    { carbs, mealDose, finalDose }  today's dose
 * @returns null when nothing looks odd, else { kind: "big" | "larger" | "smaller", text }
 */
export function doseSanity(pool, { carbs, mealDose, finalDose }) {
  if (!Array.isArray(pool) || pool.length < 10 || !(finalDose >= 1)) return null;
  const biggest = Math.max(...pool.map(p => p.total));
  if (finalDose >= biggest * 1.3 && finalDose - biggest >= 2) {
    return { kind: "big", text: `${r1(finalDose)} u is bigger than any dose in the last ${SANITY_WINDOW_DAYS} days (your largest was ${r1(biggest)} u). Worth a quick check.` };
  }
  if (carbs >= 8 && mealDose >= 1) {
    const like = pool.filter(p => p.carbs > 0 && p.meal > 0 && Math.abs(p.carbs - carbs) <= carbs * 0.25);
    if (like.length >= 4) {
      const usual = median(like.map(p => p.meal)), diff = mealDose - usual;
      if (diff >= 2 && mealDose >= usual * 1.5) return { kind: "larger", text: `Meals around ${Math.round(carbs)} g carbs have usually been about ${r1(usual)} u (${like.length} recent). This one is ${r1(mealDose)} u.` };
      if (-diff >= 2 && mealDose <= usual * 0.5) return { kind: "smaller", text: `Meals around ${Math.round(carbs)} g carbs have usually been about ${r1(usual)} u (${like.length} recent). This one is ${r1(mealDose)} u.` };
    }
  }
  return null;
}
