// Apple Health workouts (2.66.0, 2.66.1): deliveries in health_inbox become activity entries, once, without touching
// Nightscout. A workout and the calories burned during it can arrive in different deliveries, in either order (seen on
// Francesco's phone on 26 Oct 2026: the ride came in as "intensity not known"). Uses the real ride's id and timing.
import { createBackend, startApp, openDevice, fakeSupabaseSource, makeChecker } from "./harness.js";
import { FOODS_JS, stateBlob, localState, cloudHistoryIds, skipClock, foreground } from "./helpers.js";

const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const be = createBackend();
const app = await startApp(DIR, be, { "foods_data.js": FOODS_JS });

const iso = ms => new Date(ms).toISOString();
const workout = (id, label, startMs, minutes) => ({ id, label, start_time: iso(startMs), end_time: iso(startMs + minutes * 60_000), unit: "sessions", recording_method: "automatically_recorded" });
const calSpan = (startMs, minutes, kcal) => [{ start_time: iso(startMs), end_time: iso(startMs + minutes * 60_000), unit: "kcal", value: kcal, id: "C" + startMs }];
let nextId = 1;
const deliver = (data, receivedAt = Date.now()) => be.healthInbox.push({ id: nextId++, user_id: "user-1", received_at: iso(receivedAt), payload: { data, metadata: {} } });
const getEntry = (st, id) => st.history.find(h => h.id === id);

const RIDE_ID = "922E7762-E693-4D41-AF74-395F7EAB9333", hkRide = "hk-" + RIDE_ID;
const rideStart = Date.now() - 3 * 3600_000;
const ride = workout(RIDE_ID, "cycling", rideStart, 19.33);

be.row = { user_id: "user-1", data: stateBlob({ settings: { nightscoutUrl: "https://demo.ns.example.com/?token=tok-abcdef-123456" } }), updated_at: be.stamp() };
deliver({ steps: [{ value: 52 }] });
deliver({ exercise_sessions: [ride], active_calories: calSpan(rideStart, 21, 120), steps: [{ value: 3 }] });
deliver({ steps: [{ value: 10 }] }, Date.now() - 3 * 86400_000);   // an old delivery: tidied away

t.section("HEALTH IMPORT: a workout delivery becomes one activity");
const dev = await openDevice(app, { width: 390, height: 860, inject: fakeSupabaseSource({ userId: "user-1" }), wait: 2000 });
await dev.waitFor(`(JSON.parse(localStorage.getItem("insulinBuddy.v2")) || { history: [] }).history.some(h => h.id === ${JSON.stringify(hkRide)})`, 15000, 200);
let st = await localState(dev);
let a = getEntry(st, hkRide);
t.check("added as a cycling activity", a && a.entryType === "activity" && a.activityType === "cycle");
t.check("19 minutes, starting when the ride started", a && a.durationMin === 19 && a.ts === Date.parse(ride.start_time), a && `${a.durationMin} min`);
t.check("intensity estimated from calories in the same delivery", a && a.intensity === "moderate" && /kcal \(intensity estimated\)/.test(a.note), a && a.note);
t.check("no carbs or insulin on it", a && a.totalCarbs === 0 && a.mealDose === 0 && a.correctionDose === 0);
t.check("only the one entry was added", st.history.length === 1, String(st.history.length));
await dev.waitFor(`!document.getElementById("undo-toast").hidden && /Apple Health/.test(document.getElementById("undo-toast").textContent)`, 5000)
  .then(() => t.check("an undo toast says it came from Apple Health", true), () => t.check("an undo toast says it came from Apple Health", false));
await sleep(1500);
t.check("recent deliveries are kept (their calories may be needed later)", be.healthInbox.length === 2, String(be.healthInbox.length));
t.check("deliveries older than 2 days are tidied away", !be.healthInbox.some(r => r.id === 3));
t.check("it reached the cloud copy", cloudHistoryIds(be).includes(hkRide));
t.check("nothing was sent to Nightscout (Gluroo already has the workout)", be.ns.treatments.length === 0, String(be.ns.treatments.length));

t.section("Calories arriving AFTER the workout fill in the intensity");
const walkStart = Date.now() - 2 * 3600_000, hkWalk = "hk-WALK-1";
deliver({ exercise_sessions: [workout("WALK-1", "walking", walkStart, 40)] });            // no calories in this one
await skipClock(dev, 6 * 60_000); await foreground(dev); await sleep(1500);
st = await localState(dev); a = getEntry(st, hkWalk);
t.check("added straight away, intensity not known yet", a && a.note === "From Apple Health (intensity not known)" && a.intensity === "moderate", a && a.note);
deliver({ active_calories: calSpan(walkStart, 40, 100) });                                 // 2.5 kcal/min: light
await skipClock(dev, 12 * 60_000); await foreground(dev); await sleep(1500);
st = await localState(dev); a = getEntry(st, hkWalk);
t.check("filled in when the calories arrive", a && a.intensity === "light" && /100 kcal \(intensity estimated\)/.test(a.note), a && `${a.intensity} / ${a.note}`);
t.check("still one entry for it", st.history.filter(h => h.id === hkWalk).length === 1);

