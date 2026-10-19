// History: the dose badge reads clearly, an entry can be turned into a correction or a treated low, and rows swipe open.
import { startApp, openDevice, makeChecker, seedLocal } from "./harness.js";
import { FOODS_JS, stateBlob, localState } from "./helpers.js";
const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker(); const sleep = ms => new Promise(r => setTimeout(r, ms));
const app = await startApp(DIR, null, { "foods_data.js": FOODS_JS, "manifest.json": "{}" });
const blob = stateBlob(); const now = Date.now();
const base = { items: [{ name: "Banana", grams: 100, carbs: 23, carbsPer100g: 23 }], totalCarbs: 23, totalKcal: 89, ratioLabel: "Lunch", ratioValue: 10, glucose: null };
blob.history = [
  { ...base, id: "h1", ts: now - 1 * 3600e3, mealType: "lunch", mealDose: 2, correctionDose: 1 },
  { ...base, id: "h2", ts: now - 3 * 3600e3, mealType: "breakfast", mealDose: 3, correctionDose: -1 },
  { id: "h3", ts: now - 5 * 3600e3, mealType: "snack", items: [{ name: "Glucose tabs", grams: 15, carbs: 15 }], totalCarbs: 15, totalKcal: 60, mealDose: 0, correctionDose: 0, noInsulin: true },
  { id: "h4", ts: now - 7 * 3600e3, mealType: "correction", items: [], totalCarbs: 0, totalKcal: 0, mealDose: 0, correctionDose: 2, glucose: 210 },
  { ...base, id: "h5", ts: now - 9 * 3600e3, mealType: "dinner", mealDose: 5, correctionDose: 0 },
  { ...base, id: "h6", ts: now - 11 * 3600e3, mealType: "snack", mealDose: 2, correctionDose: 0 }
];
const dev = await openDevice(app, { width: 390, height: 844, mobile: true, inject: `if (!localStorage.getItem("insulinBuddy.v2")) { ${seedLocal(blob)} }`, wait: 1800 });
await dev.tab("history"); await sleep(500);
const badge = id => dev.eval(`(() => { const b = document.querySelector('.history-entry[data-id="${id}"] .dose-badge'); return b ? [...b.children].map(c => c.textContent.trim()).join(" ") : null; })()`);
t.section("HISTORY: dose badge");
t.check("meal + correction shows the total with the split underneath", (await badge("h1")) === "3 u 2 meal + 1 corr.", await badge("h1"));
t.check("a reduction shows the net dose and the cut", (await badge("h2")) === "2 u 3 meal − 1 cut", await badge("h2"));
t.check("a treated low says so", (await badge("h3")) === "Low treated no insulin", await badge("h3"));
t.check("a correction-only entry is labelled as one", (await badge("h4")) === "2 u correction", await badge("h4"));
t.check("a plain meal is just the dose", (await badge("h5")) === "5 u", await badge("h5"));

const openEdit = async id => { await dev.eval(`document.querySelector('.history-entry[data-id="${id}"] [data-edit="${id}"]').click()`); await sleep(450); };
const save = async () => { await dev.eval(`document.getElementById("em-save").click()`); await sleep(500); };
const entryOf = async id => (await localState(dev)).history.find(e => e.id === id);
t.section("HISTORY: turn a meal into a treated low");
await openEdit("h5");
t.check("the sheet offers what the entry is, with Meal dose selected", await dev.eval(`document.querySelector('#em-kind .is-active').dataset.kind`) === "meal");
await dev.eval(`document.querySelector('#em-kind [data-kind="low"]').click()`); await sleep(200);
t.check("the preview says no insulin is recorded", /no insulin/.test(await dev.text("#em-preview")), await dev.text("#em-preview"));
await save();
let e5 = await entryOf("h5");
t.check("saved as a treated low: no insulin, doses zero, carbs and food kept", e5.noInsulin === true && e5.mealDose === 0 && e5.correctionDose === 0 && e5.totalCarbs === 23 && e5.items.length === 1, JSON.stringify(e5));
t.check("the row now reads Low treated", (await badge("h5")) === "Low treated no insulin", await badge("h5"));

t.section("HISTORY: and back to a meal dose");
await openEdit("h5");
t.check("it opens as Treating a low", await dev.eval(`document.querySelector('#em-kind .is-active').dataset.kind`) === "low");
await dev.eval(`document.querySelector('#em-kind [data-kind="meal"]').click()`); await sleep(200);
await save();
e5 = await entryOf("h5");
t.check("insulin is worked out again from the food and ratio", e5.noInsulin === undefined && e5.mealDose > 0, JSON.stringify(e5));

