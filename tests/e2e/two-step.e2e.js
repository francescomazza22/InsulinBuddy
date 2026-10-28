// Two-step sign-in (TOTP) and "Sign out other devices" (2.70.0).
// The fake Supabase plays the database rule from supabase/mfa.sql: once the account has a verified authenticator, a session
// that hasn't given a code sees no rows and can't write. The app must ask for the code BEFORE it touches the cloud copy, so an
// unverified session never mistakes "no rows" for "no data yet" (and never uploads over the cloud copy).
// TS_WIDTH (default 390), TS_DARK=1, SHOTS=<dir> for screenshots.
import { createBackend, startApp, openDevice, fakeSupabaseSource, makeChecker } from "./harness.js";
import { FOODS_JS, stateBlob, meal } from "./helpers.js";

const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SHOTS = process.env.SHOTS || "";
const W = Number(process.env.TS_WIDTH || 390);
const dark = process.env.TS_DARK === "1";
const tag = `${W}${dark ? "-dark" : ""}`;
const be = createBackend();
const app = await startApp(DIR, be, { "foods_data.js": FOODS_JS });
const CLOUD_MEAL = meal("cloud-meal-1", Date.now() - 3600_000);
const freshRow = () => ({ user_id: "user-1", data: stateBlob({ history: [CLOUD_MEAL] }), updated_at: be.stamp() });
const open = (mfa, extra = {}) => openDevice(app, { width: W, height: 900, mobile: W < 1000, dark, inject: fakeSupabaseSource({ userId: "user-1", mfa, ...extra }), wait: 1500 });
const visible = (dev, id) => dev.eval(`(() => { const e = document.getElementById(${JSON.stringify(id)}); return !!e && !e.hidden && e.getBoundingClientRect().height > 0; })()`);
const typeCode = async (dev, sel, code) => { await dev.eval(`(() => { const i = document.querySelector(${JSON.stringify(sel)}); i.value = ${JSON.stringify(code)}; i.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`); await sleep(400); };
const M = dev => dev.eval(`JSON.parse(JSON.stringify(window.__mfa))`);
const openSync = async dev => { await dev.tab("settings"); await dev.click('#settings-segmented [data-seg="sync"]'); await sleep(400); };
const dialogClick = async (dev, which) => { await dev.waitFor(`!!document.querySelector(".dialog-backdrop .dialog__btn--${which}")`, 4000); await dev.click(`.dialog-backdrop .dialog__btn--${which}`); await sleep(400); };
const historyHasCloudMeal = dev => dev.eval(`JSON.parse(localStorage.getItem("insulinBuddy.v2") || "{}").history?.some(h => h.id === "cloud-meal-1") || false`);
const noErrors = async dev => (await dev.eval("window.__errs.length")) === 0 && dev.errors.length === 0;

