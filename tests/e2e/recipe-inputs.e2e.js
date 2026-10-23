// The recipe editor's inputs: decimal commas are read as decimals everywhere (87,5 is 87.5, never 875), a typed food name
// can be added without tapping the suggestion, the suggestion list closes when you leave the search, and what is saved
// matches what was typed.
import { startApp, openDevice, makeChecker, seedLocal } from "./harness.js";
import { FOODS_JS, stateBlob, localState } from "./helpers.js";

const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const app = await startApp(DIR, null, { "foods_data.js": FOODS_JS, "manifest.json": "{}" });
const blob = stateBlob();
blob.library.push({ id: "f-zuc", name: "Zucchero", category: "other", carbs: 100, kcal: 400 }, { id: "f-far", name: "Farina", category: "grains", carbs: 72, kcal: 350 });
blob.recipes = [{ id: "r1", name: "Banana Bread", category: "snacks", notes: "", favorite: false, usageCount: 0, rawWeight: null, finalWeight: 614,
  items: [{ foodId: "f-zuc", name: "Zucchero", grams: 87, carbsPer100g: 100 }, { foodId: "s2", name: "Banana", grams: 300, carbsPer100g: 23 }] }];
const dev = await openDevice(app, { width: 390, height: 844, mobile: true, inject: `if (!localStorage.getItem("insulinBuddy.v2")) { ${seedLocal(blob)} }`, wait: 1600 });
await dev.cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
await dev.tab("library"); await dev.eval(`document.querySelector("[data-seg=recipes]").click()`); await sleep(300);
await dev.eval(`document.querySelector("[data-act=edit][data-id=r1]").click()`); await sleep(600);
const typeInto = async (sel, text) => { await dev.eval(`(() => { const i = document.querySelector(${JSON.stringify(sel)}); i.focus(); i.value = ""; })()`); await dev.cdp.send("Input.insertText", { text }); await sleep(120); };
const total = () => dev.eval(`(document.querySelector(".ingredient-total__row strong") || {}).textContent || ""`);

t.section("RECIPE INPUTS: decimal commas");
await typeInto(".ingredient-row__input", "87,5");
t.check("an ingredient's 87,5 g counts as 87.5 (the total is 387.5 g, not 1175 g)", (await total()) === "387.5 g", await total());
await typeInto("#rs-final-weight", "614,5");
t.check("the Final Weight box keeps 614,5 as typed", (await dev.eval(`document.getElementById("rs-final-weight").value`)) === "614,5");
t.check("every amount box asks for the number keyboard", await dev.eval(`["#rs-ing-weight", "#rs-raw-weight", "#rs-final-weight", ".ingredient-row__input"].every(s => document.querySelector(s).inputMode === "decimal")`));

t.section("RECIPE INPUTS: a gram box stays put while you type in it");
// The iPhone draws these boxes a few px wider than Chrome; use that width so the clear-X size limit is crossed as on the phone.
await dev.eval(`(() => { const st = document.createElement("style"); st.id = "phone-width"; st.textContent = ".ingredient-row__input { width: 80px !important; }"; document.head.appendChild(st); })()`); await sleep(100);
const rowBox = () => dev.eval(`(() => { const i = document.querySelectorAll(".ingredient-row__input")[1], r = i.getBoundingClientRect(); return { left: Math.round(r.left), width: Math.round(r.width), x: !!document.querySelector(".field-clear"), fits: i.scrollWidth <= i.clientWidth, value: i.value }; })()`);
const b0 = await rowBox();
await dev.eval(`document.querySelectorAll(".ingredient-row__input")[1].focus()`); await sleep(200);
const b1 = await rowBox();
t.check("focusing an ingredient's grams doesn't move or resize the box, and adds no second X beside the row's remove button", b0.left === b1.left && b0.width === b1.width && !b1.x, JSON.stringify({ b0, b1 }));
t.check("a three-digit amount (300) is shown whole while editing", b1.value === "300" && b1.fits, JSON.stringify(b1));
await dev.eval(`document.getElementById("phone-width").remove(); document.activeElement.blur()`); await sleep(100);

