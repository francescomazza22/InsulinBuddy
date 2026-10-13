// An older index.html (missing a button the app wires up) must not stop the app starting.
import fs from "node:fs";
import { startApp, openDevice, makeChecker } from "./harness.js";
import { FOODS_JS } from "./helpers.js";

const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker();
let html = fs.readFileSync(DIR + "index.html", "utf8");
const before = html.length;
html = html.replace(/<button[^>]*id="btn-fill-foods"[\s\S]*?<\/button>/, "").replace(/<button[^>]*id="btn-ns-test"[\s\S]*?<\/button>/, "");
t.check("the test page really lacks those buttons", !html.includes('id="btn-fill-foods"') && !html.includes('id="btn-ns-test"') && html.length < before);
const app = await startApp(DIR, null, { "foods_data.js": FOODS_JS, "index.html": html, "": html });
const dev = await openDevice(app, { width: 420, height: 900, mobile: true, wait: 2500 });
await dev.waitFor(`document.getElementById("loading-screen").hidden === true`, 15000).catch(() => {});
t.check("the loading cover cleared", await dev.eval(`document.getElementById("loading-screen").hidden`));
t.check("the calculator is showing", await dev.eval(`(() => { const v = document.getElementById("view-calculator"); return !!v && !v.hidden; })()`));
const log = await dev.eval(`localStorage.getItem("insulinBuddy.diag") || ""`);
t.check("the skipped handlers were noted in the diagnostics log", /btn-fill-foods/.test(log) && /btn-ns-test/.test(log), log.slice(-300));
await dev.tab("settings");
t.check("other buttons still work (Settings opens)", await dev.eval(`!document.getElementById("view-settings").hidden`));
dev.close(); await app.close();
process.exit(t.summary() ? 0 : 1);
