// Editing a recipe: change an ingredient's grams in place and save.
import { startApp, openDevice, makeChecker, seedLocal } from "./harness.js";
import { FOODS_JS, stateBlob, localState } from "./helpers.js";
const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker(); const sleep = ms => new Promise(r => setTimeout(r, ms));
const app = await startApp(DIR, null, { "foods_data.js": FOODS_JS, "manifest.json": "{}" });
const blob = stateBlob();
blob.recipes = [{ id: "r1", name: "Banana Bread", category: "snacks", notes: "", favorite: false, usageCount: 0, rawWeight: null, finalWeight: 559,
  items: [{ foodId: "s1", name: "Zucchero", grams: 87, carbsPer100g: 100, kcalPer100g: 400 }, { foodId: "s2", name: "Banana", grams: 400, carbsPer100g: 23, kcalPer100g: 89 }] }];
const dev = await openDevice(app, { width: 420, height: 900, mobile: true, inject: `if (!localStorage.getItem("insulinBuddy.v2")) { ${seedLocal(blob)} }`, wait: 1800 });
t.section("EDIT RECIPE: grams are editable in place");
await dev.tab("library"); await sleep(300);
await dev.eval(`document.querySelector("[data-seg=recipes]").click()`); await sleep(300);
await dev.eval(`document.querySelector("[data-act=edit][data-id=r1]").click()`); await sleep(400);
let n = await dev.eval(`document.querySelectorAll("#rs-ing-list .ingredient-row__input").length`);
if (!n) { console.log("sheet not open via click; opening through the edit control"); }
t.check("each ingredient has an editable amount", n === 2, String(n));
await dev.eval(`(() => { const i = document.querySelectorAll("#rs-ing-list .ingredient-row__input")[1]; i.value = "380"; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
await dev.eval(`document.getElementById("rs-save").click()`); await sleep(400);
const st = await localState(dev); const r = st.recipes.find(x => x.id === "r1");
t.check("the new amount is saved and the other is untouched", r && r.items[1].grams === 380 && r.items[0].grams === 87, JSON.stringify(r && r.items));
t.check("still two ingredients (nothing removed or re-added)", r && r.items.length === 2);

t.section("EDIT RECIPE: ingredient total checks the typed weights, and the fields line up");
await dev.eval(`document.querySelector("[data-act=edit][data-id=r1]").click()`); await sleep(400);
const tot = () => dev.eval(`(() => { const b = document.getElementById("rs-total"); return { hidden: b.hidden, text: b.textContent, warn: b.classList.contains("is-warn") }; })()`);
let a = await tot();
t.check("the total is shown and is the sum of the ingredients (87 + 380 = 467 g)", !a.hidden && /467 g/.test(a.text), JSON.stringify(a));
t.check("final weight 559 is above the ingredients, so it warns that something may be missing", a.warn && /more than the ingredients/.test(a.text), JSON.stringify(a));
await dev.eval(`(() => { const i = document.querySelectorAll("#rs-ing-list .ingredient-row__input")[1]; i.value = "500"; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
a = await tot();
t.check("editing an amount updates the total live (587 g) and clears the warning", /587 g/.test(a.text) && !a.warn, JSON.stringify(a));
await dev.eval(`(() => { const i = document.getElementById("rs-raw-weight"); i.value = "600"; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
a = await tot();
t.check("a raw weight that disagrees is called out", a.warn && /Raw weight says 600 g/.test(a.text), JSON.stringify(a));
await dev.eval(`document.querySelector("[data-fix=raw]").click()`);
t.check("one tap sets raw weight to the total", (await dev.eval(`document.getElementById("rs-raw-weight").value`)) === "587");
const hs = await dev.eval(`(() => ["rs-name","rs-cat"].map(id => Math.round(document.getElementById(id).getBoundingClientRect().height)))()`);
t.check("Recipe Name and Category are the same height", hs[0] === hs[1], JSON.stringify(hs));
await dev.eval(`document.getElementById("rs-cancel").click()`); await sleep(300);
dev.close(); await app.close(); t.done && t.done(); process.exit(0);