t.section("HISTORY: turn a meal into a correction");
await openEdit("h6");
await dev.eval(`document.querySelector('#em-kind [data-kind="correction"]').click()`); await sleep(250);
t.check("a correction dose box appears, pre-filled with the insulin that was given (2)", (await dev.eval(`document.getElementById("em-corr-dose").value`)) === "2" && await dev.eval(`!document.getElementById("em-corr-field").hidden`));
t.check("the food list is hidden", await dev.eval(`document.getElementById("em-meal-part").hidden`));
await dev.eval(`(() => { const i = document.getElementById("em-corr-dose"); i.value = "1.5"; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
await dev.eval(`document.getElementById("em-save").click()`); await sleep(500);
t.check("it asks before removing the food", await dev.eval(`!!document.querySelector(".dialog-backdrop, .dialog")`));
await dev.eval(`(document.querySelector(".dialog__btn--primary") || {click(){}}).click()`); await sleep(500);
const e6 = await entryOf("h6");
t.check("saved as a correction: type, no food, no carbs, 1.5 u", e6.mealType === "correction" && e6.items.length === 0 && e6.totalCarbs === 0 && e6.mealDose === 0 && e6.correctionDose === 1.5, JSON.stringify(e6));
t.check("the row reads as a correction", (await badge("h6")) === "1.5 u correction", await badge("h6"));

t.section("HISTORY: swipe a row to reveal Edit and Delete");
const swipeTouch = (id, dx) => dev.eval(`(async () => {
  const r = document.querySelector('.history-entry[data-id="${id}"]'); const b = r.getBoundingClientRect();
  const mk = (type, x) => new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === "touchend" ? [] : [new Touch({ identifier: 1, target: r, clientX: x, clientY: b.top + 20 })], changedTouches: [new Touch({ identifier: 1, target: r, clientX: x, clientY: b.top + 20 })] });
  const x0 = b.left + 200; r.dispatchEvent(mk("touchstart", x0));
  for (let i = 1; i <= 6; i++) r.dispatchEvent(mk("touchmove", x0 + ${dx} * i / 6));
  r.dispatchEvent(mk("touchend", x0 + ${dx})); return true; })()`);
await swipeTouch("h1", -150); await sleep(350);
t.check("a left swipe opens the row", await dev.eval(`document.querySelector('.hs-row[data-id="h1"]').classList.contains("is-open")`));
t.check("the row slid left by the width of the buttons", await dev.eval(`/-144px/.test(document.querySelector('.history-entry[data-id="h1"]').style.transform)`));
const vis = await dev.eval(`(() => { const e = document.querySelector('.history-entry[data-id="h1"] .hs-actions__edit'); const r = e.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { w: Math.round(r.width), onScreen: r.right <= innerWidth + 1, hit: top === e }; })()`);
t.check("Edit is on screen and tappable", vis.onScreen && vis.hit && vis.w > 40, JSON.stringify(vis));
t.check("a short swipe does not open it", (await swipeTouch("h2", -30), await sleep(300), await dev.eval(`!document.querySelector('.hs-row[data-id="h2"]').classList.contains("is-open")`)));
t.check("opening another row closes the first", (await swipeTouch("h2", -150), await sleep(300), await dev.eval(`!document.querySelector('.hs-row[data-id="h1"]').classList.contains("is-open") && document.querySelector('.hs-row[data-id="h2"]').classList.contains("is-open")`)));
await dev.eval(`document.querySelector('.history-entry[data-id="h2"] .hs-actions__edit').click()`); await sleep(450);
t.check("tapping Edit opens that meal's edit sheet", await dev.eval(`!!document.getElementById("em-save")`));
await dev.eval(`document.getElementById("em-cancel").click()`); await sleep(300);
await dev.eval(`document.querySelector('.history-entry[data-id="h2"]').click()`); await sleep(200);
t.check("tapping an open row closes it instead of expanding it", await dev.eval(`!document.querySelector('.hs-row[data-id="h2"]').classList.contains("is-open") && document.querySelector('.history-entry[data-id="h2"] .history-entry__detail').hidden`));
dev.close(); await app.close(); t.done && t.done(); process.exit(0);
