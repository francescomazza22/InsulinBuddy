import test from "node:test";
import assert from "node:assert/strict";
import {
  nsToken, nsBaseUrl, nsConfigured, extractNsId, treatmentsForEntry, NightscoutClient, NsError, NsOutbox, entriesToGlucoseRows
} from "../../js/nightscout.js";
import { makeBasalEntry } from "../../js/history.js";

const CFG = { baseUrl: "https://x.ns.example.com", token: "tok-secret-123" };
const entry = (over = {}) => ({
  id: "h1", ts: Date.UTC(2026, 8, 28, 12, 0, 0), mealType: "lunch",
  items: [{ name: "Pasta" }, { name: "Salad" }],
  totalCarbs: 60, mealDose: 5.5, correctionDose: 1, glucose: null, ...over
});

// ---------------------------------------------------------------- helpers
test("URL helpers", () => {
  assert.equal(nsToken("https://a.b/?token=abc-123&x=1"), "abc-123");
  assert.equal(nsToken("https://a.b/"), null);
  assert.equal(nsBaseUrl("https://a.b/?token=t"), "https://a.b");
  assert.equal(nsBaseUrl("https://a.b///"), "https://a.b");
  assert.equal(nsConfigured("https://a.b/?token=t"), true);
  assert.equal(nsConfigured("https://a.b/"), false);
  assert.equal(nsConfigured(""), false);
});

test("extractNsId handles the shapes servers return", () => {
  assert.equal(extractNsId({ _id: "abc" }), "abc");
  assert.equal(extractNsId([{ _id: "abc" }]), "abc");
  assert.equal(extractNsId({ result: { identifier: "z" } }), "z");
  assert.equal(extractNsId({ status: "OK" }), null);
  assert.equal(extractNsId(null), null);
  assert.equal(extractNsId("plain text"), null);
});

// -------------------------------------------------------------- builders
test("combined: food + insulin is one Meal Bolus, per the official event types", () => {
  const [p] = treatmentsForEntry(entry(), { format: "combined" });
  assert.equal(p.key, "main");
  assert.equal(p.treatment.eventType, "Meal Bolus");
  assert.equal(p.treatment.carbs, 60);
  assert.equal(p.treatment.insulin, 6.5);
  assert.equal(p.treatment.notes, "Pasta, Salad");
  assert.equal(p.treatment.created_at, "2026-09-28T12:00:00.000Z");
  assert.equal(p.treatment.enteredBy, "Insulin Buddy");
});

test("combined: food only = Carb Correction; insulin only = Correction Bolus", () => {
  const low = treatmentsForEntry(entry({ mealDose: 0, correctionDose: 0 }))[0].treatment;
  assert.equal(low.eventType, "Carb Correction"); assert.equal(low.insulin, undefined);
  const corr = treatmentsForEntry(entry({ items: [], totalCarbs: 0, mealDose: 0, correctionDose: 2.5 }))[0].treatment;
  assert.equal(corr.eventType, "Correction Bolus"); assert.equal(corr.insulin, 2.5); assert.equal(corr.notes, "Correction"); assert.equal(corr.carbs, undefined);
});

test("split: carbs and insulin become separate treatments, glucose rides with insulin", () => {
  const parts = treatmentsForEntry(entry({ glucose: 180 }), { format: "split" });
  assert.deepEqual(parts.map(p => p.key), ["carbs", "insulin"]);
  assert.equal(parts[0].treatment.eventType, "Carb Correction");
  assert.equal(parts[0].treatment.glucose, undefined);
  assert.equal(parts[1].treatment.eventType, "Correction Bolus");
  assert.equal(parts[1].treatment.glucose, 180);
  assert.equal(parts[1].treatment.notes, "Bolus for Pasta, Salad");
  assert.equal(treatmentsForEntry(entry({ mealDose: 0, correctionDose: 0 }), { format: "split" }).length, 1);
});

test("glucose is always sent in mg/dL, with units, whatever the display unit", () => {
  const t = treatmentsForEntry(entry({ glucose: 10 }), { units: "mmol" })[0].treatment;
  assert.equal(t.glucose, 180.2);
  assert.equal(t.units, "mg/dl");
  assert.equal(t.glucoseType, "Finger");
  assert.equal(treatmentsForEntry(entry({ glucose: 150 }), { units: "mgdl" })[0].treatment.glucose, 150);
});

