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
