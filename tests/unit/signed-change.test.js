// 2.77.2: a glucose change that rounds to zero showed as "−0 mg/dL" (Insights > Activity and glucose: an average
// change of -0.3). The sign must follow the number actually shown.
import test from "node:test";
import assert from "node:assert/strict";
import { signedChange } from "../../js/util.js";

const mg = v => String(Math.round(v));
const mmol = v => String(Math.round(v / 18.0182 * 10) / 10);

test("a change that rounds to zero has no sign", () => {
  assert.equal(signedChange(-0.3, mg), "0");
  assert.equal(signedChange(0.4, mg), "0");
  assert.equal(signedChange(-0, mg), "0");
  assert.equal(signedChange(0, mg), "0");
  assert.equal(signedChange(-0.8, mmol), "0");   // -0.04 mmol/L
});

test("real rises and falls keep their sign (a true minus sign, not a hyphen)", () => {
  assert.equal(signedChange(2, mg), "+2");
  assert.equal(signedChange(-12.6, mg), "−13");
  assert.equal(signedChange(-0.6, mg), "−1");
  assert.equal(signedChange(-36, mmol), "−2");
});

test("no value shows a dash", () => {
  assert.equal(signedChange(null, mg), "—");
  assert.equal(signedChange(undefined, mg), "—");
  assert.equal(signedChange(NaN, mg), "—");
});
