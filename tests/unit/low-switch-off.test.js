// 2.105.2: Treating a low switched off by hand stays off for that low only (his 16 Nov 05:31 screenshot: 66 mg/dL, still off
// from a switch-off the night before, because the low ended while the app was closed).
import test from "node:test";
import assert from "node:assert/strict";
import { lowSwitchOffApplies, LOW_OFF_MAX_MS } from "../../js/calc-labels.js";

const H = 3600000, now = Date.UTC(2026, 10, 16, 5, 31), r = (h, sgv) => ({ date: now - h * H, sgv });

test("still the same low: the switch-off holds", () => {
  assert.equal(lowSwitchOffApplies(now - 1 * H, [r(0, 60), r(0.5, 64), r(1.5, 59)], now), true);
  assert.equal(lowSwitchOffApplies(now - 1 * H, [], now), true, "no readings since: nothing says the low ended");
});
test("a reading of 70+ after the switch-off ends it, even one heard about later", () => {
  assert.equal(lowSwitchOffApplies(now - 2 * H, [r(0, 66), r(0.5, 72), r(1.5, 110)], now), false);
  assert.equal(lowSwitchOffApplies(now - 2 * H, [r(0, 66), r(3, 140)], now), true, "a 70+ BEFORE the switch-off doesn't count");
});
test("it runs out after 3 hours, and an old value with no time is forgotten", () => {
  assert.equal(LOW_OFF_MAX_MS, 3 * H);
  assert.equal(lowSwitchOffApplies(now - 3.1 * H, [r(0, 60)], now), false);
  assert.equal(lowSwitchOffApplies(1, [], now), false, "the '1' older versions stored");
  assert.equal(lowSwitchOffApplies(0, [], now), false);
  assert.equal(lowSwitchOffApplies(NaN, [], now), false);
  assert.equal(lowSwitchOffApplies(now + 2 * H, [], now), false, "a time in the future (clock changed) is not trusted");
});
test("bad readings are ignored", () => {
  assert.equal(lowSwitchOffApplies(now - H, [null, { date: NaN, sgv: 200 }, { date: now, sgv: "90" }], now), true);
});
