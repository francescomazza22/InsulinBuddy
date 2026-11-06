// Calories (2.78.0): Trends card (food + daily extras against what the day needed) and the Settings > Calories tab (2.79.3; it was the bottom of Dosing).
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
  meal("c1", at(2, 21), { mealType: "correction", items: [], totalCarbs: 0, totalKcal: 0, mealDose: 0, correctionDose: 1.5 }),   // 2.82.0: a correction an hour after eating out
  { id: "bs", ts: at(1, 22), entryType: "basal", mealType: "basal", basalDose: 12, items: [], totalCarbs: 0, totalKcal: 0, mealDose: 0, correctionDose: 0 }
].sort((a, b) => b.ts - a.ts);
const calories = { sex: "male", birthYear: year - 41, heightCm: 180, weightKg: 75, lifeFactor: 1.3, eatingOutKcal: null, eatingOutMultiplier: null, extras: [
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
t.check("the button opens the Settings > Calories tab", await dev.eval(`!document.getElementById("view-settings").hidden && !document.getElementById("panel-calories").hidden && document.querySelector('#settings-segmented [data-seg="calories"]').classList.contains("is-active") && document.getElementById("panel-ratios").hidden`));
t.check("Calories is no longer in Dosing, which keeps only insulin settings in three groups", await dev.eval(`!document.querySelector("#panel-ratios #calories-card") && [...document.querySelectorAll("#panel-ratios .settings-group")].map(h => h.textContent).join("|") === "Meal and correction insulin|Basal insulin|Reminders"`));
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
// 2.89.0: add a daily extra from the library.
const nBefore = (await saved()).extras.length;
await dev.click("#cal-add-from-library"); await sleep(400);
const xl = () => dev.eval(`[...document.querySelectorAll(".xlib-sheet .xlib-row")].map(b => b.textContent.replace(/\\s+/g, " ").trim())`);
let rows = await xl();
t.check("From your library lists the foods with their kcal", rows.some(r => /^Pane comune ?300 kcal \/ 100 g$/.test(r)) && rows.some(r => /^Banana ?89 kcal \/ 100 g$/.test(r)), JSON.stringify(rows));
await dev.eval(`(() => { const f = document.getElementById("xlib-search"); f.value = "pane"; f.dispatchEvent(new Event("input", { bubbles: true })); })()`); await sleep(150);
rows = await xl();
t.check("search narrows the list", rows.length === 1 && /^Pane comune/.test(rows[0]), JSON.stringify(rows));
await dev.eval(`document.querySelector(".xlib-sheet .xlib-row").click()`); await sleep(200);
const xk = () => dev.eval(`document.getElementById("xlib-kcal").textContent`);
t.check("picking it suggests the grams you logged last time (60 g = 180 kcal)", (await dev.eval(`document.getElementById("xlib-grams").value`)) === "60" && /^60 g = 180 kcal\./.test(await xk()), await xk());
await dev.eval(`(() => { const f = document.getElementById("xlib-grams"); f.value = "30"; f.dispatchEvent(new Event("input", { bubbles: true })); })()`); await sleep(100);
t.check("changing the serving updates the kcal", /^30 g = 90 kcal\./.test(await xk()), await xk());
if (SHOTS) await dev.shot(`${SHOTS}/xlib-${W}${dark ? "-dark" : ""}.png`);
await dev.click("#xlib-add"); await sleep(500);
const ex = (await saved()).extras;
t.check("Add makes it a daily extra: Pane comune, 30 g, 90 kcal, 1 a day", ex.length === nBefore + 1 && JSON.stringify((({ name, unit, kcalPerUnit, perDay }) => ({ name, unit, kcalPerUnit, perDay }))(ex[ex.length - 1])) === JSON.stringify({ name: "Pane comune", unit: "30 g", kcalPerUnit: 90, perDay: 1 }) &&
  !(await dev.eval(`!!document.querySelector(".xlib-sheet")`)) && (await dev.eval(`[...document.querySelectorAll("#cal-extras .cal-extra__name")].pop().value`)) === "Pane comune", JSON.stringify(ex));
t.check("no sideways scroll in Settings", await dev.eval(`document.documentElement.scrollWidth <= innerWidth + 1`));
t.check("no JS errors", (await dev.eval("window.__errs.length")) === 0, JSON.stringify(await dev.eval("window.__errs")));
dev.close();

t.section("EATING OUT FROM INSULIN (2.82.0)");
{ const { eatingOutKcal, eatingOutMultiplier, ...rest } = calories; dev = await boot({ calories: rest }); }   // saved before: gets the defaults (x2, 900)
await openTrends(dev);
s = await card(dev);
// Two days ago: eating out 3u + 1.5u correction an hour later, at 1u:10g = 45 g carbs x 4 x 2 = 360; + 400 food + 348 extras = 1108.
t.check("by default eating out is worked out from its insulin and the correction after it: a full bar in the averages", s.partial === 0 && s.under === 3 && s.unknown === 0 &&
  s.stats.join("|") === "1,635 Avg eaten|2,405 Avg needed|\u2212770 Avg balance" && /Eating out worked out from its insulin and later corrections \(carbs \u00d7 4 kcal \u00d7 2\)/.test(s.caption), JSON.stringify(s));
await dev.eval(`document.querySelector('#trend-chart-calories .trend-chart__hit[data-idx="4"]').dispatchEvent(new MouseEvent("click", { bubbles: true }))`); await sleep(200);
const ro2 = await dev.eval(`document.querySelector("#trend-chart-calories .trend-readout").textContent`);
t.check("tapping that day shows the working", /ate 1,108 \(food 760/.test(ro2) && /eating out \u2248360 kcal \(4\.5u, incl\. 1\.5u correction at 1u:10g \u2192 45 g carbs \u00d74\u00d72\)/.test(ro2), ro2);
await dev.click("#cal-open-settings"); await sleep(800);
const exampleText = () => dev.eval(`document.getElementById("cal-eating-out-example").textContent`);
t.check("Settings shows x2 and 900, with the last eating-out meal worked through", (await dev.eval(`document.getElementById("cal-eating-out-mult").value`)) === "2" && (await dev.eval(`document.getElementById("cal-eating-out").value`)) === "900" &&
  /: 3u \+ 1\.5u of correction at 1u:10g = 45 g carbs \u00d7 4 kcal = 180 kcal, \u00d7 2 = 360 kcal\./.test(await exampleText()), await exampleText());
await dev.tab("calculator"); await sleep(300);
await dev.click("#cc-eating-out-toggle"); await sleep(250);
await dev.eval(`(() => { const f = document.getElementById("cc-eating-out-dose"); f.focus(); f.value = "10"; f.dispatchEvent(new Event("input", { bubbles: true })); })()`); await sleep(300);
const eoBar = await dev.eval(`(() => { const r = document.getElementById("cc-ratio-value"); return { today: document.getElementById("cc-day-kcal-today").textContent.replace(/\\s+/g, " ").trim(), ratio: r ? r.textContent : "" }; })()`);
const eoRatio = Number((/1u?:([\d.]+)/.exec(eoBar.ratio) || [])[1]);
t.check("the Calculator bar adds the typed eating-out dose at the current ratio (10u \u00d7 ratio \u00d7 4 \u00d7 2)", eoRatio > 0 && eoBar.today.endsWith(`+${Math.round(10 * eoRatio * 8).toLocaleString()}`), JSON.stringify(eoBar));
await dev.click("#cc-eating-out-toggle"); await sleep(250);
await dev.tab("settings"); await sleep(300); await dev.click('#settings-segmented [data-seg="calories"]'); await sleep(300);
await setField("#cal-eating-out-mult", "2,5");
t.check("a multiplier with a decimal comma is saved and the example follows", (await saved()).eatingOutMultiplier === 2.5 && /\u00d7 2\.5 = 450 kcal/.test(await exampleText()), await exampleText());
await setField("#cal-eating-out-mult", "9");
t.check("an out-of-range multiplier keeps what is saved", (await saved()).eatingOutMultiplier === 2.5);
await setField("#cal-eating-out-mult", "");
t.check("emptying the multiplier uses the fixed figure for every meal", (await saved()).eatingOutMultiplier === null && /Every eating-out meal counts 900 kcal/.test(await exampleText()), await exampleText());
await openTrends(dev);
await dev.eval(`document.querySelector('#trend-chart-calories .trend-chart__hit[data-idx="4"]').dispatchEvent(new MouseEvent("click", { bubbles: true }))`); await sleep(200);
const ro3 = await dev.eval(`document.querySelector("#trend-chart-calories .trend-readout").textContent`);
t.check("then the day counts 900 (fixed figure)", /ate 1,648 \(food 1,300/.test(ro3) && /eating out 900 kcal \(fixed figure\)/.test(ro3), ro3);
await dev.click("#cal-open-settings"); await sleep(800);
await setField("#cal-eating-out", "");
t.check("emptying both stops counting eating out", (await saved()).eatingOutKcal === null && /aren't counted/.test(await exampleText()));
await openTrends(dev);
s = await card(dev);
t.check("and the eating-out day is back to an outline with ?", s.partial === 1 && s.unknown === 1, JSON.stringify(s));
t.check("no JS errors", (await dev.eval("window.__errs.length")) === 0, JSON.stringify(await dev.eval("window.__errs")));
dev.close();

t.section("TODAY'S CALORIES BAR (2.79.0)");
{
  const todayHist = [meal("t1", Math.max(at(0, 0, 1), Date.now() - 60000), { totalKcal: 600 }), ...hist];
  const blob = stateBlob({ history: todayHist, settings: { darkMode: dark, darkModeAuto: false, calories } });
  dev = await openDevice(app, { width: W, height: 1000, mobile: W < 1000, dark, inject: `if (!localStorage.getItem("insulinBuddy.v2")) { ${seedLocal(blob)} }`, wait: 1500 });
}
await dev.tab("calculator"); await sleep(300);
const kbar = () => dev.eval(`(() => { const b = document.getElementById("cc-day-kcal"), c = document.getElementById("cc-day-carbs"); if (!b || b.hidden) return { shown: false };
  const bar = b.querySelector(".day-carbs__bar").getBoundingClientRect(), card = document.querySelector(".dose-card").getBoundingClientRect(), r = b.getBoundingClientRect();
  return { shown: true, today: document.getElementById("cc-day-kcal-today").textContent.replace(/\\s+/g, " ").trim(), target: document.getElementById("cc-day-kcal-target").textContent,
    fill: document.getElementById("cc-day-kcal-fill").getBoundingClientRect().width / bar.width, draft: document.getElementById("cc-day-kcal-draft").getBoundingClientRect().width / bar.width,
    belowCarbs: !c.hidden && r.top >= c.getBoundingClientRect().bottom - 0.5, inCard: r.bottom <= card.bottom + 0.5, oneLine: r.height < 28, over: b.classList.contains("is-over"), label: b.getAttribute("aria-label") }; })()`);
let k = await kbar();
console.log("  ", JSON.stringify(k));
// Today: 600 food against 2177.5 - 348 extras = 1829.5 left for food (no activity today). 2.79.1: extras are set aside, not added.
t.check("shown under the carbs bar, inside the dose card, on one line", k.shown && k.belowCarbs && k.inCard && k.oneLine, JSON.stringify(k));
t.check("today 600 kcal of food, 1,230 left of the 1,830 for food once extras are set aside", k.today === "Today 600 kcal" && k.target === "1,230 left" && Math.abs(k.fill - 600 / 1829.5) < 0.02, `${k.today} | ${k.target} | ${k.fill}`);
t.check("screen readers hear it in words", /Food today: about 600 kcal logged\. About 2,178 needed today, 348 of it set aside for your daily extras, so 1,830 for food: 1,230 left/.test(k.label), k.label);
await dev.waitFor(`document.getElementById("cc-food-list").children.length > 1`, 6000);
await dev.eval(`[...document.getElementById("cc-food-list").children].find(c => /Banana/.test(c.textContent)).click()`);
await dev.eval(`(() => { const g = document.getElementById("cc-grams"); g.value = "200"; g.dispatchEvent(new Event("input", { bubbles: true })); })()`);
await dev.click("#cc-add-btn"); await sleep(400);
k = await kbar();
t.check("the meal being built adds +178 kcal as a lighter piece", k.today === "Today 600 kcal +178" && k.target === "1,052 left" && Math.abs(k.draft - 178 / 1829.5) < 0.02, JSON.stringify(k));
if (SHOTS) { await dev.eval(`document.querySelector(".dose-card").scrollIntoView({ block: "start" })`); await sleep(400); await dev.shot(`${SHOTS}/calories-bar-${W}${dark ? "-dark" : ""}.png`); }
await dev.click("#cc-log-btn"); await sleep(600);
k = await kbar();
const align = await dev.eval(`(() => { const [a, b] = ["cc-day-carbs", "cc-day-kcal"].map(id => document.querySelector("#" + id + " .day-carbs__bar").getBoundingClientRect()); return { dl: Math.abs(a.left - b.left), dr: Math.abs(a.right - b.right) }; })()`);
t.check("the carbs and calories bars line up", align.dl < 1.5 && align.dr < 1.5, JSON.stringify(align));
t.check("once logged it counts: 778 kcal, 1,052 left", k.today === "Today 778 kcal" && k.target === "1,052 left" && k.draft < 0.01, JSON.stringify(k));
// 2.83.0: tapping the bar opens today's extras, starting at the usual amounts (olive oil 2 tbsp, flat white 1 cup = 348).
await dev.click("#cc-day-kcal"); await sleep(600);
const dxs = () => dev.eval(`(() => { const sh = document.querySelector(".day-extras-sheet"); if (!sh) return { open: false };
  const rows = [...sh.querySelectorAll(".dx-row")].map(r => ({ id: r.dataset.xid, n: r.querySelector(".dx-step__count").textContent, sub: r.querySelector(".dx-row__sub").textContent, changed: r.classList.contains("is-changed"), minusOff: r.querySelector('[data-dx="-1"]').disabled }));
  return { open: true, rows, total: document.getElementById("dx-total").textContent, resetShown: !document.getElementById("dx-reset").hidden && document.getElementById("dx-reset").offsetParent !== null }; })()`);
const dayExtrasSaved = () => dev.eval(`JSON.parse(localStorage.getItem("insulinBuddy.v2")).settings.calories.dayExtras || {}`);
const todayKey = await dev.eval(`(() => { const d = new Date(), p = n => String(n).padStart(2, "0"); return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()); })()`);
let dx = await dxs();
t.check("tapping the bar opens today's extras at the usual amounts", dx.open && dx.rows.map(r => r.n).join(",") === "2,1" && dx.total === "Today 348 kcal of extras" && !dx.resetShown, JSON.stringify(dx));
const tapDx = (id, d) => dev.eval(`document.querySelector('.day-extras-sheet [data-xid="${id}"] [data-dx="${d}"]').click()`);
await tapDx("flat-white", 1); await tapDx("flat-white", 1); await sleep(250);
dx = await dxs(); k = await kbar();
t.check("two more flat whites: 3 today, saved for today only, the total says the usual", dx.rows[1].n === "3" && dx.rows[1].changed && /3 cups · 330 kcal · usual 1/.test(dx.rows[1].sub) &&
  dx.total === "Today 568 kcal of extras (usual 348)" && dx.resetShown && JSON.stringify(await dayExtrasSaved()) === JSON.stringify({ [todayKey]: { "flat-white": 3 } }), JSON.stringify(dx));
t.check("the bar behind follows at once: 2,178 - 568 extras - 778 food = 832 left", k.target === "832 left", JSON.stringify(k));
await tapDx("olive-oil", -1); await tapDx("olive-oil", -1); await sleep(250);
dx = await dxs();
t.check("no oil today: 0, and \u2212 can't go below it", dx.rows[0].n === "0" && dx.rows[0].minusOff && dx.total === "Today 330 kcal of extras (usual 348)", JSON.stringify(dx));
if (SHOTS) { await dev.shot(`${SHOTS}/day-extras-${W}${dark ? "-dark" : ""}.png`); }
await dev.click("#dx-reset"); await sleep(250);
dx = await dxs();
t.check("Back to usual undoes today's changes", dx.rows.map(r => r.n).join(",") === "2,1" && !dx.resetShown && JSON.stringify(await dayExtrasSaved()) === "{}", JSON.stringify(dx));
await tapDx("flat-white", 1); await sleep(150);
await dev.click("#dx-done"); await sleep(300);
k = await kbar();
t.check("Done closes it, and today keeps 2 flat whites (2,178 - 458 - 778 = 942 left)", !(await dxs()).open && k.target === "942 left", JSON.stringify(k));
await dev.click("#cc-day-kcal"); await sleep(500);
await dev.click("#dx-trends"); await sleep(700);
t.check("from the sheet, Calories in Trends opens the card", await dev.eval(`!document.getElementById("view-history").hidden && document.querySelector('#history-segmented [data-seg="trends"]').classList.contains("is-active")`));
await dev.eval(`document.querySelector('#trends-range-segmented [data-range="7"]').click()`); await sleep(400);
await dev.eval(`document.querySelector('#trend-chart-calories .trend-chart__hit[data-idx="6"]').dispatchEvent(new MouseEvent("click", { bubbles: true }))`); await sleep(200);
const roT = await dev.eval(`document.querySelector("#trend-chart-calories .trend-readout").textContent`);
t.check("Trends shows today's changed extras", /extras 458, changed that day\)/.test(roT), roT);
await dev.tab("calculator"); await sleep(300);
t.check("no sideways scroll, no JS errors", (await dev.eval(`document.documentElement.scrollWidth <= innerWidth + 1`)) && (await dev.eval("window.__errs.length")) === 0, JSON.stringify(await dev.eval("window.__errs")));
dev.close();

t.section("NOT SET UP");
dev = await boot({});
await openTrends(dev);
s = await card(dev);
t.check("without details the card still shows what was eaten and asks for details", s.shown && s.eaten >= 3 && s.under + s.over === 0 && /Add your details/.test(s.caption) && /Eaten/.test(s.legend), JSON.stringify(s));
await dev.tab("calculator"); await sleep(300);
t.check("without details there's no calories bar in the Calculator", await dev.eval(`document.getElementById("cc-day-kcal").hidden`));
await openTrends(dev);
t.check("the Watch ride still counts; the hand-logged run says it needs a weight", /1 activity isn't counted: add your weight/.test(s.how), s.how);
t.check("no JS errors", (await dev.eval("window.__errs.length")) === 0, JSON.stringify(await dev.eval("window.__errs")));
dev.close();

await app.close();
process.exit(t.summary() ? 0 : 1);
