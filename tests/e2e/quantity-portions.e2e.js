// Foods logged by quantity get the same one-tap portion chips as recipes: "1" and parts of one unit (1/2 … 1/8). The
// quantity becomes grams (quantity × weight per unit), so carbs, the dose and the log work exactly as before, and the log
// keeps the fraction ("1/2 slice", not "0.5 slice").
import { startApp, openDevice, makeChecker, seedLocal } from "./harness.js";
import { FOODS_JS, stateBlob, localState } from "./helpers.js";

const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const app = await startApp(DIR, null, { "foods_data.js": FOODS_JS, "manifest.json": "{}" });
const blob = stateBlob({ settings: { timeRatios: [{ id: "all", name: "All day", start: "00:00", end: "00:00", ratio: 10, color: "#1F9E93" }] } });
// One slice weighs 120 g at 25 g carbs per 100 g: 30 g carbs a slice.
blob.library.push({ id: "f-piz", name: "Pizza Margherita", category: "other", carbs: 25, kcal: 250, unitBased: true, unitLabel: "slice", gramsPerUnit: 120 });
const dev = await openDevice(app, { width: 390, height: 844, mobile: true, inject: `if (!localStorage.getItem("insulinBuddy.v2")) { ${seedLocal(blob)} }`, wait: 1600 });

const pick = async name => {
  await dev.tab("calculator"); await sleep(200);
  await dev.eval(`(() => { const s = document.getElementById("cc-search"); s.value = ${JSON.stringify(name)}; s.dispatchEvent(new Event("input", { bubbles: true })); })()`); await sleep(250);
  await dev.eval(`[...document.querySelectorAll("#cc-food-list > *")].find(e => e.textContent.includes(${JSON.stringify(name)})).click()`); await sleep(250);
};
const type = async v => { await dev.eval(`(() => { const g = document.getElementById("cc-grams"); g.value = ${JSON.stringify(v)}; g.dispatchEvent(new Event("input", { bubbles: true })); })()`); await sleep(120); };
const note = () => dev.eval(`document.getElementById("cc-portion-note").textContent`);
const chip = async c => { await dev.eval(`[...document.querySelectorAll(".portion__chip")].find(b => b.textContent === ${JSON.stringify(c)}).click()`); await sleep(120); };
const clearMeal = () => dev.eval(`(() => { while (document.querySelector(".meal-item__remove")) document.querySelector(".meal-item__remove").click(); })()`);
const draftItems = () => dev.eval(`(() => { try { return JSON.parse(localStorage.getItem("insulinBuddy.draft") || "null"); } catch { return null; } })()`);

t.section("QUANTITY: the food offers one-tap parts of a unit");
await pick("Pizza Margherita");
t.check("picking a quantity food shows 1, 1/2, 1/3, 1/4, 1/6 and 1/8 under the box", (await dev.eval(`[...document.querySelectorAll(".portion__chip")].map(b => b.textContent).join(" ")`)) === "1 1/2 1/3 1/4 1/6 1/8");
const listRow = await dev.eval(`[...document.querySelectorAll("#cc-food-list > *")].find(e => e.textContent.includes("Pizza")).textContent.replace(/\\s+/g, " ")`);
t.check("the food row shows carbs per slice (30 g), not the per-100 g figure next to /slice", /30g carbs.*\/slice/.test(listRow) && !/25g carbs/.test(listRow), listRow);
t.check("the box asks for a quantity", (await dev.eval(`document.getElementById("cc-grams").placeholder`)) === "Qty or 1/2");
t.check("and says what one unit weighs", /1 slice = 120 g/.test(await note()), await note());
await chip("1/2");
t.check("tapping 1/2 fills it in and shows what it works out to before adding", (await dev.eval(`document.getElementById("cc-grams").value`)) === "1/2" && /1\/2 slice = 60 g · 15 g carbs/.test(await note()), await note());
t.check("the tapped chip is lit", (await dev.eval(`document.querySelector(".portion__chip.is-active").textContent`)) === "1/2");
await dev.click("#cc-add-btn"); await sleep(300);
const row = await dev.eval(`document.querySelector(".meal-item__carbs").textContent`);
t.check("added with 15 g carbs", /15g carbs/.test(row), row);
t.check("the row names the portion", (await dev.eval(`(document.querySelector(".meal-item__portion") || {}).textContent`)) === "1/2");
t.check("the dose follows from those carbs exactly as before (15 g at 1:10 = 1.5 units)", (await dev.text("#cc-dose-number")) === "1.5", await dev.text("#cc-dose-number"));
t.check("the chips are gone once it's added", await dev.eval(`document.getElementById("cc-portion").hidden`));

t.section("QUANTITY: typed amounts");
await clearMeal(); await sleep(150);
await pick("Pizza Margherita");
await type("1 1/2");
t.check("1 1/2 reads as one and a half slices", /1 1\/2 slices = 180 g · 45 g carbs/.test(await note()), await note());
await type("½");
t.check("½ reads as half a slice", /1\/2 slice = 60 g/.test(await note()), await note());
await type("2");
t.check("a plain 2 still works", /2 slices = 240 g · 60 g carbs/.test(await note()), await note());
t.check("and no chip is lit", !(await dev.eval(`document.querySelector(".portion__chip.is-active")`)));
await type("1/0");
t.check("nonsense is refused with a reason", /divide by 0/.test(await note()), await note());
await dev.click("#cc-add-btn"); await sleep(200);
t.check("and nothing is added", (await dev.eval(`document.querySelectorAll(".meal-item").length`)) === 0);
await chip("1");
t.check("tapping 1 is one whole slice", /1 slice = 120 g · 30 g carbs/.test(await note()), await note());

t.section("QUANTITY: the log keeps the fraction");
await chip("1/3");
await dev.click("#cc-add-btn"); await sleep(250);
await dev.click("#cc-log-btn"); await sleep(400);
const st = await localState(dev);
const it = st.history[0] && st.history[0].items[0];
t.check("logged as a third of a slice: quantity 1/3, 40 g, 10 g carbs, portion 1/3", it && Math.abs(it.quantity - 1 / 3) < 1e-9 && Math.abs(it.grams - 40) < 1e-9 && it.carbs === 10 && it.portion === "1/3", JSON.stringify(it));
await dev.tab("history"); await sleep(400);
await dev.eval(`document.querySelector(".history-entry").click()`); await sleep(250);
const detail = await dev.eval(`document.querySelector(".history-entry__item-qty").textContent`);
t.check("the opened meal says 1/3 slice, not 0.3 slice", detail === "1/3 slice", detail);
await pick("Pizza Margherita");
const last = await dev.eval(`(document.querySelector(".pick-extra__last") || {}).textContent || ""`);
t.check("Last time you had this says 1/3 slice", /1\/3 slice/.test(last), last);

const errs = [...dev.errors, ...(await dev.eval(`window.__errs || []`))];
t.check("no page errors", !errs.length, errs.join(" | "));
dev.close(); await app.close(); t.done && t.done(); process.exit(0);
