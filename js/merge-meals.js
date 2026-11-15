// Merging logged meals into one (2.105.0). Pure: no DOM, no app state.
//
// What a merged meal is: the foods of every meal, at the time of the EARLIEST one, with the insulin that was actually
// taken added up. Nothing is recalculated: each dose was already given, so the totals are simply what went in.
// The meals it was made from are kept in `mergedFrom` (full copies) so that:
//   - Nightscout keeps the separate records it already has, at their real times (so Gluroo's active insulin stays right);
//     deleting the merged meal later removes those records, and undoing that delete puts them back;
//   - a merge of a merged meal keeps the flat list of the originals.
import { round1 } from "./util.js";
import { compoundGiInfo } from "./calc.js";

const isMeal = e => !!e && e.entryType !== "basal" && e.entryType !== "activity" && e.mealType !== "basal" && e.mealType !== "activity";
const r2 = v => Math.round(v * 100) / 100;

/** Why these entries can't be merged, in plain English, or null when they can. */
export function mergeBlockReason(entries) {
  const list = (entries || []).filter(Boolean);
  if (list.length < 2) return "Pick at least two meals to merge.";
  if (list.some(e => !isMeal(e))) return "Only meals can be merged, not basal doses or activities.";
  if (list.some(e => e.carbsUnknown)) return "An eating-out meal has no carbs counted, so it can't be merged with others.";
  const lows = list.filter(e => e.noInsulin).length;
  if (lows && lows !== list.length) return "A treated low (no insulin) can only be merged with other treated lows.";
  if (new Set(list.map(e => e.id)).size !== list.length) return "The same meal was picked twice.";
  return null;
}

// Same food (or recipe) logged the same way: one row with the amounts added up.
function itemKey(i) {
  const unit = i.quantity != null && i.unitLabel ? `q:${i.unitLabel}` : "g";
  return `${i.refType || ""}|${i.refId || ""}|${String(i.name || "").trim().toLowerCase()}|${unit}`;
}
function combineItems(lists) {
  const out = [], byKey = new Map();
  for (const items of lists) for (const it of items || []) {
    const k = itemKey(it), prev = byKey.get(k);
    if (!prev) { const copy = { ...it }; byKey.set(k, copy); out.push(copy); continue; }
    prev.grams = r2((Number(prev.grams) || 0) + (Number(it.grams) || 0));
    prev.carbs = (Number(prev.carbs) || 0) + (Number(it.carbs) || 0);
    prev.kcal = (Number(prev.kcal) || 0) + (Number(it.kcal) || 0);
    if (prev.quantity != null) prev.quantity = (Number(prev.quantity) || 0) + (Number(it.quantity) || 0);
    delete prev.portion;   // "1/3" + "1/3" is no longer a single portion; the quantity says how much
  }
  return out;
}

/** The originals behind an entry: its own `mergedFrom` list if it is a merged meal, else just itself. */
export function mergeSources(entry) {
  return entry && Array.isArray(entry.mergedFrom) && entry.mergedFrom.length ? entry.mergedFrom : [entry];
}

/** One meal from several. `id` is the new entry's id. Call mergeBlockReason first. */
export function mergeMeals(entries, { id }) {
  const list = entries.slice().sort((a, b) => a.ts - b.ts);
  const first = list[0];
  // The ratio shown is the one used for the earliest meal that applied one (they are usually the same).
  const withRatio = list.find(e => Number(e.ratioValue) > 0 && Number(e.mealDose) > 0 && (e.items || []).length) || first;
  const food = list.find(e => e.mealType !== "correction" && (e.items || []).length);
  const items = combineItems(list.map(e => e.items));
  const sum = k => r2(list.reduce((s, e) => s + (Number(e[k]) || 0), 0));
  const extra = sum("extraDose");
  const sources = [];
  for (const e of list) for (const s of mergeSources(e)) sources.push(s);
  return {
    id,
    ts: first.ts,
    mealType: (food || first).mealType,
    periodName: withRatio.periodName || "",
    items,
    totalCarbs: round1(items.reduce((s, i) => s + (Number(i.carbs) || 0), 0)),
    totalKcal: Math.round(items.reduce((s, i) => s + (Number(i.kcal) || 0), 0)),
    glycemicLoad: items.length ? compoundGiInfo(items) : null,
    carbsUnknown: false,
    mealDose: sum("mealDose"),
    correctionDose: sum("correctionDose"),
    ...(extra ? { extraDose: extra } : {}),
    noInsulin: list.every(e => e.noInsulin),
    glucose: first.glucose ?? null,   // the reading before the first part of the meal
    ratioLabel: withRatio.ratioLabel || "",
    ratioValue: withRatio.ratioValue ?? null,
    mergedFrom: sources
  };
}
