// The carbs line on the Now tab must join smoothly at "now" even when the readings say more carbs are left than the timers do.
import { createBackend, startApp, openDevice, fakeSupabaseSource, makeChecker } from "./harness.js";
import { FOODS_JS, stateBlob, meal } from "./helpers.js";

const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const be = createBackend();
const app = await startApp(DIR, be, { "foods_data.js": FOODS_JS, "manifest.json": "{}" });
const MIN = 60000, now = Date.now();
const m = meal("m1", now - 100 * MIN, { totalCarbs: 100, mealDose: 10, ratioValue: 10 });
const entries = [];
for (let mm = -160; mm <= 0; mm += 5) entries.push({ sgv: Math.round(150 - Math.max(0, mm + 100) * 0.2), date: now + mm * MIN - 2 * MIN, direction: "Flat" });   // glucose does not rise after the meal
be.ns.entries = entries;
be.row = { user_id: "user-1", data: stateBlob({ history: [m], settings: { nightscoutUrl: "https://demo.ns.example.com/?token=tok-abcdef-123456" } }), updated_at: be.stamp() };
const dev = await openDevice(app, { width: 420, height: 900, mobile: true, inject: fakeSupabaseSource({ userId: "user-1" }), wait: 2500 });
await dev.click(".active-panel"); await sleep(400);
await dev.waitFor(`/follows your glucose readings/.test(document.getElementById("aiog-content").textContent)`, 20000, 300);
const d = await dev.eval(`(document.querySelector('#aiog-content path[stroke="#D97706"]') || {getAttribute: () => ""}).getAttribute("d")`);
const ys = (d.match(/[ML]\s*[-\d.]+[ ,][-\d.]+/g) || []).map(x => Number(x.replace(/[ML]\s*/, "").split(/[ ,]/)[1]));
let worst = 0; for (let k = 1; k < ys.length; k++) worst = Math.max(worst, ys[k - 1] - ys[k]);
t.check("the readings really do disagree with the timers here", /still to absorb/.test(await dev.text("#aiog-content")));
t.check("no upward jump in the carbs line", ys.length > 5 && worst < 3, `points ${ys.length}, biggest rise ${worst.toFixed(1)}px`);
t.check("no JS errors", dev.errors.length === 0);
dev.close(); await app.close();
process.exit(t.summary() ? 0 : 1);
