// A long glucose window must show ALL of its readings, however many there are (it used to stop at 30,000, so a sensor
// that records every ~2.5 minutes showed only about 51 of 90 days).
import { createBackend, startApp, openDevice, fakeSupabaseSource, makeChecker } from "./harness.js";
import { FOODS_JS, stateBlob } from "./helpers.js";
import { entriesToGlucoseRows } from "../../js/nightscout.js";

const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const be = createBackend();
const app = await startApp(DIR, be, { "foods_data.js": FOODS_JS });
be.row = { user_id: "user-1", data: stateBlob({ settings: { nightscoutUrl: "https://demo.ns.example.com/?token=tok-abcdef-123456" } }), updated_at: be.stamp() };
const now = Date.now(), entries = [];
const PER_DAY = 580, DAYS = 91; // one reading about every 2.5 minutes
for (let d = DAYS; d >= 0; d--) for (let k = 0; k < PER_DAY; k++) { const at = now - d * 86400000 + k * (86400000 / PER_DAY); if (at < now) entries.push({ sgv: 90 + ((k * 7 + d) % 90), date: Math.round(at), direction: "Flat" }); }
be.glucose = entriesToGlucoseRows(entries, "user-1");
const inWindow = be.glucose.filter(r => new Date(r.at).getTime() >= now - 90 * 86400000 + 120000).length;

t.section(`GLUCOSE WINDOW: ${inWindow.toLocaleString()} readings in 90 days are all shown`);
const dev = await openDevice(app, { width: 1100, height: 900, mobile: false, inject: fakeSupabaseSource({ userId: "user-1" }), wait: 2000 });
await dev.tab("history"); await dev.click('[data-seg="glucose"]'); await sleep(300);
await dev.click('[data-range="90"]');
await dev.waitFor(`/Based on/.test(document.getElementById("glucose-tab-content").textContent)`, 60000, 300);
const txt = await dev.text("#glucose-tab-content");
const m = /Based on ([\d,]+) readings over (\d+) days/.exec(txt);
const shown = m ? Number(m[1].replace(/,/g, "")) : -1, days = m ? Number(m[2]) : -1;
t.check("every reading in the window is used (not capped at 30,000)", shown >= inWindow && shown <= inWindow + 5, `${shown} vs ${inWindow}`);
t.check("and it spans the whole 90 days, not about 51", days >= 90, String(days));
t.check("no JS errors", (await dev.eval("window.__errs.length")) === 0 && dev.errors.length === 0);
dev.close(); await app.close();
process.exit(t.summary() ? 0 : 1);
