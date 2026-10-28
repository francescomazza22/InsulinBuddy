// Pure calculation core. Nothing in here touches the DOM, localStorage or any
// module-level state -- everything is passed in -- so it can be tested in Node.

import { round1, dayKeyFromTs, parseDecimalInput } from "./util.js";

export const MGDL_PER_MMOL = 18.0182;

export function convertGlucose(value, fromUnit, toUnit) {
  if (fromUnit === toUnit) return value;
  return fromUnit === "mmol" ? value * MGDL_PER_MMOL : value / MGDL_PER_MMOL;
}

// Carries a dosing setting (target glucose, or "1 unit lowers glucose by") across a glucose-unit switch so the same
// physiology stays in force: 100 mg/dL becomes 5.6 mmol/L, never "100 mmol/L". mmol/L keeps one decimal, mg/dL whole numbers.
export function convertDosingSetting(value, fromUnit, toUnit) {
  if (!Number.isFinite(value) || fromUnit === toUnit) return value;
  const c = convertGlucose(value, fromUnit, toUnit);
  return toUnit === "mmol" ? Math.max(0.1, Math.round(c * 10) / 10) : Math.max(1, Math.round(c));
}

// Round a dose to the user's step (0.1 / 0.5 / 1 unit).
export function roundDose(value, rounding) {
  const step = parseFloat(rounding) || 0.5;
  return Math.round((Math.round(value / step) * step) * 100) / 100;
}

