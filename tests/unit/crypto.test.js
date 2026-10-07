import test from "node:test";
import assert from "node:assert/strict";
import { deriveKey, encryptString, decryptString, isEncryptedPayload, randomBytes, toB64, fromB64, exportKeyRaw, importKeyRaw } from "../../js/crypto.js";

test("toB64/fromB64 round-trip arbitrary bytes", () => {
  const bytes = randomBytes(24);
  assert.deepEqual(fromB64(toB64(bytes)), bytes);
});

test("encrypt/decrypt round-trips a string with the right passphrase", async () => {
  const salt = randomBytes(16);
  const key = await deriveKey("correct horse battery staple", salt);
  const payload = await encryptString(key, "hello insulin buddy");
  assert.equal(typeof payload.iv, "string");
  assert.equal(typeof payload.data, "string");
  assert.equal(await decryptString(key, payload), "hello insulin buddy");
});

test("the wrong passphrase fails to decrypt rather than returning garbage", async () => {
  const salt = randomBytes(16);
  const key = await deriveKey("right passphrase", salt);
  const payload = await encryptString(key, "secret");
  const wrongKey = await deriveKey("wrong passphrase", salt);
  await assert.rejects(() => decryptString(wrongKey, payload));
});

test("the same passphrase with a different salt derives a different key", async () => {
  const saltA = randomBytes(16), saltB = randomBytes(16);
  const keyA = await deriveKey("same passphrase", saltA);
  const keyB = await deriveKey("same passphrase", saltB);
  const payload = await encryptString(keyA, "data");
  await assert.rejects(() => decryptString(keyB, payload));
});

test("each encryption uses a fresh IV, so the same plaintext looks different each time", async () => {
  const key = await deriveKey("p", randomBytes(16));
  const a = await encryptString(key, "same text");
  const b = await encryptString(key, "same text");
  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.data, b.data);
  assert.equal(await decryptString(key, a), "same text");
  assert.equal(await decryptString(key, b), "same text");
});

test("isEncryptedPayload distinguishes an encrypted blob from a plain state object", async () => {
  const key = await deriveKey("p", randomBytes(16));
  const enc = await encryptString(key, "{}");
  assert.equal(isEncryptedPayload(enc), true);
  assert.equal(isEncryptedPayload({ schemaVersion: 2, settings: {}, history: [] }), false);
  assert.equal(isEncryptedPayload(null), false);
  assert.equal(isEncryptedPayload(undefined), false);
  assert.equal(isEncryptedPayload("a string"), false);
  assert.equal(isEncryptedPayload([1, 2, 3]), false);
  assert.equal(isEncryptedPayload({ iv: "x" }), false, "missing data field");
  assert.equal(isEncryptedPayload({ data: "x" }), false, "missing iv field");
  assert.equal(isEncryptedPayload({ iv: 5, data: "x" }), false, "iv must be a string");
});

// ------------------------------------------------ session key export/import
test("exportKeyRaw/importKeyRaw round-trips a working key", async () => {
  const key = await deriveKey("session persistence test", randomBytes(16));
  const payload = await encryptString(key, "some data");
  const exported = await exportKeyRaw(key);
  assert.equal(typeof exported, "string");
  const restored = await importKeyRaw(exported);
  assert.equal(await decryptString(restored, payload), "some data");
});

test("a restored key can also encrypt new data, not just decrypt old data", async () => {
  const key = await deriveKey("p", randomBytes(16));
  const restored = await importKeyRaw(await exportKeyRaw(key));
  const payload = await encryptString(restored, "fresh");
  assert.equal(await decryptString(key, payload), "fresh");
});

test("importKeyRaw rejects garbage input rather than silently producing a useless key", async () => {
  await assert.rejects(() => importKeyRaw("not-valid-base64-key-material"));
});
