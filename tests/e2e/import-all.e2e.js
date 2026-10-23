// Importing a full backup keeps sound records and skips (and reports) ones that would break the app.
import { startApp, openDevice, makeChecker, seedLocal } from "./harness.js";
import { FOODS_JS, stateBlob, localState, meal } from "./helpers.js";

const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const app = await startApp(DIR, null, { "foods_data.js": FOODS_JS, "manifest.json": "{}" });
const dev = await openDevice(app, { width: 1100, height: 900, mobile: false, inject: `if (!localStorage.getItem("insulinBuddy.v2")) { ${seedLocal(stateBlob({}))} }`, wait: 1800 });

const good = meal("h-good", Date.now() - 3600000);
const noTime = { ...meal("h-notime", 0), ts: undefined };
const textDose = { ...meal("h-textdose", Date.now() - 7200000), mealDose: "four" };
const backup = { settings: {}, library: [{ id: "x1", name: "Test cake", carbs: 50 }, { name: "No carbs here" }], recipes: [], history: [good, noTime, textDose] };

await dev.tab("settings"); await sleep(200);
await dev.eval(`(async () => { const dt = new DataTransfer(); dt.items.add(new File([${JSON.stringify(JSON.stringify(backup))}], "backup.json")); const i = document.getElementById("import-all-file-input"); i.files = dt.files; i.dispatchEvent(new Event("change", { bubbles: true })); })()`);
// The result is shown in the app's own dialog (never the browser's alert(), which would freeze the page).
await dev.waitFor(`!!document.querySelector(".dialog")`);
const msg = await dev.eval(`document.querySelector(".dialog").textContent`);
await dev.eval(`(() => { const b = document.querySelector(".dialog__btn--primary, .dialog__btn"); if (b) b.click(); })()`);
const st = await localState(dev);
t.check("the sound meal was imported", st.history.some(h => h.id === "h-good"));
t.check("the meal with no time was skipped", !st.history.some(h => h.id === "h-notime"));
t.check("the meal with a text dose was skipped", !st.history.some(h => h.id === "h-textdose"));
t.check("the good food was added, the one without carbs was not", st.library.some(f => f.name === "Test cake") && !st.library.some(f => f.name === "No carbs here"));
t.check("the message says how many were skipped", /3 records could not be read and were skipped/.test(msg), msg);
t.check("no JS errors", dev.errors.length === 0, JSON.stringify(dev.errors));
dev.close(); await app.close();
process.exit(t.summary() ? 0 : 1);
