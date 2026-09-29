// Pure calculation core. Nothing in here touches the DOM, localStorage or any
// module-level state -- everything is passed in -- so it can be tested in Node.

import { round1, dayKeyFromTs } from "./util.js";

export const MGDL_PER_MMOL = 18.0182;

export function convertGlucose(value, fromUnit, toUnit) {
  if (fromUnit === toUnit) return value;
  return fromUnit === "mmol" ? value * MGDL_PER_MMOL : value / MGDL_PER_MMOL;
}

// Round a dose to the user's step (0.1 / 0.5 / 1 unit).
export function roundDose(value, rounding) {
  const step = parseFloat(rounding) || 0.5;
  return Math.round((Math.round(value / step) * step) * 100) / 100;
}

// ---------------------------------------------------------------- GI
export function giBand(gi) {
  return gi >= 70 ? "high" : gi >= 56 ? "medium" : "low";
}

// Carb-weighted compound GI: sum(GI x carbs) / sum(carbs) over items that have a GI.
export function compoundGiInfo(items) {
  const withGi = items.filter(i => i.gi != null && i.carbs > 0);
  const totalCarbsWithGi = withGi.reduce((s, i) => s + i.carbs, 0);
  if (withGi.length === 0 || totalCarbsWithGi === 0) return null;
  const weightedSum = withGi.reduce((s, i) => s + i.gi * i.carbs, 0);
  return { value: Math.round(weightedSum / totalCarbsWithGi), partial: withGi.length < items.filter(i => i.carbs > 0).length };
}

// ------------------------------------------------- insulin / carbs on board
// "Scalable exponential" insulin activity model used by Loop / AndroidAPS /
// OpenAPS (Maksimovic, refined by Schwamb). Exactly 1 at t=0, exactly 0 at DIA.
export function iobFraction(minutesAgo, peakMinutes, diaMinutes) {
  if (minutesAgo <= 0) return 1;
  if (minutesAgo >= diaMinutes) return 0;
  const tp = peakMinutes, td = diaMinutes, t = minutesAgo;
  const tau = tp * (1 - tp / td) / (1 - 2 * tp / td);
  const a = 2 * tau / td;
  const S = 1 / (1 - a + (1 + a) * Math.exp(-td / tau));
  return 1 - S * (1 - a) * ((t * t / (tau * td * (1 - a)) - t / tau - 1) * Math.exp(-t / tau) + 1);
}

// Deliberately simple linear absorption.
export function cobGrams(minutesAgo, carbs, absorptionMinutes) {
  if (minutesAgo <= 0) return carbs;
  if (minutesAgo >= absorptionMinutes) return 0;
  return carbs * (1 - minutesAgo / absorptionMinutes);
}

export function absorptionMinutesForEntry(entry, carbAbsorptionMinutes) {
  const m = carbAbsorptionMinutes;
  if (!entry.glycemicLoad) return m.unknown;
  const band = giBand(entry.glycemicLoad.value);
  return m[band];
}

// Stacked IOB/COB at a point in time (`atTime`, ms) across the whole history.
export function activeAt(history, settings, atTime) {
  const now = atTime != null ? atTime : Date.now();
  const dia = settings.insulinModel.diaMinutes;
  const peak = settings.insulinModel.peakMinutes;
  const carbAbs = settings.carbAbsorptionMinutes;
  const maxAbsorption = Math.max(carbAbs.high, carbAbs.medium, carbAbs.low, carbAbs.unknown);

  let iob = 0, cob = 0, iobClearAt = 0, cobClearAt = 0;
  for (const entry of history) {
    const minutesAgo = (now - entry.ts) / 60000;
    if (minutesAgo < 0) continue;
    const totalDose = (entry.mealDose || 0) + (entry.correctionDose || 0);
    if (totalDose > 0 && minutesAgo < dia) {
      iob += totalDose * iobFraction(minutesAgo, peak, dia);
      iobClearAt = Math.max(iobClearAt, entry.ts + dia * 60000);
    }
    if (entry.totalCarbs > 0 && minutesAgo < maxAbsorption) {
      const absorption = absorptionMinutesForEntry(entry, carbAbs);
      if (minutesAgo < absorption) {
        cob += cobGrams(minutesAgo, entry.totalCarbs, absorption);
        cobClearAt = Math.max(cobClearAt, entry.ts + absorption * 60000);
      }
    }
  }
  return {
    iob: Math.round(iob * 10) / 10,
    cob: Math.round(cob),
    iobClearAt: iob > 0.05 ? iobClearAt : null,
    cobClearAt: cob > 0.5 ? cobClearAt : null
  };
}