// ---------------------------------------------------------------- 1. Turning it on
t.section(`TURN ON (${tag}): no factor yet, set it up from Settings > Sync`);
be.row = freshRow();
let dev = await open(null);
t.check("no code screen for an account without two-step sign-in", !(await visible(dev, "mfa-screen")));
await openSync(dev);
t.check("the Sign-in security card shows when signed in", await visible(dev, "security-card"));
await dev.waitFor(`!!document.getElementById("btn-mfa-on")`, 4000);
t.check("it says two-step sign-in is off", /is off/.test(await dev.text("#security-section")));
t.check("a Sign out other devices button is there", await visible(dev, "btn-sign-out-others"));
if (SHOTS) await dev.shot(`${SHOTS}/two-step-card-off-${tag}.png`);
await dev.click("#btn-mfa-on");
await dev.waitFor(`!!document.querySelector(".totp-sheet")`, 4000);
const sheet = await dev.eval(`(() => {
  const img = document.getElementById("totp-qr"), a = document.getElementById("totp-open"), k = document.getElementById("totp-secret");
  return { qr: !!img && img.complete && img.naturalWidth > 0, link: a ? a.getAttribute("href") : "", key: k ? k.textContent : "",
    codeField: !!document.getElementById("totp-code"), noPreselect: document.activeElement !== document.getElementById("totp-code") || document.getElementById("totp-code").selectionStart === document.getElementById("totp-code").value.length };
})()`);
t.check("the set-up sheet shows a QR code that loads (allowed by the page's security policy)", sheet.qr);
t.check("it has a one-tap link for an authenticator on this device", /^otpauth:\/\/totp\//.test(sheet.link), sheet.link);
t.check("it shows the key in groups of four", sheet.key === "JBSW Y3DP EHPK 3PXP JBSW Y3DP", sheet.key);
t.check("it asks for a code", sheet.codeField);
let m = await M(dev);
t.check("one unverified factor exists while setting up", m.factors.length === 1 && m.factors[0].status === "unverified");
if (SHOTS) await dev.shot(`${SHOTS}/two-step-setup-${tag}.png`);
await typeCode(dev, "#totp-code", "000000");
t.check("a wrong code shows an error and keeps the sheet open", (await visible(dev, "totp-error")) && /didn't work/.test(await dev.text("#totp-error")) && !!(await dev.eval(`!!document.querySelector(".totp-sheet")`)));
m = await M(dev);
t.check("a wrong code doesn't turn anything on", m.factors.every(f => f.status === "unverified") && m.aal === "aal1");
await typeCode(dev, "#totp-code", "123 456");
t.check("the right code (typed with a space) closes the sheet", !(await dev.eval(`!!document.querySelector(".totp-sheet")`)));
m = await M(dev);
t.check("the factor is verified and this session passed the check", m.factors.length === 1 && m.factors[0].status === "verified" && m.aal === "aal2");
t.check("it offers to sign out other devices too", /Sign out other devices too/.test(await dev.text(".dialog-backdrop")));
await dialogClick(dev, "primary");
m = await M(dev);
t.check("accepting signs out other devices (scope 'others' only)", m.signOutOthers === 1);
t.check("this device stays signed in", await dev.eval(`window.__signedIn === true`));
await dev.waitFor(`/is on/.test(document.getElementById("security-section").textContent)`, 4000);
t.check("the card now says two-step sign-in is on", /is on/.test(await dev.text("#security-section")));
t.check("the code-accepted event didn't start a second load (no blocked queries)", !(m.blockedQueries > 0), String(m.blockedQueries));
t.check("the cloud copy still has its meal", be.row.data.history.some(h => h.id === "cloud-meal-1"));
if (SHOTS) await dev.shot(`${SHOTS}/two-step-card-on-${tag}.png`);
t.check("no JS errors (turn on)", await noErrors(dev), (await dev.eval("window.__errs")).join(" | "));
dev.close();

// ---------------------------------------------------------------- 2. Cancelling a set-up
t.section(`CANCEL (${tag}): closing the set-up sheet leaves nothing behind`);
be.row = freshRow();
dev = await open(null);
await openSync(dev);
await dev.waitFor(`!!document.getElementById("btn-mfa-on")`, 4000);
await dev.click("#btn-mfa-on");
await dev.waitFor(`!!document.querySelector(".totp-sheet")`, 4000);
await dev.click("#totp-cancel"); await sleep(500);
m = await M(dev);
t.check("the half-finished factor is removed", m.factors.length === 0, JSON.stringify(m.factors));
t.check("still off", /is off/.test(await dev.text("#security-section")));
t.check("the page isn't left pinned by the sheet", !(await dev.eval(`document.body.classList.contains("sheet-open")`)));
t.check("no JS errors (cancel)", await noErrors(dev), (await dev.eval("window.__errs")).join(" | "));
dev.close();

// ---------------------------------------------------------------- 3. A device that owes a code
t.section(`ASK FIRST (${tag}): a device signed in before two-step sign-in was on is asked for the code before anything loads`);
be.row = freshRow();
const rowBefore = JSON.stringify(be.row);
dev = await open({ verified: true, aal: "aal1" });
await dev.waitFor(`!document.getElementById("mfa-screen").hidden`, 6000);
t.check("the code screen shows", await visible(dev, "mfa-screen"));
t.check("the loading screen isn't covering it", !(await visible(dev, "loading-screen")));
t.check("the code field asks for a one-time code with a number pad", await dev.eval(`(() => { const i = document.getElementById("mfa-code"); return i.inputMode === "numeric" && i.autocomplete === "one-time-code"; })()`));
if (SHOTS) await dev.shot(`${SHOTS}/two-step-code-screen-${tag}.png`);
await sleep(4800);   // longer than the 4 s offline safety net
t.check("after 5 s the code screen is still up (the offline safety net doesn't take over)", await visible(dev, "mfa-screen"));
m = await M(dev);
t.check("nothing was read or written while waiting for the code", !(m.blockedQueries > 0), String(m.blockedQueries));
t.check("the cloud copy is untouched", JSON.stringify(be.row) === rowBefore);
await typeCode(dev, "#mfa-code", "999999");
t.check("a wrong code shows an error and keeps the screen up", (await visible(dev, "mfa-screen")) && /didn't work/.test(await dev.text("#mfa-error")));
await typeCode(dev, "#mfa-code", "12345");
t.check("five digits don't submit on their own", (await M(dev)).verifyCalls === 1);
await dev.eval(`document.getElementById("mfa-form").dispatchEvent(new Event("submit", { cancelable: true }))`); await sleep(300);
t.check("submitting five digits asks for six without calling the server", /6-digit/.test(await dev.text("#mfa-error")) && (await M(dev)).verifyCalls === 1);
await typeCode(dev, "#mfa-code", "123456");
await dev.waitFor(`document.getElementById("mfa-screen").hidden`, 4000);
await dev.waitFor(`(() => { try { return JSON.parse(localStorage.getItem("insulinBuddy.v2")).history.some(h => h.id === "cloud-meal-1"); } catch (e) { return false; } })()`, 6000);
t.check("the right code opens the app", !(await visible(dev, "mfa-screen")));
t.check("the cloud meal loaded after the code", await historyHasCloudMeal(dev));
m = await M(dev);
t.check("still no blocked queries (it never loaded before the code)", !(m.blockedQueries > 0), String(m.blockedQueries));
t.check("the cloud copy still has its meal", be.row.data.history.some(h => h.id === "cloud-meal-1"));
t.check("no JS errors (ask first)", await noErrors(dev), (await dev.eval("window.__errs")).join(" | "));
dev.close();

// ---------------------------------------------------------------- 4. Sign out instead
t.section(`SIGN OUT INSTEAD (${tag})`);
be.row = freshRow();
const row4 = JSON.stringify(be.row);
dev = await open({ verified: true, aal: "aal1" });
await dev.waitFor(`!document.getElementById("mfa-screen").hidden`, 6000);
await dev.click("#mfa-sign-out"); await sleep(800);
t.check("the code screen closes", !(await visible(dev, "mfa-screen")));
t.check("the device is signed out", await dev.eval(`window.__signedIn === false`));
await openSync(dev);
t.check("Settings shows the sign-in form", !!(await dev.eval(`!!document.getElementById("acct-signin-form")`)));
t.check("the security card is hidden when signed out", !(await visible(dev, "security-card")));
t.check("the cloud copy is untouched", JSON.stringify(be.row) === row4);
t.check("no JS errors (sign out instead)", await noErrors(dev), (await dev.eval("window.__errs")).join(" | "));
dev.close();

// ---------------------------------------------------------------- 5. Password sign-in, then the code
t.section(`SIGN IN (${tag}): password, then code, then the data`);
be.row = freshRow();
dev = await open({ verified: true }, { signedIn: false });
await openSync(dev);
await dev.eval(`(() => { document.getElementById("acct-email").value = "test@example.com"; document.getElementById("acct-password").value = "pw-123456"; document.getElementById("acct-signin-form").dispatchEvent(new Event("submit", { cancelable: true })); return true; })()`);
await dev.waitFor(`!document.getElementById("mfa-screen").hidden`, 6000);
t.check("after the password the code screen shows", await visible(dev, "mfa-screen"));
await typeCode(dev, "#mfa-code", "123456");
await dev.waitFor(`(() => { try { return JSON.parse(localStorage.getItem("insulinBuddy.v2")).history.some(h => h.id === "cloud-meal-1"); } catch (e) { return false; } })()`, 6000);
t.check("then the cloud data loads", await historyHasCloudMeal(dev));
m = await M(dev);
t.check("no blocked queries during sign-in", !(m.blockedQueries > 0), String(m.blockedQueries));
t.check("no JS errors (sign in)", await noErrors(dev), (await dev.eval("window.__errs")).join(" | "));
dev.close();

// ---------------------------------------------------------------- 6. Turning it off, and signing out others
t.section(`TURN OFF / SIGN OUT OTHERS (${tag})`);
be.row = freshRow();
dev = await open({ verified: true, aal: "aal2" });
t.check("a device that already passed the check isn't asked again", !(await visible(dev, "mfa-screen")));
await openSync(dev);
await dev.waitFor(`/is on/.test(document.getElementById("security-section").textContent)`, 4000);
t.check("the card shows when it was turned on", /since 1 Oct 2026|since Oct 1, 2026/.test(await dev.text("#security-section")), await dev.text("#security-section .security-status"));
await dev.click("#btn-sign-out-others");
await dialogClick(dev, "ghost");
t.check("cancelling the confirmation signs nobody out", (await M(dev)).signOutOthers === 0);
await dev.click("#btn-sign-out-others");
await dialogClick(dev, "primary");
t.check("confirming signs out the other devices", (await M(dev)).signOutOthers === 1);
await dev.waitFor(`!!document.querySelector("#security-section .security-note")`, 4000);
t.check("the card says so", /Other devices signed out/.test(await dev.text("#security-section .security-note")));
t.check("this device stays signed in", await dev.eval(`window.__signedIn === true`));
await dev.click("#btn-mfa-off");
await dialogClick(dev, "danger");
await dev.waitFor(`/is off/.test(document.getElementById("security-section").textContent)`, 4000);
t.check("turning off removes the factor", (await M(dev)).factors.length === 0);
t.check("the card says two-step sign-in is off", /Two-step sign-in is off\./.test(await dev.text("#security-section")));
t.check("no JS errors (turn off)", await noErrors(dev), (await dev.eval("window.__errs")).join(" | "));
dev.close();

await app.close();
process.exit(t.summary() ? 0 : 1);
