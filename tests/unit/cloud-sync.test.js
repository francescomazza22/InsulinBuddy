import test from "node:test";
import assert from "node:assert/strict";
import { createCloudSync, supabaseCloudTarget } from "../../js/core/cloud-sync.js";

const meal = id => ({ id, ts: 1 });
function setup({ history = [], remote = null, pushFails = false, headFails = false } = {}) {
  const state = { history: [...history], deleted: { history: {}, library: {}, recipes: {} } };
  const calls = []; const events = [];
  const cloudCopy = { v: remote };   // { state, updatedAt }
  const target = {
    async head() { calls.push("head"); if (headFails) throw new Error("offline"); return cloudCopy.v ? { updatedAt: cloudCopy.v.updatedAt } : null; },
    async fetch() { calls.push("fetch"); return cloudCopy.v ? { ok: true, state: cloudCopy.v.state, updatedAt: cloudCopy.v.updatedAt } : { ok: true, state: null }; },
    async push(s) { calls.push("push"); if (pushFails) throw new Error("offline"); cloudCopy.v = { state: JSON.parse(JSON.stringify(s)), updatedAt: "t" + calls.length }; return cloudCopy.v.updatedAt; }
  };
  const merged = [];
  const engine = createCloudSync({
    target, getState: () => state, delayMs: 0,
    mergeRemote: (remote, reason) => { merged.push(reason); for (const m of remote.history) if (!state.history.some(h => h.id === m.id)) state.history.push(m); return true; },
    onPending: () => events.push("pending"), onSynced: () => events.push("synced"), onBlocked: () => events.push("blocked"), log: (l, m) => events.push(l + ":" + m)
  });
  return { state, calls, events, engine, cloudCopy, merged };
}

test("guard: an emptied history is NOT uploaded when the cloud had meals and none were deleted on purpose", async () => {
  const x = setup({ history: [] });
  x.engine.baseline({ updatedAt: "t0", history: [meal("a"), meal("b")] });
  await x.engine.save();
  assert.ok(!x.calls.includes("push"), "nothing may be pushed");
  assert.deepEqual(x.engine.blocked, { fromCount: 2, toCount: 0 });
  assert.ok(x.events.includes("blocked") && x.events.includes("pending"));
});
test("guard: allowed when every meal was deliberately deleted (each leaves a marker)", async () => {
  const x = setup({ history: [] });
  x.state.deleted.history = { a: 5, b: 6 };
  x.engine.baseline({ updatedAt: "t0", history: [meal("a"), meal("b")] });
  await x.engine.save();
  assert.ok(x.calls.includes("push"));
  assert.equal(x.engine.blocked, null);
});
test("guard: force bypasses it once, and unblock clears the flag", async () => {
  const x = setup({ history: [] });
  x.engine.baseline({ history: [meal("a")] });
  await x.engine.save();
  assert.ok(x.engine.blocked);
  x.engine.unblock();
  assert.equal(x.engine.blocked, null);
  await x.engine.save(true);
  assert.ok(x.calls.includes("push"));
});
test("no baseline, or an empty cloud, never blocks (a brand-new account can upload)", async () => {
  const x = setup({ history: [] });
  await x.engine.save();
  assert.ok(x.calls.includes("push"));
});
test("save pulls and merges BEFORE it uploads, and uploads the merged result", async () => {
  const x = setup({ history: [meal("local")], remote: { state: { history: [meal("other-device")] }, updatedAt: "t9" } });
  await x.engine.save();
  assert.deepEqual(x.merged, ["before save"]);
  assert.ok(x.calls.indexOf("fetch") < x.calls.indexOf("push"));
  assert.deepEqual(x.cloudCopy.v.state.history.map(h => h.id).sort(), ["local", "other-device"]);
});
test("a failed upload is reported as pending, never as synced", async () => {
  const x = setup({ history: [meal("a")], pushFails: true });
  await x.engine.save();
  assert.ok(x.events.includes("pending"));
  assert.ok(!x.events.includes("synced"));
  assert.ok(x.events.some(e => /^warn:Cloud save failed/.test(e)));
});
test("a pull that can't reach the cloud also ends as pending, and nothing is pushed", async () => {
  const x = setup({ history: [meal("a")], headFails: true });
  await x.engine.save();
  assert.ok(!x.calls.includes("push"));
  assert.ok(x.events.includes("pending"));
});
test("success records what the cloud now holds, so the guard works next time", async () => {
  const x = setup({ history: [meal("a"), meal("b")] });
  await x.engine.save();
  assert.deepEqual([...x.engine.knownHistoryIds].sort(), ["a", "b"]);
  assert.ok(x.engine.lastUpdatedAt);
  assert.ok(x.events.includes("synced"));
  x.state.history.length = 0;
  await x.engine.save();
  assert.ok(x.engine.blocked, "a collapse after a good sync is caught");
});
test("pull: skips the download when the cloud copy hasn't changed, downloads and merges when it has", async () => {
  const x = setup({ history: [meal("a")], remote: { state: { history: [meal("z")] }, updatedAt: "t1" } });
  x.engine.baseline({ updatedAt: "t1", history: [] });
  assert.equal(await x.engine.pull("periodic"), false);
  assert.ok(!x.calls.includes("fetch"));
  x.cloudCopy.v.updatedAt = "t2";
  assert.equal(await x.engine.pull("periodic"), true);
  assert.equal(x.engine.lastUpdatedAt, "t2");
  assert.ok(x.engine.lastPullAt > 0);
});
test("pull: no cloud row yet is not an error", async () => {
  const x = setup({ history: [] });
  assert.equal(await x.engine.pull("x"), false);
});
test("rapid saves are coalesced into one upload", async () => {
  const x = setup({ history: [meal("a")] });
  const e = createCloudSync({ target: { head: async () => null, fetch: async () => ({ ok: true, state: null }), push: async () => { x.calls.push("push"); return "t"; } }, getState: () => x.state, mergeRemote: () => false, delayMs: 20 });
  await Promise.all([e.save(), e.save(), e.save()]);
  assert.equal(x.calls.filter(c => c === "push").length, 1);
});
test("reset forgets everything", () => {
  const x = setup();
  x.engine.baseline({ updatedAt: "t", history: [meal("a")] });
  x.engine.reset();
  assert.equal(x.engine.lastUpdatedAt, null);
  assert.equal(x.engine.knownHistoryIds, null);
});

