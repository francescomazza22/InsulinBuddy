// A basal dose's Morning/Evening label follows its time of day, also when an existing dose is edited, and a mismatch is questioned.
import { startApp, openDevice, makeChecker, seedLocal } from "./harness.js";
import { FOODS_JS, stateBlob, localState } from "./helpers.js";

const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const app = await startApp(DIR, null, { "foods_data.js": FOODS_JS, "manifest.json": "{}" });
const y = new Date(); y.setDate(y.getDate() - 1); y.setHours(18, 52, 0, 0);
const pad = n => String(n).padStart(2, "0");
const local = (d, h) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(h)}:52`;
const hist = [{ id: "b1", ts: y.getTime(), entryType: "basal", mealType: "basal", periodName: "evening", basalDose: 8, basalSlot: "pm" }];
const dev = await openDevice(app, { width: 420, height: 900, mobile: true, inject: `if (!localStorage.getItem("insulinBuddy.v2")) { ${seedLocal(stateBlob({ history: hist }))} }`, wait: 1500 });
await dev.tab("history"); await dev.click('[data-seg="log"]'); await sleep(300);
const active = () => dev.eval(`(document.querySelector("#basal-title") && document.querySelector(".basal-sheet [data-slot].is-active") || {dataset:{}}).dataset.slot`);
const setTime = v => dev.eval(`(() => { const e = document.getElementById("basal-time"); e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event("change", { bubbles: true })); })()`);

t.section("EDITING: moving an evening dose to 06:52 makes it a morning dose");
await dev.eval(`document.querySelector('[data-edit="b1"]').click()`); await sleep(500);
t.check("it opens as Evening", (await active()) === "pm", await active());
await setTime(local(y, 6)); await sleep(200);
t.check("changing the time to 06:52 switches it to Morning", (await active()) === "am", await active());
await dev.click("#basal-save"); await sleep(600);
const e1 = (await localState(dev)).history.find(h => h.id === "b1");
t.check("saved as a morning dose at 06:52", e1.basalSlot === "am" && e1.periodName === "morning" && new Date(e1.ts).getHours() === 6, JSON.stringify([e1.basalSlot, e1.periodName]));

t.section("A MISMATCH IS QUESTIONED");
await dev.eval(`document.querySelector('[data-edit="b1"]').click()`); await sleep(500);
await dev.click('[data-slot="pm"]'); await sleep(150);
await dev.click("#basal-save"); await sleep(500);
const asked = await dev.eval(`(document.querySelector(".dialog-backdrop") || {}).textContent || ""`);
t.check("saving 06:52 as Evening asks first", /looks like a morning dose/.test(asked), asked.slice(0, 120));
t.check("nothing was changed yet", (await localState(dev)).history.find(h => h.id === "b1").basalSlot === "am");
t.check("no JS errors", (await dev.eval("window.__errs.length")) === 0 && dev.errors.length === 0, JSON.stringify(await dev.eval("window.__errs")));
dev.close(); await app.close();
process.exit(t.summary() ? 0 : 1);
