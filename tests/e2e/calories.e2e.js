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

t.section("COMPACT DAILY EXTRAS (2.101.0)");
const sumOf = id => dev.eval(`(() => { const r = document.querySelector('#cal-extras [data-xid="${id}"]'); const b = r.querySelector("[data-xtoggle]"); return { name: r.querySelector(".cal-extra__sum-name").textContent, amt: r.querySelector(".cal-extra__sum-amt").textContent, when: r.querySelector(".cal-extra__sum-when").textContent, kcal: r.querySelector(".cal-extra__kcal").textContent, open: b.getAttribute("aria-expanded"), editHidden: r.querySelector(".cal-extra__edit").hidden, h: Math.round(r.getBoundingClientRect().height) }; })()`);
let so = await sumOf("olive-oil");
t.check("each extra starts as one closed summary line: name, amount, when, kcal", so.name === "Olive oil" && so.amt === "2 tbsp" && so.when === "Any meal \u00b7 every day" && so.kcal === "238 kcal" && so.open === "false" && so.editHidden && so.h > 0 && so.h <= 72, JSON.stringify(so));
const toggleX = id => dev.eval(`document.querySelector('#cal-extras [data-xid="${id}"] [data-xtoggle]').click()`);
await toggleX("olive-oil"); await sleep(150);
so = await sumOf("olive-oil");
t.check("tapping it opens the editor with every field", so.open === "true" && !so.editHidden && (await dev.eval(`["name","perDay","unit","kcalPerUnit"].every(k => { const f = document.querySelector('#cal-extras [data-xid="olive-oil"] [data-xfield="' + k + '"]'); return f && f.getBoundingClientRect().height > 0; })`)), JSON.stringify(so));
await toggleX("olive-oil"); await sleep(150);
t.check("tapping it again closes it", (await sumOf("olive-oil")).editHidden);
await toggleX("olive-oil"); await toggleX("flat-white"); await sleep(150);
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
t.check("the summary follows what is saved and the editor stays open after a save", (await sumOf("olive-oil")).amt === "1.5 tbsp" && (await sumOf("olive-oil")).kcal === "179 kcal" && !(await sumOf("olive-oil")).editHidden && (await sumOf("flat-white")).name === "Flat white");
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
// 2.100.1: English finds the Italian name, and the empty message isn't clipped under the search box
await dev.eval(`(() => { const f = document.getElementById("xlib-search"); f.value = "Bread"; f.dispatchEvent(new Event("input", { bubbles: true })); })()`); await sleep(150);
rows = await xl();
t.check("searching Bread finds Pane comune", rows.length === 1 && /^Pane comune/.test(rows[0]), JSON.stringify(rows));
await dev.eval(`(() => { const f = document.getElementById("xlib-search"); f.value = "Wine"; f.dispatchEvent(new Event("input", { bubbles: true })); })()`); await sleep(150);
const emptyMsg = await dev.eval(`(() => { const p = document.querySelector("#xlib-list > .panel-card__hint"), f = document.getElementById("xlib-search"), l = document.getElementById("xlib-list"); if (!p) return null; const a = p.getBoundingClientRect(), b = f.getBoundingClientRect(), c = l.getBoundingClientRect(); return { text: p.textContent, belowField: a.top >= b.bottom - 0.5, inList: a.top >= c.top - 0.5 }; })()`);
t.check("nothing matching: the message sits fully below the search box", emptyMsg && emptyMsg.belowField && emptyMsg.inList && /Nothing in your library matches .Wine./.test(emptyMsg.text), JSON.stringify(emptyMsg));
await dev.eval(`(() => { const f = document.getElementById("xlib-search"); f.value = "pane"; f.dispatchEvent(new Event("input", { bubbles: true })); })()`); await sleep(150);
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
await dev.click("#cc-day-kcal"); await sleep(600); await dev.click("#dc-extras"); await sleep(400);
const dxs = () => dev.eval(`(() => { const sh = document.querySelector(".day-extras-sheet"); if (!sh) return { open: false };
  const rows = [...sh.querySelectorAll(".dx-row")].map(r => ({ id: r.dataset.xid, n: r.querySelector(".dx-step__count").textContent, sub: r.querySelector(".dx-row__sub").textContent, changed: r.classList.contains("is-changed"), minusOff: r.querySelector('[data-dx="-1"]').disabled }));
  return { open: true, rows, total: document.getElementById("dx-total").textContent, resetShown: !document.getElementById("dx-reset").hidden && document.getElementById("dx-reset").offsetParent !== null }; })()`);
const dayExtrasSaved = () => dev.eval(`JSON.parse(localStorage.getItem("insulinBuddy.v2")).settings.calories.dayExtras || {}`);
const todayKey = await dev.eval(`(() => { const d = new Date(), p = n => String(n).padStart(2, "0"); return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()); })()`);
let dx = await dxs();
t.check("tapping the bar, then Change today's extras, opens today's extras at the usual amounts", dx.open && dx.rows.map(r => r.n).join(",") === "2,1" && dx.total === "Today 348 kcal of extras" && !dx.resetShown, JSON.stringify(dx));
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
await dev.click("#cc-day-kcal"); await sleep(500); await dev.click("#dc-extras"); await sleep(400);
await dev.click("#dx-trends"); await sleep(700);
t.check("from the sheet, Calories in Trends opens the card", await dev.eval(`!document.getElementById("view-history").hidden && document.querySelector('#history-segmented [data-seg="trends"]').classList.contains("is-active")`));
await dev.eval(`document.querySelector('#trends-range-segmented [data-range="7"]').click()`); await sleep(400);
await dev.eval(`document.querySelector('#trend-chart-calories .trend-chart__hit[data-idx="6"]').dispatchEvent(new MouseEvent("click", { bubbles: true }))`); await sleep(200);
const roT = await dev.eval(`document.querySelector("#trend-chart-calories .trend-readout").textContent`);
t.check("Trends shows today's changed extras", /extras 458, changed that day\)/.test(roT), roT);
await dev.tab("calculator"); await sleep(300);
t.check("no sideways scroll, no JS errors", (await dev.eval(`document.documentElement.scrollWidth <= innerWidth + 1`)) && (await dev.eval("window.__errs.length")) === 0, JSON.stringify(await dev.eval("window.__errs")));
dev.close();

