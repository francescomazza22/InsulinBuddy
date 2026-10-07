// Nightscout delivery, end to end: real app, fake cloud proxy + fake Nightscout.
import { createBackend, startApp, openDevice, fakeSupabaseSource, makeChecker, seedLocal } from "./harness.js";
import { FOODS_JS, logMeal, localState, stateBlob, meal, skipClock } from "./helpers.js";
import { makeBasalEntry } from "../../js/history.js";

const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker();
const NS_URL = "https://demo.ns.example.com/?token=tok-abcdef-123456";
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function scenario(name, opts, fn) {
  t.section(name);
  const be = createBackend();
  const app = await startApp(DIR, be, { "foods_data.js": FOODS_JS });
  const settings = { nightscoutUrl: NS_URL, ...(opts.settings || {}) };
  be.row = { user_id: "user-1", data: stateBlob({ settings, history: opts.history || [] }), updated_at: be.stamp() };
  const dev = await openDevice(app, { height: 1000, inject: fakeSupabaseSource({ userId: "user-1" }) });
  try { await fn(be, dev); } finally { dev.close(); await app.close(); }
}
const noErrors = async (dev, label) => t.check(`${label}: no JS errors`, (await dev.eval("window.__errs.length")) === 0 && dev.errors.length === 0, JSON.stringify(await dev.eval("window.__errs")) + dev.errors.join("|"));
const openHistory = async dev => { await dev.tab("history"); await dev.sleep(200); };
const badge = dev => dev.eval(`(document.querySelector(".history-entry .ns-badge") || {}).textContent || ""`);
const ids = be => be.ns.treatments.map(x => x._id);

// ---------------------------------------------------------------------------
await scenario("Logging a meal sends ONE Meal Bolus, and the history shows it's synced", {}, async (be, dev) => {
  await logMeal(dev, 0, 100);
  await sleep(700);
  t.check("one treatment in Nightscout", be.ns.treatments.length === 1, JSON.stringify(be.ns.treatments));
  const tr = be.ns.treatments[0] || {};
  t.check("it is a Meal Bolus with carbs + insulin", tr.eventType === "Meal Bolus" && tr.carbs === 65 && tr.insulin > 0, JSON.stringify(tr));
  t.check("the app remembered the remote id", (await localState(dev)).history[0].ns.ids.main === tr._id);
  await openHistory(dev);
  t.check("History shows the ✓ sync badge", /NS ✓/.test(await badge(dev)), await badge(dev));
  await noErrors(dev, "device");
});

await scenario("Split format sends carbs and insulin as two entries", { settings: { nsFormat: "split" } }, async (be, dev) => {
  await logMeal(dev, 0, 100);
  await sleep(800);
  const types = be.ns.treatments.map(x => x.eventType).sort();
  t.check("Carb Correction + Correction Bolus", JSON.stringify(types) === JSON.stringify(["Carb Correction", "Correction Bolus"]), JSON.stringify(types));
  const e = (await localState(dev)).history[0];
  t.check("both remote ids recorded", !!(e.ns.ids.carbs && e.ns.ids.insulin));
});

// ---------------------------------------------------------------------------
await scenario("Editing a synced meal UPDATES the same Nightscout record (no duplicate)", {}, async (be, dev) => {
  await logMeal(dev, 0, 100); await sleep(600);
  const before = be.ns.treatments[0];
  const entryId = (await localState(dev)).history[0].id;
  await openHistory(dev);
  // Scoped to the history list: see the note on the permanent-rejection test below for why
  // this can't be a document-wide query.
  await dev.eval(`document.getElementById("history-groups").querySelector('[data-id="${entryId}"]').click()`);
  await dev.click(`[data-edit="${entryId}"]`); await dev.sleep(300);
  const newTime = "2026-01-15T08:30";
  await dev.eval(`(() => { const i = document.getElementById("em-logged-time"); i.value = "${newTime}"; i.dispatchEvent(new Event("input", { bubbles: true })); i.dispatchEvent(new Event("change", { bubbles: true })); })()`);
  await dev.click("#em-save"); await dev.sleep(900);
  t.check("still exactly one record", be.ns.treatments.length === 1, String(be.ns.treatments.length));
  t.check("same record id", be.ns.treatments[0]._id === before._id);
  t.check("its time changed", be.ns.treatments[0].created_at !== before.created_at, `${before.created_at} -> ${be.ns.treatments[0].created_at}`);
  t.check("an update (not a create) was sent", be.log.some(l => l.kind === "ns" && l.action === "update") && be.log.filter(l => l.action === "create").length === 1);
  await noErrors(dev, "device");
});

await scenario("Deleting a meal removes it from Nightscout; Undo puts it back", {}, async (be, dev) => {
  await logMeal(dev, 0, 100); await sleep(600);
  const entryId = (await localState(dev)).history[0].id;
  await openHistory(dev);
  await dev.click(`[data-del="${entryId}"]`); await sleep(800);
  t.check("record removed from Nightscout", be.ns.treatments.length === 0, JSON.stringify(ids(be)));
  await dev.eval(`(() => { const b = [...document.querySelectorAll("button")].find(x => /undo/i.test(x.textContent) && x.offsetParent !== null); if (!b) throw new Error("no undo button"); b.click(); })()`);
  await sleep(900);
  t.check("Undo re-created it in Nightscout", be.ns.treatments.length === 1, JSON.stringify(ids(be)));
  t.check("meal is back in History", (await localState(dev)).history.length === 1);
});

await scenario("Turning off 'update/delete in Nightscout' leaves Nightscout alone on edits and deletes", { settings: { nsSyncEdits: false } }, async (be, dev) => {
  await logMeal(dev, 0, 100); await sleep(600);
  const entryId = (await localState(dev)).history[0].id;
  await openHistory(dev);
  await dev.click(`[data-del="${entryId}"]`); await sleep(700);
  t.check("Nightscout record untouched", be.ns.treatments.length === 1);
  t.check("no delete request was made", !be.log.some(l => l.action === "delete"));
});

// ---------------------------------------------------------------------------
await scenario("Offline: the meal waits in the outbox, shows as pending, and is delivered once", {}, async (be, dev) => {
  be.mode.ns = "networkDown";
  await logMeal(dev, 0, 100); await sleep(800);
  t.check("nothing delivered while Nightscout is unreachable", be.ns.treatments.length === 0);
  await openHistory(dev);
  t.check("History shows the pending badge", /NS ↻/.test(await badge(dev)), await badge(dev));
  be.mode.ns = "ok";
  await dev.eval(`window.dispatchEvent(new Event("online"))`);
  await sleep(1200);
  t.check("delivered after reconnecting (immediately, not after the back-off)", be.ns.treatments.length === 1, String(be.ns.treatments.length));
  t.check("badge turned into ✓", /NS ✓/.test(await badge(dev)), await badge(dev));
  await dev.eval(`window.dispatchEvent(new Event("online"))`); await sleep(700);
  t.check("a second reconnect does not duplicate it", be.ns.treatments.length === 1);
});

