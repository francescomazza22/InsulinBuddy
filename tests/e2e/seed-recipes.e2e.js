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
dev.close(); await app.close(); process.exit(0);
