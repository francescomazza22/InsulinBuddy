import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
// Charts keep their text size on wide screens (2.77.2): the Daily pattern and Glucose-after-meals charts used to be drawn
// at phone width and stretched, so on an iPad or desktop their labels came out about twice the size of everything else.
// Was: Doctor report > Save PDF: a real PDF is made in the app and shared (printing does nothing in a home-screen app). Was: Glucose > Statistics: the figures a FreeStyle Libre report and Gluroo show, from stored readings and logged insulin.
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
be.row = { user_id: "user-1", data: stateBlob({ history, settings: { darkMode: true, darkModeAuto: false, nightscoutUrl: "https://demo.ns.example.com/?token=tok-abcdef-123456", activityRatios: [{ id: "x", name: "Sport", color: "#8B5CF6", ratio: 18 }], timeRatios: [{ id: "a", name: "Lunch", color: "#D6A419", ratio: 10, start: "11:00", end: "15:00" }, { id: "b", name: "Evening", color: "#6366F1", ratio: 15, start: "15:00", end: "23:30" }] } }), updated_at: be.stamp() };


// How much a chart's drawing is blown up on screen: its width on screen / the width it was drawn for.
const scaleOf = (dev, sel) => dev.eval(`(() => { const s = document.querySelector(${JSON.stringify(sel)}); if (!s) return null; const vb = s.viewBox.baseVal; return +(s.getBoundingClientRect().width / vb.width).toFixed(2); })()`);
for (const [name, w, mobile] of [["phone", 390, true], ["iPad", 820, true], ["desktop", 1440, false]]) {
  t.section(`${name.toUpperCase()} (${w}px)`);
  const dev = await openDevice(app, { width: w, height: 1000, mobile, inject: fakeSupabaseSource({ userId: "user-1" }), wait: 2000 });
  await dev.tab("history"); await dev.click('[data-seg="glucose"]'); await sleep(400);
  await dev.click('[data-range="14"]'); await sleep(1500);
  await dev.waitFor(`!!document.querySelector("#glucose-tab-content svg")`, 15000, 200);
  const dp = await scaleOf(dev, "#glucose-tab-content .panel-card svg");
  t.check("Daily pattern: drawn at the card's width, not stretched (text stays its normal size)", dp != null && dp <= 1.1, String(dp));
  await dev.click('[data-seg="trends"]'); await sleep(400);
  await dev.waitFor(`/Glucose after meals/.test((document.getElementById("trend-insights") || {}).textContent || "")`, 20000, 300);
  const ga = await scaleOf(dev, "#trend-insights svg[aria-label^='Typical glucose after a meal']");
  t.check("Glucose after meals: drawn at the card's width, not stretched", ga != null && ga <= 1.1, String(ga));
  t.check("no JS errors", (await dev.eval("window.__errs.length")) === 0 && dev.errors.length === 0, JSON.stringify(await dev.eval("window.__errs")) + dev.errors.join("|"));
  dev.close();
}
await app.close();
process.exit(t.summary() ? 0 : 1);