// The same for a correction that may take insulin OFF the meal. A negative value is rounded as its positive twin and
// given the sign back, so -0.25 u and +0.25 u round the same distance (JavaScript's Math.round would round -0.5 up to -0
// but +0.5 up to 1). On an exact half-step the reduction goes the larger way, which is the safer side of a low.
export function roundSignedDose(value, rounding) {
  const r = roundDose(Math.abs(value), rounding);
  return value < 0 ? (r === 0 ? 0 : -r) : r;
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
const round2 = x => Math.round(x * 100) / 100;

/**
 * Applies the maximum-dose cap to a meal part and a correction part that have each ALREADY been rounded,
 * and returns the parts to show, log and send onward.
 *
 * Why this returns PARTS, not just a capped total: the number on the calculator, the saved entry, the edit
 * preview and what goes to Nightscout and Apple Health must all be built from the same numbers. Capping only
 * the displayed total left the saved parts uncapped -- the card said 15u while the log said 19.5u, which also
 * overstates active insulin for the next six hours.
 *
 *   calculated parts: when over the limit, the correction gives way first, then the meal.
 *   typed parts (`typed: true`): never altered. A dose the person typed is a record of what they decided, so
 *     the app doesn't quietly change it; it reports `overMax` so the caller can warn instead.
 *
 * `maxDose` of 0 / missing / negative means no cap.
 */
export function capDoseParts({ meal = 0, correction = 0, maxDose = 0, typed = false } = {}) {
  const m = Math.max(0, Number(meal) || 0), c = Math.max(0, Number(correction) || 0);
  const requested = round2(m + c);
  const limit = maxDose > 0 ? maxDose : Infinity;
  if (requested <= limit) return { meal: m, correction: c, total: requested, requested, capped: false, overMax: false };
  if (typed) return { meal: m, correction: c, total: requested, requested, capped: false, overMax: true };
  const keptMeal = Math.min(m, limit);
  const keptCorrection = round2(Math.max(0, limit - keptMeal));
  return { meal: keptMeal, correction: keptCorrection, total: round2(keptMeal + keptCorrection), requested, capped: true, overMax: false };
}

const round2d = v => Math.round(v * 100) / 100;

/**
 * THE one place a dose is worked out. The calculator screen, the edit-meal sheet and computeDose's step-by-step text all call
 * this, so the number on screen and the number saved can never come from different maths.
 *
 *   carbs                 grams counted (0 for Eating Out)
 *   ratio                 grams of carb per unit; none/0 means no meal insulin
 *   mealUnits             a meal dose typed by hand (Eating Out), or null. Used as typed, never altered.
 *   mealTyped             default true when mealUnits is given; false = still subject to the maximum-dose cap
 *   correction            "off" | "auto" (from glucose) | "manual" (typed)
 *   glucose, glucoseUnit  the reading for "auto" (glucoseUnit falls back to the Settings unit)
 *   correctionUnits       the typed dose for "manual"
 *   correctionTyped       default true for "manual"; false = still subject to the maximum-dose cap
 *   iob                   insulin on board, only subtracted when settings.iobAwareCorrection is on
 *   noInsulin             treating a low: carbs logged, zero insulin
 *   settings              { units, isf, target, rounding, maxDose, iobAwareCorrection }
 */
export function planDose({ carbs = 0, ratio = 0, mealUnits = null, mealTyped, correctionTyped, correction = "off", glucose, glucoseUnit, correctionUnits, iob = 0, noInsulin = false, settings }) {
  const mealIsManual = mealUnits != null;
  let mealPart = ratio && ratio > 0 ? carbs / ratio : 0;
  if (mealIsManual) mealPart = mealUnits > 0 ? mealUnits : 0;

  let rawCorrection = 0, iobSubtracted = 0, correctionPart = 0, correctionApplied = false, correctionIsManual = false, bgInSettingsUnit = null;
  if (correction === "manual") {
    // Signed: positive adds to the meal dose, negative takes insulin off it. (The screen types the size and picks Add or Subtract.)
    if (Number.isFinite(correctionUnits) && correctionUnits !== 0) { correctionPart = correctionUnits; correctionIsManual = true; }
  } else if (correction === "auto") {
    // Typed text is read like every dose box (2.68.4): "7,5" is 7.5, and anything that isn't a plain positive number
    // ("1e3", "7,5,1", "-5") is no reading at all. parseFloat used to read "7,5" as 7 and "1e3" as 1000.
    const bg = typeof glucose === "number" ? glucose : parseDecimalInput(glucose);
    if (!isNaN(bg) && bg > 0 && settings.isf > 0) {
      correctionApplied = true;
      bgInSettingsUnit = convertGlucose(bg, glucoseUnit || settings.units, settings.units);
      const gap = (bgInSettingsUnit - settings.target) / settings.isf;
      // Below target the correction is zero, unless the person has asked for the meal dose to come down when glucose is low
      // (settings.reduceBelowTarget). A reduction is never reduced further by insulin on board: that only offsets a positive one.
      rawCorrection = gap >= 0 ? gap : (settings.reduceBelowTarget ? gap : 0);
      if (rawCorrection > 0 && settings.iobAwareCorrection) iobSubtracted = Math.min(rawCorrection, iob);
      correctionPart = rawCorrection - iobSubtracted;
    }
  }

  // Round each part first, then add the already-rounded numbers: rounding the raw sum can disagree with the parts shown
  // (a 3.15u meal shown as 3u plus a 0.7u correction shown as 0.5u is 3.5u, not the 4u that rounding 3.85 gives).
  // Typed doses are used exactly as typed (to 2 decimals), since choosing to type one is a precise decision.
  let mealDose = mealIsManual ? round2d(mealPart) : roundDose(mealPart, settings.rounding);
  let correctionDose = correctionIsManual ? round2d(correctionPart) : roundSignedDose(correctionPart, settings.rounding);
  // A reduction (negative correction) is set aside while the cap is applied: the cap is a ceiling on what is ADDED, and a
  // low reading should still take insulin off the capped meal rather than be swallowed by it. It is put back afterwards.
  const reduction = correctionDose < 0 ? correctionDose : 0;
  if (reduction < 0) correctionDose = 0;
  // The cap has to reduce the PARTS (the entry is saved from them), never just the number on screen. A typed dose is never altered.
  const typed = (mealIsManual && mealTyped !== false) || (correctionIsManual && correctionTyped !== false && reduction === 0);
  const cap = capDoseParts({ meal: mealDose, correction: correctionDose, maxDose: settings.maxDose, typed });
  mealDose = cap.meal; correctionDose = cap.correction;
  // The reduction can take the dose to zero but never below it: it is limited to the meal dose that is there.
  const reductionLimited = reduction < 0 && -reduction > mealDose + 1e-9;
  if (reduction < 0) correctionDose = round2d(Math.max(reduction, -mealDose));
  let finalDose = Math.max(0, round2d(cap.total + (reduction < 0 ? correctionDose : 0)));
  let capped = cap.capped;
  if (noInsulin) { finalDose = 0; mealDose = 0; correctionDose = 0; capped = false; }

  const hasDose = noInsulin ? carbs > 0 : (carbs > 0 || correctionPart > 0 || mealPart > 0);
  return {
    mealPart, rawCorrection, iobSubtracted, correctionPart, correctionApplied, correctionIsManual, mealIsManual, bgInSettingsUnit,
    totalBeforeCap: mealPart + correctionPart, mealDose, correctionDose, finalDose, requested: noInsulin ? 0 : round2d(cap.requested + (reduction < 0 ? correctionDose : 0)), capped, overMax: cap.overMax && !noInsulin, hasDose,
    reduced: !noInsulin && correctionDose < 0, reductionLimited: !noInsulin && reductionLimited
  };
}

/**
 * The dose shown while editing a logged meal. Same maths as the calculator (planDose), with the edit sheet's own rules:
 * a glucose box on screen means the correction is recalculated from it (in the Settings unit, ignoring insulin on board);
 * no box means the correction was typed originally, so it is kept; "treating a low" entries never carry insulin; and with no
 * ratio chosen the saved meal dose is kept.
 */
export function planEditDose({ entry, totalCarbs, ratio, glucoseText, settings }) {
  const base = { settings: { ...settings, iobAwareCorrection: false }, noInsulin: !!entry.noInsulin, carbs: totalCarbs, ratio: ratio || 0 };
  const meal = ratio ? {} : { mealUnits: entry.mealDose || 0, mealTyped: false };
  if (glucoseText != null) return planDose({ ...base, ...meal, correction: "auto", glucose: glucoseText, glucoseUnit: settings.units });
  const kept = entry.correctionDose || 0;
  return planDose({ ...base, ...meal, correction: kept !== 0 ? "manual" : "off", correctionUnits: kept, correctionTyped: kept !== 0 && entry.glucose == null });
}

export function computeDose({ carbs, ratio, correctionOn, glucose, glucoseUnit, settings, iob = 0, noInsulin = false }) {
  const unitLbl = settings.units === "mmol" ? "mmol/L" : "mg/dL";
  const plan = planDose({ carbs, ratio, correction: correctionOn ? "auto" : "off", glucose, glucoseUnit, iob, noInsulin, settings });
  const { mealPart, rawCorrection, iobSubtracted, correctionPart, correctionApplied, totalBeforeCap, capped, finalDose } = plan;
  const loggedMeal = plan.mealDose, loggedCorrection = plan.correctionDose;
  const lines = [];

  if (ratio && ratio > 0) lines.push(`Meal: ${round1(carbs)} g ÷ ${ratio} g per unit = ${fmtU(mealPart)} u`);
  else lines.push("Meal: no ratio set, so no meal insulin");

  if (correctionOn) {
    if (correctionApplied) {
      if (plan.bgInSettingsUnit <= settings.target && rawCorrection < 0) {
        lines.push(`Low: (${round1(plan.bgInSettingsUnit)} − ${settings.target}) ÷ ${settings.isf} = ${fmtU(rawCorrection)} u, taken off the meal dose`);
        if (plan.reductionLimited) lines.push(`That is more than the meal dose, so the reduction stops at ${fmtU(-plan.correctionDose)} u (a dose can't go below zero)`);
      } else if (plan.bgInSettingsUnit <= settings.target) {
        lines.push(`Correction: ${round1(plan.bgInSettingsUnit)} ${unitLbl} is at or below your ${settings.target} target, so none needed`);
      } else {
        lines.push(`Correction: (${round1(plan.bgInSettingsUnit)} − ${settings.target}) ÷ ${settings.isf} = ${fmtU(rawCorrection)} u`);
      }
      if (iobSubtracted > 0.05) lines.push(`Minus active insulin: ${fmtU(rawCorrection)} − ${fmtU(iobSubtracted)} = ${fmtU(correctionPart)} u`);
    } else {
      lines.push("Correction is on, but no glucose reading has been entered yet");
    }
  }

  if (noInsulin) {
    lines.length = 0;
    lines.push("Treating a low: carbs are logged but no insulin is recorded");
  } else {
    if (mealPart > 0 && correctionPart > 0) lines.push(`Raw sum before rounding: ${fmtU(mealPart)} + ${fmtU(correctionPart)} = ${fmtU(totalBeforeCap)} u`);
    if (plan.reduced) lines.push(`Meal ${fmtU(loggedMeal)} u − reduction ${fmtU(-loggedCorrection)} u = ${finalDose.toFixed(1)} u`);
    if (capped) lines.push(`Capped at your ${settings.maxDose} u maximum dose (the calculation came to ${fmtU(plan.requested)} u)`);
    if (!plan.reduced) lines.push(mealPart > 0 && correctionPart > 0
      ? `Meal and correction are each rounded to the nearest ${settings.rounding} u first, then added: ${fmtU(loggedMeal)} + ${fmtU(loggedCorrection)} = ${finalDose.toFixed(1)} u`
      : `Rounded to the nearest ${settings.rounding} u: ${finalDose.toFixed(1)} u`);
  }

  return { mealPart, rawCorrection, iobSubtracted, correctionPart, correctionApplied, totalBeforeCap, capped, requestedDose: plan.requested, finalDose, loggedMeal, loggedCorrection, lines };
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
    buckets.push({ key: d.getTime(), carbs: 0, mealCarbs: 0, lowCarbs: 0, meal: 0, corr: 0, dose: 0, entries: 0 });
  }
  const byKey = new Map(buckets.map(b => [b.key, b]));
  const inRange = [];
  for (const entry of history) {
    // Basal (long-acting) doses aren't meals or boluses: counting one would make a day with only a basal
    // dose look like a day of eating nothing, and summarizeTrends would count it as a regular meal.
    if (entry.entryType === "basal" || entry.entryType === "activity") continue;   // logged activity (2.65.0) isn't a meal either
    const b = byKey.get(dayKeyFromTs(entry.ts));
    if (!b) continue;
    inRange.push(entry);
    b.entries += 1;
    b.carbs += entry.totalCarbs || 0;
    // Carbs eaten to treat a low (logged with no insulin) are kept apart from carbs eaten as meals.
    if (entry.noInsulin) b.lowCarbs += entry.totalCarbs || 0; else b.mealCarbs += entry.totalCarbs || 0;
    // A reduction (negative correction) is meal insulin that was not taken, so it comes off the meal side; the correction side only ever counts added units.
    const c = entry.correctionDose || 0;
    b.meal += (entry.mealDose || 0) + Math.min(0, c);
    b.corr += Math.max(0, c);
  }
  buckets.forEach(b => { b.dose = b.meal + b.corr; });
  return { buckets, inRange, todayKey: buckets[buckets.length - 1].key };
}

