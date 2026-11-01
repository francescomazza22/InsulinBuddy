// Visual sweep (not part of run.js): every screen at phone / iPad / desktop, light and dark, saved as PNGs for review.
// Usage: SWEEP_OUT=<dir> [SWEEP_ONLY=phone-dark] node tests/e2e/visual-sweep.mjs
import fs from "node:fs";
import { createBackend, startApp, openDevice, fakeSupabaseSource } from "./harness.js";
import { FOODS_JS, stateBlob, meal } from "./helpers.js";
import { makeBasalEntry } from "../../js/history.js";
import { makeActivityEntry } from "../../js/activity.js";
import { entriesToGlucoseRows } from "../../js/nightscout.js";
const DIR = new URL("../..", import.meta.url).pathname, OUT = process.env.SWEEP_OUT || "/tmp/sweep";
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const MIN = 60000, H = 60 * MIN, DAY = 24 * H, now = Date.now();
const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
const at = (daysAgo, h, m = 0) => midnight.getTime() - daysAgo * DAY + h * H + m * MIN;
const history = [];
for (let d = 0; d < 14; d++) {
  if (at(d, 8) < now) history.push(meal("b" + d, at(d, 8), { mealType: "breakfast", periodName: "breakfast", totalCarbs: 45, mealDose: 4.5, ratioLabel: "Morning", ratioValue: 10 }));
  if (at(d, 13) < now) history.push(meal("l" + d, at(d, 13), { totalCarbs: 70 + (d % 3) * 10, mealDose: 6 + (d % 2), correctionDose: d % 4 === 0 ? 1 : 0, glucose: 140 + d * 3, ratioLabel: "Lunch", ratioValue: 12 }));
  if (at(d, 20) < now) history.push(meal("e" + d, at(d, 20), { mealType: "dinner", periodName: "dinner", totalCarbs: 60, mealDose: 4, ratioLabel: "Evening", ratioValue: 15 }));
  if (at(d, 7, 30) < now) history.push(makeBasalEntry({ units: 10, ts: at(d, 7, 30), slot: "am", now: at(d, 7, 30) }));
  if (at(d, 22) < now) history.push(makeBasalEntry({ units: 18, ts: at(d, 22), slot: "pm", now: at(d, 22) }));
  if (d % 3 === 1) history.push(makeActivityEntry({ type: "run", minutes: 40, intensity: "moderate", ts: at(d, 18), now: at(d, 18) }));
}
history.sort((a, b) => b.ts - a.ts);
const entries = [];
for (let tt = at(14, 0); tt < now; tt += 5 * MIN) {
  let g = 115 + 15 * Math.sin(tt / (5 * H));
  for (const m of history) { if (!m.totalCarbs) continue; const x = (tt - m.ts) / MIN; if (x >= 0 && x < 240) g += 70 * Math.sin(Math.PI * x / 240); }
  entries.push({ sgv: Math.round(g), date: tt, direction: "Flat" });
}
const settings = { darkModeAuto: false, backgroundPattern: "doodles", basalBaseline: { am: 10, pm: 18 },
  nightscoutUrl: "https://demo.ns.example.com/?token=tok-abcdef-123456",
  activityRatios: [{ id: "x", name: "Sport", color: "#8B5CF6", ratio: 18 }],
  timeRatios: [{ id: "a", name: "Morning", color: "#F59E0B", ratio: 10, start: "05:00", end: "11:00" }, { id: "b", name: "Lunch", color: "#D6A419", ratio: 12, start: "11:00", end: "16:00" }, { id: "c", name: "Evening", color: "#6366F1", ratio: 15, start: "16:00", end: "05:00" }] };
