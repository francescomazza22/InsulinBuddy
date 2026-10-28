import test from "node:test";
import assert from "node:assert/strict";
import {
  stepUpNeeded, cleanTotpCode, validTotpCode, verifiedTotp, unverifiedTotp, groupSecret, codeErrorText,
  sessionLevel, primaryTotp, verifyCode, startTotpSetup, cancelTotpSetup, removeTotp, signOutOtherDevices, TOTP_FACTOR_NAME
} from "../../js/mfa.js";

// A fake supabase.auth with just the calls the module uses, recording what it was asked.
function fakeAuth({ aal = { currentLevel: "aal1", nextLevel: "aal1" }, freshAal = null, factors = [], verifyOk = "123456", fail = {} } = {}) {
  const calls = [];
  let list = factors.slice();
  const res = (name, data) => fail[name] ? { data: null, error: fail[name] } : { data, error: null };
  return {
    calls,
    get factors() { return list; },
    signOut: async opts => { calls.push(["signOut", opts]); return res("signOut", null); },
    refreshSession: async () => { calls.push(["refreshSession"]); return res("refreshSession", {}); },
    mfa: {
      getAuthenticatorAssuranceLevel: async jwt => {
        calls.push(["aal", jwt]);
        if (jwt) { if (fail.aalFresh) return { data: null, error: fail.aalFresh }; return res("aal", freshAal || aal); }
        if (fail.aalThrow) throw fail.aalThrow;
        return res("aal", aal);
      },
      listFactors: async () => { calls.push(["list"]); return res("list", { all: list, totp: list.filter(f => f.status === "verified") }); },
      enroll: async o => {
        calls.push(["enroll", o]);
        const f = { id: "f-new", status: "unverified", factor_type: "totp", friendly_name: o.friendlyName };
        list.push(f);
        return res("enroll", { id: f.id, type: "totp", totp: { qr_code: "data:image/svg+xml;utf-8,<svg/>", secret: "JBSWY3DPEHPK3PXPJBSW", uri: "otpauth://totp/x" } });
      },
      unenroll: async ({ factorId }) => { calls.push(["unenroll", factorId]); if (fail.unenroll) return { data: null, error: fail.unenroll }; list = list.filter(f => f.id !== factorId); return { data: { id: factorId }, error: null }; },
      challengeAndVerify: async ({ factorId, code }) => {
        calls.push(["verify", factorId, code]);
        if (fail.verifyThrow) throw fail.verifyThrow;
        return code === verifyOk ? { data: {}, error: null } : { data: null, error: { message: "Invalid TOTP code entered" } };
      }
    }
  };
}

test("step-up is needed only when the password is done and a code is still owed", () => {
  assert.equal(stepUpNeeded({ currentLevel: "aal1", nextLevel: "aal2" }), true);
  assert.equal(stepUpNeeded({ currentLevel: "aal2", nextLevel: "aal2" }), false);
  assert.equal(stepUpNeeded({ currentLevel: "aal1", nextLevel: "aal1" }), false);   // no factor
  assert.equal(stepUpNeeded(null), false);
  assert.equal(stepUpNeeded(undefined), false);
});

test("codes: spaces and dashes are ignored, exactly six digits required", () => {
  assert.equal(cleanTotpCode(" 123 456 "), "123456");
  assert.equal(cleanTotpCode("123-456"), "123456");
  assert.equal(cleanTotpCode(null), "");
  assert.ok(validTotpCode("123456"));
  assert.ok(validTotpCode("123 456"));
  assert.ok(!validTotpCode("12345"));
  assert.ok(!validTotpCode("1234567"));
  assert.ok(!validTotpCode("abcdef"));
  assert.ok(!validTotpCode(""));
});

test("factor lists: verified oldest first; unverified separated; other types ignored", () => {
  const data = { all: [
    { id: "b", status: "verified", factor_type: "totp", created_at: "2026-10-28T10:00:00Z" },
    { id: "a", status: "verified", factor_type: "totp", created_at: "2026-10-01T10:00:00Z" },
    { id: "u", status: "unverified", factor_type: "totp" },
    { id: "p", status: "verified", factor_type: "phone" }
  ] };
  assert.deepEqual(verifiedTotp(data).map(f => f.id), ["a", "b"]);
  assert.deepEqual(unverifiedTotp(data).map(f => f.id), ["u"]);
  assert.deepEqual(verifiedTotp(null), []);
  assert.deepEqual(unverifiedTotp({}), []);
});

test("set-up key is shown in groups of four", () => {
  assert.equal(groupSecret("JBSWY3DPEHPK3PXP"), "JBSW Y3DP EHPK 3PXP");
  assert.equal(groupSecret("ABCDEF"), "ABCD EF");
  assert.equal(groupSecret(""), "");
});

