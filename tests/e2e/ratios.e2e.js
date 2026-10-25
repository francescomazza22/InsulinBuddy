// The Trends "Average ratio by time of day" card and the ratio shown on each History entry.
import fs from "fs";
import { startApp, openDevice, makeChecker, seedLocal } from "./harness.js";
import { FOODS_JS, stateBlob, meal } from "./helpers.js";

const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const app = await startApp(DIR, null, { "foods_data.js": FOODS_JS, "manifest.json": "{}" });
const DAY = 86400000, now = Date.now();
const settings = { timeRatios: [
  { id: "a", name: "Morning", color: "#1F9E93", ratio: 10, start: "05:30", end: "11:30" }, { id: "b", name: "Lunch", color: "#D6A419", ratio: 8, start: "11:30", end: "15:00" },
  { id: "c", name: "Evening", color: "#6366F1", ratio: 15, start: "15:00", end: "23:30" }, { id: "d", name: "Night", color: "#D9534F", ratio: 12, start: "23:30", end: "05:30" }],
  activityRatios: [{ id: "e", name: "Sport", color: "#8B5CF6", ratio: 18 }] };
const e = (i, ts, label, ratio, extra = {}) => ({ id: "h-" + i, ts, mealType: "lunch", periodName: label.toLowerCase(), items: [{ refType: "food", refId: "s1", name: "Pane comune", grams: 80, carbsPer100g: 65, kcalPer100g: 300, carbs: 52, kcal: 240 }],
  totalCarbs: 52, totalKcal: 240, mealDose: 5, correctionDose: 0, noInsulin: false, glucose: null, ratioLabel: label, ratioValue: ratio, ...extra });
const history = [
  e(1, now - 1 * DAY, "Morning", 10), e(2, now - 2 * DAY, "Morning", 12), e(3, now - 3 * DAY, "Morning", 11),
  e(4, now - 4 * DAY, "Lunch", 8), e(5, now - 5 * DAY, "Evening", 15), e(6, now - 6 * DAY, "Sport", 18),
  e(7, now - 7 * DAY, "Morning", 10, { noInsulin: true, mealDose: 0 }),
  e(8, now - 8 * DAY, "Morning", null, { ratioLabel: "", ratioValue: null })
];
const dev = await openDevice(app, { width: 1100, height: 900, mobile: false, inject: `if (!localStorage.getItem("insulinBuddy.v2")) { ${seedLocal(stateBlob({ history, settings }))} }`, wait: 1800 });

t.section("TRENDS: average ratio by time of day");
await dev.tab("history"); await dev.click('[data-seg="trends"]'); await sleep(500);
const rows = await dev.eval(`[...document.querySelectorAll("#trend-ratios .rtrend")].map(r => ({ name: r.querySelector(".rtrend__name").textContent, value: r.querySelector(".rtrend__value").textContent, n: r.querySelector(".rtrend__n").textContent, bar: !!r.querySelector(".rtrend__bar"), mark: !!r.querySelector(".rtrend__mark") }))`);
t.check("the card is showing", await dev.eval(`!document.getElementById("trend-card-ratios").hidden`));
t.check("one row per bracket, in settings order, then activity ratios", JSON.stringify(rows.map(r => r.name)) === JSON.stringify(["Morning", "Lunch", "Evening", "Night", "Sport"]), JSON.stringify(rows.map(r => r.name)));
t.check("Morning averages 1u:11g over 3 meals, with its range", rows[0].value === "1u:11g" && /3 meals/.test(rows[0].n) && /range 1u:10g.1u:12g/.test(rows[0].n), JSON.stringify(rows[0]));
t.check("Lunch 1u:8g, Evening 1u:15g, Sport 1u:18g", rows[1].value === "1u:8g" && rows[2].value === "1u:15g" && rows[4].value === "1u:18g", JSON.stringify(rows));
t.check("Night, never used, is listed with no bar and says so", rows[3].value === "—" && /no meals/.test(rows[3].n) && !rows[3].bar && rows[3].mark, JSON.stringify(rows[3]));
t.check("every bracket shows a tick for its current setting", rows.every(r => r.mark));
t.check("the low treated without insulin is not counted (Morning is 3 meals, not 4)", /3 meals/.test(rows[0].n));
t.check("the meal with no saved ratio is mentioned, not silently dropped", /1 older meal has no ratio saved/.test(await dev.text("#trend-card-ratios")));
await dev.eval(`document.getElementById("trend-card-ratios").scrollIntoView({block:"center"})`); await sleep(300); await dev.shot("/tmp/shots/ratios-trends.png");