const DEVICES = [["phone", 390, 844, true], ["ipad", 820, 1180, true], ["desktop", 1440, 900, false]];
const only = process.env.SWEEP_ONLY;
const be = createBackend();
const app = await startApp(DIR, be, { "foods_data.js": FOODS_JS, "manifest.json": "{}" });
const report = [];
for (const [dname, w, h, mobile] of DEVICES) for (const dark of [false, true]) {
  const tag = `${dname}-${dark ? "dark" : "light"}`; if (only && !only.split(",").includes(tag)) continue;
  be.glucose = entriesToGlucoseRows(entries, "user-1");
  be.row = { user_id: "user-1", data: stateBlob({ history, settings: { ...settings, darkMode: dark } }), updated_at: be.stamp() };
  const dev = await openDevice(app, { width: w, height: h, mobile, dark, inject: fakeSupabaseSource({ userId: "user-1" }), wait: 2500 });
  const shot = async name => {
    const full = await dev.eval(`Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)`);
    const over = await dev.eval(`document.documentElement.scrollWidth > innerWidth + 1 ? document.documentElement.scrollWidth : 0`);
    if (over) report.push(`${tag} ${name}: sideways scroll (${over}px > ${w}px)`);
    await dev.resize(w, Math.min(Math.max(h, full), 6000), mobile); await sleep(500);
    await dev.shot(`${OUT}/${tag}--${name}.png`);
    await dev.resize(w, h, mobile); await sleep(200);
  };
  const click = sel => dev.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (e) e.click(); return !!e; })()`);
  try {
    await dev.tab("calculator"); await sleep(600); await shot("01-calculator-empty");
    for (let i = 0; i < 2; i++) {
      await dev.eval(`document.getElementById("cc-food-list").children[${i}].click()`);
      await dev.eval(`(() => { const g = document.getElementById("cc-grams"); g.value = "${100 + i * 30}"; g.dispatchEvent(new Event("input", { bubbles: true })); })()`);
      await click("#cc-add-btn"); await sleep(200);
    }
    await sleep(400); await shot("02-calculator-meal");
    await dev.tab("history"); await sleep(500);
    for (const seg of ["log", "trends", "glucose"]) { await click(`[data-seg="${seg}"]`); await sleep(1800); await shot(`03-history-${seg}`); }
    await click('[data-seg="log"]'); await sleep(300);
    await click("#btn-log-basal"); await sleep(600); await dev.shot(`${OUT}/${tag}--04-sheet-basal.png`); await click("#basal-cancel"); await sleep(300);
    await click("#btn-log-activity"); await sleep(600); await dev.shot(`${OUT}/${tag}--05-sheet-activity.png`);
    await dev.eval(`(() => { const b = [...document.querySelectorAll(".sheet:not([hidden]) button, [role=dialog]:not([hidden]) button")].find(x => /cancel|close/i.test(x.textContent)); if (b) b.click(); })()`); await sleep(300);
    await dev.eval(`(() => { const r = [...document.querySelectorAll(".history-entry")].find(e => !/--basal|--activity/.test(e.className)); if (r) { r.scrollIntoView({ block: "center" }); r.click(); } })()`); await sleep(700); await dev.shot(`${OUT}/${tag}--06-meal-detail.png`);
    await dev.eval(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`); await sleep(300);
    await dev.tab("settings"); await sleep(400);
    for (const seg of ["ratios", "library", "sync", "data", "general"]) { await click(`#settings-segmented [data-seg="${seg}"]`); await sleep(500); await shot(`07-settings-${seg}`); }
    await dev.tab("history"); await click('[data-seg="glucose"]'); await sleep(1200);
    await click("#btn-generate-report"); await sleep(2500); await dev.shot(`${OUT}/${tag}--08-doctor-report.png`); await click("#btn-report-close"); await sleep(300);
    await click("#btn-clinic-report"); await sleep(1500); await dev.shot(`${OUT}/${tag}--09-clinic-report.png`); await click("#clinic-report-close");
  } catch (e) { report.push(`${tag}: sweep error ${e.message}`); }
  const errs = await dev.eval("window.__errs").catch(() => []);
  if ((errs && errs.length) || dev.errors.length) report.push(`${tag}: JS errors ${JSON.stringify(errs)} ${dev.errors.join("|")}`);
  dev.close();
}
await app.close();
fs.writeFileSync(`${OUT}/report.txt`, report.join("\n") + "\n");
console.log(report.length ? report.join("\n") : "no automatic problems"); 
