// Switching glucose units converts the target and correction factor; a dose far from your own history gets a quiet note;
// and neither costs battery (no timers or repeating work of their own).
import { startApp, openDevice, makeChecker, seedLocal } from "./harness.js";
import { FOODS_JS, stateBlob, meal } from "./helpers.js";

const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const app = await startApp(DIR, null, { "foods_data.js": FOODS_JS, "manifest.json": "{}" });
const setVal = (dev, id, v) => dev.eval(`(() => { const e = document.getElementById("${id}"); e.focus(); e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event("input", { bubbles: true })); })()`);
const spy = `window.__timers = { i: 0, t: 0 }; const __si = window.setInterval.bind(window), __st = window.setTimeout.bind(window); window.setInterval = (...a) => { window.__timers.i++; return __si(...a); }; window.setTimeout = (...a) => { window.__timers.t++; return __st(...a); };`;
const now = Date.now(), DAY = 86400000;
const history = Array.from({ length: 14 }, (_, i) => meal("h" + i, now - (i + 1) * DAY, { totalCarbs: 40, mealDose: 4, correctionDose: 0 }));

async function open(blob) {
  const dev = await openDevice(app, { width: 390, height: 844, mobile: true, inject: spy + `if (!localStorage.getItem("insulinBuddy.v2")) { ${seedLocal(blob)} }`, wait: 1500 });
  await dev.waitFor(`document.getElementById("cc-food-list").children.length > 0`);
  return dev;
}

{
  t.section("UNIT SWITCH converts target and correction factor");
  const dev = await open(stateBlob({ settings: { isf: 50, target: 100 } }));
  const sw = async u => { await dev.eval(`(() => { const s = document.getElementById("set-units"); s.value = "${u}"; s.dispatchEvent(new Event("change", { bubbles: true })); })()`); await sleep(150); };
  const val = id => dev.eval(`document.getElementById("${id}").value`);
  await sw("mmol");
  t.check("100 mg/dL becomes 5.5 and 50 becomes 2.8", (await val("set-target")) === "5.5" && (await val("set-isf")) === "2.8", `${await val("set-target")} ${await val("set-isf")}`);
  t.check("the unit labels follow", (await dev.eval(`document.getElementById("target-unit-label").textContent`)) === "mmol/L");
  t.check("a note says it was converted", /converted/.test(await dev.eval(`document.getElementById("units-convert-note").hidden ? "" : document.getElementById("units-convert-note").textContent`)));
  await sw("mgdl");
  t.check("switching straight back restores exactly 100 and 50", (await val("set-target")) === "100" && (await val("set-isf")) === "50");
  await sw("mmol");
  await dev.eval(`document.getElementById("btn-save-settings").click()`); await sleep(300);
  const s = (await dev.eval(`JSON.parse(localStorage.getItem("insulinBuddy.v2"))`)).settings;
  t.check("saving keeps units mmol with the converted numbers", s.units === "mmol" && s.target === 5.5 && s.isf === 2.8, JSON.stringify([s.units, s.target, s.isf]));
  t.check("no JS errors", (await dev.eval("window.__errs.length")) === 0 && dev.errors.length === 0);
  dev.close();
}

{
  t.section("DOSE NOTE: quiet, never blocking, and free of timers");
  const dev = await open(stateBlob({ history, settings: { maxDose: 40 } }));
  await dev.eval(`document.getElementById("cc-food-list").children[0].click()`);
  await setVal(dev, "cc-grams", "60"); await dev.click("#cc-add-btn"); await sleep(250);
  const note = () => dev.eval(`(() => { const e = document.getElementById("cc-dose-nudge"); return e.hidden ? "" : e.textContent; })()`);
  t.check("a normal-looking dose shows no note", (await note()) === "", await note());
  await dev.click("#cc-correction-toggle"); await sleep(200);
  await dev.click("#cc-correction-manual-link"); await sleep(250);
  await setVal(dev, "cc-correction-manual-input", "9"); await sleep(250);
  t.check("a dose far above any in 90 days gets a note", /bigger than any dose/.test(await note()), await note());
  t.check("Log is still enabled", await dev.eval(`!document.getElementById("cc-log-btn").disabled`));
  const before = await dev.eval(`({ ...window.__timers })`);
  for (const v of ["1", "2", "3", "9", "1"]) { await setVal(dev, "cc-correction-manual-input", v); }
  await sleep(300);
  const after = await dev.eval(`({ ...window.__timers })`);
  t.check("no intervals started by changing the dose", after.i === before.i, JSON.stringify([before, after]));
  t.check("no pile of timers either (at most a couple for saving the draft)", after.t - before.t <= 12, JSON.stringify([before, after]));
  t.check("no JS errors", (await dev.eval("window.__errs.length")) === 0 && dev.errors.length === 0);
  dev.close();
}
await app.close();
process.exit(t.summary() ? 0 : 1);
