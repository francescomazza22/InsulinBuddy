// Pure calculation core. Nothing in here touches the DOM, localStorage or any
// module-level state -- everything is passed in -- so it can be tested in Node.

import { round1, dayKeyFromTs } from "./util.js";

export const MGDL_PER_MMOL = 18.0182;

export function convertGlucose(value, fromUnit, toUnit) {
  if (fromUnit === toUnit) return value;
  return fromUnit === "mmol" ? value * MGDL_PER_MMOL : value / MGDL_PER_MMOL;
}

/** "mmol/L" or "mg/dL". */
export function glucoseUnitLabel(unit) { return unit === "mmol" ? "mmol/L" : "mg/dL"; }

/** A mg/dL value as it should be SHOWN in `unit`: one decimal in mmol/L, a whole number in mg/dL. */
export function formatGlucose(mgdl, unit) {
  return unit === "mmol" ? round1(convertGlucose(mgdl, "mgdl", "mmol")) : Math.round(mgdl);
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
// IOB: the "scalable exponential" insulin activity model used by Loop, AndroidAPS and OpenAPS (originally by
// Dragan Maksimovic, refined by Pete Schwamb), not a bespoke curve. Given a dose's peak activity time and its
// duration of insulin action (DIA), it returns the fraction of the dose still active `minutesAgo` minutes later.
// tau / a / S are derived, not tuned by hand, so the curve is exactly 1 at t=0 and exactly 0 at t=DIA with a
// single smooth peak in between.
export function iobFraction(minutesAgo, peakMinutes, diaMinutes) {
  if (minutesAgo <= 0) return 1;
  if (minutesAgo >= diaMinutes) return 0;
  const tp = peakMinutes, td = diaMinutes, t = minutesAgo;
  const tau = tp * (1 - tp / td) / (1 - 2 * tp / td);
  const a = 2 * tau / td;
  const S = 1 / (1 - a + (1 + a) * Math.exp(-td / tau));
  return 1 - S * (1 - a) * ((t * t / (tau * td * (1 - a)) - t / tau - 1) * Math.exp(-t / tau) + 1);
}

// COB: deliberately simple linear absorption, from 100% of the meal's carbs at t=0 to 0% at the meal's own
// absorption time. Real absorption is closer to a bell curve; this trades that precision for a curve anyone can
// check by hand.
export function cobGrams(minutesAgo, carbs, absorptionMinutes) {
  if (minutesAgo <= 0) return carbs;
  if (minutesAgo >= absorptionMinutes) return 0;
  return carbs * (1 - minutesAgo / absorptionMinutes);
}

// Which absorption time applies to a logged meal, from its snapshotted compound GI, using the same high / medium /
// low bands (>=70 / 56-69 / <=55) as the GI indicator shown elsewhere. Meals with no GI use the "unknown" default.
export function absorptionMinutesForEntry(entry, carbAbsorptionMinutes) {
  const m = carbAbsorptionMinutes;
  if (!entry.glycemicLoad) return m.unknown;
  const band = giBand(entry.glycemicLoad.value);
  return m[band];
}

// Stacked IOB/COB at a point in time (`atTime`, ms) across the whole history: overlapping doses and meals simply
// add. Also reports when each reaches zero, which is exact rather than searched for, because every curve hits
// zero at its own cutoff, so the total clears when the last contributing dose or meal does.
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

/**
 * THE dose calculation. The Calculator and the Edit Meal sheet both call this, so a dose can only ever be worked
 * out one way (the 2.6.1 cap bug came from three copies of this maths disagreeing).
 *
 *   meal       = carbs / ratio                              or a dose the person typed (Eating Out)
 *   correction = max(0, (glucose - target) / ISF) [- IOB]   or a dose the person typed (manual correction)
 *   each part is rounded to the dose step (typed parts are kept exactly, to 0.01u), then the two are capped
 *   together by capDoseParts. A typed part is never changed: over the cap it reports `overMax` instead.
 *
 * typedMeal:       null/undefined = calculate from carbs. A number (NaN allowed, meaning "nothing readable yet")
 *                  = the meal dose was typed; anything not above 0 counts as 0u.
 * typedCorrection: null/undefined = calculate from `glucose`. A number = the correction was typed; only a value
 *                  above 0 counts (and only then marks the dose as typed), as in the Calculator's manual mode.
 * iob:             subtracted from a calculated correction when settings.iobAwareCorrection is on. Pass 0 to
 *                  re-calculate a past meal (its active insulin then is not today's).
 *
 * Returns the parts before rounding (mealPart, correctionPart, rawCorrection, iobSubtracted), the parts to log
 * (loggedMeal, loggedCorrection), finalDose, the cap outcome (capped, overMax, requestedDose), which parts were
 * typed, and human-readable `lines` explaining each step. With noInsulin every insulin figure is 0 and nothing
 * is reported as capped.
 */
export function computeDose({ carbs, ratio, correctionOn, glucose, glucoseUnit, settings, iob = 0, noInsulin = false, typedMeal = null, typedCorrection = null }) {
  const unitLbl = settings.units === "mmol" ? "mmol/L" : "mg/dL";
  const lines = [];

  const mealTyped = typedMeal != null;
  let mealPart;
  if (mealTyped) {
    mealPart = Number.isFinite(typedMeal) && typedMeal > 0 ? typedMeal : 0;
    lines.push(`Meal: ${fmtU(mealPart)} u, as typed`);
  } else {
    mealPart = ratio && ratio > 0 ? carbs / ratio : 0;
    if (ratio && ratio > 0) lines.push(`Meal: ${round1(carbs)} g ÷ ${ratio} g per unit = ${fmtU(mealPart)} u`);
    else lines.push("Meal: no ratio set, so no meal insulin");
  }

  let rawCorrection = 0, iobSubtracted = 0, correctionPart = 0, correctionApplied = false, correctionTyped = false;
  if (correctionOn && typedCorrection != null) {
    if (Number.isFinite(typedCorrection) && typedCorrection > 0) {
      correctionPart = typedCorrection; correctionTyped = true; correctionApplied = true;
      lines.push(`Correction: ${fmtU(correctionPart)} u, as typed`);
    } else {
      lines.push("Correction is on, but no correction dose has been typed yet");
    }
  } else if (correctionOn) {
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

  const totalBeforeCap = mealPart + correctionPart;
  // Round each part first, then add the already-rounded numbers together. Rounding the raw
  // (unrounded) sum instead can disagree with what the meal and correction lines actually show --
  // e.g. a 3.15u meal (shown as "3u") plus a 0.7u correction (shown as "0.5u") sum to 3.5u, but
  // rounding 3.85 on its own lands on 4u. The displayed breakdown must always add up to the total.
  // A typed part is a precise record of a decision, so it is kept as typed rather than rounded to the step.
  let loggedMeal = mealTyped ? round2(mealPart) : roundDose(mealPart, settings.rounding);
  let loggedCorrection = correctionTyped ? round2(correctionPart) : roundDose(correctionPart, settings.rounding);
  const cap = capDoseParts({ meal: loggedMeal, correction: loggedCorrection, maxDose: settings.maxDose, typed: mealTyped || correctionTyped });
  loggedMeal = cap.meal; loggedCorrection = cap.correction;   // the parts must add up to the total that is shown
  let finalDose = Math.max(0, cap.total);
  let capped = cap.capped, overMax = cap.overMax;

  if (noInsulin) {
    finalDose = 0; loggedMeal = 0; loggedCorrection = 0; capped = false; overMax = false;
    lines.length = 0;
    lines.push("Treating a low: carbs are logged but no insulin is recorded");
  } else {
    if (mealPart > 0 && correctionPart > 0) lines.push(`Raw sum before rounding: ${fmtU(mealPart)} + ${fmtU(correctionPart)} = ${fmtU(totalBeforeCap)} u`);
    if (capped) lines.push(`Capped at your ${settings.maxDose} u maximum dose (the calculation came to ${fmtU(cap.requested)} u)`);
    if (overMax) lines.push(`${fmtU(cap.total)} u is above your ${settings.maxDose} u maximum dose, but part of it was typed, so it hasn't been changed`);
    lines.push(mealPart > 0 && correctionPart > 0
      ? `Meal and correction are each rounded to the nearest ${settings.rounding} u first, then added: ${fmtU(loggedMeal)} + ${fmtU(loggedCorrection)} = ${finalDose.toFixed(1)} u`
      : `Rounded to the nearest ${settings.rounding} u: ${finalDose.toFixed(1)} u`);
  }

  return {
    mealPart, rawCorrection, iobSubtracted, correctionPart, correctionApplied, totalBeforeCap,
    capped, overMax, requestedDose: cap.requested, finalDose, loggedMeal, loggedCorrection,
    mealTyped, correctionTyped, lines
  };
}

/**
 * The Calculator's dose: what the dose card shows and what Log saves. Same computeDose, with the Calculator's modes:
 *   eatingOut + eatingOutDose          the meal dose was typed (Eating Out); carbs are not counted at all
 *   correctionManual + correctionDose  the correction was typed; otherwise it is calculated from `glucose`
 * Typed doses arrive already parsed (parseDecimalInput), so NaN means "nothing readable typed yet".
 */
export function calculatorDose({ carbs, ratio, settings, iob = 0, noInsulin = false, eatingOut = false, eatingOutDose = NaN, correctionOn = false, correctionManual = false, correctionDose = NaN, glucose = "", glucoseUnit = null }) {
  return computeDose({
    carbs: eatingOut ? 0 : carbs, ratio, settings, iob, noInsulin,
    correctionOn, glucose, glucoseUnit,
    typedMeal: eatingOut ? eatingOutDose : null,
    typedCorrection: correctionOn && correctionManual ? correctionDose : null
  });
}

/**
 * The dose for a meal that's already in History, as the Edit Meal sheet re-calculates it. Same computeDose, with
 * the inputs a logged entry has:
 *   carbs / ratio   the edited items and the chosen ratio. With no ratio, or for an Eating Out entry (carbsUnknown),
 *                   the logged meal dose is kept exactly as it is: there is nothing to re-calculate it from.
 *   glucose         the reading on screen (string or number), or null when none was recorded -- then a logged
 *                   correction can only have been typed, so it is kept exactly as it is.
 * Active insulin is never subtracted (today's IOB says nothing about a past meal), and a "Treating a Low" entry
 * stays at 0u.
 */
export function recalculateEntryDose({ entry, carbs, ratio, glucose = null, settings }) {
  const keepMeal = !!entry.carbsUnknown || !(ratio > 0);
  const keptMeal = keepMeal ? (entry.mealDose || 0) : 0;
  return computeDose({
    carbs, ratio: keepMeal ? 0 : ratio, settings, iob: 0, noInsulin: !!entry.noInsulin,
    correctionOn: true, glucose, glucoseUnit: settings.units,
    typedCorrection: glucose == null ? (entry.correctionDose || 0) : null,
    typedMeal: keptMeal > 0 ? keptMeal : null
  });
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
    // Basal (long-acting) doses aren't meals or boluses: counting one would make a day with only a basal
    // dose look like a day of eating nothing, and summarizeTrends would count it as a regular meal.
    if (entry.entryType === "basal") continue;
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
