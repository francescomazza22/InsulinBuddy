// Glucose > Day loading (2.72.3). Before, opening the Day view (or coming back to it after a minute) waited for a Nightscout
// catch-up, a row count and a whole week of readings in pages of 1000 before drawing anything. Now today draws straight from
// the last-24-hours store the app already keeps, and any other day asks only for that day's readings.
// Every call to the fake backend is delayed (DS_DELAY ms, default 150) to stand in for a phone network.
// DS_WIDTH (default 390).
import { createBackend, startApp, openDevice, fakeSupabaseSource, makeChecker } from "./harness.js";
import { FOODS_JS, stateBlob } from "./helpers.js";
import { entriesToGlucoseRows } from "../../js/nightscout.js";

const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const W = Number(process.env.DS_WIDTH || 390), DELAY = Number(process.env.DS_DELAY || 150);
const MIN = 60000, HOUR = 3600000;
const be = createBackend();
const app = await startApp(DIR, be, { "foods_data.js": FOODS_JS });

// Eight days of live readings every 2 minutes (about 5,700 rows): 100 mg/dL every earlier day, 150 today.
const today = new Date(); today.setHours(0, 0, 0, 0);
const T = today.getTime();
const entries = [];
for (let t0 = Math.floor((T - 8 * 24 * HOUR) / (2 * MIN)) * 2 * MIN; t0 < Date.now() - MIN; t0 += 2 * MIN) entries.push({ sgv: t0 >= T ? 150 : 100, date: t0, direction: "Flat" });
be.glucose = entriesToGlucoseRows(entries, "user-1");
be.ns.entries = entries.filter(e => e.date >= Date.now() - 26 * HOUR).map(e => ({ ...e }));
be.row = { user_id: "user-1", data: stateBlob({ history: [], settings: { units: "mgdl", nightscoutUrl: "https://demo.ns.example.com/?token=tok-abcdef-123456" } }), updated_at: be.stamp() };

const dev = await openDevice(app, { width: W, height: 1000, mobile: W < 1000, inject: fakeSupabaseSource({ userId: "user-1", delayMs: DELAY }), wait: 2500 });
// Let start-up fill the last-24-hours store (the live glucose pill does this), as it would have on the phone.
await dev.waitFor(`(() => { try { const s = JSON.parse(localStorage.getItem("insulinBuddy.glucoseRecent2") || "null"); return !!(s && s.entries && s.entries.length > 300); } catch (e) { return false; } })()`, 30000, 200)
  .then(() => t.check("start-up filled the last-24-hours store", true), () => t.check("start-up filled the last-24-hours store", false));
await dev.tab("history"); await dev.click('[data-seg="glucose"]'); await sleep(1500);

const glucoseCalls = from => be.log.slice(from).filter(l => l.kind === "db" && l.table === "glucose_readings" && l.op === "select");
const countCalls = from => glucoseCalls(from).filter(l => l.cols === "at");
const nsCalls = from => be.log.slice(from).filter(l => l.kind === "ns");
const avgCard = () => dev.eval(`(() => { const c = document.querySelectorAll(".glucose-stats .trend-stat-card")[1]; return c ? c.textContent.replace(/\\s+/g, " ").trim() : ""; })()`);
async function timeTo(cond, from) {
  const t0 = Date.now();
  let calls = null;
  for (;;) {
    if (await dev.eval(cond)) { calls = { db: glucoseCalls(from).length, count: countCalls(from).length, ns: nsCalls(from).length }; break; }
    if (Date.now() - t0 > 20000) break;
    await sleep(20);
  }
  return { ms: Date.now() - t0, calls };
}

