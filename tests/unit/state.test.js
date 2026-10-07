import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeState, makeFingerprint, stampChanges, mergeStates, statesEquivalent, pruneTombstones,
  emptyDeleted, SCHEMA_VERSION, TOMBSTONE_MAX_AGE_MS, prepareRestoredState, unexplainedEmptying
} from "../../js/state.js";

const defaults = () => ({
  settings: { isf: 50, target: 100, units: "mgdl", rounding: "0.5", insulinModel: { preset: "rapid", peakMinutes: 75, diaMinutes: 360 }, carbAbsorptionMinutes: { high: 120, medium: 180, low: 240, unknown: 180 } },
  library: [{ id: "f1", name: "Bread", carbs: 50 }],
  recipes: [], history: []
});
const meal = (id, ts, extra = {}) => ({ id, ts, mealType: "lunch", totalCarbs: 30, mealDose: 3, correctionDose: 0, items: [], ...extra });
const st = (over = {}) => normalizeState({ history: [], library: [], recipes: [], ...over }, defaults);
const ids = arr => arr.map(x => x.id).sort();

// ------------------------------------------------------------ normalize
test("normalizeState upgrades an old blob and keeps new bookkeeping fields", () => {
  const old = { settings: { isf: 40 }, library: [{ id: "x" }], recipes: [], history: [meal("a", 1)] };
  const s = normalizeState(old, defaults);
  assert.equal(s.schemaVersion, SCHEMA_VERSION);
  assert.equal(s.settings.isf, 40);
  assert.equal(s.settings.target, 100);                       // default filled in
  assert.deepEqual(s.deleted, emptyDeleted());
  const withMeta = normalizeState({ ...old, settingsUpdatedAt: 99, deleted: { history: { z: 5 } } }, defaults);
  assert.equal(withMeta.settingsUpdatedAt, 99);
  assert.deepEqual(withMeta.deleted.history, { z: 5 });
});

test("normalizeState deep-merges nested settings and survives garbage", () => {
  const s = normalizeState({ settings: { insulinModel: { peakMinutes: 55 }, carbAbsorptionMinutes: null } }, defaults);
  assert.deepEqual(s.settings.insulinModel, { preset: "rapid", peakMinutes: 55, diaMinutes: 360 });
  assert.deepEqual(s.settings.carbAbsorptionMinutes, { high: 120, medium: 180, low: 240, unknown: 180 });
  for (const junk of [null, undefined, 5, "x", [], { history: "nope", library: 3 }]) {
    const n = normalizeState(junk, defaults);
    assert.ok(Array.isArray(n.history) && Array.isArray(n.library) && Array.isArray(n.recipes));
  }
});

// -------------------------------------------------------------- stamping
test("stampChanges: first call is only a baseline", () => {
  const s = st({ history: [meal("a", 1)] });
  const fp = stampChanges(s, null, 1000);
  assert.equal(s.history[0].updatedAt, undefined);
  assert.ok(fp.history.has("a"));
});

test("stampChanges stamps new + edited items, tombstones removed ones, tracks settings", () => {
  const s = st({ history: [meal("a", 1), meal("b", 2)] });
  let fp = makeFingerprint(s);
  s.history.unshift(meal("c", 3));                 // new
  s.history.find(x => x.id === "a").mealDose = 9;  // edited
  s.history = s.history.filter(x => x.id !== "b"); // removed
  s.settings.isf = 45;                             // settings changed
  fp = stampChanges(s, fp, 5000);
  assert.equal(s.history.find(x => x.id === "c").updatedAt, 5000);
  assert.equal(s.history.find(x => x.id === "a").updatedAt, 5000);
  assert.equal(s.deleted.history.b, 5000);
  assert.equal(s.settingsUpdatedAt, 5000);
  // nothing changed since -> nothing re-stamped
  stampChanges(s, fp, 9000);
  assert.equal(s.history.find(x => x.id === "a").updatedAt, 5000);
  assert.equal(s.settingsUpdatedAt, 5000);
});

test("Undo (re-adding a deleted item) clears the deletion marker and re-stamps", () => {
  const s = st({ history: [meal("a", 1)] });
  let fp = makeFingerprint(s);
  const [removed] = s.history.splice(0, 1);
  fp = stampChanges(s, fp, 2000);
  assert.equal(s.deleted.history.a, 2000);
  s.history.splice(0, 0, removed);
  fp = stampChanges(s, fp, 3000);
  assert.equal(s.deleted.history.a, undefined);
  assert.equal(s.history[0].updatedAt, 3000);
});

test("old deletion markers are pruned", () => {
  const s = st();
  s.deleted.history = { old: 1, fresh: TOMBSTONE_MAX_AGE_MS + 5 };
  pruneTombstones(s, TOMBSTONE_MAX_AGE_MS + 10);
  assert.deepEqual(Object.keys(s.deleted.history), ["fresh"]);
});