t.section("PAST DAYS AND ONE-OFF ITEMS (2.91.0)");
dev = await boot({ calories });
await openTrends(dev);
t.check("no day picked: no day button", await dev.eval(`document.getElementById("cal-day-extras-btn").hidden`));
await dev.eval(`document.querySelector('#trend-chart-calories .trend-chart__hit[data-idx="5"]').dispatchEvent(new MouseEvent("click", { bubbles: true }))`); await sleep(200);
const dayBtn = await dev.eval(`(() => { const b = document.getElementById("cal-day-extras-btn"); return { shown: !b.hidden && b.offsetParent !== null, text: b.textContent, day: b.dataset.day }; })()`);
const ydayKey = await dev.eval(`(() => { const d = new Date(); d.setDate(d.getDate() - 1); const p = n => String(n).padStart(2, "0"); return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()); })()`);
t.check("picking yesterday shows a button for its extras", dayBtn.shown && /^Change extras for /.test(dayBtn.text) && dayBtn.day === ydayKey, JSON.stringify(dayBtn));
await dev.click("#cal-day-extras-btn"); await sleep(500);
const sh = () => dev.eval(`(() => { const s = document.querySelector(".day-extras-sheet"); if (!s) return { open: false }; return { open: true, title: s.querySelector("#dx-title").textContent, add: (s.querySelector("#dx-add") || {}).textContent, trends: !!s.querySelector("#dx-trends"),
  rows: [...s.querySelectorAll(".dx-row")].map(r => ({ id: r.dataset.xid, n: r.querySelector(".dx-step__count").textContent, sub: r.querySelector(".dx-row__sub").textContent, once: r.classList.contains("is-once") })), total: s.querySelector("#dx-total").textContent }; })()`);
let ps = await sh();
t.check("it opens that day's extras (not today's), with no link back to Trends", ps.open && /^Extras · /.test(ps.title) && ps.add === "+ Add something that day" && !ps.trends && ps.rows.map(r => r.n).join(",") === "2,1", JSON.stringify(ps));
await dev.eval(`document.querySelector('.day-extras-sheet [data-xid="flat-white"] [data-dx="1"]').click()`); await sleep(200);
t.check("a change is saved for that day only", JSON.stringify(((await saved()).dayExtras || {})) === JSON.stringify({ [ydayKey]: { "flat-white": 2 } }), JSON.stringify((await saved()).dayExtras));
await dev.click("#dx-add"); await sleep(400);
t.check("+ Add something that day opens the library picker for that day", /^Add to /.test(await dev.eval(`document.getElementById("xlib-title").textContent`)));
await dev.eval(`(() => { const f = document.getElementById("xlib-search"); f.value = "ban"; f.dispatchEvent(new Event("input", { bubbles: true })); })()`); await sleep(150);
await dev.eval(`document.querySelector(".xlib-sheet .xlib-row").click()`); await sleep(200);
await dev.eval(`(() => { const f = document.getElementById("xlib-grams"); f.value = "120"; f.dispatchEvent(new Event("input", { bubbles: true })); })()`); await sleep(100);
t.check("the serving says it's for that day only", /^120 g = 107 kcal\. Added for that day only\./.test(await dev.eval(`document.getElementById("xlib-kcal").textContent`)));
await dev.click("#xlib-add"); await sleep(400);
ps = await sh();
const once = ps.rows.find(r => r.once);
t.check("Banana joins that day as a one-off: 1 × 120 g, 107 kcal, that day only", ps.open && once && once.n === "1" && once.sub === "1 × 120 g · 107 kcal · that day only" && /565 kcal of extras \(usual 348\)/.test(ps.total), JSON.stringify(ps));
const oo = (await saved()).dayOneOffs || {};
t.check("stored for that day only, not in the usual list", Array.isArray(oo[ydayKey]) && oo[ydayKey].length === 1 && oo[ydayKey][0].name === "Banana" && (await saved()).extras.every(x => x.name !== "Banana"), JSON.stringify(oo));
if (SHOTS) await dev.shot(`${SHOTS}/day-extras-past-${W}${dark ? "-dark" : ""}.png`);
await dev.click("#dx-done"); await sleep(600);
const roP = await dev.eval(`document.querySelector("#trend-chart-calories .trend-readout").textContent`);
t.check("back in Trends the same day stays picked and shows the new extras", /ate 2,165 \(food 1,600 \+ extras 565, changed that day\)/.test(roP) && !(await dev.eval(`document.getElementById("cal-day-extras-btn").hidden`)), roP);
// remove the one-off: − at 1 takes it off
await dev.click("#cal-day-extras-btn"); await sleep(500);
await dev.eval(`document.querySelector('.day-extras-sheet .dx-row.is-once [data-dx="-1"]').click()`); await sleep(200);
ps = await sh();
t.check("\u2212 on a one-off at 1 removes it", !ps.rows.some(r => r.once) && JSON.stringify((await saved()).dayOneOffs || {}) === "{}", JSON.stringify(ps));
await dev.click("#dx-reset"); await sleep(200);
t.check("Back to usual clears that day", JSON.stringify((await saved()).dayExtras || {}) === "{}");
await dev.click("#dx-done"); await sleep(400);
await dev.tab("calculator"); await sleep(300);
await dev.click("#cc-day-kcal"); await sleep(500); await dev.click("#dc-extras"); await sleep(400);
ps = await sh();
t.check("from the Calculator it's still today's extras, with + Add something today", ps.open && ps.title === "Today's extras" && ps.add === "+ Add something today" && ps.trends, JSON.stringify(ps));
await dev.click("#dx-done"); await sleep(300);
t.check("no JS errors", (await dev.eval("window.__errs.length")) === 0, JSON.stringify(await dev.eval("window.__errs")));
dev.close();

