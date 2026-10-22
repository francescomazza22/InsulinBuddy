// Editing an Eating Out entry (insulin taken, carbs never counted): the time, meal type and dose can be changed, and the
// dose is kept as entered -- it is never recalculated from the 0 g of carbs on the entry. Corrections can be re-timed too.
import { startApp, openDevice, makeChecker, seedLocal } from "./harness.js";
import { FOODS_JS, stateBlob, meal, localState } from "./helpers.js";

const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const app = await startApp(DIR, null, { "foods_data.js": FOODS_JS, "manifest.json": "{}" });
const now = Date.now();
const hist = [
  meal("eo1", now - 2 * 3600000, { mealType: "lunch", items: [], totalCarbs: 0, totalKcal: 0, carbsUnknown: true, mealDose: 6, correctionDose: 0, ratioValue: 10, ratioLabel: "Lunch", glycemicLoad: null }),
  meal("c1", now - 5 * 3600000, { mealType: "correction", items: [], totalCarbs: 0, totalKcal: 0, mealDose: 0, correctionDose: 1.5, glucose: 220 })
];
const dev = await openDevice(app, { width: 390, height: 900, mobile: true, inject: `if (!localStorage.getItem("insulinBuddy.v2")) { ${seedLocal(stateBlob({ history: hist }))} }`, wait: 1500 });
await dev.tab("history"); await dev.click('[data-seg="log"]'); await sleep(300);

// The new time: yesterday at 12:30 local, written the way a datetime-local box holds it.
const target = new Date(now - 24 * 3600000); target.setHours(12, 30, 0, 0);
const pad = n => String(n).padStart(2, "0");
const local = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const setTime = v => dev.eval(`(() => { const i = document.getElementById("em-logged-time"); i.value = ${JSON.stringify(v)}; i.dispatchEvent(new Event("input", { bubbles: true })); i.dispatchEvent(new Event("change", { bubbles: true })); })()`);
const visible = sel => dev.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return !!e && e.getClientRects().length > 0; })()`);

t.section("EATING OUT: CHANGE THE DATE AND TIME");
await dev.eval(`document.querySelector('[data-edit="eo1"]').click()`); await sleep(500);
t.check("the sheet opens as Eating out", await dev.eval(`!!document.querySelector('#em-kind [data-kind="eatout"].is-active')`));
t.check("the time box is shown", await visible("#em-logged-time"));
const tb = await dev.eval(`(() => { const i = document.getElementById("em-logged-time"), f = document.getElementById("em-eatout-dose").closest(".field__row"); const a = i.getBoundingClientRect(), b = f.getBoundingClientRect(); const cs = getComputedStyle(i); return { left: Math.round(a.left - b.left), right: Math.round(a.right - b.right), appearance: cs.webkitAppearance || cs.appearance, minWidth: cs.minWidth, align: cs.textAlign }; })()`);
t.check("the time box lines up exactly with the boxes below it, with plain styling iPhone can't stretch", tb.left === 0 && tb.right === 0 && tb.appearance === "none" && tb.minWidth === "0px" && tb.align === "left", JSON.stringify(tb));
t.check("the insulin taken is shown as 6 units", (await dev.eval(`(document.getElementById("em-eatout-dose") || {}).value`)) === "6");
t.check("no ratio or food list to trip over", !(await visible("#em-ratio")) && !(await visible("#em-items")));
await setTime(local(target));
await dev.click("#em-save"); await sleep(500);
const alertOpen = await dev.eval(`!!document.querySelector(".dialog-backdrop")`);
t.check("saving is not blocked by a 'needs at least one item' message", !alertOpen, await dev.eval(`(document.querySelector(".dialog-backdrop") || {}).textContent || ""`));
let e = (await localState(dev)).history.find(h => h.id === "eo1");
t.check("the new date and time are saved", e.ts === target.getTime(), JSON.stringify({ saved: new Date(e.ts).toString(), wanted: target.toString() }));
t.check("the dose is unchanged at 6 units (not recalculated from 0 g)", e.mealDose === 6 && (e.correctionDose || 0) === 0, JSON.stringify([e.mealDose, e.correctionDose]));
t.check("it is still Eating out, carbs not logged, no food", e.carbsUnknown === true && e.items.length === 0 && e.totalCarbs === 0);
t.check("the meal type is still Lunch", e.mealType === "lunch");

t.section("EATING OUT: CHANGE THE DOSE AND MEAL TYPE");
await dev.eval(`document.querySelector('[data-edit="eo1"]').click()`); await sleep(500);
await dev.eval(`(() => { const i = document.getElementById("em-eatout-dose"); i.value = "7,5"; i.dispatchEvent(new Event("input", { bubbles: true })); })()`); await sleep(100);
const prev = await dev.eval(`document.getElementById("em-preview").textContent`);
t.check("the preview says what will be saved", /7\.5 units/.test(prev) && /carbs not logged/i.test(prev), prev);
await dev.eval(`document.querySelector('#em-meal-types [data-meal="dinner"]').click()`); await sleep(100);
await dev.click("#em-save"); await sleep(500);
e = (await localState(dev)).history.find(h => h.id === "eo1");
t.check("a typed 7,5 (decimal comma) saves as 7.5 units", e.mealDose === 7.5, String(e.mealDose));
t.check("the meal type changes to Dinner and the time is kept", e.mealType === "dinner" && e.ts === target.getTime());
t.check("Undo is offered", await dev.eval(`!!document.querySelector(".undo-toast:not([hidden])")`));

t.section("CORRECTIONS CAN BE RE-TIMED TOO");
await dev.eval(`document.querySelector('[data-edit="c1"]').click()`); await sleep(500);
t.check("a correction's time box is shown", await visible("#em-logged-time"));
const t2 = new Date(target.getTime() - 2 * 3600000);
await setTime(local(t2));
await dev.click("#em-save"); await sleep(500);
e = (await localState(dev)).history.find(h => h.id === "c1");
t.check("the correction's new time is saved and its dose is unchanged", e.ts === t2.getTime() && e.correctionDose === 1.5, JSON.stringify({ ts: new Date(e.ts).toString(), dose: e.correctionDose }));

t.check("no JS errors", (await dev.eval("window.__errs.length")) === 0 && dev.errors.length === 0, JSON.stringify(await dev.eval("window.__errs")));
dev.close(); await app.close();
process.exit(t.summary() ? 0 : 1);
