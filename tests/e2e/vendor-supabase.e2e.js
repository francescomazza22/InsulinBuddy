// The sync library ships with the app (vendor/supabase.js): startup must not depend on a CDN.
import { startApp, openDevice, makeChecker } from "./harness.js";
import { FOODS_JS } from "./helpers.js";
import fs from "fs";

const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker();
const html = fs.readFileSync(DIR + "index.html", "utf8");
t.section("index.html loads the bundled copy");
t.check("no CDN script for supabase", !/cdn\.jsdelivr\.net\/npm\/@supabase/.test(html));
t.check("loads vendor/supabase.js before the app", /<script src="vendor\/supabase\.js" defer>/.test(html));
t.check("the service worker precaches it", /"vendor\/supabase\.js"/.test(fs.readFileSync(DIR + "sw.js", "utf8")));

const app = await startApp(DIR, null, { "foods_data.js": FOODS_JS, "manifest.json": "{}", "vendor/supabase.js": null });
const dev = await openDevice(app, { width: 900, height: 900, mobile: false, wait: 1800 });
t.section("in a real browser, with the CDN unreachable");
t.check("window.supabase.createClient exists", await dev.eval(`typeof (window.supabase && window.supabase.createClient)`) === "function");
t.check("it can build a client", await dev.eval(`(() => { try { const c = window.supabase.createClient("https://x.supabase.co", "k"); return typeof c.from === "function" && typeof c.auth.getSession === "function"; } catch (e) { return String(e); } })()`) === true);
await dev.tab("settings"); await dev.sleep(300);
const acct = await dev.eval(`document.getElementById("account-section").textContent.replace(/\\s+/g, " ")`);
t.check("Settings does not claim sync is unset", !/isn't set up yet/.test(acct) && !/component didn't load/.test(acct), acct.slice(0, 160));
t.check("no JS errors", dev.errors.length === 0, dev.errors.join("|"));
dev.close(); await app.close();
process.exit(t.summary() ? 0 : 1);