// Headline numbers for a set of buckets. Averages use complete days with logs:
// today is still in progress and would drag them down (unless it's the only
// day with data, in which case it's used so the numbers aren't blank).
/** Basal (long-acting) insulin per day, over the SAME day buckets the other trend charts use, so tapping a day lines up
 * across all of them. Each bucket gets { am, pm, total, count }: morning and evening doses are added up separately so the
 * chart can show how each is moving. A dose with no recorded slot is placed by the time it was taken (before 14:00 is
 * morning), the same rule the logging sheet uses (basalSlotForTime in history.js; a unit test keeps the two in step). */
export function basalByDay(history, bucketKeys) {
  const out = new Map(bucketKeys.map(k => [k, { am: 0, pm: 0, total: 0, count: 0 }]));
  for (const e of history || []) {
    if (!e || e.entryType !== "basal" || !(e.basalDose > 0)) continue;
    const b = out.get(dayKeyFromTs(e.ts));
    if (!b) continue;
    const slot = e.basalSlot === "am" || e.basalSlot === "pm" ? e.basalSlot : (new Date(e.ts).getHours() < 14 ? "am" : "pm");
    b[slot] += e.basalDose; b.total += e.basalDose; b.count += 1;
  }
  return out;
}

/** The headline numbers for the basal chart. Like the other trend averages they use complete days only (an evening dose
 * not yet taken would drag today down), falling back to today if it is the only day with a dose. The morning and evening
 * averages are each taken over the days that have THAT dose, so a missed or unlogged one doesn't look like a zero. */
