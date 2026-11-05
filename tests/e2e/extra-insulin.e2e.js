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
t.check("the line under the dose shows it apart", (await txt("#cc-dose-breakdown")) === `Meal ${base} u + 1 u extra`, await txt("#cc-dose-breakdown"));
t.check("the mode chip is lit (its words stay Meal)", (await txt("#cc-mode-label")) === "Meal" && await dev.eval(`document.getElementById("cc-mode-btn").classList.contains("is-on")`));
t.check("the Log button says the total", (await txt("#cc-log-btn")).startsWith(`Log ${(base + 1).toFixed(1)} u`), await txt("#cc-log-btn"));
await dev.click('#cc-extra-row [data-extra-step="1"]'); await sleep(100);
t.check("+ steps up by the rounding step (0.5 u)", (await dev.eval(`document.getElementById("cc-extra-dose").value`)) === "1.5" && Math.abs((await dose()) - (base + 1.5)) < 1e-9);
for (let i = 0; i < 4; i++) await dev.click('#cc-extra-row [data-extra-step="-1"]');
await sleep(100);
t.check("− goes below nothing and takes insulin off (−0.5)", (await dev.eval(`document.getElementById("cc-extra-dose").value`)) === "-0.5" && Math.abs((await dose()) - (base - 0.5)) < 1e-9, `${await dev.eval(`document.getElementById("cc-extra-dose").value`)} ${await dose()}`);
await typeExtra("0,5");
t.check("a decimal comma reads as 0.5", Math.abs((await dose()) - (base + 0.5)) < 1e-9, String(await dose()));
await typeExtra("abc");
t.check("junk is flagged, and adds nothing", (await vis("#cc-extra-error")) && (await dose()) === base);
await typeExtra("1");
if (SHOTS) await dev.shot(`${SHOTS}/extra-insulin-card-${W}${dark ? "-dark" : ""}.png`);

t.section("CALCULATOR: survives the app closing, then logs with the extra marked");
await dev.go("index.html", 1800);
await dev.tab("calculator"); await sleep(400);
t.check("after a reload the extra is still on and still 1 u", (await dev.eval(`document.getElementById("cc-extra-dose").value`)) === "1" && Math.abs((await dose()) - (base + 1)) < 1e-9 && await dev.eval(`document.getElementById("cc-mode-btn").classList.contains("is-on")`));
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

t.section("CALCULATOR: − and + beside the dose number (2.85.0)");
await dev.tab("calculator"); await sleep(300);
t.check("no food: no − / + (nothing to change)", !(await vis("#cc-dose-adjust")));
await addFood(0, 100);
const b2 = await dose();
t.check("with a dose, − and + sit beside the number", await vis("#cc-dose-minus") && await vis("#cc-dose-plus"));
const geo = await dev.eval(`(() => { const r = id => document.getElementById(id).getBoundingClientRect(); const v = document.querySelector(".dose-card__value").getBoundingClientRect(), p = document.querySelector(".dose-card__pills").getBoundingClientRect(), m = r("cc-dose-minus"), q = r("cc-dose-plus"); const overlap = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom; return { between: m.left >= v.right - 1 && q.right <= p.left + 1 && Math.abs((m.top + m.bottom) / 2 - (v.top + v.bottom) / 2) < 40, below: m.top >= v.bottom - 2, clear: !overlap(m, v) && !overlap(q, v) && !overlap(m, p) && !overlap(q, p), w: Math.round(m.width) }; })()`);
t.check("they sit between the number and the chips (or under the number when there's no room), never on top of either, 40px", (geo.between || geo.below) && geo.clear && geo.w >= 40, JSON.stringify(geo));
if (W >= 390) t.check("at phone width and up they are on the number's row", geo.between, JSON.stringify(geo));
await dev.click("#cc-dose-plus"); await sleep(150);
t.check("+ adds 0.5 u", Math.abs((await dose()) - (b2 + 0.5)) < 1e-9, `${b2} -> ${await dose()}`);
t.check("the mode row stays closed (the card doesn't jump)", !(await vis("#cc-mode-controls")) && !(await vis("#cc-extra-row")));
t.check("the chip lights up, and − / + stay on the number's row", await dev.eval(`document.getElementById("cc-mode-btn").classList.contains("is-on")`) && (W < 390 || !(await dev.eval(`document.querySelector(".dose-card__value-row").classList.contains("is-adjust-below")`))));
await dev.click("#cc-dose-minus"); await sleep(100);
t.check("− back to the calculated dose: nothing adjusted any more", (await dose()) === b2 && !(await dev.eval(`document.getElementById("cc-mode-btn").classList.contains("is-on")`)) && (await dev.eval(`document.getElementById("cc-dose-breakdown").hidden`)));
await dev.click("#cc-dose-minus"); await sleep(100);
t.check("− again takes 0.5 u off", Math.abs((await dose()) - (b2 - 0.5)) < 1e-9 && (await txt("#cc-dose-breakdown")) === `Meal ${b2} u \u2212 0.5 u less`, `${await dose()} ${await txt("#cc-dose-breakdown")}`);
if (SHOTS) await dev.shot(`${SHOTS}/dose-adjust-${W}${dark ? "-dark" : ""}.png`);
for (let i = 0; i < 40; i++) { if (await dev.eval(`document.getElementById("cc-dose-minus").disabled`)) break; await dev.click("#cc-dose-minus"); }
await sleep(100);
t.check("− stops at 0 u and is then disabled", (await dose()) === 0 && await dev.eval(`document.getElementById("cc-dose-minus").disabled`), String(await dose()));
await dev.click("#cc-dose-plus"); await sleep(100);
t.check("+ from there gives back 0.5 u", (await dose()) === 0.5, String(await dose()));
await dev.click("#cc-log-btn"); await sleep(500);
e = (await localState(dev)).history[0];
t.check("logged: the meal dose stays as calculated, the amount taken off is in the correction", Math.abs(e.mealDose - b2) < 1e-9 && Math.abs(e.correctionDose - (0.5 - b2)) < 1e-9 && Math.abs(e.extraDose - (0.5 - b2)) < 1e-9, JSON.stringify({ m: e.mealDose, c: e.correctionDose, x: e.extraDose }));
t.check("after logging, − / + are gone and nothing is adjusted", !(await vis("#cc-dose-adjust")) && !(await dev.eval(`document.getElementById("cc-mode-btn").classList.contains("is-on")`)));

t.section("CALCULATOR: not with Treating a low or Eating out");
await dev.tab("calculator"); await sleep(300);
await addFood(1, 100);
await dev.click("#cc-mode-btn"); await sleep(150);
await dev.click("#cc-extra-toggle"); await typeExtra("1"); await sleep(100);
await dev.click("#cc-no-insulin-toggle"); await sleep(150);
t.check("Treating a low switches Adjust off, no insulin and no − / +", !(await vis("#cc-extra-row")) && (await dose()) === 0 && !(await vis("#cc-dose-adjust")));
await dev.click("#cc-extra-toggle"); await sleep(150);
t.check("Extra switches Treating a low off again", !(await dev.eval(`document.getElementById("cc-no-insulin-toggle").classList.contains("is-active")`)) && await vis("#cc-extra-row"));
await dev.click("#cc-eating-out-toggle"); await sleep(150);
t.check("Eating out switches Extra off", !(await vis("#cc-extra-row")) && !(await dev.eval(`document.getElementById("cc-extra-toggle").classList.contains("is-active")`)));

const ok = t.summary();
dev.close(); await app.close(); process.exit(ok ? 0 : 1);
