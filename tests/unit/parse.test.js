import test from "node:test";
import assert from "node:assert/strict";
import { parseDecimalInput } from "../../js/util.js";

test("a decimal point and a decimal comma both read as the number meant", () => {
  const cases = { "2": 2, "10": 10, "1.5": 1.5, "1,5": 1.5, "0.5": 0.5, "0,5": 0.5, ".5": 0.5, ",5": 0.5, "00.5": 0.5, "0": 0, "2.25": 2.25, "2,25": 2.25 };
  for (const [text, want] of Object.entries(cases)) assert.equal(parseDecimalInput(text), want, `"${text}"`);
});

test("REGRESSION: a typed comma is never swallowed. 1,5 is 1.5 units, not 15, and 0,5 is 0.5, not 5 (a browser number box did exactly that)", () => {
  assert.equal(parseDecimalInput("1,5"), 1.5); assert.notEqual(parseDecimalInput("1,5"), 15);
  assert.equal(parseDecimalInput("0,5"), 0.5); assert.notEqual(parseDecimalInput("0,5"), 5);
});

test("surrounding spaces are ignored, and a trailing separator while still typing is fine", () => {
  assert.equal(parseDecimalInput("  2 "), 2); assert.equal(parseDecimalInput("2."), 2); assert.equal(parseDecimalInput("2,"), 2);
});

test("anything that isn't a plain number is refused outright, never guessed at", () => {
  for (const text of ["", " ", "abc", "1.2.3", "1,2,3", "1,5.5", "12a", "a12", "-1", "+1", "1e3", "1 5", ".", ",", "٣", "Infinity", "NaN", "0x10"])
    assert.ok(Number.isNaN(parseDecimalInput(text)), `"${text}" should be refused but gave ${parseDecimalInput(text)}`);
  assert.ok(Number.isNaN(parseDecimalInput(null)) && Number.isNaN(parseDecimalInput(undefined)));
});
