// Responsive layout, end to end: the phone layout is unchanged, tablets get a navigation rail, wide screens get columns.
import { startApp, openDevice, makeChecker, seedLocal } from "./harness.js";
import { FOODS_JS, localState, stateBlob, meal } from "./helpers.js";
import { makeBasalEntry } from "../../js/history.js";

const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const app = await startApp(DIR, null, { "foods_data.js": FOODS_JS, "manifest.json": "{}" });

const now = Date.now(), H = 3600000;
const HISTORY = [
  meal("recent", now - 45 * 60000, { mealDose: 4, totalCarbs: 50 }),
  makeBasalEntry({ units: 14, ts: now - 6 * H, slot: "am", now: now - 6 * H }),
  ...Array.from({ length: 30 }, (_, i) => meal("m" + i, now - (i + 2) * 5 * H, { mealDose: 3 + (i % 3), totalCarbs: 35 + i * 2 }))
];
async function open(name, w, h, mobile = true) {
  t.section(name);
  const dev = await openDevice(app, { width: w, height: h, mobile, inject: seedLocal(stateBlob({ history: HISTORY })), wait: 1500 });
  await dev.waitFor(`document.getElementById("cc-food-list").children.length > 0`);
  return dev;
}
const noErrors = async (dev, label) => t.check(`${label}: no JS errors`, (await dev.eval("window.__errs.length")) === 0 && dev.errors.length === 0, JSON.stringify(await dev.eval("window.__errs")));
const R = (dev, sel) => dev.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const b = e.getBoundingClientRect(); return { left: Math.round(b.left), right: Math.round(b.right), top: Math.round(b.top), bottom: Math.round(b.bottom), w: Math.round(b.width), h: Math.round(b.height) }; })()`);
const css = (dev, sel, prop) => dev.eval(`getComputedStyle(document.querySelector(${JSON.stringify(sel)}))[${JSON.stringify(prop)}]`);
const addFoods = async dev => {
  for (let i = 0; i < 2; i++) {
    await dev.eval(`document.getElementById("cc-food-list").children[${i}].click()`);
    await dev.eval(`(() => { const g = document.getElementById("cc-grams"); g.value = "${110 + i * 40}"; g.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    await dev.click("#cc-add-btn"); await sleep(150);
  }
  await sleep(250);
};
// Visit every screen and sub-screen and report any that is wider than the window (a sideways scrollbar).
async function overflowing(dev) {
  const bad = [], wide = () => dev.eval(`document.documentElement.scrollWidth > innerWidth + 1 ? [document.documentElement.scrollWidth, innerWidth] : null`);
  const check = async label => { const o = await wide(); if (o) bad.push(`${label} (${o[0]} > ${o[1]})`); };
  await dev.tab("calculator"); await sleep(150); await check("calculator");
  await dev.tab("library"); await sleep(200); await check("library");
  await dev.tab("history"); await sleep(250);
  for (const seg of ["log", "trends", "glucose"]) { await dev.eval(`document.querySelector('[data-seg="${seg}"]').click()`); await sleep(350); await check("history/" + seg); }
  await dev.eval(`document.querySelector('[data-seg="log"]').click()`);
  await dev.tab("settings"); await sleep(200);
  for (const seg of ["ratios", "data", "general"]) { await dev.eval(`(document.querySelector('#settings-segmented [data-seg="${seg}"]') || {click(){}}).click()`); await sleep(250); await check("settings/" + seg); }
  await dev.tab("calculator"); await sleep(150);
  return bad;
}
const sheetBox = async dev => { await dev.tab("history"); await sleep(150); await dev.eval(`document.getElementById("btn-log-basal").click()`); await sleep(350); const r = await R(dev, ".basal-sheet"); r.radiusTop = await css(dev, ".basal-sheet", "borderTopLeftRadius"); r.radiusBottom = await css(dev, ".basal-sheet", "borderBottomLeftRadius"); return r; };
const closeSheet = async dev => { await dev.click("#basal-cancel"); await sleep(250); };

