import test from "node:test";
import assert from "node:assert/strict";
import { createWebPlatform, createMemoryPlatform, assertPlatform } from "../../js/core/platform.js";
import { healthTarget } from "../../js/core/health-target.js";
import { Outbox, assertSyncTarget } from "../../js/core/outbox.js";
import { createStorage, memoryBackend } from "../../js/core/storage.js";

test("web and memory platforms satisfy the port contract", () => {
  assertPlatform(createWebPlatform({ navigator: {}, document: {} }));
  assertPlatform(createMemoryPlatform());
  assert.throws(() => assertPlatform({ kind: "x" }));
  const bad = createMemoryPlatform(); delete bad.health.readGlucose;
  assert.throws(() => assertPlatform(bad), /readGlucose/);
});

test("web platform: notifications and Health are explicitly unsupported, never throw", async () => {
  const p = createWebPlatform({ navigator: {}, document: {} });
  assert.equal(p.health.available(), false);
  assert.deepEqual(await p.health.writeInsulin({}), { ok: false, reason: "unsupported" });
  assert.equal((await p.notifications.schedule({ id: "a" })).scheduled, false);
  assert.equal(await p.notifications.permission(), "unsupported");
  assert.equal(p.capabilities().scheduledNotifications, false);
});

test("web platform: files.save downloads through a temporary link", async () => {
  const log = [];
  const win = {
    navigator: {}, Blob: class { constructor(parts, o) { this.parts = parts; this.type = o.type; } },
    URL: { createObjectURL: b => { log.push(["blob", b.parts[0], b.type]); return "blob:x"; }, revokeObjectURL: u => log.push(["revoke", u]) },
    document: { createElement: () => ({ click() { log.push(["click", this.download, this.href]); } }) }
  };
  assert.equal(await createWebPlatform(win).files.save("a.csv", "x,y", "text/csv"), true);
  assert.deepEqual(log, [["blob", "x,y", "text/csv"], ["click", "a.csv", "blob:x"], ["revoke", "blob:x"]]);
  assert.equal(await createWebPlatform({ navigator: {}, document: {} }).files.save("a", "b"), false);
});

test("web platform: clipboard prefers the API and falls back to the old way", async () => {
  let copied = null;
  assert.equal(await createWebPlatform({ navigator: { clipboard: { writeText: async t => { copied = t; } } }, document: {} }).clipboard.copy("hi"), true);
  assert.equal(copied, "hi");
  const ta = { setAttribute() {}, style: {}, select() {}, remove() { ta.gone = true; } };
  const doc = { createElement: () => ta, body: { appendChild() {} }, execCommand: c => c === "copy" };
  const p = createWebPlatform({ navigator: { clipboard: { writeText: async () => { throw new Error("denied"); } } }, document: doc });
  assert.equal(await p.clipboard.copy("hey"), true);
  assert.equal(ta.value, "hey"); assert.ok(ta.gone);
});

test("memory platform: notifications schedule and cancel", async () => {
  const p = createMemoryPlatform({ notifications: true });
  assert.deepEqual(await p.notifications.schedule({ id: "r1", at: 5, title: "t", body: "b" }), { scheduled: true });
  assert.ok(p.scheduled.has("r1"));
  await p.notifications.cancel("r1");
  assert.equal(p.scheduled.size, 0);
});

test("health target: parts for meals and basal, and the outbox delivers them", async () => {
  const platform = createMemoryPlatform({ health: true });
  const target = healthTarget(platform);
  const meal = { id: "m1", ts: 1000, mealDose: 3, correctionDose: 0.5, totalCarbs: 40 };
  assert.deepEqual(target.partsFor(meal).map(x => x.key), ["bolus", "carbs"]);
  assert.equal(target.partsFor(meal)[0].treatment.units, 3.5);
  assert.deepEqual(target.partsFor({ ...meal, noInsulin: true }).map(x => x.key), ["carbs"]);
  assert.deepEqual(target.partsFor({ id: "b", ts: 1, entryType: "basal", basalDose: 20 }).map(x => x.treatment.kind), ["basal"]);
  assert.deepEqual(target.partsFor({ id: "z", ts: 1, mealDose: 0, correctionDose: 0, totalCarbs: 0 }), []);

  assertSyncTarget(target);
  const patches = [];
  const o = new Outbox({ storage: createStorage(memoryBackend()), target, getConfig: () => ({}), onEntryPatch: (id, p) => patches.push([id, p]), now: () => 1 });
  o.enqueueCreate(meal, {});
  await o.flush();
  assert.equal(platform.samples.size, 2);
  o.enqueueDelete("m1", patches.at(-1)[1].hk && patches.at(-1)[1].hk.ids);
  await o.flush();
  assert.equal(platform.samples.size, 0);
});

test("health target: without Health the failure is permanent (no endless retry)", async () => {
  const target = healthTarget(createMemoryPlatform({ health: false }));
  await assert.rejects(target.create({}, { id: "a", ts: 1, units: 1, kind: "bolus" }), e => target.isPermanent(e));
});
