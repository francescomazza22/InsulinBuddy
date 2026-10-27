// Stress test of the statistics (2.68.4): random histories and CGM traces (gaps, duplicates, unsorted, fractional values,
// junk readings, clock-change days) through every statistic, checked against rules that must always hold and against simple
// reference implementations. Seeded: a failure names its seed.
import test from "node:test";
import assert from "node:assert/strict";
import * as S from "../../js/glucose-stats.js";
import * as I from "../../js/insights.js";
import * as C from "../../js/calc.js";
import * as A from "../../js/activity-stats.js";
import * as D from "../../js/day-timeline.js";
import { makeActivityEntry } from "../../js/activity.js";

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const N = Number(process.env.STRESS_N || 120);
const MIN = 60000, HOUR = 3600000, DAY = 86400000;
const pick = (r, l) => l[Math.floor(r() * l.length)];
const NOW = new Date(2026, 9, 27, 20, 0).getTime();   // includes the 25 Oct 2026 clock change in the window
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));

function trace(r, days, { junk = true, fractional = false } = {}) {
  const out = [];
  let v = 80 + r() * 150;
  for (let t = NOW - days * DAY; t < NOW; t += 5 * MIN) {
    if (r() < 0.01) { t += Math.floor(r() * 36) * 5 * MIN; continue; }   // sensor gaps
    v = Math.min(400, Math.max(40, v + (r() - 0.5) * 18));
    const val = fractional ? Math.round(v * 10) / 10 : Math.round(v);
    out.push({ at: t + Math.floor((r() - 0.5) * 40000), mgdl: val });
    if (r() < 0.005) out.push({ at: t, mgdl: val });                        // duplicate reading
  }
  if (junk) out.push({ at: NOW - DAY, mgdl: NaN }, { at: NaN, mgdl: 120 }, null, { at: NOW - 2 * DAY, mgdl: "150" }, { at: NOW - 3 * DAY });
  for (let i = out.length - 1; i > 0; i--) { if (r() < 0.05) { const j = Math.floor(r() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; } }   // partly unsorted
  return out;
}
const clean = rs => rs.filter(x => x && Number.isFinite(x.at) && Number.isFinite(x.mgdl));

let idn = 0;
function history(r, days) {
  const out = [];
  const ratios = { Morning: 10, Lunch: 8, Evening: 12 };
  for (let d = days; d >= 0; d--) {
    const day = new Date(NOW - d * DAY); day.setHours(0, 0, 0, 0);
    const at = (h, m) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m).getTime();
    for (const [h, label] of [[7.5, "Morning"], [13, "Lunch"], [19.5, "Evening"]]) {
      if (r() < 0.15) continue;
      const ts = at(Math.floor(h), Math.round((h % 1) * 60 + (r() - 0.5) * 40)), carbs = Math.round(10 + r() * 90);
      const kind = r();
      if (kind < 0.06) out.push({ id: "e" + ++idn, ts, mealType: "dinner", carbsUnknown: true, items: [], totalCarbs: 0, mealDose: Math.round(r() * 8 * 2) / 2, correctionDose: 0, noInsulin: false });
      else out.push({ id: "e" + ++idn, ts, mealType: pick(r, ["breakfast", "lunch", "dinner", "snack"]), items: [{ name: pick(r, ["Pasta", "Bread", "Rice", "Apple"]), carbs, refType: "food" }],
        totalCarbs: carbs, mealDose: Math.round(carbs / ratios[label] * 2) / 2, correctionDose: r() < 0.2 ? pick(r, [0.5, 1, 1.5, -0.5, -1]) : 0, noInsulin: false,
        ratioLabel: label, ratioValue: ratios[label], glucose: r() < 0.5 ? Math.round(70 + r() * 200) : null });
      if (r() < 0.15) out.push({ id: "e" + ++idn, ts: ts + Math.round((1 + r() * 3) * HOUR), mealType: "correction", items: [], totalCarbs: 0, mealDose: 0, correctionDose: pick(r, [0.5, 1, 2]), noInsulin: false });
      if (r() < 0.12) out.push({ id: "e" + ++idn, ts: ts + Math.round((1 + r() * 4) * HOUR), mealType: "snack", items: [{ name: "Juice", carbs: 15 }], totalCarbs: pick(r, [10, 15, 20]), mealDose: 0, correctionDose: 0, noInsulin: true });
      if (r() < 0.3) out.push({ ...makeActivityEntry({ type: pick(r, ["cycle", "walk", "run", "other"]), name: "Padel", minutes: pick(r, [10, 19, 45, 90]), intensity: pick(r, ["light", "moderate", "hard"]), ts: ts + Math.round((r() - 0.4) * 5 * HOUR), now: ts }), id: "a" + ++idn });
    }
    if (r() < 0.9) out.push({ id: "b" + ++idn, ts: at(22, 0), entryType: "basal", mealType: "basal", basalDose: pick(r, [10, 12, 14]), basalSlot: "pm", items: [], totalCarbs: 0, mealDose: 0, correctionDose: 0 });
  }
  if (r() < 0.5) out.push({ id: "z" + ++idn, ts: NaN, totalCarbs: 10, mealDose: 1 }, { id: "z" + ++idn, ts: NOW - DAY, mealType: "lunch" });   // broken entries
  return out.sort(() => r() - 0.5);
}

