// Words on the Calculator (2.81.0): the dose-mode chip and the Log button. Pure, so they can be tested without the page.
// Nothing here works out a dose: the Log button only repeats the dose planDose already gave.

/** The chip that opens Correction / Treating a low / Eating out. */
export function modeChipLabel({ correctionOn = false, noInsulinOn = false, eatingOutOn = false, extraOn = false, hasFood = false } = {}) {
  const base = noInsulinOn ? "Treating a low" : eatingOutOn ? "Eating out" : null;
  // A dose changed by hand (2.84.0 extra, 2.85.0 − / +) doesn't change the words (the chip is lit and the line under the dose
  // says it), so the chip keeps its width and the − / + beside the number don't get pushed onto another line.
  void extraOn;
  if (correctionOn) return base ? `${base} + correction` : hasFood ? "Meal + correction" : "Correction";
  return base || "Meal";
}

const u2 = v => Math.round((Number(v) || 0) * 100) / 100;

/**
 * The line under the dose that shows the parts it is made of, or null when there is only one part.
 * mealDose / correctionDose are the saved parts; the extra (2.84.0) is inside the meal dose (extraInMeal) or, with no meal
 * part, inside the correction dose, and is taken out of it here so each part is shown once: "Meal 3 u + extra 1 u".
 */
export function doseBreakdownText({ mealDose = 0, correctionDose = 0, extraDose = 0, extraInMeal = true, noInsulin = false } = {}) {
  if (noInsulin) return null;
  const x = u2(extraDose);
  // A positive extra is inside the meal dose (extraInMeal) or the correction dose; an amount taken off is always in the correction.
  const meal = u2(mealDose - (x > 0 && extraInMeal ? x : 0));
  const corr = u2(correctionDose - (x < 0 || (x > 0 && !extraInMeal) ? x : 0));
  const parts = [];
  if (meal > 0) parts.push(`Meal ${meal} u`);
  if (corr > 0) parts.push(parts.length ? `correction ${corr} u` : `Correction ${corr} u`);
  let text = parts.join(" + ");
  if (corr < 0) text += `${text ? " " : "Meal 0 u "}\u2212 ${Math.abs(corr)} u taken off`;
  if (x > 0) text += text ? ` + ${x} u extra` : `${x} u extra`;
  if (x < 0) text += `${text ? " " : ""}\u2212 ${Math.abs(x)} u less`;
  const pieces = (meal > 0) + (corr !== 0) + (x !== 0);
  return pieces >= 2 || corr < 0 ? text : null;
}

/** A dose as the big number would show it, but never hiding a second decimal (0.05 u rounding): 2.0, 2.5, 2.45. */
export function doseText(units) {
  const n = Math.round((Number(units) || 0) * 100) / 100;
  return n.toFixed(Math.round(n * 100) % 10 ? 2 : 1);
}

const carbsText = c => `${Math.round((Number(c) || 0) * 10) / 10}g carbs`;

/**
 * The Log button says what it will log, so the figure can be checked without looking back up.
 * hasDose: planDose's hasDose (something to log). empty: nothing in the meal and no mode on.
 */
export function logButtonLabel({ hasDose, empty, noInsulinOn, eatingOutOn, finalDose, carbs }) {
  if (!hasDose) return empty ? "Add food to log a meal" : noInsulinOn ? "Add the carbs you had" : "Log Meal to History";
  if (noInsulinOn) return `Log treated low · ${carbsText(carbs)}`;
  const u = `${doseText(finalDose)} u`;
  if (eatingOutOn) return `Log ${u} · eating out`;
  if (Number(carbs) > 0) return `Log ${u} · ${carbsText(carbs)}`;
  return `Log ${u} correction`;
}
