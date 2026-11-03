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

/**
 * 2.81.0: the same bar with a mark at the target (average day, or the food allowance) once today goes past it.
 * logged/draft/target in the same unit. Under the target the bar is 0 → target, as before. Past it the bar grows to fit
 * (up to maxScale × target), the mark moves in from the end, and the part past it is coloured.
 * Returns fractions of the bar: fill (logged), draft (meal being built, after fill), tick (null when not past),
 * fillOverFrom / draftOverFrom (where, within that piece, the part past the target starts; null when none), over.
 */
export function overBar({ logged = 0, draft = 0, target, maxScale = 2 }) {
  const none = { fill: 0, draft: 0, tick: null, fillOverFrom: null, draftOverFrom: null, over: false, scale: 1 };
  if (!(target > 0)) return none;
  const L = Math.max(0, Number(logged) || 0) / target, T = L + Math.max(0, Number(draft) || 0) / target;
  const scale = Math.min(maxScale, Math.max(1, T));
  const fill = Math.min(L, scale) / scale, total = Math.min(T, scale) / scale, d = total - fill;
  const over = T > 1, tick = over ? 1 / scale : null;
  const fillOverFrom = L > 1 && fill > 0 ? tick / fill : null;
  const draftOverFrom = over && d > 1e-9 ? Math.min(1, Math.max(0, (tick - fill) / d)) : null;
  return { fill, draft: d, tick, fillOverFrom, draftOverFrom, over, scale };
}
