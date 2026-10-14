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
// The ratio bracket in force at a moment; falls back to the first one so there is always an answer.
export function ratioAt(list, atDate) {
  const d = atDate || new Date();
  const minutes = d.getHours() * 60 + d.getMinutes();
  list = list || [];
  return list.find(r => inRange(minutes, r.start, r.end)) || list[0] || null;
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