// Every number in a result must be finite (null is fine: "no data"), recursively.
function assertFiniteDeep(x, ctx, path = "") {
  if (x == null || typeof x === "string" || typeof x === "boolean") return;
  if (typeof x === "number") { assert.ok(Number.isFinite(x) || x === Infinity && /high$/.test(path), `${ctx}: ${path} is ${x}`); return; }
  if (Array.isArray(x)) { x.forEach((v, i) => assertFiniteDeep(v, ctx, `${path}[${i}]`)); return; }
  if (typeof x === "object") for (const [k, v] of Object.entries(x)) { if (k === "e" || k === "entry" || k === "a") continue; assertFiniteDeep(v, ctx, path ? `${path}.${k}` : k); }
}

test("median / quantile / percentile agree with a plain sort-based reference", () => {
  for (let i = 0; i < 400; i++) {
    const r = rng(i), n = 1 + Math.floor(r() * 30), v = Array.from({ length: n }, () => Math.round(r() * 400 - 50));
    const s = v.slice().sort((a, b) => a - b);
    const ref = q => { const k = q * (n - 1), lo = Math.floor(k), hi = Math.ceil(k); return s[lo] + (s[hi] - s[lo]) * (k - lo); };
    assert.ok(near(I.median(v), ref(0.5)), `median of ${v}`);
    for (const q of [0, 0.05, 0.25, 0.75, 0.95, 1]) { assert.ok(near(I.quantile(v, q), ref(q))); assert.ok(near(S.percentile(s, q * 100), ref(q))); }
  }
  assert.equal(I.median([]), null); assert.equal(I.quantile([NaN, null], 0.5), null);
});

test("glucoseAt and readingsBetween match a brute-force search", () => {
  for (let i = 0; i < 60; i++) {
    const r = rng(500 + i), rs = I.sortReadings(trace(r, 2));
    for (let k = 0; k < 40; k++) {
      const t = NOW - r() * 2.2 * DAY, tol = pick(r, [5, 10, 15]);
      let best = null, bd = Infinity;
      for (const x of rs) { const d = Math.abs(x.at - t); if (d < bd) { bd = d; best = x; } }
      const want = best && bd <= tol * MIN ? best.mgdl : null;
      const got = I.glucoseAt(rs, t, tol);
      // Two readings equally near: either is right.
      assert.ok(got === want || (got != null && rs.some(x => x.mgdl === got && Math.abs(Math.abs(x.at - t) - bd) < 1)), `seed ${500 + i}: glucoseAt ${got} vs ${want}`);
      const t1 = t + r() * 5 * HOUR;
      assert.equal(I.readingsBetween(rs, t, t1).length, rs.filter(x => x.at >= t && x.at <= t1).length);
    }
  }
});

