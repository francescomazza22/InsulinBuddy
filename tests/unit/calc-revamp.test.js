// 2.81.0 Calculator revamp: the mode chip's words, the Log button's words and the day bars' mark past the target.
import test from "node:test";
import assert from "node:assert/strict";
import { modeChipLabel, logButtonLabel, doseText } from "../../js/calc-labels.js";
import { overBar } from "../../js/daily-carbs.js";

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);

test("mode chip says what is on", () => {
  assert.equal(modeChipLabel({}), "Meal");
  assert.equal(modeChipLabel({ correctionOn: true }), "Correction");
  assert.equal(modeChipLabel({ correctionOn: true, hasFood: true }), "Meal + correction");
  assert.equal(modeChipLabel({ noInsulinOn: true }), "Treating a low");
  assert.equal(modeChipLabel({ eatingOutOn: true }), "Eating out");
  assert.equal(modeChipLabel({ eatingOutOn: true, correctionOn: true }), "Eating out + correction");
});

test("dose text keeps a second decimal only when there is one", () => {
  assert.equal(doseText(2.5), "2.5");
  assert.equal(doseText(2), "2.0");
  assert.equal(doseText(2.45), "2.45");
  assert.equal(doseText(0), "0.0");
});

test("Log button repeats the dose and carbs it will log", () => {
  const base = { hasDose: true, empty: false, noInsulinOn: false, eatingOutOn: false };
  assert.equal(logButtonLabel({ ...base, finalDose: 2.5, carbs: 37.5 }), "Log 2.5 u · 37.5g carbs");
  assert.equal(logButtonLabel({ ...base, finalDose: 1.5, carbs: 0 }), "Log 1.5 u correction");
  assert.equal(logButtonLabel({ ...base, eatingOutOn: true, finalDose: 4, carbs: 0 }), "Log 4.0 u · eating out");
  assert.equal(logButtonLabel({ ...base, noInsulinOn: true, finalDose: 0, carbs: 15 }), "Log treated low · 15g carbs");
  assert.equal(logButtonLabel({ hasDose: false, empty: true, finalDose: 0, carbs: 0 }), "Add food to log a meal");
  assert.equal(logButtonLabel({ hasDose: false, empty: false, noInsulinOn: true, finalDose: 0, carbs: 0 }), "Add the carbs you had");
  assert.equal(logButtonLabel({ hasDose: false, empty: false, finalDose: 0, carbs: 0 }), "Log Meal to History");
});

test("under the target the bar is as before: no mark, nothing coloured", () => {
  const g = overBar({ logged: 90, draft: 46, target: 180 });
  near(g.fill, 0.5, "fill"); near(g.draft, 46 / 180, "draft");
  assert.equal(g.tick, null); assert.equal(g.fillOverFrom, null); assert.equal(g.draftOverFrom, null); assert.equal(g.over, false);
});

test("past the target: the mark moves in and the part past it is coloured (his 3 Nov case, 296 g of 263)", () => {
  const g = overBar({ logged: 296, draft: 0, target: 263 });
  assert.equal(g.over, true);
  near(g.fill, 1, "logged fills the bar");
  near(g.tick, 263 / 296, "mark at the average");
  near(g.fillOverFrom, 263 / 296, "orange from the mark");
  assert.equal(g.draftOverFrom, null);
});

test("a meal that takes the day past the target colours only its own part past the mark", () => {
  const g = overBar({ logged: 150, draft: 100, target: 200 });   // 250 of 200
  near(g.fill, 150 / 250, "fill"); near(g.draft, 100 / 250, "draft");
  near(g.tick, 200 / 250, "mark");
  assert.equal(g.fillOverFrom, null);
  near(g.draftOverFrom, 0.5, "half the meal is past the target");
  near(g.fill + g.draft, 1, "never past the end");
});

test("far past the target the bar stops growing at twice the target and never overflows", () => {
  const g = overBar({ logged: 500, draft: 200, target: 100 });
  near(g.tick, 0.5, "mark at half"); near(g.fill, 1, "fill"); near(g.draft, 0, "draft has no room left");
  assert.equal(overBar({ logged: 10, target: 0 }).fill, 0);
  assert.equal(overBar({ logged: NaN, draft: -5, target: 100 }).fill, 0);
});