// ----------------------------------------------------------------- merge
test("union: items only on one side are kept", () => {
  const m = mergeStates(st({ history: [meal("a", 2)] }), st({ history: [meal("b", 1)] }), defaults);
  assert.deepEqual(ids(m.history), ["a", "b"]);
  assert.deepEqual(m.history.map(x => x.id), ["a", "b"]);   // sorted newest first
});

test("the newer edit wins in either direction", () => {
  const older = meal("a", 1, { mealDose: 1, updatedAt: 100 });
  const newer = meal("a", 1, { mealDose: 9, updatedAt: 200 });
  assert.equal(mergeStates(st({ history: [older] }), st({ history: [newer] }), defaults).history[0].mealDose, 9);
  assert.equal(mergeStates(st({ history: [newer] }), st({ history: [older] }), defaults).history[0].mealDose, 9);
});

test("ties and unstamped legacy data: the cloud copy wins", () => {
  const seed = { id: "f1", name: "Bread", carbs: 50 };            // fresh device seed
  const edited = { id: "f1", name: "Bread", carbs: 47 };          // user's corrected value in the cloud
  const m = mergeStates(st({ library: [seed] }), st({ library: [edited] }), defaults);
  assert.equal(m.library[0].carbs, 47);
});

test("a deletion propagates to a stale copy", () => {
  const stale = st({ history: [meal("a", 1), meal("b", 2)] });
  const cloud = st({ history: [meal("a", 1)] });
  cloud.deleted.history.b = 500;
  assert.deepEqual(ids(mergeStates(stale, cloud, defaults).history), ["a"]);
});

test("an edit made after a deletion beats the deletion; an older edit does not", () => {
  const cloud = st({});
  cloud.deleted.history.a = 300;
  assert.equal(mergeStates(st({ history: [meal("a", 1, { updatedAt: 400 })] }), cloud, defaults).history.length, 1);
  assert.equal(mergeStates(st({ history: [meal("a", 1, { updatedAt: 250 })] }), cloud, defaults).history.length, 0);
});

test("settings: the newer stamp wins, ties go to the cloud", () => {
  const a = st(); a.settings.isf = 30; a.settingsUpdatedAt = 200;
  const b = st(); b.settings.isf = 60; b.settingsUpdatedAt = 100;
  assert.equal(mergeStates(a, b, defaults).settings.isf, 30);
  assert.equal(mergeStates(b, a, defaults).settings.isf, 30);
  const c = st(); c.settings.isf = 11;                       // legacy, unstamped
  const d = st(); d.settings.isf = 22;
  assert.equal(mergeStates(c, d, defaults).settings.isf, 22);
});

test("merge does not mutate its inputs and keeps identity of winning local items", () => {
  const localEntry = meal("a", 5, { updatedAt: 900 });
  const local = st({ history: [localEntry] });
  const remote = st({ history: [meal("a", 5, { updatedAt: 100 }), meal("b", 4)] });
  const before = JSON.stringify(remote);
  const m = mergeStates(local, remote, defaults);
  assert.equal(JSON.stringify(remote), before);
  assert.equal(m.history.find(x => x.id === "a"), localEntry, "same object => open editors stay valid");
});

test("statesEquivalent recognises a no-op merge", () => {
  const a = st({ history: [meal("a", 1, { updatedAt: 5 })] });
  const b = st({ history: [meal("a", 1, { updatedAt: 5 })] });
  assert.equal(statesEquivalent(mergeStates(a, b, defaults), a), true);
  const c = st({ history: [meal("a", 1, { updatedAt: 5 }), meal("z", 0, { updatedAt: 6 })] });
  assert.equal(statesEquivalent(mergeStates(a, c, defaults), a), false);
});

// --------------------------------------------- the real-world scenario
// A minimal model of the cloud save protocol: merge with the cloud copy, then upload.
function makeDevice(name, cloud) {
  const dev = { name, state: st(), fp: null, cloud };
  dev.load = () => { dev.state = mergeStates(dev.state, cloud.data, defaults); dev.fp = makeFingerprint(dev.state); };
  dev.sync = (now) => {
    dev.fp = stampChanges(dev.state, dev.fp, now);
    const merged = mergeStates(dev.state, cloud.data, defaults);
    cloud.data = merged;
    dev.state = merged;
    dev.fp = makeFingerprint(dev.state);
  };
  return dev;
}

test("REGRESSION: a stale second device can no longer wipe out meals logged elsewhere", () => {
  const cloud = { data: null };
  const phone = makeDevice("phone", cloud), desktop = makeDevice("desktop", cloud);
  phone.load(); desktop.load();                                    // both start empty & in sync
  phone.state.history.unshift(meal("m1", 1000)); phone.sync(1001); // phone logs a meal
  // the desktop tab is stale (it never saw m1) and now logs its own meal
  desktop.state.history.unshift(meal("m2", 2000)); desktop.sync(2001);
  assert.deepEqual(ids(cloud.data.history), ["m1", "m2"], "old behaviour would have left only m2");
  phone.sync(3000);
  assert.deepEqual(ids(phone.state.history), ["m1", "m2"], "phone picks up the desktop's meal");
});

