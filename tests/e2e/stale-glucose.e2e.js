// 2.105.2 (found in the debug sweep of 16 Nov): the Calculator's draft survives closing the app, and so did the glucose in the
// Correction box, with no time on it. Reopened hours later, the old reading still drove the correction dose. A glucose more
// than 30 minutes old (or of unknown age, from an older draft) is now cleared, with a note; a recent one is kept.
import { startApp, openDevice, makeChecker, seedLocal } from "./harness.js";
import { FOODS_JS, stateBlob } from "./helpers.js";
const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const app = await startApp(DIR, null, { "foods_data.js": FOODS_JS, "manifest.json": "{}" });
const settings = { units: "mgdl", isf: 50, target: 100, rounding: "0.5", maxDose: 15 };
async function reopenWith(draft) {
  const dev = await openDevice(app, { width: 390, height: 844, mobile: true, inject: seedLocal(stateBlob({ settings })) + `localStorage.setItem("insulinBuddy.draft", ${JSON.stringify(JSON.stringify(draft))});`, wait: 1800 });
  await dev.tab("calculator"); await sleep(400);
  return dev;
}
const view = dev => dev.eval(`({ glucose: document.getElementById("cc-glucose").value, dose: document.getElementById("cc-dose-number").textContent, note: document.getElementById("cc-fetch-glucose-status").hidden ? "" : document.getElementById("cc-fetch-glucose-status").textContent, corr: document.getElementById("cc-correction-toggle").classList.contains("is-active") })`);
const base = { items: [], correctionOn: true, correctionManual: false, noInsulinOn: false, eatingOutOn: false, glucose: "250", glucoseUnit: "mgdl", manualRatioId: null };

t.section("A CORRECTION DRAFT WITH 250 mg/dL TYPED 3 HOURS AGO, REOPENED NOW");
let dev = await reopenWith({ ...base, glucoseAt: Date.now() - 3 * 3600000 });
let v = await view(dev);
t.check("the old glucose is cleared, so no correction is worked out from it", v.glucose === "" && v.dose === "0.0", JSON.stringify(v));
t.check("a note says why, and what to do", /was cleared: it was more than 30 minutes old/.test(v.note), v.note);
t.check("Correction itself stays on (only the reading went)", v.corr, JSON.stringify(v));
t.check("the saved draft no longer holds it", (await dev.eval(`JSON.parse(localStorage.getItem("insulinBuddy.draft")).glucose`)) === "");
t.check("no JS errors", (await dev.eval("window.__errs.length")) === 0, JSON.stringify(await dev.eval("window.__errs")));
dev.close();

t.section("THE SAME FROM A DRAFT SAVED BEFORE 2.105.2 (NO TIME)");
dev = await reopenWith(base);
v = await view(dev);
t.check("a glucose of unknown age is cleared too", v.glucose === "" && v.dose === "0.0" && /typed earlier was cleared/.test(v.note), JSON.stringify(v));
dev.close();

t.section("TYPED 5 MINUTES AGO");
dev = await reopenWith({ ...base, glucoseAt: Date.now() - 5 * 60000 });
v = await view(dev);
t.check("kept, and the correction is worked out from it (250 → 100 at 50 per unit = 3.0 u)", v.glucose === "250" && v.dose === "3.0" && v.note === "", JSON.stringify(v));
t.check("no JS errors", (await dev.eval("window.__errs.length")) === 0, JSON.stringify(await dev.eval("window.__errs")));
dev.close();
await app.close();
process.exit(t.summary() ? 0 : 1);
