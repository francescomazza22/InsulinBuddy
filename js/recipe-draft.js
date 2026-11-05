// Recipe autosave (2.84.0). The recipe sheet saves as you go: every change that leaves a complete recipe is written to the
// library straight away, and a recipe that isn't complete yet (no final weight, an empty amount) is kept as a draft on the
// device so closing the sheet, or iOS closing the app, never loses the amounts being tried. Pure: no DOM, no app state.
import { parseDecimalInput } from "./util.js";

export const RECIPE_DRAFT_KEY = "insulinBuddy.recipeDraft";
export const RECIPE_AUTOSAVE_MS = 600;                 // saved this long after the last keystroke (and at once on close)
export const RECIPE_DRAFT_TTL = 30 * 24 * 3600000;   // an abandoned draft is dropped after 30 days

/**
 * Reads the sheet's fields into a recipe payload, or says why it isn't a complete recipe yet.
 *   form: { name, category, notes, favorite, rawText, finalText, slicesText } (strings as typed), items: ingredient rows.
 * Returns { payload, problem }: payload is null whenever problem is set. The messages are the ones the Save button showed.
 */
export function readRecipeForm(form, items) {
  const name = String(form.name || "").trim();
  const rawText = String(form.rawText || "").trim();
  const finalWeight = parseDecimalInput(String(form.finalText || "").trim());
  const rawWeight = rawText ? parseDecimalInput(rawText) : null;
  const slicesText = String(form.slicesText || "").trim();
  const slices = slicesText ? parseDecimalInput(slicesText) : null;
  const list = Array.isArray(items) ? items : [];
  let problem = null;
  if (!name) problem = "Give the recipe a name.";
  else if (list.length === 0) problem = "Add at least one ingredient.";
  else if (list.some(i => !(i.grams > 0))) problem = "Every ingredient needs an amount in grams (or remove it).";
  else if (slicesText && !(Number.isInteger(slices) && slices >= 1 && slices <= 200)) problem = "Slices should be a whole number, like 8 or 12 — or leave it empty.";
  else if (rawText && !(rawWeight > 0)) problem = "Raw Weight isn't a number I can read. Try something like 653 or 653,5, or leave it empty.";
  else if (!(finalWeight > 0)) problem = "Final Weight is required — it's the total weight of the finished dish, used to work out carbs per 100g.";
  if (problem) return { payload: null, problem };
  return {
    problem: null,
    payload: {
      name,
      category: form.category || "other",
      notes: String(form.notes || "").trim(),
      favorite: !!form.favorite,
      items: list.map(i => ({ ...i })),
      rawWeight: rawWeight || null,
      slices: slices || null,
      finalWeight
    }
  };
}

// The parts of a recipe the sheet edits, in a fixed shape, so "did anything change?" is a string comparison.
export function recipeFingerprint(r) {
  if (!r) return "";
  return JSON.stringify({
    name: r.name || "", category: r.category || "other", notes: r.notes || "", favorite: !!r.favorite,
    // 2.86.0: the per-100 g figures count too, so updating an ingredient to the Library's figures is saved (and undoable).
    items: (r.items || []).map(i => [i.foodId || "", i.name || "", Number(i.grams) || 0, i.carbsPer100g ?? null, i.kcalPer100g ?? null]),
    rawWeight: r.rawWeight || null, slices: r.slices || null, finalWeight: Number(r.finalWeight) || 0
  });
}

// A form worth keeping as a draft: anything typed at all.
export function formHasContent(form, items) {
  return (Array.isArray(items) && items.length > 0) ||
    ["name", "notes", "rawText", "finalText", "slicesText"].some(k => String(form[k] || "").trim() !== "");
}

// Draft as stored: { recipeId (null = a new recipe), form, items, at }. Anything malformed or stale reads as no draft.
export function parseRecipeDraft(text, now = Date.now()) {
  let d;
  try { d = JSON.parse(text); } catch (e) { return null; }
  if (!d || typeof d !== "object" || !d.form || typeof d.form !== "object" || !Array.isArray(d.items)) return null;
  if (!(Number(d.at) > 0) || now - Number(d.at) > RECIPE_DRAFT_TTL) return null;
  const items = d.items.filter(i => i && typeof i === "object" && typeof i.name === "string").map(i => ({
    foodId: typeof i.foodId === "string" ? i.foodId : "", name: i.name,
    grams: Number(i.grams) > 0 ? Number(i.grams) : 0,
    carbsPer100g: Number(i.carbsPer100g) || 0,
    kcalPer100g: i.kcalPer100g == null ? null : Number(i.kcalPer100g)
  }));
  const f = d.form, s = v => (typeof v === "string" ? v : v == null ? "" : String(v));
  return {
    recipeId: typeof d.recipeId === "string" ? d.recipeId : null,
    form: { name: s(f.name), category: s(f.category) || "other", notes: s(f.notes), favorite: !!f.favorite, rawText: s(f.rawText), finalText: s(f.finalText), slicesText: s(f.slicesText) },
    items,
    at: Number(d.at)
  };
}
