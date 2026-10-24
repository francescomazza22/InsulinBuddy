// Portions of a recipe: on the Calculator a recipe can be added as a fraction of the dish (tap 1/8 or type 1/3) or as
// slices, as well as in grams. The portion becomes grams of the dish, so carbs, the dose and the log work as before.
import { startApp, openDevice, makeChecker, seedLocal } from "./harness.js";
import { FOODS_JS, stateBlob, localState } from "./helpers.js";

const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const app = await startApp(DIR, null, { "foods_data.js": FOODS_JS, "manifest.json": "{}" });
const blob = stateBlob({ settings: { timeRatios: [{ id: "all", name: "All day", start: "00:00", end: "00:00", ratio: 10, color: "#1F9E93" }] } });
blob.library.push({ id: "f-zuc", name: "Zucchero", category: "other", carbs: 100, kcal: 400 });
// 160 g of sugar -> 160 g carbs in the whole 800 g dish: 20 g carbs per 100 g, 20 g carbs per eighth.
blob.recipes = [{ id: "bb", name: "Banana Bread", category: "snacks", notes: "", favorite: false, usageCount: 5, rawWeight: null, finalWeight: 800,
  items: [{ foodId: "f-zuc", name: "Zucchero", grams: 160, carbsPer100g: 100, kcalPer100g: 400 }] }];
const dev = await openDevice(app, { width: 390, height: 844, mobile: true, inject: `if (!localStorage.getItem("insulinBuddy.v2")) { ${seedLocal(blob)} }`, wait: 1600 });

const pick = async name => {
  await dev.tab("calculator"); await sleep(200);
  await dev.eval(`(() => { const s = document.getElementById("cc-search"); s.value = ${JSON.stringify(name)}; s.dispatchEvent(new Event("input", { bubbles: true })); })()`); await sleep(250);
  await dev.eval(`[...document.querySelectorAll("#cc-food-list > *")].find(e => e.textContent.includes(${JSON.stringify(name)})).click()`); await sleep(250);
};
const type = async v => { await dev.eval(`(() => { const g = document.getElementById("cc-grams"); g.value = ${JSON.stringify(v)}; g.dispatchEvent(new Event("input", { bubbles: true })); })()`); await sleep(120); };
const note = () => dev.eval(`document.getElementById("cc-portion-note").textContent`);
// The grams sit in a small edit box inside the row's text, so read the box's value in its place.
const rows = () => dev.eval(`[...document.querySelectorAll(".meal-item")].map(m => { const meta = m.querySelector(".meal-item__meta").cloneNode(true), inp = meta.querySelector("input"); if (inp) inp.replaceWith(m.querySelector(".meal-item__grams-input").value); return meta.textContent.replace(/\\s+/g, " ").trim() + " | " + m.querySelector(".meal-item__carbs").textContent; })`);
const clearMeal = () => dev.eval(`(() => { while (document.querySelector(".meal-item__remove")) document.querySelector(".meal-item__remove").click(); })()`);

t.section("PORTIONS: the recipe offers one-tap fractions");
await pick("Banana Bread");
t.check("picking a recipe shows 1/2, 1/3, 1/4, 1/6 and 1/8 under the Grams box", (await dev.eval(`[...document.querySelectorAll(".portion__chip")].map(b => b.textContent).join(" ")`)) === "1/2 1/3 1/4 1/6 1/8");
t.check("and says what a portion is measured against (the 800 g dish)", /800 g/.test(await note()), await note());
await dev.eval(`[...document.querySelectorAll(".portion__chip")].find(b => b.textContent === "1/8").click()`); await sleep(120);
t.check("tapping 1/8 fills it in and shows what it works out to before adding", (await dev.eval(`document.getElementById("cc-grams").value`)) === "1/8" && /1\/8 of the dish \(800 g\) = 100 g · 20 g carbs/.test(await note()), await note());
await dev.click("#cc-add-btn"); await sleep(300);
t.check("added: the row shows 1/8 and 100 g, with 20 g carbs", /^1\/8 · 100\s*g/.test((await rows())[0]) && /20g$/.test((await rows())[0]), JSON.stringify(await rows()));
t.check("the dose follows from those carbs exactly as with grams (20 g at 1:10 = 2 units)", (await dev.text("#cc-dose-number")) === "2.0", await dev.text("#cc-dose-number"));

