// Editing a time-of-day range's times: the field being edited must survive every change (iPhone's time wheel fires
// change events while it is still open, and rebuilding the list under it closed or broke the picker), and a cleared or
// half-typed time must never be saved (a range with no start or end would silently stop matching).
import { startApp, openDevice, makeChecker, seedLocal } from "./harness.js";
import { FOODS_JS, stateBlob, localState } from "./helpers.js";
const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker(); const sleep = ms => new Promise(r => setTimeout(r, ms));
const app = await startApp(DIR, null, { "foods_data.js": FOODS_JS, "manifest.json": "{}" });
const blob = stateBlob();
blob.settings.timeRatios = [
  { id: "am", name: "Morning", start: "06:00", end: "11:00", ratio: 8, color: "#1F9E93" },
  { id: "rest", name: "Rest of day", start: "11:00", end: "06:00", ratio: 12, color: "#6366F1" }
];
const dev = await openDevice(app, { width: 390, height: 900, mobile: true, inject: `if (!localStorage.getItem("insulinBuddy.v2")) { ${seedLocal(blob)} }`, wait: 1800 });
await dev.cdp.send("Page.bringToFront"); await dev.cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });   // headless Chrome otherwise fires no focus/blur events
await dev.tab("settings"); await sleep(300);
await dev.eval(`document.querySelector('[data-seg="ratios"]') && document.querySelector('[data-seg="ratios"]').click()`); await sleep(200);

t.section("ADD RANGE: the new range opens ready to edit");
await dev.eval(`document.getElementById("add-time-range-btn").click()`); await sleep(250);
let st = await localState(dev);
const added = st.settings.timeRatios[st.settings.timeRatios.length - 1];
t.check("a third range was added", st.settings.timeRatios.length === 3, st.settings.timeRatios.length);
t.check("its edit panel is open straight away", await dev.eval(`!document.getElementById("edit-${added.id}").hidden`));
t.check("the other ranges stay closed", await dev.eval(`document.getElementById("edit-am").hidden && document.getElementById("edit-rest").hidden`));

t.section("TIME FIELD: survives changes while being edited");
await dev.eval(`window.__start = document.querySelector('#edit-${added.id} [data-field="start"]'); window.__start.focus()`);
await dev.eval(`(() => { const i = window.__start; i.value = "13:00"; i.dispatchEvent(new Event("input", { bubbles: true })); i.dispatchEvent(new Event("change", { bubbles: true })); })()`); await sleep(200);
st = await localState(dev);
t.check("the new start time is saved", st.settings.timeRatios.find(x => x.id === added.id).start === "13:00", st.settings.timeRatios.find(x => x.id === added.id).start);
t.check("the field being edited is still the same one on the page (not rebuilt under the picker)", await dev.eval(`window.__start.isConnected`));
t.check("and it still has the focus", await dev.eval(`document.activeElement === window.__start`));
t.check("the row's summary shows the new time", /13:00\s*–\s*14:00/.test(await dev.eval(`document.querySelector('[data-toggle="${added.id}"]').textContent`)));
t.check("the panel is still open", await dev.eval(`!document.getElementById("edit-${added.id}").hidden`));
// Several quick changes in a row, as the wheel spins
for (const v of ["13:15", "13:30", "13:45"]) {
  await dev.eval(`(() => { const i = window.__start; i.value = "${v}"; i.dispatchEvent(new Event("change", { bubbles: true })); })()`); await sleep(60);
}
st = await localState(dev);
t.check("a run of quick changes ends on the last value", st.settings.timeRatios.find(x => x.id === added.id).start === "13:45");
t.check("the field is still connected after the run", await dev.eval(`window.__start.isConnected`));

t.section("TIME FIELD: cleared or invalid times are never saved");
await dev.eval(`(() => { const i = window.__start; i.value = ""; i.dispatchEvent(new Event("input", { bubbles: true })); i.dispatchEvent(new Event("change", { bubbles: true })); })()`); await sleep(200);
st = await localState(dev);
t.check("clearing the start time keeps the last good one", st.settings.timeRatios.find(x => x.id === added.id).start === "13:45", st.settings.timeRatios.find(x => x.id === added.id).start);
await dev.eval(`window.__start.blur()`); await sleep(150);
t.check("leaving the cleared field puts the saved time back in it", await dev.eval(`window.__start.value`) === "13:45", await dev.eval(`window.__start.value`));
await dev.eval(`(() => { const i = document.querySelector('#edit-${added.id} [data-field="end"]'); i.value = "15:30:00"; i.dispatchEvent(new Event("change", { bubbles: true })); })()`); await sleep(200);
st = await localState(dev);
t.check("a time with seconds is stored as HH:MM", st.settings.timeRatios.find(x => x.id === added.id).end === "15:30", st.settings.timeRatios.find(x => x.id === added.id).end);
const tl = await dev.eval(`document.getElementById("timeline-bar").children.length`);
t.check("the timeline still draws", tl > 1, tl);

t.section("OTHER FIELDS: ratio and name edit in place too");
await dev.eval(`window.__ratio = document.querySelector('#edit-${added.id} [data-field="ratio"]'); window.__ratio.focus(); window.__ratio.value = "9"; window.__ratio.dispatchEvent(new Event("change", { bubbles: true }))`); await sleep(200);
st = await localState(dev);
t.check("the ratio is saved", st.settings.timeRatios.find(x => x.id === added.id).ratio === 9);
t.check("the ratio field was not rebuilt", await dev.eval(`window.__ratio.isConnected`));
t.check("the row shows 1u:9g", /1u:9g/.test(await dev.eval(`document.querySelector('[data-toggle="${added.id}"]').textContent`)));
await dev.eval(`window.__ratio.value = ""; window.__ratio.dispatchEvent(new Event("change", { bubbles: true }))`); await sleep(200);
st = await localState(dev);
t.check("a cleared ratio keeps the last good one", st.settings.timeRatios.find(x => x.id === added.id).ratio === 9);
await dev.eval(`window.__name = document.querySelector('#edit-${added.id} [data-field="name"]'); window.__name.value = "Lunch"; window.__name.dispatchEvent(new Event("change", { bubbles: true }))`); await sleep(200);
st = await localState(dev);
t.check("the range can be renamed", st.settings.timeRatios.find(x => x.id === added.id).name === "Lunch");
t.check("the row's name updates", /Lunch/.test(await dev.eval(`document.querySelector('[data-toggle="${added.id}"]').textContent`)));
const errs = await dev.eval(`(window.__errors || []).length`);
t.check("no page errors", !errs, errs);
dev.close(); await app.close(); t.done && t.done(); process.exit(0);
