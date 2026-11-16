// Stress test for merging meals (2.105.0). Random histories built the way the Calculator builds them (buildMealEntry, with
// corrections, extras, quantity foods, treated lows), merged in random groups, nested merges, and synced between devices.
// Rules: active insulin and carbs never change at any moment; doses add up exactly; carbs within rounding; every merged
// entry is valid; undo gives back exactly what was there; a merge on one device carries over to another. Seeded; STRESS_N
// scales it.
import test from "node:test";
import assert from "node:assert/strict";
import { buildMealEntry } from "../../js/core/meal-entry.js";
import { activeAt, activeParts } from "../../js/calc.js";
import { mergeMeals, mergeBlockReason, mergeSources } from "../../js/merge-meals.js";
import { validateEntry } from "../../js/core/schema.js";
import { mergeStates, normalizeState, makeFingerprint, stampChanges } from "../../js/state.js";
import { round1 } from "../../js/util.js";

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const N = Number(process.env.STRESS_N || 600);
const MIN = 60000, HOUR = 3600000;
const pick = (r, l) => l[Math.floor(r() * l.length)];
const NOW = new Date(2026, 10, 16, 12, 0).getTime();
const r2 = v => Math.round(v * 100) / 100;

function item(r) {
  if (r() < 0.25) {   // a quantity food, maybe as a fraction
    const q = pick(r, [0.25, 1 / 3, 0.5, 1, 1.5, 2]), gpu = pick(r, [30, 45, 60]), cp = pick(r, [20, 45, 60]);
    return { refType: "food", refId: "q" + Math.floor(r() * 3), name: pick(r, ["Cake", "Slice", "Biscuit"]), grams: q * gpu, quantity: q, unitLabel: "slice", gramsPerUnit: gpu,
      gi: r() < 0.5 ? 60 : null, carbsPer100g: cp, kcalPer100g: 300, carbs: Math.round(cp * q * gpu) / 100, kcal: Math.round(3 * q * gpu), ...(q < 1 ? { portion: "1/" + Math.round(1 / q) } : {}) };
  }
  const cp = pick(r, [3.5, 12, 23, 47.3, 65, 75.5, 100]), g = round1(pick(r, [7.5, 12, 34.6, 50, 80.4, 125, 300]) * (r() < 0.3 ? r() + 0.5 : 1));
  return { refType: r() < 0.2 ? "recipe" : "food", refId: "f" + Math.floor(r() * 5), name: pick(r, ["Pane", "Pasta", "Banana", "Mela", "Riso"]), grams: g,
    quantity: null, unitLabel: null, gramsPerUnit: null, gi: r() < 0.7 ? Math.round(20 + r() * 80) : null, carbsPer100g: cp, kcalPer100g: 250, carbs: Math.round(cp * g) / 100, kcal: Math.round(2.5 * g) };
}
function meal(r, ts, kind) {
  const items = kind === "correction" ? [] : Array.from({ length: 1 + Math.floor(r() * 4) }, () => item(r));
  const low = kind === "low";
  const mealDose = low || kind === "correction" ? 0 : pick(r, [0.5, 1, 2.5, 3.7, 6, 9.25]);
  const corr = low ? 0 : kind === "correction" ? pick(r, [0.5, 1, 2]) : pick(r, [0, 0, 0.5, 1.5, -0.5]);
  const extra = !low && r() < 0.2 ? pick(r, [0.5, 1]) : 0;
  return buildMealEntry({ now: new Date(ts), mealType: kind === "correction" ? "correction" : low ? "snack" : pick(r, ["breakfast", "lunch", "dinner", "snack"]),
    periodEntry: { name: "Lunch" }, ratioEntry: { name: "Lunch", ratio: pick(r, [8, 10, 12]) }, items, eatingOut: false, noInsulin: low,
    computed: { mealDose: mealDose + (extra && mealDose ? extra : 0), correctionDose: corr, extraDose: extra && mealDose ? extra : 0 }, glucoseVal: r() < 0.5 ? Math.round(60 + r() * 200) : null });
}
const settingsR = r => ({ insulinModel: { diaMinutes: pick(r, [180, 240, 300, 360, 480]), peakMinutes: pick(r, [55, 65, 75, 90]) }, carbAbsorptionMinutes: { high: 120, medium: 180, low: 240, unknown: 180 } });
function history(r) {
  const out = [];
  let t = NOW - Math.floor(r() * 6 * HOUR);
  const lows = r() < 0.15;
  for (let k = 0, n = 2 + Math.floor(r() * 6); k < n; k++) {
    out.push(meal(r, t, lows ? "low" : r() < 0.1 ? "correction" : "meal"));
    out[out.length - 1].id = `h-${t}-${k}`;
    t += Math.floor(r() * 90 + 1) * MIN;
  }
  // things that can't be merged sit in between
  out.push({ id: "bas", ts: NOW - 3 * HOUR, entryType: "basal", mealType: "basal", basalDose: 18, basalSlot: "am", items: [], totalCarbs: 0, totalKcal: 0, mealDose: 0, correctionDose: 0, noInsulin: false, glucose: null });
  out.push({ id: "act", ts: NOW - 2 * HOUR, entryType: "activity", mealType: "activity", activityType: "walk", durationMin: 30, items: [], totalCarbs: 0, totalKcal: 0, mealDose: 0, correctionDose: 0, noInsulin: false, glucose: null });
  return out.sort((a, b) => b.ts - a.ts);
}
const meals = h => h.filter(e => e.entryType !== "basal" && e.entryType !== "activity");
function applyMerge(h, picked, id) {
  const ids = new Set(picked.map(p => p.id));
  return [...h.filter(e => !ids.has(e.id)), mergeMeals(picked, { id })].sort((a, b) => b.ts - a.ts);
}
function sameActive(before, after, settings, ctx) {
  const t0 = Math.min(...before.map(e => e.ts)) - 10 * MIN, t1 = Math.max(...before.map(e => e.ts)) + 9 * HOUR;
  for (let t = t0; t <= t1; t += 7 * MIN) {
    const a = activeAt(before, settings, t), b = activeAt(after, settings, t);
    assert.deepEqual(b, a, `${ctx}: active insulin/carbs changed at +${Math.round((t - t0) / MIN)} min`);
  }
}