test("an entry with neither carbs nor insulin becomes a Note rather than a bogus bolus", () => {
  const [p] = treatmentsForEntry(entry({ totalCarbs: 0, mealDose: 0, correctionDose: 0, items: [] }));
  assert.equal(p.treatment.eventType, "Note");
});

// ---------------------------------------------------------------- client
const okRes = (body, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });
function spyFetch(responder) {
  const calls = [];
  const f = async (url, init) => { calls.push({ url, init }); return responder(url, init); };
  f.calls = calls;
  return f;
}

test("client: proxy success reports via=proxy and the record id", async () => {
  const statuses = [];
  const invoke = async (name, body) => ({ data: { ok: true, status: 200, body: { _id: "srv1" } }, error: null });
  const c = new NightscoutClient({ invoke, onStatus: (...a) => statuses.push(a) });
  const r = await c.create(CFG, { eventType: "Note" });
  assert.equal(r.id, "srv1"); assert.equal(r.via, "proxy");
  assert.deepEqual(statuses[0].slice(0, 3), ["write", true, "proxy"]);
});

test("client: sends the right action and payload to the proxy", async () => {
  const seen = [];
  const invoke = async (name, body) => { seen.push({ name, body }); return { data: { ok: true, body: [] }, error: null }; };
  const c = new NightscoutClient({ invoke });
  await c.read(CFG, 5); await c.update(CFG, { _id: "a", eventType: "Note" }); await c.remove(CFG, "a");
  assert.deepEqual(seen.map(s => s.body.action), ["read", "update", "delete"]);
  assert.ok(seen.every(s => s.name === "nightscout-proxy" && s.body.baseUrl === CFG.baseUrl && s.body.token === CFG.token));
  assert.equal(seen[0].body.count, 5); assert.equal(seen[2].body.id, "a");
});

test("client: falls back to the legacy functions when nightscout-proxy isn't deployed yet", async () => {
  const names = [];
  const invoke = async (name) => {
    names.push(name);
    if (name === "nightscout-proxy") return { data: null, error: { message: "Requested function was not found", context: { status: 404 } } };
    if (name === "write-nightscout-treatment") return { data: { ok: true, body: { _id: "legacy1" } }, error: null };
    return { data: { entries: [{ sgv: 120 }] }, error: null };
  };
  const c = new NightscoutClient({ invoke });
  assert.equal((await c.create(CFG, { eventType: "Note" })).id, "legacy1");
  assert.deepEqual((await c.read(CFG, 1)).entries, [{ sgv: 120 }]);
  assert.ok(names.includes("write-nightscout-treatment") && names.includes("fetch-nightscout-glucose"));
});

test("client: if the proxy is unavailable it falls back to a direct request", async () => {
  const f = spyFetch(() => okRes({ _id: "direct1" }));
  const invoke = async () => { throw new Error("Failed to send a request to the Edge Function"); };
  const c = new NightscoutClient({ invoke, fetchImpl: f });
  const r = await c.create(CFG, { eventType: "Note" });
  assert.equal(r.via, "direct"); assert.equal(r.id, "direct1");
  assert.equal(f.calls[0].url, "https://x.ns.example.com/api/v1/treatments?token=tok-secret-123");
  assert.equal(f.calls[0].init.method, "POST");
});

test("client: when the proxy REACHED Nightscout and it failed, never retry directly (no duplicate writes)", async () => {
  const f = spyFetch(() => okRes({ _id: "dup" }));
  const invoke = async () => ({ data: { ok: false, code: "UPSTREAM_HTTP", status: 500, error: "Nightscout responded with HTTP 500" }, error: null });
  const c = new NightscoutClient({ invoke, fetchImpl: f });
  await assert.rejects(() => c.create(CFG, { eventType: "Note" }), e => e.kind === "http" && e.status === 500 && e.via === "proxy");
  assert.equal(f.calls.length, 0);
});

test("client: a proxy-side rejection (e.g. host not allowed) is a hard error, not a fallback", async () => {
  const f = spyFetch(() => okRes({}));
  const invoke = async () => ({ data: { ok: false, code: "HOST_NOT_ALLOWED", error: "That host isn't allowed" }, error: null });
  const c = new NightscoutClient({ invoke, fetchImpl: f });
  await assert.rejects(() => c.read(CFG), e => e.kind === "proxy" && e.code === "HOST_NOT_ALLOWED");
  assert.equal(f.calls.length, 0);
});

