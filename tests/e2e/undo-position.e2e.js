// The Undo bar must never sit on top of the Log / Reset buttons (or the tab bar), on a phone, a tablet and a desktop.
import { startApp, openDevice, makeChecker } from "./harness.js";
import { FOODS_JS, logMeal } from "./helpers.js";

const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const app = await startApp(DIR, null, { "foods_data.js": FOODS_JS });
const rects = dev => dev.eval(`(() => {
  const r = id => { const e = document.getElementById(id); if (!e || e.hidden) return null; const b = e.getBoundingClientRect(); return b.width ? { t: b.top, b: b.bottom, l: b.left, r: b.right } : null; };
  return { toast: r("undo-toast"), log: r("cc-log-btn"), reset: r("cc-reset-btn"), bar: r("cc-sticky-log-bar"), tab: (() => { const e = document.querySelector(".tabbar"); const b = e.getBoundingClientRect(); return b.width ? { t: b.top, b: b.bottom, l: b.left, r: b.right } : null; })() };
})()`);
const overlap = (a, b) => !!a && !!b && a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;

for (const [label, width, height, mobile] of [["phone", 390, 800, true], ["tablet", 820, 900, false], ["desktop", 1280, 900, false]]) {
  t.section(`${label} (${width} px wide)`);
  const dev = await openDevice(app, { width, height, mobile, wait: 2200 });
  await logMeal(dev, 0, 100); await sleep(400);
  const q = await rects(dev);
  t.check("the Undo bar is showing", !!q.toast);
  t.check("it does not cover the Log button", !overlap(q.toast, q.log), JSON.stringify(q));
  t.check("it does not cover the Reset button", !overlap(q.toast, q.reset), JSON.stringify(q));
  t.check("it does not cover the Log bar", !overlap(q.toast, q.bar), JSON.stringify(q));
  t.check("it does not cover the tab bar", !overlap(q.toast, q.tab), JSON.stringify(q));
  t.check("and it is fully on screen", q.toast && q.toast.t >= 0 && q.toast.b <= height, JSON.stringify(q.toast));
  if (mobile) {
    await dev.tab("history"); await sleep(300);
    await dev.eval(`document.getElementById("undo-toast").hidden = false`);
    const h = await rects(dev);
    t.check("on another screen it sits just above the tab bar", h.toast && h.tab && h.toast.b <= h.tab.t && h.tab.t - h.toast.b < 40, JSON.stringify(h));
  }
  t.check("no JS errors", dev.errors.length === 0, JSON.stringify(dev.errors));
  dev.close();
}
await app.close();
process.exit(t.summary() ? 0 : 1);
