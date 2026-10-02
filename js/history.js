// Pure helpers for the History list and the Calculator's "recent meals" row.

import { dayKeyFromTs } from "./util.js";

export const PAGE_SIZE = 60;

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
    (entry.correctionDose || 0) > 0 ? "correction" : ""
  ].join(" ").toLowerCase();
  return tokens.every(t => hay.includes(t));
}

const signature = e => (e.items || []).map(i => `${i.refType}:${i.refId}:${i.grams ?? i.quantity ?? ""}`).sort().join("|");

/** The last `n` DISTINCT real meals (same items + amounts collapse), newest first. */
export function recentDistinctMeals(history, n = 6) {
  const seen = new Set();
  const out = [];
  for (const e of history) {
    if (!e.items || e.items.length === 0 || e.noInsulin || !(e.totalCarbs > 0)) continue;
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
  const inRange = (history || []).filter(e => e && typeof e.ts === "number" && e.ts >= sinceMs);
  const dayKeys = new Set(inRange.map(e => { const d = new Date(e.ts); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; }));
  const days = dayKeys.size || 1;
  const meals = inRange.filter(e => e.mealType !== "correction" && !e.noInsulin && (e.totalCarbs || 0) > 0);
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
  return {
    days, mealsLogged: meals.length, lowsTreated, correctionsOnly,
    avgDailyCarbs: totalCarbs / days, avgDailyInsulin: totalInsulin / days,
    totalCarbs, totalInsulin, topFoods
  };
}
