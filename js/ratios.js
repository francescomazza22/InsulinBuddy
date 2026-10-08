// Insulin-to-carb ratios by time of day. Pure: the ratio list is passed in, so this is testable in Node.

/** "13:30" -> 810 (minutes after midnight). */
export function toMinutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** Is `minutes` (after midnight) inside start..end? A range can wrap past midnight ("23:30" to "05:30"). */
export function inTimeRange(minutes, start, end) {
  const s = toMinutes(start), e = toMinutes(end);
  if (s === e) return true;
  if (s < e) return minutes >= s && minutes < e;
  return minutes >= s || minutes < e; // wraps past midnight
}

/** The time-of-day ratio that applies at `atDate` (default now): the first range containing it, else the first one. */
export function timeRatioAt(timeRatios, atDate = new Date()) {
  const minutes = atDate.getHours() * 60 + atDate.getMinutes();
  return timeRatios.find(r => inTimeRange(minutes, r.start, r.end)) || timeRatios[0] || null;
}
