// 2.72.2: switching screens (Calculator / Insights / Settings) or a sub-tab opens it at the top. Before, the page kept the
// scroll of the screen you came from (Francesco, 28 Oct 2026: from halfway down Settings, Insights opened halfway down).
// Reopening the app where you left off (reopen.e2e.js) is separate and unchanged.
// Env: TT_WIDTH (default 390).
import { startApp, openDevice, makeChecker, seedLocal } from "./harness.js";
import { FOODS_JS, stateBlob, meal } from "./helpers.js";

const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const W = Number(process.env.TT_WIDTH || 390);
const app = await startApp(DIR, null, { "foods_data.js": FOODS_JS });
const hist = Array.from({ length: 40 }, (_, i) => meal("m" + i, Date.now() - (i + 1) * 3600_000));
const dev = await openDevice(app, { width: W, height: 700, mobile: W < 700, inject: seedLocal(stateBlob({ history: hist, schemaVersion: 2 })), wait: 1500 });
const y = () => dev.eval(`Math.round(window.scrollY)`);
const down = async () => { await dev.eval(`window.scrollTo(0, 900)`); await sleep(350); return y(); };

t.section(`SCREENS (${W}px)`);
await dev.tab("settings"); await sleep(300);
let from = await down();
t.check("Settings scrolled down", from > 300, String(from));
await dev.tab("history"); await sleep(300);
t.check("Insights opens at the top", (await y()) === 0, `${from} -> ${await y()}`);
from = await down();
t.check("Insights scrolled down", from > 300, String(from));
await dev.tab("settings"); await sleep(300);
t.check("Settings opens at the top", (await y()) === 0, String(await y()));
await down();
await dev.tab("calculator"); await sleep(300);
t.check("Calculator opens at the top", (await y()) === 0, String(await y()));

t.section("SUB-TABS");
await dev.tab("settings"); await sleep(200); await down();
await dev.click('#settings-segmented [data-seg="general"]'); await sleep(300);
t.check("Dosing -> General opens at the top", (await y()) === 0, String(await y()));
await dev.tab("history"); await sleep(200); await down();
await dev.click('#history-segmented [data-seg="trends"]'); await sleep(400);
t.check("Meals -> Trends opens at the top", (await y()) === 0, String(await y()));

t.section("REOPEN STILL REMEMBERS EACH SCREEN'S OWN POSITION");
await dev.click('#history-segmented [data-seg="log"]'); await sleep(300);
const logY = await down();
await dev.tab("settings"); await sleep(400);
const p = JSON.parse(await dev.eval(`localStorage.getItem("insulinBuddy.place")`));
t.check("Meals' scroll was kept for reopening", Math.abs((p.scroll["history:log"] || 0) - logY) < 40, JSON.stringify(p.scroll));
t.check("Settings is saved at the top, not at Meals' scroll", (p.scroll["settings:general"] || 0) === 0, JSON.stringify(p.scroll));
t.check("no JS errors", (await dev.eval("window.__errs.length")) === 0 && dev.errors.length === 0, JSON.stringify(await dev.eval("window.__errs")));
dev.close(); await app.close();
process.exit(t.summary() ? 0 : 1);