t.section("PORTIONS: typing a fraction, and a different batch weight");
await clearMeal(); await sleep(150);
await pick("Banana Bread");
await type("1/3");
t.check("typing 1/3 works too (266.7 g, 53.3 g carbs)", /1\/3 of the dish \(800 g\) = 266.7 g · 53.3 g carbs/.test(await note()), await note());
await dev.eval(`(() => { const b = document.getElementById("cc-batch-weight"); b.value = "1000"; b.dispatchEvent(new Event("input", { bubbles: true })); })()`); await sleep(150);
t.check("if this batch weighed 1000 g, 1/3 is 333.3 g, but still a third of the carbs (53.3 g)", /1\/3 of the dish \(1000 g\) = 333.3 g · 53.3 g carbs/.test(await note()), await note());
await dev.click("#cc-add-btn"); await sleep(300);
t.check("added with a third of the dish's carbs", /53.3g$/.test((await rows())[0]), JSON.stringify(await rows()));

t.section("PORTIONS: things that can't be a portion");
await clearMeal(); await sleep(150);
await pick("Banana Bread");
await type("9/8");
t.check("9/8 is refused: more than the whole dish", /more than the whole dish/.test(await note()), await note());
await dev.click("#cc-add-btn"); await sleep(200);
t.check("and nothing is added", (await rows()).length === 0);
await type("2 slices");
t.check("slices need the recipe's slice count first, and it says so", /no number of slices yet/.test(await note()), await note());
await pick("Pane comune");
await type("1/8");
await dev.click("#cc-add-btn"); await sleep(200);
t.check("a plain food refuses a fraction with a reason", /work for recipes/.test(await note()) && (await rows()).length === 0, await note());
await type("87,5");
await dev.click("#cc-add-btn"); await sleep(250);
t.check("grams still work for foods, with a decimal comma (87,5 g of bread, not 875)", /87.5/.test((await rows())[0] || ""), JSON.stringify(await rows()));
await clearMeal(); await sleep(150);

t.section("PORTIONS: slices");
await dev.tab("library"); await dev.eval(`document.querySelector("[data-seg=recipes]").click()`); await sleep(300);
await dev.eval(`document.querySelector('[data-act="edit"][data-id="bb"]').click()`); await sleep(500);
await dev.eval(`(() => { const i = document.getElementById("rs-slices"); i.value = "8"; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
await dev.click("#rs-save"); await sleep(400);
t.check("the recipe saves its number of slices", (await localState(dev)).recipes.find(r => r.id === "bb").slices === 8);
await pick("Banana Bread");
t.check("with slices set, '1 slice' and '2 slices' join the quick buttons", /1 slice 2 slices$/.test(await dev.eval(`[...document.querySelectorAll(".portion__chip")].map(b => b.textContent).join(" ")`)));
await type("1,5 slices");
t.check("1,5 slices of an 8-slice, 800 g dish is 150 g (30 g carbs)", /1.5 slices of the dish \(800 g\) = 150 g · 30 g carbs/.test(await note()), await note());
await dev.eval(`[...document.querySelectorAll(".portion__chip")].find(b => b.textContent === "2 slices").click()`); await sleep(100);
await dev.click("#cc-add-btn"); await sleep(300);
t.check("2 slices adds 200 g with the label '2 slices'", /^2 slices · 200\s*g/.test((await rows())[0]), JSON.stringify(await rows()));

t.section("PORTIONS: what is logged");
await dev.click("#cc-log-btn"); await sleep(500);
const e = (await localState(dev)).history[0];
t.check("the log stores ordinary grams and carbs (200 g, 40 g carbs), so trends, Nightscout and Health are unaffected", e.items[0].grams === 200 && e.items[0].carbs === 40 && e.totalCarbs === 40, JSON.stringify(e.items[0]));
t.check("and remembers it was 2 slices", e.items[0].portion === "2 slices");
t.check("the logged dose is 4 units (40 g at 1:10)", e.mealDose === 4, String(e.mealDose));
await pick("Banana Bread");
t.check("next time, 'Last time you had this' shows 2 slices", /2 slices · 200 g/.test(await dev.eval(`(document.getElementById("cc-pick-extra") || {}).textContent || ""`)));
t.check("no JS errors", (await dev.eval("window.__errs.length")) === 0, JSON.stringify(await dev.eval("window.__errs")));
dev.close(); await app.close();
process.exit(t.summary() ? 0 : 1);
