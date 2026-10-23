// Security: a library file from someone else must never be able to run code in the app. Names, ids and other text from an
// imported file are shown as text; ids are replaced with the app's own; and nothing in a crafted file can add HTML or script.
import { startApp, openDevice, makeChecker, seedLocal } from "./harness.js";
import { FOODS_JS, stateBlob } from "./helpers.js";

const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const app = await startApp(DIR, null, { "foods_data.js": FOODS_JS, "manifest.json": "{}" });
const dev = await openDevice(app, { width: 390, height: 900, mobile: true, inject: `window.__pwned = 0; if (!localStorage.getItem("insulinBuddy.v2")) { ${seedLocal(stateBlob())} }`, wait: 1500 });

const PAYLOAD = `<img src=x onerror="window.__pwned++">`;
const BAD_ID = `x" onfocus="window.__pwned++" autofocus data-x="`;
const file = {
  foods: [{ id: BAD_ID, name: `Evil food ${PAYLOAD}`, category: "snacks", carbs: 10, kcal: 50 }],
  recipes: [{ id: BAD_ID + "r", name: `Evil recipe ${PAYLOAD}`, category: "snacks", finalWeight: 100, items: [{ name: `Evil ingredient ${PAYLOAD}`, grams: 50, carbsPer100g: 20, kcalPer100g: 100 }] }]
};

t.section("IMPORT SAFETY: a crafted library file");
await dev.tab("settings"); await dev.click('#settings-segmented [data-seg="data"]'); await sleep(200);
await dev.eval(`(() => { const inp = document.getElementById("import-file-input"); const dt = new DataTransfer(); dt.items.add(new File([${JSON.stringify(JSON.stringify(file))}], "shared.json", { type: "application/json" })); inp.files = dt.files; inp.dispatchEvent(new Event("change", { bubbles: true })); })()`);
await sleep(800);
// Close the "Import complete" message (an in-app dialog, so it never freezes the page).
for (let i = 0; i < 3; i++) { await dev.eval(`(() => { const b = document.querySelector(".dialog__btn--primary"); if (b) b.click(); })()`); await sleep(400); }
const st = await dev.eval(`JSON.parse(localStorage.getItem("insulinBuddy.v2"))`);
const evilFood = st.library.find(f => /Evil food/.test(f.name));
const evilRecipe = st.recipes.find(r => /Evil recipe/.test(r.name));
t.check("the food and recipe were imported", !!evilFood && !!evilRecipe, JSON.stringify({ foods: st.library.map(f => f.name), recipes: st.recipes.map(r => r.name) }));
t.check("imported items get the app's own ids, not the file's", evilFood && evilRecipe && evilFood.id !== BAD_ID && evilRecipe.id !== BAD_ID + "r" && !/["<>]/.test(evilFood.id + evilRecipe.id), JSON.stringify([evilFood && evilFood.id, evilRecipe && evilRecipe.id]));

t.section("IMPORT SAFETY: showing the imported items runs nothing");
await dev.tab("library"); await sleep(300);
await dev.eval(`document.querySelector('[data-seg="recipes"]').click()`); await sleep(400);
await dev.eval(`document.querySelector('[data-seg="foods"]').click()`); await sleep(400);
await dev.tab("calculator"); await sleep(300);
await dev.eval(`(() => { const s = document.getElementById("cc-search"); s.value = "Evil"; s.dispatchEvent(new Event("input", { bubbles: true })); })()`); await sleep(400);
await dev.click("#cc-browse-btn"); await sleep(500);
await dev.eval(`(() => { const b = [...document.querySelectorAll("#browse-tabs .segmented__btn")].find(x => /All/.test(x.textContent)); b && b.click(); })()`); await sleep(400);
t.check("no injected script ran anywhere", (await dev.eval("window.__pwned")) === 0, String(await dev.eval("window.__pwned")));
t.check("no injected <img> made it into the page", (await dev.eval(`document.querySelectorAll('img[src="x"]').length`)) === 0);
t.check("the names are shown as plain text, tags and all", await dev.eval(`document.body.textContent.includes("Evil ingredient <img")`) || await dev.eval(`document.body.textContent.includes("Evil food <img")`));

t.section("IMPORT SAFETY: a crafted full backup");
const backup = stateBlob({ history: [{ id: BAD_ID, ts: Date.now() - 3600000, mealType: "lunch", periodName: "lunch", items: [{ name: `Evil meal item ${PAYLOAD}`, grams: 10, carbs: 5 }], totalCarbs: 5, totalKcal: 20, mealDose: 1, correctionDose: 0, ratioValue: 10, ratioLabel: `R ${PAYLOAD}` }] });
const dev2 = await openDevice(app, { width: 390, height: 900, mobile: true, inject: `window.__pwned = 0; if (!localStorage.getItem("insulinBuddy.v2")) { ${seedLocal(backup)} }`, wait: 1500 });
await dev2.tab("history"); await sleep(400);
await dev2.eval(`(() => { const r = document.querySelector(".history-entry"); r && r.click(); })()`); await sleep(300);
await dev2.eval(`(() => { const b = document.querySelector(".history-entry [data-edit]"); b && b.click(); })()`); await sleep(500);
t.check("a backup with a crafted id and names runs nothing in the log or the Edit sheet", (await dev2.eval("window.__pwned")) === 0 && (await dev2.eval(`document.querySelectorAll('img[src="x"]').length`)) === 0, String(await dev2.eval("window.__pwned")));

t.check("no JS errors and nothing blocked by the Content Security Policy", (await dev.eval("window.__errs.length")) === 0 && (await dev2.eval("window.__errs.length")) === 0, JSON.stringify([await dev.eval("window.__errs"), await dev2.eval("window.__errs")]));
t.check("the page runs under a strict Content Security Policy (no inline scripts)", await dev.eval(`(() => { const m = document.querySelector('meta[http-equiv="Content-Security-Policy"]'); return !!m && /script-src 'self';/.test(m.content) && !/unsafe-inline[^;]*;\\s*style/.test(m.content.split("script-src")[1].split(";")[0]) && document.querySelectorAll("script:not([src])").length === 0; })()`));
dev.close(); dev2.close(); await app.close();
process.exit(t.summary() ? 0 : 1);
