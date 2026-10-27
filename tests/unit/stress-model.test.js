// Stress test of the insulin/carb model, projections and summaries (2.68.4). Seeded.
import test from "node:test";
import assert from "node:assert/strict";
import { iobFraction, cobGrams, activeAt } from "../../js/calc.js";
import * as M from "../../js/glucose-model.js";
import { dosingSummary, insulinStats } from "../../js/history.js";
import { sanityPool, doseSanity } from "../../js/dose-sanity.js";

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const N = Number(process.env.STRESS_N || 150);
const MIN = 60000, HOUR = 3600000, DAY = 86400000;
const pick = (r, l) => l[Math.floor(r() * l.length)];
const NOW = new Date(2026, 9, 27, 20, 0).getTime();
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));

test("insulin curve: 100% at the injection, 0% at the end, only ever falling, for every setting the app allows", () => {
  // Settings > Insulin clamps action time to 180-600 min and peak to 20-120 min and below action/2 - 10 (handleInsulinFieldEdit).
  for (let dia = 180; dia <= 600; dia += 15) {
    for (let peak = 20; peak <= Math.min(120, Math.floor(dia / 2) - 10); peak += 5) {
      let prev = 1;
      assert.equal(iobFraction(0, peak, dia), 1);
      assert.equal(iobFraction(dia, peak, dia), 0);
      for (let t = 1; t < dia; t += 1) {
        const f = iobFraction(t, peak, dia);
        assert.ok(Number.isFinite(f) && f >= -1e-9 && f <= 1 + 1e-9, `peak ${peak}, action ${dia}: ${f} at ${t} min`);
        assert.ok(f <= prev + 1e-9, `peak ${peak}, action ${dia}: rose from ${prev} to ${f} at ${t} min`);
        prev = f;
      }
    }
  }
  for (let t = -10; t <= 200; t += 10) { const c = cobGrams(t, 50, 180); assert.ok(c >= 0 && c <= 50); }
});

function hist(r, days) {
  const out = [];
  for (let i = 0; i < days * 5; i++) {
    const ts = NOW - r() * days * DAY + (r() < 0.05 ? 2 * HOUR : 0);   // a few in the future
    const k = r();
    if (k < 0.55) out.push({ ts, mealType: pick(r, ["breakfast", "lunch", "dinner", "snack"]), items: [{ name: pick(r, ["Pasta", "Rice"]) }], totalCarbs: Math.round(r() * 100), mealDose: Math.round(r() * 10 * 2) / 2, correctionDose: pick(r, [0, 0, 1, -0.5]), noInsulin: false, ratioValue: pick(r, [8, 10, 12]), ratioLabel: "X", glycemicLoad: r() < 0.5 ? { value: Math.round(30 + r() * 70) } : null });
    else if (k < 0.65) out.push({ ts, mealType: "correction", items: [], totalCarbs: 0, mealDose: 0, correctionDose: pick(r, [0.5, 1, 2]), noInsulin: false });
    else if (k < 0.75) out.push({ ts, mealType: "snack", items: [], totalCarbs: 15, mealDose: 0, correctionDose: 0, noInsulin: true });
    else if (k < 0.85) out.push({ ts, entryType: "basal", mealType: "basal", basalDose: pick(r, [10, 12, 14]), basalSlot: pick(r, ["am", "pm"]), items: [], totalCarbs: 0, mealDose: 0, correctionDose: 0 });
    else if (k < 0.92) out.push({ ts, entryType: "activity", mealType: "activity", activityType: "run", durationMin: 30, intensity: "moderate", items: [], totalCarbs: 0, mealDose: 0, correctionDose: 0 });
    else out.push({ ts, mealType: "dinner", carbsUnknown: true, items: [], totalCarbs: 0, mealDose: 3, correctionDose: 0, noInsulin: false });
  }
  return out;
}
function readings(r, days) {
  const out = []; let v = 140;
  for (let t = NOW - days * DAY; t <= NOW; t += 5 * MIN) { if (r() < 0.01) { t += 30 * MIN; continue; } v = Math.min(400, Math.max(40, v + (r() - 0.5) * 16)); out.push({ at: t, mgdl: Math.round(v) }); }
  return out;
}
const settingsFor = r => {
  const dia = pick(r, [180, 300, 360, 480, 600]);
  return { insulinModel: { peakMinutes: Math.min(pick(r, [45, 55, 75, 90, 120]), Math.floor(dia / 2) - 10), diaMinutes: dia }, carbAbsorptionMinutes: { high: 120, medium: 180, low: 240, unknown: 180 } };
};

test("insulin and carbs on board: never negative, never more than what was logged, nothing from the future", () => {
  for (let i = 0; i < N * 4; i++) {
    const seed = 100 + i, r = rng(seed), h = hist(r, 2), s = settingsFor(r);
    const at = NOW - r() * DAY;
    const a = activeAt(h, s, at);
    const dia = s.insulinModel.diaMinutes;
    const past = h.filter(e => e.ts <= at);
    const maxIob = past.filter(e => at - e.ts < dia * MIN).reduce((t, e) => t + Math.max(0, (e.mealDose || 0) + (e.correctionDose || 0)), 0);
    const maxCob = past.filter(e => at - e.ts < 240 * MIN).reduce((t, e) => t + (e.totalCarbs || 0), 0);
    assert.ok(a.iob >= 0 && a.iob <= maxIob + 0.05, `seed ${seed}: IOB ${a.iob} of at most ${maxIob}`);
    assert.ok(a.cob >= 0 && a.cob <= maxCob + 0.5, `seed ${seed}: COB ${a.cob} of at most ${maxCob}`);
    // Entries after `at` change nothing.
    assert.deepEqual(activeAt(past, s, at), a, `seed ${seed}: a future entry changed IOB/COB`);
  }
});

