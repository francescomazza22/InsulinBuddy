// The mode chip follows the live glucose (2.97.0): a fresh low offers "Treating a low", a fresh high offers "Correction".
// One tap turns that mode on (for a high it also fills the glucose box from Nightscout, read only). Nothing turns on by
// itself, a stale reading offers nothing, and a mode already chosen is never overridden.
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
    inject: fakeSupabaseSource({ userId: "user-1" }) + `localStorage.setItem("insulinBuddy.liveGlucose", JSON.stringify({ mgdl: ${mgdl}, direction: "Flat", at: Date.now() - ${ageMin} * 60000 }));` });
  await dev.tab("calculator"); await sleep(400);
  return { app, dev, be };
}
const chip = dev => dev.eval(`(() => { const c = document.getElementById("cc-mode-btn"), ctl = document.getElementById("cc-mode-controls");
  return { label: document.getElementById("cc-mode-label").textContent.trim(), low: c.classList.contains("is-suggest-low"), high: c.classList.contains("is-suggest-high"),
    on: c.classList.contains("is-on"), open: !ctl.hidden, aria: c.getAttribute("aria-label"),
    lowOn: document.getElementById("cc-no-insulin-toggle").classList.contains("is-active"), corrOn: document.getElementById("cc-correction-toggle").classList.contains("is-active"),
    glucose: document.getElementById("cc-glucose").value, dose: document.getElementById("cc-dose-number").textContent }; })()`);

t.section(`LOW (55 mg/dL) (${W}px${dark ? ", dark" : ""})`);
let { app, dev, be } = await boot(55);
let c = await chip(dev);
t.check("the chip offers Treating a low, in amber", c.label === "Treating a low" && c.low && !c.high, JSON.stringify(c));
t.check("…but nothing is switched on yet, and the dose is untouched", !c.lowOn && !c.corrOn && !c.on && !c.open && c.dose === "0.0", JSON.stringify(c));
t.check("screen readers hear why", /Glucose is low/.test(c.aria), c.aria);
if (SHOTS) { await dev.eval(`scrollTo(0, 0)`); await sleep(200); await dev.shot(`${SHOTS}/chip-low-${W}${dark ? "-dark" : ""}.png`); }
await dev.click("#cc-mode-btn"); await sleep(300);
c = await chip(dev);
t.check("one tap: Treating a low is on and its row is open", c.lowOn && c.open && c.on && c.label === "Treating a low" && !c.low, JSON.stringify(c));
t.check("…with the quick-add carbs ready", await dev.eval(`!document.getElementById("quick-carb-row").hidden`));
await dev.click("#cc-clear-all-btn"); await sleep(300);
c = await chip(dev);
t.check("Clear All: back to offering Treating a low", c.label === "Treating a low" && c.low && !c.lowOn, JSON.stringify(c));
t.check("no JS errors", (await dev.eval("window.__errs.length")) === 0, JSON.stringify(await dev.eval("window.__errs")));
dev.close(); await app.close();

t.section("HIGH (250 mg/dL)");
({ app, dev, be } = await boot(250));
c = await chip(dev);
t.check("the chip offers Correction", c.label === "Correction" && c.high && !c.low && !c.corrOn, JSON.stringify(c));
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

t.section("IN RANGE OR OLD READINGS OFFER NOTHING");
({ app, dev, be } = await boot(120));
c = await chip(dev);
t.check("120 mg/dL: plain 'Meal'", c.label === "Meal" && !c.low && !c.high, JSON.stringify(c));
dev.close(); await app.close();
({ app, dev, be } = await boot(55, 40));
c = await chip(dev);
t.check("a low from 40 minutes ago: plain 'Meal'", c.label === "Meal" && !c.low, JSON.stringify(c));
dev.close(); await app.close();

process.exit(t.summary() ? 0 : 1);
