// 2.77.0: usual morning / evening basal doses, set in Settings > Dosing. The basal sheet starts from them, says when the dose
// entered differs, offers to make a new dose the usual one, and checks big changes against it.
// Env: BU_WIDTH (default 390), BU_DARK=1, SHOTS=<dir>.
import { startApp, openDevice, makeChecker, seedLocal } from "./harness.js";
import { FOODS_JS, stateBlob, localState } from "./helpers.js";

const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const W = Number(process.env.BU_WIDTH || 390), DARK = process.env.BU_DARK === "1", SHOTS = process.env.SHOTS;
const app = await startApp(DIR, null, { "foods_data.js": FOODS_JS, "manifest.json": "{}" });
const now = Date.now();
const slot = new Date(now).getHours() < 14 ? "am" : "pm", name = slot === "am" ? "morning" : "evening", other = slot === "am" ? "pm" : "am";
const basal = (id, ago, units, s) => ({ id, ts: now - ago, entryType: "basal", mealType: "basal", periodName: s === "am" ? "morning" : "evening", basalDose: units, basalSlot: s,
  items: [], totalCarbs: 0, totalKcal: 0, mealDose: 0, correctionDose: 0, noInsulin: false, glucose: null });
const hist = [basal("b0", 86400000, 9, slot), basal("b1", 86400000 - 12 * 3600000, 13, other)];

const dev = await openDevice(app, { width: W, height: 900, mobile: W < 700, dark: DARK, inject: `if (!localStorage.getItem("insulinBuddy.v2")) { ${seedLocal(stateBlob({ history: hist }))} }`, wait: 1500 });
const open = async () => { await dev.tab("history"); await dev.click('[data-seg="log"]'); await sleep(250); await dev.click("#btn-log-basal"); await sleep(500); };
const close = async () => { await dev.click("#basal-cancel"); await sleep(400); };
const units = () => dev.eval(`document.getElementById("basal-units").value`);
const hint = () => dev.text("#basal-hint");
const typeDose = v => dev.eval(`(() => { const i = document.getElementById("basal-units"); i.value = ${JSON.stringify(v)}; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
const setBox = (id, v) => dev.eval(`(() => { const e = document.getElementById(${JSON.stringify(id)}); e.focus(); e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event("input", { bubbles: true })); e.dispatchEvent(new Event("change", { bubbles: true })); e.blur(); })()`);
const usualSaved = async () => (await localState(dev)).settings.basalBaseline;
const goSettings = async () => { await dev.tab("settings"); await dev.click('#settings-segmented [data-seg="ratios"]'); await sleep(250); };

t.section(`NOT SET (${W}px${DARK ? ", dark" : ""}): as before, from the last dose`);
await open();
t.check("prefilled from the last dose", (await units()) === "9", await units());
t.check("hint shows the last dose and where to set a usual one", /Last .* dose: 9u/.test(await hint()) && /Make 9u my usual/.test(await hint()), await hint());
await close();

t.section("SETTINGS: set the usual doses");
await goSettings();
t.check("both boxes empty, says it starts from the last doses", (await dev.eval(`document.getElementById("basal-usual-am").value + "|" + document.getElementById("basal-usual-pm").value`)) === "|" && /Not set yet: .*last doses/.test(await dev.text("#basal-usual-status")), await dev.text("#basal-usual-status"));
await setBox(`basal-usual-${slot}`, "10"); await setBox(`basal-usual-${other}`, "12,5"); await sleep(200);
let b = await usualSaved();
t.check("saved (a decimal comma reads as 12.5)", b[slot] === 10 && b[other] === 12.5, JSON.stringify(b));
t.check("status gives the daily total", /Total 22\.5u a day/.test(await dev.text("#basal-usual-status")), await dev.text("#basal-usual-status"));
await setBox(`basal-usual-${slot}`, "abc"); await sleep(150);
t.check("something that isn't a dose keeps the saved one", (await usualSaved())[slot] === 10 && (await dev.eval(`document.getElementById("basal-usual-${slot}").value`)) === "10");
if (SHOTS) { await dev.eval(`document.getElementById("basal-usual-card").scrollIntoView({ block: "center" })`); await sleep(200); await dev.shot(`${SHOTS}/basal-usual-settings-${W}${DARK ? "-dark" : ""}.png`); }

t.section("BASAL SHEET: starts from the usual dose");
await open();
t.check(`prefilled with the usual ${name} dose (10, not the last 9)`, (await units()) === "10", await units());
t.check("hint names the usual dose and the last one", new RegExp(`Your usual ${name} dose: 10u\\. Last: 9u`).test(await hint()), await hint());
await typeDose("12"); await sleep(150);
t.check("a different dose says how far off it is", /2u more than your usual 10u\./.test(await hint()) && /Make 12u my usual/.test(await hint()), await hint());
if (SHOTS) { await dev.shot(`${SHOTS}/basal-usual-sheet-${W}${DARK ? "-dark" : ""}.png`); }
await typeDose("8.5"); await sleep(150);
t.check("less, with a half unit", /1\.5u less than your usual 10u\./.test(await hint()), await hint());
await typeDose("10"); await sleep(150);
t.check("back to the usual: no warning", !/more|less/.test(await hint()), await hint());
// Switching slot moves to the other usual dose.
await dev.click(`[data-slot="${other}"]`); await sleep(200);
t.check("the other slot starts from its own usual dose", (await units()) === "12.5", await units());
await dev.click(`[data-slot="${slot}"]`); await sleep(200);
// Make a new dose the usual one, from the sheet.
await typeDose("11"); await sleep(100);
await dev.click("#basal-hint [data-usual]"); await sleep(250);
t.check("'Make 11u my usual' saves it", (await usualSaved())[slot] === 11, JSON.stringify(await usualSaved()));
t.check("and the hint now calls it the usual dose", new RegExp(`Your usual ${name} dose: 11u`).test(await hint()), await hint());
// Big jump against the usual one.
await typeDose("25"); await sleep(100);
await dev.click("#basal-save"); await sleep(400);
const dlg = await dev.eval(`(() => { const d = document.querySelector(".dialog-backdrop"); return d ? d.textContent.replace(/\\s+/g, " ") : ""; })()`);
t.check("a big change from the usual dose asks first", /usual dose here is 11u and you entered 25u/.test(dlg), dlg);
await dev.eval(`(() => { const b = [...document.querySelectorAll(".dialog-backdrop button")].find(b => /cancel/i.test(b.textContent)); b && b.click(); })()`); await sleep(300);
await typeDose("11"); await sleep(100);
await dev.click("#basal-save"); await sleep(500);
const saved = (await localState(dev)).history.find(h => h.entryType === "basal" && Date.now() - h.ts < 600000);
t.check("logs the dose", saved && saved.basalDose === 11 && saved.basalSlot === slot, JSON.stringify(saved));

t.section("CLEARING one in Settings goes back to the last dose");
await goSettings();
await setBox(`basal-usual-${slot}`, ""); await sleep(200);
t.check("cleared", (await usualSaved())[slot] === null);
await open();
t.check("starts from the last dose again (11)", (await units()) === "11", await units());
await close();
t.check("no sideways scroll", await dev.eval(`document.documentElement.scrollWidth <= innerWidth + 1`));
t.check("no JS errors", (await dev.eval("window.__errs.length")) === 0, JSON.stringify(await dev.eval("window.__errs")));
dev.close(); await app.close();
process.exit(t.summary() ? 0 : 1);
