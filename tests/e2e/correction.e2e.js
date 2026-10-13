// Typing a dose by hand (a manual correction, or an Eating Out dose) must always work, whatever the decimal separator,
// must say so when what was typed can't be read, and must survive the page being reloaded behind the person's back.
import { startApp, openDevice, makeChecker, seedLocal } from "./harness.js";
import { FOODS_JS, stateBlob, localState } from "./helpers.js";

const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const app = await startApp(DIR, null, { "foods_data.js": FOODS_JS, "manifest.json": "{}" });
const noErrors = async (dev, label) => t.check(`${label}: no JS errors`, (await dev.eval("window.__errs.length")) === 0 && dev.errors.length === 0, JSON.stringify(await dev.eval("window.__errs")));

async function fresh(name) {
  t.section(name);
  // Seed only when storage is empty, so a reload keeps what was saved before it.
  const dev = await openDevice(app, { width: 390, height: 844, mobile: true, inject: `if (!localStorage.getItem("insulinBuddy.v2")) { ${seedLocal(stateBlob({}))} }`, wait: 1500 });
  await dev.waitFor(`document.getElementById("cc-food-list").children.length > 0`);
  return dev;
}
// Real key events into the focused field, like a person typing (a synthetic "input" event can't show a browser swallowing a key).
async function typeReal(dev, text) { for (const ch of text) { await dev.cdp.send("Input.dispatchKeyEvent", { type: "keyDown", text: ch, key: ch, unmodifiedText: ch }); await dev.cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: ch }); await sleep(30); } await sleep(200); }
const clear = (dev, id) => dev.eval(`(() => { const e = document.getElementById("${id}"); e.focus(); e.value = ""; e.dispatchEvent(new Event("input", { bubbles: true })); })()`);
const view = (dev, errId) => dev.eval(`(() => ({ log: !document.getElementById("cc-log-btn").disabled, dose: document.querySelector("#cc-dose-number, .dose-card__number").textContent, msg: !document.getElementById("${errId}").hidden }))()`);
const manual = async dev => { await dev.click("#cc-correction-toggle"); await sleep(200); await dev.click("#cc-correction-manual-link"); await sleep(250); };
const MANUAL = "cc-correction-manual-input", MERR = "cc-correction-manual-error";

{
  const dev = await fresh("MANUAL CORRECTION: what you type is what you get, with a decimal point or a decimal comma");
  await manual(dev);
  t.check("it is a text box with the decimal keypad (not a browser number box that can swallow or reject a comma)", await dev.eval(`(() => { const i = document.getElementById("${MANUAL}"); return i.type === "text" && i.getAttribute("inputmode") === "decimal"; })()`));
  for (const [typed, dose] of [["2", "2.0"], ["1.5", "1.5"], ["0.5", "0.5"], ["10", "10.0"], ["1,5", "1.5"], ["0,5", "0.5"], [".5", "0.5"], [",5", "0.5"]]) {
    await clear(dev, MANUAL); await typeReal(dev, typed); const v = await view(dev, MERR);
    t.check(`typed "${typed}": the dose is ${dose}u and the Log button is ready`, v.dose === dose && v.log && !v.msg, JSON.stringify(v));
  }
  t.check('"1,5" is 1.5 units and NEVER 15 (a browser number box swallowed the comma)', (await (async () => { await clear(dev, MANUAL); await typeReal(dev, "1,5"); return (await view(dev, MERR)).dose; })()) === "1.5");
  await noErrors(dev, "manual correction"); dev.close();
}

{
  const dev = await fresh("WHAT CAN'T BE READ: the Log button is never greyed out without saying why");
  await manual(dev);
  await typeReal(dev, "abc"); let v = await view(dev, MERR);
  t.check('"abc": Log is off AND a message says the number cannot be read', !v.log && v.msg && v.dose === "0.0", JSON.stringify(v));
  t.check("the field is marked invalid for screen readers", (await dev.eval(`document.getElementById("${MANUAL}").getAttribute("aria-invalid")`)) === "true");
  await clear(dev, MANUAL); await typeReal(dev, "1.2.3"); v = await view(dev, MERR);
  t.check('"1.2.3": the same, never half-understood as 1.2', !v.log && v.msg && v.dose === "0.0", JSON.stringify(v));
  await clear(dev, MANUAL); v = await view(dev, MERR);
  t.check("emptied: the message goes away (nothing is wrong, just nothing to log yet)", !v.log && !v.msg, JSON.stringify(v));
  await typeReal(dev, "0"); v = await view(dev, MERR);
  t.check('"0": no scolding, Log simply stays off (0 units is nothing to log)', !v.log && !v.msg, JSON.stringify(v));
  await clear(dev, MANUAL); await typeReal(dev, ","); v = await view(dev, MERR);
  t.check("a lone comma (someone part-way through typing) isn't flagged", !v.msg, JSON.stringify(v));
  await typeReal(dev, "5"); v = await view(dev, MERR);
  t.check('...and finishing it, ",5", reads as 0.5u', v.dose === "0.5" && v.log && !v.msg, JSON.stringify(v));
  await clear(dev, MANUAL); await typeReal(dev, "abc"); await clear(dev, MANUAL); await typeReal(dev, "2"); v = await view(dev, MERR);
  t.check("correcting a mistake recovers fully: message gone, Log ready, 2.0u", v.log && !v.msg && v.dose === "2.0", JSON.stringify(v));
  t.check("and the field is no longer marked invalid", (await dev.eval(`document.getElementById("${MANUAL}").getAttribute("aria-invalid")`)) === "false");
  await noErrors(dev, "unreadable"); dev.close();
}