{ // ----------------------------------------------------------------------------------------------- phone
  const dev = await open("PHONE (390x844): the original layout, untouched", 390, 844);
  const tab = await R(dev, ".tabbar"), dose = await R(dev, ".dose-card"), log = await R(dev, "#cc-sticky-log-bar");
  t.check("the tab bar is a bar along the bottom of the screen, full width", tab.bottom === 844 && tab.left === 0 && tab.w === 390 && (await css(dev, ".tabbar", "flexDirection")) === "row", JSON.stringify(tab));
  t.check("the wrappers around the dose and the meal are invisible to layout", (await css(dev, ".calc-side", "display")) === "contents" && (await css(dev, ".calc-main", "display")) === "contents");
  t.check("the Calculator is one column: the meal is under the dose, not beside it", (await css(dev, "#view-calculator", "display")) !== "grid" && (await R(dev, "#cc-food-section")).top > dose.bottom);
  t.check("the dose card fills the width (18px margins)", dose.left === 18 && dose.w === 354, JSON.stringify(dose));
  t.check("the Log bar is fixed to the bottom, full width, sitting directly on the tab bar", (await css(dev, "#cc-sticky-log-bar", "position")) === "fixed" && log.left === 0 && log.w === 390 && Math.abs(log.bottom - tab.top) <= 1, JSON.stringify({ log, tabTop: tab.top }));
  t.check("the tab bar's height is measured (the Log bar sits above it)", parseInt(await dev.eval(`document.documentElement.style.getPropertyValue("--tabbar-height")`)) === tab.h);
  const sh = await sheetBox(dev);
  t.check("a pop-up is still a full-width drawer on the bottom edge", sh.bottom === 844 && sh.w === 390 && sh.radiusTop === "20px" && sh.radiusBottom === "0px", JSON.stringify(sh));
  await closeSheet(dev);
  const over = await overflowing(dev);
  t.check("no screen scrolls sideways", over.length === 0, over.join(", "));
  await noErrors(dev, "phone");
  dev.close();
}

{ // ----------------------------------------------------------------------------------------------- tablet portrait
  const dev = await open("TABLET PORTRAIT (820x1180): navigation rail, one wide column", 820, 1180);
  const rail = await R(dev, ".tabbar"), dose = await R(dev, ".dose-card"), view = await R(dev, "#view-calculator");
  t.check("the tab bar is a rail down the left edge, 92px wide, full height", rail.left === 0 && rail.w === 92 && rail.top === 0 && rail.h === 1180 && (await css(dev, ".tabbar", "flexDirection")) === "column", JSON.stringify(rail));
  const tabs = await dev.eval(`Array.from(document.querySelectorAll(".tab")).map(e => { const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top)]; })`);
  t.check("its four tabs are stacked one under another", tabs.length === 4 && tabs.every(p => p[0] === tabs[0][0]) && tabs.every((p, i) => i === 0 || p[1] > tabs[i - 1][1]), JSON.stringify(tabs));
  t.check("the content starts to the right of the rail, never under it", view.left >= 92 && dose.left >= 92, JSON.stringify({ view, dose }));
  t.check("and is a comfortable width, centred in the space beside the rail", view.w <= 720 && Math.abs((view.left + view.right) / 2 - (92 + 820) / 2) <= 6, JSON.stringify(view));
  t.check("the Calculator is still one column", (await R(dev, "#cc-food-section")).top > dose.bottom && (await css(dev, ".calc-side", "display")) === "contents");
  const log = await R(dev, "#cc-sticky-log-bar");
  t.check("the Log bar rests on the bottom edge of the content area, starting at the rail", (await css(dev, "#cc-sticky-log-bar", "position")) === "fixed" && log.bottom === 1180 && log.left === 92 && log.right === 820, JSON.stringify(log));
  const group = await dev.eval(`(() => { const r = Array.from(document.querySelectorAll("#cc-sticky-log-bar .btn")).map(e => e.getBoundingClientRect()).filter(b => b.width > 0); return { left: Math.round(Math.min(...r.map(b => b.left))), right: Math.round(Math.max(...r.map(b => b.right))) }; })()`);
  t.check("its buttons are a sensible size and centred in the content area, not stretched across the screen", group.right - group.left <= 680 && Math.abs((group.left + group.right) / 2 - (92 + 820) / 2) <= 6, JSON.stringify(group));
  t.check("nothing is measured as sitting above a bottom tab bar any more", (await dev.eval(`document.documentElement.style.getPropertyValue("--tabbar-height")`)) === "0px");
  const sh = await sheetBox(dev);
  t.check("a pop-up is a centred card, not a bottom drawer", Math.abs((sh.left + sh.right) / 2 - 410) <= 2 && sh.w <= 540 && sh.bottom < 1180 - 100 && sh.top > 100, JSON.stringify(sh));
  t.check("and its corners are rounded all round", sh.radiusTop === "20px" && sh.radiusBottom === "20px", JSON.stringify(sh));
  await closeSheet(dev);
  const over = await overflowing(dev);
  t.check("no screen scrolls sideways", over.length === 0, over.join(", "));
  await noErrors(dev, "tablet");
  dev.close();
}

