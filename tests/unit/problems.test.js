import test from "node:test";
import assert from "node:assert/strict";
import { groupEvents, logHealth, isSyncStuck, areaName, STUCK_AFTER_MS } from "../../js/core/problems.js";

const NOW = 1_700_000_000_000;
const ev = (t, level, area, msg) => ({ t, level, area, msg });

test("events read newest first, with friendly area names and ages", () => {
  const rows = groupEvents([ev(NOW - 3600000, "info", "backup", "Snapshot saved"), ev(NOW - 60000, "error", "outbox", "create failed")], { now: NOW });
  assert.equal(rows[0].areaName, "Nightscout sending");
  assert.equal(rows[0].ago, "1 min ago");
  assert.equal(rows[1].areaName, "Backups");
});
test("a run of the same message folds into one row with a count", () => {
  const rows = groupEvents([ev(1, "warn", "outbox", "retry"), ev(2, "warn", "outbox", "retry"), ev(3, "warn", "outbox", "retry"), ev(4, "error", "outbox", "gave up")], { now: NOW });
  assert.equal(rows.length, 2);
  assert.equal(rows[1].count, 3);
  assert.equal(rows[1].firstT, 1);
  assert.equal(rows[1].t, 3);
});
test("problems-only hides info, keeps warnings and errors; unknown areas still get a name", () => {
  const rows = groupEvents([ev(1, "info", "boot", "ok"), ev(2, "warn", "weird", "hmm"), ev(3, "error", "dose", "refused")], { now: NOW, errorsOnly: true });
  assert.deepEqual(rows.map(r => r.areaName), ["Dose check", "Weird"]);
  assert.equal(areaName(undefined), "App");
});
test("log health counts errors and warnings and finds the latest error", () => {
  const h = logHealth([ev(1, "error", "a", "x"), ev(2, "warn", "a", "y"), ev(3, "error", "a", "z")]);
  assert.equal(h.errors, 2); assert.equal(h.warnings, 1); assert.equal(h.lastError.msg, "z");
  assert.equal(logHealth([]).lastError, null);
});
test("stuck sync: a real problem always counts", () => {
  assert.equal(isSyncStuck({ level: "problem", now: NOW }), true);
  assert.equal(isSyncStuck({ level: "problem", online: false, now: NOW }), true);
});
test("stuck sync: waiting only counts when online and for a long time", () => {
  assert.equal(isSyncStuck({ level: "pending", online: true, oldestWaitingAt: NOW - 5 * 60000, now: NOW }), false);
  assert.equal(isSyncStuck({ level: "pending", online: true, oldestWaitingAt: NOW - STUCK_AFTER_MS - 1, now: NOW }), true);
  assert.equal(isSyncStuck({ level: "pending", online: false, oldestWaitingAt: NOW - 5 * STUCK_AFTER_MS, now: NOW }), false, "offline is not a fault");
  assert.equal(isSyncStuck({ level: "pending", online: true, oldestWaitingAt: null, now: NOW }), false);
});
test("stuck sync: healthy, local-only and off are never stuck", () => {
  for (const level of ["ok", "local", "off"]) assert.equal(isSyncStuck({ level, oldestWaitingAt: 1, now: NOW }), false);
});