export function summarizeBasal(byDay, bucketKeys, todayKey) {
  const days = bucketKeys.map(key => ({ key, ...byDay.get(key) }));
  const withDoses = days.filter(d => d.count > 0);
  if (withDoses.length === 0) return { hasData: false, avg: 0, avgAm: 0, avgPm: 0, avgDays: 0, usingToday: false, doses: 0, max: 0 };
  let avgDays = withDoses.filter(d => d.key !== todayKey);
  const usingToday = avgDays.length === 0;
  if (usingToday) avgDays = withDoses;
  const mean = (list, f) => list.length ? list.reduce((t, d) => t + f(d), 0) / list.length : 0;
  return {
    hasData: true,
    avg: mean(avgDays, d => d.total),
    avgAm: mean(avgDays.filter(d => d.am > 0), d => d.am),
    avgPm: mean(avgDays.filter(d => d.pm > 0), d => d.pm),
    avgDays: avgDays.length, usingToday,
    doses: withDoses.reduce((t, d) => t + d.count, 0),
    max: Math.max(...days.map(d => d.total))
  };
}

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
  const totalMealIns = inRange.reduce((s, e) => s + (e.mealDose || 0) + Math.min(0, e.correctionDose || 0), 0);
  const totalCorrIns = inRange.reduce((s, e) => s + Math.max(0, e.correctionDose || 0), 0);
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

