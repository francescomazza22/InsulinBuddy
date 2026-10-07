import test from "node:test";
import assert from "node:assert/strict";
import { createDiag } from "../../js/diag.js";
import { timestampsToPrune, shouldAutoSnapshot } from "../../js/backup.js";
import { groupByDay, takeEntries, matchesQuery, recentDistinctMeals, mealLabel, dosingSummary, isBasalEntry, basalSlotForTime, basalSlotLabel, lastBasalDose, basalDoseCheck, makeBasalEntry, BASAL_MAX_UNITS } from "../../js/history.js";
import { escapeHtml, redact, formatDuration, timeAgo, round1 } from "../../js/util.js";

const mem = () => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)) }; };

// ------------------------------------------------------------------ util
test("escapeHtml neutralises markup in text and attributes", () => {
  assert.equal(escapeHtml(`<img src=x onerror="a('b')">&`), "&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;");
  assert.equal(escapeHtml(null), ""); assert.equal(escapeHtml(undefined), ""); assert.equal(escapeHtml(0), "0");
});
test("redact removes tokens, JWTs, passwords and explicit secrets", () => {
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
  const out = redact(`GET https://a.b/x?token=abc123&y=1 Bearer ${jwt} password=hunter22 and mySecretValue`, ["mySecretValue"]);
  assert.ok(!/abc123|hunter22|mySecretValue|eyJhbGci/.test(out), out);
  assert.match(out, /token=\*\*\*/);
});
test("small formatters", () => {
  assert.equal(formatDuration(95 * 60000), "1h35"); assert.equal(formatDuration(30 * 60000), "30m"); assert.equal(formatDuration(120 * 60000), "2h");
  assert.equal(timeAgo(Date.now() - 5 * 60000), "5 min ago"); assert.equal(timeAgo(0), "");
  assert.equal(round1(1.26), 1.3);
});

// ------------------------------------------------------------------ diag
test("diag keeps a bounded, persistent, redacted log", () => {
  const storage = mem(); let t = 1_000;
  const d = createDiag({ storage, max: 5, now: () => t++, secrets: () => ["s3cretTOKEN"] });
  for (let i = 0; i < 8; i++) d.log("info", "sync", `event ${i} token=abc s3cretTOKEN`);
  d.log("error", "ns", "boom");
  assert.equal(d.count(), 5);
  assert.equal(d.errorCount(), 1);
  assert.ok(!d.entries().map(e => e.msg).join(" ").match(/abc|s3cretTOKEN/));
  const d2 = createDiag({ storage });                       // survives a reload
  assert.equal(d2.count(), 5);
  d2.clear(); assert.equal(createDiag({ storage }).count(), 0);
});
test("diag report has context, events oldest-first, and no secrets", () => {
  const d = createDiag({ now: () => Date.UTC(2026, 8, 28, 7, 24, 0), secrets: () => ["tok-secret"] });
  d.log("warn", "outbox", "retry tok-secret");
  const r = d.report({ version: "2.0.0", "ns url": "https://x.io/?token=tok-secret" });
  assert.match(r, /version: 2\.0\.0/); assert.match(r, /\[warn\] outbox: retry \*\*\*/); assert.ok(!r.includes("tok-secret"));
  assert.match(createDiag().report(), /no events recorded/);
});
test("diag copes with corrupt storage and odd messages", () => {
  const s = { getItem: () => "{not json", setItem: () => { throw new Error("quota"); } };
  const d = createDiag({ storage: s });
  d.log("info", "x", { message: "an error-like" }); d.log("info", "x", { a: 1 }); d.log("info", "x", "y".repeat(2000));
  assert.equal(d.count(), 3); assert.ok(d.entries().every(e => e.msg.length <= 400));
});

