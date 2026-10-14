import test from "node:test";
import assert from "node:assert/strict";
import { createStorage, memoryBackend, runMigrations, STORAGE_VERSION_KEY, STORAGE_MIGRATIONS } from "../../js/core/storage.js";

const broken = () => ({ getItem() { throw new Error("blocked"); }, setItem() { throw new Error("quota"); }, removeItem() { throw new Error("blocked"); }, keys() { throw new Error("blocked"); } });

test("storage: reads, writes, json and keys work", () => {
  const s = createStorage(memoryBackend());
  assert.equal(s.getItem("a"), null);
  assert.equal(s.setItem("a", 5), true);
  assert.equal(s.getItem("a"), "5");
  assert.equal(s.setJson("j", { x: 1 }), true);
  assert.deepEqual(s.getJson("j"), { x: 1 });
  assert.deepEqual(s.getJson("missing", []), []);
  assert.deepEqual(s.keys().sort(), ["a", "j"]);
  assert.equal(s.removeItem("a"), true);
  assert.equal(s.getItem("a"), null);
});
test("storage: bad JSON reads as the fallback and is reported", () => {
  const errs = [];
  const s = createStorage(memoryBackend({ k: "{nope" }), { onError: (op, key) => errs.push(op + ":" + key) });
  assert.equal(s.getJson("k", "fb"), "fb");
  assert.deepEqual(errs, ["parse:k"]);
});
test("storage: a blocked store reads empty, setItem says false, mustSet throws", () => {
  const errs = [];
  const s = createStorage(broken(), { onError: (op) => errs.push(op) });
  assert.equal(s.getItem("a"), null);
  assert.equal(s.setItem("a", 1), false);
  assert.equal(s.removeItem("a"), false);
  assert.deepEqual(s.keys(), []);
  assert.throws(() => s.mustSet("a", 1), /Could not save "a"/);
  assert.ok(errs.includes("read") && errs.includes("write"));
});
test("storage: a reporter that throws never breaks storage", () => {
  const s = createStorage(broken(), { onError: () => { throw new Error("boom"); } });
  assert.equal(s.setItem("a", 1), false);
});
test("migrations: run once, in order, and are recorded", () => {
  const s = createStorage(memoryBackend());
  const order = [];
  const list = [{ version: 2, run: () => order.push(2) }, { version: 1, run: () => order.push(1) }];
  assert.deepEqual(runMigrations(s, list), { version: 2, ran: [1, 2] });
  assert.deepEqual(order, [1, 2]);
  assert.equal(s.getItem(STORAGE_VERSION_KEY), "2");
  assert.deepEqual(runMigrations(s, list), { version: 2, ran: [] });
  assert.deepEqual(order, [1, 2]);
});
test("migrations: a failing one stops, is not recorded, and is retried next time", () => {
  const s = createStorage(memoryBackend());
  let fail = true;
  const list = [{ version: 1, run() {} }, { version: 2, run() { if (fail) throw new Error("bad"); } }, { version: 3, run() {} }];
  const logs = [];
  assert.deepEqual(runMigrations(s, list, (...a) => logs.push(a[0])), { version: 1, ran: [1] });
  assert.equal(s.getItem(STORAGE_VERSION_KEY), "1");
  assert.deepEqual(logs, ["error"]);
  fail = false;
  assert.deepEqual(runMigrations(s, list), { version: 3, ran: [2, 3] });
});
test("migrations: the shipped list starts at a baseline", () => {
  const s = createStorage(memoryBackend());
  assert.equal(runMigrations(s, STORAGE_MIGRATIONS).version, STORAGE_MIGRATIONS.at(-1).version);
});
