// Pure helpers for the History list and the Calculator's "recent meals" row.

import { dayKeyFromTs } from "./util.js";
import { isActivityEntry, activitySearchText } from "./activity.js";

export const PAGE_SIZE = 60;

// ---------------------------------------------------------------- basal insulin
// A basal (long-acting) dose is stored as an ordinary history entry, so it inherits cloud sync,
// tombstones, undo, backup and the Nightscout outbox for free. But its units live in `basalDose` and
// NEVER in mealDose/correctionDose: active insulin, correction suggestions, trends and meal stats
// all read those two fields (or skip entries via isBasalEntry), so a basal dose cannot leak into
// them and make the app think rapid-acting insulin is on board. Tests pin that property.

export const BASAL_MAX_UNITS = 200;

export const isBasalEntry = e => !!e && e.entryType === "basal";
/** Not a meal or a bolus: a basal dose or a logged activity (2.65.0). Everything that counts meals, carbs or bolus insulin skips these. */
export const isNonMealEntry = e => isBasalEntry(e) || isActivityEntry(e);

/** "am" before 14:00 local, "pm" from 14:00 (the midpoint of a typical morning/evening pair). It is
 * only a label and a prefill hint; the person can always flip it. */
export function basalSlotForTime(ts) {
  return new Date(ts).getHours() < 14 ? "am" : "pm";
}
export const basalSlotLabel = slot => slot === "am" ? "Morning" : slot === "pm" ? "Evening" : "";

/** The most recent logged basal dose for a slot -> { units, ts }, or null. */
export function lastBasalDose(history, slot) {
  let best = null;
  for (const e of history || []) {
    if (!isBasalEntry(e) || e.basalSlot !== slot || !(e.basalDose > 0)) continue;
    if (!best || e.ts > best.ts) best = { units: e.basalDose, ts: e.ts };
  }
  return best;
}

const fmtUnits = n => String(Math.round(n * 100) / 100);

/** Checks a typed basal dose against the last one in the same slot. level is "block" (can't log it),
 * "confirm" (log only if sure) or "ok". The confirm rule targets typos (4.1 for 41, 14 for 140)
 * without nagging over ordinary day-to-day variation: it needs BOTH a swing of at least 50% AND at
 * least 4 units. With no previous dose to compare against, only a very large dose asks. */
export function basalDoseCheck(units, last) {
  if (typeof units !== "number" || !isFinite(units) || units <= 0) return { level: "block", message: "Enter a dose greater than 0." };
  if (units > BASAL_MAX_UNITS) return { level: "block", message: `That is over ${BASAL_MAX_UNITS} units, which doesn't look right. Check the number.` };
  if (last && last.units > 0) {
    const diff = Math.abs(units - last.units);
    if (diff >= 4 && diff / last.units >= 0.5) return { level: "confirm", message: `Your last dose here was ${fmtUnits(last.units)}u and you entered ${fmtUnits(units)}u.` };
  } else if (units > 100) {
    return { level: "confirm", message: `${fmtUnits(units)}u is a very large dose.` };
  }
  return { level: "ok", message: "" };
}

/** A history entry for a basal dose. Every meal-shaped field is present and zero, so anything that
 * reads entries without knowing about basal sees "no carbs, no bolus" rather than undefined. The id
 * comes from when it was logged (like meals), not from `ts`, which the person may backdate. */
export function makeBasalEntry({ units, ts, slot, now = Date.now() }) {
  return {
    id: `h-${now}`, ts, entryType: "basal", mealType: "basal", periodName: slot === "am" ? "morning" : "evening",
    basalDose: Math.round(units * 100) / 100, basalSlot: slot,
    items: [], totalCarbs: 0, totalKcal: 0, glycemicLoad: null,
    mealDose: 0, correctionDose: 0, noInsulin: false, glucose: null, ratioLabel: "", ratioValue: null
  };
}

