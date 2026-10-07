// History + edit sheet, end to end (local-only mode, no cloud).
import { startApp, openDevice, makeChecker, seedLocal } from "./harness.js";
import { FOODS_JS, localState, stateBlob, meal } from "./helpers.js";
import { makeBasalEntry } from "../../js/history.js";

const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const app = await startApp(DIR, null, { "foods_data.js": FOODS_JS });

async function device(state, name) {
  t.section(name);
  return openDevice(app, { height: 1000, inject: seedLocal(state) });
}
const noErrors = async (dev, label) => t.check(`${label}: no JS errors`, (await dev.eval("window.__errs.length")) === 0 && dev.errors.length === 0, JSON.stringify(await dev.eval("window.__errs")) + dev.errors.join("|"));
const rows = dev => dev.eval(`document.querySelectorAll(".history-entry").length`);
const setSearch = async (dev, q) => { await dev.eval(`(() => { const i = document.getElementById("history-search"); i.value = ${JSON.stringify(q)}; i.dispatchEvent(new Event("input", { bubbles: true })); })()`); await sleep(150); };

// ---------------------------------------------------------------------------
{
  // 3,300 meals over ~3 years, three a day (the size that took 1.2 s to draw before paging)
  const now = Date.now(), day = 86400000;
  const history = [];
  for (let d = 0; d < 1100; d++) for (let m = 0; m < 3; m++) {
    const ts = now - d * day - m * 4 * 3600_000;
    history.push(meal(`m${d}-${m}`, ts, { items: [{ refType: "food", refId: m === 1 ? "s2" : "s1", name: m === 1 ? "Banana" : "Pane comune", grams: 100, carbsPer100g: 65, kcalPer100g: 300, gi: 60, carbs: 30, kcal: 100 }] }));
  }
  const dev = await device(stateBlob({ history, schemaVersion: 2 }), "History stays fast at 3,300 meals (paging)");
  const ms = await dev.eval(`(async () => { const t0 = performance.now(); document.querySelector('[data-target="history"]').click(); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); return performance.now() - t0; })()`);
  const n = await rows(dev);
  t.check(`opened in ${Math.round(ms)} ms (was ~1200 ms before paging)`, ms < 400, String(ms));
  t.check("only the newest days are drawn", n >= 60 && n <= 63, String(n));
  const moreText = await dev.text("#history-more");
  t.check("'Show older meals' offers the rest", /Show older meals \(3\d\d\d more\)/.test(moreText), moreText);
  t.check("count pill still shows the true total", /3300 meals/.test(await dev.text("#hist-count-pill")));
  await dev.click("#history-more"); await sleep(150);
  t.check("tapping it draws the next page", (await rows(dev)) >= 120);
  await dev.tab("calculator"); await dev.tab("history");
  t.check("leaving and returning starts at the newest page again", (await rows(dev)) <= 63);

  await setSearch(dev, "banana");
  t.check("search finds the matching meals", (await rows(dev)) >= 60);
  t.check("and shows 'x of total'", /of 3300/.test(await dev.text("#hist-count-pill")), await dev.text("#hist-count-pill"));
  await setSearch(dev, "zzzz-nothing");
  t.check("no matches shows a friendly message", (await rows(dev)) === 0 && (await dev.eval(`!document.getElementById("history-nomatch").hidden`)));
  await setSearch(dev, "");
  t.check("clearing the search restores the list", (await rows(dev)) >= 60 && (await dev.eval(`document.getElementById("history-nomatch").hidden`)));
  await noErrors(dev, "device");
  dev.close();
}

// ---------------------------------------------------------------------------
{
  const now = Date.now();
  const history = [
    meal("normal", now - 1000, {}),
    meal("low", now - 2000, { mealType: "snack", noInsulin: true, mealDose: 0, correctionDose: 0, items: [{ refType: "food", refId: "s2", name: "Juice", grams: 200, carbsPer100g: 10, kcalPer100g: 40, gi: 60, carbs: 20, kcal: 80 }], totalCarbs: 20 }),
    meal("corr", now - 3000, { mealType: "correction", items: [], totalCarbs: 0, mealDose: 0, correctionDose: 3, glucose: 250 })
  ];
  const dev = await device(stateBlob({ history, schemaVersion: 2, settings: { isf: 50, target: 100 } }), "Search understands 'low' and 'correction'");
  await dev.tab("history");
  await setSearch(dev, "low");
  t.check("'low' finds the treating-a-low entry", (await rows(dev)) === 1);
  await setSearch(dev, "correction");
  t.check("'correction' finds the correction-only entry", (await rows(dev)) === 1);
  await setSearch(dev, "");
  await noErrors(dev, "device");
  dev.close();
}

// ---------------------------------------------------------------------------
{
  const evil = `<img src=x onerror="window.__pwn=1">`;
  const history = [meal("xss", Date.now() - 1000, { items: [{ refType: "food", refId: "s1", name: evil, unitLabel: evil, quantity: 2, grams: `<b id="injected">x</b>`, carbsPer100g: 65, kcalPer100g: 300, gi: 75, carbs: 39, kcal: 180 }] })];
  const dev = await device(stateBlob({ history, schemaVersion: 2 }), "REGRESSION: text saved in a meal can't inject markup (unit label, grams, name)");
  await dev.tab("history");
  // Scoped to the history list: an unscoped query can match the "Recently Logged" chip in the
  // Calculator view instead, which also carries a data-id for the same entry.
  await dev.eval(`document.getElementById("history-groups").querySelector('[data-id="xss"]').click()`);
  await sleep(500);
  t.check("no script ran", (await dev.eval(`window.__pwn`)) === undefined);
  t.check("no injected elements exist", (await dev.eval(`!document.querySelector("#history-groups img") && !document.getElementById("injected")`)));
  t.check("the text is shown literally instead", /<img src=x/.test(await dev.eval(`document.getElementById("history-groups").textContent`)));
  await noErrors(dev, "device");
  dev.close();
}

// ---------------------------------------------------------------------------
async function editAndSave(dev, id, time) {
  await dev.tab("history");
  // Scoped to the history list: see the note above the xss test for why this can't be a
  // document-wide query.
  await dev.eval(`document.getElementById("history-groups").querySelector('[data-id="${id}"]').click()`);
  await dev.click(`[data-edit="${id}"]`); await dev.sleep(300);
  await dev.eval(`(() => { const i = document.getElementById("em-logged-time"); i.value = "${time}"; i.dispatchEvent(new Event("change", { bubbles: true })); })()`);
  await dev.click("#em-save"); await dev.sleep(500);
}
{
  const now = Date.now();
  const stale = { value: 999, partial: false };
  const history = [
    meal("normal", now - 1000, { glycemicLoad: stale }),
    meal("low", now - 2000, { mealType: "snack", noInsulin: true, mealDose: 0, correctionDose: 0, totalCarbs: 20, items: [{ refType: "food", refId: "s2", name: "Juice", grams: 200, carbsPer100g: 10, kcalPer100g: 40, gi: 60, carbs: 20, kcal: 80 }] }),
    meal("corr", now - 3000, { mealType: "correction", items: [], totalCarbs: 0, mealDose: 0, correctionDose: 3, glucose: 250 })
  ];
  const dev = await device(stateBlob({ history, schemaVersion: 2, settings: { isf: 50, target: 100, rounding: "0.5" } }), "REGRESSION: edit-sheet bugs");
  await editAndSave(dev, "low", "2026-03-01T10:00");
  let e = (await localState(dev)).history.find(h => h.id === "low");
  t.check("editing a 'treating a low' entry does NOT add insulin", e.mealDose === 0 && e.correctionDose === 0, JSON.stringify([e.mealDose, e.correctionDose]));
  t.check("and the time did change (the save worked)", new Date(e.ts).getFullYear() === 2026 && new Date(e.ts).getMonth() === 2);

  await editAndSave(dev, "corr", "2026-03-02T11:00");
  e = (await localState(dev)).history.find(h => h.id === "corr");
  t.check("a correction-only entry (no foods) can be edited and saved", new Date(e.ts).getDate() === 2 && new Date(e.ts).getMonth() === 2, new Date(e.ts).toISOString());
  t.check("its correction dose is kept (250 mg/dL -> 3 u)", e.correctionDose === 3, String(e.correctionDose));

  await editAndSave(dev, "normal", "2026-03-03T12:00");
  e = (await localState(dev)).history.find(h => h.id === "normal");
  t.check("glycemic load is recomputed on edit instead of staying stale", e.glycemicLoad && e.glycemicLoad.value === 75, JSON.stringify(e.glycemicLoad));
  await noErrors(dev, "device");
  dev.close();
}

