// Today's carbs against the usual day (2.75.0), for the slim bar at the bottom of the dose card.
// The average follows Trends: complete days that have something logged, today left out (it is still going).
import { dayBounds, shiftDay } from "./day-timeline.js";
import { isNonMealEntry } from "./history.js";

export const DAILY_CARBS_DAYS = 14;

const carbsOf = e => (e && !isNonMealEntry(e) && !e.carbsUnknown && Number.isFinite(Number(e.totalCarbs)) ? Math.max(0, Number(e.totalCarbs)) : 0);
const counts = e => !!e && !isNonMealEntry(e);   // a day "has something logged" if any meal, low or correction is on it

/**
 * history: the log. now: ms. days: how many complete days before today to average over.
 * Returns { today, avg, daysUsed } -- avg is null when none of those days has anything logged.
 */
export function dailyCarbsSummary(history, now = Date.now(), days = DAILY_CARBS_DAYS) {
  const { start: todayStart, end: todayEnd } = dayBounds(now);
  const from = shiftDay(now, -days);
  let today = 0;
  const perDay = new Map();   // local midnight -> carbs
  for (const e of history || []) {
    if (!counts(e) || !Number.isFinite(Number(e.ts))) continue;
    const ts = Number(e.ts);
    if (ts >= todayStart && ts < todayEnd) { today += carbsOf(e); continue; }
    if (ts < from || ts >= todayStart) continue;
    const key = dayBounds(ts).start;
    perDay.set(key, (perDay.get(key) || 0) + carbsOf(e));
  }
  const totals = [...perDay.values()];
  const avg = totals.length ? totals.reduce((s, c) => s + c, 0) / totals.length : null;
  return { today: round1(today), avg: avg == null ? null : round1(avg), daysUsed: totals.length };
}

/** Bar fills, as fractions of the bar: logged today, then the meal being put together (never past the end). */
export function dailyCarbsBar({ today, draft = 0, avg }) {
  if (!(avg > 0)) return { logged: 0, draft: 0, over: false };
  const logged = Math.min(1, Math.max(0, today) / avg);
  const withDraft = Math.min(1, (Math.max(0, today) + Math.max(0, draft)) / avg);
  return { logged, draft: withDraft - logged, over: today + Math.max(0, draft) > avg };
}

function round1(x) { return Math.round(x * 10) / 10; }
