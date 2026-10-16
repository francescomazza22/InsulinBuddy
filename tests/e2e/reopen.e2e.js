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
t.check("the place was saved", p.view === "history" && Math.abs(p.scroll.history - y0) < 40, saved);
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
await app.close();
process.exit(t.summary() ? 0 : 1);
