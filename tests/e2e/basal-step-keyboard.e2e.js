// 2.104.1: in the basal sheet, the first tap on − or + while typing the dose took the focus off the number,
// so iOS put the keyboard away and the sheet dropped to the bottom of the screen (his screenshot, iPhone, 15 Nov).
// The step buttons must leave the focus (and the keyboard) where it is; with no keyboard up they must not raise one.
import { startApp, openDevice, makeChecker, seedLocal } from "./harness.js";
import { FOODS_JS, stateBlob } from "./helpers.js";
const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const app = await startApp(DIR, null, { "foods_data.js": FOODS_JS, "manifest.json": "{}" });
const settings = { darkMode: true, darkModeAuto: false, basalBaseline: { am: 18, pm: 18 } };
const dev = await openDevice(app, { width: 390, height: 844, mobile: true, inject: seedLocal(stateBlob({ history: [], settings })), wait: 1500 });
const tap = async sel => {
  const r = await dev.eval(`(() => { const b = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
  await dev.cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: r.x, y: r.y }] });
  await dev.cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sleep(250);
};
const state = () => dev.eval(`({ focused: document.activeElement && document.activeElement.id, value: document.getElementById("basal-units").value })`);
await dev.tab("history"); await dev.click('[data-seg="log"]'); await sleep(250);
await dev.click("#btn-log-basal"); await sleep(600);
await tap("#basal-units");
let s = await state();
t.check("tapping the dose puts the cursor in it", s.focused === "basal-units", JSON.stringify(s));
const start = Number(s.value);
await tap('[data-step="1"]');
s = await state();
t.check("first tap on + adds a unit", Number(s.value) === start + 1, JSON.stringify(s));
t.check("…and keeps the dose focused (keyboard stays up)", s.focused === "basal-units", JSON.stringify(s));
await tap('[data-step="-1"]'); await tap('[data-step="-1"]');
s = await state();
t.check("− twice takes two off, still focused", Number(s.value) === start - 1 && s.focused === "basal-units", JSON.stringify(s));
await dev.eval(`document.getElementById("basal-units").blur()`);
await tap('[data-step="1"]');
s = await state();
t.check("with the keyboard down, + still works and doesn't raise the keyboard", Number(s.value) === start && s.focused !== "basal-units", JSON.stringify(s));
t.check("no JS errors", dev.errors.length === 0 && (await dev.eval("window.__errs.length")) === 0, dev.errors.join("|"));
dev.close(); await app.close();
process.exit(t.summary() ? 0 : 1);
