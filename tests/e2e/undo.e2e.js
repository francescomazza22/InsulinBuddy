// Undo for logging, editing and replacing; the undo bar's timing.
import { startApp, openDevice, makeChecker, seedLocal } from "./harness.js";
import { FOODS_JS, localState, stateBlob, meal, logMeal } from "./helpers.js";

const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const app = await startApp(DIR, null, { "foods_data.js": FOODS_JS });
const dev = await openDevice(app, { height: 1000, inject: seedLocal(stateBlob({ history: [meal("old", Date.now() - 6 * 3600_000)], schemaVersion: 2 })) });
const toast = () => dev.eval(`(() => { const x = document.getElementById("undo-toast"); return { hidden: x.hidden, msg: document.getElementById("undo-toast-message").textContent, role: x.getAttribute("role") }; })()`);
const count = async () => (await localState(dev)).history.length;

t.section("LOG: an Undo bar appears and takes the entry back, restoring the calculator");
await logMeal(dev, 0, 100);
let b = await toast();
t.check("the bar says it was logged", !b.hidden && /Logged/.test(b.msg), JSON.stringify(b));
t.check("it is announced politely to screen readers", b.role === "status");
t.check("the meal is in the history", (await count()) === 2);
t.check("the calculator was cleared", (await dev.eval(`document.querySelectorAll("#cc-meal-items .meal-item, #cc-meal-items li").length`)) === 0 || !/Pane/.test(await dev.text("#cc-meal-items")));
await dev.click("#undo-toast-btn"); await sleep(300);
t.check("undo removed it again", (await count()) === 1);
t.check("and put the food back in the calculator", /Pane comune/.test(await dev.text("#cc-meal-items")), await dev.text("#cc-meal-items"));
t.check("the bar is gone", (await toast()).hidden);

t.section("REPLACE: no 'Continue?' question; Undo brings back what was there");
await dev.click("#cc-log-btn"); await sleep(250);          // log the Pane meal for real
await logMeal(dev, 1, 50);                                  // now a banana meal logged too
await dev.eval(`document.getElementById("undo-toast-btn").click()`); await sleep(200);   // undo it: banana is back in the calculator
t.check("banana is in the calculator", /Banana/.test(await dev.text("#cc-meal-items")));
await dev.tab("history"); await sleep(200);
let dialogs = 0; await dev.eval(`window.confirm = () => { window.__confirmed = true; return true; }`);
await dev.eval(`document.querySelector("[data-use]").click()`); await sleep(300);
t.check("it did not ask for confirmation", !(await dev.eval(`!!window.__confirmed`)));
t.check("the calculator now holds the past meal", !/Banana/.test(await dev.text("#cc-meal-items")), await dev.text("#cc-meal-items"));
b = await toast();
t.check("the bar offers Undo", !b.hidden && /Calculator replaced/.test(b.msg), JSON.stringify(b));
await dev.click("#undo-toast-btn"); await sleep(300);
t.check("Undo brings the banana back", /Banana/.test(await dev.text("#cc-meal-items")), await dev.text("#cc-meal-items"));

t.section("EDIT: saving an edit can be undone");
await dev.tab("history"); await sleep(200);
const before = (await localState(dev)).history[0];
await dev.eval(`document.querySelector(".history-entry [data-edit], [data-edit]").click()`); await sleep(300);
await dev.eval(`(() => { const g = document.querySelector('#em-save'); g.click(); })()`); await sleep(300);
b = await toast();
t.check("a 'Meal updated' bar appears", !b.hidden && /Meal updated/.test(b.msg), JSON.stringify(b));
await dev.click("#undo-toast-btn"); await sleep(300);
const after = (await localState(dev)).history.find(h => h.id === before.id);
t.check("undo restores the entry exactly", after && after.totalCarbs === before.totalCarbs && after.mealDose === before.mealDose && after.ts === before.ts, JSON.stringify([before.totalCarbs, after && after.totalCarbs]));

t.section("TIMING: stays 8 s, holds while touched");
await logMeal(dev, 0, 100);
await sleep(5600);
t.check("still there after 5.6 s (it used to vanish at 5)", !(await toast()).hidden);
await dev.eval(`document.getElementById("undo-toast").dispatchEvent(new PointerEvent("pointerenter"))`);
await sleep(4000);
t.check("held while the pointer is on it", !(await toast()).hidden);
await dev.eval(`document.getElementById("undo-toast").dispatchEvent(new PointerEvent("pointerleave"))`);
await sleep(3500);
t.check("goes away once let go and the time is up", (await toast()).hidden);
t.check("no JS errors", (await dev.eval("window.__errs.length")) === 0 && dev.errors.length === 0, JSON.stringify(await dev.eval("window.__errs")));
dev.close(); await app.close();
process.exit(t.summary() ? 0 : 1);
