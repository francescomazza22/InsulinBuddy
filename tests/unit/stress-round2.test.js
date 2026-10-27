// Second stress round (2.68.5): meal building, recipe totals, what leaves the app (Nightscout, Apple Health export), sync
// merging between devices, backups/validation and the Apple Health import. Seeded; STRESS_N scales it.
import test from "node:test";
import assert from "node:assert/strict";
import { buildMealEntry } from "../../js/core/meal-entry.js";
import { recipeTotals } from "../../js/core/library.js";
import { planDose, planEditDose, compoundGiInfo, roundDose } from "../../js/calc.js";
import { treatmentsForEntry, entriesToGlucoseRows } from "../../js/nightscout.js";
import { mergeStates, normalizeState, makeFingerprint, stampChanges, statesEquivalent, prepareRestoredState } from "../../js/state.js";
import { validateEntry, validateState, hasErrors } from "../../js/core/schema.js";
import { workoutsToActivities, caloriesDuring, intensityUpdates, awaitingIntensity } from "../../js/health-import.js";
import { round1 } from "../../js/util.js";

globalThis.__HEALTH_EXPORT_TEST__ = true;
const { flattenHistoryEntries } = await import("../../supabase/functions/health-export/index.ts");

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const N = Number(process.env.STRESS_N || 600);
const MIN = 60000, HOUR = 3600000, DAY = 86400000;
const pick = (r, l) => l[Math.floor(r() * l.length)];
const NOW = new Date(2026, 9, 27, 20, 0).getTime();
const near = (a, b, tol = 1e-9) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));

// An item exactly as the Calculator makes one: carbs = round(cp100 x grams) / 100.
function item(r) {
  const cp100 = pick(r, [0, 3.5, 12, 23, 47.3, 65, 75.5, 100]), kp100 = Math.round(r() * 500), grams = pick(r, [1, 7.5, 12, 34.6, 50, 80.4, 125, 300]) * (r() < 0.3 ? r() + 0.5 : 1);
  return { refType: "food", refId: "f" + Math.floor(r() * 9), name: pick(r, ["Pane", "Pasta", "Banana", "Mela"]), grams: round1(grams), carbsPer100g: cp100, kcalPer100g: kp100,
    carbs: Math.round(cp100 * round1(grams)) / 100, kcal: Math.round(kp100 * round1(grams) / 100), gi: r() < 0.7 ? Math.round(20 + r() * 80) : null };
}
const settingsR = r => ({ units: "mgdl", isf: 30 + Math.round(r() * 40), target: 100, rounding: pick(r, ["0.1", "0.5", "1"]), maxDose: pick(r, [0, 15]), iobAwareCorrection: false, reduceBelowTarget: r() < 0.5 });