t.section("EXTRAS WITH MEALS (2.94.0; several meals 2.95.0)");
const { autoMealType } = await import(new URL("../../js/core/time.js", import.meta.url).href);
const curMeal = autoMealType(new Date());                                         // what a meal built now is logged as
const seedType = curMeal === "breakfast" ? "lunch" : "breakfast";                  // the meal already logged today
const otherMeal = ["dinner", "lunch", "snack", "breakfast"].find(m => m !== curMeal && m !== seedType);
{
  // Today: one meal a minute ago (600 kcal) as seedType. Olive oil every day (238, set aside); flat white 1 cup (110).
  const todayHist = [meal("b1", Math.max(at(0, 0, 1), Date.now() - 60000), { totalKcal: 600, mealType: seedType })];
  const blob = stateBlob({ history: todayHist, settings: { darkMode: dark, darkModeAuto: false, calories } });
  dev = await openDevice(app, { width: W, height: 1000, mobile: W < 1000, dark, inject: `if (!localStorage.getItem("insulinBuddy.v2")) { ${seedLocal(blob)} }`, wait: 1500 });
}
await dev.tab("settings"); await sleep(300); await dev.click('#settings-segmented [data-seg="calories"]'); await sleep(400);
await dev.click("#cal-add-extra"); await sleep(300);
const mid = (await saved()).extras.slice(-1)[0].id;
await setField(`#cal-extras [data-xid="${mid}"] [data-xfield="name"]`, "Mozzarella");
await setField(`#cal-extras [data-xid="${mid}"] [data-xfield="unit"]`, "ball");
await setField(`#cal-extras [data-xid="${mid}"] [data-xfield="kcalPerUnit"]`, "250");
const chips = id => dev.eval(`(() => { const r = document.querySelector('#cal-extras [data-xid="${id}"]'); return { on: [...r.querySelectorAll("[data-xmeal]")].filter(b => b.getAttribute("aria-pressed") === "true").map(b => b.dataset.xmeal), labels: [...r.querySelectorAll("[data-xmeal]")].map(b => b.textContent), text: r.querySelector(".cal-extra__when-text").textContent }; })()`);
const tapChip = (id, m) => dev.eval(`document.querySelector('#cal-extras [data-xid="${id}"] [data-xmeal="${m}"]').click()`);
let c0 = await chips(mid);
t.check("each extra has meal chips (Breakfast, Lunch, Dinner, Snack), none on = every day", JSON.stringify(c0.labels) === JSON.stringify(["Breakfast", "Lunch", "Dinner", "Snack"]) && c0.on.length === 0 && /^Every day you log a meal/.test(c0.text), JSON.stringify(c0));
await tapChip(mid, otherMeal); await sleep(200);
c0 = await chips(mid);
t.check("tapping a chip saves it and says when it counts", JSON.stringify((await saved()).extras.find(x => x.id === mid).meals) === JSON.stringify([otherMeal]) && c0.on.join() === otherMeal && c0.text === `Only on days you log ${otherMeal}.`, JSON.stringify(c0));
t.check("the total says how much only counts with meals", /Extras: 598 kcal a day, 250 of it only with the meals you picked\./.test(await dev.eval(`document.getElementById("cal-extras-total").textContent`)));
await dev.tab("calculator"); await sleep(300);
k = await kbar();
t.check("not that meal's day: mozzarella doesn't count (today 600 kcal, 1,230 left)", k.today === "Today 600 kcal" && k.target === "1,230 left", JSON.stringify(k));
await dev.click("#cc-day-kcal"); await sleep(400); await dev.click("#dc-extras"); await sleep(400);
let mrow = await dev.eval(`document.querySelector('.day-extras-sheet [data-xid="${mid}"] .dx-row__sub').textContent`);
t.check("Today's extras says it counts once that meal is logged", mrow === `1 ball · 250 kcal · counts once ${otherMeal} is logged`, mrow);
await dev.click("#dx-done"); await sleep(300);
// 2.95.0: mozzarella with the meal of the moment; flat white (1 cup) split over the meal already logged and this one
await dev.tab("settings"); await sleep(300); await dev.click('#settings-segmented [data-seg="calories"]'); await sleep(300);
await tapChip(mid, otherMeal); await tapChip(mid, curMeal); await sleep(150);
await tapChip("flat-white", seedType); await tapChip("flat-white", curMeal); await sleep(200);
const fw = await chips("flat-white");
const order = ["breakfast", "lunch", "dinner", "snack"].filter(m => m === seedType || m === curMeal);
t.check("two meals picked: the amount is split between them", JSON.stringify((await saved()).extras.find(x => x.id === "flat-white").meals) === JSON.stringify(order) && fw.text === `Split over ${order[0]} and ${order[1]}: 0.5 cup each. A day with only some of them counts their share.`, JSON.stringify(fw));
await dev.tab("calculator"); await sleep(300);
k = await kbar();
// set aside now: oil 238 only -> 2177.5 - 238 = 1939.5 for food; eaten 600 + half a flat white 55 = 655
t.check(`with only ${seedType} logged, half the flat white counts: 655 kcal, 1,285 left`, k.today === "Today 655 kcal" && k.target === "1,285 left", JSON.stringify(k));
await dev.click("#cc-day-kcal"); await sleep(400); await dev.click("#dc-extras"); await sleep(400);
mrow = await dev.eval(`document.querySelector('.day-extras-sheet [data-xid="flat-white"] .dx-row__sub').textContent`);
t.check("Today's extras shows the share so far", mrow === `1 cup · 110 kcal · 55 counted (${seedType} so far)`, mrow);
await dev.click("#dx-done"); await sleep(300);
await dev.waitFor(`document.getElementById("cc-food-list").children.length > 1`, 6000);
await dev.eval(`[...document.getElementById("cc-food-list").children].find(c => /Banana/.test(c.textContent)).click()`);
await dev.eval(`(() => { const g = document.getElementById("cc-grams"); g.value = "200"; g.dispatchEvent(new Event("input", { bubbles: true })); })()`);
await dev.click("#cc-add-btn"); await sleep(400);
k = await kbar();
t.check(`building a ${curMeal} brings mozzarella and the other half flat white: +178 +250 +55 = +483`, k.today === "Today 655 kcal +483" && k.target === "802 left", JSON.stringify(k));
await dev.click("#cc-log-btn"); await sleep(700);
k = await kbar();
t.check(`once logged: 600 + 178 + 250 + 110 = 1,138`, k.today === "Today 1,138 kcal" && k.target === "802 left", JSON.stringify(k));
await dev.click("#cc-day-kcal"); await sleep(400); await dev.click("#dc-extras"); await sleep(400);
const subs = await dev.eval(`[...document.querySelectorAll(".day-extras-sheet .dx-row")].map(r => r.dataset.xid + ": " + r.querySelector(".dx-row__sub").textContent)`);
t.check("and the sheet says both are with their meals", subs.includes(`${mid}: 1 ball · 250 kcal · with ${curMeal}`) && subs.includes(`flat-white: 1 cup · 110 kcal · with ${order[0]} + ${order[1]}`), JSON.stringify(subs));
if (SHOTS) await dev.shot(`${SHOTS}/meal-split-sheet-${W}${dark ? "-dark" : ""}.png`);
await dev.click("#dx-done"); await sleep(300);
if (SHOTS) { await dev.tab("settings"); await sleep(300); await dev.click('#settings-segmented [data-seg="calories"]'); await sleep(300); await dev.eval(`document.querySelector('#cal-extras [data-xid="flat-white"]').scrollIntoView({ block: "start" })`); await sleep(300); await dev.shot(`${SHOTS}/meal-split-settings-${W}${dark ? "-dark" : ""}.png`); }
t.check("no JS errors", (await dev.eval("window.__errs.length")) === 0, JSON.stringify(await dev.eval("window.__errs")));
dev.close();

