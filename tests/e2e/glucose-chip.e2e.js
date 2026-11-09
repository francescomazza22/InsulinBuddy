// The Calculator follows the live glucose. 2.99.1: a fresh low switches Treating a low ON by itself (carbs only, no
// insulin); 2.97.0 only offered it, and the amber offer read as "on" while insulin was being worked out (his 9 Nov
// screenshot: 64 mg/dL, 250 g banana, 5.0 u). Switched off by hand it stays off until a reading of 70 or more.
// A fresh high is still only offered ("+ Correction"; one tap turns it on and fills the glucose box, read only).
// A stale reading does nothing, and a mode already chosen is never overridden.
// GC_WIDTH (default 390), GC_DARK=1, SHOTS=<dir>.
import { createBackend, startApp, openDevice, fakeSupabaseSource, makeChecker } from "./harness.js";
import { FOODS_JS, stateBlob } from "./helpers.js";

const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SHOTS = process.env.SHOTS || "";
const W = Number(process.env.GC_WIDTH || 390), dark = process.env.GC_DARK === "1";

// Nightscout is the test backend's stand-in (reached through the proxy function): it holds the one reading below.

async function boot(mgdl, ageMin = 1) {
  const be = createBackend();
  const app = await startApp(DIR, be, { "foods_data.js": FOODS_JS, "manifest.json": "{}" });
  be.ns.entries = [{ sgv: mgdl, date: Date.now() - ageMin * 60000, direction: "Flat", type: "sgv" }];
  be.row = { user_id: "user-1", data: stateBlob({ settings: { units: "mgdl", darkMode: dark, darkModeAuto: false, nightscoutUrl: "https://demo.ns.example.com/?token=tok-abcdef-123456" } }), updated_at: be.stamp() };
  const dev = await openDevice(app, { width: W, height: 900, mobile: W < 1000, dark, wait: 2000,
    // only on the first load: a reload keeps whatever reading the test (or the app) put there since
    inject: fakeSupabaseSource({ userId: "user-1" }) + `if (!sessionStorage.getItem("gc-seeded")) { sessionStorage.setItem("gc-seeded", "1"); localStorage.setItem("insulinBuddy.liveGlucose", JSON.stringify({ mgdl: ${mgdl}, direction: "Flat", at: Date.now() - ${ageMin} * 60000 })); }` });
  await dev.tab("calculator"); await sleep(400);
  return { app, dev, be };
}
const chip = dev => dev.eval(`(() => { const c = document.getElementById("cc-mode-btn"), ctl = document.getElementById("cc-mode-controls");
  return { label: document.getElementById("cc-mode-label").textContent.trim(), low: c.classList.contains("is-suggest-low"), high: c.classList.contains("is-suggest-high"),
    on: c.classList.contains("is-on"), open: !ctl.hidden, aria: c.getAttribute("aria-label"),
    amber: c.classList.contains("is-low"), hint: document.getElementById("cc-low-hint").hidden ? "" : document.getElementById("cc-low-hint").textContent.trim(),
    log: document.getElementById("cc-log-btn").textContent.trim(),
    lowOn: document.getElementById("cc-no-insulin-toggle").classList.contains("is-active"), corrOn: document.getElementById("cc-correction-toggle").classList.contains("is-active"),
    glucose: document.getElementById("cc-glucose").value, dose: document.getElementById("cc-dose-number").textContent }; })()`);

