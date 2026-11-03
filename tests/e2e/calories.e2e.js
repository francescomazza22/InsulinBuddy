// Calories (2.78.0): Trends card (food + daily extras against what the day needed) and the Settings > Dosing card.
// CAL_WIDTH (default 390), CAL_DARK=1, SHOTS=<dir>.
import { startApp, openDevice, makeChecker, seedLocal } from "./harness.js";
import { FOODS_JS, stateBlob, meal } from "./helpers.js";

const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SHOTS = process.env.SHOTS || "";
const W = Number(process.env.CAL_WIDTH || 390), dark = process.env.CAL_DARK === "1";
const app = await startApp(DIR, null, { "foods_data.js": FOODS_JS, "manifest.json": "{}" });

const d = new Date(); const at = (daysAgo, h, m = 0) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - daysAgo, h, m).getTime();
const year = d.getFullYear();
// Yesterday: 700 + 900 kcal of food, a 60 min moderate run (hand-logged: (9-1) x 75 kg = 600) and a Watch ride (82 kcal).
// Three days ago: 1500 kcal. Two days ago: an eating-out meal (unknown kcal) and 400 kcal.
const hist = [
  meal("y1", at(1, 8), { totalKcal: 700 }), meal("y2", at(1, 13), { totalKcal: 900 }),
  { id: "a1", ts: at(1, 18), entryType: "activity", mealType: "activity", activityType: "run", intensity: "moderate", durationMin: 60, items: [], totalCarbs: 0, totalKcal: 0, mealDose: 0, correctionDose: 0 },
  { id: "hk-r", ts: at(1, 7), entryType: "activity", mealType: "activity", activityType: "cycle", intensity: "moderate", durationMin: 19, source: "appleHealth", note: "From Apple Health · 82 kcal (intensity estimated)", items: [], totalCarbs: 0, totalKcal: 0, mealDose: 0, correctionDose: 0 },
  meal("p1", at(3, 13), { totalKcal: 1500 }),
  meal("e1", at(2, 20), { carbsUnknown: true, totalKcal: 0, items: [], mealDose: 3 }), meal("e2", at(2, 9), { totalKcal: 400 }),
  { id: "bs", ts: at(1, 22), entryType: "basal", mealType: "basal", basalDose: 12, items: [], totalCarbs: 0, totalKcal: 0, mealDose: 0, correctionDose: 0 }
].sort((a, b) => b.ts - a.ts);
const calories = { sex: "male", birthYear: year - 41, heightCm: 180, weightKg: 75, lifeFactor: 1.3, extras: [
  { id: "olive-oil", name: "Olive oil", unit: "tbsp", kcalPerUnit: 119, perDay: 2 },
  { id: "flat-white", name: "Flat white", unit: "cup", kcalPerUnit: 110, perDay: 1 }
] };
// resting 10*75 + 6.25*180 - 5*41 + 5 = 1675; x1.3 = 2177.5. Yesterday needed 2177.5 + 600 + 82 = 2859.5, ate 1600 + 348 = 1948.

async function boot(settings) {
  const blob = stateBlob({ history: hist, settings: { darkMode: dark, darkModeAuto: false, ...settings } });
  const dev = await openDevice(app, { width: W, height: 1000, mobile: W < 1000, dark, inject: `if (!localStorage.getItem("insulinBuddy.v2")) { ${seedLocal(blob)} }`, wait: 1500 });
  return dev;
}
async function openTrends(dev) {
  await dev.tab("history"); await sleep(300);
  await dev.eval(`document.querySelector('#history-segmented [data-seg="trends"]').click()`); await sleep(300);
  await dev.eval(`document.querySelector('#trends-range-segmented [data-range="7"]').click()`); await sleep(400);
}
const card = dev => dev.eval(`(() => { const c = document.getElementById("trend-card-calories"); if (!c || c.hidden) return { shown: false };
  return { shown: true, readout: c.querySelector(".trend-readout").textContent, caption: c.querySelector(".trend-caption").textContent,
    how: (c.querySelector(".cal-how") || {}).textContent || "", stats: [...c.querySelectorAll(".trend-stat-card")].map(x => [...x.children].map(c => c.textContent.trim()).join(" ")),
    under: c.querySelectorAll(".cal-bar--under:not(.cal-bar--partial)").length, over: c.querySelectorAll(".cal-bar--over:not(.cal-bar--partial)").length,
    partial: c.querySelectorAll(".cal-bar--partial").length, eaten: c.querySelectorAll(".cal-bar--eaten").length,
    unknown: c.querySelectorAll(".cal-unknown").length, legend: c.querySelector(".trend-legend").textContent }; })()`);