t.section("Calories arriving BEFORE the workout are used when it is added");
const runStart = Date.now() - 1 * 3600_000, hkRun = "hk-RUN-1";
deliver({ active_calories: calSpan(runStart, 30, 330) }, runStart + 15 * 60_000);         // 11 kcal/min, mid-run
deliver({ exercise_sessions: [workout("RUN-1", "running", runStart, 30)] });
await skipClock(dev, 18 * 60_000); await foreground(dev); await sleep(1500);
st = await localState(dev); a = getEntry(st, hkRun);
t.check("added as hard, using the earlier delivery's calories", a && a.activityType === "run" && a.intensity === "hard" && /330 kcal/.test(a.note), a && `${a.intensity} / ${a.note}`);

t.section("An edited import is left alone");
await dev.eval(`(() => { const s = JSON.parse(localStorage.getItem("insulinBuddy.v2")); return true; })()`);
const swimStart = Date.now() - 30 * 60_000, hkSwim = "hk-SWIM-1";
deliver({ exercise_sessions: [workout("SWIM-1", "swimming", swimStart, 25)] });
await skipClock(dev, 24 * 60_000); await foreground(dev); await sleep(1500);
// Edit it through the activity sheet: change the note.
await dev.tab("history");
await dev.waitFor(`!!document.querySelector('[data-edit=${JSON.stringify(hkSwim)}]')`, 6000).catch(() => {});
await dev.click(`[data-edit=${JSON.stringify(hkSwim)}]`); await sleep(400);
await dev.eval(`(() => { const n = document.querySelector("#activity-note, .activity-sheet textarea, .activity-sheet input[name=note]"); if (!n) return false; n.value = "pool, felt slow"; n.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
await dev.eval(`(() => { const b = document.querySelector("#activity-save"); if (b) b.click(); return !!b; })()`); await sleep(500);
st = await localState(dev); a = getEntry(st, hkSwim);
t.check("edited by hand", a && a.note === "pool, felt slow", a && a.note);
deliver({ active_calories: calSpan(swimStart, 25, 300) });
await skipClock(dev, 30 * 60_000); await foreground(dev); await sleep(1500);
st = await localState(dev); a = getEntry(st, hkSwim);
t.check("late calories don't overwrite what you typed", a && a.note === "pool, felt slow" && a.intensity === "moderate", a && `${a.intensity} / ${a.note}`);

t.section("No duplicates, and a deleted import never comes back");
deliver({ exercise_sessions: [ride], active_calories: calSpan(rideStart, 21, 120) });
await skipClock(dev, 36 * 60_000); await foreground(dev); await sleep(1500);
st = await localState(dev);
t.check("the ride delivered again is not added twice", st.history.filter(h => h.id === hkRide).length === 1);
const deleted = await dev.eval(`(() => { const b = document.querySelector('[data-del=${JSON.stringify(hkRide)}]'); if (!b) return "no-btn"; b.click(); return true; })()`);
await sleep(400);
await dev.eval(`(() => { const b = [...document.querySelectorAll(".dialog-backdrop button")].find(x => /delete/i.test(x.textContent)); if (b) b.click(); return true; })()`);
await sleep(800);
st = await localState(dev);
t.check("deleted from the log, with a deletion marker", deleted === true && !getEntry(st, hkRide) && st.deleted.history[hkRide] != null, String(deleted));
deliver({ exercise_sessions: [ride], active_calories: calSpan(rideStart, 21, 120) });
await skipClock(dev, 42 * 60_000); await foreground(dev); await sleep(1500);
st = await localState(dev);
t.check("re-delivered after the delete: not added again", !getEntry(st, hkRide));
t.check("nothing was sent to Nightscout throughout", be.ns.treatments.length === 0, String(be.ns.treatments.length));
t.check("no JS errors", (await dev.eval("window.__errs.length")) === 0 && dev.errors.length === 0, JSON.stringify(await dev.eval("window.__errs")));
dev.close();

t.section("Not set up: an empty inbox, no complaint");
const be2 = createBackend();
const app2 = await startApp(DIR, be2, { "foods_data.js": FOODS_JS });
be2.row = { user_id: "user-1", data: stateBlob({}), updated_at: be2.stamp() };
const dev2 = await openDevice(app2, { width: 390, height: 860, inject: fakeSupabaseSource({ userId: "user-1" }), wait: 2500 });
const st2 = await localState(dev2);
t.check("app starts normally", st2 && st2.history.length === 0 && (await dev2.eval("window.__errs.length")) === 0);
dev2.close(); await app2.close();

await app.close();
process.exit(t.summary() ? 0 : 1);
