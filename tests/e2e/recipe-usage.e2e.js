// 2.68.6: in the Calculator's food list a recipe shows how many times it was used (a small bowl + "34×"), in its own tint,
// and logging it adds one. Before, it only said "Recipe". RU_WIDTH (default 390), RU_DARK=1, SHOTS=<dir>.
import { startApp, openDevice, makeChecker, seedLocal } from "./harness.js";
import { FOODS_JS, stateBlob, localState } from "./helpers.js";

const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SHOTS = process.env.SHOTS || "";
const W = Number(process.env.RU_WIDTH || 390), dark = process.env.RU_DARK === "1";
const app = await startApp(DIR, null, { "foods_data.js": FOODS_JS, "manifest.json": "{}" });
const blob = stateBlob({ history: [], settings: { darkMode: dark } });
blob.library = [
  { id: "s1", name: "Pane comune", category: "grains", carbs: 65, kcal: 300, gi: 75, notes: "", favorite: false, usageCount: 136 },
  { id: "s2", name: "Banana", category: "fruits", carbs: 23, kcal: 89, gi: 51, notes: "", favorite: false, usageCount: 81 },
  { id: "s3", name: "Pasta di semola", category: "grains", carbs: 70, kcal: 355, gi: 50, notes: "", favorite: false, usageCount: 28 }
];
blob.recipes = [
  { id: "r1", name: "Banana Bread", items: [{ foodId: "s2", grams: 300 }, { foodId: "s1", grams: 200, carbsPer100g: 65, kcalPer100g: 300 }], finalWeight: 600, notes: "Una fetta pesa circa 30/40gr", usageCount: 34 },
  { id: "r2", name: "Torta nuova", items: [{ foodId: "s1", grams: 100 }], finalWeight: 300, notes: "", usageCount: 0 }
];
const dev = await openDevice(app, { width: W, height: 900, mobile: W < 1000, dark, inject: `if (!localStorage.getItem("insulinBuddy.v2")) { ${seedLocal(blob)} }`, wait: 1500 });
await dev.tab("calculator");
await dev.waitFor(`document.getElementById("cc-food-list").children.length >= 4`, 8000);

const badges = () => dev.eval(`[...document.querySelectorAll("#cc-food-list > *")].map(r => ({ name: (r.querySelector(".food-pick-item__name") || {}).textContent, badge: (r.querySelector(".food-pick-item__badge") || {}).textContent || "", recipe: !!r.querySelector(".food-pick-item__badge--recipe"), bg: r.querySelector(".food-pick-item__badge") ? getComputedStyle(r.querySelector(".food-pick-item__badge")).backgroundColor : "" }))`);
t.section(`FOOD LIST (${W}px${dark ? ", dark" : ""})`);
let rows = await badges();
console.log("  ", JSON.stringify(rows.map(r => [r.name, r.badge])));
const bread = rows.find(r => r.name === "Banana Bread"), pane = rows.find(r => r.name === "Pane comune"), fresh = rows.find(r => r.name === "Torta nuova");
t.check("the recipe shows how many times it was used", bread && bread.badge === "34×", bread && bread.badge);
t.check("in its own tint, different from the foods' badges", bread && bread.recipe && pane && !pane.recipe && bread.bg !== pane.bg, `${bread && bread.bg} vs ${pane && pane.bg}`);
t.check("a recipe never used shows just the recipe badge (no count)", !fresh || (fresh.badge === "" && fresh.recipe), fresh && fresh.badge);
t.check("foods keep their plain count", pane && pane.badge === "136×");
t.check("the badge is announced as a recipe with its count", await dev.eval(`document.querySelector(".food-pick-item__badge--recipe").getAttribute("aria-label")`) === "Recipe, used 34 times");
t.check("the badge fits on one line", await dev.eval(`(() => { const b = document.querySelector(".food-pick-item__badge--recipe"); return b.getBoundingClientRect().height < 30; })()`));
if (SHOTS) { await dev.eval(`document.getElementById("cc-food-list").scrollIntoView({ block: "start" })`); await sleep(300); await dev.shot(`${SHOTS}/recipe-usage-${W}${dark ? "-dark" : ""}.png`); }

t.section("LOGGING THE RECIPE COUNTS IT");
await dev.eval(`[...document.querySelectorAll("#cc-food-list > *")].find(r => r.querySelector(".food-pick-item__name").textContent === "Banana Bread").click()`); await sleep(300);
await dev.eval(`(() => { const g = document.getElementById("cc-grams"); g.value = "40"; g.dispatchEvent(new Event("input", { bubbles: true })); })()`);
await dev.click("#cc-add-btn"); await sleep(150);
await dev.click("#cc-log-btn"); await sleep(500);
const st = await localState(dev);
t.check("the recipe's count went from 34 to 35", st.recipes.find(r => r.id === "r1").usageCount === 35, String(st.recipes.find(r => r.id === "r1").usageCount));
await dev.tab("calculator"); await sleep(300);
rows = await badges();
t.check("and the list now says 35×", rows.find(r => r.name === "Banana Bread").badge === "35×", rows.find(r => r.name === "Banana Bread").badge);
t.check("no JS errors", (await dev.eval("window.__errs.length")) === 0 && dev.errors.length === 0, JSON.stringify(await dev.eval("window.__errs")));
dev.close(); await app.close();
process.exit(t.summary() ? 0 : 1);
