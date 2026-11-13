// Mouse layout (2.104.0): on a computer with a mouse the app is denser (14px text, tighter controls), shows hover
// actions on log rows, lets you click a meal's grams to change them, and moves between days with the arrow keys.
// iPhone and iPad (touchscreens) keep the touch layout. Settings > General > Layout overrides it on that device only.
// Usage: [ML_WIDTH=1280] [SHOTS=<dir>] node tests/e2e/mouse-layout.e2e.js
import { startApp, openDevice, makeChecker, seedLocal } from "./harness.js";
import { FOODS_JS, stateBlob, meal } from "./helpers.js";

const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SHOTS = process.env.SHOTS || "";
const W = Number(process.env.ML_WIDTH || 1280);
const app = await startApp(DIR, null, { "foods_data.js": FOODS_JS, "manifest.json": "{}" });
const d = new Date(); const at = (daysAgo, h) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - daysAgo, h).getTime();
const hist = [meal("m1", at(0, 8), { mealType: "breakfast", periodName: "breakfast" }), meal("m2", at(1, 13)), meal("m3", at(2, 13))].sort((a, b) => b.ts - a.ts);
const seed = seedLocal(stateBlob({ history: hist, settings: { darkModeAuto: false, darkMode: false } }));
const boot = opts => openDevice(app, { width: W, height: 900, wait: 1500, inject: `if (!localStorage.getItem("insulinBuddy.v2")) { ${seed} }`, ...opts });
const look = dev => dev.eval(`(() => { const cs = getComputedStyle(document.body), h = document.documentElement;
  const btn = document.querySelector("#view-calculator .btn--primary, .btn--primary");
  return { mode: h.dataset.input, rem: getComputedStyle(h).getPropertyValue("--rem").trim(), body: cs.fontSize }; })()`);

t.section("A PC WITH A MOUSE");
let dev = await boot({ mobile: false });
let L = await look(dev);
t.check("picks the mouse layout by itself", L.mode === "mouse", JSON.stringify(L));
const fsBody = await dev.eval(`getComputedStyle(document.documentElement).getPropertyValue("--fs-body").trim()`);
t.check("text base is 14px", L.rem === "14px" && /14px/.test(await dev.eval(`getComputedStyle(document.querySelector(".segmented__btn")).fontSize`) + (await dev.eval(`getComputedStyle(document.querySelector(".field__row input, input[type=text]")).fontSize`))), JSON.stringify(L) + fsBody);
const fs = await dev.eval(`getComputedStyle(document.documentElement).getPropertyValue("--fs-xs").trim()`);
t.check("small print has a floor of 11px", fs === "11px", fs);
// Calculator: the meal's grams can be clicked and typed into straight away.
await dev.tab("calculator"); await sleep(300);
await dev.waitFor(`document.getElementById("cc-food-list").children.length > 0`);
await dev.eval(`document.getElementById("cc-food-list").children[0].click()`);
await dev.eval(`(() => { const g = document.getElementById("cc-grams"); g.value = "100"; g.dispatchEvent(new Event("input", { bubbles: true })); })()`);
await dev.click("#cc-add-btn"); await sleep(400);
const g = await dev.eval(`(() => { const i = document.querySelector(".meal-item__grams-input"); if (!i) return null; return { pe: getComputedStyle(i).pointerEvents, cursor: getComputedStyle(i).cursor }; })()`);
t.check("a meal's grams are clickable with a mouse (no swipe needed)", g && g.pe === "auto" && g.cursor === "text", JSON.stringify(g));
if (g) {
  await dev.eval(`(() => { const i = document.querySelector(".meal-item__grams-input"); i.focus(); i.value = "150"; i.dispatchEvent(new Event("input", { bubbles: true })); i.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); })()`); await sleep(300);
  const after = await dev.eval(`({ editing: document.querySelector(".meal-item__grams-input").classList.contains("is-editing"), focused: document.activeElement.classList.contains("meal-item__grams-input"), carbs: document.querySelector(".meal-item__carbs").textContent })`);
  t.check("typing grams updates the carbs; Enter finishes", !after.editing && !after.focused && /^\d/.test(after.carbs), JSON.stringify(after));
}
if (SHOTS) await dev.shot(`${SHOTS}/mouse-calculator-${W}.png`);
// Log: Use again / Edit / Delete appear when pointing at a row.
await dev.tab("history"); await sleep(500);
const acts = sel => dev.eval(`(() => { const r = document.querySelector('.hs-row[data-id="m2"]'); const a = r.querySelector(".hs-actions"); const b = r.querySelector(".hs-actions__edit"); const rr = r.getBoundingClientRect(), br = b.getBoundingClientRect();
  return { opacity: getComputedStyle(a).opacity, vis: getComputedStyle(b).visibility, inside: br.left >= rr.left && br.right <= rr.right + 1 && br.width > 0, x: Math.round(br.left + br.width / 2), y: Math.round(br.top + br.height / 2) }; })()`);