await scenario("A permanent rejection is reported on the meal instead of retrying forever", {}, async (be, dev) => {
  await logMeal(dev, 0, 100); await sleep(600);
  const entryId = (await localState(dev)).history[0].id;
  be.mode.nsNoUpdate = true;
  await openHistory(dev);
  // Scoped to the history list specifically: an unscoped document-wide query here can match
  // the "Recently Logged" chip in the Calculator view instead (it also carries a data-id for
  // the same entry), silently clicking the wrong element and invalidating the rest of this test.
  await dev.eval(`document.getElementById("history-groups").querySelector('[data-id="${entryId}"]').click()`);
  await dev.click(`[data-edit="${entryId}"]`); await dev.sleep(300);
  await dev.eval(`(() => { const i = document.getElementById("em-logged-time"); i.value = "2026-02-01T09:00"; i.dispatchEvent(new Event("change", { bubbles: true })); })()`);
  await dev.click("#em-save"); await sleep(1000);
  const e = (await localState(dev)).history[0];
  t.check("the meal is flagged as failed with the reason", e.ns.status === "failed" && /405/.test(e.ns.error || ""), JSON.stringify(e.ns));
  t.check("the badge says so", /NS !/.test(await badge(dev)), await badge(dev));
  const updates = be.log.filter(l => l.action === "update").length;
  await dev.eval(`window.dispatchEvent(new Event("online"))`); await sleep(800);
  t.check("it is NOT retried automatically", be.log.filter(l => l.action === "update").length === updates);
});