/** Did the insulin-to-carb ratio actually decide this entry's meal dose? Not for a basal dose, a low treated with no
 * insulin, an Eating Out entry (the dose was typed in, carbs weren't counted), or a correction on its own. Works on old
 * entries too, because it only looks at what every entry already stores. */
export function ratioWasApplied(e) {
  if (!e || e.entryType === "basal" || e.mealType === "basal" || e.entryType === "activity") return false;
  if (e.noInsulin || e.carbsUnknown) return false;
  return Number(e.ratioValue) > 0 && Number(e.totalCarbs) > 0 && Number(e.mealDose) > 0;
}

/** The average ratio actually used in each of the person's brackets (the time-of-day ratios, then the activity ones),
 * for the given entries. Every current bracket gets a row, even with no meals, so a bracket that is never used is
 * visible; a bracket that was renamed or deleted since still shows, after them, if it was used. Averages are of the
 * ratio stored on each entry (the ratio can have been changed over time), so min/max show how much it moved.
 * `unrecorded` counts dosed meals that have no ratio saved (older entries), which can't be included. */
export function ratioByBracket(entries, settings) {
  const groups = new Map();
  let unrecorded = 0;
  for (const e of entries || []) {
    if (!e || e.entryType === "basal" || e.mealType === "basal" || e.entryType === "activity") continue;
    if (ratioWasApplied(e)) {
      const key = e.ratioLabel || "";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(Number(e.ratioValue));
    } else if (!e.noInsulin && !e.carbsUnknown && Number(e.totalCarbs) > 0 && Number(e.mealDose) > 0) unrecorded++;
  }
  const rows = [], seen = new Set();
  const add = (name, kind, extra) => {
    seen.add(name);
    const v = groups.get(name) || [];
    rows.push({
      label: name, kind, ...extra, count: v.length,
      avg: v.length ? v.reduce((s, x) => s + x, 0) / v.length : null,
      min: v.length ? Math.min(...v) : null, max: v.length ? Math.max(...v) : null
    });
  };
  for (const r of (settings && settings.timeRatios) || []) add(r.name, "time", { color: r.color, current: r.ratio, start: r.start, end: r.end, days: r.days });
  for (const r of (settings && settings.activityRatios) || []) add(r.name, "activity", { color: r.color, current: r.ratio });
  for (const name of groups.keys()) if (!seen.has(name)) add(name || "Unnamed", "other", { color: null, current: null });
  return { rows, unrecorded, total: rows.reduce((s, r) => s + r.count, 0) };
}

