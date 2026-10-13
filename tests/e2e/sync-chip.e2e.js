// The sync indicator: reflects what is really happening and lets you retry.
import { createBackend, startApp, openDevice, fakeSupabaseSource, makeChecker } from "./harness.js";
import { FOODS_JS, stateBlob, logMeal } from "./helpers.js";

const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const be = createBackend();
const app = await startApp(DIR, be, { "foods_data.js": FOODS_JS, "manifest.json": "{}" });
be.row = { user_id: "user-1", data: stateBlob({ settings: { nightscoutUrl: "https://demo.ns.example.com/?token=tok-abcdef-123456" } }), updated_at: be.stamp() };
const dev = await openDevice(app, { width: 420, height: 900, mobile: true, inject: fakeSupabaseSource({ userId: "user-1" }), wait: 2500 });
const chip = async () => { await dev.tab("settings"); await sleep(150); return chipNow(); };
const chipNow = () => dev.eval(`(() => { const c = document.getElementById("sync-chip"); return { hidden: c.hidden, cls: c.className, text: document.getElementById("sync-chip-text").textContent }; })()`);

t.section("SYNC CHIP: healthy");
await sleep(800);
let c = await chip();
t.check("visible in Settings and says Synced when everything is up to date", !c.hidden && /sync-chip--ok/.test(c.cls) && c.text === "Synced", JSON.stringify(c));

t.section("SYNC CHIP: Nightscout down -> the entry is queued and the chip says so");
be.mode.ns = "networkDown";
await logMeal(dev, 0, 100); await sleep(1200);
c = await chip();
t.check("chip shows a problem (queued with an error)", /sync-chip--(problem|pending)/.test(c.cls) && /Check sync|Sending/.test(c.text), JSON.stringify(c));
await dev.tab("settings"); await sleep(200); await dev.click("#sync-chip"); await sleep(400);
const body = await dev.text("#sync-sheet-body");
t.check("the sheet names Nightscout and says an entry is not sent", /Nightscout/.test(body) && /1 entry (is not sent|is on the way)/.test(body), body);
t.check("the sheet offers Try again now", /Try again now/.test(body));
await dev.shot("/tmp/shots/sync-sheet.png");

t.section("SYNC CHIP: recovery");
be.mode.ns = "ok";
await dev.click("#sync-retry"); await sleep(2500);
c = await chip();
t.check("after Try again now the chip goes back to Synced", c.text === "Synced" && /sync-chip--ok/.test(c.cls), JSON.stringify(c));
t.check("and the sheet updated in place", /Everything sent/.test(await dev.text("#sync-sheet-body")), await dev.text("#sync-sheet-body"));
await dev.click("#sync-close"); await sleep(300);

t.section("SYNC CHIP: offline");
await dev.eval(`Object.defineProperty(navigator, "onLine", { get: () => false, configurable: true }); window.dispatchEvent(new Event("offline"))`);
be.mode.ns = "networkDown";
await logMeal(dev, 0, 100); await sleep(800);
c = await chip();
t.check("offline with something waiting says Offline", /^Offline/.test(c.text), JSON.stringify(c));
t.check("no JS errors", (await dev.eval("window.__errs.length")) === 0 && dev.errors.length === 0, JSON.stringify(await dev.eval("window.__errs")));
dev.close(); await app.close();
process.exit(t.summary() ? 0 : 1);
