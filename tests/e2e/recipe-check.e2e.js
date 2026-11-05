// Recipes vs the foods they are made of (2.86.0). Francesco's Banana Bread kept Farina at 90 g carbs per 100 g after the
// Library food was corrected; nothing said so. Now: ingredients are linked by exact name at start-up (figures untouched),
// the Recipes list and the recipe sheet say what changed, and editing a food offers to update its recipes, with Undo.
// RC_WIDTH (default 390), RC_DARK=1, SHOTS=<dir>.
import { startApp, openDevice, makeChecker, seedLocal } from "./harness.js";
import { FOODS_JS, stateBlob, localState } from "./helpers.js";
const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker(); const sleep = ms => new Promise(r => setTimeout(r, ms));
const W = Number(process.env.RC_WIDTH) || 390, DARK = process.env.RC_DARK === "1", SHOTS = process.env.SHOTS;
const app = await startApp(DIR, null, { "foods_data.js": FOODS_JS, "manifest.json": "{}" });
const blob = stateBlob();
blob.library.push({ id: "s3", name: "Farina", category: "grains", carbs: 78, kcal: 369, protein: null, fat: null, salt: null, gi: 70, notes: "", favorite: false, usageCount: 8 });
blob.recipes = [
  { id: "r1", name: "Banana Bread", category: "snacks", notes: "", favorite: false, usageCount: 40, rawWeight: null, finalWeight: 647,
    items: [{ foodId: "s3", name: "Farina", grams: 90, carbsPer100g: 90, kcalPer100g: 369 }, { foodId: "s2", name: "Banana", grams: 297, carbsPer100g: 23, kcalPer100g: 89 }] },
  { id: "r2", name: "Sfrappole", category: "snacks", notes: "", favorite: false, usageCount: 0, rawWeight: null, finalWeight: 250,
    items: [{ foodId: null, name: "Farina", grams: 200, carbsPer100g: 90, kcalPer100g: 369 }] },
  { id: "r3", name: "Banana snack", category: "fruits", notes: "", favorite: false, usageCount: 1, rawWeight: null, finalWeight: 100,
    items: [{ foodId: "s2", name: "Banana", grams: 100, carbsPer100g: 23, kcalPer100g: 89 }] }
];
const dev = await openDevice(app, { width: W, height: 900, mobile: true, dark: DARK, inject: `if (!localStorage.getItem("insulinBuddy.v2")) { ${seedLocal(blob)} }`, wait: 1800 });
const recipe = async id => (await localState(dev)).recipes.find(x => x.id === id);
const flour = async id => (await recipe(id)).items.find(i => i.name === "Farina");
const openSeg = async seg => { await dev.tab("library"); await dev.eval(`document.querySelector("[data-seg=${seg}]").click()`); await sleep(300); };
const text = sel => dev.eval(`(document.querySelector(${JSON.stringify(sel)}) || {}).textContent || ""`);
const dialogText = () => dev.eval(`(document.querySelector(".dialog") || {}).textContent || ""`);
const press = sel => dev.eval(`document.querySelector(${JSON.stringify(sel)}).click()`);
const tag = `${W}${DARK ? "-dark" : ""}`;

t.section("START-UP: unlinked ingredients get the food of the same name, figures untouched");
let f2 = await flour("r2");
t.check("Sfrappole's Farina is now linked to the Library food", f2.foodId === "s3", JSON.stringify(f2));
t.check("…and still has its saved 90 g carbs / 369 kcal", f2.carbsPer100g === 90 && f2.kcalPer100g === 369 && f2.grams === 200);
t.check("Banana Bread still has 90 too (nothing updated on its own)", (await flour("r1")).carbsPer100g === 90);

t.section("RECIPES LIST: says which food changed");
await openSeg("recipes");
const staleLine = id => dev.eval(`(() => { const b = document.querySelector('[data-act=edit][data-id=${id}]'); const row = b && b.closest(".lib-item"); const s = row && row.querySelector(".lib-item__stale"); return s ? s.textContent : ""; })()`);
t.check("Banana Bread names Farina", /Farina/.test(await staleLine("r1")), await staleLine("r1"));
t.check("Sfrappole names Farina (thanks to the new link)", /Farina/.test(await staleLine("r2")));
t.check("Banana snack has no notice (Banana unchanged)", (await staleLine("r3")) === "");
if (SHOTS) await dev.shot(`${SHOTS}/recipe-check-list-${tag}.png`);

t.section("RECIPE SHEET: shows the change and its effect, updates only on a tap");
await press("[data-act=edit][data-id=r1]"); await sleep(400);
const notice = await text("#rs-stale");
t.check("the notice is shown", await dev.eval(`!document.getElementById("rs-stale").hidden`));
t.check("it says Farina 90 → 78 g carbs per 100 g", /Farina: carbs 90 → 78 g per 100 g/.test(notice), notice);
t.check("it gives the whole dish before and after (149.3 → 138.5 g, 23.1 → 21.4 per 100 g)", /149\.3 → 138\.5 g carbs \(23\.1 → 21\.4 g per 100 g\)/.test(notice), notice);
t.check("it says logged meals keep what they had", /already logged keep/.test(notice));
await sleep(900);
t.check("opening the sheet changed nothing (still 90)", (await flour("r1")).carbsPer100g === 90);
if (SHOTS) await dev.shot(`${SHOTS}/recipe-check-sheet-${tag}.png`);
await press('#rs-stale [data-stale="update"]'); await sleep(300);
let r1 = await recipe("r1");
t.check("Use the Library figures saves 78 at once", r1.items[0].carbsPer100g === 78 && r1.items[0].kcalPer100g === 369, JSON.stringify(r1.items[0]));
t.check("grams, name and link unchanged; Banana untouched", r1.items[0].grams === 90 && r1.items[0].foodId === "s3" && r1.items[1].carbsPer100g === 23 && r1.items[1].grams === 297);
t.check("the notice goes away", await dev.eval(`document.getElementById("rs-stale").hidden`));
await press("#rs-close"); await sleep(400);
t.check("closing offers Undo", /Saved changes to "Banana Bread"/.test(await text("#undo-toast-message")));
await press("#undo-toast-btn"); await sleep(400);
t.check("Undo puts 90 back", (await flour("r1")).carbsPer100g === 90);

