// The generic Outbox must work for ANY destination, not just Nightscout: here a made-up "health" target stands in.
import test from "node:test";
import assert from "node:assert/strict";
import { Outbox, assertSyncTarget } from "../../js/core/outbox.js";
import { createStorage, memoryBackend } from "../../js/core/storage.js";

function fakeTarget({ failCreateAt = null, offline = false, rejectCreate = false } = {}) {
  const remote = new Map(); let n = 0; const calls = [];
  const t = {
    name: "health", statusKey: "hk", remote, calls, offline, rejectCreate, failCreateAt,
    partsFor: entry => [{ key: "main", treatment: { v: entry.mealDose } }, { key: "carbs", treatment: { c: entry.totalCarbs } }],
    async create(cfg, p) {
      calls.push("create");
      if (t.offline) { const e = new Error("offline"); e.kind = "network"; throw e; }
      if (t.rejectCreate) { const e = new Error("rejected"); e.kind = "http"; e.status = 400; throw e; }
      if (t.failCreateAt != null && calls.filter(c => c === "create").length === t.failCreateAt) { const e = new Error("blip"); e.kind = "network"; throw e; }
      const id = "r" + (++n); remote.set(id, p); return { id };
    },
    async update(cfg, p, id) { calls.push("update"); remote.set(id, p); return { id }; },
    async remove(cfg, id) { calls.push("remove"); remote.delete(id); },
    isPermanent: e => e.kind === "http" && e.status === 400,
    secrets: cfg => [cfg && cfg.token]
  };
  return t;
}
function make(target, patches = []) {
  let clock = 1000;
  const o = new Outbox({ storage: createStorage(memoryBackend()), target, getConfig: () => ({ token: "sekrit" }), onEntryPatch: (id, p) => patches.push([id, p]), now: () => clock });
  o.tick = ms => { clock += ms; };
  return o;
}
const entry = { id: "h1", mealDose: 3, totalCarbs: 30 };

test("a target must have the whole interface", () => {
  assert.throws(() => assertSyncTarget(null), /required/);
  assert.throws(() => assertSyncTarget({ name: "x" }), /statusKey/);
  assert.throws(() => assertSyncTarget({ name: "x", statusKey: "y" }), /partsFor/);
  assert.equal(assertSyncTarget(fakeTarget()).name, "health");
});
test("create delivers every part and records the result under the target's own statusKey", async () => {
  const t = fakeTarget(), patches = [], o = make(t, patches);
  o.enqueueCreate(entry);
  assert.equal(o.count(), 1);
  assert.deepEqual(await o.flush(), { sent: 1, failed: 0, remaining: 0 });
  assert.equal(t.remote.size, 2);
  assert.equal(patches[0][0], "h1");
  assert.equal(patches[0][1].hk.status, "synced");
  assert.deepEqual(Object.keys(patches[0][1].hk.ids).sort(), ["carbs", "main"]);
});
test("offline: the job stays, backs off, and a half-delivered create is not sent twice", async () => {
  const t = fakeTarget({ failCreateAt: 2 }), o = make(t);
  o.enqueueCreate(entry);
  let r = await o.flush();
  assert.equal(r.remaining, 1);
  assert.equal(t.remote.size, 1);                       // the first part got through
  assert.equal(o.flush && (await o.flush()).sent, 0);   // still backing off: nothing is tried
  o.tick(60000);
  r = await o.flush();
  assert.deepEqual(r, { sent: 1, failed: 0, remaining: 0 });
  assert.equal(t.remote.size, 2, "no duplicate of the part that already went");
});
test("a permanent rejection drops the job and marks the entry failed", async () => {
  const t = fakeTarget({ rejectCreate: true }), patches = [], o = make(t, patches);
  o.enqueueCreate(entry);
  const r = await o.flush();
  assert.deepEqual(r, { sent: 0, failed: 1, remaining: 0 });
  assert.equal(patches[0][1].hk.status, "failed");
});
test("update replaces what was sent; delete removes it; editing a pending create just rewrites it", async () => {
  const t = fakeTarget(), o = make(t);
  o.enqueueCreate(entry); await o.flush();
  const synced = { ...entry, hk: { ids: { main: "r1", carbs: "r2" } } };
  o.enqueueUpdate({ ...synced, mealDose: 4 }); await o.flush();
  assert.deepEqual(t.remote.get("r1"), { v: 4 });
  o.enqueueDelete(entry.id, synced.hk.ids); await o.flush();
  assert.equal(t.remote.size, 0);
  const o2 = make(fakeTarget());
  o2.enqueueCreate(entry); o2.enqueueUpdate({ ...entry, mealDose: 9 });
  assert.equal(o2.count(), 1);
  assert.equal(o2.jobs[0].parts[0].treatment.v, 9);
});
test("deleting before anything was sent sends nothing; undo cancels a pending delete", async () => {
  const t = fakeTarget(), o = make(t);
  o.enqueueCreate(entry); o.enqueueDelete(entry.id, null);
  assert.equal(o.count(), 0);
  o.enqueueDelete("h2", { main: "r9" });
  assert.equal(o.cancelDelete("h2"), true);
  assert.equal(o.count(), 0);
});
test("jobs survive a restart (same storage, new Outbox)", async () => {
  const storage = createStorage(memoryBackend()), t = fakeTarget();
  const a = new Outbox({ storage, target: t, getConfig: () => ({}) });
  a.enqueueCreate(entry);
  const b = new Outbox({ storage, target: t, getConfig: () => ({}) });
  assert.equal(b.count(), 1);
  assert.deepEqual(await b.flush(), { sent: 1, failed: 0, remaining: 0 });
});
test("an unconfigured target keeps its jobs and sends nothing", async () => {
  const t = fakeTarget(), o = new Outbox({ storage: createStorage(memoryBackend()), target: t, getConfig: () => null });
  o.enqueueCreate(entry);
  const r = await o.flush();
  assert.equal(r.unconfigured, true);
  assert.equal(t.calls.length, 0);
  assert.equal(o.count(), 1);
});