test(`a logged meal re-opened in Edit Meal and saved unchanged keeps its dose (${N} meals)`, () => {
  for (let i = 0; i < N; i++) {
    const seed = 1 + i, r = rng(seed), items = Array.from({ length: 1 + Math.floor(r() * 4) }, () => item(r));
    const settings = settingsR(r), ratio = pick(r, [5, 7.5, 8, 10, 12, 15]);
    const glucose = r() < 0.4 ? Math.round(60 + r() * 250) : null;
    const exact = items.reduce((s, x) => s + x.carbs, 0);
    // The Calculator: dose from the exact total.
    const plan = planDose({ carbs: exact, ratio, correction: glucose != null ? "auto" : "off", glucose: glucose != null ? String(glucose) : "", glucoseUnit: "mgdl", settings });
    const entry = buildMealEntry({ now: new Date(NOW - i * MIN), mealType: "lunch", periodEntry: { name: "Lunch" }, ratioEntry: { name: "Lunch", ratio }, items, eatingOut: false, noInsulin: false, computed: plan, glucoseVal: glucose });
    const ctx = `seed ${seed}: ${JSON.stringify(items.map(x => x.carbs))} at 1u:${ratio}g, ${settings.rounding} u steps`;
    assert.equal(entry.totalCarbs, round1(exact), `${ctx}: saved total`);
    assert.equal(entry.totalKcal, Math.round(items.reduce((s, x) => s + x.kcal, 0)));
    assert.deepEqual(validateEntry(entry), [], `${ctx}: the saved meal isn't valid`);
    // Edit Meal (2.68.5): the dose from the exact sum of the saved items.
    const again = planEditDose({ entry, totalCarbs: entry.items.reduce((s, x) => s + x.carbs, 0), ratio, glucoseText: glucose != null ? String(glucose) : null, settings });
    assert.equal(again.mealDose, entry.mealDose, `${ctx}: logged ${entry.mealDose} u meal, Edit Meal makes it ${again.mealDose} u`);
    assert.equal(again.finalDose, plan.finalDose, ctx);
    // The rounded total is what made 2.0 u into 2.5 u before 2.68.5: confirm such cases exist in this data at all.
    const gi = compoundGiInfo(items);
    if (gi) { const gis = items.filter(x => x.gi != null && x.carbs > 0).map(x => x.gi); assert.ok(gi.value >= Math.min(...gis) - 0.5 && gi.value <= Math.max(...gis) + 0.5, `${ctx}: GI ${gi.value} outside its foods`); }
  }
  // And the boundary that showed it, exactly:
  const it = { refType: "food", refId: "s1", name: "Pane comune", grams: 34.6, carbsPer100g: 65, kcalPer100g: 300, carbs: Math.round(65 * 34.6) / 100, kcal: 104, gi: 75 };
  const s = { units: "mgdl", isf: 50, target: 100, rounding: "0.5", maxDose: 0 };
  assert.equal(it.carbs, 22.49);
  assert.equal(planDose({ carbs: 22.49, ratio: 10, settings: s }).mealDose, 2);
  assert.equal(planDose({ carbs: round1(22.49), ratio: 10, settings: s }).mealDose, 2.5, "the rounded total really does land on the other side");
});

test("Eating Out and treated lows build valid entries with no counted carbs or no insulin", () => {
  for (let i = 0; i < N / 4; i++) {
    const r = rng(5000 + i), items = [item(r)], s = settingsR(r);
    const eo = buildMealEntry({ now: new Date(NOW), mealType: "dinner", periodEntry: null, ratioEntry: null, items, eatingOut: true, noInsulin: false, computed: planDose({ carbs: 0, ratio: 0, mealUnits: 3.5, settings: s }), glucoseVal: null });
    assert.equal(eo.totalCarbs, 0); assert.equal(eo.items.length, 0); assert.equal(eo.carbsUnknown, true); assert.equal(eo.mealDose, 3.5);
    const lo = buildMealEntry({ now: new Date(NOW), mealType: "snack", periodEntry: null, ratioEntry: null, items, eatingOut: false, noInsulin: true, computed: planDose({ carbs: items[0].carbs, ratio: 10, noInsulin: true, settings: s }), glucoseVal: 60 });
    assert.equal(lo.mealDose, 0); assert.equal(lo.correctionDose, 0); assert.equal(lo.noInsulin, true);
    for (const e of [eo, lo]) assert.deepEqual(validateEntry(e), []);
  }
});

test("recipe totals: carbs and kcal are the sum of the ingredients; per 100 g follows the final weight", () => {
  for (let i = 0; i < N / 2; i++) {
    const r = rng(7000 + i), lib = Array.from({ length: 5 }, (_, k) => ({ id: "f" + k, carbs: Math.round(r() * 80), kcal: Math.round(r() * 400) }));
    const items = Array.from({ length: 1 + Math.floor(r() * 6) }, () => r() < 0.5 ? { foodId: "f" + Math.floor(r() * 5), grams: Math.round(r() * 300) } : { grams: Math.round(r() * 300), carbsPer100g: Math.round(r() * 80), kcalPer100g: Math.round(r() * 400) });
    const fw = r() < 0.8 ? Math.round(100 + r() * 1500) : null;
    const t = recipeTotals({ items, finalWeight: fw }, lib);
    const carbs = items.reduce((s, it) => s + (it.carbsPer100g != null ? it.carbsPer100g : lib.find(f => f.id === it.foodId).carbs) * it.grams / 100, 0);
    assert.ok(Math.abs(t.totalCarbs - carbs) <= 0.05 + 1e-9, `recipe carbs ${t.totalCarbs} vs ${carbs}`);
    if (fw) assert.ok(Math.abs(t.carbsPer100g - t.totalCarbs / fw * 100) <= 0.05 + 1e-9);
    else assert.equal(t.carbsPer100g, null);
  }
});

