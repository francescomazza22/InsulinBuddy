// Glucose > Day (2.68.0): one day's glucose with meals, corrections, low treatments, basal and activities on top.
// DV_WIDTH (default 390), DV_DARK=1, DV_UNITS=mmol, SHOTS=<dir>.
import { createBackend, startApp, openDevice, fakeSupabaseSource, makeChecker } from "./harness.js";
import { FOODS_JS, stateBlob, meal } from "./helpers.js";
import { entriesToGlucoseRows } from "../../js/nightscout.js";
import { makeActivityEntry } from "../../js/activity.js";

const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SHOTS = process.env.SHOTS || "";
const W = Number(process.env.DV_WIDTH || 390), dark = process.env.DV_DARK === "1", units = process.env.DV_UNITS || "mgdl";
const MIN = 60000, HOUR = 3600000;
const be = createBackend();
const app = await startApp(DIR, be, { "foods_data.js": FOODS_JS });

// Yesterday, fully: breakfast 07:30 then a ride 08:18-08:37, a correction 15:00, a low treated 16:30, lunch 13:00, basal 22:00.
const y = new Date(); y.setDate(y.getDate() - 1); y.setHours(0, 0, 0, 0);
const Y = y.getTime(), at = (h, m = 0) => new Date(y.getFullYear(), y.getMonth(), y.getDate(), h, m).getTime();   // local clock times (yesterday may be a clock-change day)
const history = [
  meal("bk", at(7, 30), { mealType: "breakfast", totalCarbs: 45, mealDose: 4.5, items: [{ refType: "food", name: "Porridge", grams: 60, carbs: 30 }, { refType: "food", name: "Banana", grams: 100, carbs: 15 }] }),
  { ...makeActivityEntry({ type: "cycle", minutes: 19, intensity: "moderate", ts: at(8, 18), now: at(8, 40) }), id: "hk-ride", source: "appleHealth", note: "From Apple Health · 82 kcal (intensity estimated)" },
  meal("ln", at(13, 0), { mealType: "lunch", totalCarbs: 60, mealDose: 6 }),
  meal("cr", at(15, 0), { mealType: "correction", totalCarbs: 0, mealDose: 0, correctionDose: 1.5, items: [] }),
  meal("lo", at(16, 30), { mealType: "snack", totalCarbs: 15, mealDose: 0, noInsulin: true, items: [{ refType: "food", name: "Juice", grams: 150, carbs: 15 }] }),
  { id: "bs", ts: at(22, 0), entryType: "basal", mealType: "basal", basalDose: 12, basalSlot: "pm", items: [], totalCarbs: 0, mealDose: 0, correctionDose: 0 },
  meal("today", Date.now() - 2 * HOUR, { mealType: "lunch", totalCarbs: 30, mealDose: 3 })
].sort((a, b) => b.ts - a.ts);
const entries = [];
for (let t0 = Math.floor((Y - HOUR) / (5 * MIN)) * 5 * MIN; t0 < Date.now(); t0 += 5 * MIN) {
  const h = (t0 - Y) / HOUR;
  const v = h < 7.5 ? 120 : h < 9 ? 120 + (h - 7.5) * 30 : h < 11 ? 165 - (h - 9) * 40 : h < 15 ? 150 : h < 16.5 ? 150 - (h - 15) * 60 : h < 17.5 ? 60 + (h - 16.5) * 50 : 125;
  if (h > 2 && h < 2.5) continue;   // a sensor gap
  entries.push({ sgv: Math.round(v), date: t0, direction: "Flat" });
}
be.glucose = entriesToGlucoseRows(entries, "user-1");
be.row = { user_id: "user-1", data: stateBlob({ history, settings: { units, nightscoutUrl: "https://demo.ns.example.com/?token=tok-abcdef-123456" } }), updated_at: be.stamp() };

const dev = await openDevice(app, { width: W, height: 1000, mobile: W < 1000, dark, inject: fakeSupabaseSource({ userId: "user-1" }), wait: 2000 });
await dev.tab("history"); await dev.click('[data-seg="glucose"]'); await sleep(300);
await dev.click('[data-glview="day"]');
await dev.waitFor(`!!document.querySelector(".day-chart")`, 30000, 200);

t.section(`GLUCOSE > DAY (${W}px${dark ? ", dark" : ""}, ${units})`);
t.check("opens on today", (await dev.text(".day-nav__label")) === "Today");
t.check("the 7/14/30/90-day switch is hidden in this view", await dev.eval(`document.getElementById("glucose-range-segmented").hidden`));
t.check("next day is disabled on today", await dev.eval(`document.querySelector('[data-dayshift="1"]').disabled`));
t.check("today's lunch is on the chart", (await dev.eval(`document.querySelectorAll(".day-mark").length`)) === 1);

