// Today's carbs against the average day (2.75.0): a slim bar at the bottom of the dose card.
// DC_WIDTH (default 390), DC_DARK=1, SHOTS=<dir>.
import { startApp, openDevice, makeChecker, seedLocal } from "./harness.js";
import { FOODS_JS, stateBlob, meal } from "./helpers.js";

const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SHOTS = process.env.SHOTS || "";
const W = Number(process.env.DC_WIDTH || 390), dark = process.env.DC_DARK === "1";
const app = await startApp(DIR, null, { "foods_data.js": FOODS_JS, "manifest.json": "{}" });

const d = new Date(); const at = (daysAgo, h) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - daysAgo, h, 0).getTime();
// Earlier days: 200 g and 160 g (average 180). Today so far: 90 g (a minute ago, or at midnight just after it).
const hist = [
  meal("t1", Math.max(at(0, 0), Date.now() - 60000), { totalCarbs: 90 }),
  meal("y1", at(1, 8), { totalCarbs: 50 }), meal("y2", at(1, 19), { totalCarbs: 150 }),
  meal("p1", at(3, 13), { totalCarbs: 160 }),
  { id: "bs", ts: at(1, 22), entryType: "basal", mealType: "basal", basalDose: 12, items: [], totalCarbs: 0, mealDose: 0, correctionDose: 0 }
].sort((a, b) => b.ts - a.ts);

async function boot(history) {
  const blob = stateBlob({ history, settings: { darkMode: dark, darkModeAuto: false } });
  const dev = await openDevice(app, { width: W, height: 1000, mobile: W < 1000, dark, inject: `if (!localStorage.getItem("insulinBuddy.v2")) { ${seedLocal(blob)} }`, wait: 1500 });
  await dev.tab("calculator"); await sleep(300);
  return dev;
}
const info = dev => dev.eval(`(() => { const b = document.getElementById("cc-day-carbs"); if (!b || b.hidden) return { shown: false };
  const card = document.querySelector(".dose-card").getBoundingClientRect(), r = b.getBoundingClientRect(), bar = b.querySelector(".day-carbs__bar").getBoundingClientRect();
  const w = id => document.getElementById(id).getBoundingClientRect().width / bar.width;
  return { shown: true, today: document.getElementById("cc-day-carbs-today").textContent.replace(/\\s+/g, " ").trim(), avg: document.getElementById("cc-day-carbs-avg").textContent.trim(),
    fill: w("cc-day-carbs-fill"), draft: w("cc-day-carbs-draft"), inCard: r.top >= card.top && r.bottom <= card.bottom + 0.5, height: r.height, oneLine: r.height < 28,
    over: b.classList.contains("is-over"), label: b.getAttribute("aria-label") }; })()`);

t.section(`DAY CARBS BAR (${W}px${dark ? ", dark" : ""})`);
let dev = await boot(hist);
let s = await info(dev);
console.log("  ", JSON.stringify(s));
t.check("shown at the bottom of the dose card, on one line", s.shown && s.inCard && s.oneLine, JSON.stringify(s));
t.check("today 90 g, average 180 g (basal doesn't count, empty days don't count)", s.today === "Today 90 g" && s.avg === "avg 180 g", `${s.today} | ${s.avg}`);
t.check("the bar is half full", Math.abs(s.fill - 0.5) < 0.02 && s.draft < 0.01, `${s.fill} / ${s.draft}`);
t.check("screen readers hear it in words", /Carbs today: 90 grams logged\. Your average day over the last 2 days with meals: 180 grams/.test(s.label), s.label);

// Put 46 g of carbs in the meal being built (Banana 23 g/100 g x 200 g): shows on top, lighter.
await dev.waitFor(`document.getElementById("cc-food-list").children.length > 1`, 6000);
await dev.eval(`[...document.getElementById("cc-food-list").children].find(c => /Banana/.test(c.textContent)).click()`);
await dev.eval(`(() => { const g = document.getElementById("cc-grams"); g.value = "200"; g.dispatchEvent(new Event("input", { bubbles: true })); })()`);
await dev.click("#cc-add-btn"); await sleep(400);
s = await info(dev);
t.check("the meal being built adds +46 and a lighter piece of bar", s.today === "Today 90 g +46" && Math.abs(s.draft - 46 / 180) < 0.02 && Math.abs(s.fill - 0.5) < 0.02, JSON.stringify(s));
if (SHOTS) { await dev.eval(`document.querySelector(".dose-card").scrollIntoView({ block: "start" })`); await sleep(400); await dev.shot(`${SHOTS}/day-carbs-${W}${dark ? "-dark" : ""}.png`); }
await dev.click("#cc-log-btn"); await sleep(600);
s = await info(dev);
t.check("once logged it counts as today's: 136 g", s.today === "Today 136 g" && Math.abs(s.fill - 136 / 180) < 0.02 && s.draft < 0.01, JSON.stringify(s));

// More than the average: the bar stays full and the average is picked out.
await dev.eval(`document.getElementById("cc-food-list").children[0].click()`);
await dev.eval(`(() => { const g = document.getElementById("cc-grams"); g.value = "100"; g.dispatchEvent(new Event("input", { bubbles: true })); })()`);
await dev.click("#cc-add-btn"); await sleep(300);
s = await info(dev);
t.check("over the average: bar full, never past its end", s.over && Math.abs(s.fill + s.draft - 1) < 0.02, JSON.stringify(s));
t.check("no sideways scroll", await dev.eval(`document.documentElement.scrollWidth <= innerWidth + 1`));
await dev.click("#cc-day-carbs"); await sleep(500);
t.check("tapping it opens Insights > Trends", await dev.eval(`!document.getElementById("view-history").hidden && document.querySelector('#history-segmented [data-seg="trends"]').classList.contains("is-active")`));
t.check("no JS errors", (await dev.eval("window.__errs.length")) === 0, JSON.stringify(await dev.eval("window.__errs")));
dev.close();

t.section("NOTHING TO COMPARE WITH");
dev = await boot([meal("t1", Math.max(at(0, 0), Date.now() - 60000), { totalCarbs: 90 })]);
t.check("with only today logged the bar stays hidden", !(await info(dev)).shown);
dev.close();

await app.close();
process.exit(t.summary() ? 0 : 1);