/** The "ideal" ratio for each bracket: the ratio that would have matched each meal once what happened in the
 * `windowHours` after it is counted in.
 *  - Lows treated afterwards (carbs with no insulin of their own) mean the meal's insulin covered MORE carbs: they are
 *    added to the meal's carbs.
 *  - Corrections afterwards (2.68.2) mean the meal needed MORE insulin: standalone correction doses, and the correction
 *    part of the next meal if it comes within the window, are added to the meal's insulin.
 * Each is credited to the most recent meal before it that was dosed by the ratio, if that meal was within the window. A
 * standalone correction in between does not break the link (meal, correction, then a low: both belong to the meal); a
 * later meal or an Eating Out entry does (what follows is credited to it, or set aside if it had no ratio).
 * A meal's OWN mealtime correction (or reduction) is left out: it was for the glucose before eating, not for the carbs.
 *
 * For a meal that used ratio R for C g, followed by r g of low treatment and U units of correction, the insulin from the
 * ratio was C/R, so (C + r) g were matched by C/R + U units: ideal = (C + r) / (C/R + U) = R x (C + r) / (C + R x U).
 * (Using C/R rather than the saved dose keeps dose rounding out of it.) With nothing afterwards it equals R. The
 * bracket's figure is the mean over its meals, directly comparable with the mean of the ratios used. */
export function idealRatioByBracket(entries, settings, windowHours = 3, { skip = () => false } = {}) {
  const windowMs = Math.max(0, Number(windowHours) || 0) * 3600000;
  const list = (entries || []).filter(e => e && e.entryType !== "basal" && e.mealType !== "basal" && e.entryType !== "activity" && Number.isFinite(e.ts)).slice().sort((a, b) => a.ts - b.ts);
  const insulinOf = e => (Number(e.mealDose) || 0) + (Number(e.correctionDose) || 0);
  const isMeal = e => !e.noInsulin && insulinOf(e) > 0 && (Number(e.totalCarbs) > 0 || !!e.carbsUnknown);
  const rescue = new Map(); // ratio-dosed meal -> grams of low-treatment carbs credited to it
  const extra = new Map();  // ratio-dosed meal -> units of later correction credited to it
  let lowsCounted = 0, lowsUnattached = 0, rescueCarbs = 0, correctionsCounted = 0, correctionsUnattached = 0, correctionUnits = 0;
  let lastMeal = null;
  const target = e => (lastMeal && ratioWasApplied(lastMeal) && e.ts - lastMeal.ts <= windowMs ? lastMeal : null);
  for (const e of list) {
    if (e.noInsulin) {
      const g = Number(e.totalCarbs) || 0;
      if (g <= 0) continue;
      const m = target(e);
      if (m) { rescue.set(m, (rescue.get(m) || 0) + g); lowsCounted++; rescueCarbs += g; } else lowsUnattached++;
    } else if (isMeal(e)) {
      // A correction added to this meal because glucose was high when eating is the previous meal's shortfall.
      const c = Number(e.correctionDose) || 0;
      if (c > 0) {
        const m = target(e);
        if (m) { extra.set(m, (extra.get(m) || 0) + c); correctionsCounted++; correctionUnits += c; } else correctionsUnattached++;
      }
      lastMeal = e;
    } else if (insulinOf(e) > 0) {
      const u = insulinOf(e);
      const m = target(e);
      if (m) { extra.set(m, (extra.get(m) || 0) + u); correctionsCounted++; correctionUnits += u; } else correctionsUnattached++;
    }
  }
  const groups = new Map();
  for (const e of list) {
    // `skip` (2.67.0) leaves a meal out of the figures (e.g. one eaten near a logged activity). Low treatments are still
    // credited to the meal before them above, so leaving a meal out never moves its lows onto another one.
    if (!ratioWasApplied(e) || skip(e)) continue;
    const key = e.ratioLabel || "";
    const r = rescue.get(e) || 0, u = extra.get(e) || 0;
    const R = Number(e.ratioValue), C = Number(e.totalCarbs);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ used: R, ideal: R * (C + r) / (C + R * u), hadLow: r > 0, hadCorrection: u > 0, r, u });
  }
  const mean = (v, f) => v.reduce((s, x) => s + f(x), 0) / v.length;
  const rows = [], seen = new Set();
  const add = (name, kind, extra) => {
    seen.add(name);
    const v = groups.get(name) || [];
    rows.push({
      label: name, kind, ...extra, count: v.length,
      used: v.length ? mean(v, x => x.used) : null,
      ideal: v.length ? mean(v, x => x.ideal) : null,
      affected: v.filter(x => x.hadLow || x.hadCorrection).length,
      withLows: v.filter(x => x.hadLow).length, withCorrections: v.filter(x => x.hadCorrection).length,
      rescueCarbs: v.reduce((s, x) => s + x.r, 0),
      extraUnits: Math.round(v.reduce((s, x) => s + x.u, 0) * 100) / 100
    });
  };
  for (const r of (settings && settings.timeRatios) || []) add(r.name, "time", { color: r.color, current: r.ratio, start: r.start, end: r.end, days: r.days });
  for (const r of (settings && settings.activityRatios) || []) add(r.name, "activity", { color: r.color, current: r.ratio });
  for (const name of groups.keys()) if (!seen.has(name)) add(name || "Unnamed", "other", { color: null, current: null });
  return {
    rows, lowsCounted, lowsUnattached, rescueCarbs, correctionsCounted, correctionsUnattached,
    correctionUnits: Math.round(correctionUnits * 100) / 100, windowHours: windowMs / 3600000, total: rows.reduce((s, r) => s + r.count, 0)
  };
}

