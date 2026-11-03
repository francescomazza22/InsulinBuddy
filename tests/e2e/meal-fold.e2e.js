// 2.80.0: with several foods in the meal, the food search sat under the iPhone keyboard. While the search or the amount
// box has focus, the meal folds to one line and the search is brought near the top; it opens again once focus leaves
// the add row (keyboard closed) or when the line is tapped. Tapping a food in the list must not unfold it in between
// (that would move the list under the finger).
// MF_WIDTH (default 390), MF_DARK=1, SHOTS=<dir> for screenshots.
import { startApp, openDevice, makeChecker, seedLocal } from "./harness.js";
import { FOODS_JS, stateBlob } from "./helpers.js";
const DIR = new URL("../..", import.meta.url).pathname;
const W = Number(process.env.MF_WIDTH || 390), DARK = process.env.MF_DARK === "1", SHOTS = process.env.SHOTS;
const t = makeChecker(); const sleep = ms => new Promise(r => setTimeout(r, ms));
const app = await startApp(DIR, null, { "foods_data.js": FOODS_JS, "manifest.json": "{}" });
const blob = stateBlob({});
const dev = await openDevice(app, { width: W, height: 760, mobile: W < 1000, dark: DARK, inject: `if (!localStorage.getItem("insulinBuddy.v2")) { ${seedLocal(blob)} }`, wait: 1800 });
await dev.cdp.send("Page.bringToFront"); await dev.cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
await dev.cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
await dev.tab("calculator"); await sleep(300);

const tap = async sel => {
  const r = await dev.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.scrollIntoView({ block: "center" }); const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
  await dev.cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: r.x, y: r.y }] }); await sleep(40);
  await dev.cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await sleep(120);
};
const typeSearch = v => dev.eval(`(() => { const s = document.getElementById("cc-search"); s.value = ${JSON.stringify(v)}; s.dispatchEvent(new Event("input", { bubbles: true })); })()`);
async function addFood(name, grams) {
  await typeSearch(name); await sleep(100);
  await dev.eval(`[...document.querySelectorAll("#cc-food-list .food-pick-item")].find(e => e.textContent.includes(${JSON.stringify(name)})).click()`); await sleep(80);
  await dev.eval(`(() => { const g = document.getElementById("cc-grams"); g.value = "${grams}"; g.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await dev.eval(`document.getElementById("cc-add-btn").click()`); await sleep(120);
}
const look = () => dev.eval(`(() => {
  const sec = document.getElementById("cc-food-section"), btn = document.getElementById("cc-meal-fold"), items = document.getElementById("cc-meal-items");
  const s = document.getElementById("cc-search").getBoundingClientRect();
  return { folded: sec.classList.contains("is-folded"), btnShown: !btn.hidden && btn.offsetHeight > 0, text: btn.textContent.replace(/\\s+/g, " ").trim(),
    itemsShown: items.offsetHeight > 0, searchTop: s.top, viewH: window.innerHeight, active: document.activeElement && document.activeElement.id,
    expanded: btn.getAttribute("aria-expanded") };
})()`);
const blurAll = () => dev.eval(`document.activeElement && document.activeElement.blur()`);

t.section("MEAL FOLD: one food never folds");
await addFood("Pane comune", 50); await blurAll(); await sleep(500);
await dev.eval(`window.scrollTo(0, 0)`);
await tap("#cc-search"); await sleep(250);
let v = await look();
t.check("search focused", v.active === "cc-search", v.active);
t.check("with one food the meal stays open", !v.folded && !v.btnShown && v.itemsShown, JSON.stringify(v));
await blurAll(); await sleep(500);

t.section("MEAL FOLD: a long meal folds while searching");
for (const [n, g] of [["Pane comune", 80], ["Pane comune", 30], ["Pane comune", 120], ["Pane comune", 60]]) await addFood(n, g);
await typeSearch(""); await blurAll(); await sleep(500);
await dev.eval(`window.scrollTo(0, 0)`); await sleep(100);
const before = await look();
t.check("before: 5 foods listed, search low on the screen", before.itemsShown && before.searchTop > before.viewH * 0.5, `top ${Math.round(before.searchTop)} of ${before.viewH}`);
await tap("#cc-search"); await sleep(400);
v = await look();
t.check("tapping the search folds the meal", v.folded && v.btnShown && !v.itemsShown, JSON.stringify(v));
t.check("the line says how many foods and the carbs, with units", /^5 foods · [\d.]+g carbs Show$/.test(v.text), v.text);
t.check("aria-expanded is false while folded", v.expanded === "false", v.expanded);
t.check("the search is brought into the top third of the screen", v.searchTop >= 0 && v.searchTop < v.viewH * 0.4, `top ${Math.round(v.searchTop)} of ${v.viewH}`);
if (SHOTS) await dev.shot(`${SHOTS}/meal-fold-${W}${DARK ? "-dark" : ""}.png`);

t.section("MEAL FOLD: tapping a food keeps it folded and steady");
await typeSearch("Pane"); await sleep(150);
const rowTop = await dev.eval(`document.querySelector("#cc-food-list .food-pick-item").getBoundingClientRect().top`);
await tap("#cc-food-list .food-pick-item"); await sleep(700);
v = await look();
t.check("the amount box takes focus", v.active === "cc-grams", v.active);
t.check("still folded after the search lost focus to the amount box", v.folded && !v.itemsShown, JSON.stringify(v));
const rowTop2 = await dev.eval(`document.querySelector("#cc-food-list .food-pick-item").getBoundingClientRect().top`);
t.check("the list didn't move under the finger", Math.abs(rowTop2 - rowTop) < 2, `${Math.round(rowTop)} → ${Math.round(rowTop2)}`);
await dev.eval(`(() => { const g = document.getElementById("cc-grams"); g.value = "40"; g.dispatchEvent(new Event("input", { bubbles: true })); })()`);
await tap("#cc-add-btn"); await sleep(150);
v = await look();
t.check("the new food is counted on the line", /^6 foods/.test(v.text) || !v.folded, v.text);

t.section("MEAL FOLD: it opens again");
await blurAll(); await sleep(150);
t.check("not straight away (no jump mid-tap)", (await look()).folded, "");
await sleep(500);
v = await look();
t.check("once the keyboard is gone the meal is shown again", !v.folded && !v.btnShown && v.itemsShown, JSON.stringify(v));
t.check("6 foods in the meal", await dev.eval(`document.querySelectorAll("#cc-meal-items .meal-item").length`) === 6, "");
await tap("#cc-search"); await sleep(400);
v = await look();
t.check("folds again on the next search", v.folded, JSON.stringify(v));
await tap("#cc-meal-fold"); await sleep(250);
v = await look();
t.check("tapping the line opens the meal", !v.folded && v.itemsShown && !v.btnShown, JSON.stringify(v));
await sleep(600);
t.check("and it stays open", !(await look()).folded, "");

t.section("MEAL FOLD: removing foods below two opens it");
await tap("#cc-search"); await sleep(400);
await dev.eval(`(() => { while (document.querySelectorAll("#cc-meal-items .meal-item__remove").length > 1) document.querySelector("#cc-meal-items .meal-item__remove").click(); })()`); await sleep(200);
v = await look();
t.check("with one food left the line goes away", !v.folded && !v.btnShown, JSON.stringify(v));

const errs = [...dev.errors, ...(await dev.eval(`window.__errs || []`))];
t.check("no page errors", !errs.length, errs.join(" | "));
dev.close(); await app.close(); t.done && t.done(); process.exit(0);