// ------------------------------------------------------------------- dose
const fmtU = u => String(Math.round(u * 100) / 100);

/**
 * The dose suggestion, as a pure function.
 *   meal       = carbs / ratio
 *   correction = max(0, (glucose - target) / ISF)      [optionally minus IOB]
 *   total      = meal + correction, capped at maxDose, rounded to the user's step
 * Returns the numbers plus human-readable `lines` explaining each step.
 */
export function computeDose({ carbs, ratio, correctionOn, glucose, glucoseUnit, settings, iob = 0, noInsulin = false }) {
  const unitLbl = settings.units === "mmol" ? "mmol/L" : "mg/dL";
  const lines = [];

  const mealPart = ratio && ratio > 0 ? carbs / ratio : 0;
  if (ratio && ratio > 0) lines.push(`Meal: ${round1(carbs)} g ÷ ${ratio} g per unit = ${fmtU(mealPart)} u`);
  else lines.push("Meal: no ratio set, so no meal insulin");

  let rawCorrection = 0, iobSubtracted = 0, correctionPart = 0, correctionApplied = false;
  if (correctionOn) {
    const bg = parseFloat(glucose);
    if (!isNaN(bg) && bg > 0 && settings.isf > 0) {
      correctionApplied = true;
      const bgSettings = convertGlucose(bg, glucoseUnit || settings.units, settings.units);
      rawCorrection = Math.max(0, (bgSettings - settings.target) / settings.isf);
      if (bgSettings <= settings.target) {
        lines.push(`Correction: ${round1(bgSettings)} ${unitLbl} is at or below your ${settings.target} target, so none needed`);
      } else {
        lines.push(`Correction: (${round1(bgSettings)} − ${settings.target}) ÷ ${settings.isf} = ${fmtU(rawCorrection)} u`);
      }
      if (settings.iobAwareCorrection) iobSubtracted = Math.min(rawCorrection, iob);
      correctionPart = rawCorrection - iobSubtracted;
      if (iobSubtracted > 0.05) lines.push(`Minus active insulin: ${fmtU(rawCorrection)} − ${fmtU(iobSubtracted)} = ${fmtU(correctionPart)} u`);
    } else {
      lines.push("Correction is on, but no glucose reading has been entered yet");
    }
  }

  let total = mealPart + correctionPart;
  const totalBeforeCap = total;
  let capped = false;
  if (settings.maxDose > 0 && total > settings.maxDose) { total = settings.maxDose; capped = true; }
  let finalDose = Math.max(0, roundDose(total, settings.rounding));
  let loggedMeal = roundDose(mealPart, settings.rounding);
  let loggedCorrection = roundDose(correctionPart, settings.rounding);

  if (noInsulin) {
    finalDose = 0; loggedMeal = 0; loggedCorrection = 0;
    lines.length = 0;
    lines.push("Treating a low: carbs are logged but no insulin is recorded");
  } else {
    if (mealPart > 0 && correctionPart > 0) lines.push(`Sum: ${fmtU(mealPart)} + ${fmtU(correctionPart)} = ${fmtU(totalBeforeCap)} u`);
    if (capped) lines.push(`Capped at your ${settings.maxDose} u maximum dose`);
    lines.push(`Rounded to the nearest ${settings.rounding} u: ${finalDose.toFixed(1)} u`);
  }

  return { mealPart, rawCorrection, iobSubtracted, correctionPart, correctionApplied, totalBeforeCap, capped, finalDose, loggedMeal, loggedCorrection, lines };
}

// ----------------------------------------------------------------- trends
// "Nice" axis scale: round step (1/2/5 x 10^k) so gridlines land on readable numbers.
export function niceScale(maxVal, targetTicks) {
  if (!(maxVal > 0)) return { max: 1, step: 1 };
  const rough = maxVal / targetTicks;
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const frac = rough / pow;
  const niceFrac = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10;
  const step = niceFrac * pow;
  return { max: Math.ceil(maxVal / step - 1e-9) * step, step };
}