/** Newest-first entries -> [{ key, ts, entries[] }] grouped by local day. */
export function groupByDay(entries) {
  const groups = [];
  let cur = null;
  for (const e of entries) {
    const k = dayKeyFromTs(e.ts);
    if (!cur || cur.key !== k) { cur = { key: k, ts: e.ts, entries: [] }; groups.push(cur); }
    cur.entries.push(e);
  }
  return groups;
}

/** First `limit` entries, extended to finish the last day so a day is never cut in half. */
export function takeEntries(entries, limit) {
  if (entries.length <= limit) return { visible: entries, hidden: 0 };
  let end = limit;
  const lastKey = dayKeyFromTs(entries[limit - 1].ts);
  while (end < entries.length && dayKeyFromTs(entries[end].ts) === lastKey) end++;
  return { visible: entries.slice(0, end), hidden: entries.length - end };
}

/**
 * Case-insensitive AND-search over food names, meal type, period, the date as
 * text, and a few keywords ("low", "correction"). `dateText(ts)` is supplied by
 * the caller so this module stays free of locale/DOM concerns.
 */
export function matchesQuery(entry, query, dateText = () => "") {
  const tokens = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const hay = [
    ...(entry.items || []).map(i => i.name),
    entry.mealType, entry.periodName, dateText(entry.ts),
    entry.noInsulin ? "low treating hypo no insulin" : "",
    (entry.correctionDose || 0) > 0 ? "correction" : "",
    (entry.correctionDose || 0) < 0 ? "reduced lowered low" : "",
    isBasalEntry(entry) ? `basal long-acting long acting ${entry.basalDose}u` : "",
    isActivityEntry(entry) ? activitySearchText(entry) : ""
  ].join(" ").toLowerCase();
  return tokens.every(t => hay.includes(t));
}

const signature = e => (e.items || []).map(i => `${i.refType}:${i.refId}:${i.grams ?? i.quantity ?? ""}`).sort().join("|");

/** The last `n` DISTINCT real meals (same items + amounts collapse), newest first. */
export function recentDistinctMeals(history, n = 6) {
  const seen = new Set();
  const out = [];
  for (const e of history) {
    if (isNonMealEntry(e) || !e.items || e.items.length === 0 || e.noInsulin || !(e.totalCarbs > 0)) continue;
    const sig = signature(e);
    if (seen.has(sig)) continue;
    seen.add(sig);
    out.push(e);
    if (out.length >= n) break;
  }
  return out;
}

/** "Pasta + Salad" / "Pasta, Salad +2" -- a short label for a chip. */
export function mealLabel(entry, maxNames = 2) {
  const names = (entry.items || []).map(i => i.name);
  if (names.length <= maxNames) return names.join(" + ");
  return `${names.slice(0, maxNames).join(" + ")} +${names.length - maxNames}`;
}

/** Dosing/food summary for a clinic report: how much was actually logged over a period, not
 * just glucose. `sinceMs` bounds the window; days spanned is counted from distinct local
 * calendar days actually present (so a sparse period doesn't inflate daily averages toward 0
 * over a mostly-empty window) -- empty or single-day fallback to 1 to avoid divide-by-zero. */
