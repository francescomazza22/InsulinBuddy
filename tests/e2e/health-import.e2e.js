// Apple Health workouts (2.66.0): deliveries in health_inbox become activity entries, once, without touching Nightscout.
// Uses the real workout from Francesco's first Health Webhook delivery.
import { createBackend, startApp, openDevice, fakeSupabaseSource, makeChecker } from "./harness.js";
import { FOODS_JS, stateBlob, localState, cloudHistoryIds, skipClock, foreground } from "./helpers.js";

const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const be = createBackend();
const app = await startApp(DIR, be, { "foods_data.js": FOODS_JS });

const RIDE_ID = "922E7762-E693-4D41-AF74-395F7EAB9333";
const start = new Date(Date.now() - 3 * 3600_000), end = new Date(start.getTime() + 19.33 * 60_000);
const ride = { id: RIDE_ID, label: "cycling", start_time: start.toISOString(), end_time: end.toISOString(), unit: "sessions", recording_method: "automatically_recorded" };
const calories = [{ start_time: start.toISOString(), end_time: end.toISOString(), unit: "kcal", value: 120, id: "C1" }];
let nextId = 1;
const deliver = (sessions, cals = calories) => be.healthInbox.push({ id: nextId++, user_id: "user-1", received_at: new Date().toISOString(), payload: { data: { exercise_sessions: sessions, active_calories: cals, steps: [{ value: 52 }] }, metadata: {} } });
const noWorkout = () => be.healthInbox.push({ id: nextId++, user_id: "user-1", received_at: new Date().toISOString(), payload: { data: { steps: [{ value: 10 }] } } });

be.row = { user_id: "user-1", data: stateBlob({ settings: { nightscoutUrl: "https://demo.ns.example.com/?token=tok-abcdef-123456" } }), updated_at: be.stamp() };
noWorkout(); deliver([ride]); noWorkout();

t.section("HEALTH IMPORT: a workout delivery becomes one activity");
const dev = await openDevice(app, { width: 390, height: 860, inject: fakeSupabaseSource({ userId: "user-1" }), wait: 2000 });
const hkId = "hk-" + RIDE_ID;
await dev.waitFor(`(JSON.parse(localStorage.getItem("insulinBuddy.v2")) || { history: [] }).history.some(h => h.id === ${JSON.stringify(hkId)})`, 15000, 200);
let st = await localState(dev);
const a = st.history.find(h => h.id === hkId);
t.check("added as a cycling activity", a && a.entryType === "activity" && a.activityType === "cycle", JSON.stringify(a && { type: a.activityType }));
t.check("19 minutes, starting when the ride started", a && a.durationMin === 19 && a.ts === Date.parse(ride.start_time), a && `${a.durationMin} min`);
t.check("intensity estimated from calories (120 kcal in 19 min = moderate)", a && a.intensity === "moderate" && /intensity estimated/.test(a.note), a && a.note);
t.check("no carbs or insulin on it", a && a.totalCarbs === 0 && a.mealDose === 0 && a.correctionDose === 0);
t.check("only the one entry was added", st.history.length === 1, String(st.history.length));
await dev.waitFor(`!document.getElementById("undo-toast").hidden && /Apple Health/.test(document.getElementById("undo-toast").textContent)`, 5000).then(() => t.check("an undo toast says it came from Apple Health", true), () => t.check("an undo toast says it came from Apple Health", false));
await sleep(1500);
t.check("read deliveries are cleared from the inbox", be.healthInbox.length === 0, String(be.healthInbox.length));
t.check("it reached the cloud copy", cloudHistoryIds(be).includes(hkId));
t.check("nothing was sent to Nightscout (Gluroo already has the workout)", be.ns.treatments.length === 0, String(be.ns.treatments.length));

t.section("No duplicates: the same workout delivered again");
deliver([ride]);
await skipClock(dev, 6 * 60_000); await foreground(dev); await sleep(1500);
st = await localState(dev);
t.check("still exactly one entry", st.history.filter(h => h.id === hkId).length === 1 && st.history.length === 1, String(st.history.length));
t.check("and the repeat delivery was cleared", be.healthInbox.length === 0);

t.section("A deleted import never comes back");
await dev.tab("history");
await dev.waitFor(`!!document.querySelector('.history-entry[data-id=${JSON.stringify(hkId)}]')`, 6000).catch(() => {});
t.check("the imported activity shows in the log", await dev.eval(`!!document.querySelector('.history-entry[data-id=${JSON.stringify(hkId)}]')`));
const deleted = await dev.eval(`(() => { const b = document.querySelector('[data-del=${JSON.stringify(hkId)}]'); if (!b) return "no-btn"; b.click(); return true; })()`);
t.check("deleted from the log", deleted === true, String(deleted));
await sleep(400);
// a confirm dialog may appear
await dev.eval(`(() => { const b = [...document.querySelectorAll(".dialog-backdrop button")].find(x => /delete/i.test(x.textContent)); if (b) b.click(); return true; })()`);
await sleep(800);
st = await localState(dev);
t.check("gone, with a deletion marker", !st.history.some(h => h.id === hkId) && st.deleted.history[hkId] != null);
deliver([ride]);
await skipClock(dev, 12 * 60_000); await foreground(dev); await sleep(1500);
st = await localState(dev);
t.check("re-delivered workout is not added again", !st.history.some(h => h.id === hkId), String(st.history.length));
t.check("no JS errors", (await dev.eval("window.__errs.length")) === 0 && dev.errors.length === 0, JSON.stringify(await dev.eval("window.__errs")));
dev.close();

t.section("Not set up: no table, no complaint");
const be2 = createBackend();
const app2 = await startApp(DIR, be2, { "foods_data.js": FOODS_JS });
be2.row = { user_id: "user-1", data: stateBlob({}), updated_at: be2.stamp() };
const dev2 = await openDevice(app2, { width: 390, height: 860, inject: fakeSupabaseSource({ userId: "user-1" }), wait: 2500 });
const st2 = await localState(dev2);
t.check("app starts normally with an empty inbox", st2 && st2.history.length === 0 && (await dev2.eval("window.__errs.length")) === 0);
dev2.close(); await app2.close();

await app.close();
process.exit(t.summary() ? 0 : 1);
