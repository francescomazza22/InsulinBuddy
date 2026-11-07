// Large-screen layout (2.93.0): Trends keeps "Daily carbs" and "Daily insulin dose" side by side even with the Calories card
// between them, short glucose insight cards pair up two to a row, the Glucose tab's four figures sit in one row and its
// chart grows taller as it widens; and a resize redraws the charts only when the width changes, without fetching the
// glucose readings again. Usage: [WL_WIDTH=1440] [SHOTS=<dir>] node tests/e2e/wide-layout.e2e.js
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
be.row = { user_id: "user-1", data: stateBlob({ history, settings: { darkMode: false, darkModeAuto: false, calories: { sex: "male", birthYear: 1985, heightCm: 180, weightKg: 75 }, nightscoutUrl: "https://demo.ns.example.com/?token=tok-abcdef-123456", activityRatios: [{ id: "x", name: "Sport", color: "#8B5CF6", ratio: 18 }], timeRatios: [{ id: "a", name: "Lunch", color: "#D6A419", ratio: 10, start: "11:00", end: "15:00" }, { id: "b", name: "Evening", color: "#6366F1", ratio: 15, start: "15:00", end: "23:30" }] } }), updated_at: be.stamp() };



const W = +(process.env.WL_WIDTH || 1440), Hgt = 900;
const R = (dev, sel) => dev.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e || !e.offsetParent) return null; const b = e.getBoundingClientRect(); return { left: Math.round(b.left), right: Math.round(b.right), top: Math.round(b.top), bottom: Math.round(b.bottom), h: Math.round(b.height) }; })()`);
const dev = await openDevice(app, { width: W, height: Hgt, mobile: false, inject: fakeSupabaseSource({ userId: "user-1" }), wait: 2500 });
await dev.tab("history");
await dev.eval(`document.querySelector('[data-seg="trends"]').click()`);
await dev.waitFor(`document.querySelectorAll("#trend-insights .ins-card").length >= 3`, 15000);
await sleep(400);

t.section(`TRENDS at ${W}px`);
const carbs = await R(dev, "#trend-card-carbs"), dose = await R(dev, "#trend-card-dose"), cal = await R(dev, "#trend-card-calories");
t.check("the Calories card is showing (it sits between the two charts in the page)", !!cal, JSON.stringify(cal));
t.check("Daily carbs and Daily insulin dose are side by side, level", carbs && dose && carbs.right <= dose.left && Math.abs(carbs.top - dose.top) <= 2, JSON.stringify({ carbs, dose }));
t.check("Calories comes after them, full width", cal && cal.top >= Math.max(carbs.bottom, dose.bottom) && cal.left === carbs.left && cal.right === dose.right, JSON.stringify(cal));
const ins = await dev.eval(`[...document.querySelectorAll("#trend-insights .ins-card")].map(c => { const b = c.getBoundingClientRect(); return { t: c.querySelector("h2").textContent, wide: c.classList.contains("ins-card--wide"), left: Math.round(b.left), right: Math.round(b.right), top: Math.round(b.top) }; })`);
const box = await R(dev, "#trend-insights");
const wide = ins.filter(c => c.wide), half = ins.filter(c => !c.wide);
t.check("chart and long insight cards take the full width", wide.length >= 1 && wide.every(c => c.left === box.left && c.right === box.right), JSON.stringify(wide));
t.check("the other insight cards are half width", half.length >= 2 && half.every(c => (c.right - c.left) < (box.right - box.left) * 0.6), JSON.stringify(half));
const pairs = half.filter(a => half.some(b => b !== a && Math.abs(a.top - b.top) <= 2 && b.left > a.right));
t.check("and they pair up two to a row", pairs.length >= 2, JSON.stringify(half.map(c => [c.t, c.left, c.top])));
if (W >= 1500) {
  const tops = await dev.eval(`[...document.querySelectorAll("#trend-stats > *")].map(e => Math.round(e.getBoundingClientRect().top))`);
  t.check("the six figures sit in one row", tops.length === 6 && new Set(tops).size === 1, JSON.stringify(tops));
}
if (process.env.SHOTS) await dev.shot(`${process.env.SHOTS}/wide-trends-${W}.png`);

t.section("RESIZING: redraw only for a new width, never refetch");
await dev.eval(`(() => { window.__loadingSeen = 0; new MutationObserver(() => { if (/Loading your glucose readings/.test(document.getElementById("trend-insights").textContent)) window.__loadingSeen++; }).observe(document.getElementById("trend-insights"), { childList: true, subtree: true, characterData: true }); document.querySelector("#trend-chart-carbs svg").__mark = 1; document.querySelector("#trend-insights .ins-card").__mark = 1; })()`);
await dev.resize(W, Hgt - 200, false); await sleep(600);
t.check("a height-only resize leaves the Trends charts alone", (await dev.eval(`document.querySelector("#trend-chart-carbs svg").__mark === 1 && document.querySelector("#trend-insights .ins-card").__mark === 1`)));
await dev.resize(W - 160, Hgt - 200, false); await sleep(800);
t.check("a new width redraws the charts", (await dev.eval(`document.querySelector("#trend-chart-carbs svg").__mark !== 1`)));
t.check("the insight cards are redrawn straight away, without reloading the glucose readings", (await dev.eval(`window.__loadingSeen`)) === 0 && (await dev.eval(`document.querySelectorAll("#trend-insights .ins-card").length`)) === ins.length);
await dev.eval(`document.querySelector("#trend-chart-carbs svg").__mark = 2`);
await dev.tab("calculator"); await sleep(300);
await dev.resize(W, Hgt, false); await sleep(600);
t.check("Trends isn't redrawn while another screen is showing", (await dev.eval(`document.querySelector("#trend-chart-carbs svg").__mark === 2`)));
await dev.tab("history"); await sleep(400);

t.section("GLUCOSE TAB");
await dev.eval(`document.querySelector('[data-seg="glucose"]').click()`);
await dev.waitFor(`!!document.querySelector("#glucose-tab-content .glu-pattern-chart svg")`, 15000); await sleep(300);
const tops = await dev.eval(`[...document.querySelectorAll("#glucose-tab-content .glucose-stats > *")].map(e => Math.round(e.getBoundingClientRect().top))`);
t.check("the four headline figures sit in one row", tops.length === 4 && new Set(tops).size === 1, JSON.stringify(tops));
const pan = await R(dev, "#glucose-tab-content");
t.check("the Glucose tab is as wide as the rest of Insights", pan && Math.abs((pan.right - pan.left) - (await dev.eval(`document.querySelector("#view-history").getBoundingClientRect().width`))) <= 2, JSON.stringify(pan));
const sel = await R(dev, "#band-preset-select");
t.check("the band picker is sized to its text, not the whole card", sel && (sel.right - sel.left) <= 340, JSON.stringify(sel));
const vb = await dev.eval(`(() => { const s = document.querySelector(".glu-pattern-chart svg"); const v = s.viewBox.baseVal; return { w: v.width, h: v.height, shown: Math.round(s.getBoundingClientRect().width) }; })()`);
t.check("the daily pattern is drawn at the card's width (text not stretched)", Math.abs(vb.shown / vb.w - 1) < 0.05, JSON.stringify(vb));
t.check("and taller than on a phone (220)", vb.h > 260 && vb.h <= 340, JSON.stringify(vb));
// The chart may have been drawn before the page grew a scrollbar; let one resize event catch it up first.
await dev.eval(`window.dispatchEvent(new Event("resize"))`); await sleep(600);
await dev.eval(`document.querySelector(".glu-pattern-chart svg").__mark = 1`);
const cw0 = await dev.eval(`document.getElementById("glucose-tab-content").clientWidth`);
await dev.resize(W, Hgt - 200, false); await sleep(600);
const cw1 = await dev.eval(`document.getElementById("glucose-tab-content").clientWidth`);
// (a shorter window can bring in a scrollbar, which really does change the width: then a redraw is right)
t.check("a height-only resize leaves the daily pattern alone (unless a scrollbar changed the width)", (await dev.eval(`document.querySelector(".glu-pattern-chart svg").__mark === 1`)) === (cw0 === cw1), `${cw0} -> ${cw1}`);
await dev.resize(W - 200, Hgt - 200, false); await sleep(800);
const vb2 = await dev.eval(`(() => { const s = document.querySelector(".glu-pattern-chart svg"); const v = s.viewBox.baseVal; return { w: v.width, shown: Math.round(s.getBoundingClientRect().width), mark: s.__mark || 0 }; })()`);
t.check("a new width redraws it at the new width, in place", vb2.mark !== 1 && Math.abs(vb2.shown / vb2.w - 1) < 0.05 && !(await dev.eval(`/Loading/.test(document.getElementById("glucose-tab-content").textContent)`)), JSON.stringify(vb2));
if (process.env.SHOTS) await dev.shot(`${process.env.SHOTS}/wide-glucose-${W}.png`);

t.check("no JS errors", (await dev.eval("window.__errs.length")) === 0 && dev.errors.length === 0, JSON.stringify(await dev.eval("window.__errs")) + dev.errors.join("|"));
dev.close();
await app.close();
process.exit(t.summary() ? 0 : 1);