test("glucose statistics: always add up, whatever the readings look like", () => {
  for (let i = 0; i < N; i++) {
    const seed = 1000 + i, r = rng(seed), days = pick(r, [1, 3, 7, 14, 30]);
    const raw = trace(r, days, { fractional: r() < 0.5 });
    const ok = clean(raw), ctx = `seed ${seed}`;
    const vals = ok.map(x => x.mgdl), avg = vals.reduce((s, v) => s + v, 0) / vals.length;
    const st = S.glucoseSummaryStats(raw);
    assert.equal(st.count, ok.length, `${ctx}: junk readings counted`);
    assert.ok(near(st.avgMgdl, avg), `${ctx}: average ${st.avgMgdl} vs ${avg}`);
    assert.ok(near(st.timeInRangePct + st.timeLowPct + st.timeHighPct, 100), `${ctx}: in/low/high add to ${st.timeInRangePct + st.timeLowPct + st.timeHighPct}`);
    assert.ok(near(st.gmi, 3.31 + 0.02392 * avg));
    const bands = S.timeInRangeBreakdown(raw);
    assert.ok(near(bands.reduce((s, b) => s + b.pct, 0), 100), `${ctx}: time-in-range bands add to ${bands.reduce((s, b) => s + b.pct, 0)}%`);
    assert.ok(near(bands.find(b => b.key === "target").pct, st.timeInRangePct), `${ctx}: Target band ${bands.find(b => b.key === "target").pct}% vs in range ${st.timeInRangePct}%`);
    const ext = S.extendedGlucoseStats(raw);
    assertFiniteDeep(ext, ctx);
    assert.equal(ext.count, ok.length);
    const p = ext.pct;
    assert.ok(near(p.veryLow + p.low + p.target + p.high + p.veryHigh, 100), `${ctx}: extended bands add to ${p.veryLow + p.low + p.target + p.high + p.veryHigh}`);
    assert.ok(near(p.belowRange, p.veryLow + p.low) && near(p.aboveRange, p.high + p.veryHigh));
    assert.ok(near(p.target, st.timeInRangePct), `${ctx}: extended target ${p.target} vs summary ${st.timeInRangePct}`);
    assert.ok(ext.minMgdl <= ext.medianMgdl && ext.medianMgdl <= ext.maxMgdl && ext.sensorActivePct <= 100 && ext.sensorActivePct > 0);
    for (const ev of [ext.lowEvents, ext.veryLowEvents]) assert.ok(ev.longestMinutes >= ev.avgMinutes - 1e-9);
    assert.ok(ext.veryLowEvents.count <= ext.lowEvents.count + ext.veryLowEvents.count);
    const pat = S.dailyPatternBuckets(raw);
    assertFiniteDeep(pat, ctx);
    assert.equal(pat.reduce((s, b) => s + b.count, 0), ok.length, `${ctx}: daily pattern counted ${pat.reduce((s, b) => s + b.count, 0)} of ${ok.length}`);
    for (const b of pat) assert.ok(b.p5 <= b.p10 && b.p10 <= b.p25 && b.p25 <= b.p50 && b.p50 <= b.p75 && b.p75 <= b.p90 && b.p90 <= b.p95, `${ctx}: percentiles out of order`);
    const daily = S.dailyStats(raw);
    assert.equal(daily.reduce((s, d) => s + d.count, 0), ok.length);
    for (const d of daily) assert.ok(near(d.targetPct + d.lowPct + d.highPct, 100));
    assert.equal(S.daysSpanned(raw), new Set(ok.map(x => new Date(x.at).toDateString())).size);
  }
});