const addFood = async (dev, name, grams) => {
  await dev.waitFor(`document.getElementById("cc-food-list").children.length > 0`, 6000);
  await dev.eval(`[...document.getElementById("cc-food-list").children].find(c => c.textContent.includes(${JSON.stringify(name)})).click()`);
  await dev.eval(`(() => { const g = document.getElementById("cc-grams"); g.value = "${grams}"; g.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await dev.click("#cc-add-btn"); await sleep(300);
};

t.section(`LOW (64 mg/dL): HIS 9 NOV CASE (${W}px${dark ? ", dark" : ""})`);
let { app, dev, be } = await boot(64);
let c = await chip(dev);
t.check("Treating a low is ON by itself: chip amber, row open, quick add ready", c.lowOn && c.on && c.amber && c.label === "Treating a low" && c.open && (await dev.eval(`!document.getElementById("quick-carb-row").hidden`)), JSON.stringify(c));
t.check("the note says so: carbs only, no insulin", /Treating a low is on: carbs only, no insulin/.test(c.hint), c.hint);
await addFood(dev, "Banana", 250);
c = await chip(dev);
t.check("250 g banana: no insulin (0.0 u), logs as a treated low", c.dose === "0.0" && c.log === "Log treated low · 57.5g carbs", JSON.stringify(c));
if (SHOTS) { await dev.eval(`scrollTo(0, 0)`); await sleep(200); await dev.shot(`${SHOTS}/chip-low-${W}${dark ? "-dark" : ""}.png`); }
await dev.click("#cc-log-btn"); await sleep(600);
const logged = await dev.eval(`JSON.parse(localStorage.getItem("insulinBuddy.v2")).history[0]`);
t.check("logged with no insulin", logged && logged.noInsulin === true && !(logged.mealDose > 0) && !(logged.correctionDose > 0), JSON.stringify(logged && { noInsulin: logged.noInsulin, mealDose: logged.mealDose, correctionDose: logged.correctionDose }));
c = await chip(dev);
t.check("still low: the next entry starts as Treating a low too", c.lowOn && c.amber, JSON.stringify(c));

t.section("SWITCHED OFF BY HAND, IT STAYS OFF FOR THIS LOW");
await dev.click("#cc-no-insulin-toggle"); await sleep(300);
await addFood(dev, "Banana", 250);
c = await chip(dev);
t.check("off by hand: insulin is worked out, and the note says so", !c.lowOn && !c.amber && Number(c.dose) > 0 && /Treating a low is off, so the dose above includes insulin/.test(c.hint), JSON.stringify(c));
await dev.click("#cc-clear-all-btn"); await sleep(300);
c = await chip(dev);
t.check("Clear All doesn't switch it back on during the same low", !c.lowOn, JSON.stringify(c));
await dev.go("index.html", 2000); await dev.tab("calculator"); await sleep(400);
c = await chip(dev);
t.check("…nor reopening the app", !c.lowOn, JSON.stringify(c));
// The low ends (a reading of 70 or more), then a new low starts.
be.ns.entries = [{ sgv: 110, date: Date.now() - 30000, direction: "Flat", type: "sgv" }];
await dev.eval(`localStorage.setItem("insulinBuddy.liveGlucose", JSON.stringify({ mgdl: 110, direction: "Flat", at: Date.now() - 30000 }))`);
await dev.go("index.html", 2000); await dev.tab("calculator"); await sleep(400);
be.ns.entries = [{ sgv: 60, date: Date.now() - 20000, direction: "Flat", type: "sgv" }];
await dev.eval(`localStorage.setItem("insulinBuddy.liveGlucose", JSON.stringify({ mgdl: 60, direction: "Flat", at: Date.now() - 20000 }))`);
await dev.go("index.html", 2000); await dev.tab("calculator"); await sleep(400);
c = await chip(dev);
t.check("after a reading in range, the next low switches it on again", c.lowOn && c.amber, JSON.stringify(c));
t.check("no JS errors", (await dev.eval("window.__errs.length")) === 0, JSON.stringify(await dev.eval("window.__errs")));
dev.close(); await app.close();

t.section("HIGH (250 mg/dL)");
({ app, dev, be } = await boot(250));
c = await chip(dev);
t.check("the chip offers '+ Correction' (an outline, not a lit mode); nothing is on", c.label === "+ Correction" && c.high && !c.on && !c.corrOn && !c.amber, JSON.stringify(c));
if (SHOTS) { await dev.eval(`scrollTo(0, 0)`); await sleep(200); await dev.shot(`${SHOTS}/chip-high-${W}${dark ? "-dark" : ""}.png`); }
await dev.click("#cc-mode-btn"); await sleep(900);
c = await chip(dev);
t.check("one tap: Correction is on, its row open", c.corrOn && c.open && c.label === "Correction", JSON.stringify(c));
t.check("…the glucose box is filled from Nightscout (250) and a correction dose shows", c.glucose === "250" && Number(c.dose) > 0, JSON.stringify(c));
t.check("nothing was sent to Nightscout (only reads)", be.ns.treatments.length === 0 && be.log.filter(l => l.kind === "ns" && l.action !== "read").length === 0, JSON.stringify(be.log.filter(l => l.kind === "ns").map(l => l.action)));
// Food added with Correction already on: the chip says what is on and no longer offers anything.
await dev.waitFor(`document.getElementById("cc-food-list").children.length > 0`, 6000);
await dev.eval(`document.getElementById("cc-food-list").children[0].click()`);
await dev.eval(`(() => { const g = document.getElementById("cc-grams"); g.value = "50"; g.dispatchEvent(new Event("input", { bubbles: true })); })()`);
await dev.click("#cc-add-btn"); await sleep(300);
c = await chip(dev);
t.check("with food: 'Meal + correction', nothing offered", c.label === "Meal + correction" && !c.high && !c.low, JSON.stringify(c));
t.check("no JS errors", (await dev.eval("window.__errs.length")) === 0, JSON.stringify(await dev.eval("window.__errs")));
dev.close(); await app.close();

t.section("A MODE ALREADY CHOSEN IS LEFT ALONE");
({ app, dev, be } = await boot(250));
await dev.eval(`document.getElementById("cc-mode-btn").classList.contains("is-suggest-high")`);
// Open the menu by hand is not possible while it offers; turn on Eating out from the row after the offer is taken and dropped.
await dev.click("#cc-mode-btn"); await sleep(600);           // Correction on
await dev.click("#cc-correction-toggle"); await sleep(200);  // and off again: the row stays open
c = await chip(dev);
t.check("with the row open by hand, the chip is the plain menu again (Meal, chevron)", c.label === "Meal" && !c.high && c.open, JSON.stringify(c));
await dev.click("#cc-eating-out-toggle"); await sleep(200);
c = await chip(dev);
t.check("Eating out chosen: the chip says so, no offer", c.label === "Eating out" && !c.high && !c.corrOn, JSON.stringify(c));
dev.close(); await app.close();

t.section("IN RANGE OR OLD READINGS DO NOTHING");
({ app, dev, be } = await boot(120));
c = await chip(dev);
t.check("120 mg/dL: plain 'Meal'", c.label === "Meal" && !c.low && !c.high, JSON.stringify(c));
dev.close(); await app.close();
({ app, dev, be } = await boot(55, 40));
c = await chip(dev);
t.check("a low from 40 minutes ago: plain 'Meal', nothing switched on", c.label === "Meal" && !c.lowOn, JSON.stringify(c));
dev.close(); await app.close();

// 2.98.1, found on his phone: sign-in finishing after the 4 s start-up fallback redraws the Calculator from the saved draft,
// which dropped a Treating a low with no carbs yet while its button still looked on, so 15 g of fast carbs came out as
// "Log 1.0 u · 15g carbs". The sign-in here is slowed past the fallback.
t.section("A LATE SIGN-IN DOESN'T UNDO TREATING A LOW");
{
  const be2 = createBackend();
  const app2 = await startApp(DIR, be2, { "foods_data.js": FOODS_JS, "manifest.json": "{}" });
  be2.ns.entries = [{ sgv: 58, date: Date.now() - 60000, direction: "Flat", type: "sgv" }];
  const blob = stateBlob({ settings: { units: "mgdl", darkMode: dark, darkModeAuto: false, nightscoutUrl: "https://demo.ns.example.com/?token=tok-abcdef-123456" } });
  be2.row = { user_id: "user-1", data: blob, updated_at: be2.stamp() };
  const d2 = await openDevice(app2, { width: W, height: 900, mobile: W < 1000, dark, wait: 500,
    inject: fakeSupabaseSource({ userId: "user-1", delayMs: 6000 }) + `localStorage.setItem("insulinBuddy.v2", ${JSON.stringify(JSON.stringify(blob))}); localStorage.setItem("insulinBuddy.liveGlucose", JSON.stringify({ mgdl: 58, direction: "Flat", at: Date.now() - 60000 }));` });
  await d2.waitFor(`document.getElementById("loading-screen").hidden`, 12000);
  c = await chip(d2);
  t.check("the app opens (start-up fallback) with Treating a low on", c.lowOn && c.amber, JSON.stringify(c));
  await sleep(14000);   // the slowed sign-in lands and the Calculator is redrawn from the saved draft
  c = await chip(d2);
  t.check("after the late sign-in Treating a low is still on (button and draft agree)", c.lowOn && c.label === "Treating a low" && c.log === "Add the carbs you had", JSON.stringify(c));
  await d2.eval(`document.querySelector('#quick-carb-row [data-grams="15"]').click()`); await sleep(300);
  t.check("15 g of fast carbs logs as a treated low, with no insulin", (await d2.eval(`document.getElementById("cc-log-btn").textContent`)) === "Log treated low · 15g carbs" && (await d2.eval(`document.getElementById("cc-dose-number").textContent`)) === "0.0");
  t.check("no JS errors", (await d2.eval("window.__errs.length")) === 0, JSON.stringify(await d2.eval("window.__errs")));
  d2.close(); await app2.close();
}

process.exit(t.summary() ? 0 : 1);