await dev.eval(`document.querySelector('.hs-row[data-id="m2"]').scrollIntoView({ block: "center" })`); await sleep(200);
let a0 = await acts();
t.check("row actions are hidden until you point at the row", a0.opacity === "0" && a0.vis === "hidden", JSON.stringify(a0));
const pos = await dev.eval(`(() => { const r = document.querySelector('.hs-row[data-id="m2"] .history-entry').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 3), y: Math.round(r.top + r.height / 2) }; })()`);
await dev.cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: pos.x, y: pos.y }); await sleep(300);
let a1 = await acts();
t.check("pointing at a row shows Use again / Edit / Delete on it", a1.opacity === "1" && a1.vis === "visible" && a1.inside, JSON.stringify(a1));
if (SHOTS) await dev.shot(`${SHOTS}/mouse-log-hover-${W}.png`);
await dev.cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: a1.x, y: a1.y });
await dev.cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: a1.x, y: a1.y, button: "left", clickCount: 1 });
await dev.cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: a1.x, y: a1.y, button: "left", clickCount: 1 }); await sleep(600);
const editOpen = await dev.eval(`!!document.querySelector(".sheet-backdrop")`);
t.check("clicking Edit there opens the meal to edit", editOpen);
if (editOpen) { await dev.eval(`(document.activeElement || document.body).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`); await sleep(500); }
t.check("Escape closes it", !(await dev.eval(`!!document.querySelector(".sheet-backdrop")`)));
// Glucose > Day: arrow keys move between days, and the hint says so.
await dev.eval(`document.querySelector('#history-segmented [data-seg="glucose"]').click()`); await sleep(800);
await dev.eval(`(() => { const b = document.querySelector('[data-glview="day"]'); if (b) b.click(); })()`); await sleep(900);
const dayBefore = await dev.eval(`(document.querySelector(".day-nav__label") || {}).textContent || ""`);
if (dayBefore) {
  await dev.eval(`document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }))`); await sleep(700);
  const dayAfter = await dev.eval(`document.querySelector(".day-nav__label").textContent`);
  t.check("← goes to the day before", dayAfter !== dayBefore, `${dayBefore} -> ${dayAfter}`);
  await dev.eval(`document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }))`); await sleep(700);
  t.check("→ comes back", (await dev.eval(`document.querySelector(".day-nav__label").textContent`)) === dayBefore);
  const hint = await dev.eval(`(() => { const p = document.querySelector(".day-swipe-hint"); return p ? { text: p.textContent, shown: getComputedStyle(p).display !== "none" } : null; })()`);
  t.check("the hint talks about arrows, not swiping", hint && hint.shown && /keys/.test(hint.text), JSON.stringify(hint));
} else t.check("the Day view opened", false, "no day nav found");
// Settings > General > Layout
await dev.tab("settings"); await sleep(300); await dev.click('#settings-segmented [data-seg="general"]'); await sleep(300);
const note = () => dev.eval(`document.getElementById("input-mode-note").textContent`);
const pressed = () => dev.eval(`[...document.querySelectorAll("#input-mode [data-input-mode]")].filter(b => b.getAttribute("aria-pressed") === "true").map(b => b.dataset.inputMode).join()`);
t.check("Layout shows Automatic, using Mouse", (await pressed()) === "auto" && (await note()) === "Using Mouse on this device.", await note());
if (SHOTS) await dev.shot(`${SHOTS}/mouse-settings-${W}.png`);
await dev.click('#input-mode [data-input-mode="touch"]'); await sleep(300);
L = await look(dev);
t.check("choosing Touch switches at once and is saved on this device only", L.mode === "touch" && L.rem === "1rem" && (await dev.eval(`localStorage.getItem("insulinBuddy.input")`)) === "touch" && !(await dev.eval(`JSON.stringify(JSON.parse(localStorage.getItem("insulinBuddy.v2")).settings).includes("input")`)), JSON.stringify(L));
t.check("the note says what Automatic would pick", (await note()) === "Always Touch on this device. Automatic would pick Mouse.", await note());
await dev.go("index.html", 1800);
t.check("the choice survives a reload", (await look(dev)).mode === "touch");
await dev.tab("settings"); await sleep(300); await dev.click('#settings-segmented [data-seg="general"]'); await sleep(300);
await dev.click('#input-mode [data-input-mode="auto"]'); await sleep(300);
t.check("back to Automatic: mouse again, nothing stored", (await look(dev)).mode === "mouse" && (await dev.eval(`localStorage.getItem("insulinBuddy.input")`)) === null);
t.check("no sideways scroll", await dev.eval(`document.documentElement.scrollWidth <= innerWidth + 1`));
t.check("no JS errors (PC)", (await dev.eval("window.__errs.length")) === 0, JSON.stringify(await dev.eval("window.__errs")));
dev.close();

t.section("iPAD (TOUCHSCREEN, SAME WIDTH)");
dev = await boot({ mobile: true });
L = await look(dev);
t.check("an iPad keeps the touch layout at this width", L.mode === "touch" && L.rem === "1rem", JSON.stringify(L));
await dev.tab("history"); await sleep(500);
t.check("its row actions stay behind the swipe", (await dev.eval(`getComputedStyle(document.querySelector(".hs-actions__edit")).visibility`)) === "hidden");
await dev.tab("settings"); await sleep(300); await dev.click('#settings-segmented [data-seg="general"]'); await sleep(300);
t.check("Layout says Automatic, using Touch", (await note()) === "Using Touch on this device.", await note());
await dev.click('#input-mode [data-input-mode="mouse"]'); await sleep(300);
t.check("an iPad can still choose Mouse", (await look(dev)).mode === "mouse");
t.check("no JS errors (iPad)", (await dev.eval("window.__errs.length")) === 0, JSON.stringify(await dev.eval("window.__errs")));
dev.close();

await app.close();
process.exit(t.summary() ? 0 : 1);