t.section("EATING OUT WITH CALORIES TYPED (2.96.0)");
{ const { eatingOutKcal, eatingOutMultiplier, ...rest } = calories; dev = await boot({ calories: rest }); }   // defaults: estimate from insulin x2
await dev.tab("calculator"); await sleep(300);
await dev.click("#cc-eating-out-toggle"); await sleep(250);
await dev.eval(`(() => { const f = document.getElementById("cc-eating-out-dose"); f.focus(); f.value = "10"; f.dispatchEvent(new Event("input", { bubbles: true })); })()`); await sleep(300);
const eoR = Number((/1u?:([\d.]+)/.exec(await dev.eval(`document.getElementById("cc-ratio-value").textContent`)) || [])[1]);
const estK = Math.round(10 * eoR * 8);
const ph = await dev.eval(`document.getElementById("cc-eating-out-kcal").placeholder`);
t.check("an empty calories box shows the estimate from the insulin", eoR > 0 && ph === `\u2248 ${estK.toLocaleString()} estimated`, ph);
k = await kbar();
t.check("and the bar adds that estimate", k.today.endsWith(`+${estK.toLocaleString()}`), JSON.stringify(k));
await dev.eval(`(() => { const f = document.getElementById("cc-eating-out-kcal"); f.focus(); f.value = "850"; f.dispatchEvent(new Event("input", { bubbles: true })); })()`); await sleep(200);
k = await kbar();
t.check("typing 850 kcal replaces it on the bar", k.today === "Today 0 kcal +850", JSON.stringify(k));
if (SHOTS) { await dev.eval(`document.activeElement.blur(); document.querySelector(".dose-card").scrollIntoView({ block: "start" })`); await sleep(300); await dev.shot(`${SHOTS}/eatout-kcal-${W}${dark ? "-dark" : ""}.png`); }
await dev.click("#cc-log-btn"); await sleep(700);
let eoEntry = (await dev.eval(`JSON.parse(localStorage.getItem("insulinBuddy.v2")).history`)).find(e => e.carbsUnknown);
t.check("logged: the entry keeps 850 kcal, the box is cleared", eoEntry && eoEntry.knownKcal === 850 && eoEntry.mealDose === 10 && (await dev.eval(`document.getElementById("cc-eating-out-kcal").value`)) === "", JSON.stringify(eoEntry));
k = await kbar();
t.check("today's bar counts it: 850 kcal", k.today === "Today 850 kcal", JSON.stringify(k));
await dev.tab("history"); await dev.click('#history-segmented [data-seg="log"]'); await sleep(400);
const card850 = await dev.eval(`(() => { const b = document.querySelector('[data-edit="${eoEntry.id}"]'); const c = b && b.closest(".history-entry, .history-row, .hs-wrap, li, article"); return c ? c.textContent.replace(/\\s+/g, " ") : document.getElementById("history-groups").textContent.replace(/\\s+/g, " "); })()`);
t.check("the log shows it next to 'Carbs not logged'", /Carbs not logged ?850 kcal/.test(card850), card850.slice(0, 200));
await dev.eval(`document.querySelector('[data-edit="${eoEntry.id}"]').click()`); await sleep(500);
t.check("Edit Meal shows the calories", (await dev.eval(`document.getElementById("em-eatout-kcal").value`)) === "850" && !(await dev.eval(`document.getElementById("em-eatout-kcal-field").hidden`)));
await dev.eval(`(() => { const f = document.getElementById("em-eatout-kcal"); f.value = "1,100"; f.dispatchEvent(new Event("input", { bubbles: true })); })()`);
await dev.click("#em-save"); await sleep(500);
eoEntry = (await dev.eval(`JSON.parse(localStorage.getItem("insulinBuddy.v2")).history`)).find(e => e.id === eoEntry.id);
t.check("changing it there is saved (1,100)", eoEntry.knownKcal === 1100, JSON.stringify(eoEntry.knownKcal));
await dev.eval(`document.querySelector('[data-edit="${eoEntry.id}"]').click()`); await sleep(500);
await dev.eval(`(() => { const f = document.getElementById("em-eatout-kcal"); f.value = ""; f.dispatchEvent(new Event("input", { bubbles: true })); })()`);
await dev.click("#em-save"); await sleep(500);
eoEntry = (await dev.eval(`JSON.parse(localStorage.getItem("insulinBuddy.v2")).history`)).find(e => e.id === eoEntry.id);
t.check("emptying it goes back to the estimate", !("knownKcal" in eoEntry));
await dev.tab("calculator"); await sleep(300);
k = await kbar();
t.check(`the bar then counts the estimate again (${estK.toLocaleString()})`, k.today === `Today ${estK.toLocaleString()} kcal`, JSON.stringify(k));
t.check("no JS errors", (await dev.eval("window.__errs.length")) === 0, JSON.stringify(await dev.eval("window.__errs")));
dev.close();

