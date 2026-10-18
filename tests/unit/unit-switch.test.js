import test from "node:test";
import assert from "node:assert/strict";
import { convertDosingSetting } from "../../js/calc.js";

test("100 mg/dL target becomes 5.5 mmol/L, not 100 mmol/L", () => assert.equal(convertDosingSetting(100, "mgdl", "mmol"), 5.5));
test("a correction factor of 50 mg/dL per unit becomes 2.8 mmol/L", () => assert.equal(convertDosingSetting(50, "mgdl", "mmol"), 2.8));
test("5.6 mmol/L back to mg/dL is 101 (whole numbers)", () => assert.equal(convertDosingSetting(5.6, "mmol", "mgdl"), 101));
test("same unit or unreadable values are left alone", () => {
  assert.equal(convertDosingSetting(100, "mgdl", "mgdl"), 100);
  assert.ok(Number.isNaN(convertDosingSetting(NaN, "mgdl", "mmol")));
});
test("never converts to zero", () => { assert.equal(convertDosingSetting(0.5, "mgdl", "mmol"), 0.1); assert.equal(convertDosingSetting(0.2, "mmol", "mgdl"), 4); });