export function dosingSummary(history, sinceMs) {
  const all = (history || []).filter(e => e && typeof e.ts === "number" && e.ts >= sinceMs);
  // Every existing figure below describes meals and boluses, so basal entries are kept out of them:
  // a day with only a basal dose must not become an "averaging day" with zero carbs and zero insulin.
  const inRange = all.filter(e => !isNonMealEntry(e));
  const basal = all.filter(e => isBasalEntry(e) && e.basalDose > 0);
  const dayKeyOf = ts => { const d = new Date(ts); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
  const dayKeys = new Set(inRange.map(e => dayKeyOf(e.ts)));
  const days = dayKeys.size || 1;
  // A carbsUnknown (Eating Out) entry is still a real meal with real insulin -- it just has no
  // carb count, so it wouldn't pass a totalCarbs > 0 filter the way a normal meal would.
  const meals = inRange.filter(e => e.mealType !== "correction" && !e.noInsulin && ((e.totalCarbs || 0) > 0 || e.carbsUnknown));
  const eatingOutCount = inRange.filter(e => e.carbsUnknown).length;
  const lowsTreated = inRange.filter(e => e.noInsulin).length;
  const correctionsOnly = inRange.filter(e => e.mealType === "correction").length;
  const totalCarbs = inRange.reduce((s, e) => s + (e.totalCarbs || 0), 0);
  const totalInsulin = inRange.reduce((s, e) => s + (e.mealDose || 0) + (e.correctionDose || 0), 0);
  const foodCounts = new Map();
  for (const e of inRange) for (const i of (e.items || [])) {
    if (!i || !i.name) continue;
    foodCounts.set(i.name, (foodCounts.get(i.name) || 0) + 1);
  }
  const topFoods = [...foodCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, count]) => ({ name, count }));
  // Basal is averaged over the days it was actually logged on, and bolus over the days meals were, so
  // each figure is honest about its own data. Their sum is an approximation of total daily insulin that
  // is exact whenever both are logged every day, which is the normal case.
  const basalDays = new Set(basal.map(e => dayKeyOf(e.ts))).size;
  const totalBasal = basal.reduce((s, e) => s + e.basalDose, 0);
  const avgDailyBasal = basalDays ? totalBasal / basalDays : 0;
  return {
    days, mealsLogged: meals.length, lowsTreated, correctionsOnly, eatingOutCount,
    avgDailyCarbs: totalCarbs / days, avgDailyInsulin: totalInsulin / days,
    totalCarbs, totalInsulin, topFoods,
    basalDoses: basal.length, totalBasal, avgDailyBasal, avgDailyTotalInsulin: totalInsulin / days + avgDailyBasal
  };
}

/**
 * The insulin and food figures Gluroo shows: total daily insulin with the basal / bolus split, meals per day, average bolus and
 * carbs per meal, the effective carb ratio actually used, how much of the bolus was correction, and the biggest dose.
 * A negative correction (units taken off a meal) counts against the meal, so the totals are what was actually injected.
 */
