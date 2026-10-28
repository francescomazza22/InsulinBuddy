// Next 2 hours (2.71.0): the Now tab shows a likely range built from what glucose did next at similar past moments,
// with its middle line, a plain caption, the track record on the last 14 days, and an explanation.
// Env: FC_WIDTH (default 390), FC_DARK=1, FC_UNITS=mmol, SHOTS=<dir>.
import { createBackend, startApp, openDevice, fakeSupabaseSource, makeChecker } from "./harness.js";
import { FOODS_JS, stateBlob, meal } from "./helpers.js";
import { entriesToGlucoseRows } from "../../js/nightscout.js";

const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const W = Number(process.env.FC_WIDTH || 390), DARK = process.env.FC_DARK === "1", MMOL = process.env.FC_UNITS === "mmol", SHOTS = process.env.SHOTS;
const be = createBackend();
const app = await startApp(DIR, be, { "foods_data.js": FOODS_JS, "manifest.json": "{}" });

// 20 days, a reading every 5 min: after lunch (60 g, 6 u at 13:00 local) glucose climbs to ~210 by 14:00 and settles back
// to ~110 by 16:30; otherwise ~110 with a gentle daily wave. Today's lunch was 70 minutes ago.
const MIN = 60000, DAY = 86400000;
const nowMs = Math.floor(Date.now() / (5 * MIN)) * 5 * MIN;
const lunchToday = nowMs - 70 * MIN;
const lunches = Array.from({ length: 21 }, (_, d) => lunchToday - (20 - d) * DAY);
const glucoseAt = at => {
  let g = 110 + 8 * Math.sin(at / (5 * 3600000));
  for (const l of lunches) {
    const m = (at - l) / MIN;
    if (m > 0 && m < 210) g += m < 60 ? 100 * (m / 60) : 100 * (1 - (m - 60) / 150);
  }
  return Math.round(g + 4 * Math.sin(at / 700000));
};
const entries = [];
for (let at = nowMs - 20 * DAY; at <= nowMs - 2 * MIN; at += 5 * MIN) entries.push({ sgv: glucoseAt(at), date: at, direction: "Flat" });
be.glucose = entriesToGlucoseRows(entries, "user-1");
be.ns.entries = entries.filter(e => e.date > nowMs - 8 * 3600000);
const history = lunches.map((ts, i) => meal("lunch" + i, ts, { totalCarbs: 60, mealDose: 6, ratioValue: 10 }));
be.row = { user_id: "user-1", data: stateBlob({ history, settings: { units: MMOL ? "mmol" : "mgdl", isf: MMOL ? 2.8 : 50, target: MMOL ? 6.1 : 110, nightscoutUrl: "https://demo.ns.example.com/?token=tok-abcdef-123456" } }), updated_at: be.stamp() };

t.section(`NEXT 2 HOURS (${W}px${DARK ? ", dark" : ""}${MMOL ? ", mmol/L" : ""})`);
const dev = await openDevice(app, { width: W, height: 900, mobile: W < 700, dark: DARK, inject: fakeSupabaseSource({ userId: "user-1" }), wait: 2500 });
await dev.click(".active-panel"); await sleep(400);
await dev.waitFor(`/usually between/.test(document.getElementById("aiog-content").textContent)`, 60000, 300);
const txt = await dev.text("#aiog-content");
t.check("headed 'Next 2 hours', not the old projection", /Next 2 hours/.test(txt) && !/Projected glucose/.test(txt) && !/Settles around/.test(txt));
t.check("says it is from similar past moments with nothing eaten or dosed after, and is not advice", /most similar moments/.test(txt) && /didn.t eat or dose again/.test(txt) && /not dosing advice/.test(txt), txt.slice(0, 500));
const unit = MMOL ? "mmol/L" : "mg/dL";
const NUM = "(\\d+(?:\\.\\d+)?)";
const m = new RegExp(`usually between ${NUM} and ${NUM} ${unit.replace("/", "\\/")}, middle about ${NUM}`).exec(txt);
t.check("caption gives a range and a middle in the user's unit", !!m, txt.slice(-500));
if (m) {
  const [lo, hi, mid] = m.slice(1).map(Number).map(v => MMOL ? v * 18.016 : v);
  t.check("range is ordered", lo <= mid && mid <= hi, `${lo} ${mid} ${hi}`);
  // 70 min after lunch the past says: down from the peak towards ~110-140 two hours later
  t.check("follows the past pattern: middle 2 h later well below the post-lunch peak", mid > 85 && mid < 160, String(mid));
}
t.check("shaded band drawn under a dashed middle line", await dev.eval(`!!document.querySelector("#aiog-content path.glu-band") && !!document.querySelector('#aiog-content path[stroke="#8B5CF6"][stroke-dasharray]')`));
t.check("legend names the band", /Likely range/.test(txt) && /Middle/.test(txt));
t.check("track record on the last 14 days is shown", /Checked on \d+ moments from your last 14 days, the range held the real 2-hour value \d+% of the time/.test(txt), txt.slice(-300));

t.section("EXPLANATION");
const n = await dev.eval(`[...document.querySelectorAll("#aiog-content .aiog-head")].findIndex(h => /Next 2 hours/.test(h.textContent))`);
await dev.eval(`document.querySelectorAll("#aiog-content .aiog-head")[${n}].querySelector(".info-btn").click()`); await sleep(200);
const info = await dev.eval(`document.querySelectorAll("#aiog-content .aiog-head")[${n}].nextElementSibling.textContent`);
t.check("the i explains the method in the user's numbers and why not the old maths", /40 moments most like now/.test(info) && /logged nothing/.test(info) && /correction factor \((50|2.8)/.test(info) && /further off than simply assuming no change/.test(info), info.slice(0, 300));
if (SHOTS) {
  await dev.eval(`document.querySelectorAll("#aiog-content .aiog-head")[${n}].querySelector(".info-btn").click()`); await sleep(150);
  await dev.eval(`document.querySelectorAll("#aiog-content .aiog-head")[${n}].scrollIntoView({ block: "start" })`); await sleep(200);
  await dev.shot(`${SHOTS}/forecast-${W}${DARK ? "-dark" : ""}${MMOL ? "-mmol" : ""}.png`);
}
t.check("no JS errors", (await dev.eval("window.__errs.length")) === 0 && dev.errors.length === 0, JSON.stringify(dev.errors).slice(0, 300));
dev.close(); await app.close();
process.exit(t.summary() ? 0 : 1);
