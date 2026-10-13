import test from "node:test";
import assert from "node:assert/strict";
import { summarizeSync } from "../../js/sync-status.js";

const NOW = 1_700_000_000_000;
const base = { now: NOW, online: true, cloud: { configured: true, signedIn: true, loadOk: true, pending: false, checkedAt: NOW - 120000 }, ns: { configured: true, queued: 0, writeOk: true, writeAt: NOW - 60000 } };
const row = (s, k) => s.rows.find(r => r.key === k);

test("all good: synced, with how recent", () => {
  const s = summarizeSync(base);
  assert.equal(s.level, "ok"); assert.equal(s.short, "Synced");
  assert.match(row(s, "cloud").text, /checked 2 min ago/); assert.match(row(s, "ns").text, /Everything sent, last 1 min ago/);
});
test("nothing set up: saved on this device only, never a warning", () => {
  const s = summarizeSync({ now: NOW, online: true, cloud: { configured: false }, ns: { configured: false } });
  assert.equal(s.level, "local"); assert.equal(s.short, "On this device");
  assert.equal(row(s, "device").level, "ok");
});
test("entries queued for Nightscout while online: sending, with a count and the age of the oldest", () => {
  const s = summarizeSync({ ...base, ns: { configured: true, queued: 2, oldestAt: NOW - 5 * 60000 } });
  assert.equal(s.level, "pending"); assert.equal(s.short, "Sending · 2");
  assert.match(row(s, "ns").text, /2 entries are on the way \(oldest 5 min ago\)/);
});
test("offline with something waiting: says Offline and that it will go when back online", () => {
  const s = summarizeSync({ ...base, online: false, cloud: { ...base.cloud, pending: true }, ns: { configured: true, queued: 1 } });
  assert.equal(s.level, "pending"); assert.match(s.short, /^Offline/);
  assert.match(row(s, "cloud").text, /offline/i); assert.match(row(s, "ns").text, /1 entry will be sent/);
});
test("a queue with an error is a problem and quotes the error", () => {
  const s = summarizeSync({ ...base, ns: { configured: true, queued: 1, lastError: "Nightscout responded with HTTP 500" } });
  assert.equal(s.level, "problem"); assert.equal(s.short, "Check sync");
  assert.match(row(s, "ns").text, /HTTP 500/); assert.match(row(s, "ns").text, /1 entry is not sent yet/);
});
test("the cloud guard tripping is a problem; a failed cloud load is a problem", () => {
  assert.equal(summarizeSync({ ...base, cloud: { ...base.cloud, blocked: { fromCount: 10, toCount: 2 } } }).level, "problem");
  const s = summarizeSync({ ...base, cloud: { ...base.cloud, loadOk: false, loadMessage: "Couldn't load" } });
  assert.equal(s.level, "problem"); assert.match(row(s, "cloud").text, /Couldn't load/);
});
test("the worst destination decides, and a destination that is off never counts", () => {
  assert.equal(summarizeSync({ ...base, cloud: { configured: false }, ns: { configured: true, queued: 1 } }).level, "pending");
  assert.equal(summarizeSync({ ...base, cloud: { ...base.cloud, pending: true }, ns: { configured: true, queued: 1, lastError: "x" } }).level, "problem");
  assert.equal(summarizeSync({ ...base, cloud: { configured: false }, ns: { configured: false } }).level, "local");
});
test("offline, a queue that has an error is just waiting for the network, not a problem", () => {
  const s = summarizeSync({ ...base, online: false, ns: { configured: true, queued: 2, lastError: "Couldn't reach Nightscout" } });
  assert.equal(s.level, "pending"); assert.match(s.short, /^Offline/);
});