test("client direct: update = PUT, delete = DELETE with the id in the path, read = GET", async () => {
  const f = spyFetch(() => okRes({ ok: 1 }));
  const c = new NightscoutClient({ fetchImpl: f });
  await c.update(CFG, { _id: "a/b", eventType: "Note" });
  await c.remove(CFG, "a/b");
  await c.read(CFG, 3);
  assert.equal(f.calls[0].init.method, "PUT");
  assert.equal(f.calls[1].init.method, "DELETE");
  assert.ok(f.calls[1].url.includes("/api/v1/treatments/a%2Fb?token="));
  assert.equal(f.calls[2].init.method, "GET");
  assert.ok(f.calls[2].url.includes("entries.json?count=3"));
});

test("client direct: HTTP errors and network failures are typed", async () => {
  const c1 = new NightscoutClient({ fetchImpl: spyFetch(() => okRes({}, 401)) });
  await assert.rejects(() => c1.read(CFG), e => e.kind === "http" && e.status === 401);
  const c2 = new NightscoutClient({ fetchImpl: async () => { throw new TypeError("Failed to fetch"); } });
  await assert.rejects(() => c2.read(CFG), e => e.kind === "network");
});

test("client: refuses without config, and update needs an _id", async () => {
  const c = new NightscoutClient({ fetchImpl: spyFetch(() => okRes({})) });
  await assert.rejects(() => c.read({ baseUrl: "", token: "" }), e => e.kind === "config");
  await assert.rejects(() => c.update(CFG, { eventType: "Note" }), e => e.kind === "config");
});

test("client: the token never appears in logs or statuses", async () => {
  const logs = [], statuses = [];
  const diag = { log: (l, a, m) => logs.push(m) };
  const c = new NightscoutClient({ diag, onStatus: (...a) => statuses.push(a[3]), fetchImpl: async () => { throw new TypeError("boom tok-secret-123"); } });
  await assert.rejects(() => c.read(CFG));
  assert.ok(![...logs, ...statuses].join(" ").includes("tok-secret-123"));
});

// ---------------------------------------------------------------- outbox
function fakeStorage() { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), _m: m }; }
function fakeClient(script = {}) {
  const calls = [];
  let n = 0;
  return {
    calls,
    async create(cfg, t) { calls.push(["create", t.eventType]); if (script.create) return script.create(t, calls); return { id: `id${++n}` }; },
    async update(cfg, t) { calls.push(["update", t._id, t.eventType]); if (script.update) return script.update(t, calls); return { id: t._id }; },
    async remove(cfg, id) { calls.push(["remove", id]); if (script.remove) return script.remove(id, calls); return {}; }
  };
}
function makeOutbox(client, over = {}) {
  const patches = [];
  const clock = { t: 1_000_000 };
  const ob = new NsOutbox({
    storage: over.storage || fakeStorage(), client, getConfig: () => (over.unconfigured ? null : CFG),
    onEntryPatch: (id, p) => patches.push([id, p]), now: () => clock.t
  });
  return { ob, patches, clock };
}

test("outbox: a created meal is delivered and its ids recorded on the entry", async () => {
  const cl = fakeClient(); const { ob, patches } = makeOutbox(cl);
  ob.enqueueCreate(entry(), { format: "combined" });
  assert.equal(ob.count(), 1);
  const r = await ob.flush();
  assert.equal(r.sent, 1); assert.equal(ob.count(), 0);
  assert.deepEqual(cl.calls, [["create", "Meal Bolus"]]);
  assert.equal(patches[0][0], "h1");
  assert.equal(patches[0][1].ns.status, "synced");
  assert.deepEqual(patches[0][1].ns.ids, { main: "id1" });
});

test("outbox: split format with a mid-way failure resumes without duplicating the first half", async () => {
  let failSecond = true;
  const cl = fakeClient({ create: (t) => { if (t.eventType === "Correction Bolus" && failSecond) throw new NsError("network", "offline"); return { id: t.eventType === "Carb Correction" ? "c1" : "i1" }; } });
  const { ob, clock } = makeOutbox(cl);
  ob.enqueueCreate(entry(), { format: "split" });
  let r = await ob.flush();
  assert.equal(r.remaining, 1);
  failSecond = false; clock.t += 60_000;                       // past the first back-off
  r = await ob.flush();
  assert.equal(r.remaining, 0);
  const creates = cl.calls.filter(c => c[0] === "create").map(c => c[1]);
  assert.deepEqual(creates, ["Carb Correction", "Correction Bolus", "Correction Bolus"], "carbs created once, insulin retried once");
});

