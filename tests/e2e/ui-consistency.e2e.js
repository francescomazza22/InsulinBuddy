// UI sweep guard: fields share one height, and small icon buttons have a thumb-sized touch area.
import { startApp, openDevice, makeChecker, seedLocal } from "./harness.js";
import { FOODS_JS, stateBlob, meal } from "./helpers.js";
const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker(); const sleep = ms => new Promise(r => setTimeout(r, ms));
const app = await startApp(DIR, null, { "foods_data.js": FOODS_JS, "manifest.json": "{}" });
const basalSeed = slot => ({ id: "bas-" + slot, ts: Date.now() - (slot === "am" ? 30 : 31) * 3600000, entryType: "basal", mealType: "basal", periodName: slot === "am" ? "morning" : "evening", basalDose: 14, basalSlot: slot, items: [], totalCarbs: 0, totalKcal: 0, glycemicLoad: null, mealDose: 0, correctionDose: 0, noInsulin: false, glucose: null, ratioLabel: "", ratioValue: null });
const blob = stateBlob({ history: [meal("gi1", Date.now() - 3600000, { glycemicLoad: { value: 35, partial: true }, items: [{ refType: "food", refId: "s1", name: "Banana Bread", grams: 69, carbsPer100g: 41, kcalPer100g: 250, gi: 35, carbs: 28.5, kcal: 172 }, { refType: "food", refId: "s2", name: "Nutella", grams: 10, carbsPer100g: 60, kcalPer100g: 540, gi: 33, carbs: 6, kcal: 54 }] })] });
blob.recipes = [{ id: "r1", name: "Banana Bread", category: "snacks", notes: "", favorite: false, usageCount: 0, rawWeight: null, finalWeight: 559, items: [{ foodId: "s1", name: "Zucchero", grams: 87, carbsPer100g: 100, kcalPer100g: 400 }] }];
const dev = await openDevice(app, { width: 390, height: 844, mobile: true, inject: `if (!localStorage.getItem("insulinBuddy.v2")) { ${seedLocal(blob)} }`, wait: 1800 });
const heights = scope => dev.eval(`(() => { const s = document.querySelector(${JSON.stringify(scope)}) || document.body; return [...s.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=hidden]):not([data-field]):not(.ingredient-row__input):not(.meal-item__grams-input), select')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !e.closest('[hidden]') && !e.closest('.field__row') && !e.closest('.basal-dose-row'); }).map(e => ({ id: e.id || e.name || e.type, h: Math.round(e.getBoundingClientRect().height) })); })()`);
const hitSize = sel => dev.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2; const reach = (dx, dy) => { let n = 0; for (let k = 1; k <= 30; k++) { const el = document.elementFromPoint(cx + dx * (r.width / 2 + k - 1), cy + dy * (r.height / 2 + k - 1)); if (el && (el === e || e.contains(el))) n = k; else break; } return n; }; return { w: Math.round(r.width + reach(1, 0) + reach(-1, 0)), h: Math.round(r.height + reach(0, 1) + reach(0, -1)) }; })()`);
t.section("UI: every field is the same height");
await dev.tab("settings"); await sleep(300);
let hs = await heights("#view-settings");
t.check("Settings: text boxes, number boxes and dropdowns all match", hs.length >= 3 && new Set(hs.map(x => x.h)).size === 1, JSON.stringify(hs));
t.check("including the dropdowns that used to be 22px tall", hs.some(x => /set-units|set-rounding/.test(x.id)), hs.map(x => x.id).join());
await dev.tab("library"); await dev.eval(`document.querySelector("[data-seg=recipes]").click()`); await sleep(200);
await dev.eval(`document.querySelector("[data-act=edit][data-id=r1]").click()`); await sleep(500);
hs = await heights(".sheet-backdrop");
t.check("Recipe sheet: name, category, search, grams and weights all match", hs.length >= 6 && new Set(hs.map(x => x.h)).size === 1, JSON.stringify(hs));
const close = await hitSize("#rs-close"), back = await hitSize("#rs-back");
t.check("close and back buttons have a 44px touch area", close && close.w >= 44 && close.h >= 44 && back && back.h >= 44, JSON.stringify({ close, back }));
await dev.eval(`document.getElementById("rs-cancel").click()`); await sleep(300);
await dev.eval(`document.getElementById("lib-add-btn").click()`); await sleep(300);
await dev.eval(`document.querySelector("[data-seg=foods]").click()`); await sleep(100);
await dev.eval(`document.querySelector(".sheet-backdrop") && document.querySelector(".sheet-backdrop").remove(); document.body.classList.remove("sheet-open")`);
await dev.tab("history"); await sleep(200);
await dev.eval(`document.getElementById("btn-log-basal").click()`); await sleep(400);
hs = await heights(".sheet-backdrop");
t.check("Basal sheet: the dose and date boxes match", hs.length >= 1 && new Set(hs.map(x => x.h)).size === 1, JSON.stringify(hs));
const bc = await hitSize("#basal-close");
t.check("basal close has a 44px touch area", bc && bc.w >= 44 && bc.h >= 44, JSON.stringify(bc));

t.section("UI: tiles share one scale");
await dev.tab("calculator"); await sleep(300);
await dev.eval(`document.querySelector(".food-pick-item").click()`); await sleep(300);
await dev.eval(`(() => { const g = document.getElementById("cc-grams"); g.value = "80"; g.dispatchEvent(new Event("input", { bubbles: true })); const b = document.getElementById("cc-add-btn"); if (b) b.click(); })()`); await sleep(500);
const tile = await dev.eval(`(() => { const m = document.querySelector(".meal-item"); const i = m && m.querySelector(".meal-item__grams-input"); return m ? { tile: Math.round(m.getBoundingClientRect().height), input: i ? Math.round(i.getBoundingClientRect().height) : 0 } : null; })()`);
t.check("the Current meal tile is compact (under 80px) and its grams text is not stretched", tile && tile.tile > 40 && tile.tile < 80 && tile.input < 30, JSON.stringify(tile));
const gap = await dev.eval(`(() => { const i = document.querySelector(".meal-item__grams-input"); const r = document.createRange(); r.selectNodeContents(i.parentNode); const meta = i.parentNode.getBoundingClientRect(); const ir = i.getBoundingClientRect(); return { input: Math.round(ir.width), fs: [getComputedStyle(i).fontSize, getComputedStyle(i.parentNode).fontSize] }; })()`);
t.check("the grams box hugs its digits (no hole before the g) and uses the line's font size", gap.input < 26 && gap.fs[0] === gap.fs[1], JSON.stringify(gap));

t.section("UI: the dose card keeps one compact scale");
await dev.click("#cc-correction-toggle"); await sleep(200);
await dev.click("#cc-correction-manual-link"); await sleep(200);
await dev.eval(`(() => { const i = document.getElementById("cc-correction-manual-input"); i.value = "0.5"; i.dispatchEvent(new Event("input", { bubbles: true })); })()`); await sleep(300);
const dc = await dev.eval(`(() => { const h = s => Math.round(document.querySelector(s).getBoundingClientRect().height); const b = document.getElementById("cc-dose-breakdown"), c = document.querySelector(".dose-card__controls"); const br = b.getBoundingClientRect(), cr = c.getBoundingClientRect(), vr = document.querySelector(".dose-card__value-row").getBoundingClientRect(); return { sign: h(".correction-sign__btn"), input: h("#cc-correction-manual-input"), above: Math.round(br.top - vr.bottom), below: Math.round(cr.top - br.bottom), hidden: b.hidden }; })()`);
t.check("Add/Subtract is a slim switch (under 40px) and the number box is a 44px thumb target", dc.sign < 40 && dc.input === 44, JSON.stringify(dc));
t.check("the dose breakdown has the same gap above and below it", !dc.hidden && Math.abs(dc.above - dc.below) <= 2, JSON.stringify(dc));

t.section("UI: the log's GI chip stays whole");
await dev.tab("history"); await sleep(400);
const chip = await dev.eval(`(() => { const g = document.querySelector('[data-id="gi1"] .history-entry__foods .gl-indicator'); if (!g) return null; return { rects: g.getClientRects().length, h: Math.round(g.getBoundingClientRect().height) }; })()`);
t.check("the GI chip in a log row is one piece on one line", chip && chip.rects === 1 && chip.h <= 20, JSON.stringify(chip));
t.section("UI: every text field has a clear X while editing, and nothing opens pre-selected");
await dev.cdp.send("Page.bringToFront"); await dev.cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });   // headless Chrome only delivers focus and key events to a front, focused page
await dev.tab("settings"); await dev.click('#settings-segmented [data-seg="ratios"]'); await sleep(200);
const cx = await dev.eval(`(() => { const i = document.getElementById("set-isf"); i.focus(); const b = document.querySelector(".field-clear"); if (!b || !b.isConnected) return { shown: false }; const ir = i.getBoundingClientRect(), br = b.getBoundingClientRect(); let fired = 0; i.addEventListener("input", () => fired++, { once: true }); b.click(); return { shown: true, inside: br.left > ir.left + ir.width / 2 && br.right <= ir.right + 1 && br.top >= ir.top && br.bottom <= ir.bottom + 1, value: i.value, fired, focused: document.activeElement === i, goneWhenEmpty: !b.isConnected }; })()`);
t.check("a Settings number field shows an X inside its right-hand end while focused", cx.shown && cx.inside, JSON.stringify(cx));
t.check("tapping the X empties the field, tells the app, and keeps the keyboard up", cx.value === "" && cx.fired === 1 && cx.focused && cx.goneWhenEmpty, JSON.stringify(cx));
await dev.eval(`document.activeElement.blur()`); await sleep(100);
await dev.tab("history"); await sleep(200);
const hx = await dev.eval(`(() => { const i = document.getElementById("history-search"); i.focus(); i.value = "pane"; i.dispatchEvent(new Event("input", { bubbles: true })); const b = document.querySelector(".field-clear"); const shown = !!b && b.isConnected; i.blur(); return { shown, hiddenAfterBlur: !document.querySelector(".field-clear") }; })()`);
t.check("the meal search gets the same X, and it goes away when you leave the field", hx.shown && hx.hiddenAfterBlur, JSON.stringify(hx));
await dev.eval(`(() => { const i = document.getElementById("history-search"); i.value = ""; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
t.section("UI: the Log bar never covers the tab bar");
await dev.tab("calculator"); await sleep(300);
const lap = () => dev.eval(`(() => { const l = document.getElementById("cc-sticky-log-bar").getBoundingClientRect(), b = document.querySelector(".tabbar").getBoundingClientRect(); return Math.round(l.bottom - b.top); })()`);
const lap0 = await lap();
await dev.cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: { top: 47, bottom: 34 } }); await sleep(400);   // the iPhone home strip arriving after start-up
const lap1 = await lap();
await dev.cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: {} }).catch(() => {});
t.check("the Log bar sits on the tab bar, also when the iPhone's bottom safe area appears after start-up", lap0 === 0 && lap1 === 0, JSON.stringify({ atStart: lap0, afterSafeArea: lap1 }));
dev.close();
// Fresh device: the basal sheet opens on last time's dose with the caret after it (typing adds to it; the X clears it).
const dev2 = await openDevice(app, { width: 390, height: 844, mobile: true, inject: `if (!localStorage.getItem("insulinBuddy.v2")) { ${seedLocal(stateBlob({ history: [basalSeed("am"), basalSeed("pm")] }))} }`, wait: 1800 });
await dev2.cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
await dev2.tab("history"); await sleep(300);
await dev2.eval(`document.getElementById("btn-log-basal").click()`); await sleep(600);
const before = await dev2.eval(`document.getElementById("basal-units").value`);
await dev2.cdp.send("Input.insertText", { text: "5" }); await sleep(100);   // a pre-selected box would be replaced by the "5"
const after = await dev2.eval(`document.getElementById("basal-units").value`);
t.check("the basal dose box opens with last time's dose, not pre-selected (typing adds to it instead of wiping it)", before === "14" && after === "145", JSON.stringify({ before, after }));
dev2.close(); await app.close(); t.done && t.done(); process.exit(0);
