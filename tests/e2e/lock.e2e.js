// Passphrase lock, end to end: local-only mode (no cloud sync configured at all).
import fs from "node:fs";
import { startApp, openDevice, makeChecker, fakeWebAuthn, createBackend, fakeSupabaseSource } from "./harness.js";
import { FOODS_JS, stateBlob } from "./helpers.js";

const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker();
const app = await startApp(DIR, null, { "foods_data.js": FOODS_JS, "manifest.json": "{}" });
const dev = await openDevice(app, { height: 900, wait: 600 }); // no fakeSupabaseSource -> local-only mode
const noErrors = async label => t.check(`${label}: no JS errors`, (await dev.eval("window.__errs.length")) === 0, JSON.stringify(await dev.eval("window.__errs")));
const fillDialog = async value => { await dev.eval(`document.querySelector(".dialog__input").value = ${JSON.stringify(value)}`); await dev.click(".dialog__btn--primary"); await dev.sleep(150); };
const submitLock = async pass => { await dev.eval(`document.getElementById("lock-passphrase").value = ${JSON.stringify(pass)}`); await dev.eval(`document.getElementById("lock-form").dispatchEvent(new Event("submit", {cancelable:true}))`); await dev.sleep(350); };

t.section("Setting a passphrase encrypts local storage, and the lock screen protects a reload");
t.check("no lock screen by default (no passphrase set yet)", await dev.eval(`document.getElementById("lock-screen").hidden`));
await dev.tab("settings"); await dev.sleep(150);
t.check("privacy card is visible in local-only mode", await dev.eval(`!document.getElementById("privacy-panel-card").hidden`));

await dev.click("#btn-set-pass"); await dev.sleep(150);
await fillDialog("local-only-pass");
await fillDialog("local-only-pass"); // confirm
await dev.sleep(300);
await dev.click(".dialog__btn--primary"); await dev.sleep(150); // dismiss the "now encrypted" alert
const raw = await dev.eval(`localStorage.getItem("insulinBuddy.v2")`);
t.check("local storage is now ciphertext, not readable JSON", !raw.includes('"history"'), raw.slice(0, 80));

t.section("REGRESSION: once unlocked, this session stays unlocked across a reload");
await dev.go("index.html", 700);
t.check("no lock screen on a reload within the same session", await dev.eval(`document.getElementById("lock-screen").hidden`));
t.check("the app is straight in, no re-entry needed", (await dev.eval(`document.getElementById("cc-food-list").children.length`)) === 2);
await noErrors("device");

t.section("\"Lock now\" clears the session and requires the passphrase again");
await dev.tab("settings"); await dev.sleep(150);
t.check("a Lock now button is offered while unlocked", !!(await dev.eval(`document.getElementById("btn-lock-now")`)));
const beforeLock = await dev.eval(`sessionStorage.getItem("insulinBuddy.sessionKey")`);
t.check("a session key is actually stored while unlocked", !!beforeLock);
await dev.click("#btn-lock-now"); await dev.sleep(700); // this reloads the page itself
t.check("the session key was cleared", (await dev.eval(`sessionStorage.getItem("insulinBuddy.sessionKey")`)) == null);
t.check("the lock screen shows again immediately", !(await dev.eval(`document.getElementById("lock-screen").hidden`)));
await submitLock("wrong guess");
t.check("a wrong passphrase is still rejected after Lock now", !(await dev.eval(`document.getElementById("lock-error").hidden`)));
await submitLock("local-only-pass");
t.check("unlocking again works normally", await dev.eval(`document.getElementById("lock-screen").hidden`));
await noErrors("device");