test("outbox: transient failures back off; permanent ones are dropped and flagged on the entry", async () => {
  let mode = "network";
  const cl = fakeClient({ create: () => { throw mode === "network" ? new NsError("network", "offline") : new NsError("http", "Nightscout responded with HTTP 404", { status: 404 }); } });
  const { ob, patches, clock } = makeOutbox(cl);
  ob.enqueueCreate(entry());
  await ob.flush();
  assert.equal(ob.count(), 1);
  assert.ok(ob.pendingFor("h1").nextTryAt > clock.t, "backed off");
  const callsBefore = cl.calls.length;
  await ob.flush();                                            // too soon -> skipped
  assert.equal(cl.calls.length, callsBefore);
  mode = "http"; clock.t += 10 * 60_000;
  const r = await ob.flush();
  assert.equal(r.failed, 1); assert.equal(ob.count(), 0);
  assert.equal(patches.at(-1)[1].ns.status, "failed");
  assert.match(patches.at(-1)[1].ns.error, /404/);
});

test("outbox: 5xx and 429 are retried, other 4xx are not", async () => {
  for (const [status, retried] of [[500, true], [503, true], [429, true], [408, true], [400, false], [401, false], [404, false], [405, false]]) {
    const cl = fakeClient({ create: () => { throw new NsError("http", `HTTP ${status}`, { status }); } });
    const { ob } = makeOutbox(cl);
    ob.enqueueCreate(entry());
    await ob.flush();
    assert.equal(ob.count() === 1, retried, `status ${status}`);
  }
});

test("outbox: editing a synced meal PUTs to the same remote record", async () => {
  const cl = fakeClient(); const { ob, patches } = makeOutbox(cl);
  const e = entry({ ns: { status: "synced", ids: { main: "remote-9" }, format: "combined" } });
  ob.enqueueUpdate(e, { format: "combined" });
  await ob.flush();
  assert.deepEqual(cl.calls, [["update", "remote-9", "Meal Bolus"]]);
  assert.equal(patches[0][1].ns.status, "synced");
});

test("outbox: changing format on edit creates the new parts and removes the old record", async () => {
  const cl = fakeClient(); const { ob } = makeOutbox(cl);
  const e = entry({ ns: { status: "synced", ids: { main: "remote-9" }, format: "combined" } });
  ob.enqueueUpdate(e, { format: "split" });
  await ob.flush();
  assert.deepEqual(cl.calls.map(c => c[0]), ["create", "create", "remove"]);
  assert.deepEqual(cl.calls.at(-1), ["remove", "remote-9"]);
});

test("outbox: editing a meal that never reached Nightscout just sends it as new", async () => {
  const cl = fakeClient(); const { ob } = makeOutbox(cl);
  ob.enqueueUpdate(entry(), { format: "combined" });
  assert.equal(ob.pendingFor("h1").op, "create");
});

test("outbox: edits fold into a pending create (one job, latest content)", async () => {
  const cl = fakeClient(); const { ob } = makeOutbox(cl);
  ob.enqueueCreate(entry({ mealDose: 5 }));
  ob.enqueueUpdate(entry({ mealDose: 8, correctionDose: 0 }));
  assert.equal(ob.count(), 1);
  await ob.flush();
  assert.equal(cl.calls.length, 1);
});

test("outbox: an edit after a half-delivered split create UPDATES the delivered part", async () => {
  let failSecond = true;
  const cl = fakeClient({ create: (t) => { if (t.eventType === "Correction Bolus" && failSecond) throw new NsError("network", "offline"); return { id: t.eventType === "Carb Correction" ? "c1" : "i1" }; } });
  const { ob, clock } = makeOutbox(cl);
  ob.enqueueCreate(entry(), { format: "split" });
  await ob.flush();                                            // carbs delivered, insulin failed
  failSecond = false;
  ob.enqueueUpdate(entry({ totalCarbs: 70 }), { format: "split" });
  clock.t += 60_000;
  await ob.flush();
  const kinds = cl.calls.map(c => c[0] + ":" + (c[1] || ""));
  assert.ok(kinds.includes("update:c1"), "already-delivered carbs part is updated, not re-created");
  assert.equal(cl.calls.filter(c => c[0] === "create" && c[1] === "Carb Correction").length, 1);
});

test("outbox: deleting removes the remote records", async () => {
  const cl = fakeClient(); const { ob } = makeOutbox(cl);
  ob.enqueueDelete("h1", { carbs: "c1", insulin: "i1" });
  await ob.flush();
  assert.deepEqual(cl.calls, [["remove", "c1"], ["remove", "i1"]]);
});