// ---- the Supabase target, against a fake client ----
function fakeClient({ row = null, error = null } = {}) {
  const log = [];
  const q = {
    select(cols) { log.push(["select", cols]); return q; }, eq() { return q; },
    maybeSingle: async () => ({ data: row, error }),
    upsert(r) { log.push(["upsert", r]); row = { ...r }; return q; }
  };
  return { from: () => q, log, get row() { return row; } };
}
const mk = (client, extra = {}) => supabaseCloudTarget({ getClient: () => client, getUserId: () => "u1", getKey: () => null, getLock: () => null, isEncrypted: p => !!(p && p.__enc), encrypt: async (k, t) => ({ __enc: true, t }), decrypt: async (k, p) => p.t, normalize: s => ({ ...s, normalized: true }), nowIso: () => "NOW", ...extra });

test("supabase target: head, fetch and push round-trip", async () => {
  const c = fakeClient({ row: { data: { history: [] }, updated_at: "U1", lock: null } });
  const t = mk(c);
  assert.deepEqual(await t.head(), { updatedAt: "U1" });
  const f = await t.fetch();
  assert.equal(f.ok, true); assert.equal(f.state.normalized, true); assert.equal(f.updatedAt, "U1");
  assert.equal(await t.push({ history: [1] }), "NOW");
  assert.deepEqual(c.row.data, { history: [1] });
});
test("supabase target: no row is { state: null }, an error is { ok: false } (NOT 'no data yet')", async () => {
  assert.deepEqual(await mk(fakeClient()).fetch(), { ok: true, state: null });
  assert.deepEqual(await mk(fakeClient({ error: { message: "down" } })).fetch(), { ok: false });
  await assert.rejects(() => mk(fakeClient({ error: new Error("down") })).head(), /down/);
});
test("supabase target: encrypted data needs the key, and is encrypted on the way up", async () => {
  const c = fakeClient({ row: { data: { __enc: true, t: JSON.stringify({ history: [] }) }, updated_at: "U1" } });
  assert.deepEqual(await mk(c).fetch(), { ok: false }, "locked device cannot read it");
  const f = await mk(c, { getKey: () => "k" }).fetch();
  assert.equal(f.ok, true); assert.equal(f.state.normalized, true);
  await mk(c, { getKey: () => "k", getLock: () => ({ salt: "s" }) }).push({ history: [] });
  assert.equal(c.row.data.__enc, true);
  assert.deepEqual(c.row.lock, { salt: "s" });
});
test("supabase target: a failed decrypt is a failed load, not empty data", async () => {
  const c = fakeClient({ row: { data: { __enc: true, t: "x" }, updated_at: "U" } });
  assert.deepEqual(await mk(c, { getKey: () => "k", decrypt: async () => { throw new Error("bad key"); } }).fetch(), { ok: false });
});
test("supabase target: a failed upsert throws so the engine reports pending", async () => {
  const c = fakeClient({ error: new Error("write failed") });
  await assert.rejects(() => mk(c).push({ history: [] }), /write failed/);
});