test("insights: well-formed, in range, and unaffected by the order things were logged in", () => {
  for (let i = 0; i < N; i++) {
    const seed = 3000 + i, r = rng(seed), days = pick(r, [3, 7, 14]);
    const hist = history(r, days), raw = trace(r, days + 1), ctx = `seed ${seed}`;
    const settings = { timeRatios: [{ name: "Morning", ratio: 10 }, { name: "Lunch", ratio: 8 }, { name: "Evening", ratio: 12 }], activityRatios: [{ name: "Sport", ratio: 18 }] };
    const run = (h, rs) => ({
      curves: I.postMealCurves(h, rs), outcome: I.outcomeByBracket(h, rs), foods: I.foodImpact(h, rs), corr: I.correctionEffectiveness(h, rs, { isfMgdl: 50 }),
      stack: I.iobStacking(h, rs), night: I.overnightStats(h, rs), week: I.weekdayWeekend(h, rs, settings), acts: I.activityImpact(h, rs),
      ratio: C.ratioByBracket(h, settings), ideal: C.idealRatioByBracket(h, settings, 3), bf: A.breakfastByActivity(h, rs), summ: A.activitySummary(h, rs, { days, now: NOW })
    });
    const res = run(hist, raw);
    assertFiniteDeep(res, ctx);
    for (const row of [...res.outcome.rows, ...(res.outcome.all ? [res.outcome.all] : [])]) assert.equal(row.low + row.inRange + row.high, row.n, `${ctx}: outcome row doesn't add up`);
    for (const g of res.curves.groups) for (const p of g.points) if (p.p50 != null) assert.ok(p.p25 <= p.p50 && p.p50 <= p.p75);
    for (const f of res.foods.rows) assert.ok(f.lowPct >= 0 && f.lowPct <= 100);
    assert.ok(res.night.lowNights <= res.night.n);
    for (const row of res.ideal.rows) if (row.count) { assert.ok(row.ideal > 0 && row.affected <= row.count && row.withLows + row.withCorrections >= row.affected); }
    assert.ok(res.ideal.lowsCounted + res.ideal.lowsUnattached === hist.filter(e => e && e.noInsulin && e.totalCarbs > 0 && Number.isFinite(e.ts)).length, `${ctx}: every low is either counted or set aside`);
    for (const k of ["activeDayStats", "restDayStats"]) { const d = res.summ[k]; if (d.tir != null) assert.ok(d.tir >= 0 && d.tir <= 100 && d.lowPct <= 100); assert.ok(d.lowNights <= d.nights); }
    // Same data, shuffled: the same answers.
    const shuffled = run(hist.slice().reverse(), raw.slice().reverse());
    const key = x => JSON.stringify(x, (k, v) => (k === "e" || k === "entry" || k === "events" || k === "nights" ? undefined : v));
    for (const name of Object.keys(res)) {
      const a = res[name], b = shuffled[name];
      const norm = v => Array.isArray(v) ? v.map(key).sort() : key(v);
      if (name === "corr") { assert.equal(a.n, b.n); assert.ok(near(a.medianPerUnit ?? 0, b.medianPerUnit ?? 0)); continue; }
      if (name === "curves") { assert.deepEqual(a.groups.map(key).sort(), b.groups.map(key).sort(), `${ctx}: curves depend on order`); assert.equal(a.meals, b.meals); continue; }
      if (name === "outcome" || name === "foods" || name === "ratio" || name === "ideal") {
        assert.deepEqual(JSON.parse(key(a)).rows?.map?.(x => JSON.stringify(x)).sort() ?? key(a), JSON.parse(key(b)).rows?.map?.(x => JSON.stringify(x)).sort() ?? key(b), `${ctx}: ${name} depends on order`);
        continue;
      }
      assert.deepEqual(norm(a), norm(b), `${ctx}: ${name} depends on the order entries were logged`);
    }
    // Logged activities are records only: taking them all out changes no meal figure.
    const noActs = hist.filter(e => !e || e.entryType !== "activity");
    const plain = run(noActs, raw);
    for (const name of ["curves", "outcome", "foods", "corr", "stack", "night", "week", "ratio", "ideal"]) assert.equal(key(plain[name]), key(res[name]), `${ctx}: activities changed ${name}`);
  }
});

test("ideal ratio matches a straightforward re-calculation", () => {
  for (let i = 0; i < N; i++) {
    const seed = 6000 + i, r = rng(seed), hist = history(r, 10), W = pick(r, [2, 3, 4]);
    const settings = { timeRatios: [{ name: "Morning", ratio: 10 }, { name: "Lunch", ratio: 8 }, { name: "Evening", ratio: 12 }] };
    const res = C.idealRatioByBracket(hist, settings, W);
    // Reference: walk the timeline; remember the last meal with insulin (carbs or Eating Out); credit lows and corrections to it.
    const list = hist.filter(e => e && Number.isFinite(e.ts) && e.entryType !== "basal" && e.entryType !== "activity").sort((a, b) => a.ts - b.ts);
    const ins = e => (Number(e.mealDose) || 0) + (Number(e.correctionDose) || 0);
    const credit = new Map();
    let last = null;
    for (const e of list) {
      const target = last && C.ratioWasApplied(last) && e.ts - last.ts <= W * HOUR ? last : null;
      const c = credit.get(target) || { r: 0, u: 0 };
      if (e.noInsulin) { if (e.totalCarbs > 0 && target) { c.r += e.totalCarbs; credit.set(target, c); } continue; }
      const isMeal = ins(e) > 0 && (e.totalCarbs > 0 || e.carbsUnknown);
      if (isMeal) { if (target && e.correctionDose > 0) { c.u += e.correctionDose; credit.set(target, c); } last = e; continue; }
      if (ins(e) > 0 && target) { c.u += ins(e); credit.set(target, c); }
    }
    const by = new Map();
    for (const e of list) {
      if (!C.ratioWasApplied(e)) continue;
      const c = credit.get(e) || { r: 0, u: 0 }, R = e.ratioValue, Cg = e.totalCarbs;
      if (!by.has(e.ratioLabel)) by.set(e.ratioLabel, []);
      by.get(e.ratioLabel).push(R * (Cg + c.r) / (Cg + R * c.u));
    }
    for (const row of res.rows) {
      const v = by.get(row.label) || [];
      assert.equal(row.count, v.length, `seed ${seed}: ${row.label} count`);
      if (v.length) assert.ok(near(row.ideal, v.reduce((s, x) => s + x, 0) / v.length), `seed ${seed}: ${row.label} ideal ${row.ideal} vs ${v.reduce((s, x) => s + x, 0) / v.length}`);
    }
  }
});