test("outbox: deleting a meal whose create never went out sends nothing at all", async () => {
  const cl = fakeClient(); const { ob } = makeOutbox(cl);
  ob.enqueueCreate(entry());
  ob.enqueueDelete("h1", null);
  assert.equal(ob.count(), 0);
  await ob.flush();
  assert.equal(cl.calls.length, 0);
});

test("outbox: deleting after a half-delivered create only removes what was actually created", async () => {
  const cl = fakeClient({ create: (t) => { if (t.eventType === "Correction Bolus") throw new NsError("network", "offline"); return { id: "c1" }; } });
  const { ob } = makeOutbox(cl);
  ob.enqueueCreate(entry(), { format: "split" });
  await ob.flush();
  ob.enqueueDelete("h1", null);
  assert.equal(ob.pendingFor("h1").op, "delete");
  assert.deepEqual(ob.pendingFor("h1").ids, ["c1"]);
});

test("outbox: Undo cancels a pending delete", () => {
  const { ob } = makeOutbox(fakeClient());
  ob.enqueueDelete("h1", { main: "x" });
  assert.equal(ob.cancelDelete("h1"), true);
  assert.equal(ob.count(), 0);
  assert.equal(ob.cancelDelete("h1"), false);
});

test("outbox: if Nightscout returns no id, later edits are flagged instead of creating duplicates", async () => {
  const cl = fakeClient({ create: () => ({ id: null }) }); const { ob, patches } = makeOutbox(cl);
  ob.enqueueCreate(entry());
  await ob.flush();
  const ns = patches[0][1].ns;
  assert.equal(ns.ids.main, "");
  assert.ok(ns.warn);
  ob.enqueueUpdate(entry({ ns }));
  await ob.flush();
  assert.equal(cl.calls.filter(c => c[0] === "create").length, 1, "no second create");
  assert.equal(cl.calls.filter(c => c[0] === "update").length, 0);
});

test("outbox: does nothing (and keeps its jobs) while Nightscout isn't configured", async () => {
  const cl = fakeClient(); const { ob } = makeOutbox(cl, { unconfigured: true });
  ob.enqueueCreate(entry());
  const r = await ob.flush();
  assert.equal(r.unconfigured, true); assert.equal(ob.count(), 1); assert.equal(cl.calls.length, 0);
});

test("outbox: jobs survive a reload; the old queue format is migrated", async () => {
  const storage = fakeStorage();
  const a = makeOutbox(fakeClient(), { storage }).ob;
  a.enqueueCreate(entry());
  const b = makeOutbox(fakeClient(), { storage }).ob;
  assert.equal(b.count(), 1);
  storage.setItem("insulinBuddy.nsQueue", JSON.stringify([{ eventType: "Meal Bolus", carbs: 10, insulin: 1, created_at: "2026-01-01T00:00:00.000Z" }]));
  assert.equal(b.migrateLegacy(), 1);
  assert.equal(b.count(), 2);
  assert.equal(storage.getItem("insulinBuddy.nsQueue"), null);
});

test("outbox: flush is not re-entrant", async () => {
  let release; const gate = new Promise(r => { release = r; });
  const cl = fakeClient({ create: async () => { await gate; return { id: "z" }; } });
  const { ob } = makeOutbox(cl);
  ob.enqueueCreate(entry());
  const first = ob.flush();
  const second = await ob.flush();
  assert.equal(second.skipped, true);
  release(); await first;
  assert.equal(cl.calls.filter(c => c[0] === "create").length, 1);
});

// ------------------------------------------------------ date-bounded reads
test("client: read() passes before/after through to the proxy invoke body", async () => {
  const seen = [];
  const invoke = async (name, body) => { seen.push(body); return { data: { ok: true, body: [] }, error: null }; };
  const c = new NightscoutClient({ invoke });
  await c.read(CFG, 500, { before: 1735689600000 });
  await c.read(CFG, 500, { after: 1735689600000 });
  await c.read(CFG, 5); // ordinary read: neither field present
  assert.equal(seen[0].before, 1735689600000); assert.equal(seen[0].after, undefined);
  assert.equal(seen[1].after, 1735689600000); assert.equal(seen[1].before, undefined);
  assert.equal(seen[2].before, undefined); assert.equal(seen[2].after, undefined);
});