t.section("Removing the passphrase clears the session key too");
await dev.tab("settings"); await dev.sleep(150);
await dev.click("#btn-remove-pass"); await dev.sleep(150);
await fillDialog("local-only-pass");
await dev.sleep(300);
await dev.click(".dialog__btn--primary"); await dev.sleep(150); // dismiss confirmation
t.check("session key removed along with the lock", (await dev.eval(`sessionStorage.getItem("insulinBuddy.sessionKey")`)) == null);
await dev.go("index.html", 700);
t.check("no lock screen after removal, even on reload", await dev.eval(`document.getElementById("lock-screen").hidden`));
await noErrors("device");

dev.close();
await app.close();

// ---------------------------------------------------------------------------
// Face ID / Touch ID: a fresh app+device with a fake platform authenticator injected, since
// headless Chrome has no real biometric hardware.
{
  t.section("Face ID: not offered at all when the platform doesn't support it (no fake injected)");
  const app2 = await startApp(DIR, null, { "foods_data.js": FOODS_JS, "manifest.json": "{}" });
  const plain = await openDevice(app2, { height: 900, wait: 600 }); // no WebAuthn stub
  await plain.tab("settings"); await plain.click("#btn-set-pass"); await plain.sleep(150);
  await plain.eval(`document.querySelector(".dialog__input").value = "no-webauthn-here"`); await plain.click(".dialog__btn--primary"); await plain.sleep(150);
  await plain.eval(`document.querySelector(".dialog__input").value = "no-webauthn-here"`); await plain.click(".dialog__btn--primary"); await plain.sleep(300);
  await plain.click(".dialog__btn--primary"); await plain.sleep(150);
  t.check("no Face ID toggle offered without WebAuthn support", !(await plain.eval(`!!document.getElementById("faceid-toggle")`)));
  plain.close(); await app2.close();
}

