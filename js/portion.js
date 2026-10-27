// Portions of a recipe: "1/8", "⅓", "2/3" or "2 slices" as well as plain grams.
//
// A portion is turned into grams of the finished dish (its cooked weight, or this batch's weight when one is entered),
// and from then on everything works on grams exactly as before -- the carbs, the dose (computeDose), the log, Nightscout
// and Apple Health all see an ordinary gram amount. A fraction of the dish always means that fraction of the dish's
// carbs, whatever the batch weighed.
//
// Fractions and slices are only for recipes. Anything that isn't a sensible portion (1/0, 9/8, 0 slices, more slices than
// the dish has) is refused with a plain-English reason, never guessed.

import { parseDecimalInput } from "./util.js";

export const FRACTION_CHIPS = [[1, 2], [1, 3], [1, 4], [1, 6], [1, 8]];
export const WHOLE_CHIP = "Whole";   // the quick button for the whole dish (shown first)
const WHOLE_WORDS = /^(whole|all|intero|intera|tutto|tutta)$/i;
const UNICODE = { "½": [1, 2], "⅓": [1, 3], "⅔": [2, 3], "¼": [1, 4], "¾": [3, 4], "⅕": [1, 5], "⅙": [1, 6], "⅛": [1, 8] };
const SLICE_WORDS = "slices?|sl|fette|fetta|pieces?|pcs?|pz";

const round1 = n => Math.round(n * 10) / 10;
export const fractionLabel = (n, d) => `${n}/${d}`;
export const slicesLabel = n => `${n} slice${n === 1 ? "" : "s"}`;

/**
 * @param {string} text           what was typed (or put there by a chip)
 * @param {object} ctx
 * @param {number|null} ctx.dishWeight   grams of the whole finished dish (null for a plain food)
 * @param {number|null} ctx.slices       how many slices the whole dish is cut into (null if not set)
 * @returns {{ok:true, grams:number, kind:"grams"|"fraction"|"slices", label:string|null, share:number|null}
 *          |{ok:false, empty?:true, error?:string}}
 */
// Upper limits for a typed amount (2.68.4): well above any real portion, low enough to catch a slip before it becomes a dose.
export const MAX_GRAMS = 5000;
export const MAX_QUANTITY = 100;

export function parsePortion(text, { dishWeight = null, slices = null } = {}) {
  const s = String(text ?? "").trim().replace(/\s+/g, " ");
  if (!s) return { ok: false, empty: true };
  const isRecipe = dishWeight > 0;

  // Plain grams, with a decimal point or comma.
  const g = parseDecimalInput(s);
  if (!isNaN(g)) {
    // 2.68.4: an amount that rounds to 0 g ("0,01") is refused like "0" (it was accepted as 0 g), and a slip of the finger
    // like "8000" or "999999" is caught here before it reaches the dose.
    if (!(round1(g) > 0)) return { ok: false, error: "Enter an amount greater than 0." };
    if (g > MAX_GRAMS) return { ok: false, error: `That's more than ${MAX_GRAMS / 1000} kg. Check the amount.` };
    return { ok: true, grams: round1(g), kind: "grams", label: null, share: null };
  }

  // The whole dish: "Whole", "all", "intero".
  if (WHOLE_WORDS.test(s)) {
    if (!isRecipe) return { ok: false, error: "\"Whole\" works for recipes. For this food, enter grams." };
    return { ok: true, grams: round1(dishWeight), kind: "fraction", label: WHOLE_CHIP, share: 1 };
  }

  // A fraction: 1/8, 2 / 3, or a single character like ⅓.
  let frac = null;
  const m = /^(\d+) ?\/ ?(\d+)$/.exec(s);
  if (m) frac = [Number(m[1]), Number(m[2])];
  else if (UNICODE[s]) frac = UNICODE[s];
  if (frac) {
    if (!isRecipe) return { ok: false, error: "Fractions like 1/8 work for recipes. For this food, enter grams." };
    const [n, d] = frac;
    if (d === 0) return { ok: false, error: "A fraction can't divide by 0." };
    if (n === 0) return { ok: false, error: "Enter a portion greater than 0." };
    if (n > d) return { ok: false, error: `${n}/${d} is more than the whole dish. Enter a fraction up to 1 (for example 1/8).` };
    return { ok: true, grams: round1(dishWeight * n / d), kind: "fraction", label: fractionLabel(n, d), share: n / d };
  }

  // Slices: "2 slices", "1 slice", "1,5 slices", "2 fette".
  const sl = new RegExp(`^(\\d+(?:[.,]\\d+)?) ?(?:${SLICE_WORDS})$`, "i").exec(s);
  if (sl) {
    if (!isRecipe) return { ok: false, error: "Slices work for recipes. For this food, enter grams." };
    if (!(slices > 0)) return { ok: false, error: "This recipe has no number of slices yet: set it in the recipe, or use a fraction like 1/8." };
    const n = parseDecimalInput(sl[1]);
    if (!(n > 0)) return { ok: false, error: "Enter at least part of a slice." };
    if (n > slices) return { ok: false, error: `The whole dish is ${slices} slices, so ${sl[1]} is more than all of it.` };
    return { ok: true, grams: round1(dishWeight * n / slices), kind: "slices", label: slicesLabel(n), share: n / slices };
  }

  return { ok: false, error: isRecipe ? "Enter grams, a fraction like 1/8, or slices like 2 slices." : "That isn't a number I can read. Try something like 80 or 80,5." };
}

