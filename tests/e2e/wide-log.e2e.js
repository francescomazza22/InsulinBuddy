// Meals log on a large screen (2.93.1). Francesco's iPad (about 1600 points wide) showed the log as a grid of four cards per row:
// ragged rows from cards of different heights, a hole beside an opened meal, names cut short, and an order that zigzagged.
// Now it is one list: every row the same width, doses and carbs in the same two columns all the way down, an opened meal
// growing in place. Usage: [WL_WIDTH=1600] [SHOTS=<dir>] node tests/e2e/wide-log.e2e.js
import { startApp, openDevice, makeChecker, seedLocal } from "./harness.js";
import { FOODS_JS, stateBlob, meal } from "./helpers.js";
import { makeBasalEntry } from "../../js/history.js";
import { makeActivityEntry } from "../../js/activity.js";

const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const app = await startApp(DIR, null, { "foods_data.js": FOODS_JS, "manifest.json": "{}" });
const MIN = 60000, H = 60 * MIN, DAY = 24 * H;
const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
const at = (d, h, m = 0) => midnight.getTime() - d * DAY + h * H + m * MIN;
const food = (name, grams, carbs, kcal, gi) => ({ refType: "food", refId: "f-" + name, name, grams, carbsPer100g: carbs / grams * 100, kcalPer100g: kcal / grams * 100, gi, carbs, kcal });
const history = [];
for (const d of [1, 2]) {
  history.push(meal("din" + d, at(d, 18, 52), { mealType: "dinner", periodName: "evening", ratioLabel: "Evening", ratioValue: 15, mealDose: 10, extraDose: 2, totalCarbs: 117.6, totalKcal: 1097, items: [food("Riso", 130, 98.8, 475, 70), { ...food("Vino Bianco e Rosso", 500, 18.8, 623, null), quantity: 5, unitLabel: "Bicchiere" }] }));
  history.push(meal("cor" + d, at(d, 16, 58), { mealType: "correction", items: [], totalCarbs: 0, totalKcal: 0, mealDose: 0, correctionDose: 3, extraDose: 3, ratioLabel: "", ratioValue: null }));
  history.push(meal("out" + d, at(d, 12, 47), { items: [], carbsUnknown: true, totalCarbs: 0, totalKcal: 0, mealDose: 6 }));
  history.push(meal("low" + d, at(d, 12, 17), { mealType: "snack", noInsulin: true, mealDose: 0, totalCarbs: 22.8, totalKcal: 105, items: [food("Pane comune", 35, 22.8, 105, 75)] }));
  history.push(meal("bre" + d, at(d, 8, 2), { mealType: "breakfast", periodName: "morning", ratioLabel: "Morning", ratioValue: 12, mealDose: 3, totalCarbs: 34.4, totalKcal: 228, items: [food("Banana Bread with walnuts and dark chocolate chips", 60, 34.4, 228, 35)] }));
  history.push(makeBasalEntry({ units: 10, ts: at(d, 8, 2), slot: "am", now: at(d, 8, 2) }));
  history.push(makeActivityEntry({ type: "cycling", minutes: 31, intensity: "moderate", ts: at(d, 17, 29), now: at(d, 17, 29), note: "From Apple Health · 13.2 km" }));
  history.push(meal("lun" + d, at(d, 12, 28), { ratioValue: 6, mealDose: 17.5, totalCarbs: 104.7, totalKcal: 820, items: [food("Tesco Quiche Lorraine", 200, 40, 500, 53), food("Mela", 150, 16.8, 62, 36), food("Pane comune", 75, 47.9, 258, 75)] }));
}
history.forEach(h => { h.ns = { status: "synced" }; if (h.items && h.items.length && h.items[0].gi) h.glycemicLoad = { value: h.items[0].gi, partial: h.items.length > 1 }; });   // the NS badge and GI chip his rows carry
history.sort((a, b) => b.ts - a.ts);