// ---------------------------------------------------------------------------
{
  // REGRESSION: a real meal + correction through the actual Calculator UI, at the exact
  // boundary that used to round the raw total differently from the sum of the two displayed
  // parts (45g carbs at 1:14.2857 -> "3u" meal; glucose 209 with isf=70/target=160 -> "0.5u"
  // correction; the two should always sum to what actually gets logged).
  const st = stateBlob({
    schemaVersion: 2,
    settings: { isf: 70, target: 160, units: "mgdl", rounding: "0.5", maxDose: 15, timeRatios: [{ id: "r1", name: "All day", start: "00:00", end: "00:00", ratio: 45 / 3.15 }] },
    library: [{ id: "f1", name: "TestFood", category: "grains", carbs: 45, kcal: 100, protein: null, fat: null, salt: null, gi: 50, notes: "", favorite: false, usageCount: 0 }]
  });
  const dev = await device(st, "REGRESSION: logged total always equals the displayed meal + correction");
  await dev.eval(`document.getElementById("cc-food-list").children[0].click()`);
  await dev.eval(`(() => { const g = document.getElementById("cc-grams"); g.value = "100"; g.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await dev.click("#cc-add-btn"); await sleep(150);
  await dev.click("#cc-correction-toggle");
  await dev.eval(`(() => { const g = document.getElementById("cc-glucose"); g.value = "209"; g.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await sleep(200);
  const shownTotal = parseFloat(await dev.text("#cc-dose-number"));
  t.check("live dose card shows 3.5u (not 4u)", shownTotal === 3.5, String(shownTotal));
  await dev.click("#cc-log-btn"); await sleep(300);
  const entry = (await localState(dev)).history[0];
  t.check("stored meal dose is 3u", entry.mealDose === 3, String(entry.mealDose));
  t.check("stored correction dose is 0.5u", entry.correctionDose === 0.5, String(entry.correctionDose));
  t.check("stored total equals what was shown live before logging", entry.mealDose + entry.correctionDose === shownTotal, `${entry.mealDose}+${entry.correctionDose} vs ${shownTotal}`);
  await noErrors(dev, "device");
  dev.close();
}

// ---------------------------------------------------------------------------
// Manual correction mode
async function addFoodAndOpenCorrection(dev) {
  // device() returns as soon as navigation is requested; under load (many devices opened in
  // this file already) the document can still be mid-navigation for a moment, where even
  // reading localStorage throws a transient SecurityError. Waiting for readyState first avoids
  // racing that window, rather than papering over it with an arbitrary extra sleep.
  // The service worker can trigger a reload shortly after a page first loads (see index.html's
  // controllerchange listener), which makes a raw eval() right at this point transiently throw
  // ("Access is denied") mid-navigation. waitFor already retries through exceptions, so route
  // everything through it here rather than a one-off eval, instead of chasing the timing.
  await dev.waitFor(`document.getElementById("cc-food-list") && document.getElementById("cc-food-list").children.length > 0`);
  await dev.eval(`document.getElementById("cc-food-list").children[0].click()`);
  await dev.eval(`document.getElementById("cc-grams").value = "50"`);
  await dev.click("#cc-add-btn"); await sleep(150);
  await dev.click("#cc-correction-toggle"); await sleep(150);
}

{
  const dev = await device(stateBlob({}), "Manual correction: typing a dose flows into the live total, exactly as typed");
  await addFoodAndOpenCorrection(dev);
  const beforeManual = await dev.eval(`document.getElementById("cc-dose-number").textContent`);
  await dev.click("#cc-correction-manual-link"); await sleep(150);
  t.check("auto glucose input is now hidden", await dev.eval(`document.getElementById("cc-correction-auto-wrap").hidden`));
  t.check("manual input is now shown", !(await dev.eval(`document.getElementById("cc-correction-manual-wrap").hidden`)));
  await dev.eval(`(() => { const i = document.getElementById("cc-correction-manual-input"); i.value = "1.3"; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await sleep(150);
  const mealOnlyDose = parseFloat(await dev.eval(`document.getElementById("cc-dose-number").textContent`)) - 1.3;
  t.check("total includes the manual 1.3u exactly, not rounded to the dose step", Math.abs(parseFloat(await dev.eval(`document.getElementById("cc-dose-number").textContent`)) - (mealOnlyDose + 1.3)) < 0.01, await dev.eval(`document.getElementById("cc-dose-number").textContent`));
  t.check("log button is enabled", !(await dev.eval(`document.getElementById("cc-log-btn").disabled`)));
  await noErrors(dev, "device");
  dev.close();
}

{
  const dev = await device(stateBlob({}), "Manual correction: logging saves the manual dose and no glucose reading, even if one was typed earlier");
  await addFoodAndOpenCorrection(dev);
  await dev.eval(`(() => { const i = document.getElementById("cc-glucose"); i.value = "220"; i.dispatchEvent(new Event("input", { bubbles: true })); })()`); // typed, then abandoned
  await dev.click("#cc-correction-manual-link"); await sleep(150);
  await dev.eval(`(() => { const i = document.getElementById("cc-correction-manual-input"); i.value = "2.25"; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await sleep(150);
  await dev.click("#cc-log-btn"); await sleep(300);
  const entry = (await localState(dev)).history[0];
  t.check("correction dose saved exactly as typed (not rounded)", entry.correctionDose === 2.25, JSON.stringify(entry.correctionDose));
  t.check("no glucose reading was saved, despite one being typed before switching modes", entry.glucose === null, JSON.stringify(entry.glucose));
  await noErrors(dev, "device");
  dev.close();
}

{
  const dev = await device(stateBlob({}), "Manual correction: switching back to automatic mode clears the manual value and hides its input");
  await addFoodAndOpenCorrection(dev);
  await dev.click("#cc-correction-manual-link"); await sleep(150);
  await dev.eval(`(() => { const i = document.getElementById("cc-correction-manual-input"); i.value = "3"; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await dev.click("#cc-correction-auto-link"); await sleep(150);
  t.check("back to the glucose input", !(await dev.eval(`document.getElementById("cc-correction-auto-wrap").hidden`)));
  t.check("manual input hidden again", await dev.eval(`document.getElementById("cc-correction-manual-wrap").hidden`));
  await dev.eval(`(() => { const i = document.getElementById("cc-glucose"); i.value = "180"; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await sleep(150);
  await dev.click("#cc-log-btn"); await sleep(300);
  const entry = (await localState(dev)).history[0];
  t.check("logged using the glucose formula, not a leftover manual value", entry.glucose === 180);
  await noErrors(dev, "device");
  dev.close();
}

{
  const dev = await device(stateBlob({}), "Manual correction: toggling correction off and back on resets to automatic mode (not sticky across meals)");
  await addFoodAndOpenCorrection(dev);
  await dev.click("#cc-correction-manual-link"); await sleep(150);
  await dev.click("#cc-correction-toggle"); await sleep(100); // off
  await dev.click("#cc-correction-toggle"); await sleep(100); // on again
  t.check("starts fresh in automatic mode, not manual", !(await dev.eval(`document.getElementById("cc-correction-auto-wrap").hidden`)));
  t.check("manual input value was cleared", (await dev.eval(`document.getElementById("cc-correction-manual-input").value`)) === "");
  await noErrors(dev, "device");
  dev.close();
}

{
  // A meal logged with a manual correction, then edited afterward, must not silently lose that
  // correction dose -- there's no glucose field to recompute from (entry.glucose is null), so the
  // edit sheet has to fall back to keeping the original dose, both in its live preview and on save.
  const history = [meal("m1", Date.now(), { mealDose: 3, correctionDose: 2.25, glucose: null, items: [{ refType: "food", refId: "f1", name: "Toast", carbsPer100g: 50, kcalPer100g: 250, carbs: 30, kcal: 150, grams: 60 }] })];
  const dev = await device(stateBlob({ history }), "Editing a manually-corrected meal preserves its correction dose");
  await dev.tab("history"); await sleep(200);
  await dev.eval(`document.getElementById("history-groups").querySelector('[data-id="m1"]').click()`);
  await dev.click(`[data-edit="m1"]`); await sleep(200);
  t.check("no glucose field offered (none was ever recorded for this entry)", (await dev.eval(`document.getElementById("em-glucose")`)) === null);
  const preview = await dev.eval(`document.getElementById("em-preview").textContent`);
  t.check("live preview still reflects the original 2.25u correction, not 0", /5\.25|5\.3| 5\.2/.test(preview) || parseFloat(preview.match(/→\s*([\d.]+)/)?.[1] || "0") > 3, preview);
  await dev.click("#em-save"); await sleep(300);
  const saved = (await localState(dev)).history[0];
  t.check("correction dose still 2.25 after saving an unrelated edit", saved.correctionDose === 2.25, JSON.stringify(saved.correctionDose));
  await noErrors(dev, "device");
  dev.close();
}

// ---------------------------------------------------------------------------
// Eating Out mode
{
  const dev = await device(stateBlob({}), "Eating Out: toggling on hides food entry and shows a direct insulin input");
  await dev.waitFor(`document.getElementById("cc-food-list") && document.getElementById("cc-food-list").children.length > 0`);
  t.check("food section starts visible", !(await dev.eval(`document.getElementById("cc-food-section").hidden`)));
  await dev.click("#cc-eating-out-toggle"); await sleep(150);
  t.check("food section now hidden", await dev.eval(`document.getElementById("cc-food-section").hidden`));
  t.check("eating-out dose input shown", !(await dev.eval(`document.getElementById("cc-eating-out-row").hidden`)));
  t.check("carbs pill says carbs aren't being logged", (await dev.text("#cc-carbs-pill")) === "Carbs not logged");
  await dev.eval(`(() => { const i = document.getElementById("cc-eating-out-dose"); i.value = "4.5"; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await sleep(150);
  t.check("live total shows 4.5u exactly", (await dev.text("#cc-dose-number")) === "4.5");
  t.check("log button enabled from the dose alone, with zero carbs", !(await dev.eval(`document.getElementById("cc-log-btn").disabled`)));
  await noErrors(dev, "device");
  dev.close();
}

{
  const dev = await device(stateBlob({}), "Eating Out: logging saves insulin with no items and no carbs, flagged as carbsUnknown");
  await dev.waitFor(`document.getElementById("cc-food-list") && document.getElementById("cc-food-list").children.length > 0`);
  await dev.click("#cc-eating-out-toggle"); await sleep(150);
  await dev.eval(`(() => { const i = document.getElementById("cc-eating-out-dose"); i.value = "3"; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await sleep(150);
  await dev.click("#cc-log-btn"); await sleep(300);
  const entry = (await localState(dev)).history[0];
  t.check("meal dose saved exactly as typed", entry.mealDose === 3, JSON.stringify(entry.mealDose));
  t.check("no items saved", entry.items.length === 0);
  t.check("carbs saved as 0", entry.totalCarbs === 0);
  t.check("flagged as carbsUnknown", entry.carbsUnknown === true);
  await dev.tab("history"); await sleep(200);
  const foodsLine = await dev.text(`[data-id="${entry.id}"] .history-entry__foods`);
  t.check("History shows the eating-out label, not the correction-only one", foodsLine === "Eating out — carbs not logged", foodsLine);
  await noErrors(dev, "device");
  dev.close();
}

{
  const dev = await device(stateBlob({}), "Eating Out: mutually exclusive with Treating a Low, in both directions");
  await dev.waitFor(`document.getElementById("cc-food-list") && document.getElementById("cc-food-list").children.length > 0`);
  await dev.click("#cc-no-insulin-toggle"); await sleep(120);
  await dev.click("#cc-eating-out-toggle"); await sleep(120);
  t.check("turning on Eating Out turns off Treating a Low", !(await dev.eval(`document.getElementById("cc-no-insulin-toggle").classList.contains("is-active")`)));
  t.check("Eating Out is on", await dev.eval(`document.getElementById("cc-eating-out-toggle").classList.contains("is-active")`));
  await dev.click("#cc-no-insulin-toggle"); await sleep(120);
  t.check("turning on Treating a Low turns off Eating Out", !(await dev.eval(`document.getElementById("cc-eating-out-toggle").classList.contains("is-active")`)));
  t.check("food section visible again", !(await dev.eval(`document.getElementById("cc-food-section").hidden`)));
  await noErrors(dev, "device");
  dev.close();
}

{
  const dev = await device(stateBlob({}), "Eating Out: resets cleanly on Clear All, ready for a normal meal again");
  await dev.waitFor(`document.getElementById("cc-food-list") && document.getElementById("cc-food-list").children.length > 0`);
  await dev.click("#cc-eating-out-toggle"); await sleep(120);
  await dev.eval(`(() => { const i = document.getElementById("cc-eating-out-dose"); i.value = "2"; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await sleep(120);
  await dev.click("#cc-clear-all-btn"); await sleep(150);
  t.check("Eating Out pill no longer active", !(await dev.eval(`document.getElementById("cc-eating-out-toggle").classList.contains("is-active")`)));
  t.check("food section visible again", !(await dev.eval(`document.getElementById("cc-food-section").hidden`)));
  t.check("dose input cleared", (await dev.eval(`document.getElementById("cc-eating-out-dose").value`)) === "");
  await noErrors(dev, "device");
  dev.close();
}

// ---------------------------------------------------------------------------
// Glucose guide: the mg/dL <-> mmol/L quick-reference panel opened from the correction row.
async function openGlucoseGuidePanel(dev) {
  await dev.waitFor(`document.getElementById("cc-food-list") && document.getElementById("cc-food-list").children.length > 0`);
  await dev.click("#cc-correction-toggle"); await sleep(150);
  await dev.click("#btn-glucose-guide"); await sleep(250);
}
const guideCells = dev => dev.eval(`Array.from(document.querySelectorAll(".glucose-guide__table tbody tr")).map(tr => [tr.cells[0].textContent, tr.cells[1].textContent, tr.className.match(/--(\\w+)$/)[1]])`);
// Worst text contrast over every row, compositing each tinted cell over the sheet's own background.
const guideWorstContrast = dev => dev.eval(`(() => {
  const parse = c => c.match(/[\\d.]+/g).map(Number);
  const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const sheet = parse(getComputedStyle(document.querySelector(".glucose-guide")).backgroundColor);
  let worst = 99;
  document.querySelectorAll(".glucose-guide__table td").forEach(td => {
    const cs = getComputedStyle(td), bg = parse(cs.backgroundColor), fg = parse(cs.color), a = bg.length === 4 ? bg[3] : 1;
    const eff = [0, 1, 2].map(i => bg[i] * a + sheet[i] * (1 - a)), L1 = lum(fg), L2 = lum(eff);
    worst = Math.min(worst, (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05));
  });
  return worst;
})()`);

{
  const dev = await device(stateBlob({}), "Glucose guide: button lives in the correction row, and opens the full 40-400 range as two side-by-side tables");
  await dev.waitFor(`document.getElementById("cc-food-list") && document.getElementById("cc-food-list").children.length > 0`);
  t.check("button isn't showing until Correction is open", await dev.eval(`document.getElementById("btn-glucose-guide").offsetParent === null`));
  await openGlucoseGuidePanel(dev);
  t.check("it opens as an accessible dialog", await dev.eval(`(() => { const d = document.querySelector(".glucose-guide"); return d.getAttribute("role") === "dialog" && d.getAttribute("aria-modal") === "true" && /Glucose guide/.test(document.getElementById(d.getAttribute("aria-labelledby")).textContent); })()`));
  t.check("two tables sit side by side", (await dev.eval(`document.querySelectorAll(".glucose-guide__table").length`)) === 2);
  t.check("each table is headed mg/dL | mmol/L", JSON.stringify(await dev.eval(`Array.from(document.querySelectorAll(".glucose-guide__table th")).map(th => th.textContent)`)) === JSON.stringify(["mg/dL", "mmol/L", "mg/dL", "mmol/L"]));
  const cells = await guideCells(dev);
  t.check("37 rows in total", cells.length === 37, String(cells.length));
  t.check("mg/dL runs 40 to 400 in steps of 10, in order across both tables", JSON.stringify(cells.map(c => +c[0])) === JSON.stringify(Array.from({ length: 37 }, (_, i) => 40 + i * 10)));
  const mmol = mg => cells.find(c => +c[0] === mg)[1];
  t.check("conversions are right at the points that matter (40, 70, 100, 180, 400)", [mmol(40), mmol(70), mmol(100), mmol(180), mmol(400)].join(" ") === "2.2 3.9 5.5 10.0 22.2", [mmol(40), mmol(70), mmol(100), mmol(180), mmol(400)].join(" "));
  const bandOf = mg => cells.find(c => +c[0] === mg)[2];
  t.check("rows are banded like Time in Range (50 very low, 60 low, 70/180 target, 190 high, 260 very high)", [50, 60, 70, 180, 190, 260].map(bandOf).join(",") === "veryLow,low,target,target,high,veryHigh", [50, 60, 70, 180, 190, 260].map(bandOf).join(","));
  const sizes = await dev.eval(`Array.from(document.querySelectorAll(".glucose-guide__table")).map(t => [t.tBodies[0].rows[0].cells[0].textContent, t.tBodies[0].rows[t.tBodies[0].rows.length - 1].cells[0].textContent])`);
  t.check("it's split 40-220 | 230-400, so it all fits on one screen", JSON.stringify(sizes) === JSON.stringify([["40", "220"], ["230", "400"]]), JSON.stringify(sizes));
  t.check("a legend explains the five colours", (await dev.eval(`document.querySelectorAll(".glucose-guide__legend li").length`)) === 5);
  await noErrors(dev, "device");
  dev.close();
}

{
  const dev = await device(stateBlob({}), "Glucose guide: closes with the button, the backdrop and Escape, and hands focus back");
  await openGlucoseGuidePanel(dev);
  t.check("while open, the page behind is scroll-locked", await dev.eval(`document.body.classList.contains("sheet-open")`));
  t.check("focus moves into the panel (to its close button)", await dev.eval(`document.activeElement && document.activeElement.id === "glucose-guide-close"`));
  const isOpen = () => dev.eval(`!!document.querySelector(".glucose-guide")`);
  await dev.cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await dev.cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await sleep(200);
  t.check("Escape closes it", !(await isOpen()));
  t.check("the scroll lock is released", !(await dev.eval(`document.body.classList.contains("sheet-open")`)));
  t.check("focus returns to the button that opened it", await dev.eval(`document.activeElement && document.activeElement.id === "btn-glucose-guide"`));
  await dev.click("#btn-glucose-guide"); await sleep(200);
  await dev.click("#glucose-guide-close"); await sleep(200);
  t.check("the close button closes it", !(await isOpen()));
  await dev.click("#btn-glucose-guide"); await sleep(200);
  await dev.eval(`document.querySelector(".sheet-backdrop").click()`); await sleep(200);
  t.check("tapping outside the panel closes it", !(await isOpen()));
  // Escape with nothing open must be inert: the key listener has to have been removed on close.
  await dev.cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await dev.cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await sleep(150);
  t.check("Escape afterwards does nothing and breaks nothing", !(await isOpen()) && !(await dev.eval(`document.body.classList.contains("sheet-open")`)));
  await noErrors(dev, "device");
  dev.close();
}

{
  const dev = await device(stateBlob({}), "Glucose guide: fits the screen -- no sideways overflow, and no scrolling on a normal phone");
  await openGlucoseGuidePanel(dev);
  const fit = () => dev.eval(`(() => { const s = document.querySelector(".glucose-guide"); return { sideways: s.scrollWidth > s.clientWidth + 1, scrolls: s.scrollHeight > s.clientHeight + 1, vw: innerWidth }; })()`);
  await dev.resize(390, 844); await sleep(250);
  const normal = await fit();
  t.check("390x844: nothing overflows sideways", !normal.sideways, JSON.stringify(normal));
  t.check("390x844: the whole 40-400 list is visible without scrolling", !normal.scrolls, JSON.stringify(normal));
  await dev.resize(320, 700); await sleep(250);
  const small = await fit();
  t.check("320 wide (the narrowest phones): still nothing overflows sideways", !small.sideways, JSON.stringify(small));
  await noErrors(dev, "device");
  dev.close();
}

{
  const dev = await device(stateBlob({}), "Glucose guide: the button shares the 'Current glucose' line, so the dose card doesn't grow");
  await dev.waitFor(`document.getElementById("cc-food-list") && document.getElementById("cc-food-list").children.length > 0`);
  await dev.click("#cc-correction-toggle"); await sleep(200);
  const g = await dev.eval(`(() => {
    const R = e => e.getBoundingClientRect();
    const label = R(document.querySelector('label[for="cc-glucose"]')), btn = R(document.getElementById("btn-glucose-guide"));
    const card = R(document.querySelector(".dose-card")), row = R(document.querySelector(".correction-row__labelrow"));
    return { sameLine: Math.abs((label.top + label.height / 2) - (btn.top + btn.height / 2)), insideCard: btn.right <= card.right - 8, rowHeight: row.height };
  })()`);
  t.check("the label and the button are on the same line", g.sameLine <= 3, JSON.stringify(g));
  t.check("the button stays inside the card", g.insideCard, JSON.stringify(g));
  t.check("the label row is no taller than the button (24px), so nothing was pushed down", g.rowHeight <= 24, JSON.stringify(g));
  await noErrors(dev, "device");
  dev.close();
}

for (const theme of ["light", "dark"]) {
  const dev = await device(stateBlob({}), `Glucose guide: every row is readable in the ${theme} theme (text contrast of at least 4.5:1)`);
  if (theme === "dark") await dev.eval(`document.documentElement.setAttribute("data-theme", "dark")`);
  await openGlucoseGuidePanel(dev);
  const worst = await guideWorstContrast(dev);
  t.check(`${theme}: worst-case contrast across all 37 rows is ${worst.toFixed(1)}:1`, worst >= 4.5, String(worst));
  await noErrors(dev, "device");
  dev.close();
}

{
  const dev = await device(stateBlob({ settings: { units: "mmol" } }), "Glucose guide: shows both units whichever one the app is set to");
  await openGlucoseGuidePanel(dev);
  const cells = await guideCells(dev);
  t.check("same 37 rows with the app in mmol/L", cells.length === 37 && cells[0][0] === "40" && cells[0][1] === "2.2", JSON.stringify(cells[0]));
  await noErrors(dev, "device");
  dev.close();
}

// ---------------------------------------------------------------------------
// Basal insulin (History tab)
const dayAgo = (n, h, m = 0) => { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(h, m, 0, 0); return d.getTime(); };
// "Today at h:m", but never later than a minute ago: the app (rightly) refuses a dose dated in the future, so a test that
// saved "today at 08:00" failed whenever it was run before 8am. (Clamped so it still falls on today.)
const todayAt = (h, m = 0) => Math.max(dayAgo(0, 0, 0) + 1000, Math.min(dayAgo(0, h, m), Date.now() - 60000));
const localStr = ts => { const d = new Date(ts), z = n => String(n).padStart(2, "0"); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`; };
const seedBasal = (units, slot, ts) => makeBasalEntry({ units, ts, slot, now: ts });
const ready = dev => dev.waitFor(`document.getElementById("cc-food-list") && document.getElementById("cc-food-list").children.length > 0`);
const openBasal = async dev => { await dev.tab("history"); await sleep(150); await dev.click("#btn-log-basal"); await sleep(250); };
const setBasalDose = (dev, units) => dev.eval(`(() => { const i = document.getElementById("basal-units"); i.value = ${JSON.stringify(String(units))}; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
const setBasalTime = (dev, ts) => dev.eval(`(() => { const i = document.getElementById("basal-time"); i.value = ${JSON.stringify(localStr(ts))}; i.dispatchEvent(new Event("change", { bubbles: true })); })()`);
const basalEntries = async dev => (await localState(dev)).history.filter(e => e.entryType === "basal");
const sheetOpen = dev => dev.eval(`!!document.querySelector(".basal-sheet")`);
const pressEscape = async dev => {
  await dev.cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await dev.cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await sleep(200);
};

{
  const dev = await device(stateBlob({}), "Basal: logging a first dose from the History tab");
  await ready(dev);
  await dev.tab("history"); await sleep(150);
  t.check("the Basal button is on the Log tab even with no history yet", await dev.eval(`document.getElementById("btn-log-basal").offsetParent !== null`));
  await dev.click("#btn-log-basal"); await sleep(250);
  t.check("it opens as an accessible dialog", await dev.eval(`(() => { const d = document.querySelector(".basal-sheet"); return d.getAttribute("role") === "dialog" && d.getAttribute("aria-modal") === "true" && /basal/i.test(document.getElementById(d.getAttribute("aria-labelledby")).textContent); })()`));
  t.check("first time there is nothing to prefill, and the hint says so", (await dev.eval(`document.getElementById("basal-units").value`)) === "" && /No (morning|evening) dose logged yet/.test(await dev.text("#basal-hint")));
  t.check("focus lands in the dose field", await dev.eval(`document.activeElement && document.activeElement.id === "basal-units"`));
  await setBasalDose(dev, 14); await dev.click("#basal-save"); await sleep(300);
  const entries = await basalEntries(dev);
  t.check("exactly one entry stored", entries.length === 1, String(entries.length));
  const e = entries[0] || {};
  t.check("it is a basal entry carrying 14 units in basalDose", e.entryType === "basal" && e.basalDose === 14);
  t.check("SAFETY: its units are NOT in mealDose or correctionDose, and it has no carbs", e.mealDose === 0 && e.correctionDose === 0 && e.totalCarbs === 0 && e.noInsulin === false);
  t.check("it has no food items, so nothing treats it as a meal", Array.isArray(e.items) && e.items.length === 0);
  t.check("its slot matches the time of day it was taken", e.basalSlot === (await dev.eval(`new Date(${e.ts}).getHours() < 14 ? "am" : "pm"`)));
  t.check("it is stamped for cloud sync (updatedAt)", typeof e.updatedAt === "number" && e.updatedAt > 0);
  const row = await dev.text("#history-groups .history-entry--basal");
  t.check("History shows it as a Basal row with its dose", /Basal/.test(row) && /14u/.test(row) && /Long-acting insulin/.test(row), row);
  t.check("it is not counted as a meal", (await dev.text("#hist-count-pill")) === "0 meals");
  t.check("the 'no meals yet' empty state is gone, because there is something to show", await dev.eval(`document.getElementById("history-empty").hidden`));
  t.check("a confirmation with Undo appears", !(await dev.eval(`document.getElementById("undo-toast").hidden`)) && /Basal 14u logged/.test(await dev.text("#undo-toast-message")));
  t.check("the sheet closed and released the scroll lock", !(await sheetOpen(dev)) && !(await dev.eval(`document.body.classList.contains("sheet-open")`)));
  t.check("focus returned to the Basal button", await dev.eval(`document.activeElement && document.activeElement.id === "btn-log-basal"`));
  await noErrors(dev, "device");
  dev.close();
}

{
  const history = [seedBasal(14, "am", dayAgo(1, 8)), seedBasal(16, "pm", dayAgo(1, 20))];
  const dev = await device(stateBlob({ history }), "Basal: starts from your last dose in the slot, follows the slot you pick, and never overwrites typing");
  await ready(dev);
  await openBasal(dev);
  const dose = () => dev.eval(`document.getElementById("basal-units").value`);
  await dev.click('[data-slot="pm"]'); await sleep(100);
  t.check("Evening starts from the last evening dose (16)", (await dose()) === "16" && /Last evening dose: 16u/.test(await dev.text("#basal-hint")), await dose());
  await dev.click('[data-slot="am"]'); await sleep(100);
  t.check("switching to Morning swaps the prefill to the last morning dose (14)", (await dose()) === "14" && /Last morning dose: 14u/.test(await dev.text("#basal-hint")));
  t.check("the chosen slot is marked pressed", await dev.eval(`document.querySelector('[data-slot="am"]').getAttribute("aria-pressed") === "true" && document.querySelector('[data-slot="pm"]').getAttribute("aria-pressed") === "false"`));
  await setBasalDose(dev, 20);
  await dev.click('[data-slot="pm"]'); await sleep(100);
  t.check("a dose you typed is NOT replaced when you switch slot", (await dose()) === "20", await dose());
  await dev.click('[data-step="1"]'); await sleep(50);
  t.check("+ adds one unit", (await dose()) === "21", await dose());
  await dev.click('[data-step="-1"]'); await dev.click('[data-step="-1"]'); await sleep(50);
  t.check("− takes one unit off, per press", (await dose()) === "19", await dose());
  await setBasalDose(dev, 0.5); await dev.click('[data-step="-1"]'); await sleep(50);
  t.check("− never goes below zero", (await dose()) === "0", await dose());
  await noErrors(dev, "device");
  dev.close();
}

{
  const dev = await device(stateBlob({}), "Basal: the slot follows the time of day until you choose one yourself");
  await ready(dev);
  await openBasal(dev);
  const activeSlot = () => dev.eval(`document.querySelector("[data-slot].is-active").dataset.slot`);
  await setBasalTime(dev, dayAgo(0, 8)); await sleep(100);
  t.check("08:00 -> Morning", (await activeSlot()) === "am");
  await setBasalTime(dev, dayAgo(0, 13, 59)); await sleep(100);
  t.check("13:59 -> still Morning", (await activeSlot()) === "am");
  await setBasalTime(dev, dayAgo(0, 14)); await sleep(100);
  t.check("14:00 -> Evening", (await activeSlot()) === "pm");
  await dev.click('[data-slot="am"]'); await sleep(100);
  await setBasalTime(dev, dayAgo(0, 21)); await sleep(100);
  t.check("once picked by hand, changing the time no longer changes the slot", (await activeSlot()) === "am");
  await noErrors(dev, "device");
  dev.close();
}

{
  const history = [seedBasal(14, "am", dayAgo(1, 8))];
  const dev = await device(stateBlob({ history }), "Basal: refuses nonsense and asks before a likely typo, and a cancelled check logs nothing");
  await ready(dev);
  await openBasal(dev);
  await setBasalTime(dev, todayAt(8)); await dev.click('[data-slot="am"]'); await sleep(100);   // the slot is picked explicitly, not left to the hour
  const count = async () => (await basalEntries(dev)).length;
  const err = () => dev.eval(`(() => { const e = document.getElementById("basal-error"); return e.hidden ? "" : e.textContent; })()`);
  await setBasalDose(dev, 0); await dev.click("#basal-save"); await sleep(200);
  t.check("0 units is refused with a message, and nothing is logged", /greater than 0/.test(await err()) && (await count()) === 1, await err());
  await setBasalDose(dev, 250); await dev.click("#basal-save"); await sleep(200);
  t.check("250 units is refused as over the limit", /over 200/.test(await err()) && (await count()) === 1, await err());
  await setBasalTime(dev, Date.now() + 3 * 3600000); await dev.click("#basal-save"); await sleep(200);
  t.check("a time in the future is refused", /future/.test(await err()), await err());
  await setBasalTime(dev, todayAt(8)); await dev.click('[data-slot="am"]'); await setBasalDose(dev, 140);
  await dev.click("#basal-save"); await sleep(300);
  const dlg = await dev.eval(`(() => { const d = document.querySelector(".dialog"); return d ? d.textContent : ""; })()`);
  t.check("140 after a usual 14 triggers a check that quotes both numbers", /14u/.test(dlg) && /140u/.test(dlg), dlg);
  t.check("the check defaults to Cancel, so a stray Enter can't log a suspect dose", await dev.eval(`document.activeElement && document.activeElement.classList.contains("dialog__btn--ghost")`));
  t.check("the sheet stays open behind the check", await sheetOpen(dev));
  await pressEscape(dev);
  t.check("Escape on the check cancels the check, not the sheet underneath", await sheetOpen(dev) && !(await dev.eval(`!!document.querySelector(".dialog-backdrop")`)));
  t.check("cancelling the check logs nothing", (await count()) === 1);
  await dev.click("#basal-save"); await sleep(300);
  await dev.click(".dialog__btn--danger"); await sleep(300);
  t.check("confirming logs it", (await count()) === 2);
  t.check("...and the sheet closes", !(await sheetOpen(dev)));
  await noErrors(dev, "device");
  dev.close();
}

{
  const history = [seedBasal(14, "am", dayAgo(1, 8)), seedBasal(16, "pm", dayAgo(0, 20)).ts ? seedBasal(16, "pm", dayAgo(1, 20)) : null].filter(Boolean);
  const dev = await device(stateBlob({ history }), "Basal: editing changes the entry in place, with no duplicate and no self-comparison");
  await ready(dev);
  await dev.tab("history"); await sleep(150);
  const before = (await basalEntries(dev)).find(e => e.basalSlot === "am");
  await dev.eval(`document.getElementById("history-groups").querySelector('[data-id="${before.id}"]').click()`); await sleep(100);
  await dev.click(`[data-edit="${before.id}"]`); await sleep(250);
  t.check("it opens as an edit, preloaded with the stored dose", /Edit basal dose/.test(await dev.text("#basal-title")) && (await dev.eval(`document.getElementById("basal-units").value`)) === "14");
  await setBasalDose(dev, 14.5); await dev.click("#basal-save"); await sleep(300);
  t.check("a small change is saved without any 'are you sure' (it isn't compared against itself)", !(await dev.eval(`!!document.querySelector(".dialog")`)) && !(await sheetOpen(dev)));
  let after = (await basalEntries(dev)).find(e => e.id === before.id);
  t.check("same entry, new dose", after.basalDose === 14.5 && (await basalEntries(dev)).length === 2);
  // The seeded entry had no updatedAt to begin with, so compare against 0 and require that the edit was
  // stamped just now -- that's what cloud sync needs in order to notice the change.
  t.check("the edit was stamped for sync just now", typeof after.updatedAt === "number" && after.updatedAt > (before.updatedAt || 0) && Date.now() - after.updatedAt < 60000, JSON.stringify({ before: before.updatedAt, after: after.updatedAt }));
  await dev.eval(`document.getElementById("history-groups").querySelector('[data-id="${before.id}"]').click()`); await sleep(100);
  await dev.click(`[data-edit="${before.id}"]`); await sleep(250);
  await dev.click('[data-slot="pm"]'); await setBasalTime(dev, dayAgo(1, 19, 30)); await setBasalDose(dev, 15); await sleep(50);
  await dev.click("#basal-save"); await sleep(300);
  after = (await basalEntries(dev)).find(e => e.id === before.id);
  t.check("slot, time and dose all update; still the same entry", after.basalSlot === "pm" && after.periodName === "evening" && after.basalDose === 15 && after.ts === new Date(localStr(dayAgo(1, 19, 30))).getTime());
  const order = (await localState(dev)).history.map(e => e.ts);
  t.check("history stays sorted newest-first after changing a time", order.every((v, i) => i === 0 || order[i - 1] >= v), JSON.stringify(order));
  await noErrors(dev, "device");
  dev.close();
}

{
  const history = [seedBasal(14, "am", dayAgo(1, 8))];
  const dev = await device(stateBlob({ history }), "Basal: deleting can be undone");
  await ready(dev);
  await dev.tab("history"); await sleep(150);
  const id = history[0].id;
  await dev.eval(`document.getElementById("history-groups").querySelector('[data-id="${id}"]').click()`); await sleep(100);
  t.check("a basal row offers Edit and Delete, but not 'Use Again'", await dev.eval(`(() => { const r = document.querySelector('#history-groups [data-id="${id}"]'); return !!r.querySelector("[data-edit]") && !!r.querySelector("[data-del]") && !r.querySelector("[data-use]"); })()`));
  await dev.click(`[data-del="${id}"]`); await sleep(300);
  t.check("deleted", (await basalEntries(dev)).length === 0);
  t.check("the toast says it was a basal dose", /Basal dose deleted/.test(await dev.text("#undo-toast-message")));
  await dev.click("#undo-toast-btn"); await sleep(300);
  const back = await basalEntries(dev);
  t.check("Undo brings it back, dose intact", back.length === 1 && back[0].id === id && back[0].basalDose === 14);
  await noErrors(dev, "device");
  dev.close();
}

{
  // The property everything else leans on: a basal dose must not reach the bolus maths.
  const mealAgo = meal("m1", Date.now() - 45 * 60000, { mealDose: 4, correctionDose: 0, totalCarbs: 50 });
  const dev = await device(stateBlob({ history: [mealAgo], settings: { iobAwareCorrection: true } }), "SAFETY: logging basal changes neither active insulin nor the correction suggestion");
  await ready(dev);
  await dev.click("#cc-correction-toggle"); await sleep(150);
  const reading = async () => {
    await dev.eval(`(() => { const i = document.getElementById("cc-glucose"); i.value = "220"; i.dispatchEvent(new Event("input", { bubbles: true })); })()`); await sleep(150);
    return { banner: await dev.text(".active-panel"), dose: await dev.text("#cc-dose-number"), iobNote: await dev.text("#cc-iob-adjust-note") };
  };
  const base = await reading();
  t.check("sanity: the meal's insulin is active and being subtracted from the correction", /active/.test(base.banner) && /IOB/.test(base.iobNote), JSON.stringify(base));
  await openBasal(dev); await setBasalDose(dev, 40); await dev.click("#basal-save"); await sleep(300);
  t.check("the 40u basal was logged", (await basalEntries(dev)).length === 1);
  await dev.tab("calculator"); await sleep(250);
  const after = await reading();
  t.check("the Active Insulin banner is unchanged", after.banner === base.banner, `${base.banner} -> ${after.banner}`);
  t.check("the IOB-aware correction note is unchanged", after.iobNote === base.iobNote, `${base.iobNote} -> ${after.iobNote}`);
  t.check("the suggested dose is unchanged", after.dose === base.dose, `${base.dose} -> ${after.dose}`);
  await noErrors(dev, "device");
  dev.close();
}

{
  const mealEntry = meal("m1", dayAgo(0, 9), { mealDose: 4, totalCarbs: 50 });
  const plain = await device(stateBlob({ history: [mealEntry] }), "Basal stays out of Recently Logged, Trends and the meal count -- and is findable by search");
  const withBasal = await openDevice(app, { height: 1000, inject: seedLocal(stateBlob({ history: [mealEntry, seedBasal(14, "am", dayAgo(0, 8)), seedBasal(16, "pm", dayAgo(1, 20))] })) });
  await ready(plain); await ready(withBasal);
  const chips = dev => dev.eval(`Array.from(document.querySelectorAll("#recent-meals-row .recent-meal-chip")).map(c => c.textContent.trim())`);
  t.check("Recently Logged shows the same single meal, and no basal chip", JSON.stringify(await chips(withBasal)) === JSON.stringify(await chips(plain)) && (await chips(withBasal)).length === 1);
  // Trends gained a Daily basal insulin card, so the two pages now differ by exactly that card. What must NOT change is
  // every meal figure, so compare the page with that card taken out, and check the card is the only difference.
  const trendsText = async (dev, withoutBasalCard) => {
    await dev.tab("history"); await sleep(150); await dev.click('[data-seg="trends"]'); await sleep(400);
    return dev.eval(`(() => { const c = document.getElementById("history-trends-panel").cloneNode(true); ${withoutBasalCard ? 'const b = c.querySelector("#trend-card-basal"); if (b) b.remove();' : ""} return c.textContent.replace(/\\s+/g, " ").trim(); })()`);
  };
  const tPlain = await trendsText(plain, true), tBasal = await trendsText(withBasal, true);
  t.check("every meal figure on Trends is identical with basal in the history (the new basal card aside)", tPlain === tBasal && tPlain.length > 40, `${tPlain.slice(0, 80)} | ${tBasal.slice(0, 80)}`);
  t.check("and the basal card is what differs: present with basal, hidden without", await withBasal.eval(`!document.getElementById("trend-card-basal").hidden`) && await plain.eval(`document.getElementById("trend-card-basal").hidden`));
  await withBasal.click('[data-seg="log"]'); await sleep(200);
  t.check("the meal counter ignores basal (1 meal, not 3)", (await withBasal.text("#hist-count-pill")) === "1 meal");
  const search = async (dev, q) => { await dev.eval(`(() => { const i = document.getElementById("history-search"); i.value = ${JSON.stringify(q)}; i.dispatchEvent(new Event("input", { bubbles: true })); })()`); await sleep(200); return dev.eval(`Array.from(document.querySelectorAll("#history-groups .history-entry")).map(r => r.classList.contains("history-entry--basal") ? "basal" : "meal")`); };
  t.check("searching 'basal' finds only the basal doses", JSON.stringify(await search(withBasal, "basal")) === JSON.stringify(["basal", "basal"]));
  t.check("searching 'long-acting' finds them too", (await search(withBasal, "long-acting")).length === 2);
  t.check("searching 'evening' finds the evening dose", JSON.stringify(await search(withBasal, "evening")) === JSON.stringify(["basal"]));
  t.check("searching a food name finds the meal and no basal", JSON.stringify(await search(withBasal, "pane")) === JSON.stringify(["meal"]));
  await noErrors(plain, "plain device"); await noErrors(withBasal, "basal device");
  plain.close(); withBasal.close();
}

// ---------------------------------------------------------------------------
// The maximum-dose cap: the dose on the card must be the dose that gets logged.
// A meal that calculated to 19.5u showed "15.0" (the 15u cap) but was stored as 19.5u.
const ratioNow = async dev => parseFloat((await dev.text("#cc-ratio-value")).split(":")[1]);
// Adds enough bread (65g carbs per 100g) for a meal that calculates to `units`, whatever the time-of-day ratio is.
const addBreadForUnits = async (dev, units) => {
  const grams = Math.round(units * (await ratioNow(dev)) / 0.65 * 10) / 10;
  await dev.eval(`document.getElementById("cc-food-list").children[0].click()`);
  await dev.eval(`(() => { const g = document.getElementById("cc-grams"); g.value = "${grams}"; g.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await dev.click("#cc-add-btn"); await sleep(250);
};
const setGlucose = async (dev, v) => { await dev.eval(`(() => { const g = document.getElementById("cc-glucose"); g.value = "${v}"; g.dispatchEvent(new Event("input", { bubbles: true })); })()`); await sleep(200); };
const capNote = dev => dev.eval(`(() => { const n = document.getElementById("cc-cap-note"); return n.hidden ? "" : n.textContent; })()`);
const lastEntry = async dev => (await localState(dev)).history[0];

{
  const dev = await device(stateBlob({}), "REGRESSION: a meal that calculates over the max dose shows AND logs the capped dose (card said 15, log said 19.5)");
  await ready(dev);
  await addBreadForUnits(dev, 19.5);
  const shown = parseFloat(await dev.text("#cc-dose-number"));
  t.check("the card shows the capped 15.0", shown === 15, String(shown));
  t.check("and says plainly that it was capped, and what the calculation came to", /Capped at your 15 u maximum/.test(await capNote(dev)) && /19\.5/.test(await capNote(dev)), await capNote(dev));
  await dev.click("#cc-log-btn"); await sleep(300);
  const e = await lastEntry(dev);
  t.check("the stored meal dose is the capped 15 (it used to be 19.5)", e.mealDose === 15, String(e.mealDose));
  t.check("the stored correction is 0", e.correctionDose === 0, String(e.correctionDose));
  t.check("stored total === what was on the card", e.mealDose + e.correctionDose === shown, `${e.mealDose}+${e.correctionDose} vs ${shown}`);
  t.check("the entry remembers it was capped from 19.5", e.cappedFrom === 19.5, String(e.cappedFrom));
  await dev.tab("history"); await sleep(250);
  t.check("History shows 15u, not 19.5u", /15u/.test(await dev.text("#history-groups .history-entry")) && !/19\.5/.test(await dev.text("#history-groups .history-entry__stats")));
  await dev.eval(`document.getElementById("history-groups").querySelector('[data-id="${e.id}"]').click()`); await sleep(100);
  t.check("expanding it explains the cap", /calculated 19\.5u/.test(await dev.text(".history-entry__cap")), await dev.text(".history-entry__cap"));
  await noErrors(dev, "device");
  dev.close();
}

{
  const dev = await device(stateBlob({}), "Max dose: with a correction on top, the correction gives way first, and the parts still add up to the card");
  await ready(dev);
  await addBreadForUnits(dev, 12);
  await dev.click("#cc-correction-toggle"); await sleep(150);
  await setGlucose(dev, 400);                                  // (400 - 100) / 50 = a 6u correction: 12 + 6 = 18, over the 15u cap
  const shown = parseFloat(await dev.text("#cc-dose-number"));
  t.check("the card shows 15.0", shown === 15, String(shown));
  await dev.click("#cc-log-btn"); await sleep(300);
  const e = await lastEntry(dev);
  t.check("meal 12 + correction 3 (the correction was trimmed, not the meal)", e.mealDose === 12 && e.correctionDose === 3, `${e.mealDose}+${e.correctionDose}`);
  t.check("they add up to what the card showed", e.mealDose + e.correctionDose === shown);
  t.check("it remembers the calculation came to 18", e.cappedFrom === 18, String(e.cappedFrom));
  await noErrors(dev, "device");
  dev.close();
}

{
  const dev = await device(stateBlob({}), "Max dose: under the cap there is no note and nothing is recorded as capped");
  await ready(dev);
  await addBreadForUnits(dev, 10);
  t.check("the card shows 10.0", parseFloat(await dev.text("#cc-dose-number")) === 10);
  t.check("no cap note", (await capNote(dev)) === "");
  await dev.click("#cc-log-btn"); await sleep(300);
  const e = await lastEntry(dev);
  t.check("stored 10, with no cappedFrom field at all", e.mealDose === 10 && !("cappedFrom" in e), JSON.stringify(e.cappedFrom));
  await noErrors(dev, "device");
  dev.close();
}

{
  const dev = await device(stateBlob({ settings: { maxDose: 0 } }), "Max dose: with the cap switched off (0) the full dose is shown and logged");
  await ready(dev);
  await addBreadForUnits(dev, 19.5);
  t.check("the card shows the full 19.5", parseFloat(await dev.text("#cc-dose-number")) === 19.5);
  t.check("no cap note", (await capNote(dev)) === "");
  await dev.click("#cc-log-btn"); await sleep(300);
  const e = await lastEntry(dev);
  t.check("19.5 stored, matching the card", e.mealDose === 19.5 && !("cappedFrom" in e), `${e.mealDose}`);
  await noErrors(dev, "device");
  dev.close();
}

{
  const dev = await device(stateBlob({}), "Max dose: a dose you TYPE (Eating Out) is never changed -- it's shown and logged as typed, with a warning");
  await ready(dev);
  await dev.click("#cc-eating-out-toggle"); await sleep(150);
  await dev.eval(`(() => { const i = document.getElementById("cc-eating-out-dose"); i.value = "18"; i.dispatchEvent(new Event("input", { bubbles: true })); })()`); await sleep(200);
  const shown = parseFloat(await dev.text("#cc-dose-number"));
  t.check("the card shows the 18 you typed, not a silently reduced 15", shown === 18, String(shown));
  t.check("a warning says it's above the maximum and wasn't changed", /above your 15 u maximum/.test(await capNote(dev)) && /hasn't been changed/.test(await capNote(dev)), await capNote(dev));
  await dev.click("#cc-log-btn"); await sleep(300);
  const e = await lastEntry(dev);
  t.check("logged as typed, and identical to the card", e.mealDose === 18 && e.mealDose === shown && !("cappedFrom" in e), String(e.mealDose));
  await noErrors(dev, "device");
  dev.close();
}

{
  const dev = await device(stateBlob({}), "Max dose: a typed correction on top of a calculated meal is also left alone (warned, not trimmed)");
  await ready(dev);
  await addBreadForUnits(dev, 10);
  await dev.click("#cc-correction-toggle"); await sleep(150);
  await dev.click("#cc-correction-manual-link"); await sleep(150);
  await dev.eval(`(() => { const i = document.getElementById("cc-correction-manual-input"); i.value = "8"; i.dispatchEvent(new Event("input", { bubbles: true })); })()`); await sleep(200);
  const shown = parseFloat(await dev.text("#cc-dose-number"));
  t.check("10 calculated + 8 typed shows 18.0", shown === 18, String(shown));
  t.check("with the warning", /above your 15 u maximum/.test(await capNote(dev)), await capNote(dev));
  await dev.click("#cc-log-btn"); await sleep(300);
  const e = await lastEntry(dev);
  t.check("logged 10 + 8, matching the card", e.mealDose === 10 && e.correctionDose === 8 && e.mealDose + e.correctionDose === shown);
  await noErrors(dev, "device");
  dev.close();
}

{
  // An entry logged BEFORE the fix, exactly as in the report: 19.5u stored although the card showed 15.
  const oldEntry = meal("old", Date.now() - 2 * 3600000, {
    totalCarbs: 156, mealDose: 19.5, correctionDose: 0, ratioValue: 8, ratioLabel: "Lunch",
    items: [{ refType: "food", refId: "s1", name: "Pane comune", grams: 240, carbsPer100g: 65, kcalPer100g: 300, carbs: 156, kcal: 720 }]
  });
  const dev = await device(stateBlob({ history: [oldEntry] }), "Max dose: editing the entry that was wrongly logged as 19.5u repairs it to the capped 15u");
  await ready(dev);
  await dev.tab("history"); await sleep(150);
  await dev.eval(`document.getElementById("history-groups").querySelector('[data-id="old"]').click()`); await sleep(100);
  await dev.click('[data-edit="old"]'); await sleep(300);
  const preview = await dev.text("#em-preview");
  t.check("the edit preview shows 15.0 and says it's capped", /15\.0 units/.test(preview) && /capped/i.test(preview) && /19\.5/.test(preview), preview);
  await dev.click("#em-save"); await sleep(300);
  const e = (await localState(dev)).history.find(x => x.id === "old");
  t.check("saving stores the same 15 the preview promised (not 19.5)", e.mealDose === 15 && e.correctionDose === 0, `${e.mealDose}+${e.correctionDose}`);
  t.check("it records that it was capped from 19.5", e.cappedFrom === 19.5, String(e.cappedFrom));
  await noErrors(dev, "device");
  dev.close();
}

{
  const capped = meal("cap", Date.now() - 2 * 3600000, {
    totalCarbs: 156, mealDose: 15, correctionDose: 0, ratioValue: 8, ratioLabel: "Lunch", cappedFrom: 19.5,
    items: [{ refType: "food", refId: "s1", name: "Pane comune", grams: 240, carbsPer100g: 65, kcalPer100g: 300, carbs: 156, kcal: 720 }]
  });
  const dev = await device(stateBlob({ history: [capped] }), "Max dose: re-saving a capped meal does not re-inflate it, and shrinking it clears the cap marker");
  await ready(dev);
  await dev.tab("history"); await sleep(150);
  const openEdit = async () => { await dev.eval(`document.getElementById("history-groups").querySelector('[data-id="cap"]').click()`); await sleep(100); await dev.click('[data-edit="cap"]'); await sleep(300); };
  await openEdit();
  await dev.eval(`(() => { const i = document.getElementById("em-logged-time"); const d = new Date(Date.now() - 3 * 3600000), z = n => String(n).padStart(2, "0"); i.value = d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate()) + "T" + z(d.getHours()) + ":" + z(d.getMinutes()); i.dispatchEvent(new Event("change", { bubbles: true })); })()`);
  await dev.click("#em-save"); await sleep(300);
  let e = (await localState(dev)).history.find(x => x.id === "cap");
  t.check("changing only the time leaves the dose at 15 (it would have jumped back to 19.5)", e.mealDose === 15 && e.cappedFrom === 19.5, `${e.mealDose} / ${e.cappedFrom}`);
  await openEdit();
  await dev.eval(`(() => { const i = document.querySelector(".em-grams-input"); i.value = "100"; i.dispatchEvent(new Event("input", { bubbles: true })); })()`); await sleep(200);
  t.check("shrinking it to 100g: the preview shows the real, uncapped dose and no cap wording", /8\.0 units/.test(await dev.text("#em-preview")) && !/capped/i.test(await dev.text("#em-preview")), await dev.text("#em-preview"));
  await dev.click("#em-save"); await sleep(300);
  e = (await localState(dev)).history.find(x => x.id === "cap");
  t.check("it's now 8u, and the cap marker is gone because it no longer applies", e.mealDose === 8 && !("cappedFrom" in e), `${e.mealDose} / ${e.cappedFrom}`);
  await noErrors(dev, "device");
  dev.close();
}

// ---------------------------------------------------------------------------
// On iPhone the keyboard doesn't shrink the page, it covers the bottom of it, so a bottom-anchored sheet ended up
// underneath it. These simulate that by shrinking the *visual* viewport (the part you can see), as iOS does.
const VV_MOCK = `(() => { const t = new EventTarget(); let h = null, top = 0, scale = 1;
  const vv = { get height() { return h == null ? innerHeight : h; }, get width() { return innerWidth; }, get offsetTop() { return top; }, offsetLeft: 0, get scale() { return scale; },
    addEventListener: (...a) => t.addEventListener(...a), removeEventListener: (...a) => t.removeEventListener(...a) };
  Object.defineProperty(window, "visualViewport", { value: vv, configurable: true });
  window.__setVV = (height, offsetTop = 0, sc = 1) => { h = height; top = offsetTop; scale = sc; t.dispatchEvent(new Event("resize")); t.dispatchEvent(new Event("scroll")); }; })();`;
const NO_VV = `Object.defineProperty(window, "visualViewport", { value: undefined, configurable: true });`;
const kbDevice = (state, name, mock = VV_MOCK) => { t.section(name); return openDevice(app, { width: 402, height: 874, inject: mock + seedLocal(state), wait: 1500 }); };
const box = (dev, sel) => dev.eval(`(() => { const b = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom) }; })()`);
const inside = (inner, outer) => inner.top >= outer.top - 1 && inner.bottom <= outer.bottom + 1;

{
  const dev = await kbDevice(stateBlob({}), "Keyboard: the basal sheet sits above it, and the dose field stays visible");
  await ready(dev); await openBasal(dev);
  t.check("keyboard down: not in keyboard mode, sheet at the bottom of the screen", !(await dev.eval(`document.documentElement.classList.contains("kb-open")`)) && (await box(dev, ".basal-sheet")).bottom === 874);
  await dev.eval(`window.__setVV(529)`);                      // a keyboard about 345px tall
  await dev.eval(`document.getElementById("basal-units").focus()`); await sleep(900);
  const back = await box(dev, ".sheet-backdrop"), sheet = await box(dev, ".basal-sheet"), input = await box(dev, "#basal-units");
  t.check("keyboard up: the sheet area is the visible part only (0 to 529)", back.top === 0 && back.bottom === 529, JSON.stringify(back));
  t.check("the whole sheet is above the keyboard", sheet.bottom <= 529 + 1, JSON.stringify(sheet));
  t.check("the dose field is fully in view (it used to be half hidden behind the keyboard)", inside(input, { top: 0, bottom: 529 }), JSON.stringify(input));
  t.check("the app knows the keyboard is up", await dev.eval(`document.documentElement.classList.contains("kb-open")`));
  t.check("the reminder text is dropped while the keyboard is up, to save room", await dev.eval(`getComputedStyle(document.querySelector(".basal-note")).display === "none"`));
  await dev.eval(`window.__setVV(874)`); await sleep(150);
  t.check("keyboard down again: reminder text is back and the sheet returns to the bottom", await dev.eval(`getComputedStyle(document.querySelector(".basal-note")).display !== "none"`) && (await box(dev, ".basal-sheet")).bottom === 874);
  await noErrors(dev, "device");
  dev.close();
}

{
  const dev = await kbDevice(stateBlob({}), "Keyboard: it follows the screen when iOS pans it, and ignores pinch-zoom");
  await ready(dev); await openBasal(dev);
  await dev.eval(`window.__setVV(529, 60)`); await sleep(100);
  let back = await box(dev, ".sheet-backdrop");
  t.check("panned down by 60: the sheet area moves with the visible area (60 to 589)", back.top === 60 && back.bottom === 589, JSON.stringify(back));
  await dev.eval(`window.__setVV(529, 0, 1.6)`); await sleep(100);
  back = await box(dev, ".sheet-backdrop");
  t.check("pinch-zoomed: it does NOT mistake that for a keyboard (back to the whole screen)", back.top === 0 && back.bottom === 874 && !(await dev.eval(`document.documentElement.classList.contains("kb-open")`)), JSON.stringify(back));
  await noErrors(dev, "device");
  dev.close();
}

{
  const dev = await kbDevice(stateBlob({}), "Keyboard: when there is very little room the sheet scrolls and brings the field into view");
  await ready(dev); await openBasal(dev);
  await dev.eval(`window.__setVV(300)`);
  await dev.eval(`document.getElementById("basal-units").focus()`); await sleep(1100);
  const sheet = await box(dev, ".basal-sheet"), input = await box(dev, "#basal-units");
  t.check("the sheet shrinks to fit the 300px that is visible", sheet.bottom <= 300 + 1 && sheet.top >= 0, JSON.stringify(sheet));
  t.check("it can scroll (there isn't room for all of it)", await dev.eval(`(() => { const s = document.querySelector(".basal-sheet"); return s.scrollHeight > s.clientHeight + 1; })()`));
  t.check("and the field you're typing into was scrolled into view", inside(input, sheet), JSON.stringify({ input, sheet }));
  await noErrors(dev, "device");
  dev.close();
}

{
  const dev = await kbDevice(stateBlob({}), "Keyboard: closing the sheet puts everything back");
  await ready(dev); await openBasal(dev);
  await dev.eval(`window.__setVV(529)`); await sleep(100);
  await dev.click("#basal-cancel"); await sleep(200);
  t.check("no keyboard-mode class left behind", !(await dev.eval(`document.documentElement.classList.contains("kb-open")`)));
  t.check("no viewport variables left behind", (await dev.eval(`document.documentElement.style.getPropertyValue("--vv-height") + document.documentElement.style.getPropertyValue("--vv-top")`)) === "");
  await dev.eval(`window.__setVV(400)`); await sleep(100);
  t.check("and a keyboard appearing with no sheet open changes nothing", !(await dev.eval(`document.documentElement.classList.contains("kb-open")`)));
  await noErrors(dev, "device");
  dev.close();
}

{
  const dev = await kbDevice(stateBlob({}), "Keyboard: a browser with no visualViewport still works exactly as before", NO_VV);
  await ready(dev); await openBasal(dev);
  t.check("the sheet opens, fills the bottom of the screen, and nothing broke", (await box(dev, ".basal-sheet")).bottom === 874 && (await sheetOpen(dev)));
  await setBasalDose(dev, 14); await dev.click("#basal-save"); await sleep(300);
  t.check("and logging a dose still works", (await basalEntries(dev)).length === 1);
  await noErrors(dev, "device");
  dev.close();
}

{
  const mealEntry = meal("m1", dayAgo(0, 9), { mealDose: 4, totalCarbs: 50 });
  const dev = await kbDevice(stateBlob({ history: [mealEntry] }), "Keyboard: the same fix covers the other sheets too (editing a meal)");
  await ready(dev);
  await dev.tab("history"); await sleep(150);
  await dev.eval(`document.getElementById("history-groups").querySelector('[data-id="m1"]').click()`); await sleep(100);
  await dev.click('[data-edit="m1"]'); await sleep(300);
  await dev.eval(`window.__setVV(529)`);
  await dev.eval(`document.querySelector(".em-grams-input").focus()`); await sleep(1000);
  const sheet = await box(dev, ".sheet-backdrop .sheet"), input = await box(dev, ".em-grams-input");
  t.check("the edit sheet is above the keyboard", sheet.bottom <= 529 + 1, JSON.stringify(sheet));
  t.check("the grams field you are editing is in view", inside(input, sheet), JSON.stringify({ input, sheet }));
  await noErrors(dev, "device");
  dev.close();
}

{
  const dev = await device(stateBlob({}), "Basal sheet: the Morning / Evening buttons are fully styled, not left to the browser");
  await ready(dev); await openBasal(dev);
  const css = await dev.eval(`(() => {
    const cs = e => getComputedStyle(document.querySelector(e));
    const am = cs('[data-slot="am"]'), pm = cs('[data-slot="pm"]'), title = cs("#basal-title"), sheet = cs(".basal-sheet"), accent = cs(".basal-add-btn svg");
    const active = document.querySelector("[data-slot].is-active").dataset.slot, other = active === "am" ? "pm" : "am";
    const a = cs('[data-slot="' + active + '"]'), o = cs('[data-slot="' + other + '"]');
    return { inactiveColor: o.color, inactiveBg: o.backgroundColor, inactiveBorder: o.borderTopColor, activeColor: a.color, activeBorder: a.borderTopColor, activeBorderW: a.borderTopWidth,
             title: title.color, surface: sheet.backgroundColor, accent: accent.color };
  })()`);
  t.check("the unselected button uses the app's text colour, not the browser's link blue", css.inactiveColor === css.title, JSON.stringify(css));
  t.check("it has the sheet's own background, not the browser's grey button fill", css.inactiveBg === css.surface && css.inactiveBg !== "rgb(239, 239, 239)", JSON.stringify(css));
  t.check("the selected one is shown in the app accent colour, text and border", css.activeColor === css.accent && css.activeBorder === css.accent, JSON.stringify(css));
  t.check("so the two states are visibly different", css.activeBorder !== css.inactiveBorder && css.activeColor !== css.inactiveColor);
  t.check("the selected border is 2px so it reads at a glance", css.activeBorderW === "2px", css.activeBorderW);
  await noErrors(dev, "device");
  dev.close();
}

// ---------------------------------------------------------------------------
// The dose field: "14 units" sits together in the middle of the box, rather than the field stretching to fill it and
// pushing "units" to the far edge.
{
  const dev = await device(stateBlob({}), "Basal sheet: the number and its unit sit together in the middle of the box");
  await ready(dev); await openBasal(dev);
  const geo = () => dev.eval(`(() => { const row = document.querySelector(".basal-dose-row .field__row"), i = document.getElementById("basal-units"), u = row.querySelector("span");
    const R = row.getBoundingClientRect(), I = i.getBoundingClientRect(), U = u.getBoundingClientRect();
    return { gap: Math.round(U.left - I.right), left: Math.round(I.left - R.left), right: Math.round(R.right - U.right), inputW: Math.round(I.width), rowW: Math.round(R.width) }; })()`);
  for (const [label, value] of [["empty", ""], ["a short number", "7"], ["14", "14"], ["a long one", "100.5"]]) {
    await setBasalDose(dev, value); await sleep(80);
    const g = await geo();
    t.check(`${label}: the unit is right beside the number`, g.gap <= 4, JSON.stringify(g));
    t.check(`${label}: the pair is centred in the box (${g.left}px each side)`, Math.abs(g.left - g.right) <= 3, JSON.stringify(g));
    t.check(`${label}: it is NOT pushed to the right edge (plenty of space after "units")`, g.right >= 40, JSON.stringify(g));
  }
  await setBasalDose(dev, "14"); await sleep(80);
  const small = (await geo()).inputW; await setBasalDose(dev, "100.5"); await sleep(80);
  t.check("the number field grows with what you type", (await geo()).inputW > small, `${small} -> ${(await geo()).inputW}`);
  t.check("a long number isn't clipped by the narrow field", await dev.eval(`(() => { const i = document.getElementById("basal-units"); return i.scrollWidth <= i.clientWidth + 1; })()`));
  await dev.click('[data-step="1"]'); await sleep(80);
  t.check("the + button keeps it fitted too", (await geo()).inputW > small && Math.abs((await geo()).left - (await geo()).right) <= 3);
  await dev.eval(`document.querySelector(".basal-dose-row .field__row").click()`); await sleep(100);
  t.check("tapping the empty space around the number still focuses the field", await dev.eval(`document.activeElement && document.activeElement.id === "basal-units"`));
  await noErrors(dev, "device");
  dev.close();
}

// The page behind a sheet must not move: not while it is open, and not as a side effect of closing it.
const tallHistory = () => Array.from({ length: 40 }, (_, i) => meal(`m${i}`, Date.now() - (i + 1) * 3 * 3600000, { mealDose: 4, totalCarbs: 50 }));
const listTop = dev => dev.eval(`Math.round(document.getElementById("history-groups").getBoundingClientRect().top)`);
const swipe = async (dev, x, y, dy) => { await dev.cdp.send("Input.synthesizeScrollGesture", { x, y, yDistance: dy, speed: 1500, gestureSourceType: "touch" }); await sleep(500); };

{
  const dev = await kbDevice(stateBlob({ history: tallHistory() }), "Page lock: the page behind the sheet stays exactly where it was, and returns there on close");
  await ready(dev);
  await dev.tab("history"); await sleep(300);
  await dev.eval(`window.scrollTo(0, 600)`); await sleep(300);
  const before = await listTop(dev);
  t.check("sanity: the history page really is scrolled down", (await dev.eval(`Math.round(window.scrollY)`)) === 600 && before < 0, String(before));
  await dev.click("#btn-log-basal"); await sleep(400);
  t.check("opening the sheet does not make the page jump", Math.abs((await listTop(dev)) - before) <= 2, `${before} -> ${await listTop(dev)}`);
  t.check("the page is pinned in place (not just overflow-hidden, which iPhone Safari ignores)", await dev.eval(`getComputedStyle(document.body).position === "fixed"`));
  await swipe(dev, 200, 100, -300);
  t.check("swiping on the dimmed area does not move the page behind", Math.abs((await listTop(dev)) - before) <= 2, `${before} -> ${await listTop(dev)}`);
  t.check("touches on the dimmed area are swallowed", await dev.eval(`(() => { const e = new Event("touchmove", { bubbles: true, cancelable: true }); document.querySelector(".sheet-backdrop").dispatchEvent(e); return e.defaultPrevented; })()`));
  t.check("but touches inside the sheet are left alone, so the sheet itself can scroll", await dev.eval(`(() => { const e = new Event("touchmove", { bubbles: true, cancelable: true }); document.querySelector("#basal-title").dispatchEvent(e); return !e.defaultPrevented; })()`));
  await dev.eval(`window.__setVV(529)`); await dev.eval(`document.getElementById("basal-units").focus()`); await sleep(900);
  t.check("typing with the keyboard up does not move the page behind either", Math.abs((await listTop(dev)) - before) <= 2, `${before} -> ${await listTop(dev)}`);
  await dev.eval(`window.__setVV(874)`); await sleep(100);
  await dev.click("#basal-cancel"); await sleep(300);
  t.check("closing puts the page back at 600 (it used to jump to the top)", (await dev.eval(`Math.round(window.scrollY)`)) === 600, String(await dev.eval(`Math.round(window.scrollY)`)));
  t.check("and the list is exactly where it was", Math.abs((await listTop(dev)) - before) <= 2, `${before} -> ${await listTop(dev)}`);
  t.check("the page is released (no longer pinned, no leftover offset)", await dev.eval(`getComputedStyle(document.body).position !== "fixed" && document.body.style.top === ""`));
  await dev.eval(`window.scrollTo(0, 1500)`); await sleep(300);
  const second = await listTop(dev);
  await dev.click("#btn-log-basal"); await sleep(300); await pressEscape(dev);
  t.check("a second open/close from a different position also restores it (Escape this time)", (await dev.eval(`Math.round(window.scrollY)`)) === 1500 && Math.abs((await listTop(dev)) - second) <= 2, `${second} -> ${await listTop(dev)}`);
  await noErrors(dev, "device");
  dev.close();
}

{
  const dev = await device(stateBlob({ history: tallHistory() }), "Page lock: other sheets (editing a meal) hold the page and release it the same way");
  await ready(dev);
  await dev.tab("history"); await sleep(300);
  await dev.eval(`document.getElementById("history-groups").querySelector('[data-id="m20"]').scrollIntoView({ block: "center" })`); await sleep(300);
  const y = await dev.eval(`Math.round(window.scrollY)`), before = await listTop(dev);
  t.check("sanity: scrolled partway down the list", y > 100, String(y));
  await dev.eval(`document.getElementById("history-groups").querySelector('[data-id="m20"]').click()`); await sleep(150);
  const withDetail = await listTop(dev);
  await dev.click('[data-edit="m20"]'); await sleep(350);
  t.check("opening the edit sheet doesn't move the list", Math.abs((await listTop(dev)) - withDetail) <= 2, `${withDetail} -> ${await listTop(dev)}`);
  await dev.click("#em-cancel"); await sleep(300);
  t.check("closing it returns the page to the same place", Math.abs((await dev.eval(`Math.round(window.scrollY)`)) - y) <= 2 && Math.abs((await listTop(dev)) - withDetail) <= 2, `${y} -> ${await dev.eval(`Math.round(window.scrollY)`)}`);
  await noErrors(dev, "device");
  dev.close();
}

// ---------------------------------------------------------------------------
// The page behind a sheet must not move, and must come back exactly where it was.
const longHistory = () => Array.from({ length: 40 }, (_, i) => meal(`lm${i}`, dayAgo(0, 9) - i * 3 * 3600000, { mealDose: 4, totalCarbs: 50 }));
const firstTop = dev => dev.eval(`Math.round(document.querySelector("#history-groups .history-entry").getBoundingClientRect().top)`);
const bodyPos = dev => dev.eval(`getComputedStyle(document.body).position`);

{
  const dev = await device(stateBlob({ history: longHistory() }), "Background: the page behind the basal sheet is pinned, and returns exactly where it was");
  await ready(dev);
  await dev.tab("history"); await sleep(250);
  await dev.eval(`window.scrollTo(0, 400)`); await sleep(200);
  const y0 = await dev.eval(`Math.round(window.scrollY)`), top0 = await firstTop(dev);
  t.check("sanity: the page really is scrolled (400px down) before the sheet opens", y0 === 400, String(y0));
  await dev.eval(`document.getElementById("btn-log-basal").click()`); await sleep(350);
  t.check("opening the sheet doesn't make the page behind jump", Math.abs((await firstTop(dev)) - top0) <= 1, `${top0} -> ${await firstTop(dev)}`);
  t.check("the page is pinned in place", (await bodyPos(dev)) === "fixed");
  await dev.eval(`window.scrollTo(0, 900); document.documentElement.scrollTop = 900; document.body.scrollTop = 900`); await sleep(200);
  t.check("trying to scroll the page behind does nothing", Math.abs((await firstTop(dev)) - top0) <= 1, `${top0} -> ${await firstTop(dev)}`);
  const touch = sel => dev.eval(`(() => { const e = new TouchEvent("touchmove", { cancelable: true, bubbles: true }); document.querySelector(${JSON.stringify(sel)}).dispatchEvent(e); return e.defaultPrevented; })()`);
  t.check("dragging on the dimmed area outside the sheet is swallowed", (await touch(".sheet-backdrop")) === true);
  t.check("but dragging inside the sheet is left alone (so it can still scroll)", (await touch("#basal-title")) === false);
  t.check("a drag at the end of the sheet can't chain on to the page behind", await dev.eval(`getComputedStyle(document.querySelector(".basal-sheet")).overscrollBehaviorY === "contain"`));
  await dev.click("#basal-cancel"); await sleep(300);
  t.check("closing puts the page back exactly where it was", (await dev.eval(`Math.round(window.scrollY)`)) === y0, String(await dev.eval(`window.scrollY`)));
  t.check("and nothing on screen moved", Math.abs((await firstTop(dev)) - top0) <= 1, `${top0} -> ${await firstTop(dev)}`);
  t.check("the page can scroll again", (await bodyPos(dev)) !== "fixed" && (await dev.eval(`document.body.style.top`)) === "");
  await noErrors(dev, "device");
  dev.close();
}

{
  const recent = meal("rc", Date.now() - 45 * 60000, { mealDose: 4, totalCarbs: 50 });
  const dev = await device(stateBlob({ history: [recent] }), "Background: the Active Insulin sheet and the What's New sheet pin the page too, and closing them doesn't throw it to the top");
  await ready(dev);
  const tall = view => dev.eval(`document.getElementById(${JSON.stringify(view)}).style.paddingBottom = "3000px"`);
  const scrollTo = async y => { await dev.eval(`window.scrollTo(0, ${y})`); await sleep(200); return dev.eval(`Math.round(window.scrollY)`); };
  await tall("view-calculator");
  const y1 = await scrollTo(300);
  t.check("sanity: the calculator page is scrolled 300px", y1 === 300, String(y1));
  await dev.click(".active-panel"); await sleep(350);
  t.check("Active Insulin sheet: the page behind is pinned", (await bodyPos(dev)) === "fixed");
  await dev.click("#aiog-close"); await sleep(350);
  t.check("closing it leaves the page where it was (not at the top)", (await dev.eval(`Math.round(window.scrollY)`)) === 300, String(await dev.eval(`window.scrollY`)));
  t.check("and un-pins the page", (await bodyPos(dev)) !== "fixed");

  await dev.tab("settings"); await sleep(250); await tall("view-settings");
  const y2 = await scrollTo(500);
  await dev.eval(`document.getElementById("btn-open-changelog").click()`); await sleep(350);
  t.check("What's New sheet: the page behind is pinned", (await bodyPos(dev)) === "fixed");
  await dev.click("#cl-close"); await sleep(350);
  t.check("closing it leaves the settings page where it was", (await dev.eval(`Math.round(window.scrollY)`)) === y2, `${y2} -> ${await dev.eval(`window.scrollY`)}`);
  await noErrors(dev, "device");
  dev.close();
}

// ---------------------------------------------------------------------------
// Trends: the "Daily basal insulin" chart.
// Three complete days of morning + evening doses (14+16, 15+17, 16+18) and today's morning dose only.
const basalDays = () => [
  seedBasal(14, "am", dayAgo(3, 8)), seedBasal(16, "pm", dayAgo(3, 20)),
  seedBasal(15, "am", dayAgo(2, 8)), seedBasal(17, "pm", dayAgo(2, 20)),
  seedBasal(16, "am", dayAgo(1, 8)), seedBasal(18, "pm", dayAgo(1, 20)),
  seedBasal(14, "am", dayAgo(0, 8, 1))
];
const dailyMeals = () => [3, 2, 1, 0].map(d => meal("tm" + d, dayAgo(d, 12), { mealDose: 4, totalCarbs: 50 }));
const openTrends = async dev => { await ready(dev); await dev.tab("history"); await sleep(250); await dev.eval(`document.querySelector('[data-seg="trends"]').click()`); await sleep(500); };
const tapDay = (dev, chart, idx) => dev.eval(`document.querySelector('#${chart} .trend-chart__hit[data-idx="${idx}"]').dispatchEvent(new MouseEvent("click", { bubbles: true }))`);
const count = (dev, sel) => dev.eval(`document.querySelectorAll(${JSON.stringify(sel)}).length`);

{
  const dev = await device(stateBlob({ history: [...dailyMeals(), ...basalDays()] }), "Basal trend: a chart of the daily basal dose, morning and evening stacked, with an average");
  await openTrends(dev);
  t.check("the Daily basal insulin card is showing, under the insulin dose card", await dev.eval(`(() => { const c = document.getElementById("trend-card-basal"); return !c.hidden && /Daily basal insulin/.test(c.textContent) && c.getBoundingClientRect().top > document.getElementById("trend-card-dose").getBoundingClientRect().top; })()`));
  t.check("the average is over complete days only: (30 + 32 + 34) / 3 = 32 u, today's half-finished day left out", (await dev.text("#trend-chart-basal .trend-readout")) === "Avg 32 u / day · tap a day for details", await dev.text("#trend-chart-basal .trend-readout"));
  t.check("morning and evening averages are shown separately (15 and 17)", (await dev.text("#trend-chart-basal .trend-caption")) === "Morning avg 15 u · Evening avg 17 u", await dev.text("#trend-chart-basal .trend-caption"));
  t.check("a legend names the two colours", /Morning/.test(await dev.text("#trend-chart-basal .trend-legend")) && /Evening/.test(await dev.text("#trend-chart-basal .trend-legend")));
  t.check("there's a morning segment for each of the 4 days with a morning dose, and an evening one for the 3 with an evening dose", (await count(dev, "#trend-chart-basal .trend-chart__bar--basal-am")) === 4 && (await count(dev, "#trend-chart-basal .trend-chart__bar--basal-pm")) === 3);
  t.check("days with no basal show as the thin empty marker, like the other charts (14-day range: 10 of them)", (await count(dev, "#trend-chart-basal .trend-chart__bar--empty")) === 10);
  const h = sel => dev.eval(`Array.from(document.querySelectorAll("#trend-chart-basal ${sel}")).map(r => +r.getAttribute("height"))`);
  const am = await h(".trend-chart__bar--basal-am"), pm = await h(".trend-chart__bar--basal-pm");
  t.check("bar heights are to scale: 14 : 15 : 16 across the mornings, 16 : 17 : 18 across the evenings", Math.abs(am[1] / am[0] - 15 / 14) < 0.02 && Math.abs(am[2] / am[0] - 16 / 14) < 0.02 && Math.abs(pm[1] / pm[0] - 17 / 16) < 0.02 && Math.abs(pm[2] / pm[0] - 18 / 16) < 0.02, JSON.stringify({ am, pm }));
  t.check("and a morning dose is drawn to the same scale as an evening one (the 16u morning and 16u evening are equal height)", Math.abs(am[2] - pm[0]) < 0.6, JSON.stringify({ am, pm }));
  t.check("today's bar is drawn lighter, as in the other charts (it isn't finished)", (await count(dev, "#trend-chart-basal .trend-chart__bar--today")) >= 1);
  await noErrors(dev, "device");
  dev.close();
}

{
  const dev = await device(stateBlob({ history: [...dailyMeals(), ...basalDays()] }), "Basal trend: tapping a day shows its doses and highlights that day in every chart");
  await openTrends(dev);
  await tapDay(dev, "trend-chart-basal", 11);                                        // two days ago: 15 + 17
  t.check("the readout gives that day's morning and evening doses", /32 u basal \(morning 15 \+ evening 17\)/.test(await dev.text("#trend-chart-basal .trend-readout")), await dev.text("#trend-chart-basal .trend-readout"));
  t.check("both segments of that day's bar are highlighted", (await count(dev, "#trend-chart-basal .trend-chart__bar.is-selected")) === 2);
  t.check("the same day is highlighted in the carbs chart and the insulin dose chart too", (await count(dev, "#trend-chart-carbs .trend-chart__bar.is-selected")) === 1 && (await count(dev, "#trend-chart-dose .trend-chart__bar.is-selected")) >= 1);
  await tapDay(dev, "trend-chart-carbs", 12);
  t.check("and tapping a day in ANOTHER chart updates the basal readout (one day ago: 16 + 18)", /34 u basal \(morning 16 \+ evening 18\)/.test(await dev.text("#trend-chart-basal .trend-readout")), await dev.text("#trend-chart-basal .trend-readout"));
  await tapDay(dev, "trend-chart-basal", 0);
  t.check("a day with no basal says so", /no basal logged/.test(await dev.text("#trend-chart-basal .trend-readout")), await dev.text("#trend-chart-basal .trend-readout"));
  await tapDay(dev, "trend-chart-basal", 0);
  t.check("tapping it again clears the selection everywhere", (await dev.text("#trend-chart-basal .trend-readout")) === "Avg 32 u / day · tap a day for details" && (await count(dev, ".trend-chart__bar.is-selected")) === 0);
  await tapDay(dev, "trend-chart-basal", 13);                                        // today: morning only
  t.check("today shows just the morning dose so far", /14 u basal \(morning 14\)/.test(await dev.text("#trend-chart-basal .trend-readout")), await dev.text("#trend-chart-basal .trend-readout"));
  await noErrors(dev, "device");
  dev.close();
}

{
  const dev = await device(stateBlob({ history: [...dailyMeals(), ...basalDays()] }), "Basal trend: follows the 7 / 14 / 30 day range like the other charts");
  await openTrends(dev);
  for (const [days, label] of [[7, "7 days"], [30, "30 days"], [14, "14 days"]]) {
    await dev.eval(`Array.from(document.querySelectorAll("#trends-range-segmented .segmented__btn")).find(b => b.textContent.trim() === ${JSON.stringify(label)}).click()`); await sleep(400);
    t.check(`${label}: ${days} days across the basal chart`, (await count(dev, "#trend-chart-basal .trend-chart__hit")) === days, String(await count(dev, "#trend-chart-basal .trend-chart__hit")));
    t.check(`${label}: the average is unchanged (32 u: the same complete days)`, (await dev.text("#trend-chart-basal .trend-readout")).startsWith("Avg 32 u"));
  }
  await noErrors(dev, "device");
  dev.close();
}

{
  const dev = await device(stateBlob({ history: basalDays() }), "Basal trend: with basal logged but no meals, the chart still shows (it isn't called empty)");
  await openTrends(dev);
  t.check("the 'nothing logged' message is NOT shown", await dev.eval(`document.getElementById("trends-empty").hidden`));
  t.check("the basal chart is", await dev.eval(`!document.getElementById("trend-card-basal").hidden`) && (await dev.text("#trend-chart-basal .trend-readout")).startsWith("Avg 32 u"));
  t.check("the meal charts are hidden, since there are no meals", await dev.eval(`["trend-card-carbs", "trend-card-dose", "trend-card-meals"].every(id => document.getElementById(id).hidden)`));
  await tapDay(dev, "trend-chart-basal", 12);
  t.check("tapping a day still works with only this chart", /34 u basal/.test(await dev.text("#trend-chart-basal .trend-readout")), await dev.text("#trend-chart-basal .trend-readout"));
  await noErrors(dev, "device");
  dev.close();
}

{
  const dev = await device(stateBlob({ history: dailyMeals() }), "Basal trend: meals but no basal -- no empty basal card cluttering the page");
  await openTrends(dev);
  t.check("the basal card is hidden", await dev.eval(`document.getElementById("trend-card-basal").hidden`));
  t.check("the meal charts are showing as before", await dev.eval(`["trend-card-carbs", "trend-card-dose", "trend-card-meals"].every(id => !document.getElementById(id).hidden)`));
  t.check("and no leftover basal marker on the page", !(await dev.eval(`document.getElementById("history-trends-panel").classList.contains("has-basal")`)));
  await tapDay(dev, "trend-chart-carbs", 12);
  t.check("tap-a-day in the other charts works exactly as before", (await count(dev, "#trend-chart-carbs .trend-chart__bar.is-selected")) === 1);
  await noErrors(dev, "device");
  dev.close();
}

{
  const dev = await device(stateBlob({}), "Basal trend: nothing logged at all -- the usual empty message, and no basal card");
  await openTrends(dev);
  t.check("the empty message is shown", !(await dev.eval(`document.getElementById("trends-empty").hidden`)));
  t.check("no basal card", await dev.eval(`document.getElementById("trend-card-basal").hidden`));
  await noErrors(dev, "device");
  dev.close();
}

{
  const dev = await device(stateBlob({ history: dailyMeals() }), "Basal trend: logging a dose makes the chart appear");
  await ready(dev);
  await openBasal(dev); await setBasalDose(dev, 14); await dev.click("#basal-save"); await sleep(400);
  await dev.eval(`document.querySelector('[data-seg="trends"]').click()`); await sleep(500);
  t.check("the card is there, built from the dose just logged", await dev.eval(`!document.getElementById("trend-card-basal").hidden`) && (await dev.text("#trend-chart-basal .trend-readout")).startsWith("Avg 14 u"), await dev.text("#trend-chart-basal .trend-readout"));
  await noErrors(dev, "device");
  dev.close();
}

await app.close();
process.exit(t.summary() ? 0 : 1);