/**
 * Last check before a dose is saved: the parts about to be saved must add up to the dose the calculation produced, and that
 * must be the number the screen is showing. Returns null when all is well, else a plain-English reason to refuse.
 * (A past bug saved 19.5 u from a card showing 15.0 u.)
 */
export function checkDoseConsistency({ mealDose, correctionDose, finalDose, shownText, noInsulin = false }) {
  const parts = [mealDose, correctionDose, finalDose].map(Number);
  // The correction part may be negative (a reduction); the meal part and the total never are.
  if (parts.some(v => !Number.isFinite(v)) || parts[0] < 0 || parts[2] < 0) return "The dose could not be worked out.";
  if (noInsulin) return parts[0] === 0 && parts[1] === 0 ? null : "A 'no insulin' entry would have carried insulin.";
  const saved = Math.round((parts[0] + parts[1]) * 100) / 100;
  if (Math.abs(saved - parts[2]) > 0.005) return `The parts to save (${saved} u) do not match the calculated dose (${parts[2]} u).`;
  const shown = parseFloat(shownText);
  if (!Number.isFinite(shown) || Math.abs(shown - parts[2]) > 0.051) return `The number on screen (${shownText} u) does not match the dose to save (${parts[2]} u).`;
  return null;
}

// ---------------------------------------------------------------- basal after activity (2.72.0)
// At Francesco's request: when he logs basal, look back at the activity he did just before and, if any moderate or hard
// activity lasted at least as long as his rule says, suggest taking his own percentage off the dose. The percentage,
// the look-back and the minimum length are all his settings (Settings > Dosing); the app never picks a clinical figure.
// It is a suggestion only: the sheet shows it and he taps to use it. Nothing here feeds the meal dose (computeDose).
export const BASAL_ACTIVITY_DEFAULTS = { enabled: false, lookbackMin: 60, minMinutes: 30, reducePct: null };
export const BASAL_ACTIVITY_LIMITS = { lookbackMin: [15, 240], minMinutes: [5, 240], reducePct: [1, 50] };
const BASAL_ACTIVITY_INTENSITIES = new Set(["moderate", "hard"]);

/** The rule with every value present and inside its limits (anything missing or odd falls back to the default; a
 * percentage that isn't a usable number stays null, which means "not set yet": no suggestion is made without one). */
export function basalActivityRule(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const lim = (v, [lo, hi], dflt) => { const n = Number(v); return Number.isFinite(n) && v !== null && v !== "" ? Math.min(hi, Math.max(lo, Math.round(n))) : dflt; };
  return {
    enabled: r.enabled === true,
    lookbackMin: lim(r.lookbackMin, BASAL_ACTIVITY_LIMITS.lookbackMin, BASAL_ACTIVITY_DEFAULTS.lookbackMin),
    minMinutes: lim(r.minMinutes, BASAL_ACTIVITY_LIMITS.minMinutes, BASAL_ACTIVITY_DEFAULTS.minMinutes),
    reducePct: lim(r.reducePct, BASAL_ACTIVITY_LIMITS.reducePct, null)
  };
}

