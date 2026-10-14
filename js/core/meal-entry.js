// Builds the history record for a logged meal, and keeps food/recipe usage counts in step. No DOM, no app state.
import { round1, } from "../util.js";
import { compoundGiInfo } from "../calc.js";

// input: { now:Date, mealType, periodEntry, ratioEntry, items, eatingOut, noInsulin, computed, glucoseVal }
export function buildMealEntry({ now, mealType, periodEntry, ratioEntry, items, eatingOut, noInsulin, computed, glucoseVal }) {
  const kept = eatingOut ? [] : items;   // Eating Out saves no item list: its carbs were never counted
  return {
    id: "h-" + now.getTime(),
    ts: now.getTime(),
    mealType,
    periodName: periodEntry ? periodEntry.name.toLowerCase() : "",
    items: kept.map(i => ({
      refType: i.refType, refId: i.refId, name: i.name, grams: i.grams,
      quantity: i.quantity ?? null, unitLabel: i.unitLabel ?? null, gramsPerUnit: i.gramsPerUnit ?? null,
      gi: i.gi ?? null,
      carbsPer100g: i.carbsPer100g, kcalPer100g: i.kcalPer100g,
      carbs: i.carbs, kcal: i.kcal
    })),
    totalCarbs: eatingOut ? 0 : round1(items.reduce((s, i) => s + i.carbs, 0)),
    totalKcal: eatingOut ? 0 : Math.round(items.reduce((s, i) => s + (i.kcal || 0), 0)),
    glycemicLoad: eatingOut ? null : compoundGiInfo(items),
    carbsUnknown: !!eatingOut,
    mealDose: computed.mealDose,
    correctionDose: computed.correctionDose,
    ...(computed.capped ? { cappedFrom: computed.requested } : {}),   // what it calculated before the cap
    noInsulin: !!noInsulin,
    glucose: glucoseVal,
    ratioLabel: ratioEntry ? ratioEntry.name : "",
    ratioValue: ratioEntry ? ratioEntry.ratio : null
  };
}

// delta +1 when a meal is logged, -1 when it is undone.
export function adjustUsage(library, recipes, refs, delta) {
  refs.forEach(u => {
    const f = u.refType === "food" ? library.find(x => x.id === u.refId) : recipes.find(x => x.id === u.refId);
    if (!f) return;
    if (delta < 0) { if (f.usageCount > 0) f.usageCount -= 1; }
    else f.usageCount = (f.usageCount || 0) + 1;
  });
}
