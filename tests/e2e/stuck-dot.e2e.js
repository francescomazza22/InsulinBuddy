// A red dot on the Settings tab when sending is stuck, and a readable event log in Settings.
import { createBackend, startApp, openDevice, fakeSupabaseSource, makeChecker } from "./harness.js";
import { FOODS_JS, stateBlob, logMeal } from "./helpers.js";

const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const be = createBackend();
const app = await startApp(DIR, be, { "foods_data.js": FOODS_JS, "manifest.json": "{}" });
be.row = { user_id: "user-1", data: stateBlob({ settings: { nightscoutUrl: "https://demo.ns.example.com/?token=tok-abcdef-123456" } }), updated_at: be.stamp() };
const dev = await openDevice(app, { width: 420, height: 900, mobile: true, inject: fakeSupabaseSource({ userId: "user-1" }), wait: 2500 });
const dot = () => dev.eval(`(() => { const d = document.querySelector('.tab[data-target="settings"] .tab__dot'); return !!d && !d.hidden && d.getBoundingClientRect().width > 0; })()`);

t.section("HEALTHY: no dot");
await sleep(800);
t.check("no dot when everything is sent", !(await dot()));

t.section("STUCK: Nightscout down with a queued entry -> dot appears");
be.mode.ns = "networkDown";
await logMeal(dev, 0, 100); await sleep(1500);
t.check("the Settings tab shows a red dot", await dot());
t.check("its label says sync needs attention", /needs attention/.test(await dev.eval(`document.querySelector('.tab[data-target="settings"]').getAttribute("aria-label")`)));
await dev.shot("/tmp/shots/stuck-dot.png");

t.section("EVENT LOG: readable, and says why");
await dev.tab("settings"); await sleep(250);
t.check("Diagnostics says sync needs attention", /Sync needs attention/.test(await dev.text("#diag-summary")), await dev.text("#diag-summary"));
await dev.click("#btn-diag-view"); await sleep(400);
const sheet = await dev.eval(`(() => { const rows = [...document.querySelectorAll(".log-row")]; return { n: rows.length, text: document.querySelector(".sheet").innerText, hasProblem: rows.some(r => /log-row--(error|warn)/.test(r.className)) }; })()`);
t.check("the log lists events with friendly names", sheet.n > 0 && /Nightscout/.test(sheet.text), sheet.text.slice(0, 200));
t.check("a problem row is marked", sheet.hasProblem);
await dev.eval(`(() => { const c = document.getElementById("lg-errors"); c.checked = true; c.dispatchEvent(new Event("change", { bubbles: true })); })()`); await sleep(200);
t.check("Problems only keeps only warnings and errors", await dev.eval(`[...document.querySelectorAll(".log-row")].every(r => /log-row--(error|warn)/.test(r.className))`));
await dev.click("#lg-close"); await sleep(300);
t.check("closing returns to Settings", await dev.eval(`!document.querySelector(".sheet-backdrop")`));

t.section("RECOVERY: dot goes away");
be.mode.ns = "ok";
await dev.click("#sync-chip"); await sleep(400);
await dev.click("#sync-retry"); await sleep(2500);
await dev.click("#sync-close"); await sleep(300);
t.check("no dot once everything is sent", !(await dot()));
t.check("no JS errors", dev.errors.length === 0, dev.errors.join("|"));
dev.close(); await app.close();
process.exit(t.summary() ? 0 : 1);
