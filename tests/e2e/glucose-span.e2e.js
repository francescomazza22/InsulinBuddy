// A sensor that reports every minute: 12h and 24h must really show 12h and 24h (one request holds only 1000 readings).
import { createBackend, startApp, openDevice, fakeSupabaseSource, makeChecker } from "./harness.js";
import { FOODS_JS, stateBlob } from "./helpers.js";

const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const be = createBackend();
const app = await startApp(DIR, be, { "foods_data.js": FOODS_JS, "manifest.json": "{}" });
const MIN = 60000, now = Date.now();
const entries = [];
for (let m = 30 * 60; m >= 0; m--) entries.push({ sgv: Math.round(120 + 30 * Math.sin(m / 40)), date: now - m * MIN - 20000, direction: "Flat" });
be.ns.entries = entries;
be.row = { user_id: "user-1", data: stateBlob({ history: [], settings: { nightscoutUrl: "https://demo.ns.example.com/?token=tok-abcdef-123456" } }), updated_at: be.stamp() };
const dev = await openDevice(app, { width: 420, height: 900, mobile: true, inject: fakeSupabaseSource({ userId: "user-1" }), wait: 2500 });
const pts = () => dev.eval(`(() => { const p = [...document.querySelectorAll("#aiog-content svg")[0].querySelectorAll("path")].map(x => (x.getAttribute("d") || "").split("L").length).sort((a,b)=>b-a); return p[0]; })()`);

await dev.click("#cc-live-glucose"); await sleep(500);
await dev.waitFor(`document.querySelectorAll("#aiog-content .glucose-range-btn").length === 4`, 20000, 300);
await sleep(1200);
const stored = await dev.eval(`(JSON.parse(localStorage.getItem("insulinBuddy.glucoseRecent2") || "{}").entries || [])`);
const oldest = Math.min(...stored.map(e => e.date));
t.check("a full day of 1-minute readings is kept (not just the latest 1000)", stored.length > 1500, String(stored.length));
t.check("it reaches back at least 25 hours", now - oldest > 25 * 3600000, String(Math.round((now - oldest) / 3600000)));
const counts = {};
for (const h of [3, 6, 12, 24]) {
  await dev.eval(`document.querySelector('.glucose-range-btn[data-hours="${h}"]').click()`); await sleep(500);
  counts[h] = await pts();
}
t.check("each longer window draws more readings", counts[3] <= counts[6] && counts[6] < counts[12] && counts[12] < counts[24], JSON.stringify(counts));
t.check("24h really holds about 24 hours of readings", counts[24] > 1300, JSON.stringify(counts));
t.check("no JS errors", dev.errors.length === 0, JSON.stringify(dev.errors));
dev.close(); await app.close();
process.exit(t.summary() ? 0 : 1);
