// Calculator revamp (2.81.0): mode chip, active insulin inside the dose card, the day bars' mark past the average,
// search full width until a food is picked, "Last time" amount chip, and a Log button that says what it logs.
// CR_WIDTH (default 390), CR_DARK=1, SHOTS=<dir>.
import { startApp, openDevice, makeChecker, seedLocal } from "./harness.js";
import { FOODS_JS, stateBlob, meal } from "./helpers.js";

const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SHOTS = process.env.SHOTS || "";
const W = Number(process.env.CR_WIDTH || 390), dark = process.env.CR_DARK === "1";
const app = await startApp(DIR, null, { "foods_data.js": FOODS_JS, "manifest.json": "{}" });

const d = new Date(); const at = (daysAgo, h) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - daysAgo, h, 0).getTime();
const banana = g => ({ refType: "food", refId: "s2", name: "Banana", grams: g, carbsPer100g: 23, kcalPer100g: 89, gi: 51, carbs: Math.round(23 * g) / 100, kcal: Math.round(89 * g) / 100 });
// Earlier days average 100 g. Today: 120 g, the last 20 minutes ago with insulin still active.
const hist = [
  meal("t1", Date.now() - 20 * 60000, { totalCarbs: 120, mealDose: 3 }),
  meal("y1", at(1, 13), { totalCarbs: 100, items: [banana(120)] }),
  meal("p1", at(2, 13), { totalCarbs: 100 })
].sort((a, b) => b.ts - a.ts);

const blob = stateBlob({ history: hist, settings: { darkMode: dark, darkModeAuto: false } });
const dev = await openDevice(app, { width: W, height: 1000, mobile: W < 1000, dark, inject: `if (!localStorage.getItem("insulinBuddy.v2")) { ${seedLocal(blob)} }`, wait: 1500 });
await dev.tab("calculator"); await sleep(300);
await dev.waitFor(`document.getElementById("cc-food-list").children.length > 1`, 6000);

const vis = sel => `(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; })()`;
const txt = sel => dev.eval(`(document.querySelector(${JSON.stringify(sel)}) || {}).textContent.replace(/\\s+/g, " ").trim()`);

t.section(`EMPTY CALCULATOR (${W}px${dark ? ", dark" : ""})`);
t.check("mode row closed, chip says Meal and isn't lit", !(await dev.eval(vis("#cc-mode-controls"))) && (await txt("#cc-mode-label")) === "Meal" && !(await dev.eval(`document.getElementById("cc-mode-btn").classList.contains("is-on")`)) && (await dev.eval(`document.getElementById("cc-mode-btn").getAttribute("aria-expanded")`)) === "false");
t.check("no carbs pill with nothing in the meal", !(await dev.eval(vis("#cc-carbs-pill"))));
t.check("the empty card says what to do, and the 0.0 is dimmed", (await dev.eval(vis("#cc-dose-hint"))) && (await dev.eval(`document.querySelector(".dose-card").classList.contains("is-empty")`)));
t.check("Log button: 'Add food to log a meal', off", (await txt("#cc-log-btn")) === "Add food to log a meal" && (await dev.eval(`document.getElementById("cc-log-btn").disabled`)));
t.check("active insulin shows inside the dose card", await dev.eval(`(() => { const p = document.getElementById("active-panel"); return !p.hidden && !!p.closest(".dose-card"); })()`));
const row = await dev.eval(`(() => { const r = document.querySelector(".add-row").getBoundingClientRect(), s = document.getElementById("cc-search").getBoundingClientRect(); return { share: s.width / r.width }; })()`);
t.check("search runs (nearly) full width with Browse beside it; no Grams or + yet",
  row.share > 0.8 && (await dev.eval(vis("#cc-browse-btn"))) && !(await dev.eval(vis("#cc-grams"))) && !(await dev.eval(vis("#cc-add-btn"))), JSON.stringify(row));
const bar = await dev.eval(`(() => { const tk = document.getElementById("cc-day-carbs-tick"), b = document.querySelector("#cc-day-carbs .day-carbs__bar").getBoundingClientRect(), r = tk.getBoundingClientRect();
  return { shown: !tk.hidden, at: (r.left + r.width / 2 - b.left) / b.width, bg: document.getElementById("cc-day-carbs-fill").style.background }; })()`);
t.check("120 g against a 100 g average: a mark at the average, orange past it", bar.shown && Math.abs(bar.at - 100 / 120) < 0.03 && /255, 159, 10|FF9F0A/i.test(bar.bg), JSON.stringify(bar));
if (SHOTS) { await dev.eval(`scrollTo(0, 0)`); await sleep(300); await dev.shot(`${SHOTS}/calc-revamp-empty-${W}${dark ? "-dark" : ""}.png`); }