// ---------------------------------------------------------------- backup
test("only the newest N snapshots survive pruning", () => {
  assert.deepEqual(timestampsToPrune([5, 1, 4, 2, 3], 3).sort(), [1, 2]);
  assert.deepEqual(timestampsToPrune([1, 2], 10), []);
});
test("auto snapshots are rate-limited", () => {
  assert.equal(shouldAutoSnapshot(null, 1000), true);
  assert.equal(shouldAutoSnapshot(1000, 1000 + 29 * 60000), false);
  assert.equal(shouldAutoSnapshot(1000, 1000 + 30 * 60000), true);
});

// --------------------------------------------------------------- history
const day = (k, h = 12) => { const d = new Date(2026, 8, 28 - k, h, 0, 0); return d.getTime(); };
const e = (id, k, over = {}) => ({ id, ts: day(k), mealType: "lunch", periodName: "lunch", items: [{ name: "Pasta", refType: "food", refId: "f1", grams: 90 }], totalCarbs: 60, ...over });

test("groupByDay groups newest-first entries by local day", () => {
  const g = groupByDay([e("a", 0, { ts: day(0, 19) }), e("b", 0, { ts: day(0, 8) }), e("c", 1), e("d", 3)]);
  assert.deepEqual(g.map(x => x.entries.length), [2, 1, 1]);
});
test("takeEntries never splits a day across the page boundary", () => {
  const hist = [e("a", 0, { ts: day(0, 20) }), e("b", 0, { ts: day(0, 12) }), e("c", 0, { ts: day(0, 8) }), e("d", 1), e("e", 2)];
  const r = takeEntries(hist, 2);                          // limit lands mid-day
  assert.deepEqual(r.visible.map(x => x.id), ["a", "b", "c"]);
  assert.equal(r.hidden, 2);
  assert.equal(takeEntries(hist, 99).hidden, 0);
  assert.equal(takeEntries(hist, 3).visible.length, 3);
});
test("search: AND across words, matches names, meal type, keywords and the date text", () => {
  const dateText = ts => new Date(ts).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  const pasta = e("p", 0), low = e("l", 1, { items: [{ name: "Juice" }], noInsulin: true, mealType: "snack" }), corr = e("c", 2, { items: [], mealDose: 0, correctionDose: 2 });
  assert.equal(matchesQuery(pasta, "pasta", dateText), true);
  assert.equal(matchesQuery(pasta, "PAS lunch", dateText), true);
  assert.equal(matchesQuery(pasta, "pasta dinner", dateText), false);
  assert.equal(matchesQuery(low, "low", dateText), true);
  assert.equal(matchesQuery(corr, "correction", dateText), true);
  assert.equal(matchesQuery(pasta, "september", dateText), true);
  assert.equal(matchesQuery(pasta, "", dateText), true);
  assert.equal(matchesQuery(pasta, "   ", dateText), true);
});
test("recent meals: distinct, real meals only, newest first", () => {
  const same = [e("a", 0), e("b", 1), e("c", 2, { items: [{ name: "Toast", refType: "food", refId: "f2", grams: 60 }] })];
  const hist = [...same, e("low", 3, { noInsulin: true }), e("corr", 4, { items: [], totalCarbs: 0 }), e("big", 5, { items: [{ name: "Pasta", refType: "food", refId: "f1", grams: 150 }] })];
  const r = recentDistinctMeals(hist, 10);
  assert.deepEqual(r.map(x => x.id), ["a", "c", "big"]);   // b duplicates a; low + correction excluded; different grams = different meal
  assert.equal(recentDistinctMeals(hist, 2).length, 2);
});
test("mealLabel shortens long meals", () => {
  assert.equal(mealLabel({ items: [{ name: "Pasta" }] }), "Pasta");
  assert.equal(mealLabel({ items: [{ name: "Pasta" }, { name: "Salad" }] }), "Pasta + Salad");
  assert.equal(mealLabel({ items: [{ name: "A" }, { name: "B" }, { name: "C" }, { name: "D" }] }), "A + B +2");
});

