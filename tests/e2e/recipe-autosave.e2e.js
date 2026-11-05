// Recipe autosave (2.84.0): Francesco: "make sure recipes are autosaved when playing with the dosage even before pressing
// save recipe". Changes reach the library without pressing anything; an unfinished new recipe survives the app closing.
// RA_WIDTH (default 390), RA_DARK=1, SHOTS=<dir>.
import { startApp, openDevice, makeChecker, seedLocal } from "./harness.js";
import { FOODS_JS, stateBlob, localState } from "./helpers.js";
const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker(); const sleep = ms => new Promise(r => setTimeout(r, ms));
const W = Number(process.env.RA_WIDTH) || 390, SHOTS = process.env.SHOTS;
const app = await startApp(DIR, null, { "foods_data.js": FOODS_JS, "manifest.json": "{}" });
const blob = stateBlob();
blob.recipes = [{ id: "r1", name: "Banana Bread", category: "snacks", notes: "", favorite: false, usageCount: 3, rawWeight: null, finalWeight: 559,
  items: [{ foodId: "s1", name: "Pane comune", grams: 87, carbsPer100g: 65, kcalPer100g: 300 }, { foodId: "s2", name: "Banana", grams: 400, carbsPer100g: 23, kcalPer100g: 89 }] }];
const dev = await openDevice(app, { width: W, height: 900, mobile: true, dark: process.env.RA_DARK === "1", inject: `if (!localStorage.getItem("insulinBuddy.v2")) { ${seedLocal(blob)} }`, wait: 1800 });
const typeInto = async (sel, text) => { await dev.eval(`(() => { const i = document.querySelector(${JSON.stringify(sel)}); i.focus(); i.value = ""; i.dispatchEvent(new Event("input", { bubbles: true })); })()`); if (text) await dev.cdp.send("Input.insertText", { text }); await sleep(120); };
const setGrams = (idx, v) => dev.eval(`(() => { const i = document.querySelectorAll("#rs-ing-list .ingredient-row__input")[${idx}]; i.value = ${JSON.stringify(v)}; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
const recipe = async id => (await localState(dev)).recipes.find(x => x.id === id);
const sheetOpen = () => dev.eval(`!!document.getElementById("rs-name")`);
const status = () => dev.eval(`(document.getElementById("rs-autosave") || {}).textContent || ""`);
const openRecipes = async () => { await dev.tab("library"); await dev.eval(`document.querySelector("[data-seg=recipes]").click()`); await sleep(300); };
const confirmDialog = async () => { await dev.eval(`(document.querySelector(".dialog__btn--primary, .dialog__btn--danger") || {}).click && document.querySelector(".dialog__btn--primary, .dialog__btn--danger").click()`); await sleep(300); };

t.section("EDITING: a changed amount is saved without pressing anything");
await openRecipes();
await dev.eval(`document.querySelector("[data-act=edit][data-id=r1]").click()`); await sleep(400);
t.check("the sheet says changes save as you go", /save as you go/i.test(await status()), await status());
t.check("the buttons are Undo changes and Done (no Save to forget)", (await dev.eval(`[document.getElementById("rs-cancel").textContent, document.getElementById("rs-save").textContent].join("|")`)) === "Undo changes|Done");
await setGrams(1, "380");
await sleep(1000);
let r = await recipe("r1");
t.check("380 g is in the saved library while the sheet is still open", r.items[1].grams === 380 && r.items[0].grams === 87, JSON.stringify(r.items.map(i => i.grams)));
t.check("the line says Saved", /^Saved/.test(await status()), await status());
t.check("the sheet is still open", await sheetOpen());
await setGrams(0, "90,5");
// Leaving the app (iOS can close it straight away) saves at once, without waiting for the pause.
await dev.eval(`(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); document.dispatchEvent(new Event("visibilitychange")); delete document.hidden; })()`);
await sleep(150);
r = await recipe("r1");
t.check("going to the background saves the change immediately (90.5 g)", r.items[0].grams === 90.5, JSON.stringify(r.items.map(i => i.grams)));
if (SHOTS) await dev.shot(`${SHOTS}/recipe-autosave-edit-${W}${process.env.RA_DARK === "1" ? "-dark" : ""}.png`);

t.section("EDITING: closing says what was saved, and Undo puts it back");
await dev.eval(`document.getElementById("rs-close").click()`); await sleep(400);
t.check("the sheet closed", !(await sheetOpen()));
t.check("a toast says the changes were saved", /Saved changes to "Banana Bread"/.test(await dev.eval(`document.getElementById("undo-toast-message").textContent`)));
await dev.eval(`document.getElementById("undo-toast-btn").click()`); await sleep(400);
r = await recipe("r1");
t.check("Undo restores the recipe as it was opened (87 g, 400 g)", r.items[0].grams === 87 && r.items[1].grams === 400 && r.usageCount === 3, JSON.stringify(r));

t.section("EDITING: an incomplete change keeps the last complete version");
await dev.eval(`document.querySelector("[data-act=edit][data-id=r1]").click()`); await sleep(400);
await setGrams(1, "450"); await sleep(900);
await setGrams(1, ""); await sleep(900);
r = await recipe("r1");
t.check("an emptied amount isn't saved: the library keeps 450 g", r.items[1].grams === 450, JSON.stringify(r.items.map(i => i.grams)));
t.check("the line says it isn't saved yet and why", /Not saved yet.*grams/.test(await status()), await status());
await dev.eval(`document.getElementById("rs-save").click()`); await sleep(300);
t.check("Done asks before closing on an unsaved change", await dev.eval(`/isn't saved/.test((document.querySelector(".dialog") || {}).textContent || "")`));
await dev.eval(`document.querySelector(".dialog__btn--ghost").click()`); await sleep(200);
t.check("Keep editing leaves the sheet open", await sheetOpen());
await setGrams(1, "420"); await sleep(900);
t.check("fixing it saves it (420 g)", (await recipe("r1")).items[1].grams === 420);
await dev.eval(`document.getElementById("rs-cancel").click()`); await sleep(300);
t.check("Undo changes asks first", await dev.eval(`/back the way it was/.test((document.querySelector(".dialog") || {}).textContent || "")`));
await confirmDialog();
r = await recipe("r1");
t.check("Undo changes puts back the recipe as opened (400 g) and closes", r.items[1].grams === 400 && !(await sheetOpen()), JSON.stringify(r.items.map(i => i.grams)));