test("client direct: read() adds the matching find[date] filter to the URL", async () => {
  const f = spyFetch(() => okRes([]));
  const c = new NightscoutClient({ fetchImpl: f });
  await c.read(CFG, 500, { before: 1735689600000 });
  assert.ok(f.calls[0].url.includes("find[date][$lt]=1735689600000"), f.calls[0].url);
  await c.read(CFG, 500, { after: 1735689600000 });
  assert.ok(f.calls[1].url.includes("find[date][$gte]=1735689600000"), f.calls[1].url);
});

// ------------------------------------------------------ glucose row mapping
test("entriesToGlucoseRows maps Nightscout entries to our table shape", () => {
  const rows = entriesToGlucoseRows([
    { sgv: 120, date: 1735689600000, direction: "Flat" },
    { sgv: 95, date: 1735689900000 },              // no direction -- fine, becomes null
  ], "user-1");
  assert.deepEqual(rows, [
    { user_id: "user-1", at: new Date(1735689600000).toISOString(), mgdl: 120, direction: "Flat" },
    { user_id: "user-1", at: new Date(1735689900000).toISOString(), mgdl: 95, direction: null }
  ]);
});

test("entriesToGlucoseRows drops entries with no usable value or timestamp", () => {
  const rows = entriesToGlucoseRows([
    { sgv: 120, date: 1735689600000 },
    { date: 1735689600000 },              // no sgv/mbg
    { sgv: 0, date: 1735689600000 },      // zero isn't a real reading
    { sgv: -5, date: 1735689600000 },     // negative
    { sgv: 120 },                         // no date
    { sgv: "120", date: 1735689600000 },  // wrong type
    null, undefined
  ], "user-1");
  assert.equal(rows.length, 1);
});

test("entriesToGlucoseRows falls back to mbg (calibration entries) when there's no sgv", () => {
  const rows = entriesToGlucoseRows([{ mbg: 110, date: 1735689600000 }], "user-1");
  assert.equal(rows[0].mgdl, 110);
});

test("entriesToGlucoseRows de-duplicates identical timestamps within one batch", () => {
  const rows = entriesToGlucoseRows([
    { sgv: 120, date: 1735689600000 },
    { sgv: 121, date: 1735689600000 }, // same instant, second copy -- keep the first
  ], "user-1");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].mgdl, 120);
});

test("entriesToGlucoseRows rounds fractional mg/dL values", () => {
  const rows = entriesToGlucoseRows([{ sgv: 119.6, date: 1735689600000 }], "user-1");
  assert.equal(rows[0].mgdl, 120);
});

// ------------------------------------------------------------ basal -> Nightscout
// Nightscout's IOB plugin runs treatment.insulin through a rapid-acting curve for EVERY treatment that has
// one, whatever its eventType. So basal must be sent with no `insulin` field at all.
const basalEntry = (units, slot, ts = Date.UTC(2026, 8, 28, 8, 5, 0)) => makeBasalEntry({ units, ts, slot, now: ts });

test("basal -> a single Note with the dose in the text, and NO insulin field", () => {
  for (const format of ["combined", "split"]) {
    const parts = treatmentsForEntry(basalEntry(14, "am"), { format });
    assert.equal(parts.length, 1, format);
    assert.equal(parts[0].key, "main");
    const t = parts[0].treatment;
    assert.equal(t.eventType, "Note");
    assert.equal(t.notes, "Basal insulin: 14u (morning)");
    assert.equal(t.enteredBy, "Insulin Buddy");
    assert.equal(t.created_at, "2026-09-28T08:05:00.000Z", "stamped with the time the dose was TAKEN");
    for (const forbidden of ["insulin", "carbs", "glucose", "rate", "duration"]) assert.ok(!(forbidden in t), `${forbidden} must not be sent (${format})`);
  }
});

test("basal Note: evening label, fractional dose, and no label when the slot is unknown", () => {
  assert.equal(treatmentsForEntry(basalEntry(16, "pm"))[0].treatment.notes, "Basal insulin: 16u (evening)");
  assert.equal(treatmentsForEntry(basalEntry(14.25, "am"))[0].treatment.notes, "Basal insulin: 14.25u (morning)");
  assert.equal(treatmentsForEntry({ ...basalEntry(10, "am"), basalSlot: undefined })[0].treatment.notes, "Basal insulin: 10u");
});

test("a basal entry never falls through to the generic content-free note or to a bolus", () => {
  const t = treatmentsForEntry(basalEntry(14, "am"))[0].treatment;
  assert.notEqual(t.notes, "Logged in Insulin Buddy");
  assert.ok(!/Bolus|Correction/.test(t.eventType));
});
