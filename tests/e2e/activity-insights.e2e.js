// The "Activity and glucose" card (2.65.0): logged activities with CGM readings around them show, per activity, the change
// during and the lowest reading afterwards, in the person's unit; and an opened activity row shows its own glucose line.
// AI_WIDTH (default 390), AI_UNITS=mmol, AI_DARK=1, SHOTS=<dir>.
import { createBackend, startApp, openDevice, fakeSupabaseSource, makeChecker } from "./harness.js";
import { FOODS_JS, stateBlob, meal } from "./helpers.js";
import { entriesToGlucoseRows } from "../../js/nightscout.js";
import { makeActivityEntry } from "../../js/activity.js";

const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SHOTS = process.env.SHOTS || "";
const W = Number(process.env.AI_WIDTH || 390), units = process.env.AI_UNITS || "mgdl", dark = process.env.AI_DARK === "1";
const MIN = 60000, HOUR = 3600000, now = Date.now();
const be = createBackend();
const app = await startApp(DIR, be, { "foods_data.js": FOODS_JS });

// Six days: a meal each day, and a run (falling 50) on four of them and a walk (falling 15) on two, all at 17:00.
const history = [], drops = [];
for (let d = 1; d <= 6; d++) {
  const day = new Date(now - d * 24 * HOUR); day.setHours(17, 0, 0, 0);
  const T = day.getTime();
  history.push(meal("m" + d, T - 4 * HOUR));
  const run = d <= 4;
  history.push(makeActivityEntry({ type: run ? "run" : "walk", minutes: run ? 40 : 30, intensity: d === 1 ? "hard" : "moderate", ts: T, now: T + 1 }));
  drops.push({ T, mins: run ? 40 : 30, drop: run ? (d === 1 ? 90 : 50) : 15 });
}
history.sort((a, b) => b.ts - a.ts);
const entries = [];
for (let t0 = Math.floor((now - 7 * 24 * HOUR) / (5 * MIN)) * 5 * MIN; t0 < now; t0 += 5 * MIN) {   // on whole 5 minutes, like the 17:00 starts
  let v = 150;
  for (const x of drops) if (t0 >= x.T) { const m = (t0 - x.T) / MIN; if (m <= x.mins) v = 150 - x.drop * m / x.mins; else if (m <= x.mins + 360) v = 150 - x.drop + Math.min(x.drop, (m - x.mins) / 4); }
  entries.push({ sgv: Math.round(v), date: t0, direction: "Flat" });
}
be.glucose = entriesToGlucoseRows(entries, "user-1");
be.row = { user_id: "user-1", data: stateBlob({ history, settings: { units, nightscoutUrl: "https://demo.ns.example.com/?token=tok-abcdef-123456" } }), updated_at: be.stamp() };

const dev = await openDevice(app, { width: W, height: 900, mobile: W < 1000, dark, inject: fakeSupabaseSource({ userId: "user-1" }), wait: 2000 });
await dev.tab("history"); await dev.click('[data-seg="trends"]'); await sleep(300);
await dev.click('[data-range="14"]').catch(() => {});
await dev.waitFor(`[...document.querySelectorAll("#trend-insights .panel-card__title")].some(h => h.textContent === "Activity and glucose")`, 60000, 300);

t.section(`ACTIVITY AND GLUCOSE (${units}, ${W}px${dark ? ", dark" : ""})`);
const card = await dev.eval(`(() => {
  const c = [...document.querySelectorAll("#trend-insights .ins-card")].find(x => x.querySelector(".panel-card__title").textContent === "Activity and glucose");
  return [...c.querySelectorAll("li")].map(li => ({ name: li.querySelector(".ins-li__name").textContent, val: li.querySelector(".ins-li__val").textContent, sub: [...li.querySelectorAll(".rtrend__n")].map(x => x.textContent) }));
})()`);
console.log("  ", JSON.stringify(card));
const mm = units === "mmol";
t.check("Run comes first (4 times), then Walk (2)", card.length === 2 && card[0].name === "Run" && card[1].name === "Walk", card.map(c => c.name).join(","));
t.check("Run's average change is −60 (one hard −90, three −50)", card[0].val === (mm ? "−3.3 mmol/L" : "−60 mg/dL"), card[0].val);
t.check("Walk's is −15", card[1].val === (mm ? "−0.8 mmol/L" : "−15 mg/dL"), card[1].val);
t.check("Run says 4 times, about 40 min", /^4 times · about 40 min · started at/.test(card[0].sub[0]), card[0].sub[0]);
t.check("the hard run that dipped low is counted", new RegExp(`1 went below ${mm ? "3.9 mmol/L" : "70 mg/dL"}`).test(card[0].sub[1]), card[0].sub[1]);
t.check("Run is split by intensity", /Moderate −.*\(3\) · Hard −.*\(1\)/.test(card[0].sub[2] || ""), card[0].sub[2]);
if (SHOTS) {
  await dev.eval(`[...document.querySelectorAll("#trend-insights .ins-card")].find(x => x.querySelector(".panel-card__title").textContent === "Activity and glucose").scrollIntoView({ block: "center" })`); await sleep(300);
  await dev.shot(`${SHOTS}/activity-card-${units}-${W}${dark ? "-dark" : ""}.png`);
}

t.section("AN OPENED ACTIVITY ROW shows its own glucose");
await dev.click('[data-seg="log"]'); await sleep(400);
await dev.eval(`document.querySelector(".history-entry--activity .history-entry__main").click()`); await sleep(1500);
const line = await dev.eval(`(document.querySelector(".history-entry--activity .activity-detail--glu") || {}).textContent || ""`);
t.check("it reads start → end, the change and the lowest after", new RegExp(mm ? "Glucose 8\\.3 → 3\\.3 mmol/L during \\(−5\\) · lowest 3\\.3 mmol/L up to 6 h after \\(low\\)" : "Glucose 150 → 60 mg/dL during \\(−90\\) · lowest 60 mg/dL up to 6 h after \\(low\\)").test(line), line);
if (SHOTS) await dev.shot(`${SHOTS}/activity-row-open-${units}-${W}${dark ? "-dark" : ""}.png`);
t.check("no JS errors", (await dev.eval("window.__errs.length")) === 0 && dev.errors.length === 0, JSON.stringify(await dev.eval("window.__errs")));
dev.close(); await app.close();
process.exit(t.summary() ? 0 : 1);
