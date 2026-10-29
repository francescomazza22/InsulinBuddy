// Swap foods (2.74.0): on a meal already injected for, change the foods and let one picked food make up the carbs, so the
// total still matches the bolus. Insulin, carbs and ratio never change; nothing new is sent to Nightscout.
// SWAP_WIDTH (default 390), SWAP_DARK=1, SHOTS=<dir>.
import { createBackend, startApp, openDevice, fakeSupabaseSource, makeChecker } from "./harness.js";
import { FOODS_JS, stateBlob, meal } from "./helpers.js";

const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SHOTS = process.env.SHOTS || "";
const W = Number(process.env.SWAP_WIDTH || 390), dark = process.env.SWAP_DARK === "1";
const be = createBackend();
const app = await startApp(DIR, be, { "foods_data.js": FOODS_JS });

const lib = (id, name, carbs, extra = {}) => ({ id, name, category: "grains", carbs, kcal: 300, protein: null, fat: null, salt: null, gi: null, notes: "", favorite: false, usageCount: 1, ...extra });
const library = [lib("s1", "Pane comune", 65), lib("p", "Pasta", 30), lib("b", "Bread", 50), lib("r", "Basmati rice", 28), lib("c", "Cheddar", 0)];
const item = (refId, name, grams, per100) => ({ refType: "food", refId, name, grams, carbsPer100g: per100, kcalPer100g: 300, gi: null, carbs: Math.round(per100 * grams) / 100, kcal: grams * 3 });
// 4 u for 60 g carbs: pasta 100 g (30 g) and bread 60 g (30 g).
const dinner = meal("d1", Date.now() - 20 * 60000, { mealType: "dinner", totalCarbs: 60, totalKcal: 480, mealDose: 4, correctionDose: 0.5, ratioValue: 15, ratioLabel: "Dinner",
  items: [item("p", "Pasta", 100, 30), item("b", "Bread", 60, 50), item("c", "Cheddar", 30, 0)] });
const low = meal("lo", Date.now() - 3 * 3600000, { mealType: "snack", noInsulin: true, mealDose: 0, totalCarbs: 15, items: [item("b", "Bread", 30, 50)] });
be.row = { user_id: "user-1", data: stateBlob({ history: [dinner, low], library, settings: { units: "mgdl", nightscoutUrl: "https://demo.ns.example.com/?token=tok-abcdef-123456" } }), updated_at: be.stamp() };

