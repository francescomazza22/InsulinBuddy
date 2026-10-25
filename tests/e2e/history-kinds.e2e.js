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
// A finger moving dx across (and dy down) over ms milliseconds, in 8 steps, like a real thumb. Returns the row's
// position just before lifting, so the drag itself can be checked.
const swipeTouch = (id, dx, ms = 250, dy = 0) => dev.eval(`(async () => {
  const r = document.querySelector('.history-entry[data-id="${id}"]'); const b = r.getBoundingClientRect();
  const mk = (type, x, y) => new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === "touchend" ? [] : [new Touch({ identifier: 1, target: r, clientX: x, clientY: y })], changedTouches: [new Touch({ identifier: 1, target: r, clientX: x, clientY: y })] });
  const x0 = b.left + 200, y0 = b.top + 20, wait = t => new Promise(res => setTimeout(res, t));
  r.dispatchEvent(mk("touchstart", x0, y0));
  for (let i = 1; i <= 8; i++) { await wait(${ms} / 8); r.dispatchEvent(mk("touchmove", x0 + ${dx} * i / 8, y0 + ${dy} * i / 8)); }
  const m = /translateX\\((-?[\\d.]+)px\\)/.exec(r.style.transform); const pos = m ? +m[1] : 0;
  r.dispatchEvent(mk("touchend", x0 + ${dx}, y0 + ${dy})); return pos; })()`);
const isOpen = id => dev.eval(`document.querySelector('.hs-row[data-id="${id}"]').classList.contains("is-open")`);
const closeAll = () => dev.eval(`document.querySelectorAll(".hs-row.is-open .history-entry").forEach(r => r.click())`);
await swipeTouch("h1", -150); await sleep(350);
t.check("a left swipe opens the row", await dev.eval(`document.querySelector('.hs-row[data-id="h1"]').classList.contains("is-open")`));
t.check("the row slid left by the width of the three buttons", await dev.eval(`/-216px/.test(document.querySelector('.history-entry[data-id="h1"]').style.transform)`));
const vis = await dev.eval(`(() => { const e = document.querySelector('.history-entry[data-id="h1"] .hs-actions__edit'); const r = e.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { w: Math.round(r.width), onScreen: r.right <= innerWidth + 1, hit: top === e }; })()`);
t.check("Edit is on screen and tappable", vis.onScreen && vis.hit && vis.w > 40, JSON.stringify(vis));
t.check("a short slow swipe does not open it", (await swipeTouch("h2", -30, 500), await sleep(300), !(await isOpen("h2"))));
t.check("opening another row closes the first", (await swipeTouch("h2", -150), await sleep(300), await dev.eval(`!document.querySelector('.hs-row[data-id="h1"]').classList.contains("is-open") && document.querySelector('.hs-row[data-id="h2"]').classList.contains("is-open")`)));
await dev.eval(`document.querySelector('.history-entry[data-id="h2"] .hs-actions__edit').click()`); await sleep(450);
t.check("tapping Edit opens that meal's edit sheet", await dev.eval(`!!document.getElementById("em-save")`));
await dev.eval(`document.getElementById("em-cancel").click()`); await sleep(300);
await dev.eval(`document.querySelector('.history-entry[data-id="h2"]').click()`); await sleep(200);
t.check("tapping an open row closes it instead of expanding it", await dev.eval(`!document.querySelector('.hs-row[data-id="h2"]').classList.contains("is-open") && document.querySelector('.history-entry[data-id="h2"] .history-entry__detail').hidden`));

t.section("HISTORY: the swipe follows the thumb precisely");
await closeAll(); await sleep(400);
const drag = await swipeTouch("h3", -100, 400); await sleep(400);
t.check("while dragging, the row moves smoothly from where the swipe was recognised (no jump)", drag === -87.5, String(drag));
t.check("a slow drag past 40% of the buttons opens", await isOpen("h3"));
await closeAll(); await sleep(400);
await swipeTouch("h3", -40, 60); await sleep(400);
t.check("a quick short flick opens the row", await isOpen("h3"));
await swipeTouch("h3", 40, 60); await sleep(400);
t.check("a quick flick right closes it again", !(await isOpen("h3")));
await swipeTouch("h3", -150, 300, 120); await sleep(400);   // 150 across, 120 down
t.check("a slightly diagonal thumb still counts as a swipe (it used to be read as a scroll)", await isOpen("h3"));
await closeAll(); await sleep(400);
const over = await swipeTouch("h3", -260, 300); await sleep(400);
t.check("dragging past the buttons slows down (rubber band) instead of stopping dead", over < -216 && over > -240, String(over));
await closeAll(); await sleep(400);
await swipeTouch("h3", -150, 200); await sleep(80);   // tap Edit 80 ms after lifting the finger
await dev.eval(`document.querySelector('.history-entry[data-id="h3"] .hs-actions__edit').click()`); await sleep(450);
t.check("Edit works straight after the swipe that revealed it", await dev.eval(`!!document.getElementById("em-save")`));
await dev.eval(`document.getElementById("em-cancel").click()`); await sleep(300);

t.section("HISTORY: Use again sits behind the swipe, in its own colour");
await closeAll(); await sleep(400);
await swipeTouch("h5", -250, 300); await sleep(400);
const tray = await dev.eval(`(() => { const a = document.querySelector('.history-entry[data-id="h5"] .hs-actions'); return [...a.querySelectorAll("button")].map(b => { const r = b.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { text: b.textContent, bg: getComputedStyle(b).backgroundColor, onScreen: r.left >= 0 && r.right <= innerWidth, hit: b.contains(top) }; }); })()`);
t.check("the tray is Use again, Edit, Delete", tray.map(b => b.text).join("|") === "Use again|Edit|Delete", JSON.stringify(tray.map(b => b.text)));
t.check("all three are on screen and tappable", tray.every(b => b.onScreen && b.hit), JSON.stringify(tray));
t.check("Use again has a colour of its own", new Set(tray.map(b => b.bg)).size === 3, JSON.stringify(tray.map(b => b.bg)));
await dev.eval(`document.querySelector('.history-entry[data-id="h5"] .hs-actions__use').click()`); await sleep(600);
t.check("tapping Use again puts that meal in the Calculator", await dev.eval(`(() => { const v = document.getElementById("view-calculator"); return !!v && !v.hidden && [...document.querySelectorAll(".meal-item__name")].some(n => n.textContent === "Banana"); })()`));
await dev.tab("history"); await sleep(400);
t.section("HISTORY: on a touch screen the opened meal has no button row; with a mouse it does");
await dev.cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 }); await sleep(300);
await dev.eval(`document.querySelector('.history-entry[data-id="h1"]').click()`); await sleep(300);
const touchState = await dev.eval(`(() => { const d = document.querySelector('.history-entry[data-id="h1"] .history-entry__detail'); return { touch: matchMedia("(hover: none) and (pointer: coarse)").matches, open: !d.hidden, display: getComputedStyle(d.querySelector(".history-entry__row-actions")).display }; })()`);
t.check("touch: the opened meal shows no Use Again / Edit / Delete row", touchState.touch && touchState.open && touchState.display === "none", JSON.stringify(touchState));
await dev.cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false }); await sleep(300);
t.check("mouse: the row is there, so a PC can still edit and delete", await dev.eval(`getComputedStyle(document.querySelector('.history-entry[data-id="h1"] .history-entry__row-actions')).display !== "none"`));
dev.close(); await app.close(); t.done && t.done(); process.exit(0);
