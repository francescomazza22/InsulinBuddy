// Words on the Calculator (2.81.0): the dose-mode chip and the Log button. Pure, so they can be tested without the page.
// Nothing here works out a dose: the Log button only repeats the dose planDose already gave.

/** The chip that opens Correction / Treating a low / Eating out. */
export function modeChipLabel({ correctionOn = false, noInsulinOn = false, eatingOutOn = false, hasFood = false } = {}) {
  const base = noInsulinOn ? "Treating a low" : eatingOutOn ? "Eating out" : null;
  if (correctionOn) return base ? `${base} + correction` : hasFood ? "Meal + correction" : "Correction";
  return base || "Meal";
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