for (const [name, w, h, mobile] of [["IPAD LANDSCAPE (1180x820)", 1180, 820, true], ["DESKTOP (1440x900)", 1440, 900, false]]) {
  const dev = await open(`${name}: rail plus two columns`, w, h, mobile);
  const rail = await R(dev, ".tabbar");
  t.check("the navigation rail is on the left, full height", rail.left === 0 && rail.w === 92 && rail.h === h, JSON.stringify(rail));
  await addFoods(dev);
  const dose = await R(dev, ".dose-card"), food = await R(dev, "#cc-food-section"), side = await R(dev, ".calc-side");
  t.check("the Calculator is two columns: the dose is to the LEFT of the meal", dose.right + 20 <= food.left, JSON.stringify({ dose, food }));
  t.check("and they start level with each other", Math.abs(dose.top - food.top) <= 60, JSON.stringify({ dose: dose.top, food: food.top }));
  t.check("the left column is a sensible width (340 to 400px)", side.w >= 336 && side.w <= 404, String(side.w));
  const log = await R(dev, "#cc-sticky-log-bar"), logPos = await css(dev, "#cc-sticky-log-bar", "position");
  t.check("the Log button lives under the dose in the left column, not along the bottom of the screen", logPos === "static" && log.left >= side.left - 2 && log.right <= side.right + 2 && log.top >= dose.bottom, JSON.stringify({ log, side, logPos }));
  t.check("no empty space is reserved at the bottom for a bar that isn't there", (await css(dev, ".sticky-log-spacer", "display")) === "none");
  // Make the meal column long, as a big meal would: a sticky element only travels as far as its own grid row is tall.
  await dev.eval(`document.querySelector(".calc-main").style.paddingBottom = "2600px"`); await dev.eval(`window.scrollTo(0, 700)`); await sleep(250);
  const stuck = await R(dev, ".dose-card");
  t.check("scrolling down the meal, the dose card and Log button stay in view (sticky)", stuck.top >= 0 && stuck.top <= 44 && (await R(dev, "#cc-log-btn")).bottom < h, JSON.stringify(stuck));
  await dev.eval(`window.scrollTo(0, 0); document.querySelector(".calc-main").style.paddingBottom = ""`); await sleep(150);
  const before = (await localState(dev)).history.length;
  await dev.click("#cc-log-btn"); await sleep(400);
  t.check("logging a meal from the left column works", (await localState(dev)).history.length === before + 1);

  await dev.tab("settings"); await sleep(300);
  const lefts = await dev.eval(`[...new Set(Array.from(document.querySelectorAll("#panel-ratios > .panel-card")).map(e => Math.round(e.getBoundingClientRect().left)))]`);
  t.check("Settings cards flow into two columns", lefts.length === 2 && lefts[1] - lefts[0] > 300, JSON.stringify(lefts));

  await dev.tab("history"); await sleep(300);
  const hl = await dev.eval(`[...new Set(Array.from(document.querySelectorAll("#history-groups .history-group")[0].querySelectorAll(".history-entry")).map(e => Math.round(e.getBoundingClientRect().left)))]`);
  t.check("History fits three entries across", hl.length >= 3, JSON.stringify(hl));
  await dev.eval(`document.querySelector('[data-seg="trends"]').click()`); await sleep(500);
  const c1 = await R(dev, "#trend-card-carbs"), c2 = await R(dev, "#trend-card-dose"), c3 = await R(dev, "#trend-card-meals");
  t.check("Trends puts the two charts side by side", c1.right <= c2.left && Math.abs(c1.top - c2.top) <= 2, JSON.stringify({ c1, c2 }));
  t.check("with equal heights, so the bottoms line up", Math.abs(c1.h - c2.h) <= 2, `${c1.h} vs ${c2.h}`);
  const cb = await R(dev, "#trend-card-basal");
  t.check("the Daily basal insulin chart sits under the carbs chart, in the left column", cb && cb.left === c1.left && cb.top >= Math.max(c1.bottom, c2.bottom), JSON.stringify({ cb, c1, c2 }));
  t.check("and 'By meal' sits beside it in the right column, level with it", c3.left >= cb.right && Math.abs(c3.top - cb.top) <= 2, JSON.stringify({ c3, cb }));

  const sh = await sheetBox(dev);
  t.check("a pop-up is a centred card", Math.abs((sh.left + sh.right) / 2 - w / 2) <= 2 && sh.bottom < h - 60, JSON.stringify(sh));
  await closeSheet(dev);
  const over = await overflowing(dev);
  t.check("no screen scrolls sideways", over.length === 0, over.join(", "));
  await noErrors(dev, name);
  dev.close();
}

