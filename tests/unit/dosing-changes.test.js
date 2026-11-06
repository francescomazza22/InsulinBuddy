import test from "node:test";
import assert from "node:assert/strict";
import { dosingChanges } from "../../js/dosing-changes.js";

const real = { timeRatios: [{ id: "tr-morning", name: "Morning", ratio: 12 }, { id: "tr-lunch", name: "Lunch", ratio: 6 }], activityRatios: [{ id: "ar-sport", name: "Sport", ratio: 18 }],
  target: 165, isf: 50, maxDose: 40, units: "mgdl", basalBaseline: { am: 10, pm: 18 }, nightscoutUrl: "https://x?token=1", darkMode: true };

test("nothing dose-relevant changed: no lines", () => {
  assert.deepEqual(dosingChanges(real, { ...real, darkMode: false, palette: "redOrange" }), []);
  assert.deepEqual(dosingChanges(real, structuredClone(real)), []);
});

test("the 6 Nov reset is spelled out", () => {
  const factory = { timeRatios: [{ id: "tr-morning", name: "Morning", ratio: 10 }, { id: "tr-lunch", name: "Lunch", ratio: 8 }], activityRatios: [{ id: "ar-sport", name: "Sport", ratio: 18 }],
    target: 100, isf: 50, maxDose: 15, units: "mgdl", basalBaseline: { am: null, pm: null }, nightscoutUrl: "" };
  assert.deepEqual(dosingChanges(real, factory), [
    "Morning: 1u:12g → 1u:10g", "Lunch: 1u:6g → 1u:8g", "Target: 165 → 100 mg/dL", "Max dose: 40 → 15 u",
    "Usual morning basal: 10 → not set", "Usual evening basal: 18 → not set", "Nightscout: the link was removed"
  ]);
});

test("new, removed and renamed ratios; correction factor with its unit", () => {
  const after = { ...real, timeRatios: [{ id: "tr-morning", name: "Breakfast", ratio: 12 }, { id: "tr-x", name: "Snack", ratio: 20 }], isf: 2.5 };
  const lines = dosingChanges(real, after, { glucoseUnit: "mmol/L" });
  assert.ok(lines.includes("Snack: new ratio 1u:20g"));
  assert.ok(lines.includes("Lunch: removed (was 1u:6g)"));
  assert.ok(lines.includes("Correction factor: 50 → 2.5 mmol/L per unit"));
  assert.ok(!lines.some(l => l.startsWith("Breakfast")), "a rename alone isn't a dose change");
});

test("junk never throws", () => {
  assert.deepEqual(dosingChanges(null, undefined), []);
  assert.doesNotThrow(() => dosingChanges({ timeRatios: "x", basalBaseline: 3 }, { timeRatios: [null, {}] }));
});