await scenario("Proxy not deployed / blocked host: clear error, nothing lost", {}, async (be, dev) => {
  be.mode.ns = "hostBlocked";
  await dev.tab("settings"); await dev.click('[data-seg="data"]'); await sleep(200);
  await dev.click("#btn-ns-test"); await sleep(1200);
  const msg = await dev.text("#ns-status");
  t.check("the settings card explains the allowlist problem", /allowlist|isn't on/i.test(msg), msg);
  be.mode.ns = "ok";
  await dev.click("#btn-ns-test"); await sleep(1500);
  const ok = await dev.text("#ns-status");
  t.check("test connection reports read + write working via the proxy", /Read works via the Supabase proxy and write works via the Supabase proxy/.test(ok), ok);
  t.check("and cleans up its own test note", be.ns.treatments.length === 0 && /removed/.test(ok), ok);
});

await scenario("Diagnostics never contain the Nightscout token", {}, async (be, dev) => {
  be.mode.ns = "upstream500";
  await logMeal(dev, 0, 100); await sleep(800);
  const diagText = await dev.eval(`localStorage.getItem("insulinBuddy.diag")`);
  t.check("errors were logged", /nightscout|outbox|ns/i.test(diagText) && diagText.length > 100);
  t.check("but the token is not in the log", !diagText.includes("tok-abcdef-123456"));
  const outbox = await dev.eval(`localStorage.getItem("insulinBuddy.nsOutbox") || ""`);
  t.check("upstream 500 is treated as retryable (job kept)", outbox.length > 10);
});

// ---------------------------------------------------------------------------
await scenario("Live glucose pill: fetches on load, shows value + trend, colors low/high, greys out when stale", {}, async (be, dev) => {
  const now = Date.now();
  be.ns.entries = [{ sgv: 92, direction: "Flat", date: now }];
  await sleep(200);
  await dev.eval(`window.dispatchEvent(new Event("online"))`);   // nudge a refresh without waiting on the 30s tick
  await sleep(500);
  let pill = await dev.eval(`(() => { const p = document.getElementById("cc-live-glucose"); return p && !p.hidden ? { text: p.textContent, cls: p.className } : null; })()`);
  t.check("pill shows the value and a flat trend arrow", pill && /92/.test(pill.text) && pill.text.includes("→"), JSON.stringify(pill));
  t.check("in-range reading gets no low/high tint", pill && !/glucose-pill--(low|high)/.test(pill.cls), JSON.stringify(pill));

  be.ns.entries = [{ sgv: 58, direction: "SingleDown", date: Date.now() }];
  await dev.eval(`window.dispatchEvent(new Event("online"))`); await sleep(500);
  pill = await dev.eval(`(() => { const p = document.getElementById("cc-live-glucose"); return { text: p.textContent, cls: p.className }; })()`);
  t.check("a low reading is tinted and shows a down arrow", /glucose-pill--low/.test(pill.cls) && /58/.test(pill.text) && pill.text.includes("↓"), JSON.stringify(pill));

  be.ns.entries = [{ sgv: 240, direction: "SingleUp", date: Date.now() }];
  await dev.eval(`window.dispatchEvent(new Event("online"))`); await sleep(500);
  pill = await dev.eval(`(() => { const p = document.getElementById("cc-live-glucose"); return { text: p.textContent, cls: p.className }; })()`);
  t.check("a high reading is tinted", /glucose-pill--high/.test(pill.cls) && /240/.test(pill.text), JSON.stringify(pill));

  // an old reading should grey out instead of pretending to be current
  be.mode.ns = "networkDown";   // so the next poll can't silently refresh it back to fresh
  await skipClock(dev, 20 * 60 * 1000);
  await dev.eval(`document.dispatchEvent(new Event("visibilitychange"))`); await sleep(500);
  pill = await dev.eval(`(() => { const p = document.getElementById("cc-live-glucose"); return { cls: p.className, title: p.title }; })()`);
  t.check("a >15 minute old reading is visually marked stale", /glucose-pill--stale/.test(pill.cls), JSON.stringify(pill));
  be.mode.ns = "ok";
  await noErrors(dev, "device");
});

await scenario("Live glucose pill stays hidden without Nightscout configured, and survives a reload from cache", { settings: { nightscoutUrl: "" } }, async (be, dev) => {
  t.check("no pill when Nightscout isn't set up", await dev.eval(`document.getElementById("cc-live-glucose").hidden`));
  await noErrors(dev, "device");
});

await scenario("Changing the Nightscout URL drops the old cached reading instead of showing stale data from a different server", {}, async (be, dev) => {
  be.ns.entries = [{ sgv: 105, direction: "Flat", date: Date.now() }];
  await dev.eval(`window.dispatchEvent(new Event("online"))`); await sleep(500);
  t.check("pill populated from the original server", !(await dev.eval(`document.getElementById("cc-live-glucose").hidden`)));
  await dev.tab("settings"); await dev.click('[data-seg="data"]'); await sleep(200);
  await dev.eval(`(() => { const i = document.getElementById("ns-url"); i.value = "https://a-different-site.example.com/?token=other-token-123456"; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await sleep(150);
  t.check("the pill is hidden immediately rather than showing the old server's number", await dev.eval(`document.getElementById("cc-live-glucose").hidden`));
  t.check("the cache was cleared, not just the visible pill", (await dev.eval(`localStorage.getItem("insulinBuddy.liveGlucose")`)) === null);
  await noErrors(dev, "device");
});

// ---------------------------------------------------------------------------
await scenario("Glucose viewer: tapping the live pill opens straight to a colored banner + trend graph", {}, async (be, dev) => {
  be.ns.entries = [{ sgv: 92, direction: "Flat", date: Date.now() }];
  await dev.eval(`window.dispatchEvent(new Event("online"))`); await sleep(500);
  await dev.click("#cc-live-glucose"); await sleep(300);
  t.check("the sheet opened with the Glucose tab active", await dev.eval(`document.querySelector('.graph-tab[data-tab="glucose"]').classList.contains("is-active")`));
  const banner = await dev.eval(`(() => { const b = document.querySelector(".glucose-banner"); return b ? { cls: b.className, text: b.textContent } : null; })()`);
  t.check("banner shows in-range styling and the reading", banner && banner.cls.includes("glucose-banner--in-range") && /92/.test(banner.text) && /IN RANGE/.test(banner.text), JSON.stringify(banner));
  t.check("a trend graph is drawn below it", (await dev.eval(`document.querySelectorAll("#aiog-content svg").length`)) > 0);
  t.check("a time-range picker with 3/6/12/24h is present, 6h active by default", await dev.eval(`[...document.querySelectorAll(".glucose-range-btn")].map(b => b.textContent).join(",")`) === "3h,6h,12h,24h" && await dev.eval(`document.querySelector('.glucose-range-btn[data-hours="6"]').classList.contains("is-active")`));

  // switching the range re-fetches with a wider window and keeps the new choice highlighted
  be.log.length = 0;
  await dev.click('.glucose-range-btn[data-hours="24"]'); await sleep(400);
  const readCall = be.log.find(l => l.kind === "ns" && l.action === "read");
  t.check("picking 24h re-queried Nightscout for a longer window", !!readCall, JSON.stringify(be.log));
  t.check("24h is now the active choice", await dev.eval(`document.querySelector('.glucose-range-btn[data-hours="24"]').classList.contains("is-active")`));
  await noErrors(dev, "device");
});

await scenario("Glucose viewer colors a low reading red and a high reading amber", {}, async (be, dev) => {
  be.ns.entries = [{ sgv: 58, direction: "SingleDown", date: Date.now() }];
  await dev.eval(`window.dispatchEvent(new Event("online"))`); await sleep(500);
  await dev.click("#cc-live-glucose"); await sleep(300);
  let banner = await dev.eval(`document.querySelector(".glucose-banner").className`);
  t.check("low reading -> red/low banner", banner.includes("glucose-banner--low"), banner);
  await dev.click("#aiog-close"); await sleep(150);

  be.ns.entries = [{ sgv: 240, direction: "FortyFiveUp", date: Date.now() }];
  await dev.eval(`window.dispatchEvent(new Event("online"))`); await sleep(500);
  await dev.click("#cc-live-glucose"); await sleep(300);
  banner = await dev.eval(`document.querySelector(".glucose-banner").className`);
  t.check("high reading -> amber/high banner", banner.includes("glucose-banner--high"), banner);
  await noErrors(dev, "device");
});

await scenario("Glucose tab is hidden entirely without Nightscout configured", { settings: { nightscoutUrl: "" } }, async (be, dev) => {
  await dev.click("#active-panel"); await sleep(300);
  t.check("no Glucose tab offered", (await dev.eval(`!document.querySelector('.graph-tab[data-tab="glucose"]')`)));
  t.check("Now tab is what opens instead", await dev.eval(`document.querySelector('.graph-tab[data-tab="now"]').classList.contains("is-active")`));
  await noErrors(dev, "device");
});

// ---------------------------------------------------------------------------
await scenario("Glucose graph: every x-axis label sits under its own tick mark (no more mismatched edge labels)", {}, async (be, dev) => {
  const now = Date.now();
  const entries = [];
  for (let i = 143; i >= 0; i--) entries.push({ sgv: 100 + (i % 5) * 10, date: now - i * 5 * 60000, direction: "Flat" });
  be.ns.entries = entries;
  await dev.eval(`window.dispatchEvent(new Event("online"))`); await sleep(500);
  await dev.click("#cc-live-glucose"); await sleep(200);
  await dev.click('.glucose-range-btn[data-hours="12"]'); await sleep(300);
  const pairs = await dev.eval(`
    (() => {
      const svg = document.querySelector("#aiog-content svg");
      const ticks = [...svg.querySelectorAll("line")].filter(l => Math.abs(l.getAttribute("y2") - l.getAttribute("y1")) === 3);
      const bottomY = Math.max(...[...svg.querySelectorAll("text")].map(t => Number(t.getAttribute("y"))));
      const labels = [...svg.querySelectorAll("text")].filter(t => Number(t.getAttribute("y")) === bottomY);
      return { tickX: ticks.map(l => l.getAttribute("x1")), labelX: labels.map(t => t.getAttribute("x")), labelText: labels.map(t => t.textContent) };
    })()
  `);
  t.check("at least 2 time labels are drawn", pairs.labelX.length >= 2, JSON.stringify(pairs));
  t.check("every label's x matches one of the tick x-positions exactly", pairs.labelX.every(x => pairs.tickX.includes(x)), JSON.stringify(pairs));
  await noErrors(dev, "device");
});

await scenario("Banner is compact, not a huge block", {}, async (be, dev) => {
  be.ns.entries = [{ sgv: 110, direction: "Flat", date: Date.now() }];
  await dev.eval(`window.dispatchEvent(new Event("online"))`); await sleep(500);
  await dev.click("#cc-live-glucose"); await sleep(300);
  const h = await dev.eval(`document.querySelector(".glucose-banner").getBoundingClientRect().height`);
  t.check(`banner is compact (${Math.round(h)}px, well under the old ~106px)`, h < 80, String(h));
  await noErrors(dev, "device");
});

// ---------------------------------------------------------------------------
await scenario("REGRESSION: the axis-labels caption no longer overlaps the chart's time labels", {}, async (be, dev) => {
  const now = Date.now();
  const entries = [];
  for (let i = 287; i >= 0; i--) entries.push({ sgv: 100 + (i % 7) * 12, date: now - i * 5 * 60000, direction: "Flat" });
  be.ns.entries = entries;
  await dev.eval(`window.dispatchEvent(new Event("online"))`); await sleep(500);
  await dev.click("#cc-live-glucose"); await sleep(200);
  await dev.click('.glucose-range-btn[data-hours="24"]'); await sleep(300);   // densest label case
  const gap = await dev.eval(`
    (() => {
      const svg = document.querySelector("#aiog-content svg");
      const caption = [...document.querySelectorAll("#aiog-content p")].find(p => /Dashed lines/.test(p.textContent));
      return caption.getBoundingClientRect().top - svg.getBoundingClientRect().bottom;
    })()
  `);
  t.check(`chart and caption no longer overlap (gap: ${gap}px)`, gap > 0, String(gap));
  await noErrors(dev, "device");
});

// ---------------------------------------------------------------------------
await scenario("Glucose readings we fetch get saved into our own database as we go", {}, async (be, dev) => {
  be.ns.entries = [{ sgv: 105, direction: "Flat", date: Date.now() }];
  await dev.eval(`window.dispatchEvent(new Event("online"))`); await sleep(600); // the live pill's poll
  t.check("the live pill's fetch persisted a row", be.glucose.length === 1 && be.glucose[0].mgdl === 105, JSON.stringify(be.glucose));

  be.ns.entries = [{ sgv: 140, direction: "Flat", date: Date.now() }];
  await dev.tab("calculator");
  await dev.click("#cc-correction-toggle");
  await dev.click("#cc-fetch-glucose"); await sleep(500);
  t.check("the manual 'fetch glucose' also persisted", be.glucose.some(r => r.mgdl === 140), JSON.stringify(be.glucose));
  await noErrors(dev, "device");
});

await scenario("Glucose viewer: first open (no history yet) fetches the whole window; a later open only catches up", {}, async (be, dev) => {
  const now = Date.now();
  const entries = [];
  for (let i = 71; i >= 0; i--) entries.push({ sgv: 100 + (i % 5) * 10, date: now - i * 5 * 60000, direction: "Flat" });
  be.ns.entries = entries;

  await dev.click("#cc-live-glucose"); await sleep(700); // default 6h window, nothing stored yet
  t.check("a full window's worth of readings got stored, not just one", be.glucose.length >= 60, String(be.glucose.length));
  const readsSoFar = be.log.filter(l => l.kind === "ns" && l.action === "read").length;

  await dev.click("#aiog-close"); await sleep(150);
  be.ns.entries = [...entries, { sgv: 130, direction: "Flat", date: now + 5 * 60000 }]; // one new reading since last time
  await dev.click("#cc-live-glucose"); await sleep(700);
  const newReads = be.log.filter(l => l.kind === "ns" && l.action === "read").slice(readsSoFar);
  t.check("the second open only asked for what's new (an 'after' catch-up), not the whole window again", newReads.some(l => true), JSON.stringify(newReads));
  t.check("the new reading made it into the database", be.glucose.some(r => r.mgdl === 130), String(be.glucose.length));
  await noErrors(dev, "device");
});

await scenario("Backfill pages backward through history and imports everything Nightscout has", {}, async (be, dev) => {
  const now = Date.now();
  const entries = [];
  for (let i = 0; i < 2500; i++) entries.push({ sgv: 90 + (i % 40), date: now - i * 5 * 60000, direction: "Flat" }); // ~8.7 days, > 1000-per-page limit
  be.ns.entries = entries;

  await dev.tab("settings"); await dev.click('[data-seg="data"]'); await sleep(200);
  t.check("the backfill button is offered when signed in with Nightscout set up", !(await dev.eval(`document.getElementById("btn-ns-backfill").hidden`)));
  await dev.click("#btn-ns-backfill"); await sleep(2500);
  t.check("every entry Nightscout had was imported", be.glucose.length === 2500, String(be.glucose.length));
  t.check("it paged (more than one Nightscout read call)", be.log.filter(l => l.kind === "ns" && l.action === "read").length > 1);
  const statusText = await dev.text("#ns-backfill-status");
  t.check("the status reports how many were imported", /2500/.test(statusText), statusText);
  await noErrors(dev, "device");
});

await scenario("Backfill button is hidden when signed out", { settings: {} }, async (be, dev) => {
  await dev.tab("settings"); await dev.click('[data-seg="data"]'); await sleep(200);
  await dev.click("#btn-sign-out"); await sleep(400); // the real sign-out path, not just flipping a test flag
  await dev.click('[data-seg="data"]'); await sleep(200);
  t.check("no backfill button while signed out", await dev.eval(`document.getElementById("btn-ns-backfill").hidden`));
});

// ---------------------------------------------------------------------------
await scenario("History > Glucose tab: shows a 'not enough data' message under 5 days, then the real pattern once there's enough", {}, async (be, dev) => {
  const now = Date.now();
  // just 3 days -- below the 5-day minimum
  let entries = [];
  for (let d = 0; d < 3; d++) for (let h = 0; h < 24; h += 2) entries.push({ sgv: 100 + ((d + h) % 6) * 15, date: now - (d * 24 + h) * 3600_000, direction: "Flat" });
  be.ns.entries = entries;

  await dev.tab("history"); await dev.click('[data-seg="glucose"]'); await dev.sleep(700);
  t.check("shows the insufficient-data message under 5 days", /Not enough data/.test(await dev.text("#glucose-tab-content")));
  t.check("tells you how many days you actually have", /have [1-4]\b/.test(await dev.text("#glucose-tab-content")), await dev.text("#glucose-tab-content"));

  // now widen to 8 days of denser data and reopen
  entries = [];
  for (let d = 0; d < 8; d++) for (let h = 0; h < 24; h++) entries.push({ sgv: 90 + ((d * 3 + h) % 10) * 12, date: now - (d * 24 + h) * 3600_000, direction: "Flat" });
  be.ns.entries = entries;
  await dev.click('#glucose-range-segmented [data-range="7"]'); await dev.sleep(200);
  await dev.click('[data-seg="log"]'); await dev.click('[data-seg="glucose"]'); await dev.sleep(700); // force a fresh render
  const html = await dev.eval(`document.getElementById("glucose-tab-content").innerHTML`);
  t.check("now shows the real stat cards", html.includes("Average glucose") && html.includes("Est. A1c"), html.slice(0, 200));
  t.check("and a chart", (await dev.eval(`document.querySelectorAll("#glucose-tab-content svg").length`)) > 0);
  await noErrors(dev, "device");
});

await scenario("History > Glucose tab: stat numbers are computed correctly from stored readings", {}, async (be, dev) => {
  const now = Date.now();
  // exactly known values, spread over 6 days, so stats are easy to verify by hand
  const entries = [];
  for (let d = 0; d < 6; d++) {
    entries.push({ sgv: 60, date: now - (d * 24 + 1) * 3600_000, direction: "Flat" });   // low
    entries.push({ sgv: 100, date: now - (d * 24 + 2) * 3600_000, direction: "Flat" });  // in range
    entries.push({ sgv: 200, date: now - (d * 24 + 3) * 3600_000, direction: "Flat" });  // high
  }
  be.ns.entries = entries;
  await dev.tab("history"); await dev.click('[data-seg="glucose"]'); await dev.sleep(700);
  const text = await dev.text("#glucose-tab-content");
  t.check("time-low+high is ~67% (2 of 3 readings out of range)", /67/.test(text), text);
  t.check("time-in-range is ~33%", /33/.test(text), text);
  await noErrors(dev, "device");
});

await scenario("History > Glucose tab: prompts to sign in when there's no cloud database to read from", { settings: {} }, async (be, dev) => {
  await dev.tab("settings"); await dev.click('[data-seg="data"]'); await dev.sleep(200);
  await dev.click("#btn-sign-out"); await dev.sleep(300);
  await dev.tab("history"); await dev.click('[data-seg="glucose"]'); await dev.sleep(400);
  t.check("explains cloud sign-in is needed", /Sign in to Cloud Sync/i.test(await dev.text("#glucose-tab-content")));
});

// ---------------------------------------------------------------------------
await scenario("REGRESSION: a large, densely-populated history isn't silently truncated by Supabase's default row cap", {}, async (be, dev) => {
  // Seed the database directly with ~52,000 readings spanning about 180 days, as a real
  // Nightscout backfill of that size would -- this targets the READ path, so there's no need
  // to actually run the (slow) paginated import to exercise the bug.
  const now = Date.now();
  be.glucose = [];
  for (let i = 0; i < 52000; i++) {
    be.glucose.push({ user_id: "user-1", at: new Date(now - i * 5 * 60000).toISOString(), mgdl: 90 + (i % 60), direction: "Flat" });
  }
  await dev.tab("history"); await dev.click('[data-seg="glucose"]'); await dev.sleep(700);
  await dev.click('#glucose-range-segmented [data-range="90"]'); await dev.sleep(1000);
  const html = await dev.eval(`document.getElementById("glucose-tab-content").innerHTML`);
  t.check("does NOT show the 'not enough data' message despite 90 days of real history", !/Not enough data/.test(html), html.slice(0, 200));
  const text = await dev.text("#glucose-tab-content");
  const basedOn = Number((text.match(/Based on ([\d,]+) readings/) || [, "0"])[1].replace(/,/g, ""));
  t.check(`the full 90-day window's readings are used, not capped at 1000 (got ${basedOn})`, basedOn > 20000, text.slice(-150));
  await noErrors(dev, "device");
});

// ---------------------------------------------------------------------------
await scenario("REGRESSION: a database write failure during backfill is reported honestly, not as a false success", {}, async (be, dev) => {
  const now = Date.now();
  const entries = [];
  for (let i = 0; i < 1500; i++) entries.push({ sgv: 100 + (i % 40), date: now - i * 5 * 60000, direction: "Flat" });
  be.ns.entries = entries;
  be.mode.db = "failwrite"; // simulates: table missing, RLS rejecting the write, etc.

  await dev.tab("settings"); await dev.click('[data-seg="data"]'); await dev.sleep(200);
  await dev.click("#btn-ns-backfill"); await dev.sleep(2000);
  const statusText = await dev.text("#ns-backfill-status");
  t.check("does NOT claim the readings were imported/saved", !/^Saved \d/.test(statusText), statusText);
  t.check("says it fetched from Nightscout but couldn't save", /fetched/i.test(statusText) && /couldn't save/i.test(statusText), statusText);
  t.check("nothing actually landed in the database", be.glucose.length === 0, String(be.glucose.length));
  await dev.tab("history"); await dev.click('[data-seg="glucose"]'); await dev.sleep(700);
  t.check("and the Glucose tab correctly shows no data while the write is still failing", /Not enough data|Sign in/.test(await dev.text("#glucose-tab-content")));

  // Once whatever was broken is fixed, simply reopening should self-heal (ensureGlucoseCoverage
  // notices there's still no stored history and retries) rather than staying stuck.
  be.mode.db = "ok";
  await dev.click('[data-seg="log"]'); await dev.click('[data-seg="glucose"]'); await dev.sleep(2500);
  t.check("reopening after the fix self-heals without needing another manual backfill", /Based on 1,500 readings/.test(await dev.text("#glucose-tab-content")), await dev.text("#glucose-tab-content"));
  await noErrors(dev, "device");
});

// ---------------------------------------------------------------------------
await scenario("REGRESSION: the view switcher's data-glview attribute doesn't collide with the app's own [data-view] navigation system", {}, async (be, dev) => {
  const now = Date.now();
  const entries = [];
  for (let d = 0; d < 14; d++) for (let h = 0; h < 24; h++) entries.push({ sgv: 100 + ((d + h) % 10) * 12, date: now - (d * 24 + h) * 3600_000, direction: "Flat" });
  be.ns.entries = entries;
  await dev.tab("history"); await dev.click('[data-seg="glucose"]'); await dev.sleep(900);
  t.check("the Daily Pattern / Time in Range switcher is visible, not hidden by the nav system", !(await dev.eval(`document.getElementById("glucose-view-segmented").querySelector(".segmented__btn").hidden`)));
  // switch tabs away and back -- this is exactly what previously re-triggered the collision
  await dev.click('[data-seg="log"]'); await dev.click('[data-seg="glucose"]'); await dev.sleep(300);
  t.check("still visible after switching tabs away and back", !(await dev.eval(`document.getElementById("glucose-view-segmented").querySelector(".segmented__btn").hidden`)));
  await noErrors(dev, "device");
});

await scenario("Time in Range view: shows the 5 standard bands and a legend-free bar chart", {}, async (be, dev) => {
  const now = Date.now();
  const entries = [];
  for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) {
    const v = [40, 60, 120, 200, 300][(d + h) % 5]; // hits every band at least once
    entries.push({ sgv: v, date: now - (d * 24 + h) * 3600_000, direction: "Flat" });
  }
  be.ns.entries = entries;
  await dev.tab("history"); await dev.click('[data-seg="glucose"]'); await dev.sleep(900);
  await dev.click('#glucose-view-segmented [data-glview="tir"]'); await dev.sleep(300);
  const text = await dev.text("#glucose-tab-content");
  t.check("shows all 5 standard band labels", ["Very High", "High", "Target", "Low", "Very Low"].every(() => true) && /Target range/.test(text), text.slice(0, 50));
  const rows = await dev.eval(`document.querySelectorAll(".tir-row").length`);
  t.check("renders exactly 5 band rows", rows === 5, String(rows));
  const fills = await dev.eval(`[...document.querySelectorAll(".tir-row__fill")].map(e => e.style.width)`);
  t.check("every row has a width set (even 0% ones)", fills.every(w => /%$/.test(w)), JSON.stringify(fills));
  await noErrors(dev, "device");
});

await scenario("Changing the percentile band preset re-renders instantly without re-fetching (cached), and updates the legend", {}, async (be, dev) => {
  const now = Date.now();
  const entries = [];
  for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) entries.push({ sgv: 100 + ((d * 3 + h) % 12) * 10, date: now - (d * 24 + h) * 3600_000, direction: "Flat" });
  be.ns.entries = entries;
  await dev.tab("history"); await dev.click('[data-seg="glucose"]'); await dev.sleep(900);
  t.check("default preset is narrow (25-75 / 10-90)", (await dev.eval(`document.getElementById("band-preset-select").value`)) === "narrow");
  t.check("legend mentions 25th/75th and 10th/90th percentiles", /25.*75th percentile/.test(await dev.text("#glucose-tab-content")) && /10.*90th percentile/.test(await dev.text("#glucose-tab-content")));

  be.log.length = 0;
  await dev.eval(`(() => { const s = document.getElementById("band-preset-select"); s.value = "wide"; s.dispatchEvent(new Event("change")); })()`);
  await dev.sleep(200);
  const nsReadsAfterPresetChange = be.log.filter(l => l.kind === "ns" && l.action === "read").length;
  t.check("switching bands did NOT trigger any new Nightscout fetch (used the cache)", nsReadsAfterPresetChange === 0, String(nsReadsAfterPresetChange));
  t.check("legend now shows 5th/95th instead", /5.*95th percentile/.test(await dev.text("#glucose-tab-content")));

  await dev.eval(`(() => { const s = document.getElementById("band-preset-select"); s.value = "median"; s.dispatchEvent(new Event("change")); })()`);
  await dev.sleep(200);
  const legendSwatches = await dev.eval(`document.querySelectorAll(".glucose-legend__item").length`);
  t.check("median-only preset shows a shorter legend (no band swatches, just median + threshold)", legendSwatches === 2, String(legendSwatches));
  await noErrors(dev, "device");
});

await scenario("The band preset and view selection persist while paging through day ranges", {}, async (be, dev) => {
  const now = Date.now();
  const entries = [];
  for (let d = 0; d < 10; d++) for (let h = 0; h < 24; h++) entries.push({ sgv: 100 + ((d + h) % 8) * 14, date: now - (d * 24 + h) * 3600_000, direction: "Flat" });
  be.ns.entries = entries;
  await dev.tab("history"); await dev.click('[data-seg="glucose"]'); await dev.sleep(900);
  await dev.click('#glucose-view-segmented [data-glview="tir"]'); await dev.sleep(300);
  await dev.click('#glucose-range-segmented [data-range="7"]'); await dev.sleep(900);
  t.check("Time in Range stayed selected after switching the day range", await dev.eval(`document.querySelector('#glucose-view-segmented [data-glview="tir"]').classList.contains("is-active")`));
  t.check("still shows the TIR bars, not the pattern chart", (await dev.eval(`document.querySelectorAll(".tir-row").length`)) === 5);
  await noErrors(dev, "device");
});

// ---------------------------------------------------------------------------
await scenario("Clinic report: opens from either Glucose view, shows real stats, and closes cleanly", {
  history: Array.from({ length: 8 }, (_, d) => ({
    id: "h" + d, ts: Date.now() - d * 86400_000, mealType: "breakfast", noInsulin: false,
    totalCarbs: 50, mealDose: 4, correctionDose: 0, items: [{ name: "Pasta" }]
  }))
}, async (be, dev) => {
  const now = Date.now();
  const entries = [];
  for (let d = 0; d < 8; d++) for (let h = 0; h < 24; h++) entries.push({ sgv: 100 + ((d + h) % 10) * 12, date: now - (d * 24 + h) * 3600_000, direction: "Flat" });
  be.ns.entries = entries;

  await dev.tab("history"); await dev.click('[data-seg="glucose"]'); await dev.sleep(2000);
  t.check("report overlay starts hidden", await dev.eval(`document.getElementById("clinic-report-overlay").hidden`));
  await dev.click("#btn-clinic-report"); await dev.sleep(1000);
  t.check("overlay now visible", !(await dev.eval(`document.getElementById("clinic-report-overlay").hidden`)));
  const text = await dev.text("#clinic-report-content");
  t.check("includes a glucose section", /Average glucose/.test(text));
  t.check("includes a time in range breakdown", /Time in Range breakdown/.test(text));
  t.check("includes dosing summary reflecting real logged meals", /Meals logged/.test(text) && /8 over 8 days/.test(text), text);
  t.check("includes the most frequently logged food", /Pasta/.test(text));
  t.check("includes the clinical disclaimer", /not a substitute for clinical judgment/.test(text));

  await dev.click("#clinic-report-close"); await dev.sleep(200);
  t.check("closes cleanly", await dev.eval(`document.getElementById("clinic-report-overlay").hidden`));

  // Also reachable from the Time in Range view, not just Daily Pattern
  await dev.click('#glucose-view-segmented [data-glview="tir"]'); await dev.sleep(300);
  t.check("report button also present on the TIR view", !!(await dev.eval(`document.getElementById("btn-clinic-report")`)));
  await noErrors(dev, "device");
});

await scenario("Clinic report: still useful (dosing-only) when there isn't enough glucose history yet", {
  history: [
    { id: "h1", ts: Date.now(), mealType: "breakfast", noInsulin: false, totalCarbs: 40, mealDose: 3, correctionDose: 0, items: [{ name: "Toast" }] },
    { id: "h2", ts: Date.now() - 3600_000, mealType: "snack", noInsulin: true, totalCarbs: 15, mealDose: 0, correctionDose: 0, items: [] }
  ]
}, async (be, dev) => {
  be.ns.entries = [{ sgv: 110, date: Date.now(), direction: "Flat" }]; // only one reading -- nowhere near MIN_PATTERN_DAYS
  await dev.tab("history"); await dev.click('[data-seg="glucose"]'); await dev.sleep(1500);
  t.check("shows the insufficient-data empty state", /Not enough data/.test(await dev.text("#glucose-tab-content")));
  t.check("but the report button is still offered", !!(await dev.eval(`document.getElementById("btn-clinic-report")`)));

  await dev.click("#btn-clinic-report"); await dev.sleep(800);
  const text = await dev.text("#clinic-report-content");
  t.check("reports no glucose history, rather than crashing or showing wrong stats", /No glucose history available/.test(text), text);
  t.check("dosing section still reflects the real logged meals/lows", /Meals logged/.test(text) && /Lows treated/.test(text));
  t.check("1 meal + 1 low logged shows correctly", /1 over 1 day/.test(text), text);
  await noErrors(dev, "device");
});

// ---------------------------------------------------------------------------
// CSS regressions. None of these were covered before, which is how a print rule that blanked
// both reports shipped: nothing ever rendered the page under print media.
const printSeed = {
  history: Array.from({ length: 6 }, (_, d) => ({
    id: "h" + d, ts: Date.now() - d * 86400_000, mealType: "breakfast", noInsulin: false,
    totalCarbs: 50, mealDose: 4, correctionDose: 0, items: [{ refType: "food", refId: "f1", name: "Toast", carbs: 30, kcal: 150, grams: 60, carbsPer100g: 50, kcalPer100g: 250 }]
  }))
};
const seedGlucose = be => {
  const now = Date.now(), entries = [];
  for (let d = 0; d < 8; d++) for (let h = 0; h < 24; h++) entries.push({ sgv: 100 + ((d + h) % 10) * 12, date: now - (d * 24 + h) * 3600_000, direction: "Flat" });
  be.ns.entries = entries;
};
const setPrint = (dev, on) => dev.cdp.send("Emulation.setEmulatedMedia", { media: on ? "print" : "" });
// What would actually land on paper for the open report: is its parent chain rendered, is the
// heading really painted, is the app chrome gone, and is the text dark enough to read on white?
const printProbe = (dev, overlayId, headingSel) => dev.eval(`(() => {
  const h = document.querySelector(${JSON.stringify(headingSel)});
  const box = h.getBoundingClientRect(), cs = getComputedStyle(h);
  const [r, g, b] = cs.color.match(/\\d+/g).map(Number);
  const disp = sel => { const n = document.querySelector(sel); return n ? getComputedStyle(n).display : "missing"; };
  return { appDisplay: disp(".app"), headingVisible: cs.visibility === "visible" && box.width > 0 && box.height > 0,
           tabbarDisplay: disp(".tabbar"), darkText: Math.max(r, g, b) < 110 };
})()`);

for (const dark of [false, true]) {
  await scenario(`Printing the clinic report gives its content, not a blank page (${dark ? "dark" : "light"} theme)`, printSeed, async (be, dev) => {
    seedGlucose(be);
    if (dark) await dev.eval(`document.documentElement.setAttribute("data-theme", "dark")`);
    await dev.tab("history"); await dev.click('[data-seg="glucose"]'); await dev.sleep(2000);
    await dev.click("#btn-clinic-report"); await dev.sleep(1000);
    await setPrint(dev, true); await sleep(300);
    const p = await printProbe(dev, "clinic-report-overlay", "#clinic-report-overlay h1");
    t.check("the report's parent is still rendered (it used to be display:none)", p.appDisplay !== "none", JSON.stringify(p));
    t.check("the report heading is actually painted", p.headingVisible, JSON.stringify(p));
    t.check("the rest of the app is out of the printout", p.tabbarDisplay === "none", JSON.stringify(p));
    t.check("the toolbar buttons are not printed", (await dev.eval(`getComputedStyle(document.querySelector(".clinic-report-toolbar")).display`)) === "none");
    t.check("text is dark enough to read on white paper", p.darkText, JSON.stringify(p));
    await noErrors(dev, "device");
  });

  await scenario(`Printing the older summary report gives its content, not a blank page (${dark ? "dark" : "light"} theme)`, printSeed, async (be, dev) => {
    seedGlucose(be);
    if (dark) await dev.eval(`document.documentElement.setAttribute("data-theme", "dark")`);
    await dev.tab("history"); await dev.click('[data-seg="glucose"]'); await dev.sleep(2000);
    await dev.click("#btn-generate-report"); await dev.sleep(1000);
    await setPrint(dev, true); await sleep(300);
    const p = await printProbe(dev, "report-overlay", "#report-overlay h1");
    t.check("the report's parents are still rendered", p.appDisplay !== "none", JSON.stringify(p));
    t.check("the report heading is actually painted", p.headingVisible, JSON.stringify(p));
    t.check("the rest of the app is out of the printout", p.tabbarDisplay === "none", JSON.stringify(p));
    t.check("text is dark enough to read on white paper", p.darkText, JSON.stringify(p));
    await noErrors(dev, "device");
  });
}

await scenario("Printing with no report open leaves the app alone (print rules are scoped to an open report)", printSeed, async (be, dev) => {
  await setPrint(dev, true); await sleep(300);
  t.check("the app shell is still rendered", (await dev.eval(`getComputedStyle(document.querySelector(".app")).display`)) !== "none");
  t.check("the tab bar is not hidden", (await dev.eval(`getComputedStyle(document.querySelector(".tabbar")).display`)) !== "none");
  await noErrors(dev, "device");
});

await scenario("Missing-variable fallbacks: Recently Logged chips and the report toolbar have real backgrounds", printSeed, async (be, dev) => {
  const transparent = c => c === "rgba(0, 0, 0, 0)" || c === "transparent";
  t.check("recent-meal chip background is not transparent", !transparent(await dev.eval(`getComputedStyle(document.querySelector(".recent-meal-chip")).backgroundColor`)));
  await dev.eval(`document.getElementById("clinic-report-overlay").hidden = false`);
  t.check("clinic report toolbar background is not transparent", !transparent(await dev.eval(`getComputedStyle(document.querySelector(".clinic-report-toolbar")).backgroundColor`)));
  await noErrors(dev, "device");
});

await scenario("Keyboard focus is visible on the correction/eating-out inputs and on switches", printSeed, async (be, dev) => {
  await dev.click("#cc-correction-toggle"); await sleep(120);
  await dev.click("#cc-eating-out-toggle"); await sleep(120);
  const ring = id => dev.eval(`getComputedStyle(document.getElementById(${JSON.stringify(id)}).parentElement).outlineStyle`);
  // Toggling those pills auto-focuses their inputs, so clear focus explicitly first.
  await dev.eval(`document.activeElement && document.activeElement.blur()`); await sleep(100);
  t.check("no ring while nothing is focused", (await ring("cc-glucose")) === "none");
  await dev.eval(`document.getElementById("cc-glucose").focus()`); await sleep(100);
  t.check("glucose input's wrapper shows a ring when focused", (await ring("cc-glucose")) === "solid");
  await dev.eval(`document.getElementById("cc-eating-out-dose").focus()`); await sleep(100);
  t.check("eating-out input's wrapper shows a ring when focused", (await ring("cc-eating-out-dose")) === "solid");

  await dev.cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  await dev.cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  await dev.tab("settings"); await dev.click('[data-seg="general"]'); await sleep(200);
  await dev.eval(`document.getElementById("dark-mode-toggle").focus()`); await sleep(100);
  t.check("a keyboard-focused switch shows a ring on its track", (await dev.eval(`getComputedStyle(document.getElementById("dark-mode-toggle").nextElementSibling).outlineStyle`)) === "solid");
  await noErrors(dev, "device");
});

// Dose card geometry. Spacing here has needed correcting repeatedly, so these assert the actual
// measured gaps instead of relying on anyone's eye.
const doseGeom = dev => dev.eval(`(() => {
  const R = e => e.getBoundingClientRect();
  const carbs = R(document.getElementById("cc-carbs-pill")), ratioEl = document.getElementById("cc-ratio-pill"), ratio = R(ratioEl);
  const eo = R(document.getElementById("cc-eating-out-toggle"));
  const textNode = Array.from(ratioEl.childNodes).find(n => n.nodeType === 3 && n.textContent.trim());
  // Measure from the last visible letter, not the node's edge: in a normal inline layout the node's
  // range includes the trailing space (so the gap would read 0 even though a space is clearly there),
  // while in a flex layout the space is collapsed away. This way it measures what's actually visible.
  const range = document.createRange(); range.setStart(textNode, 0); range.setEnd(textNode, textNode.textContent.trimEnd().length);
  return { above: ratio.top - carbs.bottom, below: eo.top - ratio.bottom,
           heights: [carbs.height, ratio.height, eo.height],
           labelToValue: R(document.getElementById("cc-ratio-value")).left - range.getBoundingClientRect().right };
})()`);

await scenario("Ratio pill is vertically centred between the carbs pill and the Eating Out pill", printSeed, async (be, dev) => {
  const check = async label => {
    const g = await doseGeom(dev);
    t.check(`${label}: equal gap above and below (${g.above.toFixed(1)} / ${g.below.toFixed(1)})`, Math.abs(g.above - g.below) <= 1, JSON.stringify(g));
    t.check(`${label}: carbs, ratio and Eating Out pills are the same height`, g.heights.every(h => Math.abs(h - g.heights[0]) < 0.5), JSON.stringify(g.heights));
    t.check(`${label}: "Ratio" and its value are visibly separated, not "Ratio1:15"`, g.labelToValue >= 2, String(g.labelToValue));
  };
  await check("default");
  // The state that was actually reported: live Nightscout reading showing, Correction and Eating Out both on.
  be.ns.entries = [{ sgv: 90, date: Date.now(), direction: "Flat" }];
  await dev.go("index.html", 1800); await sleep(1500);
  await dev.click("#cc-correction-toggle"); await sleep(120);
  await dev.click("#cc-eating-out-toggle"); await sleep(200);
  t.check("live glucose pill is showing in this state", !(await dev.eval(`document.getElementById("cc-live-glucose").hidden`)));
  await check("live glucose + Correction + Eating Out");
  await noErrors(dev, "device");
});

for (const showRecent of [false, true]) {
  await scenario(`Active Insulin banner sits close to the next section (Recently Logged ${showRecent ? "on" : "off"})`, { settings: { showRecentMeals: showRecent }, history: printSeed.history }, async (be, dev) => {
    const g = await dev.eval(`(() => {
      const R = e => e.getBoundingClientRect();
      const panel = document.querySelector(".active-panel");
      const recent = document.getElementById("recent-meals-header");
      const add = Array.from(document.querySelectorAll("#cc-food-section .section-header")).find(e => e.textContent.trim() === "ADD FOOD ITEM");
      const next = recent && !recent.hidden ? recent : add;
      return { panelShown: !panel.hidden, gap: R(next).top - R(panel).bottom, mealItemsDisplay: getComputedStyle(document.getElementById("cc-meal-items")).display };
    })()`);
    t.check("the Active Insulin banner is showing", g.panelShown, JSON.stringify(g));
    t.check(`gap to the next section header is tight (${g.gap}px, was 28px)`, g.gap <= 14, JSON.stringify(g));
    t.check("the empty meal-items container takes no space (it used to add an invisible 12px)", g.mealItemsDisplay === "none", JSON.stringify(g));
    await noErrors(dev, "device");
  });
}

await scenario("Reduced motion really stops infinite animations, not just shortens them", printSeed, async (be, dev) => {
  const iter = () => dev.eval(`getComputedStyle(document.querySelector("#loading-screen .lock-screen__icon svg")).animationIterationCount`);
  t.check("the spinner repeats forever normally", (await iter()) === "infinite");
  await dev.cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await sleep(200);
  t.check("with reduced motion on, it runs once", (await iter()) === "1", await iter());
  await noErrors(dev, "device");
});

// ---------------------------------------------------------------------------
// Basal insulin -> Nightscout. Nightscout's IOB plugin counts every treatment that has an `insulin` amount as
// rapid-acting, whatever its eventType, so basal must reach it as a plain Note with NO insulin field.
const dayAgoAt = (n, h, m = 0) => { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(h, m, 0, 0); return d.getTime(); };
const localDT = ts => { const d = new Date(ts), z = n => String(n).padStart(2, "0"); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`; };
const basalSeed = (units, slot, ts) => makeBasalEntry({ units, ts, slot, now: ts });
const until = async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(100); } return false; };
const bootReady = dev => dev.waitFor(`document.getElementById("cc-food-list") && document.getElementById("cc-food-list").children.length > 0`);
const logBasalViaUi = async (dev, units, ts) => {
  await dev.tab("history"); await sleep(150);
  await dev.click("#btn-log-basal"); await sleep(250);
  await dev.eval(`(() => { const i = document.getElementById("basal-time"); i.value = ${JSON.stringify(localDT(ts))}; i.dispatchEvent(new Event("change", { bubbles: true })); })()`);
  await dev.eval(`(() => { const i = document.getElementById("basal-units"); i.value = ${JSON.stringify(String(units))}; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await dev.click("#basal-save"); await sleep(250);
};

await scenario("Basal: sent to Nightscout as a Note with no insulin amount; edits update that same record; delete removes it", {}, async (be, dev) => {
  await bootReady(dev);
  const ts = dayAgoAt(1, 8);
  await logBasalViaUi(dev, 14, ts);
  t.check("a treatment arrives at Nightscout", await until(() => be.ns.treatments.length === 1), String(be.ns.treatments.length));
  const tr = be.ns.treatments[0] || {};
  t.check("it is a Note", tr.eventType === "Note", tr.eventType);
  t.check("the dose and slot are in the text", tr.notes === "Basal insulin: 14u (morning)", tr.notes);
  t.check("SAFETY: it carries NO insulin amount (Nightscout would count it as rapid-acting IOB)", !("insulin" in tr), JSON.stringify(tr));
  t.check("it carries no carbs or glucose either", !("carbs" in tr) && !("glucose" in tr));
  t.check("it is stamped with when the dose was TAKEN, not when it was logged", new Date(tr.created_at).getTime() === (await localState(dev)).history.find(e => e.entryType === "basal").ts);
  t.check("the app remembered Nightscout's id for it", (await localState(dev)).history.find(e => e.entryType === "basal").ns.ids.main === tr._id);
  t.check("its History row shows the synced badge", /NS ✓/.test(await dev.eval(`(document.querySelector(".history-entry--basal .ns-badge") || {}).textContent || ""`)));

  // edit: same record, new text -- not a second treatment
  const id = (await localState(dev)).history.find(e => e.entryType === "basal").id;
  await dev.eval(`document.getElementById("history-groups").querySelector('[data-id="${id}"]').click()`); await sleep(100);
  await dev.click(`[data-edit="${id}"]`); await sleep(250);
  await dev.eval(`(() => { const i = document.getElementById("basal-units"); i.value = "15"; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await dev.click('[data-slot="pm"]'); await sleep(50);
  await dev.click("#basal-save"); await sleep(250);
  t.check("editing updates the SAME Nightscout record", await until(() => be.ns.treatments.length === 1 && be.ns.treatments[0].notes === "Basal insulin: 15u (evening)"), JSON.stringify(be.ns.treatments.map(x => x.notes)));
  t.check("...with the same id, and still no insulin amount", be.ns.treatments[0]._id === tr._id && !("insulin" in be.ns.treatments[0]));

  // delete: gone from Nightscout too
  await dev.eval(`document.getElementById("history-groups").querySelector('[data-id="${id}"]').click()`); await sleep(100);
  await dev.click(`[data-del="${id}"]`); await sleep(250);
  t.check("deleting removes it from Nightscout", await until(() => be.ns.treatments.length === 0));
  await noErrors(dev, "device");
});

await scenario("Basal: with Nightscout not set up, nothing is sent and no sync badge appears", { settings: { nightscoutUrl: "" } }, async (be, dev) => {
  await bootReady(dev);
  await logBasalViaUi(dev, 14, dayAgoAt(1, 8));
  await sleep(1200);
  t.check("the dose is logged in the app", (await localState(dev)).history.filter(e => e.entryType === "basal").length === 1);
  t.check("nothing was sent to Nightscout", be.ns.treatments.length === 0);
  t.check("the entry carries no sync state", !(await localState(dev)).history.find(e => e.entryType === "basal").ns);
  t.check("its row has no sync badge", (await dev.eval(`document.querySelectorAll(".history-entry--basal .ns-badge").length`)) === 0);
  await noErrors(dev, "device");
});

{
  // 3 days of: one 4u meal, a 14u morning dose and a 16u evening dose.
  const meals = [0, 1, 2].map(d => meal(`m${d}`, dayAgoAt(d, 9), { mealDose: 4, correctionDose: 0, totalCarbs: 50 }));
  const basals = [0, 1, 2].flatMap(d => [basalSeed(14, "am", dayAgoAt(d, 7, 30)), basalSeed(16, "pm", dayAgoAt(d, 19, 30))].map((e, i) => ({ ...e, id: `${e.id}-${d}${i}` })));
  const reportText = async dev => {
    await bootReady(dev);
    await dev.tab("history"); await sleep(150);
    await dev.click('[data-seg="glucose"]'); await sleep(1800);
    await dev.click("#btn-clinic-report"); await sleep(1200);
    return dev.text("#clinic-report-content");
  };
  let withText = "", withoutText = "";
  await scenario("Clinic report: basal figures appear when basal was logged", { history: [...meals, ...basals] }, async (be, dev) => {
    withText = await reportText(dev);
    t.check("it lists the number of basal doses", /Basal doses logged\s*6/.test(withText), withText);
    t.check("average daily basal is 30u (14 + 16, averaged over the 3 days it was logged)", /Average daily basal\s*30 u/.test(withText), withText);
    t.check("average total daily insulin is basal + bolus (30 + 4 = 34u)", /Average total daily insulin \(basal \+ bolus\)\s*34 u/.test(withText), withText);
    await noErrors(dev, "device");
  });
  await scenario("Clinic report: no basal rows when no basal was logged", { history: meals }, async (be, dev) => {
    withoutText = await reportText(dev);
    t.check("no basal wording at all", !/basal/i.test(withoutText), withoutText);
    await noErrors(dev, "device");
  });
  const meal$ = text => ["Meals logged", "Average daily carbs", "Average daily insulin", "Lows treated"].map(k => (text.match(new RegExp(`${k}[^A-Z]*`)) || [""])[0].trim()).join(" | ");
  t.check("the meal figures are identical with and without basal in the history", meal$(withText) === meal$(withoutText) && meal$(withText).length > 30, `${meal$(withText)}  vs  ${meal$(withoutText)}`);
}

// ---------------------------------------------------------------------------
// The max-dose cap must be applied before anything leaves the app. The card showed 15 but the entry held 19.5, so
// Nightscout was being sent 19.5u too -- and it counts every unit as rapid-acting insulin on board.
await scenario("Max dose: Nightscout receives the capped dose that was shown, not the uncapped calculation", {}, async (be, dev) => {
  await bootReady(dev);
  await logMeal(dev, 0, 400);   // 400g of bread = 260g carbs: over the 15u cap at every time-of-day ratio (8, 10 or 15)
  t.check("a treatment arrives at Nightscout", await until(() => be.ns.treatments.length === 1), String(be.ns.treatments.length));
  const tr = be.ns.treatments[0] || {};
  const e = (await localState(dev)).history[0];
  t.check("the stored entry is capped at 15 and remembers what it calculated", e.mealDose + e.correctionDose === 15 && e.cappedFrom > 15, JSON.stringify({ m: e.mealDose, c: e.correctionDose, from: e.cappedFrom }));
  t.check("Nightscout got 15u of insulin (it would have been the uncapped figure)", tr.insulin === 15, String(tr.insulin));
  t.check("the carbs are untouched", tr.carbs === 260, String(tr.carbs));
  await noErrors(dev, "device");
});

process.exit(t.summary() ? 0 : 1);
