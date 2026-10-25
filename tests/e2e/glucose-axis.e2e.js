// Glucose charts carry a value scale up the left side (round numbers with faint gridlines) besides the 70 and 180 lines,
// in the person's own unit, without any number landing on top of the 70/180 labels.
import { createBackend, startApp, openDevice, fakeSupabaseSource, makeChecker } from "./harness.js";
import { FOODS_JS, stateBlob } from "./helpers.js";
import { entriesToGlucoseRows } from "../../js/nightscout.js";

const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SHOTS = process.env.SHOTS || "";
const be = createBackend();
const app = await startApp(DIR, be, { "foods_data.js": FOODS_JS });
const units = process.env.GLU_UNITS || "mgdl";
be.row = { user_id: "user-1", data: stateBlob({ settings: { units, nightscoutUrl: "https://demo.ns.example.com/?token=tok-abcdef-123456" } }), updated_at: be.stamp() };
const now = Date.now(), entries = [];
// 14 days, a reading every 5 minutes: a daily shape with meal peaks, and a little day-to-day variation.
for (let d = 14; d >= 0; d--) for (let k = 0; k < 288; k++) {
  const at = now - d * 86400000 + k * 300000; if (at >= now) continue;
  const h = k / 12, peak = (c, w, a) => a * Math.exp(-((h - c) ** 2) / (2 * w * w));
  const v = 115 + peak(8.5, 1.2, 70) + peak(13.5, 1.4, 60) + peak(20, 1.6, 75) - peak(3.5, 1.5, 30) + ((d * 37 + k * 11) % 41) - 20 + (d % 3) * 12;
  entries.push({ sgv: Math.round(v), date: Math.round(at), direction: "Flat" });
}
be.glucose = entriesToGlucoseRows(entries, "user-1");

const W = Number(process.env.GLU_WIDTH || 390);
const dev = await openDevice(app, { width: W, height: 900, mobile: W < 1000, dark: process.env.GLU_DARK === "1", inject: fakeSupabaseSource({ userId: "user-1" }), wait: 2000 });
await dev.tab("history"); await dev.click('[data-seg="glucose"]'); await sleep(300);
await dev.click('[data-range="14"]').catch(() => {});
await dev.waitFor(`!!document.querySelector("#glucose-tab-content svg .glu-tick")`, 60000, 300);
await sleep(300);

t.section(`GLUCOSE AXIS (${units}, ${W}px): the daily pattern has a value scale`);
const info = await dev.eval(`(() => {
  const svg = document.querySelector("#glucose-tab-content svg .glu-tick").ownerSVGElement;
  const box = e => e.getBoundingClientRect();
  const ticks = [...svg.querySelectorAll(".glu-tick")];
  const fixed = [...svg.querySelectorAll("text")].filter(x => /^(70|180|3\\.9|10)$/.test(x.textContent) && !x.classList.contains("glu-tick"));
  const overlap = (a, b) => !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
  const sb = box(svg);
  return {
    labels: ticks.map(x => x.textContent),
    ys: ticks.map(x => box(x).top),
    grid: svg.querySelectorAll(".glu-grid").length,
    clash: ticks.some(a => fixed.some(b => overlap(box(a), box(b)))) || ticks.some((a, i) => ticks.some((b, j) => i < j && overlap(box(a), box(b)))),
    inside: ticks.every(x => { const r = box(x); return r.left >= sb.left - 1 && r.top >= sb.top - 1 && r.bottom <= sb.bottom + 1; }),
    fixedShown: fixed.map(x => x.textContent),
    hours: [...svg.querySelectorAll(".glu-hour")].map(x => x.textContent),
    hourClash: (() => { const h = [...svg.querySelectorAll(".glu-hour")].map(box); return h.some((a, i) => i && a.left < h[i - 1].right + 2); })()
  };
})()`);
console.log("  scale:", info.labels.join(" "), "| 70/180 labels:", info.fixedShown.join(" "));
t.check("there are at least three round numbers up the side", info.labels.length >= 3, info.labels.join(" "));
t.check(units === "mmol" ? "they count in whole mmol/L" : "they are round mg/dL values (multiples of 20, 25, 50 or 100)",
  info.labels.every(l => units === "mmol" ? /^\d+$/.test(l) : [20, 25, 50, 100].some(s => Number(l) % s === 0)), info.labels.join(" "));
t.check("each has a gridline", info.grid === info.labels.length, `${info.grid} vs ${info.labels.length}`);
t.check("the numbers go up as you go up the chart", info.ys.every((y, i) => i === 0 || y < info.ys[i - 1]), info.ys.join(","));
t.check("the 70 and 180 labels are still there", info.fixedShown.length === 2, info.fixedShown.join(" "));
t.check("no number overlaps another or the 70/180 labels", !info.clash);
t.check("all numbers sit inside the chart", info.inside);
t.check("the hours along the bottom are every 6 hours", info.hours.length === 5, info.hours.join(" | "));
t.check("and never run into each other", !info.hourClash);
if (SHOTS) {
  await dev.eval(`document.querySelector("#glucose-tab-content svg .glu-tick").ownerSVGElement.scrollIntoView({ block: "center" })`); await sleep(250);
  await dev.shot(`${SHOTS}/glu-axis-${units}-${W}${process.env.GLU_DARK === "1" ? "-dark" : ""}.png`);
}
t.check("no JS errors", (await dev.eval("window.__errs.length")) === 0 && dev.errors.length === 0, (await dev.eval("window.__errs")).join(" | "));
dev.close(); await app.close();
process.exit(t.summary() ? 0 : 1);
