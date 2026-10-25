// An opened meal lists each food with its amount and carbs. A long name must stay readable in a narrow card
// (2.61.0 squeezed it to one letter per line), and a quantity below 1 is never plural ("0.1 Intera", not "Interas").
import { startApp, openDevice, makeChecker, seedLocal } from "./harness.js";
import { FOODS_JS, stateBlob, meal } from "./helpers.js";
const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker(); const sleep = ms => new Promise(r => setTimeout(r, ms));
const app = await startApp(DIR, null, { "foods_data.js": FOODS_JS, "manifest.json": "{}" });
const items = [
  { refType: "food", refId: "x1", name: "Puff Pastry Torta salata intera", quantity: 0.1, unitLabel: "Intera", grams: 30, carbsPer100g: 15, kcalPer100g: 400, carbs: 4.5, kcal: 120 },
  { refType: "food", refId: "x2", name: "Uva", grams: 150, carbsPer100g: 18, kcalPer100g: 69, carbs: 27, kcal: 104 },
  { refType: "food", refId: "x3", name: "Pasta di semola", grams: 100, carbsPer100g: 70, kcalPer100g: 350, carbs: 70, kcal: 350 },
  { refType: "food", refId: "x4", name: "Biscotti", quantity: 2, unitLabel: "biscotto", grams: 20, carbsPer100g: 70, kcalPer100g: 450, carbs: 14, kcal: 90 }
];
const blob = stateBlob({ history: [meal("m1", Date.now() - 3600000, { items, totalCarbs: 115.5, totalKcal: 664, mealDose: 11.5 })] });
for (const W of [390, 820]) {
  t.section(`OPENED MEAL at ${W}px`);
  const dev = await openDevice(app, { width: W, height: 900, mobile: W < 700, inject: `if (!localStorage.getItem("insulinBuddy.v2")) { ${seedLocal(blob)} }`, wait: 1800 });
  await dev.tab("history");
  await dev.eval(`document.querySelector(".history-entry__main, .history-entry").click()`); await sleep(400);
  const r = await dev.eval(`[...document.querySelectorAll(".history-entry__item")].map(el => { const n = el.querySelector(".history-entry__item-name"); const lh = parseFloat(getComputedStyle(n).lineHeight) || 20; return { name: n.textContent, w: n.getBoundingClientRect().width, lines: Math.round(n.getBoundingClientRect().height / lh), qty: el.querySelector(".history-entry__item-qty").textContent, sameLine: Math.abs(el.querySelector(".history-entry__item-qty").getBoundingClientRect().top - el.querySelector(".history-entry__item-carbs").getBoundingClientRect().top) < 4, carbs: el.querySelector(".history-entry__item-carbs").textContent }; })`);
  t.check("every food name is at least 60 px wide (never one letter per line)", r.length === 4 && r.every(x => x.w >= 60), JSON.stringify(r.map(x => [x.name, Math.round(x.w)])));
  t.check("no name takes more than 2 lines", r.every(x => x.lines <= 2), JSON.stringify(r.map(x => [x.name, x.lines])));
  t.check("0.1 of a unit is singular: 0.1 Intera", r[0].qty === "0.1 Intera", r[0].qty);
  t.check("2 of a unit is plural: 2 biscottos", r[3].qty === "2 biscottos", r[3].qty);
  t.check("each amount and its carbs stay on the same line", r.every(x => x.sameLine), JSON.stringify(r.map(x => [x.name, x.sameLine])));
  const head = await dev.eval(`(() => { const e = document.querySelector(".history-entry__title .muted"), b = document.querySelector(".history-entry__row-actions button"); const lh = parseFloat(getComputedStyle(e).lineHeight) || 18; return { timeLines: Math.round(e.getBoundingClientRect().height / lh), btnH: Math.round(b.getBoundingClientRect().height) }; })()`);
  t.check("time and ratio stay on one line, Use Again on one line", head.timeLines === 1 && head.btnH < 40, JSON.stringify(head));
  t.check("carbs keep their unit", r.every(x => /g carbs$/.test(x.carbs)), JSON.stringify(r.map(x => x.carbs)));
  await dev.shot(`/tmp/shots/meal-detail-${W}.png`);
  t.check("no JS errors", dev.errors.length === 0, JSON.stringify(dev.errors));
  dev.close();
}
await app.close(); t.summary(); process.exit(0);