{
  const dev = await fresh("WHY IS LOG OFF: the button explains itself");
  const why = () => dev.eval(`(() => { const e = document.getElementById("cc-log-why"); return e.hidden ? "" : e.textContent; })()`);
  await manual(dev);
  t.check("manual, nothing typed: says to type the dose", /Type the correction dose/.test(await why()));
  await typeReal(dev, "0");
  t.check('manual, "0": says 0 units has nothing to log', /0 units has nothing to log/.test(await why()));
  await clear(dev, MANUAL); await typeReal(dev, "1");
  t.check("manual, 1: Log ready and no explanation", (await why()) === "" && (await view(dev, MERR)).log);
  await dev.click("#cc-correction-manual-link");
  await dev.click("#cc-correction-auto-link"); await sleep(250);
  await dev.eval(`(() => { const e = document.getElementById("cc-glucose"); e.focus(); e.value = "90"; e.dispatchEvent(new Event("input", { bubbles: true })); })()`); await sleep(250);
  t.check("automatic, glucose below target: explains no correction is needed", /No correction is needed at 90/.test(await why()), await why());
  await noErrors(dev, "why"); dev.close();
}

{
  const dev = await fresh("SHOWING THE WORKING: the card says how the correction was worked out");
  await dev.click("#cc-correction-toggle"); await sleep(200);
  await dev.eval(`(() => { const e = document.getElementById("cc-glucose"); e.focus(); e.value = "217"; e.dispatchEvent(new Event("input", { bubbles: true })); })()`); await sleep(250);
  const w = () => dev.eval(`(() => { const e = document.getElementById("cc-correction-working"); return e.hidden ? "" : e.textContent; })()`);
  t.check("217 with target 100 and 50 per unit: the sum is shown and agrees with the dose", /217 \u2212 100 target\) \u00f7 50 mg\/dL per unit = 2.3u, rounded to 2.5u/.test(await w()) && (await view(dev, MERR)).dose === "2.5", await w());
  await dev.eval(`(() => { const e = document.getElementById("cc-glucose"); e.value = "90"; e.dispatchEvent(new Event("input", { bubbles: true })); })()`); await sleep(250);
  t.check("below target it says no correction is needed", /at or below your 100 mg\/dL target/.test(await w()), await w());
  await manual(dev);
  t.check("in manual mode the working is hidden (the dose was typed, not worked out)", (await w()) === "");
  await noErrors(dev, "working"); dev.close();
}

{
  const dev = await fresh("LOGGING IT: a manual correction on its own is saved as a correction, with the comma read correctly");
  await manual(dev); await typeReal(dev, "1,5");
  await dev.click("#cc-log-btn"); await sleep(500);
  const h = (await localState(dev)).history;
  t.check("one entry was saved, with a 1.5u correction and no meal dose", h.length === 1 && h[0].correctionDose === 1.5 && h[0].mealDose === 0, JSON.stringify(h.map(e => [e.mealDose, e.correctionDose])));
  t.check("the calculator is clear again: panel closed, dose 0.0, Log off, nothing saved as a draft", await dev.eval(`document.getElementById("cc-correction-row").hidden && !document.getElementById("cc-correction-toggle").classList.contains("is-active") && document.getElementById("cc-dose-number").textContent === "0.0" && document.getElementById("cc-log-btn").disabled && localStorage.getItem("insulinBuddy.draft") === null`));
  await dev.click("#cc-correction-toggle"); await sleep(250); await dev.click("#cc-correction-manual-link"); await sleep(250);
  t.check("opening Correction again starts fresh: the manual box is empty, so last time's 1.5 can't carry into a new dose", await dev.eval(`document.getElementById("${MANUAL}").value === ""`) && (await view(dev, MERR)).dose === "0.0");
  await noErrors(dev, "logging"); dev.close();
}

