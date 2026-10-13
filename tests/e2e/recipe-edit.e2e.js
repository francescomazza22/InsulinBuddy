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
dev.close(); await app.close(); t.done && t.done(); process.exit(0);
