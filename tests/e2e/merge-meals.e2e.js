// 2.105.0: merge meals from Insights > Meals with real taps: Select on a day, pick two meals, Merge, confirm; Undo puts them back.
// Env: MERGE_WIDTH (default 390), MERGE_DARK=1, SHOTS=<dir>.
import { startApp, openDevice, makeChecker, seedLocal } from "./harness.js";
import { FOODS_JS, stateBlob } from "./helpers.js";
const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const W = Number(process.env.MERGE_WIDTH || 390), DARK = process.env.MERGE_DARK === "1", SHOTS = process.env.SHOTS;
const app = await startApp(DIR, null, { "foods_data.js": FOODS_JS, "manifest.json": "{}" });
const MIN = 60000, day = new Date(); day.setHours(0, 0, 0, 0);
const base = day.getTime() + 60 * MIN;   // 01:00 today, so every entry is today and in the past
const it = (name, grams, carbs, kcal) => ({ refType: "food", refId: "f-" + name, name, grams, quantity: null, unitLabel: null, gramsPerUnit: null, gi: null, carbsPer100g: 0, kcalPer100g: 0, carbs, kcal });
const meal = (id, mins, items, mealDose, mealType = "lunch") => ({ id, ts: base + mins * MIN, mealType, periodName: "", items, totalCarbs: items.reduce((s, i) => s + i.carbs, 0), totalKcal: items.reduce((s, i) => s + i.kcal, 0), glycemicLoad: null, carbsUnknown: false, mealDose, correctionDose: 0, noInsulin: false, glucose: 120, ratioLabel: "", ratioValue: 10 });
const hist = [
  meal("h-c", 90, [it("Apple", 150, 18, 80)], 2, "snack"),
  { id: "b-1", ts: base + 60 * MIN, entryType: "basal", mealType: "basal", periodName: "evening", basalDose: 18, basalSlot: "pm", items: [], totalCarbs: 0, totalKcal: 0, mealDose: 0, correctionDose: 0, noInsulin: false, glucose: null },
  meal("h-b", 40, [it("Pasta", 50, 15, 75)], 1.5, "snack"),
  meal("h-a", 0, [it("Pasta", 100, 30, 150), it("Bread", 40, 20, 100)], 5)
];
const dev = await openDevice(app, { width: W, height: 844, mobile: W < 1000, dark: DARK, inject: seedLocal(stateBlob({ history: hist, settings: { darkMode: DARK, darkModeAuto: false } })), wait: 1500 });
const tap = async sel => {
  const r = await dev.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: "center" }); const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
  if (!r) throw new Error("nothing to tap: " + sel);
  await dev.cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: r.x, y: r.y }] });
  await dev.cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sleep(250);
};
const hist$ = () => dev.eval(`JSON.parse(localStorage.getItem("insulinBuddy.v2")).history.map(h => ({ id: h.id, ts: h.ts, carbs: h.totalCarbs, dose: h.mealDose, items: (h.items || []).map(i => i.name + ":" + i.grams), from: (h.mergedFrom || []).map(s => s.id) }))`);
await dev.tab("history"); await dev.click('[data-seg="log"]'); await sleep(300);
t.check("a day with two or more meals shows Select", await dev.eval(`!!document.querySelector("[data-merge-start]")`));
await tap("[data-merge-start]");
t.check("picking: the bar shows, Merge is off", await dev.eval(`!document.getElementById("merge-bar").hidden && document.getElementById("merge-go").disabled`));
await tap('.history-entry[data-id="h-a"]');
await tap('.history-entry[data-id="h-b"]');
await tap('.history-entry[data-id="b-1"]');   // a basal row can't be picked
const picked = await dev.eval(`[...document.querySelectorAll(".history-entry.is-selected")].map(r => r.dataset.id)`);
t.check("tapping meals picks them (the basal dose isn't picked, nothing opens)", JSON.stringify(picked.sort()) === '["h-a","h-b"]' && !(await dev.eval(`!!document.querySelector(".history-entry.is-expanded")`)), JSON.stringify(picked));
t.check("the bar counts them and Merge is on", (await dev.text("#merge-count")) === "2 meals picked" && !(await dev.eval(`document.getElementById("merge-go").disabled`)));
if (SHOTS) await dev.shot(`${SHOTS}/merge-pick-${W}-${DARK ? "dark" : "light"}.png`);
await tap("#merge-go"); await sleep(200);
const msg = await dev.eval(`(document.querySelector(".dialog") || {}).textContent || ""`);
t.check("it asks first, saying what the merged meal will be", /Merge 2 meals\?/.test(msg) && /65 g carbs and 6\.5 u/.test(msg) && /nothing is recalculated/.test(msg), msg.replace(/\s+/g, " ").slice(0, 300));
if (SHOTS) await dev.shot(`${SHOTS}/merge-confirm-${W}-${DARK ? "dark" : "light"}.png`);
await tap(".dialog__btn--primary"); await sleep(300);
let h = await hist$();
const m = h.find(x => x.from.length);
t.check("one merged meal replaces the two", h.length === 3 && !!m && !h.some(x => x.id === "h-a" || x.id === "h-b"), JSON.stringify(h));
t.check("at the first meal's time, carbs and insulin added up, the same food in one row", !!m && m.ts === base && m.carbs === 65 && m.dose === 6.5 && JSON.stringify(m.items) === '["Pasta:150","Bread:40"]' && JSON.stringify(m.from) === '["h-a","h-b"]', JSON.stringify(m));
t.check("picking has ended", await dev.eval(`document.getElementById("merge-bar").hidden && !document.querySelector(".history-entry.is-selectable")`));
t.check("the list shows the merged meal", (await dev.eval(`document.querySelectorAll("#history-groups .history-entry--meal").length`)) === 2);
if (SHOTS) await dev.shot(`${SHOTS}/merge-done-${W}-${DARK ? "dark" : "light"}.png`);
await dev.click("#undo-toast-btn"); await sleep(300);
h = await hist$();
t.check("Undo puts the two meals back as they were", h.length === 4 && h.some(x => x.id === "h-a" && x.carbs === 50) && h.some(x => x.id === "h-b" && x.dose === 1.5) && !h.some(x => x.from.length), JSON.stringify(h));
// Cancel ends picking without changing anything; leaving the tab ends it too
await tap("[data-merge-start]"); await tap('.history-entry[data-id="h-c"]'); await tap("#merge-cancel");
t.check("Cancel ends picking and changes nothing", (await dev.eval(`document.getElementById("merge-bar").hidden && !document.querySelector(".is-selecting")`)) && (await hist$()).length === 4);
await tap("[data-merge-start]"); await dev.tab("calculator"); await sleep(200);
t.check("leaving Insights ends picking", await dev.eval(`document.getElementById("merge-bar").hidden`));
t.check("no JS errors", dev.errors.length === 0 && (await dev.eval("window.__errs.length")) === 0, dev.errors.join("|"));
dev.close(); await app.close();
process.exit(t.summary() ? 0 : 1);