t.section("EXTRAS ON SOME WEEKDAYS (2.98.0)");
dev = await boot({ calories });
const todayDow = new Date().getDay();
await dev.tab("settings"); await sleep(300); await dev.click('#settings-segmented [data-seg="calories"]'); await sleep(400);
const dayChips = id => dev.eval(`(() => { const r = document.querySelector('#cal-extras [data-xid="${id}"]'); return { labels: [...r.querySelectorAll("[data-xday]")].map(b => b.textContent), names: [...r.querySelectorAll("[data-xday]")].map(b => b.getAttribute("aria-label")), on: [...r.querySelectorAll("[data-xday]")].filter(b => b.getAttribute("aria-pressed") === "true").map(b => Number(b.dataset.xday)), text: r.querySelector(".cal-extra__when-text").textContent }; })()`);
let dc = await dayChips("flat-white");
t.check("each extra has seven day chips, Monday first, every day = all seven lit (2.101.0)", dc.labels.join(",") === "Mo,Tu,We,Th,Fr,Sa,Su" && dc.names[0] === "Monday" && dc.on.length === 7 && /^Every day you log a meal/.test(dc.text), JSON.stringify(dc));
for (const n of [6, 0]) await dev.eval(`document.querySelector('#cal-extras [data-xid="flat-white"] [data-xday="${n}"]').click()`);
await sleep(200);
dc = await dayChips("flat-white");
t.check("Sat and Sun turned off: weekdays saved and described", JSON.stringify((await saved()).extras.find(x => x.id === "flat-white").days) === "[1,2,3,4,5]" && dc.text === "Weekdays only. Counted on those days when you log a meal." && (await sumOf("flat-white")).when === "Any meal \u00b7 weekdays", JSON.stringify(dc));
for (const n of [6, 0]) await dev.eval(`document.querySelector('#cal-extras [data-xid="flat-white"] [data-xday="${n}"]').click()`);
await sleep(200);
t.check("all seven back on is saved as every day", JSON.stringify((await saved()).extras.find(x => x.id === "flat-white").days) === "[]");
for (const n of [0, 1, 2, 3, 4, 5, 6].filter(n => n !== 3)) await dev.eval(`document.querySelector('#cal-extras [data-xid="flat-white"] [data-xday="${n}"]').click()`);
await dev.eval(`document.querySelector('#cal-extras [data-xid="flat-white"] [data-xday="3"]').click()`); await sleep(200);
t.check("the last day on can't be turned off", JSON.stringify((await saved()).extras.find(x => x.id === "flat-white").days) === "[3]");
for (const n of [0, 1, 2, 4, 5, 6]) await dev.eval(`document.querySelector('#cal-extras [data-xid="flat-white"] [data-xday="${n}"]').click()`);
// now every day except today
await dev.eval(`document.querySelector('#cal-extras [data-xid="flat-white"] [data-xday="${todayDow}"]').click()`);
await sleep(200);
t.check("six days: the summary says which day it's not", (await sumOf("flat-white")).when.startsWith("Any meal \u00b7 not "), (await sumOf("flat-white")).when);
const savedDays = (await saved()).extras.find(x => x.id === "flat-white").days;
t.check("the total says some only count on the days picked", /^Extras: 348 kcal a day, 110 only on the days you picked\.$/.test(await dev.eval(`document.getElementById("cal-extras-total").textContent`)), await dev.eval(`document.getElementById("cal-extras-total").textContent`));
t.check("every day but today: six days saved", savedDays.length === 6 && !savedDays.includes(todayDow), JSON.stringify(savedDays));
await dev.tab("calculator"); await sleep(300);
k = await kbar();
// today: only olive oil (238) set aside -> 2177.5 - 238 = 1939.5 for food
t.check("today isn't one of its days: the flat white isn't set aside (1,940 left)", k.today === "Today 0 kcal" && k.target === "1,940 left", JSON.stringify(k));
await dev.click("#cc-day-kcal"); await sleep(400); await dev.click("#dc-extras"); await sleep(400);
const todayName = await dev.eval(`new Date().toLocaleDateString(undefined, { weekday: "long" })`);
let fwSub = await dev.eval(`document.querySelector('.day-extras-sheet [data-xid="flat-white"] .dx-row__sub').textContent`);
t.check("Today's extras shows it at 0, not usual today", (await dev.eval(`document.querySelector('.day-extras-sheet [data-xid="flat-white"] .dx-step__count').textContent`)) === "0" && fwSub.endsWith(`not usual on ${todayName}s`), fwSub);
await dev.eval(`document.querySelector('.day-extras-sheet [data-xid="flat-white"] [data-dx="1"]').click()`); await sleep(200);
k = await kbar();
t.check("had one anyway: + counts it for today (1,830 left)", k.target === "1,830 left" && /usual 238\)/.test(await dev.eval(`document.getElementById("dx-total").textContent`)), JSON.stringify(k));
await dev.eval(`document.querySelector('.day-extras-sheet [data-xid="flat-white"] [data-dx="-1"]').click()`); await sleep(200);
const dayEx = (await saved()).dayExtras || {};
t.check("back to 0 is back to the usual for today (nothing stored)", JSON.stringify(dayEx) === "{}", JSON.stringify(dayEx));
if (SHOTS) await dev.shot(`${SHOTS}/days-sheet-${W}${dark ? "-dark" : ""}.png`);
await dev.click("#dx-done"); await sleep(300);
if (SHOTS) { await dev.tab("settings"); await sleep(300); await dev.click('#settings-segmented [data-seg="calories"]'); await sleep(300); await dev.eval(`document.querySelector('#cal-extras [data-xid="flat-white"]').scrollIntoView({ block: "start" })`); await sleep(300); await dev.shot(`${SHOTS}/days-settings-${W}${dark ? "-dark" : ""}.png`); }
t.check("no sideways scroll, no JS errors", (await dev.eval(`document.documentElement.scrollWidth <= innerWidth + 1`)) && (await dev.eval("window.__errs.length")) === 0, JSON.stringify(await dev.eval("window.__errs")));
dev.close();