test("REGRESSION: deleting on one device sticks even when the other is stale", () => {
  const cloud = { data: null };
  const phone = makeDevice("phone", cloud), desktop = makeDevice("desktop", cloud);
  phone.load(); desktop.load();
  phone.state.history.unshift(meal("m1", 1000)); phone.sync(1001);
  desktop.load();                                                  // desktop now has m1
  phone.state.history = phone.state.history.filter(x => x.id !== "m1"); phone.sync(2000);   // delete on phone
  desktop.sync(2500);                                              // stale desktop syncs afterwards
  assert.deepEqual(ids(cloud.data.history), [], "the deleted meal must not come back");
  assert.deepEqual(ids(desktop.state.history), []);
});

test("both devices edit different meals offline, then sync: both edits survive", () => {
  const cloud = { data: null };
  const a = makeDevice("a", cloud), b = makeDevice("b", cloud);
  a.load(); b.load();
  a.state.history.push(meal("x", 1), meal("y", 2)); a.sync(10);
  b.load();
  a.state.history.find(m => m.id === "x").mealDose = 7;   a.state.history.find(m => m.id === "x"); 
  b.state.history.find(m => m.id === "y").mealDose = 8;
  a.sync(100); b.sync(200);
  a.sync(300);
  const byId = Object.fromEntries(a.state.history.map(m => [m.id, m.mealDose]));
  assert.deepEqual(byId, { x: 7, y: 8 });
});

test("a brand-new device signing in adopts the cloud's edited data, not its own seed", () => {
  const cloud = { data: st({ library: [{ id: "f1", name: "Bread", carbs: 47, updatedAt: 500 }], history: [meal("m1", 1)] }) };
  const fresh = makeDevice("new", cloud);
  fresh.state = normalizeState({}, defaults);                     // default seed library (carbs 50)
  fresh.load();
  assert.equal(fresh.state.library.find(f => f.id === "f1").carbs, 47);
  assert.deepEqual(ids(fresh.state.history), ["m1"]);
});

// ------------------------------------------------------------- restore
test("restoring a snapshot really reverts: a merge with the newer cloud copy can't undo it", () => {
  const snapshot = st({ history: [meal("a", 1, { mealDose: 3 }), meal("b", 2)], library: [{ id: "f1", name: "Bread", carbs: 50 }] });
  // what has happened since: 'a' edited, 'b' deleted, 'c' added, food changed
  const now = st({ history: [meal("a", 1, { mealDose: 9, updatedAt: 500 }), meal("c", 3, { updatedAt: 600 })], library: [{ id: "f1", name: "Bread", carbs: 99, updatedAt: 700 }] });
  now.deleted.history.b = 400;
  const cloud = JSON.parse(JSON.stringify(now));                      // the cloud still has the newer state
  const restored = prepareRestoredState(snapshot, now, defaults, 10_000);
  const merged = mergeStates(restored, cloud, defaults);
  assert.deepEqual(ids(merged.history), ["a", "b"], "c is gone, b is back");
  assert.equal(merged.history.find(x => x.id === "a").mealDose, 3, "the snapshot's version of a wins");
  assert.equal(merged.library.find(f => f.id === "f1").carbs, 50);
});

test("restore does not carry stale deletion markers for items the snapshot has", () => {
  const snapshot = st({ history: [meal("a", 1)] });
  const now = st({ history: [] }); now.deleted.history.a = 300;      // 'a' was deleted after the snapshot
  const r = prepareRestoredState(snapshot, now, defaults, 5000);
  assert.equal(r.deleted.history.a, undefined);
  assert.equal(mergeStates(r, now, defaults).history.length, 1);
});

// ----------------------------------------------------- data-loss guard
test("guard: an emptied history is blocked unless every known cloud meal was deliberately deleted", () => {
  const known = new Set(["a", "b"]);
  const wiped = st({ history: [] });
  assert.deepEqual(unexplainedEmptying(wiped, known), ["a", "b"], "a bug that wiped everything is caught");
  const oneDeleted = st({ history: [] }); oneDeleted.deleted.history.a = 1;
  assert.deepEqual(unexplainedEmptying(oneDeleted, known), ["b"], "still blocked while any meal is unexplained");
  const allDeleted = st({ history: [] }); allDeleted.deleted.history = { a: 1, b: 2 };
  assert.deepEqual(unexplainedEmptying(allDeleted, known), [], "deleting your last meals is legitimate");
  assert.deepEqual(unexplainedEmptying(st({ history: [meal("a", 1)] }), known), [], "non-empty history is never blocked");
  assert.deepEqual(unexplainedEmptying(wiped, null), []); assert.deepEqual(unexplainedEmptying(wiped, new Set()), []);
});
