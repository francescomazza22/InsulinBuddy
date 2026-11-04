// An opened meal in the log (2.82.1): the dose, carbs and kcal move to the top right beside the title, and every food line
// gains its kcal in a column of its own, using the width the totals no longer take. The closed row is unchanged.
// LO_WIDTH (default 390), LO_DARK=1, SHOTS=<dir>.
import { startApp, openDevice, makeChecker, seedLocal } from "./harness.js";
import { FOODS_JS, stateBlob, meal } from "./helpers.js";

const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SHOTS = process.env.SHOTS || "";
const W = Number(process.env.LO_WIDTH || 390), dark = process.env.LO_DARK === "1";
const app = await startApp(DIR, null, { "foods_data.js": FOODS_JS, "manifest.json": "{}" });

const item = (name, grams, cPer, kPer) => ({ refType: "food", refId: null, name, grams, carbsPer100g: cPer, kcalPer100g: kPer, gi: null, carbs: Math.round(cPer * grams) / 100, kcal: kPer == null ? null : Math.round(kPer * grams) / 100 });
// His dinner of 3 Nov: five foods, one with no kcal on record.
const items = [item("Tortilla Chips", 30, 19, 497), item("Pane comune", 85, 65, 300), item("Uva", 166, 18, 67), item("Vino Bianco", 250, 2.5, 82), item("Sea bass", 250, 0, null)];
const dinner = meal("d1", Date.now() - 3600000, { mealType: "dinner", periodName: "evening", ratioValue: 15, ratioLabel: "Evening", totalCarbs: 97, totalKcal: 928, mealDose: 6.5, items });
const blob = stateBlob({ history: [dinner], settings: { darkMode: dark, darkModeAuto: false } });
const dev = await openDevice(app, { width: W, height: 1000, mobile: W < 1000, dark, inject: `if (!localStorage.getItem("insulinBuddy.v2")) { ${seedLocal(blob)} }`, wait: 1500 });
await dev.tab("history"); await sleep(400);

const geo = () => dev.eval(`(() => { const row = document.querySelector('.history-entry--meal[data-id="d1"]'); const r = s => { const e = row.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, shown: b.width > 0 && b.height > 0 }; };
  const kcals = [...row.querySelectorAll(".history-entry__item-kcal")].map(k => { const b = k.getBoundingClientRect(); return { text: k.textContent.trim(), shown: b.width > 0, r: b.right }; });
  return { expanded: row.classList.contains("is-expanded"), title: r(".history-entry__title"), stats: r(".history-entry__stats"), detail: r(".history-entry__detail"), firstItem: r(".history-entry__item"), kcals, row: (b => ({ l: b.left, r: b.right, t: b.top }))(row.getBoundingClientRect()) }; })()`);

t.section(`LOG: OPENED MEAL (${W}px${dark ? ", dark" : ""})`);
let g = await geo();
t.check("closed: no per-food kcal shown, totals beside the summary as before", !g.expanded && g.kcals.every(k => !k.shown) && g.stats.shown, JSON.stringify(g.kcals));
const closedStatsTop = g.stats.t;
if (SHOTS) await dev.shot(`${SHOTS}/log-closed-${W}${dark ? "-dark" : ""}.png`);
await dev.click('.history-entry--meal[data-id="d1"] .history-entry__title'); await sleep(300);
g = await geo();
t.check("opened: the row is marked open", g.expanded);
t.check("dose, carbs and kcal sit at the top right, level with the title", g.stats.t <= g.title.t + 4 && g.stats.r >= g.row.r - 30, JSON.stringify({ stats: g.stats, title: g.title }));
t.check("…and above the food lines", g.stats.b <= g.firstItem.t + 2, JSON.stringify({ stats: g.stats, item: g.firstItem }));
t.check("the food lines run on under the totals, to the right edge", g.detail.r >= g.stats.r - 2, JSON.stringify({ detail: g.detail, stats: g.stats }));
t.check("each food shows its kcal", JSON.stringify(g.kcals.map(k => k.text)) === JSON.stringify(["149 kcal", "255 kcal", "111 kcal", "205 kcal", ""]), JSON.stringify(g.kcals.map(k => k.text)));
t.check("the kcal column lines up", new Set(g.kcals.filter(k => k.shown && k.text).map(k => Math.round(k.r))).size === 1, JSON.stringify(g.kcals.map(k => k.r)));
t.check("the totals moved up compared with the closed row", g.stats.t <= closedStatsTop + 1, `${closedStatsTop} → ${g.stats.t}`);
if (SHOTS) { await dev.eval(`document.querySelector('.history-entry--meal[data-id="d1"]').scrollIntoView({ block: "center" })`); await sleep(200); await dev.shot(`${SHOTS}/log-open-${W}${dark ? "-dark" : ""}.png`); }
await dev.click('.history-entry--meal[data-id="d1"] .history-entry__title'); await sleep(300);
g = await geo();
t.check("closing it puts the row back", !g.expanded && g.kcals.every(k => !k.shown));
t.check("no sideways scroll", await dev.eval(`document.documentElement.scrollWidth <= innerWidth + 1`));
t.check("no JS errors", (await dev.eval("window.__errs.length")) === 0, JSON.stringify(await dev.eval("window.__errs")));
dev.close();
await app.close();
process.exit(t.summary() ? 0 : 1);
