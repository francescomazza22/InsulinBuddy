// Swipe-to-reveal maths for the log rows (Edit / Delete behind each row). Pure functions, so the feel can be tested.
//
//  - swipeAxis: decides, once the finger has moved a few pixels, whether this is a sideways swipe or a scroll. A thumb
//    rarely moves perfectly sideways, so anything more sideways than up/down counts (it used to need 1.4x, which turned
//    most real swipes into scrolls that did nothing).
//  - swipePos: where the row sits while dragging. It follows the finger 1:1 from where the swipe was recognised (no jump),
//    and past either end it slows down (rubber band) instead of stopping dead.
//  - swipeSettle: open or closed when the finger lifts. A quick flick decides by its direction, however short;
//    a slow drag decides by how far it got (more than 40% of the way).

export const SWIPE_START = 6;          // px moved before the direction is decided
export const FLICK_SPEED = 0.35;       // px per ms: faster than this counts as a flick
export const OPEN_FRACTION = 0.4;      // a slow drag past 40% of the width opens

export function swipeAxis(dx, dy, start = SWIPE_START) {
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (ax < start && ay < start) return null;     // not moved enough to tell yet
  return ax > ay ? "h" : "v";
}

export function swipePos(base, dx, width) {
  const raw = base + dx;
  const rubber = over => over * 0.35;                // past an end, the row moves a third as far as the finger
  if (raw > 0) return rubber(raw);
  if (raw < -width) return -width - rubber(-width - raw);
  return raw;
}

export function swipeSettle({ pos, velocity, width }) {
  if (velocity <= -FLICK_SPEED) return true;         // flicked left: open
  if (velocity >= FLICK_SPEED) return false;         // flicked right: close
  return pos < -width * OPEN_FRACTION;
}

// Finger speed over the last ~100 ms of samples [{ x, t }], in px per ms (negative = moving left).
export function swipeVelocity(samples, now) {
  const recent = samples.filter(s => now - s.t <= 100);
  if (recent.length < 2) return 0;
  const a = recent[0], b = recent[recent.length - 1];
  return b.t > a.t ? (b.x - a.x) / (b.t - a.t) : 0;
}

// ---- Day view (2.68.1): flick sideways to change day ----
export const DAY_DRAG_FRACTION = 0.25;   // a slow drag past a quarter of the width changes day
export const DAY_FLICK_MIN_PX = 30;      // a flick still has to travel this far (a tap that wobbles is not a flick)

export const FLICK_WINDOW_MS = 120;     // speed is measured over the last moments of movement
export const FLICK_STOP_MS = 120;       // a finger still this long before lifting was a drag, not a flick

/** Finger speed at the end of a swipe, in px per ms (negative = moving left), measured over the last FLICK_WINDOW_MS of
 * movement before the last sample (not before the lift: phones send few, merged updates during a fast flick, so the last
 * one can be a while before the finger leaves). 0 when the finger had stopped for FLICK_STOP_MS before lifting. */
export function flickVelocity(samples, endT) {
  if (!samples || samples.length < 2) return 0;
  const last = samples[samples.length - 1];
  if (endT - last.t > FLICK_STOP_MS) return 0;
  let first = last;
  for (let i = samples.length - 2; i >= 0 && last.t - samples[i].t <= FLICK_WINDOW_MS; i--) first = samples[i];
  if (first === last) first = samples[samples.length - 2];   // two updates further apart than the window: use the pair
  return last.t > first.t ? (last.x - first.x) / (last.t - first.t) : 0;
}

/** Where a day swipe ends up: -1 for the previous day (finger moved right), 1 for the next day (moved left), 0 to stay.
 * A quick flick decides by its direction; a slow drag by how far it got. `canNext` false (already today) never gives 1. */
export function daySwipeResult({ dx, velocity, width, canNext = true, canPrev = true }) {
  const far = Math.abs(dx) >= width * DAY_DRAG_FRACTION;
  const flick = Math.abs(velocity) >= FLICK_SPEED && Math.abs(dx) >= DAY_FLICK_MIN_PX && Math.sign(velocity) === Math.sign(dx);
  if (!far && !flick) return 0;
  const dir = dx > 0 ? -1 : 1;
  if (dir === 1 && !canNext) return 0;
  if (dir === -1 && !canPrev) return 0;
  return dir;
}

/** How far the day content follows the finger: 1:1, but only a third as far towards a day it can't go to. */
export function daySwipeOffset(dx, { canNext = true, canPrev = true } = {}) {
  if ((dx < 0 && !canNext) || (dx > 0 && !canPrev)) return dx * 0.35;
  return dx;
}
