// Regenerates tests/conformance/*.json from the real code. Run it on purpose, after a deliberate change to how something is
// calculated, and read the diff: every changed number is a behaviour change. Never run it just to make a failing test pass.
import fs from "node:fs";
import { FUNCTIONS } from "./conformance-adapters.mjs";
import { CASES } from "./conformance-cases.mjs";

// JSON can't hold NaN, Infinity or undefined; spell them out so a port can read them back the same way.
export function toJsonSafe(value) {
  return JSON.parse(JSON.stringify(value, (k, v) => (typeof v === "number" && !Number.isFinite(v) ? (Number.isNaN(v) ? "NaN" : v > 0 ? "Infinity" : "-Infinity") : v)) ?? "null");
}
export function runCase(c) {
  const args = c.args.map(a => (a === undefined ? null : a));
  return toJsonSafe(FUNCTIONS[c.fn](...structuredClone(args)));
}
export function buildFixtures() {
  const files = {};
  for (const [group, list] of Object.entries(CASES)) {
    const seen = new Set();
    files[group] = list.map(c => {
      if (!FUNCTIONS[c.fn]) throw new Error(`No adapter for ${c.fn}`);
      if (seen.has(c.name)) throw new Error(`Duplicate case name in ${group}: ${c.name}`);
      seen.add(c.name);
      return { name: c.name, fn: c.fn, args: toJsonSafe(c.args), expect: runCase(c) };
    });
  }
  return files;
}
if (process.argv[1] && process.argv[1].endsWith("make-conformance.mjs")) {
  const dir = new URL("../tests/conformance/", import.meta.url);
  fs.mkdirSync(dir, { recursive: true });
  let total = 0;
  for (const [group, list] of Object.entries(buildFixtures())) {
    fs.writeFileSync(new URL(`${group}.json`, dir), JSON.stringify(list, null, 1) + "\n");
    total += list.length;
    console.log(group.padEnd(8), list.length);
  }
  console.log("total   ", total);
}
