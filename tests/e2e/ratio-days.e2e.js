// Day-limited time-of-day ratios: chips in Settings, and the calculator picks the one for today.
import { startApp, openDevice, makeChecker, seedLocal } from "./harness.js";
import { FOODS_JS, stateBlob, localState } from "./helpers.js";
const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker(); const sleep = ms => new Promise(r => setTimeout(r, ms));
const app = await startApp(DIR, null, { "foods_data.js": FOODS_JS, "manifest.json": "{}" });
const today = new Date().getDay(), other = (today + 3) % 7;
const blob = stateBlob();
blob.history = [{ id: "h1", ts: Date.now() - 3600e3, mealType: "lunch", items: [], totalCarbs: 30, mealDose: 2, correctionDose: 0, ratioLabel: "Today only", ratioValue: 7, glucose: null }];
blob.settings.timeRatios = [
  { id: "all", name: "All day", start: "00:00", end: "00:00", ratio: 15, color: "#1F9E93" },
  { id: "mine", name: "Today only", start: "00:00", end: "00:00", ratio: 7, color: "#D6A419", days: [today] },
  { id: "else", name: "Other day", start: "00:00", end: "00:00", ratio: 3, color: "#6366F1", days: [other] }
];
const dev = await openDevice(app, { width: 420, height: 900, mobile: true, inject: `if (!localStorage.getItem("insulinBuddy.v2")) { ${seedLocal(blob)} }`, wait: 1800 });
t.section("RATIO DAYS: the calculator uses today's day-limited range");
const pill = await dev.eval(`document.getElementById("cc-ratio-value").textContent`);
t.check("the ratio shown is today's special one (1:7), not the every-day 1:15 or another day's 1:3", pill === "1:7", pill);
await dev.eval(`document.getElementById("cc-ratio-pill").click()`); await sleep(250);
const picked = await dev.eval(`[...document.querySelectorAll(".ratio-picker__item .ratio-picker__name")].map(x => x.textContent.trim())`);
t.check("the picker lists today's ranges", picked.some(x => x.startsWith("All day")) && picked.some(x => x.startsWith("Today only")), picked.join("|"));
t.check("and leaves out ranges limited to other days", !picked.some(x => x.startsWith("Other day")), picked.join("|"));
t.section("RATIO DAYS: chips in Settings");
await dev.tab("settings"); await sleep(300);
await dev.eval(`document.querySelector('[data-seg="ratios"]') && document.querySelector('[data-seg="ratios"]').click()`); await sleep(200);
await dev.eval(`document.querySelector('[data-toggle="all"]').click()`); await sleep(150);
const chips = await dev.eval(`document.querySelectorAll('#edit-all .day-chip').length`);
const lit = await dev.eval(`document.querySelectorAll('#edit-all .day-chip.is-on').length`);
t.check("seven day chips, all lit for an every-day range", chips === 7 && lit === 7, `${chips}/${lit}`);
await dev.eval(`document.querySelector('#edit-all .day-chip[data-day="${today}"]').click()`); await sleep(200);
let st = await localState(dev); let r = st.settings.timeRatios.find(x => x.id === "all");
t.check("unticking today limits it to the other six days", Array.isArray(r.days) && r.days.length === 6 && !r.days.includes(today), JSON.stringify(r.days));
t.check("and the edit panel stays open", await dev.eval(`!document.getElementById("edit-all").hidden`));
await dev.eval(`document.querySelector('#edit-all .day-chip[data-day="${today}"]').click()`); await sleep(200);
st = await localState(dev); r = st.settings.timeRatios.find(x => x.id === "all");
t.check("lighting all seven again removes the restriction", r.days === undefined, JSON.stringify(r.days));
const rowText = await dev.eval(`document.querySelector('[data-toggle="mine"]').textContent`);
t.check("a limited range names its day in the list", /\b(Sun|Mon|Tue|Wed|Thu|Fri|Sat)\b/.test(rowText), rowText);
await dev.eval(`document.getElementById("add-time-range-btn").click()`); await sleep(200);
await dev.eval(`document.getElementById("add-time-range-btn").click()`); await sleep(200);
st = await localState(dev); const names = st.settings.timeRatios.map(x => x.name);
t.check("added ranges get distinct names (so reports don't merge them)", new Set(names).size === names.length, names.join("|"));
t.section("RATIO DAYS: renaming");
await dev.eval(`window.__alerts = []; window.alert = m => window.__alerts.push(m)`);
await dev.eval(`(() => { const i = document.querySelector('#edit-mine [data-field="name"]'); i.value = "Sunday morning"; i.dispatchEvent(new Event("change", { bubbles: true })); })()`); await sleep(250);
st = await localState(dev);
t.check("the range can be renamed", st.settings.timeRatios.find(x => x.id === "mine").name === "Sunday morning");
t.check("meals logged under the old name follow the new one", st.history.find(x => x.id === "h1").ratioLabel === "Sunday morning", st.history[0].ratioLabel);
await dev.eval(`(() => { const i = document.querySelector('#edit-mine [data-field="name"]'); i.value = "All day"; i.dispatchEvent(new Event("change", { bubbles: true })); })()`); await sleep(250);
st = await localState(dev);
t.check("a name already in use is refused and the old one kept", st.settings.timeRatios.find(x => x.id === "mine").name === "Sunday morning" && (await dev.eval(`window.__alerts.length`)) === 1);
await dev.eval(`(() => { const i = document.querySelector('#edit-mine [data-field="name"]'); i.value = "   "; i.dispatchEvent(new Event("change", { bubbles: true })); })()`); await sleep(250);
st = await localState(dev);
t.check("a blank name is ignored", st.settings.timeRatios.find(x => x.id === "mine").name === "Sunday morning");
dev.close(); await app.close(); t.done && t.done(); process.exit(0);