t.section("RECIPE INPUTS: adding an ingredient");
await typeInto("#rs-ing-search", "farina");
t.check("typing shows suggestions", await dev.eval(`!document.getElementById("rs-ing-dropdown").hidden`));
await dev.eval(`document.getElementById("rs-name").focus()`); await sleep(100);
t.check("leaving the search closes the suggestions", await dev.eval(`document.getElementById("rs-ing-dropdown").hidden`));
await typeInto("#rs-ing-weight", "88,5");
await dev.eval(`document.getElementById("rs-ing-add").click()`); await sleep(200);
t.check("a typed name (any case) is added with + without tapping the suggestion", (await dev.eval(`[...document.querySelectorAll(".ingredient-row__name")].map(e => e.textContent).join("|")`)).includes("Farina"));
t.check("its 88,5 g is added as 88.5 (total 476 g)", (await total()) === "476 g", await total());
t.check("the boxes are cleared and the cursor is back in the search, ready for the next one", await dev.eval(`document.getElementById("rs-ing-search").value === "" && document.getElementById("rs-ing-weight").value === "" && document.activeElement.id === "rs-ing-search"`));
await typeInto("#rs-ing-search", "Nonexistent");
await typeInto("#rs-ing-weight", "10");
await dev.eval(`document.getElementById("rs-ing-add").click()`); await sleep(200);
t.check("an unknown name says why it can't be added instead of silently doing nothing", await dev.eval(`(() => { const h = document.getElementById("rs-ing-hint"); return !h.hidden && /pick one from the list/.test(h.textContent); })()`));
await typeInto("#rs-ing-search", "zucchero");
await dev.eval(`document.getElementById("rs-ing-search").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))`); await sleep(150);
t.check("Enter in the search picks the food and moves to Grams", await dev.eval(`document.getElementById("rs-ing-search").value === "Zucchero" && document.activeElement.id === "rs-ing-weight"`));
await dev.eval(`(() => { document.getElementById("rs-ing-search").value = ""; document.getElementById("rs-ing-search").dispatchEvent(new Event("input", { bubbles: true })); })()`);

t.section("RECIPE INPUTS: what is saved");
await dev.click("#rs-save"); await sleep(500);
const r = (await localState(dev)).recipes.find(x => x.id === "r1");
t.check("saved: Zucchero 87.5 g, Banana 300 g, Farina 88.5 g", JSON.stringify(r.items.map(i => [i.name, i.grams])) === JSON.stringify([["Zucchero", 87.5], ["Banana", 300], ["Farina", 88.5]]), JSON.stringify(r.items.map(i => [i.name, i.grams])));
t.check("saved final weight is 614.5 g, not 6145", r.finalWeight === 614.5, String(r.finalWeight));
t.section("FOOD INPUTS: decimal commas too");
await dev.eval(`document.querySelector("[data-seg=foods]").click()`); await sleep(300);
await dev.eval(`document.querySelector('[data-act="edit"][data-id="f-far"]').click()`); await sleep(500);
await typeInto("#fs-carbs", "12,5");
await typeInto("#fs-kcal", "350,5");
await dev.click("#fs-save"); await sleep(500);
const far = (await localState(dev)).library.find(x => x.id === "f-far");
t.check("a food's carbs typed as 12,5 save as 12.5 per 100 g (not 125)", far.carbs === 12.5 && far.kcal === 350.5, JSON.stringify([far.carbs, far.kcal]));
await dev.eval(`document.querySelector('[data-act="edit"][data-id="f-far"]').click()`); await sleep(500);
await typeInto("#fs-fat", "abc");
await dev.click("#fs-save"); await sleep(300);
t.check("an unreadable amount is refused with a message, not saved as zero", await dev.eval(`/Fat: that isn't a number/.test((document.querySelector(".dialog") || {}).textContent || "")`));
await dev.eval(`(() => { const b = document.querySelector(".dialog__btn--primary, .dialog__btn"); b && b.click(); })()`); await sleep(200);
t.check("no JS errors", (await dev.eval("window.__errs.length")) === 0, JSON.stringify(await dev.eval("window.__errs")));
dev.close(); await app.close();
process.exit(t.summary() ? 0 : 1);
