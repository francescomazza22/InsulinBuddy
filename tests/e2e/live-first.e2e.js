// Nightscout (Gluroo) carries two copies of one sensor: live readings with a trend arrow (every few minutes) and a later,
// arrow-less, smoother copy every 5 minutes. Mixed together they made the glucose line zig-zag and lifted real lows out
// of the low band. Since 2.69.1 an arrow-less reading is used only where no live one is within 2.5 minutes (gaps).
// Env: LF_WIDTH (default 390), LF_DARK=1, SHOTS=<dir>.
import { createBackend, startApp, openDevice, fakeSupabaseSource, makeChecker } from "./harness.js";
import { FOODS_JS, stateBlob } from "./helpers.js";
import { entriesToGlucoseRows } from "../../js/nightscout.js";

const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const W = Number(process.env.LF_WIDTH || 390), DARK = process.env.LF_DARK === "1", SHOTS = process.env.SHOTS;
const be = createBackend();
const app = await startApp(DIR, be, { "foods_data.js": FOODS_JS });
be.row = { user_id: "user-1", data: stateBlob({ settings: { nightscoutUrl: "https://demo.ns.example.com/?token=tok-abcdef-123456" } }), updated_at: be.stamp() };

// Six days ending an hour ago: live every 3 min, arrow-less every 5 min; each day dips once (live to ~55, copy to ~75).
// A 40-minute hole in the live readings on one day is filled only by the arrow-less copy.
const MIN = 60000, end = Math.floor((Date.now() - 3600000) / MIN) * MIN, start = end - 6 * 86400000;
const dip = (m, depth, width) => Math.round(115 - depth * Math.exp(-((((m % 1440) - 720) / width) ** 2)));
const live = [], shadow = [];
const holeFrom = start + 2 * 86400000 + 300 * MIN, holeTo = holeFrom + 40 * MIN;
for (let at = start; at <= end; at += 3 * MIN) if (at < holeFrom || at > holeTo) live.push({ sgv: dip((at - start) / MIN, 60, 40), date: at + 25000, direction: "Flat" });
for (let at = start + MIN; at <= end; at += 5 * MIN) shadow.push({ sgv: dip((at - start) / MIN, 40, 55), date: at + 26000 });
be.glucose = entriesToGlucoseRows([...live, ...shadow], "user-1");
const gapFill = shadow.filter(s => !live.some(l => Math.abs(l.date - s.date) <= 150000)).length;
const expected = live.length + gapFill;
const pct = list => (100 * list.filter(e => e.sgv < 70).length / list.length);

t.section(`LIVE FIRST (${W}px${DARK ? ", dark" : ""}): ${live.length} live + ${shadow.length} arrow-less readings stored`);
const dev = await openDevice(app, { width: W, height: 900, mobile: W < 700, dark: DARK, inject: fakeSupabaseSource({ userId: "user-1" }), wait: 2000 });
await dev.tab("history"); await dev.click('[data-seg="glucose"]'); await sleep(300);
await dev.click('[data-range="7"]');
await dev.waitFor(`/Based on/.test(document.getElementById("glucose-tab-content").textContent)`, 60000, 300);
const txt = await dev.text("#glucose-tab-content");
const m = /Based on ([\d,]+) readings/.exec(txt);
const shown = m ? Number(m[1].replace(/,/g, "")) : -1;
t.check("only live readings, plus arrow-less ones that fill the hole, are used", shown === expected, `${shown} used, expected ${expected} (${live.length} live + ${gapFill} gap fill; ${live.length + shadow.length} stored)`);
t.check("the hole is filled (gap readings kept)", gapFill >= 6, String(gapFill));
t.check("everything is still stored (nothing deleted)", be.glucose.length === live.length + shadow.length);
console.log(`  low share: live ${pct(live).toFixed(1)}%, mixed ${pct([...live, ...shadow]).toFixed(1)}%`);
if (SHOTS) await dev.shot(`${SHOTS}/live-first-${W}${DARK ? "-dark" : ""}.png`);
t.check("no JS errors", (await dev.eval("window.__errs.length")) === 0 && dev.errors.length === 0);
dev.close(); await app.close();
process.exit(t.summary() ? 0 : 1);