test("Nightscout: what is sent matches what was saved, in both formats; basal and activity never carry insulin", () => {
  for (let i = 0; i < N; i++) {
    const seed = 9000 + i, r = rng(seed);
    const meal = Math.round(r() * 12 * 10) / 10 * (r() < 0.1 ? 0 : 1), corr = pick(r, [0, 0, 0.5, 1.5, -0.5, -1, -meal]);
    const carbs = r() < 0.15 ? 0 : round1(r() * 120);
    const units = r() < 0.5 ? "mgdl" : "mmol";
    const e = { ts: NOW - i * MIN, totalCarbs: carbs, mealDose: meal, correctionDose: corr, items: [{ name: "Pasta" }], glucose: r() < 0.5 ? (units === "mmol" ? 7.4 : 133) : null, noInsulin: false };
    const net = Math.max(0, meal + corr);
    for (const format of ["combined", "split"]) {
      const out = treatmentsForEntry(e, { units, format });
      const ctx = `seed ${seed} ${format}: ${JSON.stringify({ carbs, meal, corr })} -> ${JSON.stringify(out.map(o => o.treatment))}`;
      const sentInsulin = out.reduce((s, o) => s + (Number(o.treatment.insulin) || 0), 0);
      const sentCarbs = out.reduce((s, o) => s + (Number(o.treatment.carbs) || 0), 0);
      assert.ok(Math.abs(sentInsulin - net) <= 0.05 + 1e-9, `${ctx}: sent ${sentInsulin} u for ${net} u`);
      assert.ok(out.every(o => !(o.treatment.insulin < 0)), `${ctx}: negative insulin sent`);
      assert.equal(sentCarbs, carbs, `${ctx}: carbs`);
      if (e.glucose != null && format === "combined" && out[0].treatment.glucose != null) assert.ok(Math.abs(out[0].treatment.glucose - (units === "mmol" ? 7.4 * 18.0182 : 133)) < 0.1, ctx);
      if (format === "split" && carbs > 0 && net > 0.05) {
        const c = out.find(o => o.key === "carbs"), ins = out.find(o => o.key === "insulin");
        assert.equal(Date.parse(ins.treatment.created_at) - Date.parse(c.treatment.created_at), 1000, `${ctx}: insulin not 1 s after the carbs`);
        assert.equal(ins.treatment.carbs, 0); assert.ok(!("enteredBy" in ins.treatment) && !("glucose" in ins.treatment), `${ctx}: Gluroo's bolus shape`);
      }
    }
  }
  for (const e of [{ ts: NOW, entryType: "basal", basalDose: 12.5, basalSlot: "pm", mealDose: 5 }, { ts: NOW, entryType: "activity", activityType: "run", durationMin: 30, intensity: "hard", mealDose: 5, totalCarbs: 20 }]) {
    for (const format of ["combined", "split"]) for (const o of treatmentsForEntry(e, { format })) { assert.equal(o.treatment.insulin, undefined); assert.equal(o.treatment.carbs, undefined); assert.equal(o.treatment.eventType, "Note"); }
  }
});

