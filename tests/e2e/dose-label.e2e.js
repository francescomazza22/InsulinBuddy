// The "Insulin dose" label at the top left of the dose card is the card's heading: it must be clearly bigger than the
// pills next to it (2.64.1, Francesco found it too small), shown in full, and the top row must stay on one line with the
// live glucose pill and the carbs pill showing, down to a 375px phone.
// LABEL_WIDTH (default 390), LABEL_DARK=1, SHOTS=<dir> for screenshots.
import { createBackend, startApp, openDevice, fakeSupabaseSource, makeChecker } from "./harness.js";
import { FOODS_JS, stateBlob } from "./helpers.js";
import { entriesToGlucoseRows } from "../../js/nightscout.js";

const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SHOTS = process.env.SHOTS || "";
const W = Number(process.env.LABEL_WIDTH || 390);
const dark = process.env.LABEL_DARK === "1";
const be = createBackend();
const app = await startApp(DIR, be, { "foods_data.js": FOODS_JS });
be.row = { user_id: "user-1", data: stateBlob({ settings: { units: "mgdl", nightscoutUrl: "https://demo.ns.example.com/?token=tok-abcdef-123456" } }), updated_at: be.stamp() };
const now = Date.now(), entries = [];
for (let k = 36; k >= 0; k--) entries.push({ sgv: 123, date: now - k * 300000 - 30000, direction: "Flat" });
be.glucose = entriesToGlucoseRows(entries, "user-1");

const dev = await openDevice(app, { width: W, height: 900, mobile: W < 1000, dark, inject: fakeSupabaseSource({ userId: "user-1" }) + `localStorage.setItem("insulinBuddy.liveGlucose", JSON.stringify({ mgdl: 123, direction: "Flat", at: Date.now() - 60000 }));`, wait: 2000 });
await dev.tab("calculator");
await dev.waitFor(`(() => { const p = document.getElementById("cc-live-glucose"); return !!p && !p.hidden && /\\d/.test(p.textContent); })()`, 60000, 300);
// A long carbs figure, so the row is as full as it gets in normal use.
await dev.eval(`(() => { const p = document.getElementById("cc-carbs-pill"); p.textContent = "152.5g carbs"; return true; })()`);
await sleep(200);

t.section(`DOSE LABEL (${W}px${dark ? ", dark" : ""}): the "Insulin dose" heading is big enough and the top row fits`);
const info = await dev.eval(`(() => {
  const label = document.querySelector(".dose-card__label"), carbs = document.getElementById("cc-carbs-pill"), glu = document.getElementById("cc-live-glucose");
  const fs = e => parseFloat(getComputedStyle(e).fontSize), box = e => e.getBoundingClientRect();
  const l = box(label), c = box(carbs), g = box(glu), mid = r => (r.top + r.bottom) / 2;
  return { label: fs(label), carbs: fs(carbs), glu: fs(glu), text: label.textContent,
    truncated: label.scrollWidth > label.clientWidth + 0.5,
    oneLine: Math.abs(mid(l) - mid(c)) < 3 && Math.abs(mid(c) - mid(g)) < 3,
    overlap: l.right > g.left - 4,
    labelHeight: l.height, pillHeight: c.height };
})()`);
console.log(`  label ${info.label}px, carbs pill ${info.carbs}px, glucose pill ${info.glu}px`);
t.check("the label still says Insulin dose", info.text.trim() === "Insulin dose", info.text);
t.check("the label is at least 14px", info.label >= 14, `${info.label}px`);
t.check("the label is bigger than the pills beside it", info.label > info.carbs && info.label > info.glu, `${info.label} vs ${info.carbs}/${info.glu}`);
t.check("the label is shown in full (no …)", !info.truncated);
t.check("label, glucose pill and carbs pill stay on one line", info.oneLine);
t.check("the label doesn't run into the glucose pill", !info.overlap);
t.check("the label is no taller than the pills (row height unchanged)", info.labelHeight <= info.pillHeight + 0.5, `${info.labelHeight} vs ${info.pillHeight}`);
if (SHOTS) await dev.shot(`${SHOTS}/dose-label-${W}${dark ? "-dark" : ""}.png`);
t.check("no JS errors", (await dev.eval("window.__errs.length")) === 0 && dev.errors.length === 0, (await dev.eval("window.__errs")).join(" | "));
dev.close(); await app.close();
process.exit(t.summary() ? 0 : 1);
