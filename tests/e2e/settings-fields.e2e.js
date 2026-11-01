// Settings text fields match the fields around them (2.77.2): the Nightscout URL box was narrower than the dropdown
// below it and had no inner padding (it only got the bare input style), on every screen size, light and dark.
import { startApp, openDevice, makeChecker } from "./harness.js";
import { FOODS_JS } from "./helpers.js";
const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const app = await startApp(DIR, null, { "foods_data.js": FOODS_JS, "manifest.json": "{}" });
for (const [name, w, h, mobile] of [["phone", 390, 844, true], ["iPad", 820, 1180, true], ["desktop", 1440, 900, false]]) {
  t.section(name);
  const dev = await openDevice(app, { width: w, height: h, mobile, wait: 1500 });
  await dev.tab("settings"); await dev.eval(`document.querySelector('#settings-segmented [data-seg="sync"]').click()`); await sleep(400);
  const m = await dev.eval(`(() => { const f = id => { const e = document.getElementById(id), r = e.getBoundingClientRect(), cs = getComputedStyle(e); return { left: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height), pad: parseFloat(cs.paddingLeft) }; }; return { url: f("ns-url"), fmt: f("ns-format") }; })()`);
  t.check("the URL box is as wide as the dropdown under it", m.url.w === m.fmt.w && m.url.left === m.fmt.left, JSON.stringify(m));
  t.check("and has the same inner padding and height", m.url.pad === m.fmt.pad && m.url.h === m.fmt.h, JSON.stringify(m));
  t.check("no JS errors", (await dev.eval("window.__errs.length")) === 0 && dev.errors.length === 0);
  dev.close();
}
await app.close();
process.exit(t.summary() ? 0 : 1);