// ------------------------------------------------------------ dosingSummary
const dayMs = 86_400_000;
const mkEntry = (ts, over = {}) => ({ ts, mealType: "breakfast", noInsulin: false, totalCarbs: 0, mealDose: 0, correctionDose: 0, items: [], ...over });

test("dosingSummary: totals and daily averages over a simple period", () => {
  const now = Date.now();
  const history = [
    mkEntry(now, { totalCarbs: 60, mealDose: 4, items: [{ name: "Pasta" }] }),
    mkEntry(now - dayMs, { totalCarbs: 40, mealDose: 3, items: [{ name: "Pasta" }] })
  ];
  const s = dosingSummary(history, now - 7 * dayMs);
  assert.equal(s.days, 2);
  assert.equal(s.mealsLogged, 2);
  assert.equal(s.totalCarbs, 100);
  assert.equal(s.totalInsulin, 7);
  assert.equal(s.avgDailyCarbs, 50);
  assert.equal(s.avgDailyInsulin, 3.5);
});

test("dosingSummary: excludes entries before the window", () => {
  const now = Date.now();
  const history = [mkEntry(now, { totalCarbs: 60 }), mkEntry(now - 30 * dayMs, { totalCarbs: 999 })];
  const s = dosingSummary(history, now - 7 * dayMs);
  assert.equal(s.totalCarbs, 60);
});

test("dosingSummary: classifies lows and correction-only entries separately from meals", () => {
  const now = Date.now();
  const history = [
    mkEntry(now, { noInsulin: true, totalCarbs: 15 }),               // treating a low
    mkEntry(now, { mealType: "correction", correctionDose: 2 }),     // correction only
    mkEntry(now, { totalCarbs: 50, mealDose: 4 })                    // a real meal
  ];
  const s = dosingSummary(history, now - dayMs);
  assert.equal(s.mealsLogged, 1);
  assert.equal(s.lowsTreated, 1);
  assert.equal(s.correctionsOnly, 1);
});

test("dosingSummary: top foods are ranked by frequency, capped at 5", () => {
  const now = Date.now();
  const history = [
    mkEntry(now, { items: [{ name: "Banana" }] }),
    mkEntry(now, { items: [{ name: "Banana" }] }),
    mkEntry(now, { items: [{ name: "Pasta" }] }),
    mkEntry(now, { items: [{ name: "Bread" }, { name: "Eggs" }, { name: "Milk" }, { name: "Cheese" }, { name: "Jam" }] })
  ];
  const s = dosingSummary(history, now - dayMs);
  assert.equal(s.topFoods[0].name, "Banana");
  assert.equal(s.topFoods[0].count, 2);
  assert.equal(s.topFoods.length, 5);
});

test("dosingSummary: counts an Eating Out (carbsUnknown) entry as a real meal despite 0 carbs, and reports it separately", () => {
  const now = Date.now();
  const history = [
    mkEntry(now, { carbsUnknown: true, totalCarbs: 0, mealDose: 4, items: [] }),
    mkEntry(now, { totalCarbs: 50, mealDose: 3, items: [{ name: "Pasta" }] })
  ];
  const s = dosingSummary(history, now - dayMs);
  assert.equal(s.mealsLogged, 2, "both the eating-out meal and the normal meal should count");
  assert.equal(s.eatingOutCount, 1);
  assert.equal(s.totalInsulin, 7);
});

test("dosingSummary: handles an empty history without dividing by zero", () => {
  const s = dosingSummary([], Date.now() - dayMs);
  assert.equal(s.days, 1);
  assert.equal(s.avgDailyCarbs, 0);
  assert.equal(s.mealsLogged, 0);
  assert.deepEqual(s.topFoods, []);
});

test("dosingSummary: tolerates malformed entries", () => {
  const s = dosingSummary([null, undefined, { ts: "bad" }, {}], Date.now() - dayMs);
  assert.equal(s.mealsLogged, 0);
});