t.section(`DAY VIEW LOADING (${W}px, ${DELAY} ms per call)`);
let mark = be.log.length;
const first = await timeTo(`!!document.querySelector(".day-chart") && document.querySelector(".day-nav__label").textContent === "Today"`, (await dev.click('[data-glview="day"]'), mark));
console.log("   today, first open:", JSON.stringify(first));
t.check("today draws without waiting for any glucose query", first.calls && first.calls.db === 0 && first.calls.ns === 0, JSON.stringify(first.calls));
t.check("today draws in well under a second", first.ms < 600, first.ms + " ms");
await sleep(2500);
t.check("today shows today's readings (average 150)", /^150\s*mg\/dL/.test(await avgCard()), await avgCard());
t.check("no row count and no week-long read for today", countCalls(mark).length === 0 && glucoseCalls(mark).length <= 2, `${countCalls(mark).length} counts, ${glucoseCalls(mark).length} selects`);

mark = be.log.length;
await dev.click('[data-dayshift="-1"]');
const label = await dev.text(".day-nav__label");
t.check("the date changes at once, before the readings arrive", label === "Yesterday", label);
const prev = await timeTo(`document.querySelector(".day-nav__label").textContent === "Yesterday" && !!document.querySelector(".day-chart") && /^100/.test((document.querySelectorAll(".glucose-stats .trend-stat-card")[1] || {}).textContent || "")`, mark);
console.log("   yesterday:", JSON.stringify(prev));
t.check("yesterday needs at most one query (one page) and no count", prev.calls && prev.calls.db <= 1 && prev.calls.count === 0, JSON.stringify(prev.calls));
// Two days back, with every cached window run out: exactly one query for that day alone.
await dev.eval(`(() => { const n = Date.now; Date.now = () => n() + 2 * 60000; })()`);
mark = be.log.length;
await dev.click('[data-dayshift="-1"]');
const two = await timeTo(`document.querySelector(".day-nav__label").textContent !== "Yesterday" && !!document.querySelector(".day-chart") && document.querySelector(".day-nav__label").textContent !== "Today" && /^100/.test((document.querySelectorAll(".glucose-stats .trend-stat-card")[1] || {}).textContent || "") && !document.querySelector(".day-swipe").dataset.stale`, mark);
await sleep(800);
console.log("   two days back:", JSON.stringify(two), "total selects:", glucoseCalls(mark).length);
t.check("two days back: one query, no count, no Nightscout catch-up", glucoseCalls(mark).length === 1 && countCalls(mark).length === 0 && nsCalls(mark).length === 0, `${glucoseCalls(mark).length} selects, ${countCalls(mark).length} counts, ${nsCalls(mark).length} ns`);
await dev.click('[data-dayshift="1"]'); await sleep(800);
t.check("yesterday has only yesterday's readings (average 100, nothing from today)", /^100\s*mg\/dL/.test(await avgCard()), await avgCard());

mark = be.log.length;
await dev.click('[data-dayshift="1"]');
const back = await timeTo(`document.querySelector(".day-nav__label").textContent === "Today" && /^150/.test((document.querySelectorAll(".glucose-stats .trend-stat-card")[1] || {}).textContent || "")`, mark);
console.log("   back to today:", JSON.stringify(back));
t.check("going back to a day just seen draws from the cache", back.calls && back.calls.db === 0, JSON.stringify(back.calls));

// Coming back after the 60-second cache has run out (the case in the screenshot): still draws at once from the store.
await dev.eval(`(() => { const n = Date.now; Date.now = () => n() + 5 * 60000; })()`);
mark = be.log.length;
await dev.click('[data-glview="pattern"]'); await sleep(300);
mark = be.log.length;
const again = await timeTo(`!!document.querySelector(".day-chart") && document.querySelector(".day-nav__label").textContent === "Today"`, (await dev.click('[data-glview="day"]'), mark));
console.log("   today, caches expired:", JSON.stringify(again));
t.check("after the caches expire, today still draws before any glucose query", again.calls && again.calls.db === 0, JSON.stringify(again.calls));
t.check("no JS errors", (await dev.eval(`window.__errs.length`)) === 0, JSON.stringify(await dev.eval(`window.__errs`)));

dev.close(); await app.close();
process.exit(t.summary() ? 0 : 1);
