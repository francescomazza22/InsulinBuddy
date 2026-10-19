// Time and small number helpers. No DOM, no app state, so they port straight to a native app.
export function toMinutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}
export function inRange(minutes, start, end) {
  const s = toMinutes(start), e = toMinutes(end);
  if (s === e) return true;
  if (s < e) return minutes >= s && minutes < e;
  return minutes >= s || minutes < e; // wraps past midnight
}
// Days of the week a bracket can be limited to (0 = Sunday, as Date.getDay). A bracket with no `days` applies every day.
export const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export function bracketDays(r) {
  const d = Array.isArray(r && r.days) ? [...new Set(r.days.map(Number).filter(n => n >= 0 && n <= 6))] : [];
  return d.length && d.length < 7 ? d.sort((a, b) => a - b) : [];     // [] = every day
}
export function daysLabel(r) {
  const d = bracketDays(r);
  if (!d.length) return "";
  if (d.join() === "1,2,3,4,5") return "Mon\u2013Fri";
  if (d.join() === "0,6") return "Sat\u2013Sun";
  return d.map(n => DAY_NAMES[n]).join(", ");
}
// The bracket that matches a minute-of-day on a weekday, or null. Several can cover the same time: a bracket limited to
// particular days beats an every-day one, and among those the one with the fewest days (the most specific) wins; ties go
// to the earlier one in the list.
export function ratioMatch(list, minutes, day) {
  let best = null, bestRank = Infinity;
  (list || []).forEach((r, i) => {
    if (!inRange(minutes, r.start, r.end)) return;
    const days = bracketDays(r);
    if (days.length && !days.includes(day)) return;
    const rank = (days.length ? days.length : 8) * 1000 + i;
    if (rank < bestRank) { best = r; bestRank = rank; }
  });
  return best;
}
// The ratio bracket in force at a moment; falls back to the first every-day one (else the first) so there is always an answer.
export function ratioAt(list, atDate) {
  const d = atDate || new Date();
  const minutes = d.getHours() * 60 + d.getMinutes();
  list = list || [];
  return ratioMatch(list, minutes, d.getDay()) || list.find(r => !bracketDays(r).length) || list[0] || null;
}
export function autoMealType(date) {
  const h = date.getHours() + date.getMinutes() / 60;
  if (h >= 5 && h < 10.5) return "breakfast";
  if (h >= 10.5 && h < 14.5) return "lunch";
  if (h >= 14.5 && h < 18) return "snack";
  if (h >= 18 && h < 22.5) return "dinner";
  return "snack";
}
export function formatDuration(ms) {
  const totalMin = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h${m}`;
}
export function clampNum(n, min, max) { return Math.min(max, Math.max(min, n)); }
