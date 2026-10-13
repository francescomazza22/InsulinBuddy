// Settings > Data > Fill missing food details: fills blanks only, marks estimates, can be undone.
import { startApp, openDevice, makeChecker, seedLocal } from "./harness.js";
import { FOODS_JS, localState, stateBlob } from "./helpers.js";

const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const app = await startApp(DIR, null, { "foods_data.js": FOODS_JS });
const F = (id, name, over = {}) => ({ id, name, category: "grains", carbs: 50, kcal: 200, protein: null, fat: null, salt: null, gi: null, notes: "", favorite: true, usageCount: 7, ...over });
const library = [F("a", "Croissant"), F("b", "Banana", { gi: 62, salt: 0.5 }), F("c", "Mozzarella", { carbs: 0.7, fat: 31 }), F("d", "My own thing")];
const dev = await openDevice(app, { height: 1000, inject: seedLocal(stateBlob({ library, schemaVersion: 2 })) });
const lib = async () => Object.fromEntries((await localState(dev)).library.map(f => [f.id, f]));

await dev.tab("settings"); await dev.click('[data-seg="data"]'); await sleep(300);
await dev.eval(`document.getElementById("btn-fill-foods").click()`); await sleep(400);
const msg = await dev.text(".dialog");
t.check("it explains what it will do and that these are typical values", /typical values/.test(msg) && /Nothing you already entered is changed/.test(msg), msg.slice(0, 200));
await dev.eval(`[...document.querySelectorAll(".dialog__btn")].find(b => /Fill them in/.test(b.textContent)).click()`); await sleep(500);
let L = await lib();
t.check("Croissant got its published GI of 67 and is marked as estimated", L.a.gi === 67 && L.a.estimated.includes("gi"), JSON.stringify(L.a));
t.check("Banana kept its own GI and salt (nothing overwritten)", L.b.gi === 62 && L.b.salt === 0.5 && !(L.b.estimated || []).includes("gi"), JSON.stringify(L.b));
t.check("Banana's blank fat/protein weren't invented (not in the table)", L.b.fat == null && L.b.protein == null);
t.check("Mozzarella got protein and salt but kept its own fat, and no GI (almost no carbs)", L.c.fat === 31 && L.c.protein === 18 && L.c.gi == null, JSON.stringify(L.c));
t.check("an unknown food is untouched", L.d.gi == null && !L.d.estimated);
t.check("favourites and usage counts were not disturbed", L.a.favorite === true && L.a.usageCount === 7);
t.check("an Undo bar offers to take it back", /Filled \d+ blanks/.test(await dev.text("#undo-toast-message")));

await dev.tab("library"); await sleep(300);
t.check("the library shows GI ~67 for the estimate", /GI ~67/.test(await dev.text("#lib-foods-list")));
await dev.tab("settings"); await sleep(200);
await dev.click("#undo-toast-btn"); await sleep(400);
L = await lib();
t.check("Undo restores every food exactly", L.a.gi == null && !L.a.estimated && L.c.protein == null);

await dev.click('[data-seg="data"]'); await dev.eval(`document.getElementById("btn-fill-foods").click()`); await sleep(300);
await dev.eval(`[...document.querySelectorAll(".dialog__btn")].find(b => /Fill them in/.test(b.textContent)).click()`); await sleep(400);
await dev.eval(`document.getElementById("btn-fill-foods").click()`); await sleep(400);
t.check("running it again says there is nothing left to fill", /Nothing to fill/.test(await dev.text(".dialog")), await dev.text(".dialog"));
await dev.eval(`document.querySelector(".dialog__btn").click()`); await sleep(200);

t.section("EDITING an estimate makes it yours");
await dev.tab("library"); await sleep(300);
await dev.eval(`document.querySelector('[data-act="edit"][data-id="a"]').click()`); await sleep(400);
const hasHint = /Filled from typical values/.test(await dev.text(".sheet"));
t.check("the edit sheet says which values were estimated", hasHint, (await dev.text(".sheet")).slice(0, 100));
await dev.eval(`(() => { const i = document.getElementById("fs-gi"); i.value = "60"; })()`);
await dev.eval(`document.getElementById("fs-save").click()`); await sleep(400);
L = await lib();
t.check("after changing the GI by hand it is no longer marked estimated", L.a.gi === 60 && !(L.a.estimated || []).includes("gi"), JSON.stringify(L.a));
t.check("no JS errors", (await dev.eval("window.__errs.length")) === 0 && dev.errors.length === 0, JSON.stringify(await dev.eval("window.__errs")));
dev.close(); await app.close();
process.exit(t.summary() ? 0 : 1);