{
  const app3 = await startApp(DIR, null, { "foods_data.js": FOODS_JS, "manifest.json": "{}" });
  const dev2 = await openDevice(app3, { height: 900, wait: 1200, inject: fakeWebAuthn() });
  const fill = async value => { await dev2.eval(`document.querySelector(".dialog__input").value = ${JSON.stringify(value)}`); await dev2.click(".dialog__btn--primary"); await dev2.sleep(150); };
  const noErr2 = async label => t.check(`${label}: no JS errors`, (await dev2.eval("window.__errs.length")) === 0, JSON.stringify(await dev2.eval("window.__errs")));

  t.section("Face ID: enrolling calls the real WebAuthn ceremony and stores a durable key");
  await dev2.tab("settings"); await dev2.click("#btn-set-pass"); await dev2.sleep(150);
  await fill("faceid-pass"); await fill("faceid-pass"); await dev2.sleep(300);
  await dev2.click(".dialog__btn--primary"); await dev2.sleep(150); // dismiss "now encrypted"
  t.check("Face ID toggle is offered when WebAuthn is available", await dev2.eval(`!!document.getElementById("faceid-toggle")`));
  t.check("starts unchecked", !(await dev2.eval(`document.getElementById("faceid-toggle").checked`)));
  await dev2.click("#faceid-toggle"); await dev2.sleep(300);
  t.check("navigator.credentials.create was actually called", (await dev2.eval(`window.__webauthnCalls`)).some(c => c.op === "create"));
  t.check("a credential id was stored", !!(await dev2.eval(`localStorage.getItem("insulinBuddy.faceIdCredentialId")`)));
  t.check("a durable key was stashed", !!(await dev2.eval(`localStorage.getItem("insulinBuddy.durableKey")`)));
  await noErr2("device");

  t.section("REGRESSION: after a real close, Face ID unlocks without typing the passphrase");
  // A plain reload alone isn't enough to test this in isolation: sessionStorage (the earlier
  // session-persistence feature) also survives a reload, and would silently satisfy the unlock
  // before Face ID ever got a chance to run. An actual browser close clears sessionStorage but
  // not localStorage -- simulate that precisely rather than relying on a bare reload.
  await dev2.eval(`sessionStorage.removeItem("insulinBuddy.sessionKey")`);
  await dev2.go("index.html", 900);
  t.check("Face ID is offered and auto-attempted", (await dev2.eval(`window.__webauthnCalls`)).some(c => c.op === "get"));
  t.check("it unlocked without ever submitting the passphrase form", await dev2.eval(`document.getElementById("lock-screen").hidden`));
  t.check("the app is actually usable afterward", (await dev2.eval(`document.getElementById("cc-food-list").children.length`)) === 2);
  await noErr2("device");

  t.section("A declined/failed Face ID prompt falls back to the passphrase field, not a dead end");
  await dev2.eval(`window.__webauthnShouldFail = true`);
  await dev2.eval(`sessionStorage.removeItem("insulinBuddy.sessionKey")`); // force Face ID to actually be exercised, not skipped via a still-valid session
  await dev2.go("index.html", 900);
  t.check("lock screen still shown after Face ID fails", !(await dev2.eval(`document.getElementById("lock-screen").hidden`)));
  t.check("an explanatory message appears, not a silent dead end", /Face ID didn't work/i.test(await dev2.text("#lock-error")));
  await dev2.eval(`document.getElementById("lock-passphrase").value = "faceid-pass"`);
  await dev2.eval(`document.getElementById("lock-form").dispatchEvent(new Event("submit", {cancelable:true}))`);
  await dev2.sleep(400);
  t.check("the real passphrase still works as a fallback", await dev2.eval(`document.getElementById("lock-screen").hidden`));
  await dev2.eval(`window.__webauthnShouldFail = false`);
  await noErr2("device");

  t.section("Disabling the toggle turns Face ID off for future unlocks");
  await dev2.tab("settings"); await dev2.sleep(150);
  t.check("toggle shows enabled", await dev2.eval(`document.getElementById("faceid-toggle").checked`));
  await dev2.click("#faceid-toggle"); await dev2.sleep(150);
  t.check("credential id cleared", (await dev2.eval(`localStorage.getItem("insulinBuddy.faceIdCredentialId")`)) == null);
  t.check("durable key cleared", (await dev2.eval(`localStorage.getItem("insulinBuddy.durableKey")`)) == null);
  await dev2.click("#btn-lock-now"); await dev2.sleep(700);
  t.check("Face ID button no longer offered on the lock screen", await dev2.eval(`document.getElementById("btn-faceid-unlock").hidden`));
  await dev2.eval(`document.getElementById("lock-passphrase").value = "faceid-pass"`);
  await dev2.eval(`document.getElementById("lock-form").dispatchEvent(new Event("submit", {cancelable:true}))`);
  await dev2.sleep(400);
  await noErr2("device");

  t.section("Changing the passphrase invalidates any previously-enrolled Face ID");
  await dev2.tab("settings"); await dev2.sleep(150);
  await dev2.click("#faceid-toggle"); await dev2.sleep(300); // re-enroll
  t.check("re-enrolled", await dev2.eval(`document.getElementById("faceid-toggle").checked`));
  await dev2.click("#btn-change-pass"); await dev2.sleep(150);
  await fill("faceid-pass"); // current
  await fill("a-new-passphrase"); await fill("a-new-passphrase"); await dev2.sleep(300);
  await dev2.click(".dialog__btn--primary"); await dev2.sleep(150); // dismiss "updated"
  t.check("Face ID was automatically disabled by the passphrase change", (await dev2.eval(`localStorage.getItem("insulinBuddy.faceIdCredentialId")`)) == null);
  await noErr2("device");

  dev2.close(); await app3.close();
}

// ---------------------------------------------------------------------------
// REGRESSION: onAuthStateChange firing more than once (a real thing real Supabase does --
// e.g. an initial session restore followed by a SIGNED_IN event) must not trigger the lock
// prompt twice. Simulated deterministically by firing two "SIGNED_IN" events back-to-back in
// the same tick, rather than hoping to win a real timing race.
{
  t.section("REGRESSION: two overlapping sign-in events don't double-prompt for Face ID");
  const be = createBackend();
  const app4 = await startApp(new URL("../..", import.meta.url).pathname, be, { "foods_data.js": FOODS_JS, "manifest.json": "{}" });
  // Phase 1 (signed in): set up a passphrase + Face ID enrollment normally.
  const profileDir = `/tmp/ib-double-signin-${Date.now()}`;
  const setupDev = await openDevice(app4, { height: 900, wait: 1500, profile: profileDir, inject: fakeWebAuthn() + fakeSupabaseSource({ userId: "user-1" }) });
  const fill = async v => { await setupDev.eval(`document.querySelector(".dialog__input").value = ${JSON.stringify(v)}`); await setupDev.click(".dialog__btn--primary"); await setupDev.sleep(300); };
  await setupDev.tab("settings"); await setupDev.click('[data-seg="data"]'); await setupDev.sleep(300);
  await setupDev.click("#btn-set-pass"); await setupDev.sleep(200);
  await fill("cloud-faceid-pass"); await fill("cloud-faceid-pass"); await setupDev.sleep(500);
  await setupDev.click(".dialog__btn--primary"); await setupDev.sleep(200); // dismiss "now encrypted"
  await setupDev.click("#faceid-toggle"); await setupDev.sleep(500);
  t.check("set up correctly: Face ID enrolled against a cloud-synced lock", !!(await setupDev.eval(`localStorage.getItem("insulinBuddy.durableKey")`)) && !!be.row.lock);
  // Chrome doesn't necessarily flush localStorage to disk before an abrupt process kill --
  // give it a moment, or the next phase (a fresh process reusing this profile dir) can find
  // an empty localStorage despite everything above having genuinely succeeded.
  await setupDev.sleep(1500);
  await setupDev.close();
  await new Promise(r => setTimeout(r, 300));

  // Phase 2 (reopen the SAME profile, but this time NOT auto-signed-in): the natural auto-fire
  // is now a harmless SIGNED_OUT, so the only sign-in events are the two I fire myself, back to
  // back in the same synchronous tick -- a clean, deterministic model of "onAuthStateChange
  // fired twice before the first attempt finished", with no timing race to win.
  const dev3 = await openDevice(app4, { height: 900, wait: 1200, profile: profileDir, inject: fakeWebAuthn() + fakeSupabaseSource({ userId: "user-1", signedIn: false }) });
  await dev3.waitFor(`typeof window.__authCb === "function"`, 4000, 10);
  await dev3.eval(`(() => { const u = { id: "user-1" }; window.__authCb("SIGNED_IN", { user: u }); window.__authCb("SIGNED_IN", { user: u }); return true; })()`);
  await dev3.sleep(1500);
  const getCalls = (await dev3.eval(`window.__webauthnCalls`)).filter(c => c.op === "get").length;
  // If this fails, the first thing to know is whether phase 1's enrollment actually reached disk (an empty
  // profile means nothing could prompt, which is a harness persistence problem, not the app's) -- so say so.
  const stored = await dev3.eval(`({ durableKey: !!localStorage.getItem("insulinBuddy.durableKey"), state: !!localStorage.getItem("insulinBuddy.v2") })`);
  t.check(`two overlapping sign-in events still only prompt Face ID once (got ${getCalls})`, getCalls === 1, JSON.stringify({ calls: await dev3.eval(`window.__webauthnCalls`), enrollmentOnDisk: stored }));
  t.check("the app still ends up correctly unlocked and usable", (await dev3.eval(`document.getElementById("cc-food-list").children.length`)) === 2);
  t.check("no JS errors", (await dev3.eval(`window.__errs.length`)) === 0, JSON.stringify(await dev3.eval(`window.__errs`)));

  await dev3.close(); await app4.close();
  fs.rmSync(profileDir, { recursive: true, force: true }); // this test supplied the profile, so it cleans it up
}

process.exit(t.summary() ? 0 : 1);
