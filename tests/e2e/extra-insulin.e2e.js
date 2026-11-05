// Extra insulin on top of the calculated dose (2.84.0). Francesco: "enable the possibility of adding a discretionary amount
// of insulin to an amount calculated by the calculator". XI_WIDTH (default 390), XI_DARK=1, SHOTS=<dir>.
import { startApp, openDevice, makeChecker, seedLocal } from "./harness.js";
import { FOODS_JS, stateBlob, localState } from "./helpers.js";

const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SHOTS = process.env.SHOTS || "";
const W = Number(process.env.XI_WIDTH || 390), dark = process.env.XI_DARK === "1";
const app = await startApp(DIR, null, { "foods_data.js": FOODS_JS, "manifest.json": "{}" });
const blob = stateBlob({ settings: { darkMode: dark, darkModeAuto: false } });
const dev = await openDevice(app, { width: W, height: 1000, mobile: W < 1000, dark, inject: `if (!localStorage.getItem("insulinBuddy.v2")) { ${seedLocal(blob)} }`, wait: 1500 });
await dev.tab("calculator"); await sleep(300);
await dev.waitFor(`document.getElementById("cc-food-list").children.length > 1`, 6000);

const vis = sel => dev.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; })()`);
const txt = sel => dev.eval(`((document.querySelector(${JSON.stringify(sel)}) || {}).textContent || "").replace(/\\s+/g, " ").trim()`);
const dose = async () => Number(await txt("#cc-dose-number"));
const typeExtra = v => dev.eval(`(() => { const i = document.getElementById("cc-extra-dose"); i.value = ${JSON.stringify(v)}; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
async function addFood(idx, grams) {
  await dev.eval(`document.getElementById("cc-food-list").children[${idx}].click()`); await sleep(150);
  await dev.eval(`(() => { const g = document.getElementById("cc-grams"); g.value = "${grams}"; g.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await dev.click("#cc-add-btn"); await sleep(200);
}

t.section("CALCULATOR: Extra sits with the other modes and starts off");
await addFood(0, 100);
const base = await dose();
t.check("a meal gives a calculated dose first", base > 0, String(base));
await dev.click("#cc-mode-btn"); await sleep(200);
t.check("the mode row has an Extra button", await vis("#cc-extra-toggle"));
t.check("the extra row is closed until Extra is tapped", !(await vis("#cc-extra-row")));
await dev.click("#cc-extra-toggle"); await sleep(200);
t.check("tapping Extra opens the extra row and focuses its box", (await vis("#cc-extra-row")) && (await dev.eval(`document.activeElement.id`)) === "cc-extra-dose");
t.check("nothing typed yet: the dose is unchanged", (await dose()) === base);

t.section("CALCULATOR: the extra is added on top");
await typeExtra("1");
t.check("1 u extra adds exactly 1 u", Math.abs((await dose()) - (base + 1)) < 1e-9, `${base} -> ${await dose()}`);
t.check("the line under the dose shows it apart", (await txt("#cc-dose-breakdown")) === `Meal ${base} u + extra 1 u`, await txt("#cc-dose-breakdown"));
t.check("the mode chip says Meal + extra and is lit", (await txt("#cc-mode-label")) === "Meal + extra" && await dev.eval(`document.getElementById("cc-mode-btn").classList.contains("is-on")`));
t.check("the Log button says the total", (await txt("#cc-log-btn")).startsWith(`Log ${(base + 1).toFixed(1)} u`), await txt("#cc-log-btn"));
await dev.click('[data-extra-step="1"]'); await sleep(100);
t.check("+ steps up by the rounding step (0.5 u)", (await dev.eval(`document.getElementById("cc-extra-dose").value`)) === "1.5" && Math.abs((await dose()) - (base + 1.5)) < 1e-9);
await dev.click('[data-extra-step="-1"]'); await dev.click('[data-extra-step="-1"]'); await dev.click('[data-extra-step="-1"]'); await dev.click('[data-extra-step="-1"]'); await sleep(100);
t.check("− never goes below nothing", (await dev.eval(`document.getElementById("cc-extra-dose").value`)) === "" && (await dose()) === base);
await typeExtra("0,5");
t.check("a decimal comma reads as 0.5", Math.abs((await dose()) - (base + 0.5)) < 1e-9, String(await dose()));
await typeExtra("abc");
t.check("junk is flagged, and adds nothing", (await vis("#cc-extra-error")) && (await dose()) === base);
await typeExtra("1");
if (SHOTS) await dev.shot(`${SHOTS}/extra-insulin-card-${W}${dark ? "-dark" : ""}.png`);

t.section("CALCULATOR: survives the app closing, then logs with the extra marked");
await dev.go("index.html", 1800);
await dev.tab("calculator"); await sleep(400);
t.check("after a reload the extra is still on and still 1 u", (await vis("#cc-extra-row")) && (await dev.eval(`document.getElementById("cc-extra-dose").value`)) === "1" && Math.abs((await dose()) - (base + 1)) < 1e-9);
await dev.click("#cc-log-btn"); await sleep(500);
let st = await localState(dev); let e = st.history[0];
t.check("saved: mealDose includes the extra, extraDose says how much", Math.abs(e.mealDose - (base + 1)) < 1e-9 && e.extraDose === 1 && e.correctionDose === 0, JSON.stringify({ m: e.mealDose, c: e.correctionDose, x: e.extraDose }));
t.check("the calculator is clear for the next meal: Extra off and empty", !(await vis("#cc-extra-row")) && (await dev.eval(`document.getElementById("cc-extra-dose").value`)) === "" && !(await dev.eval(`document.getElementById("cc-extra-toggle").classList.contains("is-active")`)));

t.section("LOG: the badge shows the extra; Edit meal keeps and changes it");
await dev.tab("history"); await sleep(500);
const badge = await dev.eval(`[...document.querySelectorAll(".history-entry")].map(r => r.textContent.replace(/\\s+/g, " ")).find(s => /extra/.test(s)) || ""`);
t.check("the log row says '+ 1 extra'", /\+ 1 extra/.test(badge), badge.slice(0, 160));
await dev.eval(`document.querySelector('[data-edit="${e.id}"]').click()`); await sleep(500);
t.check("Edit meal shows the extra (1)", (await dev.eval(`document.getElementById("em-extra-dose").value`)) === "1" && await vis("#em-extra-field"));
t.check("the preview says the total including the extra", /including 1\.0 units extra/.test(await txt("#em-preview")), await txt("#em-preview"));
await dev.eval(`(() => { const i = document.getElementById("em-extra-dose"); i.value = "2"; i.dispatchEvent(new Event("input", { bubbles: true })); })()`); await sleep(100);
await dev.click("#em-save"); await sleep(500);
st = await localState(dev); e = st.history[0];
t.check("changing it to 2 changes only the extra", Math.abs(e.mealDose - (base + 2)) < 1e-9 && e.extraDose === 2, JSON.stringify({ m: e.mealDose, x: e.extraDose }));
await dev.eval(`document.querySelector('[data-edit="${e.id}"]').click()`); await sleep(500);
await dev.click("#em-save"); await sleep(500);
e = (await localState(dev)).history[0];
t.check("re-saving unchanged keeps the same dose (never added twice)", Math.abs(e.mealDose - (base + 2)) < 1e-9 && e.extraDose === 2, JSON.stringify({ m: e.mealDose, x: e.extraDose }));
await dev.eval(`document.querySelector('[data-edit="${e.id}"]').click()`); await sleep(500);
await dev.eval(`(() => { const i = document.getElementById("em-extra-dose"); i.value = ""; i.dispatchEvent(new Event("input", { bubbles: true })); })()`); await sleep(100);
await dev.click("#em-save"); await sleep(500);
e = (await localState(dev)).history[0];
t.check("emptying it takes the extra off", Math.abs(e.mealDose - base) < 1e-9 && !("extraDose" in e), JSON.stringify({ m: e.mealDose, x: e.extraDose }));

t.section("CALCULATOR: not with Treating a low or Eating out");
await dev.tab("calculator"); await sleep(300);
await addFood(1, 100);
await dev.click("#cc-mode-btn"); await sleep(150);
await dev.click("#cc-extra-toggle"); await typeExtra("1"); await sleep(100);
await dev.click("#cc-no-insulin-toggle"); await sleep(150);
t.check("Treating a low switches Extra off: no insulin", !(await vis("#cc-extra-row")) && (await dose()) === 0);
await dev.click("#cc-extra-toggle"); await sleep(150);
t.check("Extra switches Treating a low off again", !(await dev.eval(`document.getElementById("cc-no-insulin-toggle").classList.contains("is-active")`)) && await vis("#cc-extra-row"));
await dev.click("#cc-eating-out-toggle"); await sleep(150);
t.check("Eating out switches Extra off", !(await vis("#cc-extra-row")) && !(await dev.eval(`document.getElementById("cc-extra-toggle").classList.contains("is-active")`)));

const ok = t.summary();
dev.close(); await app.close(); process.exit(ok ? 0 : 1);
