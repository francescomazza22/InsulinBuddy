// 2.77.4: the basal sheet was "a bit clogged up" (his screenshot, iPhone, dark, keyboard up, after an elliptical + gym session):
//  1. the dose box drew a second focus ring around the number (the general focus rule outranked the field's own "no ring"),
//  2. the "Active before this dose" card ran to five lines plus a full-width button that ended up under Cancel / Log dose,
//  3. with the keyboard up the sheet stopped short of iOS's floating keyboard bar, so the log showed through the gap.
// Env: TIDY_WIDTH (default 390), SHOTS=<dir>.
import { startApp, openDevice, makeChecker, seedLocal } from "./harness.js";
import { FOODS_JS, stateBlob } from "./helpers.js";
const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const W = Number(process.env.TIDY_WIDTH || 390), SHOTS = process.env.SHOTS;
const app = await startApp(DIR, null, { "foods_data.js": FOODS_JS, "manifest.json": "{}" });
const MIN = 60000, now = Date.now(), slot = new Date(now).getHours() < 14 ? "am" : "pm";
const act = (id, mins, endAgo, extra) => ({ id, ts: now - (endAgo + mins) * MIN, entryType: "activity", mealType: "activity", activityName: "", durationMin: mins, note: "",
  items: [], totalCarbs: 0, totalKcal: 0, glycemicLoad: null, mealDose: 0, correctionDose: 0, noInsulin: false, glucose: null, ratioLabel: "", ratioValue: null, ...extra });
const hist = [
  { id: "b0", ts: now - 86400000, entryType: "basal", mealType: "basal", periodName: slot === "am" ? "morning" : "evening", basalDose: 18, basalSlot: slot,
    items: [], totalCarbs: 0, totalKcal: 0, mealDose: 0, correctionDose: 0, noInsulin: false, glucose: null },
  act("a1", 24, 65, { activityType: "other", activityName: "Elliptical", intensity: "hard" }),
  act("a2", 23, 42, { activityType: "gym", intensity: "moderate" })
];
const settings = { darkMode: true, darkModeAuto: false, rounding: 0.5, basalBaseline: { am: 18, pm: 18 }, basalActivity: { enabled: true, lookbackMin: 60, minMinutes: 30, reducePct: 17 } };
for (const dark of [true, false]) {
  t.section(`${W}px, ${dark ? "dark" : "light"}`);
  const dev = await openDevice(app, { width: W, height: 844, mobile: true, dark, inject: seedLocal(stateBlob({ history: hist, settings: { ...settings, darkMode: dark } })), wait: 1500 });
  await dev.tab("history"); await dev.click('[data-seg="log"]'); await sleep(250);
  await dev.click("#btn-log-basal"); await sleep(600);
  await dev.eval(`document.getElementById("basal-units").focus()`); await sleep(150);
  // iOS treats a tapped text field as :focus-visible; headless Chrome needs a key press first, so Tab back into it
  await dev.eval(`document.getElementById("basal-units").blur()`); await dev.cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 }); await dev.cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 }); await sleep(100);
  await dev.eval(`document.getElementById("basal-units").focus()`); await sleep(150);
  const ring = await dev.eval(`(() => { const e = document.getElementById("basal-units"); return (e.matches(":focus-visible") ? "fv " : "no-fv ") + getComputedStyle(e).boxShadow; })()`);
  t.check("the number has no ring of its own inside the dose box (the box shows the focus)", ring === "fv none", ring);
  const card = await dev.eval(`(() => { const c = document.getElementById("basal-activity"); return c && !c.hidden ? { h: Math.round(c.getBoundingClientRect().height), text: c.textContent.replace(/\\s+/g, " ").trim() } : null; })()`);
  t.check("the activity card is shown, with the suggestion", !!card && /suggests 15u instead of 18u/.test(card.text), JSON.stringify(card));
  t.check("and is compact (at most 4 lines' worth)", !!card && card.h <= 100, JSON.stringify(card && card.h));
  // keyboard up: what iOS leaves above it (about 480 px on this phone), as the app's own viewport tracking would set it
  await dev.eval(`(() => { const r = document.documentElement; r.style.setProperty("--vv-top", "0px"); r.style.setProperty("--vv-height", "480px"); r.classList.add("kb-open"); })()`); await sleep(300);
  const fit = await dev.eval(`(() => { const b = document.querySelector('[data-activity="use"]').getBoundingClientRect(), a = document.querySelector(".sheet .sheet-actions").getBoundingClientRect(), s = document.querySelector(".sheet"); return { use: Math.round(b.bottom), actions: Math.round(a.top), scrolled: s.scrollTop, shadow: getComputedStyle(s).boxShadow }; })()`);
  t.check("keyboard up: Use 15u sits clear of Cancel / Log dose without scrolling", fit.use <= fit.actions && fit.scrolled === 0, JSON.stringify(fit));
  t.check("keyboard up: the sheet carries on down behind iOS's keyboard bar, so the log doesn't show through", / 0px 2\d\dpx 0px 0px/.test(fit.shadow), fit.shadow);
  if (SHOTS) await dev.shot(`${SHOTS}/basal-tidy-${W}-${dark ? "dark" : "light"}.png`);
  t.check("no JS errors", dev.errors.length === 0 && (await dev.eval("window.__errs.length")) === 0, dev.errors.join("|"));
  dev.close();
}
await app.close();
process.exit(t.summary() ? 0 : 1);
