// A meal and a correction in one dose: a high reading adds to it, a low reading can take units off it (when the setting is on),
// and a typed correction can go either way. What is shown is what is logged, edited, and kept across a reload.
import { startApp, openDevice, makeChecker, seedLocal } from "./harness.js";
import { FOODS_JS, stateBlob, localState } from "./helpers.js";

const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const app = await startApp(DIR, null, { "foods_data.js": FOODS_JS, "manifest.json": "{}" });
const setVal = (dev, id, v) => dev.eval(`(() => { const e = document.getElementById("${id}"); e.focus(); e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event("input", { bubbles: true })); })()`);
const dose = dev => dev.eval(`parseFloat(document.getElementById("cc-dose-number").textContent)`);
const breakdown = dev => dev.eval(`(() => { const e = document.getElementById("cc-dose-breakdown"); return e.hidden ? "" : e.textContent.replace(/\\s+/g, " "); })()`);

async function open(settings) {
  const dev = await openDevice(app, { width: 390, height: 844, mobile: true, inject: `if (!localStorage.getItem("insulinBuddy.v2")) { ${seedLocal(stateBlob({ settings }))} }`, wait: 1500 });
  await dev.waitFor(`document.getElementById("cc-food-list").children.length > 0`);
  await dev.eval(`document.getElementById("cc-food-list").children[0].click()`);
  await setVal(dev, "cc-grams", "100");
  await dev.click("#cc-add-btn"); await sleep(200);
  return dev;
}

{
  t.section("HIGH READING ADDS TO THE MEAL; A LOW ONE TAKES OFF (setting on)");
  const dev = await open({ reduceBelowTarget: true, maxDose: 40, iobAwareCorrection: false });
  const meal = await dose(dev);
  await dev.click("#cc-correction-toggle"); await sleep(200);
  await setVal(dev, "cc-glucose", "300"); await sleep(250);
  const high = await dose(dev);
  t.check("300 mg/dL adds (300-100)/50 = 4 u to the meal", Math.abs(high - (meal + 4)) < 0.26, `${meal} -> ${high}`);
  t.check("the card shows the split", /Meal .* \+ correction/.test(await breakdown(dev)), await breakdown(dev));
  await setVal(dev, "cc-glucose", "55"); await sleep(250);
  const low = await dose(dev);
  t.check("55 mg/dL takes ~0.9 u off", low < meal && Math.abs(low - (meal - 0.9)) < 0.3, `${meal} -> ${low}`);
  t.check("the card says units were taken off", /taken off/.test(await breakdown(dev)), await breakdown(dev));
  await dev.click("#cc-log-btn"); await sleep(300);
  const h = (await localState(dev)).history[0];
  t.check("the saved parts sum to the dose shown", h.correctionDose < 0 && Math.abs(h.mealDose + h.correctionDose - low) < 0.01, JSON.stringify([h.mealDose, h.correctionDose, low]));
  t.check("no JS errors", (await dev.eval("window.__errs.length")) === 0 && dev.errors.length === 0);
  dev.close();
}

{
  t.section("SETTING OFF: a low reading changes nothing");
  const dev = await open({ maxDose: 40, iobAwareCorrection: false });
  const meal = await dose(dev);
  await dev.click("#cc-correction-toggle"); await sleep(200);
  await setVal(dev, "cc-glucose", "55"); await sleep(250);
  t.check("same dose as the meal alone", (await dose(dev)) === meal);
  dev.close();
}

{
  t.section("TYPED CORRECTION: Add and Subtract");
  const dev = await open({ maxDose: 40 });
  const meal = await dose(dev);
  await dev.click("#cc-correction-toggle"); await sleep(200);
  await dev.click("#cc-correction-manual-link"); await sleep(250);
  await setVal(dev, "cc-correction-manual-input", "1"); await sleep(250);
  t.check("typing 1 adds 1 u", Math.abs((await dose(dev)) - (meal + 1)) < 0.01);
  await dev.click('#cc-correction-sign [data-sign="-1"]'); await sleep(250);
  t.check("Subtract takes 1 u off", Math.abs((await dose(dev)) - (meal - 1)) < 0.01, `${meal} -> ${await dose(dev)}`);
  t.check("Subtract is marked pressed", await dev.eval(`document.querySelector('#cc-correction-sign [data-sign="-1"]').getAttribute("aria-pressed") === "true"`));
  await setVal(dev, "cc-correction-manual-input", "500"); await sleep(250);
  t.check("taking off more than the meal never goes below zero", (await dose(dev)) === 0);
  await setVal(dev, "cc-correction-manual-input", "1"); await sleep(250);
  await dev.click("#cc-log-btn"); await sleep(300);
  const h = (await localState(dev)).history[0];
  t.check("logged as -1 correction", h.correctionDose === -1 && Math.abs(h.mealDose - 1 - (meal - 1)) < 0.01, JSON.stringify([h.mealDose, h.correctionDose]));
  t.check("no JS errors", (await dev.eval("window.__errs.length")) === 0 && dev.errors.length === 0);
  dev.close();
}
{
  t.section("TARGET GLUCOSE: the baseline is yours to set");
  const dev = await open({ maxDose: 40, iobAwareCorrection: false });
  const meal = await dose(dev);
  const save = async v => { await setVal(dev, "set-target", v); await dev.eval(`document.getElementById("btn-save-settings").click()`); await sleep(300); };
  const stored = async () => (await localState(dev)).settings.target;
  await save("150");
  t.check("150 is saved as the target", (await stored()) === 150);
  await dev.click("#cc-correction-toggle"); await sleep(200);
  await setVal(dev, "cc-glucose", "300"); await sleep(250);
  t.check("300 mg/dL now adds (300-150)/50 = 3 u", Math.abs((await dose(dev)) - (meal + 3)) < 0.26, `${meal} -> ${await dose(dev)}`);
  await save("");
  t.check("a blank target keeps 150 instead of saving 0", (await stored()) === 150);
  await save("120,5");
  t.check("a decimal comma is read as 120.5", (await stored()) === 120.5, String(await stored()));
  t.check("no JS errors", (await dev.eval("window.__errs.length")) === 0 && dev.errors.length === 0);
  dev.close();
}
await app.close();
process.exit(t.summary() ? 0 : 1);