test("Apple Health export: every unit and gram of a meal goes out once, net of reductions; basal only when asked", () => {
  for (let i = 0; i < N / 2; i++) {
    const r = rng(11000 + i), hist = [];
    for (let k = 0; k < 20; k++) {
      const kind = r();
      if (kind < 0.7) hist.push({ ts: NOW - k * HOUR, totalCarbs: r() < 0.1 ? 0 : round1(r() * 90), mealDose: round1(r() * 8), correctionDose: pick(r, [0, 0, 1, -0.5, -2]), items: [{ name: "X" }], noInsulin: false });
      else if (kind < 0.85) hist.push({ ts: NOW - k * HOUR, totalCarbs: 15, mealDose: 0, correctionDose: 0, noInsulin: true, items: [{ name: "Juice" }] });
      else hist.push({ ts: NOW - k * HOUR, entryType: "basal", basalDose: 12, basalSlot: "pm" });
    }
    const out = flattenHistoryEntries(hist, NOW - 2 * DAY);
    const meals = hist.filter(e => e.entryType !== "basal");
    const sum = t => out.filter(o => o.type === t).reduce((s, o) => s + o.value, 0);
    assert.ok(near(sum("carbs"), meals.reduce((s, e) => s + (e.totalCarbs || 0), 0), 1e-9));
    const net = meals.reduce((s, e) => s + Math.max(0, (e.mealDose || 0) + Math.min(0, e.correctionDose || 0)) + Math.max(0, e.correctionDose || 0), 0);
    assert.ok(Math.abs(sum("mealInsulin") + sum("correctionInsulin") - net) < 0.01 * meals.length + 1e-9, `export ${sum("mealInsulin") + sum("correctionInsulin")} vs injected ${net}`);
    assert.ok(out.every(o => o.value > 0), "a zero or negative sample would be logged in Health");
    assert.equal(out.filter(o => o.type === "basalInsulin").length, 0);
    assert.equal(flattenHistoryEntries(hist, NOW - 2 * DAY, { includeBasal: true }).filter(o => o.type === "basalInsulin").length, hist.filter(e => e.entryType === "basal").length);
  }
});

// ---- sync between devices ----
function deviceEdits(r, base, now) {
  const s = structuredClone(base);
  let fp = makeFingerprint(s);
  for (let k = 0; k < 6; k++) {
    const op = r();
    if (op < 0.4) s.history.push({ id: `h-${now}-${k}-${Math.floor(r() * 1e6)}`, ts: now - Math.floor(r() * DAY), mealType: "lunch", items: [], totalCarbs: Math.round(r() * 80), mealDose: 2, correctionDose: 0, noInsulin: false });
    else if (op < 0.7 && s.history.length) { const e = pick(r, s.history); e.totalCarbs += 1; }
    else if (s.history.length) s.history.splice(Math.floor(r() * s.history.length), 1);
    fp = stampChanges(s, fp, now + k);
  }
  return s;
}
test("sync: merging two devices loses nothing, keeps deletions, and is the same whichever way round", () => {
  const defaults = () => ({ settings: { units: "mgdl", isf: 50, target: 100, rounding: "0.5", maxDose: 15, timeRatios: [{ id: "t1", name: "All", start: "00:00", end: "23:59", ratio: 10 }], activityRatios: [], insulinModel: { preset: "rapid", peakMinutes: 75, diaMinutes: 360 }, carbAbsorptionMinutes: { high: 120, medium: 180, low: 240, unknown: 180 } }, library: [], recipes: [], history: [] });
  for (let i = 0; i < N / 2; i++) {
    const seed = 13000 + i, r = rng(seed);
    let base = normalizeState({ ...defaults(), history: Array.from({ length: 8 }, (_, k) => ({ id: "b" + k, ts: NOW - k * HOUR, mealType: "lunch", items: [], totalCarbs: 10 * k, mealDose: 1, correctionDose: 0, noInsulin: false, updatedAt: NOW - DAY })) }, defaults);
    const A = deviceEdits(r, base, NOW + 1000), B = deviceEdits(r, base, NOW + 2000 + Math.floor(r() * 5000));
    const AB = mergeStates(A, B, defaults), BA = mergeStates(B, A, defaults);
    const ids = s => s.history.map(e => e.id).sort();
    const ctx = `seed ${seed}`;
    assert.deepEqual(ids(AB), ids(BA), `${ctx}: merge order changed which meals survive`);
    // Every meal on either side survives unless it was deleted after its last edit.
    for (const side of [A, B]) for (const e of side.history) {
      const t = AB.deleted.history[e.id];
      if (t == null || t < (e.updatedAt || 0)) assert.ok(AB.history.some(x => x.id === e.id), `${ctx}: ${e.id} lost in the merge`);
    }
    for (const id of Object.keys(AB.deleted.history)) {
      const kept = AB.history.find(x => x.id === id);
      if (kept) assert.ok((kept.updatedAt || 0) > AB.deleted.history[id], `${ctx}: ${id} deleted but still there`);
    }
    // The newer edit wins.
    for (const e of AB.history) {
      const a = A.history.find(x => x.id === e.id), b = B.history.find(x => x.id === e.id);
      if (a && b && (a.updatedAt || 0) !== (b.updatedAt || 0)) assert.equal(e.updatedAt, Math.max(a.updatedAt || 0, b.updatedAt || 0), `${ctx}: the older edit of ${e.id} won`);
    }
    assert.ok(statesEquivalent(mergeStates(AB, AB, defaults), AB), `${ctx}: merging with itself changed something`);
    assert.ok(statesEquivalent(mergeStates(AB, A, defaults), AB) && statesEquivalent(mergeStates(AB, B, defaults), AB), `${ctx}: merging again isn't stable`);
    assert.ok(!hasErrors(validateState(AB)), `${ctx}: merged state invalid ${JSON.stringify(validateState(AB).filter(p => p.severity === "error"))}`);
    // A backup restored on top wins outright, and survives the next sync with the device it came from.
    const restored = prepareRestoredState(A, AB, defaults, NOW + 100000);
    const afterSync = mergeStates(restored, AB, defaults);
    assert.deepEqual(ids(afterSync), ids(A), `${ctx}: a restored backup didn't stick after syncing`);
  }
});