t.section("MEALS LOGGED FOR LATER (2.99.0)");
{
  // A meal a minute ago (600) and one 90 min ahead (700, as dinner, with a dinner extra). Skipped close to midnight.
  const endOfDay = new Date(); endOfDay.setHours(23, 58, 0, 0);
  const aheadTs = Math.min(Date.now() + 90 * 60000, endOfDay.getTime()), sameDay = aheadTs > Date.now() + 3 * 60000;
  if (!sameDay) t.check("(skipped: too close to midnight to log something later today)", true);
  else {
    const withDinner = { ...calories, extras: [...calories.extras, { id: "mozz", name: "Mozzarella", unit: "ball", kcalPerUnit: 250, perDay: 1, meals: ["dinner"] }] };
    const h2 = [meal("ahead", aheadTs, { totalKcal: 700, mealType: "dinner" }), meal("now1", Math.max(at(0, 0, 1), Date.now() - 60000), { totalKcal: 600, mealType: "breakfast" })];
    const blob = stateBlob({ history: h2, settings: { darkMode: dark, darkModeAuto: false, calories: withDinner } });
    dev = await openDevice(app, { width: W, height: 1000, mobile: W < 1000, dark, inject: `if (!localStorage.getItem("insulinBuddy.v2")) { ${seedLocal(blob)} }`, wait: 1500 });
    await dev.tab("calculator"); await sleep(300);
    k = await kbar();
    const aheadTime = await dev.eval(`new Date(${aheadTs}).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })`);
    t.check("the later meal and its dinner extra don't count yet: today 600 kcal, 1,230 left", k.today === "Today 600 kcal" && k.target === "1,230 left", JSON.stringify(k));
    t.check("the bar's description says when it will count", /Dinner at .+ \(700 kcal\) counts from then/.test(k.label), k.label);
    await openTrends(dev);
    await dev.eval(`document.querySelector('#trend-chart-calories .trend-chart__hit[data-idx="6"]').dispatchEvent(new MouseEvent("click", { bubbles: true }))`); await sleep(200);
    const roL = await dev.eval(`document.querySelector("#trend-chart-calories .trend-readout").textContent`);
    t.check("Trends says the same for today", /ate 948 \(food 600 \+ extras 348\)/.test(roL) && /dinner at .+ \(700 kcal\) counts from then/.test(roL), roL);
    t.check("no JS errors", (await dev.eval("window.__errs.length")) === 0, JSON.stringify(await dev.eval("window.__errs")));
    dev.close();
  }
}

t.section("TODAY'S CALORIES BREAKDOWN (2.100.0)");
{
  const curMeal2 = autoMealType(new Date());
  const endOfDay2 = new Date(); endOfDay2.setHours(23, 58, 0, 0);
  const aheadTs2 = Math.min(Date.now() + 90 * 60000, endOfDay2.getTime());
  const laterOk = aheadTs2 > Date.now() + 3 * 60000;
  const tAgo = m => Math.max(at(0, 0, 1) + m * 1000, Date.now() - m * 60000);
  const withMeal = { ...calories, extras: [...calories.extras, { id: "mozz", name: "Mozzarella", unit: "ball", kcalPerUnit: 250, perDay: 1, meals: [curMeal2] }, { id: "nut", name: "Nuts", unit: "handful", kcalPerUnit: 160, perDay: 1, meals: [curMeal2 === "dinner" ? "lunch" : "dinner"] }] };
  const h3 = [
    meal("f1", tAgo(30), { totalKcal: 520, mealType: curMeal2, items: [{ name: "Pane comune", grams: 60, carbs: 39, kcal: 180 }, { name: "Banana", grams: 200, carbs: 46, kcal: 340 }] }),
    meal("e1x", tAgo(20), { mealType: "snack", carbsUnknown: true, items: [], totalCarbs: 0, totalKcal: 0, mealDose: 2, ratioValue: 10, knownKcal: 300 }),
    { id: "w1", ts: tAgo(60), entryType: "activity", mealType: "activity", activityType: "walk", intensity: "moderate", durationMin: 30, items: [], totalCarbs: 0, totalKcal: 0, mealDose: 0, correctionDose: 0 },
    ...(laterOk ? [meal("later1", aheadTs2, { totalKcal: 700, mealType: "dinner" })] : [])
  ];
  const blob = stateBlob({ history: h3, settings: { darkMode: dark, darkModeAuto: false, calories: withMeal } });
  dev = await openDevice(app, { width: W, height: 1000, mobile: W < 1000, dark, inject: `if (!localStorage.getItem("insulinBuddy.v2")) { ${seedLocal(blob)} }`, wait: 1500 });
  await dev.tab("calculator"); await sleep(300);
  k = await kbar();
  await dev.click("#cc-day-kcal"); await sleep(500);
  const bd = await dev.eval(`(() => { const s = document.querySelector(".day-kcal-sheet"); if (!s) return { open: false };
    const secs = [...s.querySelectorAll(".dc-section")].map(x => ({ title: [...x.querySelector(".dc-section__title").children].map(c => c.textContent.trim()).join(" "), rows: [...x.querySelectorAll(".dc-row")].map(r => [r.querySelector(".dc-row__label").textContent, (r.querySelector(".dc-row__sub") || {}).textContent || "", r.querySelector(".dc-row__kcal").textContent]) }));
    return { open: true, title: s.querySelector("#dc-title").textContent, head: [...s.querySelector(".dc-head").children].map(c => c.textContent.replace(/\\s+/g, " ").trim()).join(" "), secs }; })()`);
  console.log("  ", JSON.stringify(bd).slice(0, 900));
  const sec = name => (bd.secs || []).find(x => x.title.startsWith(name)) || { rows: [], title: "" };
  // food 520 + eating out 300 = 820; extras: oil 238 + flat white 110 + mozzarella 250 (its meal is logged) = 598; nuts wait.
  // needed: 2177.5 + walk (3.5-1)*75*0.5 = 93.75 -> 2271.25; left = 2271.25 - 820 - 598 = 853.25
  t.check("tapping the bar opens Today's calories", bd.open && bd.title === "Today's calories");
  t.check("headline: 1,418 counted so far, 853 left of 2,271 needed (same left as the bar)", bd.head === "1,418 kcal counted so far 853 left of 2,271 needed today" && k.target === "853 left", bd.head + " | " + k.target);
  const food = sec("Food");
  t.check("Food lists each meal in time order with its foods and kcal", food.title === "Food 820 kcal" && food.rows.length === 2 && /Pane comune, Banana/.test(food.rows[0][1]) && food.rows[0][2] === "520" && /eating out, as you logged it/.test(food.rows[1][1]) && food.rows[1][2] === "300", JSON.stringify(food));
  const ex = sec("Extras");
  t.check("Extras lists what counted, and what's still waiting for its meal", ex.title === "Extras 598 kcal" && ex.rows.some(r => r[0] === "Olive oil" && r[2] === "238") && ex.rows.some(r => r[0] === "Mozzarella" && /with /.test(r[1]) && r[2] === "250") && ex.rows.some(r => r[0] === "Nuts" && /counts once .* is logged/.test(r[1]) && r[2] === "\u2014"), JSON.stringify(ex));
  if (laterOk) { const lt = sec("Later today"); t.check("Later today lists the meal logged ahead", lt.rows.length === 1 && lt.rows[0][1] === "counts from then" && lt.rows[0][2] === "700", JSON.stringify(lt)); }
  const nd = sec("Needed today");
  t.check("Needed shows resting, everyday moving and the walk", nd.title === "Needed today 2,271 kcal" && nd.rows[0][0] === "Resting" && nd.rows[0][2] === "1,675" && nd.rows[1][2] === "+503" && /^Walk/.test(nd.rows[2][0]) && nd.rows[2][2] === "+94", JSON.stringify(nd));
  if (SHOTS) await dev.shot(`${SHOTS}/day-kcal-${W}${dark ? "-dark" : ""}.png`);
  await dev.click("#dc-extras"); await sleep(500);
  t.check("Change today's extras opens the extras sheet in its place", !(await dev.eval(`!!document.querySelector(".day-kcal-sheet")`)) && (await dev.eval(`!!document.querySelector(".day-extras-sheet")`)));
  await dev.click("#dx-done"); await sleep(300);
  t.check("no sideways scroll, no JS errors", (await dev.eval(`document.documentElement.scrollWidth <= innerWidth + 1`)) && (await dev.eval("window.__errs.length")) === 0, JSON.stringify(await dev.eval("window.__errs")));
  dev.close();
}

