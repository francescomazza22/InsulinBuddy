// Reopen where you left off: screen and scroll position come back on launch, but not after a long break.
// (Each launch is a fresh page with the saved place already in storage, which avoids the sandbox's reload stall.)
import { startApp, openDevice, makeChecker, seedLocal } from "./harness.js";
import { FOODS_JS, stateBlob, meal } from "./helpers.js";

const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const app = await startApp(DIR, null, { "foods_data.js": FOODS_JS });
const hist = Array.from({ length: 40 }, (_, i) => meal("m" + i, Date.now() - (i + 1) * 3600_000));
const base = seedLocal(stateBlob({ history: hist, schemaVersion: 2 }));
const launch = async place => {
  const inj = base + (place === undefined ? "" : `localStorage.setItem("insulinBuddy.place", ${JSON.stringify(place)});`);
  const dev = await openDevice(app, { height: 700, inject: inj });
  await sleep(500);
  return dev;
};
const shown = dev => dev.eval(`(Array.from(document.querySelectorAll("section.view")).find(v => !v.hidden) || {}).id`);

t.section("first launch opens the calculator");
let dev = await launch();
t.check("calculator", (await shown(dev)) === "view-calculator");
await dev.tab("history"); await sleep(300);
await dev.eval(`window.scrollTo(0, 400)`); await sleep(500);
const y0 = await dev.eval(`Math.round(window.scrollY)`);
t.check("history page scrolled", y0 > 100, String(y0));
const saved = await dev.eval(`localStorage.getItem("insulinBuddy.place")`);
const p = JSON.parse(saved);
t.check("the place was saved, with its sub-tab", p.view === "history" && p.sub.history === "log" && Math.abs(p.scroll["history:log"] - y0) < 40, saved);
dev.close();

t.section("a recent saved place is restored");
dev = await launch(saved);
t.check("reopened on History", (await shown(dev)) === "view-history", await shown(dev));
await sleep(500);
const y1 = await dev.eval(`Math.round(window.scrollY)`);
t.check("at the same scroll position", Math.abs(y1 - y0) < 40, `${y0} -> ${y1}`);
dev.close();

t.section("after a long break it opens on the calculator");
dev = await launch(JSON.stringify({ ...p, at: Date.now() - 7 * 3600_000 }));
t.check("calculator again", (await shown(dev)) === "view-calculator", await shown(dev));
dev.close();

t.section("a corrupt or unknown saved place is ignored");
dev = await launch("{nope");
t.check("corrupt: calculator, no crash", (await shown(dev)) === "view-calculator");
dev.close();
dev = await launch(JSON.stringify({ view: "nowhere", scroll: {}, at: Date.now() }));
t.check("unknown screen: calculator", (await shown(dev)) === "view-calculator");
dev.close();

// 2.68.3: Francesco: "looking at graphs in the trends tab and leave the app, it reopens half way along the meal tab. Same on
// the settings page." The sub-tab wasn't remembered, so it reopened on Meals (or Dosing) at the Trends (or other) scroll.
const activeSeg = (dev, id) => dev.eval(`(document.querySelector("#${id} .segmented__btn.is-active") || {}).dataset?.seg || null`);
const visible = (dev, id) => dev.eval(`!document.getElementById("${id}").hidden`);
const leaveAndReopen = async (dev) => {
  await dev.eval(`document.dispatchEvent(new Event("visibilitychange"))`);   // what leaving the app does (hidden is checked inside)
  await dev.eval(`window.dispatchEvent(new Event("pagehide"))`);
  await sleep(200);
  const saved = await dev.eval(`localStorage.getItem("insulinBuddy.place")`);
  dev.close();
  return launch(saved);
};

t.section("Insights > Trends, scrolled down, is reopened on Trends at the same place");
dev = await launch();
await dev.tab("history"); await sleep(300);
await dev.click('#history-segmented [data-seg="trends"]'); await sleep(400);
await dev.click('#trends-range-segmented [data-range="30"]'); await sleep(400);
await dev.eval(`window.scrollTo(0, 600)`); await sleep(500);
const yT = await dev.eval(`Math.round(window.scrollY)`);
t.check("Trends page scrolled", yT > 300, String(yT));
dev = await leaveAndReopen(dev);
await sleep(900);
t.check("reopened on Insights", (await shown(dev)) === "view-history", await shown(dev));
t.check("on the Trends sub-tab, not Meals", (await activeSeg(dev, "history-segmented")) === "trends" && (await visible(dev, "history-trends-panel")) && !(await visible(dev, "history-log-panel")), String(await activeSeg(dev, "history-segmented")));
t.check("with the same period (30 days)", (await dev.eval(`document.querySelector("#trends-range-segmented .is-active").dataset.range`)) === "30");
const yT2 = await dev.eval(`Math.round(window.scrollY)`);
t.check("at the same scroll position on Trends", Math.abs(yT2 - yT) < 40, `${yT} -> ${yT2}`);
dev.close();

t.section("Meals and Trends keep their own scroll positions");
dev = await launch();
await dev.tab("history"); await sleep(300);
await dev.eval(`window.scrollTo(0, 300)`); await sleep(500);
const yM = await dev.eval(`Math.round(window.scrollY)`);
await dev.click('#history-segmented [data-seg="trends"]'); await sleep(400);
await dev.eval(`window.scrollTo(0, 650)`); await sleep(500);
await dev.click('#history-segmented [data-seg="log"]'); await sleep(400);
await dev.eval(`window.scrollTo(0, ${yM})`); await sleep(500);
dev = await leaveAndReopen(dev);
await sleep(900);
t.check("reopened on Meals (where it was left)", (await activeSeg(dev, "history-segmented")) === "log");
t.check("at the Meals position, not the Trends one", Math.abs((await dev.eval(`Math.round(window.scrollY)`)) - yM) < 40, String(await dev.eval(`Math.round(window.scrollY)`)));
dev.close();

t.section("Settings > General, scrolled down, is reopened on General at the same place");
dev = await launch();
await dev.tab("settings"); await sleep(300);
await dev.click('#settings-segmented [data-seg="general"]'); await sleep(400);
await dev.eval(`window.scrollTo(0, 400)`); await sleep(500);
const yS = await dev.eval(`Math.round(window.scrollY)`);
t.check("General page scrolled", yS > 150, String(yS));
dev = await leaveAndReopen(dev);
await sleep(900);
t.check("reopened on Settings", (await shown(dev)) === "view-settings", await shown(dev));
t.check("on the General panel, not Dosing", (await activeSeg(dev, "settings-segmented")) === "general" && (await visible(dev, "panel-general")) && !(await visible(dev, "panel-ratios")), String(await activeSeg(dev, "settings-segmented")));
t.check("at the same scroll position", Math.abs((await dev.eval(`Math.round(window.scrollY)`)) - yS) < 40, `${yS} -> ${await dev.eval(`Math.round(window.scrollY)`)}`);
t.check("no JS errors", (await dev.eval("window.__errs.length")) === 0 && dev.errors.length === 0, JSON.stringify(await dev.eval("window.__errs")));
dev.close();

t.section("a place saved by an older version (no sub-tab) opens the screen at the top, not half way down");
dev = await launch(JSON.stringify({ view: "history", scroll: { history: 600 }, at: Date.now() }));
await sleep(600);
t.check("History, Meals, at the top", (await shown(dev)) === "view-history" && (await dev.eval(`Math.round(window.scrollY)`)) < 5, String(await dev.eval(`Math.round(window.scrollY)`)));
dev.close();

await app.close();
process.exit(t.summary() ? 0 : 1);