{
  const dev = await fresh("RELOADED BEHIND YOUR BACK (iOS does this when you switch apps): the entry is still there and Log still works");
  await manual(dev); await typeReal(dev, "2");
  await dev.go("index.html", 1200); await dev.waitFor(`document.getElementById("cc-food-list").children.length > 0`);
  let v = await view(dev, MERR);
  t.check("after the reload the correction panel is open with 2 in it", await dev.eval(`!document.getElementById("cc-correction-row").hidden && document.getElementById("${MANUAL}").value === "2"`));
  t.check("the dose is 2.0u and Log is ready (before, it was empty and greyed out)", v.dose === "2.0" && v.log, JSON.stringify(v));
  await dev.click("#cc-log-btn"); await sleep(500);
  t.check("and pressing it logs the 2u correction", (await localState(dev)).history.some(e => e.correctionDose === 2 && e.mealDose === 0));
  await noErrors(dev, "reload (manual)"); dev.close();
}

{
  const dev = await fresh("RELOADED: a glucose reading typed for an automatic correction is kept too");
  await dev.click("#cc-correction-toggle"); await sleep(200);
  await dev.eval(`(() => { const e = document.getElementById("cc-glucose"); e.focus(); e.value = "200"; e.dispatchEvent(new Event("input", { bubbles: true })); })()`); await sleep(250);
  const before = await view(dev, MERR);
  await dev.go("index.html", 1200); await dev.waitFor(`document.getElementById("cc-food-list").children.length > 0`);
  const after = await view(dev, MERR);
  t.check("the glucose reading and the correction panel are back, with the same dose and Log ready", after.dose === before.dose && after.log && await dev.eval(`!document.getElementById("cc-correction-row").hidden && document.getElementById("cc-glucose").value === "200"`), JSON.stringify({ before, after }));
  await noErrors(dev, "reload (glucose)"); dev.close();
}

{
  const dev = await fresh("RELOADED: an empty correction panel (nothing typed) is NOT brought back, so nothing stale appears");
  await dev.click("#cc-correction-toggle"); await sleep(250);
  await dev.go("index.html", 1200); await dev.waitFor(`document.getElementById("cc-food-list").children.length > 0`);
  t.check("the calculator starts clean", await dev.eval(`document.getElementById("cc-correction-row").hidden && !document.getElementById("cc-correction-toggle").classList.contains("is-active")`));
  await noErrors(dev, "reload (empty)"); dev.close();
}

{
  const dev = await fresh("EATING OUT: the same typed-dose rules apply to its insulin dose");
  await dev.click("#cc-eating-out-toggle"); await sleep(250);
  t.check("it is a text box with the decimal keypad too", await dev.eval(`(() => { const i = document.getElementById("cc-eating-out-dose"); return i.type === "text" && i.getAttribute("inputmode") === "decimal"; })()`));
  await clear(dev, "cc-eating-out-dose"); await typeReal(dev, "1,5"); let v = await view(dev, "cc-eating-out-error");
  t.check('typed "1,5": 1.5u, Log ready', v.dose === "1.5" && v.log && !v.msg, JSON.stringify(v));
  await clear(dev, "cc-eating-out-dose"); await typeReal(dev, "abc"); v = await view(dev, "cc-eating-out-error");
  t.check('typed "abc": Log is off and a message says why', !v.log && v.msg, JSON.stringify(v));
  await noErrors(dev, "eating out"); dev.close();
}

{
  const dev = await fresh("WITH FOOD: a manual correction typed with a comma adds to the meal dose correctly");
  await dev.eval(`document.getElementById("cc-food-list").children[0].click()`);
  await dev.eval(`(() => { const g = document.getElementById("cc-grams"); g.value = "100"; g.dispatchEvent(new Event("input", { bubbles: true })); })()`); await dev.click("#cc-add-btn"); await sleep(250);
  const mealOnly = parseFloat((await view(dev, MERR)).dose);
  await manual(dev); await typeReal(dev, "1,5");
  const v = await view(dev, MERR);
  t.check("the dose is the meal's plus exactly 1.5u", Math.abs(parseFloat(v.dose) - (mealOnly + 1.5)) < 0.06 && v.log, JSON.stringify({ mealOnly, v }));
  await noErrors(dev, "with food"); dev.close();
}

await app.close();
process.exit(t.summary() ? 0 : 1);