t.section("IDEAL RATIO: low-treatment carbs after an injection are counted into it");
{
  // A Morning meal 50 g @1:10 followed by a 15 g low; a Lunch meal with none.
  const H = 3600000, base = now - 3 * DAY;
  const lowEntry = (id, ts, g) => e(id, ts, "Morning", 10, { noInsulin: true, mealDose: 0, totalCarbs: g, mealType: "snack", items: [] });
  const open = async lowAfterH => {
    const hist = [e(21, base, "Morning", 10, { totalCarbs: 50, mealDose: 5 }), lowEntry(22, base + lowAfterH * H, 15), e(23, base + 26 * H, "Lunch", 8, { totalCarbs: 40, mealDose: 5 })];
    const d = await openDevice(app, { width: 1100, height: 900, mobile: false, inject: `if (!localStorage.getItem("insulinBuddy.v2")) { ${seedLocal(stateBlob({ history: hist, settings }))} }`, wait: 1800 });
    await d.tab("history"); await d.click('[data-seg="trends"]'); await sleep(500);
    return d;
  };
  const rd = d => d.eval(`[...document.querySelectorAll("#trend-ideal .rtrend")].map(r => ({ name: r.querySelector(".rtrend__name").textContent, v: r.querySelector(".rtrend__value").textContent, n: r.querySelector(".rtrend__n").textContent }))`);
  const pick = async (d, h) => { await d.eval(`document.querySelector('#trend-ideal-window [data-hours="${h}"]').click()`); await sleep(200); };
  let d2 = await open(2);
  let rows2 = await rd(d2);
  t.check("the card shows, with 3 h selected by default", await d2.eval(`!document.getElementById("trend-card-ideal").hidden && document.querySelector("#trend-ideal-window .is-active").dataset.hours === "3"`));
  t.check("Morning: 50 g + 15 g of low treatment at the same 5 u makes 1u:13g (it was 1u:10g)", rows2[0].v === "1u:13g" && /was 1u:10g \u00b7 1 of 1 meal followed by a low/.test(rows2[0].n), JSON.stringify(rows2[0]));
  t.check("Lunch, with no low after it, is unchanged at 1u:8g", rows2[1].v === "1u:8g" && /same as used/.test(rows2[1].n), JSON.stringify(rows2[1]));
  t.check("the caption says how many lows were counted", /1 low treated within 3 h of an injection \(15 g\)/.test(await d2.text("#trend-card-ideal")));
  await pick(d2, 2);
  t.check("a 2 h window still catches a low 2 h after", (await rd(d2))[0].v === "1u:13g");
  t.check("the 2 h choice is saved for next time", (await d2.eval(`localStorage.getItem("insulinBuddy.idealWindowHours")`)) === "2");
  t.check("no JS errors", (await d2.eval("window.__errs.length")) === 0 && d2.errors.length === 0, JSON.stringify(await d2.eval("window.__errs")));
  d2.close();
  d2 = await open(2.5);
  await pick(d2, 2);
  t.check("a low 2.5 h after is NOT counted with a 2 h window", (await rd(d2))[0].v === "1u:10g", JSON.stringify((await rd(d2))[0]));
  await pick(d2, 3);
  t.check("...but is counted with 3 h", (await rd(d2))[0].v === "1u:13g");
  await pick(d2, 4);
  t.check("...and with 4 h", (await rd(d2))[0].v === "1u:13g");
  await pick(d2, 3);
  await d2.eval(`document.getElementById("trend-card-ideal").scrollIntoView({block:"center"})`); await sleep(300);
  await d2.shot("/tmp/shots/ideal-ratio.png");
  d2.close();
}

t.section("DAILY CARBS: meals and low treatment are shown separately");
{
  await dev.click('[data-seg="trends"]'); await sleep(500);
  // In the seeded history the low treatment (7 days ago, 52 g) is the only low; every other entry is a meal.
  const bars = await dev.eval(`(() => { const svg = document.querySelector("#trend-chart-carbs svg"); return { meal: svg.querySelectorAll("rect.trend-chart__bar:not(.trend-chart__bar--low):not(.trend-chart__bar--empty)").length, low: svg.querySelectorAll("rect.trend-chart__bar--low").length }; })()`);
  t.check("there is an amber low-treatment bar for the day with a low", bars.low === 1, JSON.stringify(bars));
  t.check("a legend names the two colours", /Meals/.test(await dev.text("#trend-chart-carbs")) && /Low treatment/.test(await dev.text("#trend-chart-carbs")));
  t.check("the caption gives the share eaten for lows", /52 g of the \d+ g logged \(\d+%\) was eaten to treat lows/.test(await dev.text("#trend-chart-carbs")), await dev.text("#trend-chart-carbs"));
  const lowIdx = await dev.eval(`Number(document.querySelector("#trend-chart-carbs rect.trend-chart__bar--low").dataset.idx)`);
  await dev.eval(`document.querySelector('#trend-chart-carbs .trend-hit[data-idx="${lowIdx}"], #trend-chart-carbs [data-idx="${lowIdx}"]:not(rect.trend-chart__bar)').dispatchEvent(new MouseEvent("click", { bubbles: true }))`).catch(() => {});
  await sleep(200);
  await dev.eval(`document.getElementById("trend-chart-carbs").scrollIntoView({block:"center"})`); await sleep(300);
  await dev.shot("/tmp/shots/carbs-split.png");
}

t.section("HISTORY LOG: the ratio is shown on each entry that used one");
await dev.click('[data-seg="log"]'); await sleep(400);
const titles = await dev.eval(`[...document.querySelectorAll(".history-entry__title")].map(x => x.textContent.replace(/\\s+/g, " ").trim())`);
t.check("a morning meal shows 1u:10g beside its time of day", titles.some(x => /morning · 1u:10g/.test(x)), JSON.stringify(titles));
t.check("the low treated without insulin shows no ratio", titles.filter(x => /1u:/.test(x)).length === 6, JSON.stringify(titles));
t.check("the full detail names the bracket and ratio", (await dev.eval(`document.body.textContent`)).includes("Ratio used: Morning 1u:10g"));
t.check("no JS errors", (await dev.eval("window.__errs.length")) === 0 && dev.errors.length === 0, JSON.stringify(await dev.eval("window.__errs")));
dev.close(); await app.close();
process.exit(t.summary() ? 0 : 1);
