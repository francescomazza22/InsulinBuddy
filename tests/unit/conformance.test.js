// The conformance suite (tests/conformance/*.json): fixed inputs with the exact results the code gives today.
// A port of this app to another language (Swift, for the iOS app) loads the same JSON files and must reproduce every result.
//
// This test guards both directions:
//   1. the code still gives every recorded result, so a change in behaviour can never slip in unnoticed; and
//   2. the files on disk are exactly what the case list produces, so they can't go stale or be edited by hand.
// If you changed how something is calculated ON PURPOSE: run `node tools/make-conformance.mjs`, read the diff, and say so in the changelog.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildFixtures, runCase } from "../../tools/make-conformance.mjs";
import { FUNCTIONS } from "../../tools/conformance-adapters.mjs";

const dir = new URL("../conformance/", import.meta.url);
const files = fs.readdirSync(dir).filter(f => f.endsWith(".json")).sort();

test("there are fixtures, and a healthy number of them", () => {
  assert.ok(files.length >= 5);
  const total = files.reduce((n, f) => n + JSON.parse(fs.readFileSync(new URL(f, dir), "utf8")).length, 0);
  assert.ok(total >= 300, `only ${total} cases`);
});

for (const f of files) {
  const list = JSON.parse(fs.readFileSync(new URL(f, dir), "utf8"));
  test(`${f}: the code still gives every recorded result (${list.length} cases)`, () => {
    for (const c of list) {
      assert.ok(FUNCTIONS[c.fn], `no adapter for ${c.fn}`);
      assert.deepEqual(runCase(c), c.expect, c.name);
    }
  });
}

test("the files on disk are exactly what the case list produces (nothing stale, nothing hand-edited)", () => {
  const fresh = buildFixtures();
  assert.deepEqual(Object.keys(fresh).sort(), files.map(f => f.replace(".json", "")).sort(), "a group is missing or extra");
  for (const [group, list] of Object.entries(fresh)) {
    const onDisk = fs.readFileSync(new URL(`${group}.json`, dir), "utf8");
    assert.equal(onDisk, JSON.stringify(list, null, 1) + "\n", `${group}.json is out of date: run node tools/make-conformance.mjs and review the diff`);
  }
});

test("every adapter is exercised by at least one case", () => {
  const used = new Set();
  for (const f of files) for (const c of JSON.parse(fs.readFileSync(new URL(f, dir), "utf8"))) used.add(c.fn);
  const unused = Object.keys(FUNCTIONS).filter(k => !used.has(k));
  assert.deepEqual(unused, []);
});