t.section(`CALORIES CARD (${W}px${dark ? ", dark" : ""})`);
let dev = await boot({ calories });
await openTrends(dev);
let s = await card(dev);
console.log("  ", JSON.stringify(s));
t.check("shown in Trends as a balance: two full days under, the eating-out day as an outline", s.shown && s.under === 2 && s.over === 0 && s.partial === 1 && /more than needed.*less/.test(s.legend), JSON.stringify(s));
// Averages: day 3 (1500+348 vs 2177.5) and yesterday (1948 vs 2859.5); the eating-out day is left out.
const avgEaten = Math.round((1848 + 1948) / 2), avgNeeded = Math.round((2177.5 + 2859.5) / 2);
t.check(`averages: ${avgEaten.toLocaleString()} eaten, ${avgNeeded.toLocaleString()} needed, 621 under`, s.stats.join("|") === `${avgEaten.toLocaleString()} Avg eaten|${avgNeeded.toLocaleString()} Avg needed|\u2212621 Avg balance` && /On average 621 under a day/.test(s.readout), s.stats.join("|") + " / " + s.readout);
t.check("the eating-out day is marked and left out of the averages", s.unknown === 1 && /\? = eating out, calories not known \(1 day\)/.test(s.caption), s.caption);
t.check("caption lists the extras", /extras of 348 kcal a day \(olive oil 2 tbsp, flat white 1 cup\)/.test(s.caption), s.caption);
// Tap yesterday (index 5 of 7)
await dev.eval(`document.querySelector('#trend-chart-calories .trend-chart__hit[data-idx="5"]').dispatchEvent(new MouseEvent("click", { bubbles: true }))`); await sleep(200);
const ro = await dev.eval(`document.querySelector("#trend-chart-calories .trend-readout").textContent`);
t.check("tapping yesterday shows food, extras, activity (Watch and estimate) and the gap", /ate 1,948 \(food 1,600 \+ extras 348\)/.test(ro) && /needed 2,860/.test(ro) && /Run 600/.test(ro) && /Cycling 82 \(Watch\)/.test(ro) && /912 under/.test(ro), ro);
t.check("the carbs chart highlights the same day", await dev.eval(`document.querySelector("#trend-chart-carbs svg").classList.contains("has-selection")`));
t.check("no sideways scroll", await dev.eval(`document.documentElement.scrollWidth <= innerWidth + 1`));
if (SHOTS) { await dev.eval(`document.getElementById("trend-card-calories").scrollIntoView({ block: "start" })`); await sleep(400); await dev.shot(`${SHOTS}/calories-trend-${W}${dark ? "-dark" : ""}.png`); }

t.section("SETTINGS CARD");
await dev.click("#cal-open-settings"); await sleep(800);
t.check("the button opens Settings > Dosing at the Calories card", await dev.eval(`!document.getElementById("view-settings").hidden && !document.getElementById("calories-card").closest(".settings-panel").hidden`));
const status = () => dev.eval(`document.getElementById("cal-status").textContent + " | " + document.getElementById("cal-extras-total").textContent`);
t.check("shows resting and everyday needs and the extras total", /Resting about 1,675 kcal.*about 2,178 kcal.*Extras: 348 kcal a day/.test(await status()), await status());
const setField = (sel, v) => dev.eval(`(() => { const f = document.querySelector(${JSON.stringify(sel)}); f.focus(); f.value = ${JSON.stringify(v)}; f.dispatchEvent(new Event("input", { bubbles: true })); f.dispatchEvent(new Event("change", { bubbles: true })); return f.value; })()`);
const saved = () => dev.eval(`JSON.parse(localStorage.getItem("insulinBuddy.v2")).settings.calories`);
await setField("#cal-weight", "80,5");
t.check("weight with a decimal comma is saved", (await saved()).weightKg === 80.5 && /Resting about 1,730 kcal/.test(await status()), JSON.stringify(await saved()));
await setField("#cal-weight", "999");
t.check("an impossible weight keeps what is saved", (await saved()).weightKg === 80.5 && (await dev.eval(`document.getElementById("cal-weight").value`)) === "80.5");
await setField("#cal-weight", "");
t.check("clearing it asks for the weight", (await saved()).weightKg === null && /Add your weight/.test(await status()), await status());
await setField("#cal-weight", "75");
await setField('#cal-extras [data-xid="olive-oil"] [data-xfield="perDay"]', "1,5");
let c = await saved();
t.check("olive oil 1,5 a day is saved as 1.5 and the totals update in place", c.extras[0].perDay === 1.5 && /Extras: 289 kcal a day/.test(await status()) &&
  (await dev.eval(`document.querySelector('#cal-extras [data-xid="olive-oil"] .cal-extra__kcal').textContent`)) === "179 kcal", JSON.stringify(c.extras));
