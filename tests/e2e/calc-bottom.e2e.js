// 2.77.2: scrolled to the bottom of the Calculator, its last line ("…this isn't medical advice") sat behind the Log Meal bar,
// because the spacer that keeps room for the bar came before it. Phone and iPad, empty and with a meal (the bar grows).
import { startApp, openDevice, makeChecker, seedLocal } from "./harness.js";
import { FOODS_JS, stateBlob } from "./helpers.js";
const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const app = await startApp(DIR, null, { "foods_data.js": FOODS_JS, "manifest.json": "{}" });
for (const [name, w, h] of [["phone", 390, 844], ["small phone", 375, 667], ["iPad", 820, 1180]]) for (const meal of [false, true]) {
  t.section(`${name}, ${meal ? "with a meal" : "empty"}`);
  const dev = await openDevice(app, { width: w, height: h, mobile: true, inject: seedLocal(stateBlob({})), wait: 1500 });
  await dev.tab("calculator");
  if (meal) {
    await dev.eval(`document.getElementById("cc-food-list").children[0].click()`);
    await dev.eval(`(() => { const g = document.getElementById("cc-grams"); g.value = "80"; g.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    await dev.click("#cc-add-btn"); await sleep(200);
  }
  await dev.eval(`window.scrollTo(0, 1e6)`); await sleep(500);
  const r = await dev.eval(`(() => { const d = document.querySelector("#view-calculator .disclaimer").getBoundingClientRect(); const b = document.getElementById("cc-sticky-log-bar").getBoundingClientRect(); return { last: Math.round(d.bottom), bar: Math.round(b.top), fixed: getComputedStyle(document.getElementById("cc-sticky-log-bar")).position }; })()`);
  t.check("the last line clears the Log Meal bar", r.fixed === "static" || r.last <= r.bar, JSON.stringify(r));
  t.check("no JS errors", dev.errors.length === 0 && (await dev.eval("window.__errs.length")) === 0, dev.errors.join("|"));
  dev.close();
}
await app.close();
process.exit(t.summary() ? 0 : 1);