t.section("PROTEIN, CARBS, FAT AND SALT (2.102.0)");
{
  const lib = [
    { id: "s1", name: "Pane comune", category: "grains", carbs: 65, kcal: 300, protein: 8, fat: 1.5, salt: 1.2, gi: 75, notes: "", favorite: false, usageCount: 9 },
    { id: "s2", name: "Banana", category: "fruits", carbs: 23, kcal: 89, protein: 1.1, fat: 0.3, salt: 0, gi: 51, notes: "", favorite: false, usageCount: 5 }
  ];
  // yesterday one meal (Pane comune 60 g, 40 g carbs logged) + olive oil 2 tbsp + flat white 1 cup (built-in figures)
  const hN = [meal("ny", at(1, 13)), meal("nt", Math.max(at(0, 0, 1), Date.now() - 60000))];
  const blob = stateBlob({ history: hN, library: lib, settings: { darkMode: dark, darkModeAuto: false, calories } });
  dev = await openDevice(app, { width: W, height: 1000, mobile: W < 1000, dark, inject: `if (!localStorage.getItem("insulinBuddy.v2")) { ${seedLocal(blob)} }`, wait: 1500 });
  await openTrends(dev);
  const nut = sel => dev.eval(`[...document.querySelectorAll("${sel} .nut-row")].map(r => [r.dataset.nutrient, r.querySelector(".nut-row__val").textContent, r.querySelector(".nut-row__word").textContent, r.className.replace("nut-row ", "")])`);
  const tr = await nut("#trend-card-nutrients");
  console.log("  ", JSON.stringify(tr));
  // protein 4.8 + 6.1 = 10.9 of 56.25; carbs 40 + 8.6 = 48.6 of 260 x 2177.5/2000 = 283; fat 0.9 + 27 + 5.7 = 33.6 of 76; salt 0.72 + 0.2 of max 6
  t.check("Trends shows the four nutrients against the scaled guide", JSON.stringify(tr) === JSON.stringify([
    ["protein", "11 g of 56 g", "lower (19%)", "is-low"], ["carbs", "49 g of 283 g", "lower (17%)", "is-low"],
    ["fat", "34 g of 76 g", "lower (44%)", "is-low"], ["salt", "0.9 g of max 6.0 g", "within the 6.0 g maximum", "is-ok"]]), JSON.stringify(tr));
  const cap = await dev.eval(`document.querySelector("#trend-card-nutrients .trend-caption").textContent`);
  t.check("its caption explains the guide and what's missing", /UK Reference Intakes/.test(cap) && /0\.75 g per kg of your weight \(56\.3 g\)/.test(cap) && /not a diabetes plan/.test(cap) && /Extras without a breakdown: Chocolate|Extras without a breakdown/.test(cap) === false, cap);
  await dev.tab("calculator"); await sleep(300);
  await dev.click("#cc-day-kcal"); await sleep(500);
  const td = await nut(".day-kcal-sheet");
  t.check("Today's calories has 'Nutrients so far' with the day's progress", td.length === 4 && td[0][2] === "19% so far" && td[0][1] === "11 g of 56 g" && td[3][2] === "within the 6.0 g maximum", JSON.stringify(td));
  if (SHOTS) { await dev.eval(`document.querySelector(".day-kcal-sheet .nut-rows").scrollIntoView({ block: "center" })`); await sleep(300); await dev.shot(`${SHOTS}/nutrients-today-${W}${dark ? "-dark" : ""}.png`); }
  await dev.click("#dc-close"); await sleep(300);
  if (SHOTS) { await openTrends(dev); await dev.eval(`document.getElementById("trend-card-nutrients").scrollIntoView({ block: "start" })`); await sleep(300); await dev.shot(`${SHOTS}/nutrients-trend-${W}${dark ? "-dark" : ""}.png`); }
  t.check("no sideways scroll, no JS errors", (await dev.eval(`document.documentElement.scrollWidth <= innerWidth + 1`)) && (await dev.eval("window.__errs.length")) === 0, JSON.stringify(await dev.eval("window.__errs")));
  dev.close();
}