test(`merging never changes active insulin or carbs, and adds up (${N} histories)`, () => {
  for (let i = 0; i < N; i++) {
    const seed = 50000 + i, r = rng(seed), ctx = `seed ${seed}`;
    const h = history(r), settings = settingsR(r);
    const ms = meals(h);
    const picked = ms.filter(() => r() < 0.7);
    if (picked.length < 2) picked.splice(0, picked.length, ...ms.slice(0, 2));
    assert.equal(mergeBlockReason(picked), null, `${ctx}: a valid group was refused`);
    const before = structuredClone(h);
    const after = applyMerge(h, picked, "m1");
    const m = after.find(e => e.id === "m1");
    // rules on the merged entry
    assert.deepEqual(validateEntry(m).filter(p => p.severity === "error" || p.level === "error"), [], `${ctx}: invalid merged entry`);
    assert.equal(m.ts, Math.min(...picked.map(p => p.ts)), `${ctx}: not at the first meal's time`);
    assert.equal(m.mealDose, r2(picked.reduce((s, p) => s + p.mealDose, 0)), `${ctx}: meal insulin doesn't add up`);
    assert.equal(m.correctionDose, r2(picked.reduce((s, p) => s + p.correctionDose, 0)), `${ctx}: correction doesn't add up`);
    assert.ok(Math.abs(m.totalCarbs - picked.reduce((s, p) => s + p.totalCarbs, 0)) <= 0.05 * picked.length + 0.051, `${ctx}: carbs ${m.totalCarbs} vs ${picked.reduce((s, p) => s + p.totalCarbs, 0)}`);
    assert.ok(Math.abs(m.items.reduce((s, x) => s + x.carbs, 0) - picked.reduce((s, p) => s + p.items.reduce((a, x) => a + x.carbs, 0), 0)) < 1e-9, `${ctx}: item carbs lost`);
    assert.equal(m.noInsulin, picked.every(p => p.noInsulin), `${ctx}: treated-low flag`);
    assert.equal(activeParts(m).length, picked.length, `${ctx}: the merged meal isn't read as its parts (carbs ${m.totalCarbs})`);
    assert.deepEqual(h, before, `${ctx}: merging changed the originals`);
    sameActive(before, after, settings, ctx);
    // a second merge on top (nested), with whatever is left
    const left = meals(after).filter(e => e.id !== "m1");
    if (left.length) {
      const again = applyMerge(after, [after.find(e => e.id === "m1"), left[0]], "m2");
      const m2 = again.find(e => e.id === "m2");
      if (!mergeBlockReason([m, left[0]])) {
        assert.deepEqual(mergeSources(m2).map(s => s.id).sort(), [...picked, left[0]].map(s => s.id).sort(), `${ctx}: nested merge lost an original`);
        sameActive(before, again, settings, ctx + " (nested)");
      }
    }
    // undo puts back exactly what was there
    const undone = [...after.filter(e => e.id !== "m1"), ...picked].sort((a, b) => b.ts - a.ts);
    assert.deepEqual(undone, before, `${ctx}: undo didn't give back the same history`);
  }
});

