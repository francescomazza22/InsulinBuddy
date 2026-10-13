// Trends > Glucose insights: the cards appear from stored readings and the meals logged around them.
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
await dev.tab("history"); await dev.click('[data-seg="trends"]');
await dev.click('[data-range="30"]');
await dev.waitFor(`document.querySelectorAll("#trend-insights .ins-card").length >= 3`, 40000, 300);
const titles = await dev.eval(`[...document.querySelectorAll("#trend-insights .panel-card__title")].map(x => x.textContent)`);
t.section("INSIGHTS: cards");
t.check("glucose-after-meals curve card", titles.includes("Glucose after meals"), JSON.stringify(titles));
t.check("outcome card", titles.some(x => /3 hours after a meal/.test(x)));
t.check("correction card", titles.includes("How well corrections work"));
t.check("weekday/weekend card", titles.includes("Weekdays vs weekends"));
t.check("activity card", titles.includes("Activity ratios vs everyday"));
const curve = await dev.eval(`(() => { const s = document.querySelector("#trend-insights svg"); return s ? s.querySelectorAll("path").length : 0; })()`);
t.check("the curve is drawn (median line and band)", curve >= 2, String(curve));
const corr = await dev.eval(`(document.querySelector(".ins-big__num") || {}).textContent`);
t.check("the correction works out near 100 mg/dL for 2 u = 50 per unit", Math.abs(Number(corr) - 50) <= 8, String(corr));
const groups = await dev.eval(`[...document.querySelectorAll("[data-insgroup]")].map(b => b.dataset.insgroup)`);
t.check("a button per bracket plus All meals", groups.includes("All meals") && groups.includes("Lunch") && groups.includes("Evening"), JSON.stringify(groups));
await dev.eval(`document.querySelector('[data-insgroup="Evening"]').click()`); await sleep(300);
t.check("choosing a bracket redraws for it", /Evening/.test(await dev.eval(`document.querySelector("#trend-insights svg").getAttribute("aria-label")`)));
t.check("the care-team caveat is shown", /not dosing instructions/.test(await dev.text("#trend-insights")));
await dev.eval(`document.getElementById("trend-insights").scrollIntoView()`); await sleep(300); await dev.shot("/tmp/shots/insights.png");

t.section("DOCTOR REPORT: the patterns are included");
await dev.click('[data-seg="glucose"]'); await sleep(500);
await dev.eval(`document.getElementById("btn-generate-report").click()`);
await dev.waitFor(`/Patterns/.test(document.getElementById("report-content").textContent)`, 30000, 300);
const rep = await dev.text("#report-content");
t.check("report has the ratios table (used vs ideal vs set now)", /Insulin-to-carb ratios/.test(rep) && /Set now/.test(rep), rep.slice(0, 200));
t.check("report has glucose 3 hours after meals", /Glucose 3 hours after meals/.test(rep));
t.check("report mentions the correction result", /Corrections/.test(rep) && /per unit by 3 hours/.test(rep));
t.check("no JS errors", (await dev.eval("window.__errs.length")) === 0 && dev.errors.length === 0, JSON.stringify(await dev.eval("window.__errs")) + dev.errors.join("|"));
dev.close(); await app.close();
process.exit(t.summary() ? 0 : 1);