const W = +(process.env.WL_WIDTH || 1600), Hgt = W >= 1500 ? 1200 : 820;
const dev = await openDevice(app, { width: W, height: Hgt, mobile: true, dark: true, inject: seedLocal(stateBlob({ history, settings: { darkMode: true, darkModeAuto: false, nightscoutUrl: "https://demo.ns.example.com/?token=tok-abcdef-123456" } })), wait: 1500 });
await dev.tab("history"); await sleep(500);
const rows = () => dev.eval(`[...document.querySelectorAll("#history-groups .history-group")[0].querySelectorAll(".history-entry")].map(e => {
  const b = e.getBoundingClientRect(), q = s => { const x = e.querySelector(s); if (!x) return null; const r = x.getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), w: Math.round(r.width) }; };
  const pill = e.querySelector(".dose-pill"), carbs = e.querySelector(".stat-line");
  const cutOf = x => !!x && x.offsetParent !== null && (x.scrollWidth > x.clientWidth + 1 || x.scrollHeight > x.clientHeight + 1);
  const names = [e.querySelector(".history-entry__food-names"), e.querySelector(".history-entry__foods")];
  return { id: e.dataset.id, l: Math.round(b.left), r: Math.round(b.right), t: Math.round(b.top), h: Math.round(b.height),
    pillR: pill ? Math.round(pill.getBoundingClientRect().right) : null, carbsR: carbs ? Math.round(carbs.getBoundingClientRect().right) : null,
    cut: names.some(cutOf), titleLines: Math.round(e.querySelector(".history-entry__title").getBoundingClientRect().height / 20), ns: !!e.querySelector(".ns-badge"), title: q(".history-entry__title"), foods: q(".history-entry__foods") };
})`);

t.section(`MEALS LOG at ${W}px`);
let r = await rows();
t.check("one list: every row starts at the same left edge and has the same width", new Set(r.map(x => x.l)).size === 1 && new Set(r.map(x => x.r)).size === 1, JSON.stringify(r.map(x => [x.l, x.r])));
t.check("rows run straight down, newest first", r.every((x, i) => i === 0 || x.t > r[i - 1].t));
const pillCol = r.filter(x => x.pillR != null).map(x => x.pillR);
t.check("every dose sits in the same column", new Set(pillCol).size === 1, JSON.stringify(pillCol));
const carbCol = r.filter(x => x.carbsR != null).map(x => x.carbsR);
t.check("every carbs figure sits in the same column", new Set(carbCol).size === 1, JSON.stringify(carbCol));
if (W >= 1200) t.check("the foods have their own column beside the name", r.every(x => !x.foods || x.foods.l >= x.title.r), JSON.stringify(r.map(x => [x.title && x.title.r, x.foods && x.foods.l])));
else t.check("on a smaller iPad the foods sit under the name, lined up", r.every(x => !x.foods || (x.foods.t > x.title.t && x.foods.l === x.title.l)), JSON.stringify(r.map(x => [x.title && x.title.l, x.foods && x.foods.l])));
t.check("rows are compact (none taller than 110px when closed)", r.every(x => x.h <= 110), JSON.stringify(r.map(x => x.h)));
t.check("the NS badge is showing on the rows (as on his)", r.filter(x => x.ns).length >= 6, String(r.filter(x => x.ns).length));
t.check("name, time, ratio and NS badge fit in two lines", r.every(x => x.titleLines <= 2), JSON.stringify(r.map(x => [x.id, x.titleLines])));
t.check("food names are not cut short (they take a second line when they need it)", r.every(x => !x.cut), JSON.stringify(r.filter(x => x.cut).map(x => x.id)));
if (process.env.SHOTS) await dev.shot(`${process.env.SHOTS}/wide-log-${W}.png`);

const before = r.filter(x => x.id !== "din1");
await dev.eval(`document.querySelector('.history-entry[data-id="din1"]').click()`); await sleep(400);
r = await rows();
const din = r.find(x => x.id === "din1");
t.check("an opened meal grows in place, the same width as the rest", din.l === before[0].l && din.r === before[0].r && din.h > 110, JSON.stringify(din));
const after = r.filter(x => x.id !== "din1");
t.check("rows beside it don't move sideways (no holes)", after.every((x, i) => x.l === before[i].l && x.r === before[i].r));
const items = await dev.eval(`[...document.querySelectorAll('.history-entry[data-id="din1"] .history-entry__item')].map(e => Math.round(e.getBoundingClientRect().width))`);
t.check("its food lines stay a readable width", items.length === 2 && items.every(w => w <= 760), JSON.stringify(items));
t.check("its dose stays in the dose column", din.pillR === pillCol[0], `${din.pillR} vs ${pillCol[0]}`);
if (process.env.SHOTS) await dev.shot(`${process.env.SHOTS}/wide-log-open-${W}.png`);
t.check("no sideways scroll", (await dev.eval(`document.documentElement.scrollWidth <= innerWidth + 1`)));
t.check("no JS errors", (await dev.eval("window.__errs.length")) === 0 && dev.errors.length === 0, JSON.stringify(await dev.eval("window.__errs")) + dev.errors.join("|"));
dev.close();
await app.close();
process.exit(t.summary() ? 0 : 1);