test("trend buckets: every meal counted once, on its own day, and the totals add up", () => {
  for (let i = 0; i < N; i++) {
    const seed = 8000 + i, r = rng(seed), days = pick(r, [7, 14, 30]);
    const hist = history(r, days + 2).filter(e => Number.isFinite(e.ts));
    const { buckets, inRange, todayKey } = C.buildTrendBuckets(hist, days, NOW);
    assert.equal(buckets.length, days);
    for (let k = 1; k < buckets.length; k++) { const prev = new Date(buckets[k - 1].key); prev.setDate(prev.getDate() + 1); assert.equal(buckets[k].key, prev.getTime(), `seed ${seed}: buckets not on consecutive midnights`); }
    const first = buckets[0].key;
    const meals = hist.filter(e => e.entryType !== "basal" && e.entryType !== "activity" && e.ts >= first && e.ts < new Date(todayKey).setDate(new Date(todayKey).getDate() + 1));
    assert.equal(inRange.length, meals.length, `seed ${seed}: ${inRange.length} in range vs ${meals.length}`);
    const sum = f => meals.reduce((s, e) => s + f(e), 0);
    assert.ok(near(buckets.reduce((s, b) => s + b.carbs, 0), sum(e => e.totalCarbs || 0)));
    assert.ok(near(buckets.reduce((s, b) => s + b.dose, 0), sum(e => (e.mealDose || 0) + (e.correctionDose || 0))), `seed ${seed}: daily insulin totals`);
    assert.ok(near(buckets.reduce((s, b) => s + b.lowCarbs + b.mealCarbs, 0), sum(e => e.totalCarbs || 0)));
    const t = C.summarizeTrends(buckets, inRange, todayKey);
    assertFiniteDeep(t, `seed ${seed}`);
    assert.ok(t.corrPct >= 0 && t.corrPct <= 100);
    assert.ok(near(t.totalIns, sum(e => (e.mealDose || 0) + (e.correctionDose || 0))));
  }
});

test("day view: totals match the entries of that local day, on every day including the clock change", () => {
  for (let i = 0; i < 40; i++) {
    const seed = 9000 + i, r = rng(seed), hist = history(r, 6), raw = trace(r, 7);
    for (let d = 0; d < 6; d++) {
      const day = D.shiftDay(NOW, -d), { start, end } = D.dayBounds(day);
      const dt = D.dayTimeline(hist, raw, day);
      assertFiniteDeep(dt.stats, `seed ${seed} day -${d}`);
      const inDay = hist.filter(e => Number.isFinite(e.ts) && e.ts >= start && e.ts < end);
      const carbs = inDay.filter(e => e.entryType !== "basal" && e.entryType !== "activity").reduce((s, e) => s + (e.totalCarbs || 0), 0);
      assert.equal(dt.stats.carbs, Math.round(carbs), `seed ${seed} day -${d}: carbs`);
      const basal = inDay.filter(e => e.entryType === "basal").reduce((s, e) => s + e.basalDose, 0);
      assert.ok(near(dt.stats.basal, basal));
      assert.equal(dt.readings.length, clean(raw).filter(x => x.at >= start && x.at < end).length);
      if (dt.stats.tir != null) assert.ok(near(dt.stats.tir + dt.stats.lowPct + dt.stats.highPct, 100));
      for (let k = 1; k < dt.events.length; k++) assert.ok(dt.events[k].t >= dt.events[k - 1].t);
    }
  }
});