t.section("MISSING FIGURES (2.103.0)");
{
  const lib = [
    { id: "m1", name: "Pane comune", category: "grains", carbs: 65, kcal: 300, protein: 8, fat: 1.5, salt: 1.2, gi: 75, notes: "", favorite: false, usageCount: 9 },
    { id: "m2", name: "Banana", category: "fruits", carbs: 23, kcal: 89, protein: 1.1, fat: 0.3, gi: 51, notes: "", favorite: false, usageCount: 5 },
    { id: "m3", name: "Farina", category: "grains", carbs: 72, kcal: 340, gi: 70, notes: "", favorite: false, usageCount: 0 }
  ];
  const recs = [{ id: "r1", name: "Banana Bread", items: [{ foodId: "m2", name: "Banana", grams: 200 }, { foodId: null, name: "Walnuts", grams: 30 }], finalWeight: 230 }];
  const item = (refId, name, grams) => ({ refType: "food", refId, name, grams, carbs: 10, kcal: 50 });
  const hM = [
    meal("mm1", at(1, 13), { items: [item("m2", "Banana", 120), item("gone1", "Old crackers", 30)] }),
    meal("mm2", at(2, 13), { items: [item("m2", "Banana", 120)] }),
    meal("mm3", Math.max(at(0, 0, 1), Date.now() - 60000), { items: [item("m2", "Banana", 120)] })
  ];
  const cal2 = { ...calories, extras: [...calories.extras, { id: "choc", name: "Chocolate", unit: "square", kcalPerUnit: 55, perDay: 1 }] };
  const blob = { ...stateBlob({ history: hM, library: lib, settings: { darkMode: dark, darkModeAuto: false, calories: cal2 } }), recipes: recs };
  dev = await openDevice(app, { width: W, height: 1000, mobile: W < 1000, dark, inject: `if (!localStorage.getItem("insulinBuddy.v2")) { ${seedLocal(blob)} }`, wait: 1500 });
  await openTrends(dev);
  const btn = await dev.eval(`(() => { const b = document.getElementById("nut-missing-btn"); return { hidden: b.hidden, text: b.textContent }; })()`);
  // Banana (no salt), Farina, Banana Bread + the 3 ready-made recipes (typed-in ingredients), Chocolate, Old crackers = 8
  t.check("the nutrients card offers 'Check missing figures' with a count", !btn.hidden && btn.text === "Check missing figures (8)", JSON.stringify(btn));
  await dev.click("#nut-missing-btn"); await sleep(500);
  const ms = await dev.eval(`(() => { const s = document.querySelector(".miss-sheet"); if (!s) return null;
    return { secs: [...s.querySelectorAll(".dc-section")].map(x => ({ title: [...x.querySelector(".dc-section__title").children].map(c => c.textContent.trim()).join(" "), rows: [...x.querySelectorAll(".miss-row")].map(r => [...r.querySelectorAll(".miss-row__name, .miss-row__sub")].map(c => c.textContent).join(" | ")) })),
      more: (s.querySelector("details.miss-more summary") || {}).textContent || "" }; })()`);
  console.log("  ", JSON.stringify(ms));
  const msec = n => ((ms && ms.secs) || []).find(x => x.title.startsWith(n)) || { rows: [] };
  t.check("eaten foods come first, with what's missing and how often", msec("Eaten").rows.length === 1 && msec("Eaten").rows[0] === "Banana | No salt · eaten 3× in 30 days", JSON.stringify(msec("Eaten")));
  t.check("recipes name the ingredient and the problem", msec("Recipes").rows.length === 4 && msec("Recipes").rows[0] === "Banana Bread | Banana: no salt \u00b7 Walnuts: typed in, so no protein, fat or salt" && msec("Recipes").rows.some(r => /^Classic chicken pad thai \| 11 ingredients typed in, so no protein, fat or salt \(Rice noodles, cooked, Petto di pollo, Egg and 8 more\)$/.test(r)), JSON.stringify(msec("Recipes")));
  t.check("extras typed by hand are listed", msec("Daily extras").rows.length === 1 && /^Chocolate/.test(msec("Daily extras").rows[0]), JSON.stringify(msec("Daily extras")));
  t.check("logged foods no longer in the library are listed", msec("Logged but").rows.length === 1 && /^Old crackers \| eaten 1×/.test(msec("Logged but").rows[0]), JSON.stringify(msec("Logged but")));
  t.check("library foods not eaten lately are tucked away", ms && ms.more === "Other library foods missing figures (1)", ms && ms.more);
  if (SHOTS) await dev.shot(`${SHOTS}/missing-${W}${dark ? "-dark" : ""}.png`);
  await dev.click('[data-miss-food="m2"]'); await sleep(500);
  t.check("tapping a food opens its editor", !(await dev.eval(`!!document.querySelector(".miss-sheet")`)) && (await dev.eval(`[...document.querySelectorAll(".sheet h2")].some(h => /Banana/.test(h.textContent) || /food/i.test(h.textContent))`)));
  await dev.eval(`document.querySelectorAll(".sheet-backdrop").forEach(b => b.remove())`); await sleep(200);
  await dev.tab("calculator"); await sleep(300);
  await dev.click("#cc-day-kcal"); await sleep(500);
  t.check("Today's calories links to the same check", await dev.eval(`!!document.getElementById("dc-missing")`));
  await dev.click("#dc-missing"); await sleep(500);
  t.check("...and it opens Missing figures", await dev.eval(`!!document.querySelector(".miss-sheet")`));
  t.check("no sideways scroll, no JS errors", (await dev.eval(`document.documentElement.scrollWidth <= innerWidth + 1`)) && (await dev.eval("window.__errs.length")) === 0, JSON.stringify(await dev.eval("window.__errs")));
  dev.close();
}

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