const dev = await openDevice(app, { width: W, height: 1000, mobile: W < 1000, dark, inject: fakeSupabaseSource({ userId: "user-1" }), wait: 2000 });
await dev.tab("history"); await dev.click('#history-segmented [data-seg="log"]'); await sleep(400);
const open = id => dev.eval(`(() => { const r = document.querySelector('.history-entry[data-id="${id}"]') || document.querySelector('[data-id="${id}"] .history-entry'); r.querySelector(".history-entry__main").click(); return true; })()`);
const status = () => dev.eval(`document.getElementById("sw-status").textContent.replace(/\\s+/g, " ").trim()`);
const typeGrams = (idx, v) => dev.eval(`(() => { const i = document.querySelector('.swap-row__grams[data-idx="${idx}"]'); i.value = ${JSON.stringify(v)}; i.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
const rowGrams = idx => dev.eval(`document.querySelector('.swap-row__grams[data-idx="${idx}"]').value`);
const saveOn = () => dev.eval(`!document.getElementById("sw-save").disabled`);

t.section(`SWAP FOODS (${W}px${dark ? ", dark" : ""})`);
// On a phone the opened meal hides its Use Again / Edit / Delete row (those are in the swipe tray), so Swap foods must sit
// outside that row to be seen at all.
await dev.cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 }); await sleep(300);
await open("d1"); await sleep(200);
const vis = await dev.eval(`(() => { const b = document.querySelector('[data-swap="d1"]'); if (!b) return { found: false }; const r = b.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { found: true, touch: matchMedia("(hover: none) and (pointer: coarse)").matches, w: r.width, h: r.height, hit: b.contains(top) }; })()`);
t.check("on a touch screen the opened meal shows Swap foods, tappable", vis.found && vis.touch && vis.w > 0 && vis.h >= 32 && vis.hit, JSON.stringify(vis));
await dev.cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false }); await sleep(200);
t.check("a dosed meal has Swap foods", await dev.eval(`!!document.querySelector('[data-swap="d1"]')`));
t.check("a treated low (no insulin) doesn't", !(await dev.eval(`!!document.querySelector('[data-swap="lo"]')`)));
await dev.click('[data-swap="d1"]'); await sleep(400);
t.check("the sheet says what the bolus covered (meal insulin, not the correction)", /Your 4 u covered 60 g carbs/.test(await dev.eval(`document.querySelector(".swap-sheet__target").textContent`)));
t.check("nothing to save until something changes and a food adjusts", !(await saveOn()));
t.check("a food with no carbs can't be the one that adjusts", await dev.eval(`document.querySelector('[data-adjust="2"]').disabled`));

// Add 50 g of rice, then let the bread make up the difference.
await dev.eval(`(() => { const s = document.getElementById("sw-search"); s.value = "rice"; s.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`); await sleep(150);
t.check("search finds the food", await dev.eval(`!!document.querySelector('.swap-result[data-pick="food:r"]')`));
await dev.click('.swap-result[data-pick="food:r"]'); await sleep(200);
t.check("the new food's grams field is focused, ready to type", await dev.eval(`document.activeElement && document.activeElement.dataset.idx === "3"`));
await typeGrams(3, "50"); await sleep(150);
let st = await status();
t.check("before picking, it says how far off the total is", /Now 74 g carbs, 14 g more than your bolus covered/.test(st), st);
await dev.click('[data-adjust="1"]'); await sleep(200);
st = await status();
t.check("bread adjusts: have 32 g of bread", /Have 32 g of Bread\. Total 60 g carbs, the same as your 4 u covered\./.test(st), st);
t.check("the bread row shows 32 g and can't be typed in", (await rowGrams(1)) === "32" && await dev.eval(`document.querySelector('.swap-row__grams[data-idx="1"]').readOnly`));
t.check("Update meal is available", await saveOn());

// Typing more pasta updates the bread live, without redrawing the field being typed in.
await dev.eval(`document.querySelector('.swap-row__grams[data-idx="0"]').focus()`);
await typeGrams(0, "120"); await sleep(150);
t.check("more pasta → less bread (20 g)", (await rowGrams(1)) === "20" && /Have 20 g of Bread/.test(await status()), `${await rowGrams(1)} | ${await status()}`);
t.check("the pasta field keeps focus while typing", await dev.eval(`document.activeElement && document.activeElement.dataset.idx === "0"`));
// Decimal comma.
await typeGrams(0, "100,0"); await sleep(150);
t.check("a decimal comma reads correctly", (await rowGrams(1)) === "32", await rowGrams(1));

// Too much elsewhere: 300 g of rice is 84 g carbs on its own.
await typeGrams(3, "300"); await sleep(150);
st = await status();
t.check("over: says the others already have too many carbs, and by how much", /Even with no Bread, the other foods have 114 g carbs, 54 g more than your 4 u covered/.test(st), st);
t.check("over: can't update", !(await saveOn()));
if (SHOTS) { await dev.shot(`${SHOTS}/swap-over-${W}${dark ? "-dark" : ""}.png`); }
await typeGrams(3, "50"); await sleep(150);
if (SHOTS) { await dev.eval(`document.querySelector(".swap-sheet").scrollTop = 0`); await sleep(150); await dev.shot(`${SHOTS}/swap-${W}${dark ? "-dark" : ""}.png`); }
t.check("no sideways scroll in the sheet", await dev.eval(`(() => { const s = document.querySelector(".swap-sheet"); return s.scrollWidth <= s.clientWidth + 1; })()`));

const nsBefore = be.log.filter(l => l.kind === "ns").length;
await dev.click("#sw-save"); await sleep(500);
const saved = await dev.eval(`JSON.parse(localStorage.getItem("insulinBuddy.v2")).history.find(h => h.id === "d1")`);
t.check("the meal now has pasta 100 g, bread 32 g, cheddar, rice 50 g", JSON.stringify(saved.items.map(i => [i.name, i.grams])) === JSON.stringify([["Pasta", 100], ["Bread", 32], ["Cheddar", 30], ["Basmati rice", 50]]), JSON.stringify(saved.items.map(i => [i.name, i.grams])));
t.check("total carbs still 60 g, the items add up to it", saved.totalCarbs === 60 && Math.round(saved.items.reduce((s, i) => s + i.carbs, 0) * 100) / 100 === 60, `${saved.totalCarbs} / ${saved.items.reduce((s, i) => s + i.carbs, 0)}`);
t.check("insulin unchanged: 4 u meal + 0.5 u correction, same ratio", saved.mealDose === 4 && saved.correctionDose === 0.5 && saved.ratioValue === 15 && saved.ratioLabel === "Dinner");
t.check("calories follow the new foods", saved.totalKcal === Math.round(saved.items.reduce((s, i) => s + (i.kcal || 0), 0)), String(saved.totalKcal));
t.check("nothing new is created in Nightscout", be.log.slice(nsBefore).filter(l => l.kind === "ns" && l.action === "create").length === 0, JSON.stringify(be.log.slice(nsBefore).filter(l => l.kind === "ns").map(l => l.action)));
t.check("the log shows the new foods", /Basmati rice/.test(await dev.eval(`document.querySelector('[data-id="d1"] .history-entry__food-names, .history-entry[data-id="d1"] .history-entry__food-names').textContent`)));

// Undo puts the meal back as it was.
await dev.eval(`(() => { const b = [...document.querySelectorAll("button")].find(b => /^Undo$/i.test(b.textContent.trim())); b && b.click(); return !!b; })()`); await sleep(400);
const undone = await dev.eval(`JSON.parse(localStorage.getItem("insulinBuddy.v2")).history.find(h => h.id === "d1")`);
t.check("Undo restores the original foods", JSON.stringify(undone.items.map(i => [i.name, i.grams])) === JSON.stringify([["Pasta", 100], ["Bread", 60], ["Cheddar", 30]]));

t.check("no JS errors", (await dev.eval("window.__errs.length")) === 0 && dev.errors.length === 0, JSON.stringify(await dev.eval("window.__errs")));
dev.close(); await app.close();
process.exit(t.summary() ? 0 : 1);
