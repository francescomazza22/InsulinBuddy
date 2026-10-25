// Ready-made meal recipes are added once; the batch-weight bar has room.
import { startApp, openDevice, makeChecker, seedLocal } from "./harness.js";
import { FOODS_JS, stateBlob, localState } from "./helpers.js";
const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker(); const sleep = ms => new Promise(r => setTimeout(r, ms));
const app = await startApp(DIR, null, { "foods_data.js": FOODS_JS, "manifest.json": "{}" });
const blob = stateBlob(); blob.recipes = []; blob.library = [{ id: "bun1", name: "Burger bun", category: "grains", carbs: 49, kcal: 280, usageCount: 0 }];
const dev = await openDevice(app, { width: 420, height: 900, mobile: false, inject: `if (!localStorage.getItem("insulinBuddy.v2")) { ${seedLocal(blob)} }`, wait: 1800 });
t.section("SEEDED RECIPES");
let st = await localState(dev);
const names = (st.recipes || []).map(r => r.name);
t.check("the three recipes were added", names.includes("Pub-style cheeseburger and chips") && names.includes("Classic chicken pad thai") && names.some(n => /Where Pancakes Are/.test(n)), JSON.stringify(names));
const burger = st.recipes.find(r => /cheeseburger/.test(r.name));
const carbs = r => Math.round(r.items.reduce((s, i) => s + i.carbsPer100g * i.grams / 100, 0));
t.check("burger meal is ~129 g carbs, 570 g, and an existing library food is linked", burger && carbs(burger) === 129 && burger.finalWeight === 570 && burger.items[0].foodId === "bun1", JSON.stringify(burger && { c: carbs(burger), w: burger.finalWeight, f: burger.items[0].foodId }));
const pad = st.recipes.find(r => /pad thai/.test(r.name)), pan = st.recipes.find(r => /Where Pancakes/.test(r.name));
t.check("pad thai ~87 g carbs and pancakes ~82 g carbs", carbs(pad) >= 84 && carbs(pad) <= 90 && carbs(pan) >= 79 && carbs(pan) <= 85, `${carbs(pad)} / ${carbs(pan)}`);
t.check("each says it is an estimate", [burger, pad, pan].every(r => /estimate/i.test(r.notes)));
t.check("recorded as done, so deleting one keeps it gone", (st.settings.seededRecipes || []).length === 3, JSON.stringify(st.settings.seededRecipes));
t.section("BATCH WEIGHT BAR");
await dev.eval(`(() => { const s = JSON.parse(localStorage.getItem("insulinBuddy.v2")); })()`);
await dev.tab("calculator"); await sleep(300);
const picked = await dev.eval(`(() => { const row = [...document.querySelectorAll("#cc-food-list > *")].find(x => /pad thai/i.test(x.textContent)); if (!row) return "no row"; row.click(); return "ok"; })()`); await sleep(400);
const r = await dev.eval(`(() => { const i = document.getElementById("cc-batch-weight"); if (!i) return null; const row = i.closest(".field__row"), u = row.querySelector(".field__unit"); const a = i.getBoundingClientRect(), b = u.getBoundingClientRect(), c = row.getBoundingClientRect(); return { inputBorder: getComputedStyle(i).borderTopWidth, bg: getComputedStyle(i).backgroundColor, rowH: c.height, unitInside: b.right <= c.right + 0.5 && b.left >= a.right - 0.5, pad: parseFloat(getComputedStyle(u).paddingRight), inputW: a.width }; })()`);
t.check("the batch bar is open for a recipe", r !== null, picked);
if (r) {
  t.check("no box inside the bar, a normal height, and the g sits inside the bar with room", r.inputBorder === "0px" && r.rowH >= 44 && r.unitInside && r.pad >= 12, JSON.stringify(r));
  t.check("the input has the width", r.inputW > 150, String(r.inputW));
}
t.check("no JS errors", dev.errors.length === 0, JSON.stringify(dev.errors));
dev.close();

// Older versions put raw copies of the ready-made recipes into a new library ([name, grams, carbs, kcal] arrays, no
// final weight), already marked as done, so they were never fixed. Start-up must repair them in place.
t.section("RAW COPIES ARE REPAIRED");
const { SEED_RECIPES } = await import("../../js/seed-recipes.js");
const broken = stateBlob(); broken.library = []; broken.recipes = structuredClone(SEED_RECIPES);
broken.settings = { ...(broken.settings || {}), seededRecipes: SEED_RECIPES.map(r => r.key) };
const dev2 = await openDevice(app, { width: 390, height: 900, inject: `if (!localStorage.getItem("insulinBuddy.v2")) { ${seedLocal(broken)} }`, wait: 1800 });
const st2 = await localState(dev2);
const pan2 = (st2.recipes || []).find(r => /Where Pancakes/.test(r.name));
t.check("still three recipes, none duplicated", (st2.recipes || []).length === 3, String((st2.recipes || []).length));
t.check("pancakes repaired: object ingredients, 340 g, ~81 g carbs", pan2 && !Array.isArray(pan2.items[0]) && pan2.finalWeight === 340 && carbs(pan2) === 81, JSON.stringify(pan2 && { i: pan2.items[0], w: pan2.finalWeight }));
await dev2.tab("library"); await dev2.click('#lib-segmented [data-seg="recipes"]'); await sleep(300);
const rowText = await dev2.eval(`(() => { const r = [...document.querySelectorAll("#lib-recipes-list .lib-item")].find(x => /Where Pancakes/.test(x.textContent)); return r ? r.textContent.replace(/\\s+/g, " ") : ""; })()`);
t.check("Library row shows the whole dish first, then per 100 g", /81\.4g carbs · ~670 kcal whole dish · 23\.9g carbs per 100g/.test(rowText), rowText);
t.check("no JS errors after repair", dev2.errors.length === 0, JSON.stringify(dev2.errors));
dev2.close(); await app.close(); t.summary(); process.exit(0);
