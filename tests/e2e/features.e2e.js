// Features built on your own history: last-time lines, recipe batch weight, low-treatment usual, after-meal reminder.
import { createBackend, startApp, openDevice, fakeSupabaseSource, makeChecker, seedLocal } from "./harness.js";
import { FOODS_JS, stateBlob, meal, logMeal, localState } from "./helpers.js";

const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const app = await startApp(DIR, null, { "foods_data.js": FOODS_JS, "manifest.json": "{}" });
const now = Date.now(), DAY = 86400000;
const blob = stateBlob({ settings: { checkAfterHours: 3 }, history: [
  meal("h1", now - 3 * DAY, { items: [{ refType: "food", refId: "s2", name: "Banana", grams: 120, carbsPer100g: 23, kcalPer100g: 89, carbs: 27.6, kcal: 107 }], totalCarbs: 28, mealDose: 3 }),
  meal("h2", now - 6 * DAY, { items: [{ refType: "food", refId: "s2", name: "Banana", grams: 100, carbsPer100g: 23, kcalPer100g: 89, carbs: 23, kcal: 89 }], totalCarbs: 23, mealDose: 2.5 }),
  ...[15, 20, 15, 30].map((g, i) => meal("low" + i, now - (i + 1) * 5 * 3600000 - 9 * DAY, { noInsulin: true, mealDose: 0, totalCarbs: g, items: [{ refType: "quick", name: "Fast carbs", grams: g, carbsPer100g: 100, carbs: g }] }))
] });
blob.recipes = [{ id: "r1", name: "Pizza dough", category: "grains", notes: "", favorite: false, usageCount: 1, rawWeight: 500, finalWeight: 500, items: [{ foodId: "s1", name: "Pane comune", grams: 400, carbsPer100g: 65, kcalPer100g: 300 }] }];
const dev = await openDevice(app, { width: 420, height: 900, mobile: true, inject: `if (!localStorage.getItem("insulinBuddy.v2")) { ${seedLocal(blob)} }`, wait: 1800 });

t.section("LAST TIME: shown when you pick a food");
await dev.eval(`(() => { const i = document.getElementById("cc-search"); i.value = "Banana"; i.dispatchEvent(new Event("input", { bubbles: true })); })()`); await sleep(300);
await dev.eval(`document.querySelector("#cc-food-list .food-pick-item").click()`); await sleep(300);
const extra = await dev.eval(`document.getElementById("cc-pick-extra").hidden ? "" : document.getElementById("cc-pick-extra").textContent.replace(/\\s+/g, " ")`);
t.check("the last two Banana meals are listed with grams and dose", /Last time you had this/.test(extra) && /120 g/.test(extra) && /100 g/.test(extra) && /3 u/.test(extra) && /2\.5 u/.test(extra), extra);

await dev.shot("/tmp/shots/pick-extra.png");
t.section("RECIPE BATCH WEIGHT");
await dev.eval(`(() => { const i = document.getElementById("cc-search"); i.value = "Pizza"; i.dispatchEvent(new Event("input", { bubbles: true })); })()`); await sleep(300);
await dev.eval(`document.querySelector("#cc-food-list .food-pick-item").click()`); await sleep(300);
t.check("a batch-weight field is offered for a recipe", await dev.eval(`!!document.getElementById("cc-batch-weight")`));
await dev.eval(`(() => { const i = document.getElementById("cc-batch-weight"); i.value = "400"; i.dispatchEvent(new Event("input", { bubbles: true })); })()`); await sleep(200);
const note = await dev.eval(`document.querySelector(".pick-extra__note").textContent`);
t.check("260 g in the batch over a 400 g cook = 65 g per 100 g (recipe default 52)", /260 g carbs/.test(note) && /65 g per 100 g/.test(note) && /52/.test(note), note);
await dev.eval(`(() => { const g = document.getElementById("cc-grams"); g.value = "100"; g.dispatchEvent(new Event("input", { bubbles: true })); document.getElementById("cc-add-btn").click(); })()`); await sleep(400);
const carbsPill = await dev.text("#cc-carbs-pill");
t.check("100 g of it counts 65 g carbs, not 52", /65/.test(carbsPill), carbsPill);

t.section("LOW TREATMENT: your usual amount");
t.check("the usual-amount note is not visible until Treating a Low is on", await dev.eval(`getComputedStyle(document.getElementById("quick-carb-usual")).display === "none"`));
await dev.eval(`document.getElementById("cc-clear-all-btn").click()`); await sleep(300);
await dev.eval(`document.getElementById("cc-no-insulin-toggle").click()`); await sleep(300);
const usual = await dev.eval(`document.getElementById("quick-carb-usual").hidden ? "" : document.getElementById("quick-carb-usual").textContent`);
t.check("shows the middle of the last 4 treatments (17.5 g, range 15-30)", /17\.5 g/.test(usual) && /4 low treatments/.test(usual) && /15–30/.test(usual), usual);
await dev.eval(`document.getElementById("cc-no-insulin-toggle").click()`); await sleep(200);

t.section("AFTER-MEAL CHECK: reminder card");
await dev.eval(`document.getElementById("cc-clear-all-btn").click()`); await sleep(300);
await logMeal(dev, 0, 100); await sleep(500);
const rem = await dev.eval(`document.getElementById("cc-reminder").hidden ? "" : document.getElementById("cc-reminder").textContent.replace(/\\s+/g, " ")`);
t.check("a card says to check glucose in about 3 h", /Check your glucose at/.test(rem) && /3 h after/.test(rem), rem);
await dev.eval("window.scrollTo(0,0)"); await sleep(200); await dev.shot("/tmp/shots/reminder.png");
t.check("it offers Add to calendar and Dismiss", /Add to calendar/.test(rem) && /Dismiss/.test(rem), rem);
await dev.eval(`(() => { window.__dl = []; const real = URL.createObjectURL.bind(URL); URL.createObjectURL = b => { b.text().then(x => window.__dl.push(x)); return real(b); }; document.getElementById("reminder-ics").click(); })()`); await sleep(400);
const ics = await dev.eval(`window.__dl[0] || ""`);
t.check("the calendar file has an event with an alarm at the due time", /BEGIN:VEVENT/.test(ics) && /BEGIN:VALARM/.test(ics) && /SUMMARY:Check glucose/.test(ics), ics.slice(0, 120));
await dev.eval(`(() => { const r = JSON.parse(localStorage.getItem("insulinBuddy.checkReminder")); r.due = Date.now() - 60000; localStorage.setItem("insulinBuddy.checkReminder", JSON.stringify(r)); })()`);
await dev.eval(`document.dispatchEvent(new Event("visibilitychange"))`); await sleep(400);
t.check("when due it says so, with a Done button", /Time to check your glucose/.test(await dev.text("#cc-reminder")) && /Done/.test(await dev.text("#cc-reminder")));
await dev.eval(`document.getElementById("reminder-done").click()`); await sleep(200);
t.check("Done clears it", await dev.eval(`document.getElementById("cc-reminder").hidden`));
await dev.eval(`document.getElementById("cc-clear-all-btn").click()`);
t.check("no JS errors", (await dev.eval("window.__errs.length")) === 0 && dev.errors.length === 0, JSON.stringify(await dev.eval("window.__errs")) + dev.errors.join("|"));
dev.close(); await app.close();
process.exit(t.summary() ? 0 : 1);