t.check("the field stays connected and focused after the change", await dev.eval(`document.activeElement && document.activeElement.isConnected && document.activeElement.dataset.xfield === "perDay"`));
// 2.78.1: focusing a filled box shows the clear X, which used to make the box as tall as it is wide.
const boxH = () => dev.eval(`(() => { const f = document.querySelector('#cal-extras [data-xid="flat-white"] [data-xfield="perDay"]'); return Math.round(f.getBoundingClientRect().height); })()`);
const hBefore = await boxH();
await dev.eval(`(() => { const f = document.querySelector('#cal-extras [data-xid="flat-white"] [data-xfield="perDay"]'); f.focus(); f.dispatchEvent(new FocusEvent("focusin", { bubbles: true })); })()`); await sleep(300);
const hFocus = await boxH(), xShown = await dev.eval(`!!document.querySelector(".clear-x:not([hidden]), [class*='clear'][class*='btn']:not([hidden])")`);
t.check("an extra's box keeps its height when focused with the clear X", hBefore > 0 && Math.abs(hFocus - hBefore) <= 1, `${hBefore} -> ${hFocus} (X shown: ${xShown})`);
if (SHOTS) await dev.shot(`${SHOTS}/calories-focus-${W}${dark ? "-dark" : ""}.png`);
await dev.eval(`(() => { const f = document.activeElement; f.value = "3"; f.dispatchEvent(new Event("input", { bubbles: true })); })()`); await sleep(100);
t.check("the row's kcal follows what you type", (await dev.eval(`document.querySelector('#cal-extras [data-xid="flat-white"] .cal-extra__kcal').textContent`)) === "330 kcal");
await dev.eval(`(() => { const f = document.activeElement; f.value = "1"; f.dispatchEvent(new Event("input", { bubbles: true })); f.dispatchEvent(new Event("change", { bubbles: true })); })()`);
await dev.eval(`document.activeElement.blur()`); await sleep(150);
await setField('#cal-extras [data-xid="flat-white"] [data-xfield="name"]', "");
t.check("an empty name keeps the old one", (await saved()).extras[1].name === "Flat white");
await dev.click("#cal-add-extra"); await sleep(300);
c = await saved();
t.check("Add an item adds a row ready to name", c.extras.length === 3 && (await dev.eval(`document.activeElement.classList.contains("cal-extra__name")`)));
const newId = c.extras[2].id;
await setField(`#cal-extras [data-xid="${newId}"] [data-xfield="name"]`, "Almonds");
await setField(`#cal-extras [data-xid="${newId}"] [data-xfield="kcalPerUnit"]`, "164");
await setField(`#cal-extras [data-xid="${newId}"] [data-xfield="unit"]`, "handful");
c = await saved();
t.check("the new item is saved", c.extras[2].name === "Almonds" && c.extras[2].kcalPerUnit === 164 && c.extras[2].unit === "handful" && c.extras[2].perDay === 1, JSON.stringify(c.extras[2]));
if (SHOTS) { await dev.eval(`document.getElementById("calories-card").scrollIntoView({ block: "start" })`); await sleep(400); await dev.shot(`${SHOTS}/calories-settings-${W}${dark ? "-dark" : ""}.png`); }
await dev.eval(`document.querySelector('#cal-extras [data-xid="${newId}"] [data-xremove]').click()`); await sleep(300);
await dev.eval(`(() => { const b = [...document.querySelectorAll(".dialog__btn--primary, .dialog button")].find(x => /Remove/.test(x.textContent)); b && b.click(); })()`); await sleep(400);
t.check("removing asks first, then removes it", (await saved()).extras.length === 2 && !(await dev.eval(`!!document.querySelector('#cal-extras [data-xid="${newId}"]')`)));
await dev.eval(`(() => { const s = document.getElementById("cal-life"); s.value = "1.4"; s.dispatchEvent(new Event("change", { bubbles: true })); })()`); await sleep(200);
t.check("everyday moving is saved", (await saved()).lifeFactor === 1.4);
t.check("no sideways scroll in Settings", await dev.eval(`document.documentElement.scrollWidth <= innerWidth + 1`));
t.check("no JS errors", (await dev.eval("window.__errs.length")) === 0, JSON.stringify(await dev.eval("window.__errs")));
dev.close();

t.section("NOT SET UP");
dev = await boot({});
await openTrends(dev);
s = await card(dev);
t.check("without details the card still shows what was eaten and asks for details", s.shown && s.eaten >= 3 && s.under + s.over === 0 && /Add your details/.test(s.caption) && /Eaten/.test(s.legend), JSON.stringify(s));
t.check("the Watch ride still counts; the hand-logged run says it needs a weight", /1 activity isn't counted: add your weight/.test(s.how), s.how);
t.check("no JS errors", (await dev.eval("window.__errs.length")) === 0, JSON.stringify(await dev.eval("window.__errs")));
dev.close();

await app.close();
process.exit(t.summary() ? 0 : 1);
