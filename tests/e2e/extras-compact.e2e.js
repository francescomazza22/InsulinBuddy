// Compact Daily extras (2.101.0): one summary line per extra, editor on tap, aligned columns on wide screens.
// EC_WIDTH (default 390), EC_DARK=1, SHOTS=<dir>.
import { startApp, openDevice, makeChecker, seedLocal } from "./harness.js";
import { FOODS_JS, stateBlob } from "./helpers.js";

const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SHOTS = process.env.SHOTS || "";
const W = Number(process.env.EC_WIDTH || 390), dark = process.env.EC_DARK === "1";
const app = await startApp(DIR, null, { "foods_data.js": FOODS_JS, "manifest.json": "{}" });
// His extras on 11 Nov 2026.
const calories = { sex: "male", birthYear: 1985, heightCm: 180, weightKg: 75, lifeFactor: 1.3, eatingOutKcal: null, eatingOutMultiplier: null, extras: [
  { id: "oil", name: "Olive oil", unit: "tbsp", kcalPerUnit: 119, perDay: 2, meals: ["lunch", "dinner"], days: [1, 2, 3, 4, 5, 0] },
  { id: "fw", name: "Flat white", unit: "cup", kcalPerUnit: 110, perDay: 1, meals: ["breakfast", "lunch"], days: [] },
  { id: "choc", name: "Chocolate", unit: "Unit", kcalPerUnit: 80, perDay: 1, meals: [], days: [] }] };
const blob = stateBlob({ history: [], settings: { darkMode: dark, darkModeAuto: false, palette: "redOrange", calories } });
const dev = await openDevice(app, { width: W, height: 1000, mobile: W < 1000, dark, inject: `if (!localStorage.getItem("insulinBuddy.v2")) { ${seedLocal(blob)} }`, wait: 1500 });
await dev.tab("settings"); await sleep(300);
await dev.click('#settings-segmented [data-seg="calories"]'); await sleep(400);
await dev.eval(`document.getElementById("calories-extras-card").scrollIntoView({ block: "start" })`); await sleep(300);

const rows = () => dev.eval(`[...document.querySelectorAll("#cal-extras .cal-extra")].map(r => ({ id: r.dataset.xid, txt: [".cal-extra__sum-name", ".cal-extra__sum-amt", ".cal-extra__sum-when", ".cal-extra__kcal"].map(q => r.querySelector(q).textContent).join(" | "), h: Math.round(r.getBoundingClientRect().height), open: !r.querySelector(".cal-extra__edit").hidden }))`);
let r = await rows();
t.check("three closed summary lines", r.length === 3 && r.every(x => !x.open), JSON.stringify(r));
t.check("olive oil reads name, amount, meals and the day it's off, kcal", r[0].txt === "Olive oil | 2 tbsp | Lunch, dinner · not Sat | 238 kcal", r[0].txt);
t.check("flat white says every day", r[1].txt === "Flat white | 1 cup | Breakfast, lunch · every day | 110 kcal", r[1].txt);
t.check("a generic unit is left out of the summary", r[2].txt === "Chocolate | 1 | Any meal · every day | 80 kcal", r[2].txt);
const total = await dev.eval(`Math.round(document.getElementById("cal-extras").getBoundingClientRect().height)`);
t.check("all three take less than 230px (was about 1,000)", total < 230, String(total));
const head = await dev.eval(`getComputedStyle(document.querySelector(".cal-extras__head")).display`);
t.check(W >= 1000 ? "wide: column header shown" : "phone: no column header", W >= 1000 ? head === "grid" : head === "none", head);
if (W >= 1000) {
  const cols = await dev.eval(`[...document.querySelectorAll("#cal-extras .cal-extra__kcal")].map(e => Math.round(e.getBoundingClientRect().right))`);
  t.check("wide: kcal figures line up", new Set(cols).size === 1, JSON.stringify(cols));
}
t.check("no sideways scroll", await dev.eval(`document.documentElement.scrollWidth <= innerWidth + 1`));
if (SHOTS) await dev.shot(`${SHOTS}/extras-closed-${W}${dark ? "-dark" : ""}.png`);
await dev.eval(`document.querySelector('#cal-extras [data-xid="fw"] [data-xtoggle]').click()`); await sleep(250);
r = await rows();
t.check("tapping flat white opens only it", r[1].open && !r[0].open && !r[2].open);
const days = await dev.eval(`[...document.querySelectorAll('#cal-extras [data-xid="fw"] [data-xday]')].filter(b => b.classList.contains("is-on")).length`);
t.check("its days show all seven lit (every day)", days === 7, String(days));
t.check("Remove sits inside the editor", await dev.eval(`!!document.querySelector('#cal-extras [data-xid="fw"] .cal-extra__edit [data-xremove]')`));
t.check("no sideways scroll when open", await dev.eval(`document.documentElement.scrollWidth <= innerWidth + 1`));
if (SHOTS) await dev.shot(`${SHOTS}/extras-open-${W}${dark ? "-dark" : ""}.png`);
t.check("no JS errors", (await dev.eval("window.__errs.length")) === 0, JSON.stringify(await dev.eval("window.__errs")));
dev.close();
await app.close();
process.exit(t.summary() ? 0 : 1);
