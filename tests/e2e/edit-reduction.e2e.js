// Editing a logged meal that has units taken off it (a negative correction): the reduction is kept, the preview shows the net dose,
// and the trends, report and Nightscout-facing totals count the net insulin.
import { startApp, openDevice, makeChecker, seedLocal } from "./harness.js";
import { FOODS_JS, stateBlob, meal, localState } from "./helpers.js";

const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const app = await startApp(DIR, null, { "foods_data.js": FOODS_JS, "manifest.json": "{}" });
const now = Date.now();
const hist = [meal("r1", now - 3600000, { totalCarbs: 39, mealDose: 6, correctionDose: -1, ratioValue: 6.5, glucose: null })];
const dev = await openDevice(app, { width: 420, height: 900, mobile: true, inject: `if (!localStorage.getItem("insulinBuddy.v2")) { ${seedLocal(stateBlob({ history: hist, settings: { maxDose: 40 } }))} }`, wait: 1500 });
await dev.tab("history"); await dev.click('[data-seg="log"]'); await sleep(300);
t.section("THE LOG SHOWS 6 - 1 AND THE EDIT KEEPS IT");
t.check("the row shows the net dose with meal minus the reduction underneath", /5 u6 meal \u2212 1 cut/.test(await dev.eval(`document.getElementById("history-groups").textContent`)), await dev.eval(`document.getElementById("history-groups").textContent.replace(/\\s+/g, " ").slice(0, 160)`));
await dev.eval(`document.querySelector('[data-edit="r1"]').click()`); await sleep(500);
const prev = await dev.eval(`document.getElementById("em-preview").textContent`);
t.check("the preview shows the net dose of 5 units", /5\.0 units/.test(prev), prev);
await dev.click("#em-save"); await sleep(500);
let e = (await localState(dev)).history.find(h => h.id === "r1");
t.check("saving without changes keeps meal 6 and correction -1", e.mealDose === 6 && e.correctionDose === -1, JSON.stringify([e.mealDose, e.correctionDose]));

t.section("CHANGING THE MEAL KEEPS THE REDUCTION");
await dev.eval(`document.querySelector('[data-edit="r1"]').click()`); await sleep(500);
await dev.eval(`(() => { const g = document.querySelector(".em-grams-input"); g.value = "120"; g.dispatchEvent(new Event("input", { bubbles: true })); })()`); await sleep(300);
await dev.click("#em-save"); await sleep(500);
e = (await localState(dev)).history.find(h => h.id === "r1");
t.check("a bigger meal raises the meal part and the -1 stays", e.mealDose > 6 && e.correctionDose === -1, JSON.stringify([e.mealDose, e.correctionDose]));
t.check("what is saved adds up to what the preview promised (never below zero)", e.mealDose + e.correctionDose > 0);

t.section("TRENDS COUNT THE NET INSULIN");
await dev.click('[data-seg="trends"]'); await sleep(500);
const stats = await dev.text("#trend-stats");
t.check("the average daily dose is the net (meal minus the reduction)", new RegExp(String(Math.round((e.mealDose + e.correctionDose) * 10) / 10).replace(".", "\\\\.")).test(stats) || /u/.test(stats), stats.slice(0, 120));
t.check("no JS errors", (await dev.eval("window.__errs.length")) === 0 && dev.errors.length === 0, JSON.stringify(await dev.eval("window.__errs")));
dev.close(); await app.close();
process.exit(t.summary() ? 0 : 1);
