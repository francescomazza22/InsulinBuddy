// Activity in the statistics (2.67.0): the "Meals near activity" switch, the Activity summary card and the breakfast
// comparison. 13 days: breakfast at 07:30 every day; on weekdays a 20-minute ride at 08:18 and glucose falls to ~80, at
// weekends no ride and glucose rises to ~200. AS_WIDTH (default 390), AS_DARK=1, SHOTS=<dir>.
import { createBackend, startApp, openDevice, fakeSupabaseSource, makeChecker } from "./harness.js";
import { FOODS_JS, stateBlob, meal } from "./helpers.js";
import { entriesToGlucoseRows } from "../../js/nightscout.js";
import { makeActivityEntry } from "../../js/activity.js";

const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SHOTS = process.env.SHOTS || "";
const W = Number(process.env.AS_WIDTH || 390), dark = process.env.AS_DARK === "1";
const MIN = 60000, HOUR = 3600000, now = Date.now();
const be = createBackend();
const app = await startApp(DIR, be, { "foods_data.js": FOODS_JS });

const history = [], days = [];
let weekdays = 0, weekends = 0;
for (let d = 1; d <= 13; d++) {
  const day = new Date(now - d * 24 * HOUR); day.setHours(7, 30, 0, 0);
  const B = day.getTime(), dow = day.getDay(), weekend = dow === 0 || dow === 6;
  history.push(meal("b" + d, B, { mealType: "breakfast", ratioLabel: "Breakfast", ratioValue: 8 }));
  if (!weekend) { history.push(makeActivityEntry({ type: "cycle", minutes: 20, intensity: "moderate", ts: B + 48 * MIN, now: B + 48 * MIN + d })); weekdays++; } else weekends++;
  days.push({ B, weekend });
}
history.sort((a, b) => b.ts - a.ts);
const entries = [];
for (let t0 = Math.floor((now - 14 * 24 * HOUR) / (5 * MIN)) * 5 * MIN; t0 < now; t0 += 5 * MIN) {
  let v = 130;
  for (const x of days) { const h = (t0 - x.B) / HOUR; if (h >= 0 && h <= 5) { const k = Math.sin(Math.min(h, 3) / 3 * Math.PI / 2); v = x.weekend ? 130 + 70 * k : 130 - 50 * k; } }
  entries.push({ sgv: Math.round(v), date: t0, direction: "Flat" });
}
be.glucose = entriesToGlucoseRows(entries, "user-1");
be.row = { user_id: "user-1", data: stateBlob({ history, settings: { nightscoutUrl: "https://demo.ns.example.com/?token=tok-abcdef-123456", timeRatios: [{ id: "tr-b", name: "Breakfast", ratio: 8, start: "05:00", end: "11:00", color: "#FF8D28" }] } }), updated_at: be.stamp() };

const dev = await openDevice(app, { width: W, height: 900, mobile: W < 1000, dark, inject: fakeSupabaseSource({ userId: "user-1" }), wait: 2000 });
await dev.tab("history"); await dev.click('[data-seg="trends"]'); await sleep(300);
await dev.click('[data-range="14"]').catch(() => {});
const titleIs = name => `[...document.querySelectorAll("#trend-insights .panel-card__title")].some(h => h.textContent === ${JSON.stringify(name)})`;
await dev.waitFor(titleIs("Where glucose is 3 hours after a meal"), 60000, 300);

t.section(`MEALS NEAR ACTIVITY switch (${W}px${dark ? ", dark" : ""}): ${weekdays} ride mornings, ${weekends} without`);
const sw = await dev.eval(`(() => { const c = document.getElementById("trend-card-activity-filter"); return { hidden: c.hidden, hint: document.getElementById("trend-activity-filter-hint").textContent, btns: [...c.querySelectorAll("[data-actfilter]")].map(b => ({ f: b.dataset.actfilter, on: b.classList.contains("is-active"), text: b.textContent.trim() })) }; })()`);
t.check("shown, because some meals were near a ride", !sw.hidden);
t.check("says how many meals were near activity", sw.hint.includes(`${weekdays} of ${weekdays + weekends} meals`), sw.hint);
t.check("defaults to Without activity", sw.btns.find(b => b.f === "without").on);
t.check("buttons carry their meal counts", sw.btns.map(b => b.text.replace(/\s+/g, " ")).join("|") === `Without activity ${weekends}|Near activity ${weekdays}|All meals ${weekdays + weekends}`, sw.btns.map(b => b.text).join("|"));
const outcomeN = () => dev.eval(`(() => { const c = [...document.querySelectorAll("#trend-insights .ins-card")].find(x => x.querySelector(".panel-card__title").textContent === "Where glucose is 3 hours after a meal"); return c ? c.querySelector(".ins-row .rtrend__n").textContent : ""; })()`);
let o = await outcomeN();
t.check("outcome card uses only the quiet-morning meals", o.startsWith(`${weekends} meal`), o);
t.check("the insights say meals near activity were left out", /Meal cards: \d+ meals? near a logged activity left out/.test(await dev.text("#trend-insights")));
const idealCap = await dev.text("#trend-ideal");
t.check("the ideal ratio caption says so too", idealCap.includes(`${weekdays} meals near a logged activity left out`), idealCap.slice(-220));
if (SHOTS) { await dev.eval(`document.getElementById("trend-card-activity-filter").scrollIntoView({ block: "start" })`); await sleep(300); await dev.shot(`${SHOTS}/as-switch-${W}${dark ? "-dark" : ""}.png`); }
await dev.click('[data-actfilter="only"]'); await sleep(400);
o = await outcomeN();
t.check("Near activity: only the ride mornings", o.startsWith(`${weekdays} meal`), o);
await dev.click('[data-actfilter="all"]'); await sleep(400);
o = await outcomeN();
t.check("All meals: every breakfast", o.startsWith(`${weekdays + weekends} meal`), o);
t.check("no left-out note with All meals", !/Meal cards:/.test(await dev.text("#trend-insights")));
await dev.click('[data-actfilter="without"]'); await sleep(400);
t.check("the choice is remembered", (await dev.eval(`localStorage.getItem("insulinBuddy.activityFilter")`)) === "without");

