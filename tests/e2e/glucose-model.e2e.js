// Active Insulin & Carbs: the Now tab follows the readings and shows a labelled projection; the Glucose tab compares
// readings with what insulin alone would do; Settings can learn carb timers from history.
import { createBackend, startApp, openDevice, fakeSupabaseSource, makeChecker } from "./harness.js";
import { FOODS_JS, stateBlob, meal } from "./helpers.js";

const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const be = createBackend();
const app = await startApp(DIR, be, { "foods_data.js": FOODS_JS, "manifest.json": "{}" });
const MIN = 60000, now = Date.now();
const m = meal("m1", now - 90 * MIN, { totalCarbs: 60, mealDose: 6, ratioValue: 10 });
const entries = [];
for (let mm = -150; mm <= 0; mm += 5) {
  const g = 110 + (mm > -90 ? Math.min(60, (mm + 90) * 1.0) * 1.2 : 0);
  entries.push({ sgv: Math.round(g), date: now + mm * MIN - 2 * MIN, direction: "Flat" });
}
be.ns.entries = entries;
be.row = { user_id: "user-1", data: stateBlob({ history: [m], settings: { nightscoutUrl: "https://demo.ns.example.com/?token=tok-abcdef-123456" } }), updated_at: be.stamp() };
const dev = await openDevice(app, { width: 420, height: 900, mobile: true, inject: fakeSupabaseSource({ userId: "user-1" }), wait: 2500 });

t.section("NOW TAB: observed carbs and the labelled next-2-hours range");
await dev.click(".active-panel"); await sleep(400);
await dev.waitFor(`/Next 2 hours/.test(document.getElementById("aiog-content").textContent) && !/Looking at your last/.test(document.getElementById("aiog-content").textContent)`, 30000, 300);
const now_ = await dev.text("#aiog-content");
// with only 2.5 h of readings there is too little history for a range, and the section says so instead of guessing
t.check("the range section explains itself: labelled range, or why there is none", /Next 2 hours/.test(now_) && (/didn.t eat or dose again/.test(now_) && /not dosing advice/.test(now_) || /Not enough history yet|stored glucose history/.test(now_)), now_.slice(now_.indexOf("Next 2 hours"), now_.indexOf("Next 2 hours") + 300));
t.check("the carbs line says it follows the readings (or why it can't)", /follows your glucose readings|Not enough readings/.test(now_));
await dev.eval(`document.getElementById("aiog-content").scrollIntoView()`); await dev.shot("/tmp/shots/gm-now.png"); await dev.eval(`document.getElementById("aiog-content").scrollTop=0`);
t.check("the active insulin & carbs chart is drawn (the range needs weeks of history: see forecast.e2e.js)", (await dev.eval(`document.querySelectorAll("#aiog-content svg").length`)) >= 1);
const carbsPath = await dev.eval(`(document.querySelector('#aiog-content path[stroke="#D97706"]') || {getAttribute: () => ""}).getAttribute("d")`);
const ys = (carbsPath.match(/[ML]\s*[-\d.]+[ ,][-\d.]+/g) || []).map(x => Number(x.replace(/[ML]\s*/, "").split(/[ ,]/)[1]));
let worstRise = 0; for (let k = 1; k < ys.length; k++) worstRise = Math.max(worstRise, ys[k - 1] - ys[k]);   // SVG y shrinks when the line goes UP
t.check("the carbs line never jumps up at 'now' (it only falls)", ys.length > 5 && worstRise < 3, `points ${ys.length}, biggest rise ${worstRise.toFixed(1)}px`);

t.section("INFO BUTTONS");
const nInfo = await dev.eval(`document.querySelectorAll("#aiog-content .info-btn").length`);
t.check("an i beside each of the Now tab's graphs", nInfo >= 2, String(nInfo));
await dev.eval(`document.querySelectorAll("#aiog-content .info-btn")[1].click()`); await sleep(200);
const open1 = await dev.eval(`(() => { const b = document.querySelectorAll("#aiog-content .info-btn")[1]; const p = b.parentElement.nextElementSibling; return { hidden: p.hidden, txt: p.textContent, ex: b.getAttribute("aria-expanded") }; })()`);
t.check("tapping it opens an explanation using the user's own numbers", !open1.hidden && /correction factor \(50/.test(open1.txt) && open1.ex === "true", JSON.stringify(open1).slice(0, 200));
await dev.shot("/tmp/shots/gm-info.png");
await dev.eval(`document.querySelectorAll("#aiog-content .info-btn")[1].click()`); await sleep(100);
t.check("tapping again closes it", await dev.eval(`document.querySelectorAll("#aiog-content .info-panel")[1].hidden`));

t.section("SHARED STORE: reopening is instant and does not re-download");
await dev.click("#aiog-close"); await sleep(300);
const readsBefore = be.log.filter(l => l.kind === "ns" && l.action === "read").length;
await dev.click(".active-panel"); await sleep(60);
const instant = await dev.text("#aiog-content");
t.check("reopened with the range section already there (no loading message)", /Next 2 hours/.test(instant) && !/Checking your glucose/.test(instant), instant.slice(0, 120));
await sleep(500);
const readsOpen = be.log.filter(l => l.kind === "ns" && l.action === "read").length;
await dev.click('[data-tab="glucose"]'); await sleep(300); await dev.click('[data-tab="now"]'); await sleep(300);
t.check("switching tabs inside the sheet needs no new Nightscout read", be.log.filter(l => l.kind === "ns" && l.action === "read").length === readsOpen, `${readsBefore} ${readsOpen}`);
const stored = await dev.eval(`(JSON.parse(localStorage.getItem("insulinBuddy.glucoseRecent2") || "{}").entries || []).length`);
t.check("the readings are kept on the device", stored > 20, String(stored));

t.section("GLUCOSE TAB: observed vs expected");
await dev.click('[data-tab="glucose"]');
await dev.waitFor(`/Observed vs expected/.test(document.getElementById("aiog-content").textContent)`, 20000, 300);
const gt = await dev.text("#aiog-content");
t.check("shows the comparison with an explanation of the gap", /above|below|tracking/.test(gt) && /insulin alone/.test(gt), gt.slice(-400));
await dev.click("#aiog-close"); await sleep(300);

t.section("SETTINGS: learn carb timers");
await dev.tab("settings"); await sleep(300);
t.check("learn button and toggle exist", (await dev.eval(`!!document.getElementById("btn-learn-abs") && !!document.getElementById("use-learned-abs-toggle")`)));
await dev.eval(`document.getElementById("btn-learn-abs").click()`); await sleep(1500);
const res = await dev.text("#learned-abs-result");
t.check("with a single meal it says there is not enough yet", /not enough yet/.test(res), res);
t.check("no JS errors", (await dev.eval("window.__errs.length")) === 0 && dev.errors.length === 0);
dev.close(); await app.close();
process.exit(t.summary() ? 0 : 1);
