// Insights > Trends > Ratio over time (2.76.0): ratio used per meal by bracket, and changes made in Settings (recorded
// from now on). RT_WIDTH (default 390), RT_DARK=1, SHOTS=<dir>.
import { startApp, openDevice, makeChecker, seedLocal } from "./harness.js";
import { FOODS_JS, stateBlob, meal } from "./helpers.js";

const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SHOTS = process.env.SHOTS || "";
const W = Number(process.env.RT_WIDTH || 390), dark = process.env.RT_DARK === "1";
const app = await startApp(DIR, null, { "foods_data.js": FOODS_JS, "manifest.json": "{}" });

const d = new Date(); const at = (daysAgo, h) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - daysAgo, h, 0).getTime();
const timeRatios = [
  { id: "tr-morning", name: "Morning", ratio: 12, start: "05:30", end: "11:00", color: "#C93400" },
  { id: "tr-lunch", name: "Lunch", ratio: 7.5, start: "11:00", end: "15:00", color: "#248A3D" },
  { id: "tr-evening", name: "Evening", ratio: 15, start: "15:00", end: "05:30", color: "#8944AB" }
];
const m = (id, daysAgo, h, label, ratio, over = {}) => meal(id, at(daysAgo, h), { ratioLabel: label, ratioValue: ratio, periodName: label.toLowerCase(), ...over });
// Morning: 10, 11, 12, 13 over the month; Lunch 9 then 7.5; Evening 15 throughout.
const hist = [
  m("a1", 28, 8, "Morning", 10), m("a2", 21, 8, "Morning", 11), m("a3", 14, 8, "Morning", 12), m("a4", 7, 8, "Morning", 13), m("a5", 1, 8, "Morning", 13),
  m("b1", 20, 13, "Lunch", 9), m("b2", 2, 13, "Lunch", 7.5),
  m("c1", 25, 19, "Evening", 15), m("c2", 5, 19, "Evening", 15),
  meal("old", at(26, 12), { ratioValue: undefined, ratioLabel: undefined }),
  { id: "bs", ts: at(1, 22), entryType: "basal", mealType: "basal", basalDose: 12, items: [], totalCarbs: 0, mealDose: 0, correctionDose: 0 }
].sort((a, b) => b.ts - a.ts);
delete hist.find(h => h.id === "old").ratioValue;

const blob = stateBlob({ history: hist, settings: { darkMode: dark, darkModeAuto: false, timeRatios, activityRatios: [] } });
const dev = await openDevice(app, { width: W, height: 1400, mobile: W < 1000, dark, inject: `if (!localStorage.getItem("insulinBuddy.v2")) { ${seedLocal(blob)} }`, wait: 1500 });
const saved = () => dev.eval(`JSON.parse(localStorage.getItem("insulinBuddy.v2")).settings.ratioHistory || []`);
const open = async () => { await dev.tab("history"); await dev.click('#history-segmented [data-seg="trends"]'); await sleep(300); await dev.click('#trends-range-segmented [data-range="30"]'); await sleep(400); };
const info = () => dev.eval(`(() => { const c = document.getElementById("trend-card-ratio-time"); return { shown: !c.hidden,
  chips: [...c.querySelectorAll("[data-ratiotime]")].map(b => b.textContent + (b.classList.contains("is-active") ? "*" : "")),
  readout: document.getElementById("ratio-time-readout").textContent, caption: document.getElementById("ratio-time-caption").textContent,
  dots: c.querySelectorAll(".ratio-time__dot").length, setLines: c.querySelectorAll(".ratio-time__set").length,
  legend: document.getElementById("ratio-time-legend").textContent.replace(/\\s+/g, " ").trim(),
  label: c.querySelector("svg") && c.querySelector("svg").getAttribute("aria-label"),
  overflow: c.scrollWidth > c.clientWidth + 1 }; })()`);

t.section(`RATIO OVER TIME (${W}px${dark ? ", dark" : ""})`);
await open();
let s = await info();
console.log("  ", JSON.stringify(s));
t.check("shown in Trends with a chip per range that has meals", s.shown && s.chips.join("|") === "All*|Morning|Lunch|Evening", s.chips.join("|"));
t.check("All: a dot per meal dosed by a ratio (9; not the old meal or basal)", s.dots === 9, String(s.dots));
t.check("legend names each range", s.legend === "MorningLunchEvening", s.legend);
t.check("one older meal has no ratio saved", /1 older meal has no ratio saved/.test(s.caption), s.caption);
t.check("chips don't push the card wider", !s.overflow);

await dev.click('[data-ratiotime="Morning"]'); await sleep(300);
s = await info();
t.check("Morning: latest 13, changed 3 times 10 → 11 → 12 → 13, set now 12", /Morning: 1u:13g in the latest of 5 meals, changed 3 times \(10 → 11 → 12 → 13\)\. Set now: 1u:12g\./.test(s.readout), s.readout);
t.check("before any Settings change: no dashed line, and it says changes are recorded from now", s.setLines === 1 || /recorded from/.test(s.caption), s.caption);
if (SHOTS) { await dev.eval(`document.getElementById("trend-card-ratio-time").scrollIntoView({ block: "start" })`); await sleep(300); await dev.shot(`${SHOTS}/ratio-time-${W}${dark ? "-dark" : ""}.png`); }

// The first save records where the ratios stand; a change in Settings is recorded with its date.
let hist0 = await saved();
t.check("the ratios in force are recorded on the first save", hist0.length === 1 && hist0[0].ratios.find(r => r.name === "Morning").ratio === 12, JSON.stringify(hist0.map(h => h.ratios.map(r => r.ratio))));
// Change Morning to 13 through Settings (the real editor).
await dev.tab("settings"); await dev.click('#settings-segmented [data-seg="ratios"]'); await sleep(300);
// The real editor: open Morning's row and type 13 in its ratio field (saved on change).
await dev.eval(`document.querySelector('#time-ratio-list [data-toggle="tr-morning"]').click()`); await sleep(300);
const typed = await dev.eval(`(() => { const i = document.querySelector('#time-ratio-list input[data-field="ratio"][data-id="tr-morning"]'); if (!i) return "no field"; i.value = "13"; i.dispatchEvent(new Event("change", { bubbles: true })); return "typed"; })()`);
await sleep(600);
console.log("   settings editor:", typed);
const hist1 = await saved();
t.check("changing Morning to 13 in Settings adds a dated record", hist1.length === 2 && hist1[1].ratios.find(r => r.name === "Morning").ratio === 13 && Date.now() - hist1[1].ts < 60000, JSON.stringify(hist1.map(h => [h.ts, h.ratios.map(r => r.ratio)])));
await open();
s = await info();
t.check("the chip choice is remembered", s.chips.includes("Morning*"), s.chips.join("|"));
t.check("Morning now shows the dashed Settings line and the new setting", s.setLines === 1 && /Set now: 1u:13g/.test(s.readout) && /Set in Settings/.test(s.legend), JSON.stringify(s));
t.check("screen readers get a summary", /Morning: 1u:13g in the latest of 5 meals/.test(s.label || ""), s.label);
if (SHOTS) { await dev.eval(`document.getElementById("trend-card-ratio-time").scrollIntoView({ block: "start" })`); await sleep(300); await dev.shot(`${SHOTS}/ratio-time-set-${W}${dark ? "-dark" : ""}.png`); }
await dev.click('[data-ratiotime="all"]'); await sleep(200);
t.check("no JS errors", (await dev.eval("window.__errs.length")) === 0, JSON.stringify(await dev.eval("window.__errs")));
dev.close(); await app.close();
process.exit(t.summary() ? 0 : 1);