t.section("ACTIVITY SUMMARY card");
await dev.waitFor(titleIs("Activity summary"), 8000);
const sum = await dev.eval(`(() => { const c = [...document.querySelectorAll("#trend-insights .ins-card")].find(x => x.querySelector(".panel-card__title").textContent === "Activity summary"); return { cols: [...c.querySelectorAll(".ins-col")].map(x => x.textContent.replace(/\\s+/g, " ").trim()), types: [...c.querySelectorAll("li")].map(x => x.textContent.replace(/\\s+/g, " ").trim()) }; })()`);
console.log("  ", JSON.stringify(sum));
t.check("minutes a week, with its unit", new RegExp(`^A week\\s*${Math.round(weekdays * 20 / 14 * 7)} min`).test(sum.cols[0]), sum.cols[0]);
t.check("active days out of the period", new RegExp(`^Active days\\s*${weekdays} of 14`).test(sum.cols[1]), sum.cols[1]);
t.check("cycling listed with total time and count", sum.types[0].startsWith("Cycling") && sum.types[0].includes(`${weekdays} times`), sum.types[0]);
t.check("active days vs rest days columns, in range and the night after", sum.cols.length === 4 && /in range/.test(sum.cols[2]) && /night after/.test(sum.cols[2]) && sum.cols[3].startsWith("Rest days"), sum.cols.slice(2).join(" / "));
if (SHOTS) { await dev.eval(`[...document.querySelectorAll("#trend-insights .ins-card")].find(x => x.querySelector(".panel-card__title").textContent === "Activity summary").scrollIntoView({ block: "start" })`); await sleep(300); await dev.shot(`${SHOTS}/as-summary-${W}${dark ? "-dark" : ""}.png`); }

t.section("BREAKFAST: active vs quiet mornings");
const bf = await dev.eval(`(() => { const c = [...document.querySelectorAll("#trend-insights .ins-card")].find(x => x.querySelector(".panel-card__title").textContent === "Breakfast: active vs quiet mornings"); return c ? [...c.querySelectorAll(".ins-col")].map(x => x.textContent.replace(/\\s+/g, " ").trim()) : null; })()`);
console.log("  ", JSON.stringify(bf));
const num = s => Number((/(\d+) mg\/dL/.exec(s) || [])[1]);
t.check("active mornings: the ride days, lower 3 h after", bf && bf[0].startsWith("Active mornings") && bf[0].includes(`${weekdays} breakfasts`) && num(bf[0]) < 100, bf && bf[0]);
t.check("quiet mornings: higher 3 h after", bf && bf[1].startsWith("Quiet mornings") && bf[1].includes(`${weekends} breakfast`) && num(bf[1]) > 180, bf && bf[1]);
t.check("each shows the ratio used, with its unit", bf && bf.every(c => /ratio 1u:8g \(Breakfast\)/.test(c)), bf && bf.join(" / "));
if (SHOTS) { await dev.eval(`[...document.querySelectorAll("#trend-insights .ins-card")].find(x => x.querySelector(".panel-card__title").textContent === "Breakfast: active vs quiet mornings").scrollIntoView({ block: "start" })`); await sleep(300); await dev.shot(`${SHOTS}/as-breakfast-${W}${dark ? "-dark" : ""}.png`); }
t.check("no page-wide horizontal scroll", await dev.eval(`document.documentElement.scrollWidth <= window.innerWidth + 1`));
t.check("no JS errors", (await dev.eval("window.__errs.length")) === 0 && dev.errors.length === 0, JSON.stringify(await dev.eval("window.__errs")));
dev.close(); await app.close();
process.exit(t.summary() ? 0 : 1);