test("Apple Health import: random workouts and calories never duplicate or overflow", () => {
  for (let i = 0; i < N / 2; i++) {
    const r = rng(15000 + i), sessions = [], cals = [];
    for (let k = 0; k < 8; k++) {
      const st = NOW - Math.floor(r() * 2 * DAY), mins = pick(r, [2, 5, 19, 45, 90, 2000]);
      sessions.push({ id: pick(r, ["A", "B", "C", "D", "E", "F", "G", "bad id!", ""]) + (r() < 0.5 ? "" : "1"), label: pick(r, ["cycling", "walking", "Elliptical", "", null]), start_time: new Date(st).toISOString(), end_time: new Date(st + mins * MIN).toISOString() });
      cals.push({ start_time: new Date(st).toISOString(), end_time: new Date(st + mins * MIN).toISOString(), unit: pick(r, ["kcal", "kcal", "kJ"]), value: r() * 300 });
    }
    const deleted = r() < 0.5 ? { "hk-A": NOW } : {};
    const acts = workoutsToActivities([{ sessions, calories: cals }], { history: [{ id: "hk-B" }], deleted, now: NOW });
    const ids = acts.map(a => a.id);
    assert.equal(new Set(ids).size, ids.length, "duplicate import");
    assert.ok(!ids.includes("hk-B") && !(deleted["hk-A"] && ids.includes("hk-A")));
    for (const a of acts) { assert.deepEqual(validateEntry(a), []); assert.ok(a.durationMin >= 5 && a.durationMin <= 1440); assert.ok(a.ts <= NOW + 5 * MIN); }
    for (let k = 1; k < acts.length; k++) assert.ok(acts[k].ts >= acts[k - 1].ts);
    const total = cals.filter(c => c.unit === "kcal").reduce((s, c) => s + c.value, 0);
    const kc = caloriesDuring(NOW - 3 * DAY, NOW + DAY, cals);
    assert.ok(kc == null || kc <= total + 1e-6);
    for (const u of intensityUpdates(acts.filter(a => awaitingIntensity(a, NOW)), cals)) assert.ok(["light", "moderate", "hard"].includes(u.intensity));
  }
});

test("glucose rows from Nightscout: one per moment, positive whole numbers, junk dropped", () => {
  for (let i = 0; i < N / 4; i++) {
    const r = rng(17000 + i), ents = [];
    for (let k = 0; k < 50; k++) ents.push(pick(r, [{ sgv: Math.round(40 + r() * 300), date: NOW - Math.floor(r() * 30) * 5 * MIN }, { mbg: 120.4, date: NOW - k * MIN }, { sgv: -5, date: NOW }, { sgv: "120", date: NOW }, { sgv: 100 }, null, { sgv: NaN, date: NOW }, { sgv: 0, date: NOW }]));
    const rows = entriesToGlucoseRows(ents, "u");
    assert.equal(new Set(rows.map(x => x.at)).size, rows.length);
    assert.ok(rows.every(x => Number.isInteger(x.mgdl) && x.mgdl > 0 && x.user_id === "u"));
  }
});