test(`groups that must be refused are refused (${N} tries)`, () => {
  for (let i = 0; i < N; i++) {
    const seed = 60000 + i, r = rng(seed), ctx = `seed ${seed}`;
    const a = meal(r, NOW, "meal"); a.id = "a";
    const b = meal(r, NOW + HOUR, "meal"); b.id = "b";
    const bad = pick(r, [
      () => [a, { ...b, carbsUnknown: true, items: [] }],
      () => [a, { ...meal(r, NOW, "low"), id: "l" }],
      () => [a, { id: "x", ts: NOW, entryType: "basal", mealType: "basal", basalDose: 10 }],
      () => [a, { id: "y", ts: NOW, entryType: "activity", mealType: "activity", durationMin: 20 }],
      () => [a, a],
      () => [a]
    ])();
    assert.ok(mergeBlockReason(bad), `${ctx}: refused group was allowed`);
  }
});

test(`a merge on one device carries over to the other, and stays put (${Math.ceil(N / 3)} pairs)`, () => {
  const defaults = () => ({ settings: { units: "mgdl", isf: 50, target: 100, rounding: "0.5", maxDose: 15, timeRatios: [{ id: "t1", name: "All", start: "00:00", end: "23:59", ratio: 10 }], activityRatios: [], insulinModel: { preset: "rapid", peakMinutes: 75, diaMinutes: 360 }, carbAbsorptionMinutes: { high: 120, medium: 180, low: 240, unknown: 180 } }, library: [], recipes: [], history: [] });
  for (let i = 0; i < Math.ceil(N / 3); i++) {
    const seed = 70000 + i, r = rng(seed), ctx = `seed ${seed}`;
    const h = history(r);
    const base = normalizeState({ ...defaults(), history: h.map(e => ({ ...e, updatedAt: NOW - HOUR })) }, defaults);
    // device A merges two meals
    const A = structuredClone(base);
    let fp = makeFingerprint(A);
    const ms = meals(A.history), picked = ms.slice(0, 2);
    A.history = applyMerge(A.history, picked, "m-" + seed);
    fp = stampChanges(A, fp, NOW + 1000);
    const B = structuredClone(base);   // device B saw nothing yet
    for (const [x, y] of [[A, B], [B, A]]) {
      const s = mergeStates(x, y, defaults);
      const ids = s.history.map(e => e.id);
      assert.ok(ids.includes("m-" + seed), `${ctx}: the merged meal didn't reach the other device`);
      assert.ok(!picked.some(p => ids.includes(p.id)), `${ctx}: an original came back next to the merged meal (insulin counted twice)`);
      const settings = settingsR(r);
      for (let t = NOW - 8 * HOUR; t < NOW + 10 * HOUR; t += 23 * MIN) assert.deepEqual(activeAt(s.history, settings, t), activeAt(A.history, settings, t), `${ctx}: active insulin differs after sync`);
    }
  }
});