{ // ----------------------------------------------------------------------------------------------- Trends without basal
  t.section("DESKTOP, no basal logged: 'By meal' keeps the full width and there is no empty basal slot");
  const dev = await openDevice(app, { width: 1440, height: 900, mobile: false, inject: seedLocal(stateBlob({ history: HISTORY.filter(e => e.entryType !== "basal") })), wait: 1500 });
  await dev.waitFor(`document.getElementById("cc-food-list").children.length > 0`);
  await dev.tab("history"); await sleep(300); await dev.eval(`document.querySelector('[data-seg="trends"]').click()`); await sleep(500);
  const c1 = await R(dev, "#trend-card-carbs"), c2 = await R(dev, "#trend-card-dose"), c3 = await R(dev, "#trend-card-meals");
  t.check("the basal card isn't taking up a place", await dev.eval(`document.getElementById("trend-card-basal").hidden`));
  t.check("'By meal' spans the full width under the two charts", c3.top >= Math.max(c1.bottom, c2.bottom) && c3.w >= c1.w + c2.w, JSON.stringify(c3));
  await noErrors(dev, "no basal");
  dev.close();
}

{ // ----------------------------------------------------------------------------------------------- live resizing (rotating an iPad)
  const dev = await open("LIVE RESIZE: rotating an iPad / resizing a window between layouts", 1180, 820);
  await addFoods(dev);
  t.check("wide: two columns", (await css(dev, "#view-calculator", "display")) === "grid");
  await dev.resize(820, 1180); await sleep(400);
  t.check("rotated to portrait: back to one column, rail kept", (await css(dev, "#view-calculator", "display")) !== "grid" && (await R(dev, ".tabbar")).w === 92);
  t.check("...and the Log bar is back along the bottom of the content", (await css(dev, "#cc-sticky-log-bar", "position")) === "fixed" && (await R(dev, "#cc-sticky-log-bar")).bottom === 1180);
  await dev.resize(390, 844); await sleep(400);
  const tab = await R(dev, ".tabbar");
  t.check("shrunk to a phone: the rail turns back into a bottom bar", tab.bottom === 844 && tab.w === 390 && tab.left === 0);
  t.check("...and the bar height is measured again, so the Log bar sits on it", parseInt(await dev.eval(`document.documentElement.style.getPropertyValue("--tabbar-height")`)) === tab.h && Math.abs((await R(dev, "#cc-sticky-log-bar")).bottom - tab.top) <= 1);
  await dev.resize(1440, 900); await sleep(400);
  t.check("and back out to desktop: two columns again", (await css(dev, "#view-calculator", "display")) === "grid");
  t.check("the meal being built survived all of it", (await dev.eval(`document.querySelectorAll("#cc-meal-items > *").length`)) === 2);
  await noErrors(dev, "resize");
  dev.close();
}

await app.close();
process.exit(t.summary() ? 0 : 1);