// Day buckets, oldest first. Built with setDate() (not "now minus N x 24h") so
// they stay on true local midnights across daylight-saving changes.
export function buildTrendBuckets(history, days, nowMs = Date.now()) {
  const today = new Date(nowMs);
  today.setHours(0, 0, 0, 0);
  const buckets = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    d.setHours(0, 0, 0, 0);
    buckets.push({ key: d.getTime(), carbs: 0, meal: 0, corr: 0, dose: 0, entries: 0 });
  }
  const byKey = new Map(buckets.map(b => [b.key, b]));
  const inRange = [];
  for (const entry of history) {
    const b = byKey.get(dayKeyFromTs(entry.ts));
    if (!b) continue;
    inRange.push(entry);
    b.entries += 1;
    b.carbs += entry.totalCarbs || 0;
    b.meal += entry.mealDose || 0;
    b.corr += entry.correctionDose || 0;
  }
  buckets.forEach(b => { b.dose = b.meal + b.corr; });
  return { buckets, inRange, todayKey: buckets[buckets.length - 1].key };
}

// Headline numbers for a set of buckets. Averages use complete days with logs:
// today is still in progress and would drag them down (unless it's the only
// day with data, in which case it's used so the numbers aren't blank).
export function summarizeTrends(buckets, inRange, todayKey) {
  let avgBuckets = buckets.filter(b => b.entries > 0 && b.key !== todayKey);
  const usingToday = avgBuckets.length === 0;
  if (usingToday) avgBuckets = buckets.filter(b => b.entries > 0);
  const n = avgBuckets.length || 1;
  const avgCarbs = avgBuckets.reduce((s, b) => s + b.carbs, 0) / n;
  const avgDose = avgBuckets.reduce((s, b) => s + b.dose, 0) / n;

  const regularMeals = inRange.filter(e => e.mealType !== "correction" && !e.noInsulin).length;
  const corrections = inRange.filter(e => (e.correctionDose || 0) > 0).length;
  const lows = inRange.filter(e => e.noInsulin).length;
  const dosed = inRange.filter(e => !e.noInsulin && (e.mealDose || 0) > 0 && (e.totalCarbs || 0) > 0);
  const gUnits = dosed.reduce((s, e) => s + e.mealDose, 0);
  const gPerU = gUnits > 0 ? round1(dosed.reduce((s, e) => s + e.totalCarbs, 0) / gUnits) : null;
  const totalMealIns = inRange.reduce((s, e) => s + (e.mealDose || 0), 0);
  const totalCorrIns = inRange.reduce((s, e) => s + (e.correctionDose || 0), 0);
  const totalIns = totalMealIns + totalCorrIns;
  return {
    avgCarbs, avgDose, avgDays: avgBuckets.length, usingToday, regularMeals, corrections, lows, gPerU,
    totalMealIns, totalCorrIns, totalIns, corrPct: totalIns > 0 ? Math.round((totalCorrIns / totalIns) * 100) : 0
  };
}

// Average carbs / dose / g-per-unit for each regular meal type.
export function mealTypeBreakdown(entries, types = ["breakfast", "lunch", "dinner", "snack"]) {
  return types.map(type => {
    const list = entries.filter(e => e.mealType === type && !e.noInsulin && (e.totalCarbs || 0) > 0);
    if (!list.length) return null;
    const carbs = list.reduce((s, e) => s + (e.totalCarbs || 0), 0);
    const dose = list.reduce((s, e) => s + (e.mealDose || 0) + (e.correctionDose || 0), 0);
    const dosed = list.filter(e => (e.mealDose || 0) > 0);
    const gCarbs = dosed.reduce((s, e) => s + (e.totalCarbs || 0), 0);
    const gUnits = dosed.reduce((s, e) => s + (e.mealDose || 0), 0);
    return { type, count: list.length, avgCarbs: carbs / list.length, avgDose: dose / list.length, gPerU: gUnits > 0 ? gCarbs / gUnits : null };
  }).filter(Boolean);
}

// Nightscout's trend arrows, and a simple in-range/low/high classification for
// coloring the live-glucose pill (fixed clinical thresholds, not user-configurable
// -- this is a cosmetic hint, not a dosing input).
const TREND_ARROWS = {
  DoubleUp: "⇈", SingleUp: "↑", FortyFiveUp: "↗", Flat: "→",
  FortyFiveDown: "↘", SingleDown: "↓", DoubleDown: "⇊"
};
export function glucoseTrendArrow(direction) { return TREND_ARROWS[direction] || ""; }

export function glucoseRangeClass(mgdl, low = 70, high = 180) {
  if (mgdl == null || !Number.isFinite(mgdl)) return null;
  if (mgdl < low) return "low";
  if (mgdl > high) return "high";
  return "in-range";
}

// The label for a LibreLink-style banner, given a range class.
export function glucoseRangeLabel(rangeClass) {
  return rangeClass === "low" ? "GLUCOSE LOW" : rangeClass === "high" ? "GLUCOSE HIGH" : rangeClass === "in-range" ? "GLUCOSE IN RANGE" : "";
}