export function insulinStats(history, sinceMs) {
  const all = (history || []).filter(e => e && typeof e.ts === "number" && e.ts >= sinceMs);
  const dayKeyOf = ts => { const d = new Date(ts); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
  const bolusEntries = all.filter(e => !isNonMealEntry(e) && !e.noInsulin && ((Number(e.mealDose) || 0) + (Number(e.correctionDose) || 0)) > 0);
  const basal = all.filter(e => isBasalEntry(e) && e.basalDose > 0);
  const bolusDays = new Set(bolusEntries.map(e => dayKeyOf(e.ts))).size || 1;
  const basalDays = new Set(basal.map(e => dayKeyOf(e.ts))).size;
  const sumBolus = e => (Number(e.mealDose) || 0) + (Number(e.correctionDose) || 0);
  const totalBolus = bolusEntries.reduce((s, e) => s + sumBolus(e), 0);
  const totalBasal = basal.reduce((s, e) => s + e.basalDose, 0);
  const avgDailyBolus = totalBolus / bolusDays, avgDailyBasal = basalDays ? totalBasal / basalDays : 0;
  const tdd = avgDailyBolus + avgDailyBasal;
  const mealEntries = bolusEntries.filter(e => e.mealType !== "correction" && (Number(e.mealDose) || 0) > 0);
  const countedMeals = mealEntries.filter(e => !e.carbsUnknown && (Number(e.totalCarbs) || 0) > 0);
  const mealCarbs = countedMeals.reduce((s, e) => s + e.totalCarbs, 0), mealInsulin = countedMeals.reduce((s, e) => s + (Number(e.mealDose) || 0), 0);
  const pos = bolusEntries.reduce((s, e) => s + Math.max(0, Number(e.correctionDose) || 0), 0);
  const lows = all.filter(e => !isNonMealEntry(e) && e.noInsulin);
  return {
    days: bolusDays, avgDailyBolus, avgDailyBasal, tdd,
    basalPct: tdd > 0 && basalDays ? (avgDailyBasal / tdd) * 100 : null, bolusPct: tdd > 0 && basalDays ? (avgDailyBolus / tdd) * 100 : null,
    mealsPerDay: mealEntries.length / bolusDays, avgMealBolus: mealEntries.length ? mealEntries.reduce((s, e) => s + (Number(e.mealDose) || 0), 0) / mealEntries.length : null,
    avgMealCarbs: countedMeals.length ? mealCarbs / countedMeals.length : null,
    effectiveCarbRatio: mealInsulin > 0 ? mealCarbs / mealInsulin : null,
    correctionSharePct: totalBolus > 0 ? (pos / (totalBolus + 1e-9)) * 100 : null, correctionCount: bolusEntries.filter(e => (Number(e.correctionDose) || 0) > 0).length,
    reductionCount: bolusEntries.filter(e => (Number(e.correctionDose) || 0) < 0).length,
    largestDose: bolusEntries.length ? Math.max(...bolusEntries.map(sumBolus)) : null,
    lowsTreated: lows.length, avgLowCarbs: lows.length ? lows.reduce((s, e) => s + (Number(e.totalCarbs) || 0), 0) / lows.length : null
  };
}

const fmtU = n => String(Math.round(n * 10) / 10);
/** What a meal row's dose badge says. One clear number (the units actually injected) and, when the dose has two parts, a
 *  small line saying which is which. A treated low and a correction-only entry get their own look. */
export function doseBadge(entry) {
  const meal = Number(entry && entry.mealDose) || 0, corr = Number(entry && entry.correctionDose) || 0;
  if (entry && entry.noInsulin) return { kind: "low", main: "Low treated", sub: "no insulin" };
  const total = Math.max(0, meal + corr);
  if (entry && (entry.mealType === "correction" || (meal === 0 && corr > 0 && !(entry.items || []).length))) return { kind: "correction", main: `${fmtU(total)} u`, sub: "correction" };
  if (corr > 0) return { kind: "meal", main: `${fmtU(total)} u`, sub: `${fmtU(meal)} meal + ${fmtU(corr)} corr.` };
  if (corr < 0) return { kind: "meal", main: `${fmtU(total)} u`, sub: `${fmtU(meal)} meal \u2212 ${fmtU(-corr)} cut` };
  return { kind: "meal", main: `${fmtU(total)} u`, sub: "" };
}

// ---------------------------------------------------------------- food order by time slot
// How many logged meals in a time slot (one of the time-of-day ratio ranges) included each food or recipe, keyed
// "food:<id>" / "recipe:<id>" like the Calculator's pick list. A meal counts for the slot whose range covered the
// moment it was logged, judged with the ranges as they are set now (so renaming or moving a range re-sorts history
// with it), including day-limited ranges. A food eaten twice in one meal counts once. Entries without food (basal,
// activity, corrections) are skipped.
export function slotUsage(history, brackets, slot, matcher) {
  const counts = new Map();
  if (!slot || !Array.isArray(history) || !history.length) return counts;
  for (const e of history) {
    if (!e || !Array.isArray(e.items) || !e.items.length || isBasalEntry(e) || isActivityEntry(e)) continue;
    const d = new Date(e.ts);
    if (isNaN(d)) continue;
    if (matcher(brackets, d.getHours() * 60 + d.getMinutes(), d.getDay()) !== slot) continue;
    const seen = new Set();
    for (const i of e.items) {
      if (!i || (i.refType !== "food" && i.refType !== "recipe") || i.refId == null) continue;
      const key = `${i.refType}:${i.refId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  return counts;
}

// The Calculator's food order: most eaten in this time slot first, then most eaten overall, then A to Z.
export function sortBySlotUsage(items, counts) {
  const c = i => (counts && counts.get(i.id)) || 0;
  return items.slice().sort((a, b) => c(b) - c(a) || (b.usageCount || 0) - (a.usageCount || 0) || a.name.localeCompare(b.name));
}
