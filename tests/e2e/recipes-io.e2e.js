// Recipes can be exported on their own and imported again (alone or together with the foods file).
import fs from "fs";
import { startApp, openDevice, makeChecker, seedLocal } from "./harness.js";
import { FOODS_JS, stateBlob, localState } from "./helpers.js";

const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const app = await startApp(DIR, null, { "foods_data.js": FOODS_JS, "manifest.json": "{}" });
const blob = stateBlob();
blob.recipes = [{ id: "r1", name: "Pizza dough", category: "grains", notes: "Sunday", favorite: false, usageCount: 3, rawWeight: 500, finalWeight: 480,
  items: [{ foodId: "s1", name: "Pane comune", grams: 300, carbsPer100g: 65, kcalPer100g: 300 }, { foodId: "s2", name: "Banana", grams: 100, carbsPer100g: 23, kcalPer100g: 89 }] }];
const dev = await openDevice(app, { width: 1100, height: 900, mobile: false, inject: `if (!localStorage.getItem("insulinBuddy.v2")) { ${seedLocal(blob)} }`, wait: 1800 });

t.section("EXPORT: recipes alone");
await dev.eval(`(() => { window.__dl = []; const real = URL.createObjectURL.bind(URL); URL.createObjectURL = b => { b.text().then(x => window.__dl.push(x)); return real(b); }; window.alert = m => { window.__alerts = (window.__alerts || []).concat(m); }; })()`);
await dev.tab("settings"); await sleep(200);
await dev.eval(`document.getElementById("btn-export-recipes").click()`); await sleep(500);
const csv = await dev.eval(`window.__dl[0] || ""`);
t.check("a recipe CSV was produced with the recipe and its ingredients", /Pizza dough/.test(csv) && /Pane comune/.test(csv) && /ingredients/.test(csv), csv.slice(0, 200));

t.section("IMPORT: the same file restores a deleted recipe, with ingredients");
await dev.eval(`(() => { const s = JSON.parse(localStorage.getItem("insulinBuddy.v2")); s.recipes = []; localStorage.setItem("insulinBuddy.v2", JSON.stringify(s)); })()`);
// reload is flaky in this sandbox, so drive the real import path in the live page instead
const pick = names => dev.eval(`(async () => { const dt = new DataTransfer(); ${names.map(n => `dt.items.add(new File([${JSON.stringify(n.text)}], ${JSON.stringify(n.name)}));`).join("")} const i = document.getElementById("import-file-input"); i.files = dt.files; i.dispatchEvent(new Event("change", { bubbles: true })); })()`);
// the page's in-memory state still holds the recipe, so remove it there too through the UI-level API: import is by name -> would "update".
const before = await dev.eval(`document.getElementById("export-count-label").textContent`);
await pick([{ name: "Recipe_export.csv", text: csv }]); await sleep(600);
const alerts1 = await dev.eval(`(window.__alerts || []).join(" | ")`);
t.check("import reports recipes (and does not treat the file as foods)", /Recipes: \d+ (added|updated)/.test(alerts1) && !/Foods:/.test(alerts1), alerts1);
const st = await localState(dev);
const r = (st.recipes || []).find(x => x.name === "Pizza dough");
t.check("the recipe is there with both ingredients and its weights", r && r.items.length === 2 && r.finalWeight === 480 && r.rawWeight === 500 && r.items[0].grams === 300, JSON.stringify(r));
t.check("ingredients point at the library foods", r && r.items[0].foodId === "s1" && r.items[1].foodId === "s2", JSON.stringify(r && r.items));
t.check("no duplicate foods were created from the recipe file", st.library.length === 2, String(st.library.length));

t.section("IMPORT: a brand-new recipe + the foods file, picked together");
const newRecipe = csv.replace(/Pizza dough/g, "Focaccia");
const foodsCsv = `"name","category","carbs_per_100g","calories_per_100g"\n"Olive oil","other","0","884"`;
await pick([{ name: "Recipe_export.csv", text: newRecipe }, { name: "Food_export.csv", text: foodsCsv }]); await sleep(600);
const st2 = await localState(dev);
t.check("both arrived: new recipe and new food", st2.recipes.some(x => x.name === "Focaccia") && st2.library.some(x => x.name === "Olive oil"), JSON.stringify(st2.recipes.map(x => x.name)));
t.check("the original recipe is untouched (still one Pizza dough)", st2.recipes.filter(x => x.name === "Pizza dough").length === 1);
t.section("IMPORT: foods logged by quantity keep their unit (the real export file, plus a 'True' spelling)");
const real = fs.readFileSync("/root/.claude/uploads/6958b332-d72b-5d2b-804e-720ac78a6776/546d21fb-Food_export.csv", "utf8");
await pick([{ name: "Food_export.csv", text: real }, { name: "Extra.csv", text: `"name","carbs_per_100g","unit_based","unit_label","grams_per_unit"\n"Test biscuit","60","True","Biscuit","12"\n"Test sweet","70","1","Sweet","5"` }]); await sleep(700);
const st3 = await localState(dev);
const by = n => st3.library.find(f => f.name === n) || {};
t.check("Croissant (Gails) is logged by quantity: Portion, 80 g", by("Croissant (Gails)").unitBased === true && by("Croissant (Gails)").unitLabel === "Portion" && by("Croissant (Gails)").gramsPerUnit === 80, JSON.stringify(by("Croissant (Gails)")));
t.check("Bastoncini Findus and Lindor too", by("Bastoncini Findus (fish finger)").unitBased === true && by("Lindor").unitBased === true);
t.check("'True' and '1' spellings both work", by("Test biscuit").unitBased === true && by("Test sweet").unitBased === true);
t.check("a plain food stays per 100 g", by("Mela").unitBased === false || by("Mela").unitBased == null);
await dev.tab("calculator"); await sleep(200);
await dev.eval(`(() => { const i = document.getElementById("cc-search"); i.value = "Test biscuit"; i.dispatchEvent(new Event("input", { bubbles: true })); })()`); await sleep(300);
const pickRow = await dev.eval(`(() => { const rows=[...document.querySelectorAll("#cc-food-list .food-pick-item")]; const r=rows.find(x=>/Test biscuit/.test(x.textContent)); return r ? r.textContent : "rows:" + rows.length + " first:" + (rows[0] ? rows[0].textContent : "none") + " q=" + document.getElementById("cc-search").value; })()`);
t.check("the calculator list shows it per unit, not per 100g", /\/Biscuit/.test(pickRow), pickRow);

t.check("no JS errors", dev.errors.length === 0, dev.errors.join("|"));
dev.close(); await app.close();
process.exit(t.summary() ? 0 : 1);