// ------------------------------------------------------------ basal insulin
const at = (h, m = 0) => new Date(2026, 9, 5, h, m).getTime();   // local time, like the app uses
const basal = (units, slot, ts, extra = {}) => makeBasalEntry({ units, ts, slot, now: ts, ...extra });

test("isBasalEntry: only entries explicitly marked basal", () => {
  assert.equal(isBasalEntry(basal(14, "am", at(8))), true);
  assert.equal(isBasalEntry(mkEntry(Date.now(), { totalCarbs: 40 })), false);
  assert.equal(isBasalEntry({ mealType: "basal" }), false, "the entryType marker is what counts, not the label");
  assert.equal(isBasalEntry(null), false);
  assert.equal(isBasalEntry(undefined), false);
});

test("basalSlotForTime: morning before 14:00, evening from 14:00, by local time", () => {
  assert.equal(basalSlotForTime(at(0, 30)), "am");
  assert.equal(basalSlotForTime(at(7, 59)), "am");
  assert.equal(basalSlotForTime(at(13, 59)), "am");
  assert.equal(basalSlotForTime(at(14, 0)), "pm");
  assert.equal(basalSlotForTime(at(21, 0)), "pm");
  assert.equal(basalSlotForTime(at(23, 59)), "pm");
  assert.equal(basalSlotLabel("am"), "Morning");
  assert.equal(basalSlotLabel("pm"), "Evening");
  assert.equal(basalSlotLabel("x"), "");
});

test("lastBasalDose: newest dose in that slot only, whatever order the history is in", () => {
  const history = [
    basal(12, "am", at(8)), basal(30, "pm", at(20)),
    basal(15, "am", at(8) + 86400000),            // newest morning dose
    mkEntry(at(9), { mealDose: 99, totalCarbs: 40 }), // a meal must never be mistaken for one
    basal(0, "am", at(8) + 2 * 86400000)          // a zero entry is ignored
  ].sort(() => Math.random() - 0.5);
  assert.deepEqual(lastBasalDose(history, "am"), { units: 15, ts: at(8) + 86400000 });
  assert.deepEqual(lastBasalDose(history, "pm"), { units: 30, ts: at(20) });
  assert.equal(lastBasalDose([], "am"), null);
  assert.equal(lastBasalDose([mkEntry(at(9), { totalCarbs: 10 })], "am"), null);
});

test("basalDoseCheck: blocks nonsense, asks about likely typos, stays quiet for normal variation", () => {
  for (const bad of [0, -3, NaN, Infinity, "14", null, undefined]) assert.equal(basalDoseCheck(bad, null).level, "block", String(bad));
  assert.equal(basalDoseCheck(BASAL_MAX_UNITS + 1, null).level, "block");
  assert.equal(basalDoseCheck(BASAL_MAX_UNITS, { units: 190 }).level, "ok");
  const last = { units: 14, ts: 1 };
  assert.equal(basalDoseCheck(14, last).level, "ok");
  assert.equal(basalDoseCheck(15, last).level, "ok");
  assert.equal(basalDoseCheck(20, last).level, "ok", "+6u but under 50%");
  assert.equal(basalDoseCheck(41, last).level, "confirm", "the 14 -> 41 slip");
  assert.equal(basalDoseCheck(140, last).level, "confirm", "the decimal slip");
  assert.equal(basalDoseCheck(7, last).level, "confirm", "halved");
  assert.equal(basalDoseCheck(6, { units: 4 }).level, "ok", "+50% but only 2u: too small to nag about");
  assert.equal(basalDoseCheck(9, { units: 4 }).level, "confirm");
  assert.equal(basalDoseCheck(14, null).level, "ok");
  assert.equal(basalDoseCheck(100, null).level, "ok");
  assert.equal(basalDoseCheck(101, null).level, "confirm", "huge, with nothing to compare to");
  assert.match(basalDoseCheck(41, last).message, /14u.*41u/);
});

