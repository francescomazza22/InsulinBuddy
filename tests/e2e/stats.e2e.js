// Glucose > Statistics: the figures a FreeStyle Libre report and Gluroo show, from stored readings and logged insulin.
import { createBackend, startApp, openDevice, fakeSupabaseSource, makeChecker } from "./harness.js";
import { FOODS_JS, stateBlob } from "./helpers.js";
import { entriesToGlucoseRows } from "../../js/nightscout.js";

const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const be = createBackend();
const app = await startApp(DIR, be, { "foods_data.js": FOODS_JS, "manifest.json": "{}" });
const MIN = 60000, H = 3600000, DAY = 86400000;
const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
const base = midnight.getTime() - 10 * DAY;
const at = (d, h, m = 0) => base + d * DAY + h * H + m * MIN;
// meals: lunch (12:00) and evening (19:00) on days 0-8, a correction on day 3 at 15:30, a sport meal on day 6
const meal = (id, ts, over = {}) => ({ id, ts, mealType: "lunch", periodName: "lunch", items: [{ refType: "food", refId: "s1", name: "Pane comune", grams: 80, carbsPer100g: 65, kcalPer100g: 300, carbs: 52, kcal: 240 }], totalCarbs: 52, totalKcal: 240, mealDose: 5, correctionDose: 0, noInsulin: false, glucose: null, ratioLabel: "Lunch", ratioValue: 10, ...over });
const history = [];
for (let d = 0; d <= 8; d++) { history.push(meal("l" + d, at(d, 12))); if (d !== 3) history.push(meal("e" + d, at(d, 19), { ratioLabel: "Evening", ratioValue: 15, mealType: "dinner" })); }
history.push({ id: "c3", ts: at(3, 15, 30), mealType: "correction", items: [], totalCarbs: 0, mealDose: 0, correctionDose: 2, noInsulin: false, ratioLabel: "", ratioValue: null });
history.push(meal("sp", at(6, 16), { ratioLabel: "Sport", ratioValue: 18 }));
// readings every 5 min: baseline 110, +60 over the first hour after a meal, gently back down; correction day drops 100
const mealTimes = history.filter(h => h.totalCarbs > 0).map(h => h.ts);
const entries = [];
for (let tt = base; tt < midnight.getTime(); tt += 5 * MIN) {
  let g = 110;
  for (const mt of mealTimes) { const m = (tt - mt) / MIN; if (m >= 0 && m < 240) g += 60 * Math.sin((Math.PI * m) / 240); }
  const cm = (tt - at(3, 15, 30)) / MIN; if (cm >= 0 && cm < 200) g = 210 - (cm / 180) * 100;
  entries.push({ sgv: Math.round(g), date: tt, direction: "Flat" });
}
be.glucose = entriesToGlucoseRows(entries, "user-1");
be.row = { user_id: "user-1", data: stateBlob({ history, settings: { nightscoutUrl: "https://demo.ns.example.com/?token=tok-abcdef-123456", activityRatios: [{ id: "x", name: "Sport", color: "#8B5CF6", ratio: 18 }], timeRatios: [{ id: "a", name: "Lunch", color: "#D6A419", ratio: 10, start: "11:00", end: "15:00" }, { id: "b", name: "Evening", color: "#6366F1", ratio: 15, start: "15:00", end: "23:30" }] } }), updated_at: be.stamp() };

const dev = await openDevice(app, { width: 420, height: 900, mobile: true, inject: fakeSupabaseSource({ userId: "user-1" }), wait: 2000 });
await dev.tab("history"); await dev.click('[data-seg="glucose"]'); await sleep(500);
await dev.click('[data-range="14"]');
await dev.click('[data-glview="stats"]');
await dev.waitFor(`/Standard deviation/.test(document.getElementById("glucose-tab-content").textContent)`, 30000, 300);
const txt = await dev.text("#glucose-tab-content");

t.section("GLUCOSE FIGURES (Libre / Gluroo)");
for (const label of ["Average glucose", "Estimated A1c (GMI)", "eA1c", "Median", "Standard deviation", "Variability (CV)", "Lowest / highest", "Average daily range", "Time in tight range", "Time in range", "Sensor active"])
  t.check(`shows ${label}`, txt.includes(label), label);
t.check("sensor use is about 100% for a full 5-minute series", await dev.eval(`(() => { const r = [...document.querySelectorAll(".stat-row")].find(x => /Sensor active/.test(x.textContent)); const m = r && r.textContent.match(/(\\d+(\\.\\d)?)%/); return !!m && parseFloat(m[1]) > 95; })()`));
t.check("time in ranges bars are included", /Very High|Very Low|Target/.test(txt));
t.check("low and high events are listed", /Low glucose events/.test(txt) && /Very low events/.test(txt) && /Very high events/.test(txt));

t.section("INSULIN AND FOOD");
for (const label of ["Total daily insulin", "Meals a day", "Average meal bolus", "Average carbs a meal", "Carbs per unit used", "Corrections", "Largest dose", "Lows treated"])
  t.check(`shows ${label}`, txt.includes(label), label);

t.section("DAILY GRAPHS");
t.check("one small graph per day, the latest 14", (await dev.eval(`document.querySelectorAll("#glucose-tab-content .day-row .spark").length`)) >= 10);
t.check("each graph draws a line", await dev.eval(`[...document.querySelectorAll("#glucose-tab-content .spark__line")].every(p => (p.getAttribute("d") || "").length > 20)`));
await dev.eval(`document.getElementById("glucose-tab-content").scrollIntoView()`); await sleep(300); await dev.shot("/tmp/shots/stats.png");
t.check("switching back to Time in Range still works", await (async () => { await dev.click('[data-glview="tir"]'); await sleep(300); return /Time in/.test(await dev.text("#glucose-tab-content")); })());

t.section("DOCTOR REPORT carries the extra figures");
await dev.eval(`document.getElementById("btn-generate-report").click()`);
await dev.waitFor(`/eA1c/.test(document.getElementById("report-content").textContent)`, 30000, 300);
const rep = await dev.text("#report-content");
t.check("report lists eA1c, SD, CV, tight range and events", /eA1c/.test(rep) && /Standard deviation/.test(rep) && /Variability/.test(rep) && /tight range/.test(rep) && /Low glucose events/.test(rep));
t.check("no JS errors", (await dev.eval("window.__errs.length")) === 0 && dev.errors.length === 0, JSON.stringify(await dev.eval("window.__errs")) + dev.errors.join("|"));
dev.close(); await app.close();
process.exit(t.summary() ? 0 : 1);