/** Pieces of activity less than this apart are one workout. Apple Health often sends one session as several (a hard
 * 25 min then a moderate 26 min, 2 minutes apart, on 28 Oct 2026), and each piece alone was under his minimum. */
export const BASAL_ACTIVITY_JOIN_GAP_MIN = 15;

/** Workouts before a basal dose that his rule counts: moderate or hard activities that started no later than `takenTs`,
 * joined into one workout when one starts within BASAL_ACTIVITY_JOIN_GAP_MIN of the previous one ending, kept when the
 * workout lasted at least rule.minMinutes in all and was still going at some point in the rule.lookbackMin minutes up to
 * the dose. Minutes are the time covered, so two records of the same session (typed and imported) aren't counted twice.
 * Newest finish first, each as { entries (in time order), entry (the last piece), startTs, endTs, minutes, minutesBefore }
 * (minutesBefore is 0 when it was still going when the dose was taken). Light activity neither counts nor joins pieces. */
export function activitiesBeforeBasal(history, takenTs, rawRule) {
  const rule = basalActivityRule(rawRule);
  if (!Number.isFinite(takenTs)) return [];
  const from = takenTs - rule.lookbackMin * 60000, gap = BASAL_ACTIVITY_JOIN_GAP_MIN * 60000;
  const pieces = [];
  for (const e of history || []) {
    if (!e || e.entryType !== "activity" || !BASAL_ACTIVITY_INTENSITIES.has(e.intensity)) continue;
    const mins = Number(e.durationMin);
    if (!Number.isFinite(e.ts) || !(mins > 0) || e.ts > takenTs) continue;
    pieces.push({ entry: e, startTs: e.ts, endTs: e.ts + mins * 60000 });
  }
  pieces.sort((a, b) => a.startTs - b.startTs || a.endTs - b.endTs);
  const workouts = [];
  let cur = null;
  for (const p of pieces) {
    if (cur && p.startTs <= cur.endTs + gap) {
      cur.coveredMs += Math.max(0, p.endTs - Math.max(p.startTs, cur.endTs));
      cur.endTs = Math.max(cur.endTs, p.endTs);
      cur.entries.push(p.entry);
    } else {
      cur = { entries: [p.entry], startTs: p.startTs, endTs: p.endTs, coveredMs: p.endTs - p.startTs };
      workouts.push(cur);
    }
  }
  return workouts
    .filter(w => w.endTs >= from && w.coveredMs >= rule.minMinutes * 60000)
    .map(w => ({ entries: w.entries, entry: w.entries[w.entries.length - 1], startTs: w.startTs, endTs: w.endTs,
      minutes: Math.round(w.coveredMs / 60000), minutesBefore: Math.max(0, Math.round((takenTs - w.endTs) / 60000)) }))
    .sort((a, b) => b.endTs - a.endTs);
}

/** The suggested dose: `baseUnits` less rule.reducePct %, rounded to the pen step. On an exact half-step it rounds to
 * the smaller dose (the safer side after exercise). null when there is no rule percentage or no usable base dose.
 * `changed` is false when the reduction is smaller than half a pen step, so the rounded dose equals the base. */
export function basalActivitySuggestion(baseUnits, rawRule, rounding) {
  const rule = basalActivityRule(rawRule);
  if (rule.reducePct == null || typeof baseUnits !== "number" || !Number.isFinite(baseUnits) || baseUnits <= 0) return null;
  const step = parseFloat(rounding) || 0.5;
  const exact = baseUnits * (1 - rule.reducePct / 100);
  const units = Math.max(0, Math.round(Math.ceil(exact / step - 0.5 - 1e-9) * step * 100) / 100);
  return { units, fromUnits: Math.round(baseUnits * 100) / 100, pct: rule.reducePct, exact: Math.round(exact * 100) / 100, changed: units < Math.round(baseUnits * 100) / 100 };
}