test("insulin effect adds up: the drop over a whole action time is dose x correction factor, in any split", () => {
  for (let i = 0; i < N; i++) {
    const r = rng(2000 + i), dia = pick(r, [180, 300, 360, 600]), peak = Math.min(pick(r, [45, 75, 90]), dia / 2 - 10), isf = 20 + r() * 80, u = 0.5 + r() * 10;
    const e = [{ ts: NOW - DAY, mealDose: u, correctionDose: 0, totalCarbs: 0 }];
    const total = M.insulinDrop(e, e[0].ts, e[0].ts + dia * MIN, isf, peak, dia);
    assert.ok(near(total, u * isf, 1e-6), `total drop ${total} vs ${u * isf}`);
    const cut = e[0].ts + r() * dia * MIN;
    assert.ok(near(M.insulinDrop(e, e[0].ts, cut, isf, peak, dia) + M.insulinDrop(e, cut, e[0].ts + dia * MIN, isf, peak, dia), total, 1e-6));
    // Basal, activity and treated lows carry no insulin.
    assert.equal(M.insulinDrop([{ ts: NOW - DAY, entryType: "basal", basalDose: 20, mealDose: 0 }, { ts: NOW - DAY, entryType: "activity", mealDose: 5 }], NOW - DAY, NOW, isf, peak, dia), 0);
  }
});

test("projections, expected-vs-observed and learned absorption: always finite and within sense", () => {
  for (let i = 0; i < N; i++) {
    const seed = 3000 + i, r = rng(seed), h = hist(r, 1.5), rs = readings(r, 2), s = settingsFor(r);
    const ms = { isfMgdl: 20 + r() * 80, peak: s.insulinModel.peakMinutes, dia: s.insulinModel.diaMinutes, absMinutes: e => (e.glycemicLoad ? 150 : 180), fallbackRatio: 10 };
    const ctx = `seed ${seed}`;
    const obs = M.observedCarbs(h, rs, ms, NOW);
    assert.ok(Number.isFinite(obs.cob) && obs.cob >= 0 && Number.isFinite(obs.finishMin) && obs.finishMin >= 0, `${ctx}: ${JSON.stringify({ cob: obs.cob, finish: obs.finishMin })}`);
    for (const m of obs.meals) assert.ok(m.remaining >= 0 && m.remaining <= m.carbs + 1e-6, `${ctx}: a meal has ${m.remaining} of ${m.carbs} g left`);
    const p = M.projectGlucose(h, rs, ms, NOW);
    if (p) {
      assert.ok(p.points.every(q => Number.isFinite(q.mgdl)), `${ctx}: projection has a non-number`);
      assert.ok(p.low.mgdl <= p.high.mgdl && p.points.length >= 2);
      for (let k = 1; k < p.points.length; k++) assert.equal(p.points[k].t - p.points[k - 1].t, 5 * MIN);
    }
    const ex = M.expectedFromInsulin(h, rs, { ...ms, now: NOW, basalEntries: h.filter(e => e.entryType === "basal") });
    if (ex) {
      assert.ok(ex.points.every(q => Number.isFinite(q.expected) && q.expected >= M.EXPECTED_FLOOR), `${ctx}: expected line below the floor`);
      assert.ok(Number.isFinite(ex.now.gap));
    }
    const la = M.learnAbsorption(h, rs, { ...ms, now: NOW });
    for (const k of ["high", "medium", "low", "unknown"]) if (la[k]) assert.ok(la[k].minutes >= 45 && la[k].minutes <= 360 && la[k].n >= 3);
  }
});

test("dosing summaries add up to the entries they describe", () => {
  for (let i = 0; i < N; i++) {
    const seed = 5000 + i, r = rng(seed), h = hist(r, 14), since = NOW - 14 * DAY;
    const ds = dosingSummary(h, since), is = insulinStats(h, since);
    for (const o of [ds, is]) for (const [k, v] of Object.entries(o)) if (typeof v === "number") assert.ok(Number.isFinite(v), `seed ${seed}: ${k} = ${v}`);
    const inR = h.filter(e => e.ts >= since && e.entryType !== "basal" && e.entryType !== "activity");
    assert.ok(near(ds.totalCarbs, inR.reduce((s, e) => s + (e.totalCarbs || 0), 0)));
    assert.ok(near(ds.totalInsulin, inR.reduce((s, e) => s + (e.mealDose || 0) + (e.correctionDose || 0), 0)), `seed ${seed}: total insulin`);
    assert.ok(near(ds.totalBasal, h.filter(e => e.ts >= since && e.entryType === "basal").reduce((s, e) => s + e.basalDose, 0)));
    if (is.basalPct != null) assert.ok(near(is.basalPct + is.bolusPct, 100), `seed ${seed}: basal + bolus = ${is.basalPct + is.bolusPct}%`);
    if (is.correctionSharePct != null) assert.ok(is.correctionSharePct >= 0 && is.correctionSharePct <= 100 + 1e-6, `seed ${seed}: correction share ${is.correctionSharePct}%`);
    assert.ok(is.largestDose == null || is.largestDose > 0);
    const pool = sanityPool(h, NOW);
    for (const d of [0, 0.5, 1, 5, 30, 200]) doseSanity(pool, { carbs: d * 10, mealDose: d, finalDose: d });   // never throws
    assert.ok(pool.every(p => p.total > 0));
  }
});
