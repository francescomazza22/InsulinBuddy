// 2.87.0: a brand-new device signing in must take the account's settings (ratios, target, Nightscout link...), never
// replace them with its factory values. On 6 Nov 2026 a new device did exactly that.
import test from "node:test";
import assert from "node:assert/strict";
import { makeFingerprint, stampChanges, mergeStates, neverSyncedHere, settingsFingerprint } from "../../js/state.js";
import { recordRatioChange } from "../../js/ratio-history.js";

const defaults = () => ({
  settings: { target: 100, maxDose: 15, nightscoutUrl: "", timeRatios: [{ id: "tr-morning", name: "Morning", ratio: 10, start: "05:30", end: "11:00" }], activityRatios: [] },
  settingsUpdatedAt: 0, library: [], recipes: [], history: [], deleted: { history: {}, library: {}, recipes: {} }
});
const DAY = 86400000;
const cloud = (now) => ({
  settings: { target: 165, maxDose: 40, nightscoutUrl: "https://ns.example.com?token=abc", timeRatios: [{ id: "tr-morning", name: "Morning", ratio: 12, start: "05:30", end: "11:00" }], activityRatios: [],
    ratioHistory: [{ ts: now - 2 * DAY, ratios: [{ id: "tr-morning", name: "Morning", ratio: 12, kind: "time" }] }] },
  settingsUpdatedAt: now - 2 * DAY, library: [], recipes: [],
  history: [{ id: "m1", ts: now - DAY, totalCarbs: 40, mealDose: 3, updatedAt: now - DAY }],
  deleted: { history: {}, library: {}, recipes: {} }
});

// What a fresh device does before anyone signs in: its first saves.
function freshDevice(now) {
  const s = defaults();
  let fp = makeFingerprint(s);
  recordRatioChange(s.settings, now - 60000);
  fp = stampChanges(s, fp, now - 60000);
  return s;
}

test("recording the factory ratios on a fresh device does not count as a settings edit", () => {
  const now = Date.UTC(2026, 10, 6, 15, 40);
  const s = freshDevice(now);
  assert.equal(s.settings.ratioHistory.length, 1);
  assert.equal(s.settingsUpdatedAt, 0, "settings were not stamped (before 2.87.0 they were, and beat the cloud)");
  assert.equal(settingsFingerprint({ a: 1, ratioHistory: [1] }), settingsFingerprint({ a: 1 }));
});

test("a real ratio change is still stamped", () => {
  const now = Date.UTC(2026, 10, 6, 15, 40);
  const s = freshDevice(now);
  const fp = makeFingerprint(s);
  s.settings.timeRatios[0].ratio = 11;
  recordRatioChange(s.settings, now);
  stampChanges(s, fp, now);
  assert.equal(s.settingsUpdatedAt, now);
});

test("first sign-in on a new device: the account's settings win even when the device's look newer", () => {
  const now = Date.UTC(2026, 10, 6, 15, 42);
  const local = freshDevice(now);
  local.settingsUpdatedAt = now - 1000;   // e.g. the person tapped dark mode before signing in
  const remote = cloud(now);
  assert.equal(neverSyncedHere(local, remote, { ownerId: null, userId: "u1" }), true);
  const merged = mergeStates(local, remote, defaults, { preferRemoteSettings: true });
  assert.equal(merged.settings.target, 165);
  assert.equal(merged.settings.maxDose, 40);
  assert.equal(merged.settings.nightscoutUrl, "https://ns.example.com?token=abc");
  assert.equal(merged.settings.timeRatios[0].ratio, 12);
  assert.equal(merged.settingsUpdatedAt, remote.settingsUpdatedAt, "keeps the cloud's stamp, so no other device's real edit is outranked");
  assert.deepEqual(merged.settings.ratioHistory.map(h => h.ratios[0].ratio), [12], "the factory baseline is not added to Ratio over time");
  assert.deepEqual(merged.history.map(h => h.id), ["m1"]);
});

test("meals logged on the new device before signing in are still kept", () => {
  const now = Date.UTC(2026, 10, 6, 15, 42);
  const local = freshDevice(now);
  local.history = [{ id: "new1", ts: now - 5000, totalCarbs: 20, mealDose: 2, updatedAt: now - 5000 }];
  const remote = cloud(now);
  assert.equal(neverSyncedHere(local, remote, { userId: "u1" }), true);
  const merged = mergeStates(local, remote, defaults, { preferRemoteSettings: true });
  assert.deepEqual(merged.history.map(h => h.id).sort(), ["m1", "new1"]);
  assert.equal(merged.settings.target, 165);
});

test("a device that has synced with the account keeps the newest-wins rule", () => {
  const now = Date.UTC(2026, 10, 6, 15, 42);
  const remote = cloud(now);
  const local = { ...cloud(now), settings: { ...cloud(now).settings, target: 150 }, settingsUpdatedAt: now - 1000 };
  assert.equal(neverSyncedHere(local, remote, { ownerId: "u1", userId: "u1" }), false, "marked as this account's device");
  assert.equal(neverSyncedHere(local, remote, { ownerId: null, userId: "u1" }), false, "pre-2.87.0 device: already holds the account's meals");
  const merged = mergeStates(local, remote, defaults);
  assert.equal(merged.settings.target, 150, "its newer edit still wins");
});

test("a device that last synced with a different account takes this account's settings", () => {
  const now = Date.UTC(2026, 10, 6, 15, 42);
  const local = { ...freshDevice(now), settingsUpdatedAt: now };
  assert.equal(neverSyncedHere(local, cloud(now), { ownerId: "someone-else", userId: "u1" }), true);
});