t.section("NEW RECIPE: kept as a draft until complete, and survives the app closing");
const countBefore = (await localState(dev)).recipes.length;
await dev.eval(`document.getElementById("lib-add-btn") ? document.getElementById("lib-add-btn").click() : document.querySelector(".lib-add, [data-lib-add]").click()`); await sleep(400);
t.check("the new-recipe sheet opened", await sheetOpen());
await typeInto("#rs-name", "Risotto");
await typeInto("#rs-ing-search", "banana");
await typeInto("#rs-ing-weight", "120");
await dev.eval(`document.getElementById("rs-ing-add").click()`); await sleep(900);
t.check("not in the library yet: no final weight", (await localState(dev)).recipes.length === countBefore);
t.check("the line says it is kept as a draft and what's missing", /draft.*final weight/i.test(await status()), await status());
t.check("the draft is on the device", await dev.eval(`(() => { const d = JSON.parse(localStorage.getItem("insulinBuddy.recipeDraft.new") || "null"); return !!d && d.form.name === "Risotto" && d.items.length === 1 && d.items[0].grams === 120; })()`));
// The app is closed and reopened (iOS does this to a backgrounded home-screen app).
await dev.go("index.html", 1800);
await openRecipes();
await dev.eval(`document.getElementById("lib-add-btn") ? document.getElementById("lib-add-btn").click() : document.querySelector(".lib-add, [data-lib-add]").click()`); await sleep(500);
t.check("after reopening, + brings the unfinished recipe back", (await dev.eval(`document.getElementById("rs-name").value`)) === "Risotto" && (await dev.eval(`document.querySelectorAll("#rs-ing-list .ingredient-row").length`)) === 1);
t.check("it says it picked up where you left off", /left off|draft/i.test(await status()), await status());
await typeInto("#rs-final-weight", "300");
await sleep(900);
let lib = (await localState(dev)).recipes;
const risotto = lib.find(x => x.name === "Risotto");
t.check("with a final weight it is saved to the library on its own", lib.length === countBefore + 1 && risotto && risotto.finalWeight === 300 && risotto.items[0].grams === 120, JSON.stringify(risotto));
t.check("the draft is gone once saved", await dev.eval(`localStorage.getItem("insulinBuddy.recipeDraft.new") === null`));
await setGrams(0, "150"); await sleep(900);
t.check("further changes update the same recipe (no duplicate)", (await localState(dev)).recipes.filter(x => x.name === "Risotto").length === 1 && (await localState(dev)).recipes.find(x => x.name === "Risotto").items[0].grams === 150);
await dev.eval(`document.getElementById("rs-save").click()`); await sleep(400);
t.check("Done closes with 'Saved \"Risotto\"'", !(await sheetOpen()) && /Saved "Risotto"/.test(await dev.eval(`document.getElementById("undo-toast-message").textContent`)));
t.check("it shows in the Recipes list", await dev.eval(`[...document.querySelectorAll(".lib-item__name")].some(e => e.textContent === "Risotto")`));

t.section("NEW RECIPE: Discard throws it away");
await dev.eval(`document.getElementById("lib-add-btn") ? document.getElementById("lib-add-btn").click() : document.querySelector(".lib-add, [data-lib-add]").click()`); await sleep(400);
await typeInto("#rs-name", "Throwaway"); await sleep(900);
await dev.eval(`document.getElementById("rs-cancel").click()`); await sleep(300);
await confirmDialog();
t.check("Discard closes and leaves no draft", !(await sheetOpen()) && await dev.eval(`localStorage.getItem("insulinBuddy.recipeDraft.new") === null`));
t.check("an untouched new sheet closes quietly and saves nothing", await (async () => {
  const n = (await localState(dev)).recipes.length;
  await dev.eval(`document.getElementById("lib-add-btn") ? document.getElementById("lib-add-btn").click() : document.querySelector(".lib-add, [data-lib-add]").click()`); await sleep(300);
  await dev.eval(`document.getElementById("rs-close").click()`); await sleep(300);
  return !(await sheetOpen()) && (await localState(dev)).recipes.length === n;
})());

const ok = t.summary();
dev.close(); await app.close(); process.exit(ok ? 0 : 1);
