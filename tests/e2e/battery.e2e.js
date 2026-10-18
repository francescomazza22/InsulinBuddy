// Battery: nothing polls while the app is hidden, glucose isn't re-fetched more than once a minute, and no animation runs forever.
import { createBackend, startApp, openDevice, fakeSupabaseSource, makeChecker } from "./harness.js";
import { FOODS_JS, stateBlob } from "./helpers.js";

const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const NS_URL = "https://demo.ns.example.com/?token=tok-abcdef-123456";

const be = createBackend();
const app = await startApp(DIR, be, { "foods_data.js": FOODS_JS });
be.ns.entries = [{ date: Date.now() - 60000, sgv: 110, direction: "Flat", type: "sgv" }];   // a sensor with a reading, so the one-minute rule has something to apply to
be.row = { user_id: "user-1", data: stateBlob({ settings: { nightscoutUrl: NS_URL } }), updated_at: be.stamp() };
// Remember every timer the app starts, so the test can fire the 30-second one by hand instead of waiting 30 real seconds.
const spy = `window.__timers = []; const __si = window.setInterval.bind(window); window.setInterval = (f, ms, ...a) => { window.__timers.push({ f, ms }); return __si(f, ms, ...a); };`;
const dev = await openDevice(app, { height: 1000, inject: spy + fakeSupabaseSource({ userId: "user-1" }) });
await dev.waitFor(`document.getElementById("cc-food-list").children.length > 0`);
await sleep(1500);
const reads = () => be.log.filter(l => l.kind === "ns" && l.action === "read").length;
const hidden = on => dev.eval(`Object.defineProperty(document, "hidden", { configurable: true, get: () => ${on} })`);
const fire = () => dev.eval(`window.__timers.filter(x => x.ms === 30000).forEach(x => x.f())`);

t.section("hidden: the 30-second tick does nothing");
t.check("the app registered its 30-second tick", (await dev.eval(`window.__timers.filter(x => x.ms === 30000).length`)) >= 1);
await dev.eval(`(() => { const real = Date.now.bind(Date); Date.now = () => real() + 120000; })()`);
await hidden(true);
const before = reads();   // the clock jumps two minutes first, so any reading is now older than the one-minute limit
await fire(); await sleep(800);
t.check("no Nightscout request while hidden", reads() === before, `${before} -> ${reads()}`);

t.section("visible again: it carries on");
await hidden(false);
await fire(); await sleep(1000);
t.check("a request goes out once it is visible and the reading is old", reads() > before, `${before} -> ${reads()}`);

t.section("but not more than about once a minute");
const afterVisible = reads();
await fire(); await sleep(500); await fire(); await sleep(500);
t.check("two more ticks straight away fetch nothing new", reads() === afterVisible, `${afterVisible} -> ${reads()}`);
await dev.eval(`(() => { const real = Date.now; Date.now = () => real() + 30000; })()`);   // half a minute later: the next regular tick
await fire(); await sleep(500);
t.check("nor does the next 30-second tick: the reading is under a minute old", reads() === afterVisible, `${afterVisible} -> ${reads()}`);

t.section("no animation runs forever");
const infinite = await dev.eval(`(() => { const out = []; for (const sh of document.styleSheets) { let rules; try { rules = sh.cssRules; } catch (e) { continue; } for (const r of rules) { const walk = rr => { if (rr.cssRules && rr.type !== 1) for (const c of rr.cssRules) walk(c); if (rr.style && /infinite/.test(rr.style.animation || rr.style.animationIterationCount || "")) out.push(rr.selectorText); }; walk(r); } } return out; })()`);
t.check("nothing repeats forever (the opening screen plays its animations a few times and stops)", infinite.length === 0, JSON.stringify(infinite));

t.check("no JS errors", (await dev.eval("window.__errs.length")) === 0 && dev.errors.length === 0, JSON.stringify(await dev.eval("window.__errs")));
dev.close(); await app.close();
process.exit(t.summary() ? 0 : 1);