await dev.click('[data-dayshift="-1"]');
await dev.waitFor(`document.querySelector(".day-nav__label") && document.querySelector(".day-nav__label").textContent === "Yesterday" && !!document.querySelector(".day-chart")`, 10000);
const marks = await dev.eval(`[...document.querySelectorAll(".day-mark")].map(m => m.getAttribute("aria-label"))`);
console.log("  ", JSON.stringify(marks));
t.check("yesterday: 6 icons (breakfast, ride, lunch, correction, low, basal)", marks.length === 6, String(marks.length));
t.check("at the right local times", /^7:30 AM Breakfast/.test(marks[0]) && /^8:18 AM Cycling/.test(marks[1]) && /^10:00 PM Basal/.test(marks[5]), marks.map(m => m.split(":")[0] + ":" + m.split(":")[1].slice(0, 5)).join(", "));
t.check("in time order with what each was", /Breakfast: Porridge, Banana · 45 g carbs · 4.5 u/.test(marks[0]) && /Cycling: 19 min · Moderate/.test(marks[1]) && /Correction: 1.5 u/.test(marks[3]) && /Treated low: Juice · 15 g carbs · no insulin/.test(marks[4]) && /Basal \(evening\): 12 u long-acting/.test(marks[5]), marks.join(" | "));
t.check("the ride is shaded for as long as it lasted", (await dev.eval(`document.querySelectorAll(".day-act-band").length`)) === 1);
const bandW = await dev.eval(`+document.querySelector(".day-act-band").getAttribute("width")`);
const plotW = await dev.eval(`+document.querySelector(".day-chart").getAttribute("viewBox").split(" ")[2] - 42`);
t.check("band width matches 19 minutes of 24 hours", Math.abs(bandW - (plotW * 19 / 1440)) < 0.6, `${bandW} of ${plotW}`);
t.check("icons don't overlap (breakfast and the ride 48 min apart are in different rows)", await dev.eval(`(() => { const c = [...document.querySelectorAll(".day-mark circle:nth-of-type(2)")].map(c => ({ x: +c.getAttribute("cx"), y: +c.getAttribute("cy") })); return c.every((a, i) => c.every((b, j) => i === j || Math.hypot(a.x - b.x, a.y - b.y) >= 20)); })()`));
t.check("the glucose line breaks at the sensor gap", (await dev.eval(`(document.querySelector(".day-chart path[stroke='#3B82F6']").getAttribute("d").match(/M/g) || []).length`)) === 2);
const stats = await dev.eval(`[...document.querySelectorAll(".glucose-stats .trend-stat-card")].map(c => c.textContent.replace(/\\s+/g, " ").trim())`);
console.log("  ", JSON.stringify(stats));
t.check("totals: carbs and bolus", /^120\s*g\s*Carbs · 12 u bolus$/.test(stats[2]), stats[2]);
t.check("totals: activity and basal", /^19\s*min\s*Activity · 12 u basal$/.test(stats[3]), stats[3]);
t.check("in range figure with its range", /^\d+\s*%\s*In range \(70–180 mg\/dL|3\.9–10 mmol\/L\)/.test(stats[0]), stats[0]);
const rows = await dev.eval(`[...document.querySelectorAll(".day-ev")].map(r => r.textContent.replace(/\\s+/g, " ").trim())`);
t.check("the list has a row per event", rows.length === 6, String(rows.length));
t.check("meal rows say the glucose at the time, with its unit", new RegExp(`· glucose ${units === "mmol" ? "\\d+(\\.\\d)? mmol/L" : "\\d+ mg/dL"}$`).test(rows[0]), rows[0]);
await dev.eval(`document.querySelectorAll(".day-mark")[4].dispatchEvent(new MouseEvent("click", { bubbles: true }))`); await sleep(300);
t.check("tapping an icon picks out its row", await dev.eval(`document.querySelector(".day-ev.is-hl") && document.querySelector(".day-ev.is-hl").dataset.dayrow === "4"`));
if (SHOTS) { await dev.eval(`window.scrollTo(0, 0)`); await dev.eval(`document.querySelector(".day-nav").scrollIntoView({ block: "start" })`); await sleep(300); await dev.shot(`${SHOTS}/day-${units}-${W}${dark ? "-dark" : ""}.png`); }
await dev.click('[data-dayshift="today"]');
await dev.waitFor(`document.querySelector(".day-nav__label").textContent === "Today"`, 8000).then(() => t.check("Today jumps back", true), () => t.check("Today jumps back", false));
await dev.click('[data-glview="pattern"]'); await sleep(500);
t.check("leaving the Day view shows the range switch again", !(await dev.eval(`document.getElementById("glucose-range-segmented").hidden`)));
t.check("no page-wide horizontal scroll", await dev.eval(`document.documentElement.scrollWidth <= window.innerWidth + 1`));
t.check("no JS errors", (await dev.eval("window.__errs.length")) === 0 && dev.errors.length === 0, JSON.stringify(await dev.eval("window.__errs")));
dev.close(); await app.close();
process.exit(t.summary() ? 0 : 1);