t.section("EDITING A FOOD: offers to update the recipes that use it");
await openSeg("foods");
await press("[data-act=edit][data-id=s3]"); await sleep(400);
await dev.eval(`(() => { const i = document.getElementById("fs-carbs"); i.value = "75"; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
await press("#fs-save"); await sleep(400);
const dlg = await dialogText();
t.check("a dialog asks to update recipes too", /Update recipes too\?/.test(dlg), dlg);
t.check("it names both recipes", /"Banana Bread" and "Sfrappole"/.test(dlg));
t.check("Banana snack isn't mentioned", !/Banana snack/.test(dlg));
if (SHOTS) await dev.shot(`${SHOTS}/recipe-check-dialog-${tag}.png`);
t.check("the food is already saved at 75 while the dialog is open", (await localState(dev)).library.find(f => f.id === "s3").carbs === 75);
t.check("…but the recipes aren't yet", (await flour("r1")).carbsPer100g === 90 && (await flour("r2")).carbsPer100g === 90);
await press(".dialog__btn--primary"); await sleep(400);
t.check("Update recipes: both now 75", (await flour("r1")).carbsPer100g === 75 && (await flour("r2")).carbsPer100g === 75);
t.check("grams unchanged", (await flour("r1")).grams === 90 && (await flour("r2")).grams === 200);
t.check("a toast says 2 recipes were updated", /Updated 2 recipes/.test(await text("#undo-toast-message")));
await press("#undo-toast-btn"); await sleep(400);
t.check("Undo puts both back to 90", (await flour("r1")).carbsPer100g === 90 && (await flour("r2")).carbsPer100g === 90);
t.check("…and leaves the food at 75 (that was saved separately)", (await localState(dev)).library.find(f => f.id === "s3").carbs === 75);

t.section("EDITING A FOOD: Not now changes no recipe; unrelated edits ask nothing");
await press("[data-act=edit][data-id=s3]"); await sleep(400);
await dev.eval(`(() => { const i = document.getElementById("fs-kcal"); i.value = "364"; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
await press("#fs-save"); await sleep(400);
t.check("asked again after a kcal change", /Update recipes too\?/.test(await dialogText()));
await press(".dialog__btn--ghost"); await sleep(400);
t.check("Not now: recipes keep 90 / 369", (await flour("r1")).carbsPer100g === 90 && (await flour("r1")).kcalPer100g === 369);
await press("[data-act=edit][data-id=s3]"); await sleep(400);
await dev.eval(`(() => { const i = document.getElementById("fs-notes"); i.value = "00 flour"; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
await press("#fs-save"); await sleep(400);
t.check("changing only the notes asks nothing", !(await dev.eval(`!!document.querySelector(".dialog")`)));
await press("[data-act=edit][data-id=s1]"); await sleep(400);
await dev.eval(`(() => { const i = document.getElementById("fs-carbs"); i.value = "50"; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
await press("#fs-save"); await sleep(400);
t.check("a food in no recipe asks nothing", !(await dev.eval(`!!document.querySelector(".dialog")`)));

t.section("FOOD SHEET: where the figures come from, and unit names");
await press("[data-act=edit][data-id=s2]"); await sleep(400);
t.check("the sheet has a source picker, Not said by default", await dev.eval(`document.getElementById("fs-source").value === ""`));
await dev.eval(`(() => { const s = document.getElementById("fs-source"); s.value = "estimate"; s.dispatchEvent(new Event("change", { bubbles: true })); const u = document.getElementById("fs-unit-based"); u.checked = true; u.dispatchEvent(new Event("change", { bubbles: true })); document.getElementById("fs-unit-label").value = "1 bag"; document.getElementById("fs-grams-per-unit").value = "16"; })()`);
if (SHOTS) await dev.shot(`${SHOTS}/recipe-check-foodsheet-${tag}.png`);
await press("#fs-save"); await sleep(400);
const banana = (await localState(dev)).library.find(f => f.id === "s2");
t.check("saved as an estimate", banana.source === "estimate", JSON.stringify(banana));
t.check("\"1 bag\" is saved as \"bag\"", banana.unitLabel === "bag" && banana.gramsPerUnit === 16);
t.check("the Library row shows an Estimate badge", await dev.eval(`(() => { const b = document.querySelector('[data-act=edit][data-id=s2]'); return /Estimate/.test(b.closest(".lib-item").textContent); })()`));
t.check("no recipe question (carbs and kcal unchanged)", !(await dev.eval(`!!document.querySelector(".dialog")`)));

t.section("STATE: still valid, nothing else touched");
const st = await localState(dev);
t.check("his three recipes are all still there (plus the ready-made ones)", ["r1", "r2", "r3"].every(id => st.recipes.some(r => r.id === id)) && st.recipes.length === 6, st.recipes.map(r => r.id).join());
t.check("no log entries were created", st.history.length === 0);

const ok = t.summary();
dev.close(); await app.close(); process.exit(ok ? 0 : 1);
