// 2.68.5 (found by the second stress round): logging a meal in the Calculator and then opening it in Edit Meal and saving it
// unchanged must keep the same dose. The Calculator worked the dose out from the exact carb total (22.49 g) while Edit Meal
// used the total rounded to 0.1 g (22.5 g); on a rounding boundary that is 2.0 u vs 2.5 u.
import { startApp, openDevice, makeChecker, seedLocal } from "./harness.js";
import { FOODS_JS, stateBlob, localState, logMeal } from "./helpers.js";

const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const app = await startApp(DIR, null, { "foods_data.js": FOODS_JS, "manifest.json": "{}" });
const settings = { rounding: "0.5", maxDose: 0, timeRatios: [{ id: "tr-all", name: "All day", start: "00:00", end: "23:59", ratio: 10, color: "#C93400" }, { id: "tr-x", name: "Late", start: "23:59", end: "00:00", ratio: 10, color: "#0064D2" }] };
const dev = await openDevice(app, { width: 420, height: 900, mobile: true, inject: `if (!localStorage.getItem("insulinBuddy.v2")) { ${seedLocal(stateBlob({ history: [], settings }))} }`, wait: 1500 });

t.section("A MEAL ON A ROUNDING BOUNDARY: log it, edit it, save unchanged");
// Pane comune is 65 g carbs per 100 g: 34.6 g is 22.49 g carbs -> 2.249 u at 1u:10g -> 2.0 u (to the nearest 0.5 u).
await logMeal(dev, 0, 34.6);
let st = await localState(dev);
const logged = st.history[0];
t.check("logged: 22.5 g carbs saved (22.49 rounded) and 2 u", logged && logged.totalCarbs === 22.5 && logged.mealDose === 2, JSON.stringify(logged && [logged.totalCarbs, logged.mealDose, logged.items.map(i => i.carbs)]));
await dev.tab("history"); await dev.click('[data-seg="log"]'); await sleep(300);
await dev.eval(`document.querySelector('[data-edit="${logged.id}"]').click()`); await sleep(600);
const preview = await dev.eval(`document.getElementById("em-preview").textContent`);
t.check("Edit Meal previews the same 2 units", /\b2\.0 units/.test(preview), preview);
await dev.click("#em-save"); await sleep(600);
st = await localState(dev);
const after = st.history.find(h => h.id === logged.id);
t.check("saving unchanged keeps 2 u (it used to become 2.5 u)", after.mealDose === 2 && after.correctionDose === 0, JSON.stringify([after.mealDose, after.correctionDose]));
t.check("and the carbs are unchanged", after.totalCarbs === 22.5);
t.check("no JS errors", (await dev.eval("window.__errs.length")) === 0 && dev.errors.length === 0, JSON.stringify(await dev.eval("window.__errs")));
dev.close(); await app.close();
process.exit(t.summary() ? 0 : 1);
