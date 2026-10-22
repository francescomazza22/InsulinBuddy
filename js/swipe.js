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