// ----- Quantities of a food logged by quantity ("1 slice", "1/2 slice", "1 1/2 crackers") -----
// The quick buttons: one whole unit first, then the same fractions as recipes.
export const QUANTITY_WHOLE = "1";
export const QUANTITY_CHIPS = [QUANTITY_WHOLE, ...FRACTION_CHIPS.map(([n, d]) => fractionLabel(n, d))];

/**
 * How many units were typed: "2", "1,5", "1/2", "½", "3/2", "1 1/2" or "1½". A fraction keeps its label ("1/2") so the
 * log can say "1/2 slice" rather than "0.5 slice"; a plain number has no label. Zero, a 0 denominator or anything
 * unreadable is refused with a reason.
 * @returns {{ok:true, quantity:number, label:string|null}|{ok:false, empty?:true, error?:string}}
 */
export function parseQuantity(text) {
  const s = String(text ?? "").trim().replace(/\s+/g, " ");
  if (!s) return { ok: false, empty: true };
  const plain = parseDecimalInput(s);
  if (!isNaN(plain)) {
    if (!(plain > 0)) return { ok: false, error: "Enter a quantity greater than 0." };
    if (plain > MAX_QUANTITY) return { ok: false, error: `That's more than ${MAX_QUANTITY}. Check the number.` };
    return { ok: true, quantity: plain, label: null };
  }
  // Optional whole number, then a fraction written n/d or as one character.
  const m = /^(?:(\d+) ?)?(?:(\d+) ?\/ ?(\d+)|([½⅓⅔¼¾⅕⅙⅛]))$/.exec(s);
  if (!m) return { ok: false, error: "Enter how many, for example 1, 1,5 or 1/2." };
  const whole = m[1] ? Number(m[1]) : 0;
  const [n, d] = m[4] ? UNICODE[m[4]] : [Number(m[2]), Number(m[3])];
  if (d === 0) return { ok: false, error: "A fraction can't divide by 0." };
  const quantity = whole + n / d;
  if (!(quantity > 0)) return { ok: false, error: "Enter a quantity greater than 0." };
  if (quantity > MAX_QUANTITY) return { ok: false, error: `That's more than ${MAX_QUANTITY}. Check the number.` };
  const frac = fractionLabel(n, d);
  return { ok: true, quantity, label: whole ? `${whole} ${frac}` : frac };
}