t.section("PICKING AND ADDING A FOOD");
await dev.eval(`[...document.getElementById("cc-food-list").children].find(c => /Banana/.test(c.textContent)).click()`); await sleep(250);
t.check("picked: Grams and + appear, Browse and the list make way", (await dev.eval(vis("#cc-grams"))) && (await dev.eval(vis("#cc-add-btn"))) && !(await dev.eval(vis("#cc-browse-btn"))) && !(await dev.eval(vis("#cc-food-list"))));
t.check("the amount box has the focus", await dev.eval(`document.activeElement && document.activeElement.id === "cc-grams"`));
t.check("'Last time: 120 g' chip offered", (await txt("#cc-portion-chips")) === "Last time: 120 g" && (await dev.eval(vis("#cc-portion-chips"))));
if (SHOTS) { await sleep(200); await dev.shot(`${SHOTS}/calc-revamp-picked-${W}${dark ? "-dark" : ""}.png`); }
await dev.eval(`document.querySelector("#cc-portion-chips [data-portion]").click()`); await sleep(150);
t.check("tapping it fills the amount", (await dev.eval(`document.getElementById("cc-grams").value`)) === "120");
await dev.eval(`(() => { const g = document.getElementById("cc-grams"); g.value = "200"; g.dispatchEvent(new Event("input", { bubbles: true })); })()`);
await dev.click("#cc-add-btn"); await sleep(400);
t.check("after Add the list is back and Grams/+ hide", (await dev.eval(vis("#cc-food-list"))) && !(await dev.eval(vis("#cc-grams"))) && (await dev.eval(vis("#cc-browse-btn"))));
const dose = await txt("#cc-dose-number");
t.check("carbs pill shows the meal's carbs", (await txt("#cc-carbs-pill")) === "46g Carbs" && (await dev.eval(vis("#cc-carbs-pill"))));
t.check("Log button repeats the big number and the carbs", (await txt("#cc-log-btn")) === `Log ${dose} u · 46g carbs` && !(await dev.eval(`document.getElementById("cc-log-btn").disabled`)), `${await txt("#cc-log-btn")} / ${dose}`);
t.check("the card is no longer 'empty'", !(await dev.eval(vis("#cc-dose-hint"))) && !(await dev.eval(`document.querySelector(".dose-card").classList.contains("is-empty")`)));
if (SHOTS) { await dev.eval(`scrollTo(0, 0)`); await sleep(300); await dev.shot(`${SHOTS}/calc-revamp-meal-${W}${dark ? "-dark" : ""}.png`); }

t.section("MODE CHIP");
await dev.click("#cc-mode-btn"); await sleep(200);
t.check("tapping the chip opens Correction / Treating a low / Eating out", (await dev.eval(vis("#cc-mode-controls"))) && (await dev.eval(`document.getElementById("cc-mode-btn").getAttribute("aria-expanded")`)) === "true");
await dev.click("#cc-correction-toggle"); await sleep(200);
t.check("Correction on: chip says 'Meal + correction' and is lit", (await txt("#cc-mode-label")) === "Meal + correction" && (await dev.eval(`document.getElementById("cc-mode-btn").classList.contains("is-on")`)));
await dev.click("#cc-mode-btn"); await sleep(200);
t.check("closing the row keeps the glucose box and the chip's words", !(await dev.eval(vis("#cc-mode-controls"))) && (await dev.eval(vis("#cc-glucose"))) && (await txt("#cc-mode-label")) === "Meal + correction");
await dev.click("#cc-clear-all-btn"); await sleep(300);
t.check("Clear All: row closed, chip back to Meal, card empty again", !(await dev.eval(vis("#cc-mode-controls"))) && (await txt("#cc-mode-label")) === "Meal" && (await txt("#cc-log-btn")) === "Add food to log a meal");
await dev.click("#cc-mode-btn"); await sleep(150);
await dev.click("#cc-no-insulin-toggle"); await sleep(200);
t.check("Treating a low with no carbs yet: the Log button says to add them", (await txt("#cc-log-btn")) === "Add the carbs you had" && (await txt("#cc-mode-label")) === "Treating a low");
await dev.eval(`document.querySelector('#quick-carb-row [data-grams="15"]').click()`); await sleep(200);
t.check("…then 'Log treated low · 15g carbs'", (await txt("#cc-log-btn")) === "Log treated low · 15g carbs");
await dev.click("#cc-clear-all-btn"); await sleep(300);

t.check("no sideways scroll", await dev.eval(`document.documentElement.scrollWidth <= innerWidth + 1`));
t.check("no JS errors", (await dev.eval("window.__errs.length")) === 0, JSON.stringify(await dev.eval("window.__errs")));
dev.close();
await app.close();
process.exit(t.summary() ? 0 : 1);