test("makeBasalEntry: a basal-shaped entry with every meal field present and zero", () => {
  const e = makeBasalEntry({ units: 14.256, ts: at(8), slot: "am", now: 12345 });
  assert.equal(e.entryType, "basal");
  assert.equal(e.basalDose, 14.26);
  assert.equal(e.basalSlot, "am");
  assert.equal(e.id, "h-12345", "id comes from when it was logged, not from the (backdatable) dose time");
  assert.equal(e.ts, at(8));
  assert.equal(e.periodName, "morning");
  assert.deepEqual(e.items, []);
  for (const f of ["totalCarbs", "totalKcal", "mealDose", "correctionDose"]) assert.equal(e[f], 0, f);
  assert.equal(e.noInsulin, false);
  assert.equal(e.glucose, null);
  assert.equal(isBasalEntry(e), true);
});

test("matchesQuery: basal entries are found by basal / long-acting / slot / dose, and meals aren't", () => {
  const e = basal(14, "am", at(8));
  for (const q of ["basal", "long-acting", "long acting", "morning", "14u", "basal morning"]) assert.equal(matchesQuery(e, q), true, q);
  assert.equal(matchesQuery(e, "pasta"), false);
  assert.equal(matchesQuery(mkEntry(at(9), { items: [{ name: "Pasta" }], totalCarbs: 50 }), "basal"), false);
});

test("recentDistinctMeals: never offers a basal entry as a meal to repeat, even one that somehow has items", () => {
  const sneaky = { ...basal(14, "am", at(8)), items: [{ refType: "food", refId: "x", name: "Toast", grams: 50 }], totalCarbs: 30 };
  assert.deepEqual(recentDistinctMeals([sneaky], 6), []);
});

test("dosingSummary: basal is reported separately and changes none of the meal figures", () => {
  const day = 86400000, now = at(12);
  const meals = [
    mkEntry(now - 1000, { totalCarbs: 60, mealDose: 4, items: [{ name: "Pasta" }] }),
    mkEntry(now - day, { totalCarbs: 40, mealDose: 3, correctionDose: 1, items: [{ name: "Pasta" }] })
  ];
  const without = dosingSummary(meals, now - 7 * day);
  const withBasal = dosingSummary([...meals, basal(14, "am", now - 2000), basal(16, "pm", now - 3000), basal(12, "am", now - day - 5000),
                                   basal(20, "pm", now - 3 * day)], now - 7 * day);   // the last is on a day with NO meals
  for (const k of ["days", "mealsLogged", "avgDailyCarbs", "avgDailyInsulin", "totalCarbs", "totalInsulin", "lowsTreated", "correctionsOnly"]) {
    assert.equal(withBasal[k], without[k], `${k} must not move when basal is logged`);
  }
  assert.deepEqual(withBasal.topFoods, without.topFoods);
  assert.equal(withBasal.basalDoses, 4);
  assert.equal(withBasal.totalBasal, 62);
  assert.equal(withBasal.avgDailyBasal, 62 / 3, "averaged over the 3 days basal was logged on");
  assert.ok(Math.abs(withBasal.avgDailyTotalInsulin - (without.avgDailyInsulin + 62 / 3)) < 1e-9);
  assert.equal(without.basalDoses, 0);
  assert.equal(without.avgDailyBasal, 0);
});

test("dosingSummary: a history of only basal doses has no meals and no divide-by-zero", () => {
  const now = at(12);
  const s = dosingSummary([basal(14, "am", now - 1000), basal(16, "pm", now - 2000)], now - 86400000);
  assert.equal(s.mealsLogged, 0);
  assert.equal(s.avgDailyCarbs, 0);
  assert.equal(s.avgDailyInsulin, 0);
  assert.equal(s.days, 1);
  assert.equal(s.basalDoses, 2);
  assert.equal(s.avgDailyBasal, 30);
});
