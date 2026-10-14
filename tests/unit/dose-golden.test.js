// A fixed table of dose scenarios with the exact expected results (tests/unit/dose-golden.json). Each was checked by hand
// against the formulas when it was written. Any other implementation of the dose maths (a native app, a rewrite) must
// reproduce this table exactly. If a number here has to change, that is a change to how doses are worked out:
// do it on purpose, say so in the changelog, and never just "update the snapshot".
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { planDose, computeDose, checkDoseConsistency } from "../../js/calc.js";

const table = JSON.parse(fs.readFileSync(new URL("./dose-golden.json", import.meta.url), "utf8"));
const fix = input => ({ ...input, correctionUnits: input.correctionUnits === "NaN" ? NaN : input.correctionUnits });

test("golden table has real coverage", () => assert.ok(table.length >= 35));

for (const c of table) {
  test(`golden: ${c.name}`, () => {
    const p = planDose({ ...fix(c.input), settings: c.settings });
    assert.deepEqual({ mealDose: p.mealDose, correctionDose: p.correctionDose, finalDose: p.finalDose, capped: p.capped, overMax: p.overMax }, c.expect);
    assert.ok(Math.abs(p.mealDose + p.correctionDose - p.finalDose) < 0.005, "the parts must add up to the total");
  });
}

test("computeDose (the step-by-step text) always agrees with planDose on the numbers", () => {
  for (const c of table) {
    const i = c.input;
    if (i.mealUnits != null || i.correction === "manual") continue;     // those are typed doses; computeDose explains only the formula
    const d = computeDose({ carbs: i.carbs, ratio: i.ratio, correctionOn: i.correction === "auto", glucose: i.glucose, glucoseUnit: i.glucoseUnit, iob: i.iob || 0, noInsulin: !!i.noInsulin, settings: c.settings });
    assert.equal(d.finalDose, c.expect.finalDose, c.name);
    assert.equal(d.loggedMeal, c.expect.mealDose, c.name);
    assert.equal(d.loggedCorrection, c.expect.correctionDose, c.name);
    assert.ok(d.lines.length > 0);
  }
});

test("save guard: passes consistent doses, refuses mismatches", () => {
  const ok = { mealDose: 3, correctionDose: 0.5, finalDose: 3.5, shownText: "3.5" };
  assert.equal(checkDoseConsistency(ok), null);
  assert.equal(checkDoseConsistency({ mealDose: 3.25, correctionDose: 0, finalDose: 3.25, shownText: "3.3" }), null, "a typed 3.25 displays as 3.3");
  assert.match(checkDoseConsistency({ ...ok, correctionDose: 4 }), /do not match the calculated dose/);          // 19.5-from-15.0 style bug
  assert.match(checkDoseConsistency({ ...ok, shownText: "15.0" }), /number on screen/);
  assert.match(checkDoseConsistency({ ...ok, mealDose: NaN }), /could not be worked out/);
  assert.match(checkDoseConsistency({ ...ok, mealDose: -1 }), /could not be worked out/);
  assert.equal(checkDoseConsistency({ mealDose: 0, correctionDose: 0, finalDose: 0, shownText: "0.0", noInsulin: true }), null);
  assert.match(checkDoseConsistency({ mealDose: 2, correctionDose: 0, finalDose: 0, shownText: "0.0", noInsulin: true }), /no insulin/);
});