test("error text is plain English", () => {
  assert.match(codeErrorText({ message: "Invalid TOTP code entered" }), /didn't work/);
  assert.match(codeErrorText({ message: "Too many requests" }), /Too many tries/);
  assert.match(codeErrorText(new TypeError("Failed to fetch")), /connection/);
  assert.match(codeErrorText({ message: "weird" }), /weird/);
});

test("sessionLevel: 'code' only when owed; any failure reads as 'ok' (the database still enforces it)", async () => {
  assert.equal(await sessionLevel(fakeAuth({ aal: { currentLevel: "aal1", nextLevel: "aal2" } })), "code");
  assert.equal(await sessionLevel(fakeAuth({ aal: { currentLevel: "aal2", nextLevel: "aal2" } })), "ok");
  assert.equal(await sessionLevel(fakeAuth()), "ok");
  assert.equal(await sessionLevel(fakeAuth({ fail: { aal: { message: "x" } } })), "ok");
  assert.equal(await sessionLevel(fakeAuth({ fail: { aalThrow: new Error("boom") } })), "ok");
});

test("sessionLevel: the server's view wins over a stale saved copy; offline falls back to the saved copy", async () => {
  // Saved copy (signed in before the factor existed) says no factor; the server says one exists now.
  const stale = fakeAuth({ aal: { currentLevel: "aal1", nextLevel: "aal1" }, freshAal: { currentLevel: "aal1", nextLevel: "aal2" } });
  assert.equal(await sessionLevel(stale, "jwt"), "code");
  assert.deepEqual(stale.calls[0], ["aal", "jwt"]);
  // Offline: the fresh check fails, the saved copy decides.
  const offline = fakeAuth({ aal: { currentLevel: "aal1", nextLevel: "aal2" }, fail: { aalFresh: { message: "Failed to fetch" } } });
  assert.equal(await sessionLevel(offline, "jwt"), "code");
  assert.deepEqual(offline.calls.map(c => c[1]), ["jwt", undefined]);
  const offlineOk = fakeAuth({ fail: { aalFresh: { message: "Failed to fetch" } } });
  assert.equal(await sessionLevel(offlineOk, "jwt"), "ok");
});

test("verifyCode: rejects malformed codes without calling the server; cleans before sending", async () => {
  const auth = fakeAuth();
  assert.deepEqual((await verifyCode(auth, "f1", "12")).ok, false);
  assert.equal(auth.calls.length, 0);
  assert.deepEqual(await verifyCode(auth, "f1", "123 456"), { ok: true });
  assert.deepEqual(auth.calls.at(-1), ["verify", "f1", "123456"]);
  const bad = await verifyCode(auth, "f1", "654321");
  assert.equal(bad.ok, false);
  assert.match(bad.message, /didn't work/);
  const thrown = await verifyCode(fakeAuth({ fail: { verifyThrow: new TypeError("Failed to fetch") } }), "f1", "123456");
  assert.equal(thrown.ok, false);
  assert.match(thrown.message, /connection/);
});

test("startTotpSetup: clears half-finished set-ups, enrols with the app's name, returns QR, key and link", async () => {
  const auth = fakeAuth({ factors: [{ id: "old", status: "unverified", factor_type: "totp" }] });
  const s = await startTotpSetup(auth);
  assert.deepEqual(auth.calls.filter(c => c[0] === "unenroll"), [["unenroll", "old"]]);
  const enroll = auth.calls.find(c => c[0] === "enroll")[1];
  assert.equal(enroll.factorType, "totp");
  assert.equal(enroll.friendlyName, TOTP_FACTOR_NAME);
  assert.equal(s.factorId, "f-new");
  assert.match(s.qr, /^data:image\/svg\+xml/);
  assert.equal(s.secret, "JBSWY3DPEHPK3PXPJBSW");
  assert.match(s.uri, /^otpauth:/);
});

test("startTotpSetup refuses when already on, and surfaces server errors", async () => {
  await assert.rejects(startTotpSetup(fakeAuth({ factors: [{ id: "v", status: "verified", factor_type: "totp" }] })), /already on/);
  await assert.rejects(startTotpSetup(fakeAuth({ fail: { enroll: { message: "MFA enroll is disabled" } } })), /disabled/);
  await assert.rejects(startTotpSetup(fakeAuth({ fail: { list: { message: "no list" } } })), /no list/);
});

test("cancel never throws; remove refreshes the session; errors surface", async () => {
  await cancelTotpSetup(fakeAuth({ fail: { unenroll: { message: "x" } } }), "f");   // no throw
  const auth = fakeAuth({ factors: [{ id: "v", status: "verified", factor_type: "totp" }] });
  assert.equal((await primaryTotp(auth)).id, "v");
  await removeTotp(auth, "v");
  assert.equal(auth.factors.length, 0);
  assert.ok(auth.calls.some(c => c[0] === "refreshSession"));
  assert.equal(await primaryTotp(auth), null);
  await assert.rejects(removeTotp(fakeAuth({ fail: { unenroll: { message: "AAL2 required" } } }), "v"), /AAL2/);
});

test("signOutOtherDevices asks for scope 'others' only and surfaces failures", async () => {
  const auth = fakeAuth();
  await signOutOtherDevices(auth);
  assert.deepEqual(auth.calls, [["signOut", { scope: "others" }]]);
  await assert.rejects(signOutOtherDevices(fakeAuth({ fail: { signOut: { message: "offline" } } })), /offline/);
});
