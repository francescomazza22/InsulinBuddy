import { test } from "node:test";
import assert from "node:assert/strict";
import { swipeAxis, swipePos, swipeSettle, swipeVelocity } from "../../js/swipe.js";

const W = 144;

test("direction: waits for a few pixels, then any mostly-sideways move is a swipe", () => {
  assert.equal(swipeAxis(3, 2), null, "too small to tell");
  assert.equal(swipeAxis(-10, -7), "h", "a diagonal thumb (10 across, 7 down) is a swipe -- it used to be read as a scroll");
  assert.equal(swipeAxis(-6, -8), "v", "more up/down than across is a scroll");
  assert.equal(swipeAxis(0, 12), "v");
});

test("position: follows the finger 1:1 inside the range, with a rubber band past either end", () => {
  assert.equal(swipePos(0, -50, W), -50);
  assert.equal(swipePos(-W, 30, W), -W + 30, "dragging an open row back");
  assert.ok(swipePos(0, 40, W) > 0 && swipePos(0, 40, W) < 20, "dragging right on a closed row barely moves it");
  const past = swipePos(0, -W - 60, W);
  assert.ok(past < -W && past > -W - 30, "dragging beyond the buttons slows down");
});

test("release: a flick decides by direction, a slow drag by distance", () => {
  assert.equal(swipeSettle({ pos: -30, velocity: -0.6, width: W }), true, "a short quick flick left opens");
  assert.equal(swipeSettle({ pos: -120, velocity: 0.6, width: W }), false, "a quick flick right closes even from far open");
  assert.equal(swipeSettle({ pos: -60, velocity: -0.05, width: W }), true, "a slow drag past 40% opens");
  assert.equal(swipeSettle({ pos: -50, velocity: 0, width: W }), false, "a slow drag short of 40% springs back");
});

test("velocity: measured over the last 100 ms only", () => {
  const s = [{ x: 200, t: 0 }, { x: 190, t: 300 }, { x: 150, t: 350 }, { x: 110, t: 400 }];
  assert.equal(swipeVelocity(s, 400), -0.8, "(110 - 190) / (400 - 300): only the samples from the last 100 ms count");
  assert.equal(swipeVelocity([{ x: 0, t: 0 }], 10), 0);
});

// ---- Day view flick (2.68.1) ----
import { daySwipeResult, daySwipeOffset, flickVelocity } from "../../js/swipe.js";
test("day swipe: finger right = previous day, left = next day", () => {
  assert.equal(daySwipeResult({ dx: 120, velocity: 0.1, width: 360 }), -1);   // slow drag past a quarter
  assert.equal(daySwipeResult({ dx: -120, velocity: -0.1, width: 360 }), 1);
  assert.equal(daySwipeResult({ dx: 60, velocity: 0.1, width: 360 }), 0);     // slow and short: stays
  assert.equal(daySwipeResult({ dx: 40, velocity: 0.6, width: 360 }), -1);    // short but quick: a flick
  assert.equal(daySwipeResult({ dx: 20, velocity: 0.9, width: 360 }), 0);     // too short to be a flick
  assert.equal(daySwipeResult({ dx: 60, velocity: -0.6, width: 360 }), 0);    // flick back the other way: stays
});
test("day swipe: no next day past today, no previous past the limit", () => {
  assert.equal(daySwipeResult({ dx: -200, velocity: -1, width: 360, canNext: false }), 0);
  assert.equal(daySwipeResult({ dx: 200, velocity: 1, width: 360, canNext: false }), -1);
  assert.equal(daySwipeResult({ dx: 200, velocity: 1, width: 360, canPrev: false }), 0);
  assert.equal(daySwipeOffset(-100, { canNext: false }), -35);
  assert.equal(daySwipeOffset(100, { canNext: false }), 100);
  assert.equal(daySwipeOffset(-100), -100);
});

test("flick speed: measured over the last moments of movement, even when updates are sparse", () => {
  // What a headless/merged-update flick looked like: 4 samples ~35 ms apart, lift 50-70 ms after the last one.
  const sparse = [{ x: 0, t: 0 }, { x: 41, t: 35 }, { x: 83, t: 70 }, { x: 124, t: 105 }];
  assert.ok(flickVelocity(sparse, 160) > 1, String(flickVelocity(sparse, 160)));
  assert.ok(flickVelocity(sparse.map(s => ({ ...s, x: -s.x })), 165) < -1);
  // Only two updates, far apart: the pair is used.
  assert.equal(flickVelocity([{ x: 0, t: 0 }, { x: 150, t: 200 }], 210), 0.75);
  // The finger stopped before lifting: a drag, not a flick.
  assert.equal(flickVelocity(sparse, 400), 0);
  // Old movement outside the window doesn't dilute the end speed.
  const slowThenFast = [{ x: 0, t: 0 }, { x: 10, t: 300 }, { x: 20, t: 600 }, { x: 80, t: 640 }, { x: 140, t: 680 }];
  assert.equal(flickVelocity(slowThenFast, 690), 1.5);
  assert.equal(flickVelocity([], 10), 0);
  assert.equal(flickVelocity([{ x: 5, t: 1 }], 10), 0);
});
