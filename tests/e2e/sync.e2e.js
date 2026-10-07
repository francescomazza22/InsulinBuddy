// Multi-device sync, end to end. Two headless Chrome "devices" share one fake cloud.
import { createBackend, startApp, openDevice, fakeSupabaseSource, makeChecker, seedLocal } from "./harness.js";
import { FOODS_JS, logMeal, localState, localHistoryIds, cloudHistoryIds, skipClock, foreground, meal, stateBlob } from "./helpers.js";

const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker();
const devices = [];
const open = async (app, opts) => { const d = await openDevice(app, { height: 1000, ...opts }); devices.push(d); return d; };
const sb = { userId: "user-1" };

async function scenario(name, fn) {
  t.section(name);
  const be = createBackend();
  const app = await startApp(DIR, be, { "foods_data.js": FOODS_JS });
  try { await fn(be, app); } finally { for (const d of devices.splice(0)) d.close(); await app.close(); }
}
const noErrors = async (dev, label) => t.check(`${label}: no JS errors`, (await dev.eval("window.__errs.length")) === 0 && dev.errors.length === 0, JSON.stringify(await dev.eval("window.__errs")) + dev.errors.join("|"));

// ---------------------------------------------------------------------------
await scenario("REGRESSION: a stale second device no longer overwrites meals logged elsewhere", async (be, app) => {
  const A = await open(app, { inject: fakeSupabaseSource(sb) });
  await A.waitFor(`!!document.getElementById("cc-food-list").children.length`);
  const B = await open(app, { inject: fakeSupabaseSource(sb) });
  t.check("cloud row created on first sign-in", !!be.row);

  await logMeal(A, 0, 100);
  await A.waitFor(`true`); await A.sleep(900);
  const idsA = await localHistoryIds(A);
  t.check("A's meal reached the cloud", cloudHistoryIds(be).length === 1 && cloudHistoryIds(be)[0] === idsA[0]);

  // B never pulled: it is stale. It logs its own meal.
  t.check("B is stale (does not have A's meal yet)", (await localHistoryIds(B)).length === 0);
  await logMeal(B, 1, 100);
  await B.sleep(1500);
  const cloud = cloudHistoryIds(be);
  t.check("cloud now has BOTH meals (old behaviour: only B's)", cloud.length === 2 && cloud.includes(idsA[0]), JSON.stringify(cloud));
  t.check("B's own screen picked up A's meal", (await localHistoryIds(B)).length === 2);
  t.check("B's History list shows 2 meals", (await B.eval(`(async () => { document.querySelector('[data-target="history"]').click(); await new Promise(r => setTimeout(r, 200)); return document.querySelectorAll(".history-entry").length; })()`)) === 2);

  await skipClock(A, 20000);
  await foreground(A);
  t.check("A picks up B's meal when it returns to the foreground", (await localHistoryIds(A)).length === 2, JSON.stringify(await localHistoryIds(A)));
  await noErrors(A, "A"); await noErrors(B, "B");
});

// ---------------------------------------------------------------------------
await scenario("REGRESSION: a delete on one device sticks, even when the other is stale", async (be, app) => {
  const A = await open(app, { inject: fakeSupabaseSource(sb) });
  await logMeal(A, 0, 100);
  await A.sleep(900);
  const B = await open(app, { inject: fakeSupabaseSource(sb) });          // signs in later: gets A's meal from the cloud
  const [mealId] = await localHistoryIds(A);
  t.check("B starts with A's meal", (await localHistoryIds(B)).includes(mealId));

  await A.tab("history");
  // Scoped to the history list: an unscoped query can match the "Recently Logged" chip in the
  // Calculator view instead, which also carries a data-id for the same entry.
  await A.eval(`document.getElementById("history-groups").querySelector('[data-id="${mealId}"]').click()`);  // expand the row
  await A.click(`[data-del="${mealId}"]`);
  await A.sleep(900);
  t.check("delete reached the cloud", !cloudHistoryIds(be).includes(mealId));
  t.check("a deletion marker was recorded", !!(be.row.data.deleted && be.row.data.deleted.history[mealId]));

  // B is stale and still shows the meal. It saves something unrelated.
  t.check("B is stale (still has the deleted meal)", (await localHistoryIds(B)).includes(mealId));
  await logMeal(B, 1, 100);
  await B.sleep(1500);
  t.check("the deleted meal did NOT come back in the cloud", !cloudHistoryIds(be).includes(mealId), JSON.stringify(cloudHistoryIds(be)));
  t.check("and was dropped from B's screen too", !(await localHistoryIds(B)).includes(mealId));
  t.check("B's new meal survived", cloudHistoryIds(be).length === 1);
});

// ---------------------------------------------------------------------------
await scenario("Offline edits on one device merge with what another device did meanwhile", async (be, app) => {
  const A = await open(app, { inject: fakeSupabaseSource(sb) });
  const B = await open(app, { inject: fakeSupabaseSource(sb) });
  be.mode.db = "offline";
  await logMeal(A, 0, 100);
  await A.sleep(1200);
  t.check("A saved locally and is waiting to sync", (await A.eval(`localStorage.getItem("insulinBuddy.pendingSync")`)) === "1");
  be.mode.db = "ok";
  await logMeal(B, 1, 100);                                                // B is online and syncs normally
  await B.sleep(1300);
  t.check("cloud has B's meal only so far", cloudHistoryIds(be).length === 1);
  await skipClock(A, 20000);
  await A.eval(`window.dispatchEvent(new Event("online"))`);
  await A.sleep(1800);
  t.check("A's offline meal merged in: cloud has both", cloudHistoryIds(be).length === 2, JSON.stringify(cloudHistoryIds(be)));
  t.check("pending flag cleared", (await A.eval(`localStorage.getItem("insulinBuddy.pendingSync")`)) === null);
  t.check("A now shows B's meal too", (await localHistoryIds(A)).length === 2);
});

// ---------------------------------------------------------------------------
await scenario("Upgrade path: an old (unversioned) local copy defers to the cloud, unless it has unsynced edits", async (be, app) => {
  const cloudMeal = meal("cloud-1", Date.now() - 3600_000);
  be.row = { user_id: "user-1", data: stateBlob({ history: [cloudMeal] }), updated_at: be.stamp() };
  // legacy local copy: no schemaVersion, holds a meal the cloud doesn't have (deleted elsewhere pre-upgrade)
  const stale = stateBlob({ history: [meal("stale-1", Date.now() - 7200_000)], schemaVersion: 1 });
  const A = await open(app, { inject: seedLocal(stale) + fakeSupabaseSource(sb) });
  t.check("cloud copy wins on the first run after upgrading (nothing resurrected)", JSON.stringify(await localHistoryIds(A)) === JSON.stringify(["cloud-1"]), JSON.stringify(await localHistoryIds(A)));
  t.check("local copy is now versioned", (await localState(A)).schemaVersion === 2);
  A.close();

  // same legacy copy, but flagged as having unsynced offline edits: those must NOT be thrown away
  const B = await open(app, { inject: seedLocal(stale) + `localStorage.setItem("insulinBuddy.pendingSync","1");` + fakeSupabaseSource(sb) });
  await B.sleep(1200);
  const both = await localHistoryIds(B);
  t.check("unsynced offline edits are preserved and merged", both.includes("stale-1") && both.includes("cloud-1"), JSON.stringify(both));
  t.check("and uploaded", cloudHistoryIds(be).includes("stale-1"));
});

// ---------------------------------------------------------------------------
await scenario("A brand-new device adopts the cloud copy; a first sign-in keeps existing local data", async (be, app) => {
  be.row = { user_id: "user-1", data: stateBlob({ history: [meal("c1", Date.now() - 1000), meal("c2", Date.now() - 2000)], library: [{ id: "s1", name: "Pane comune", category: "grains", carbs: 47, kcal: 300, protein: null, fat: null, salt: null, gi: 75, notes: "", favorite: false, usageCount: 9 }] }), updated_at: be.stamp() };
  const fresh = await open(app, { inject: fakeSupabaseSource(sb) });
  t.check("fresh device shows the cloud's meals", (await localHistoryIds(fresh)).length === 2);
  t.check("and the cloud's edited food (47 g, not the 65 g seed)", (await localState(fresh)).library.find(f => f.id === "s1").carbs === 47);
  fresh.close();

  // no cloud row yet, but this device already has data (used offline before signing up)
  be.row = null;
  const existing = await open(app, { inject: seedLocal(stateBlob({ history: [meal("mine-1", Date.now() - 5000)], schemaVersion: 1 })) + fakeSupabaseSource(sb) });
  await existing.sleep(1000);
  t.check("existing local meal is kept (old behaviour replaced it with defaults)", (await localHistoryIds(existing)).includes("mine-1"));
  t.check("and becomes the cloud copy", cloudHistoryIds(be).includes("mine-1"));
});

// ---------------------------------------------------------------------------
await scenario("Efficiency: an unchanged cloud row is not re-downloaded on every save", async (be, app) => {
  const A = await open(app, { inject: fakeSupabaseSource(sb) });
  await logMeal(A, 0, 100); await A.sleep(1000);
  be.log.length = 0;
  await logMeal(A, 1, 100); await A.sleep(1200);
  const selects = be.log.filter(l => l.kind === "db" && l.op === "select");
  const full = selects.filter(l => String(l.cols).includes("data"));
  t.check("saving checked only updated_at (cheap)", selects.length >= 1 && full.length === 0, JSON.stringify(selects.map(s => s.cols)));
  t.check("and uploaded once", be.log.filter(l => l.op === "upsert").length === 1);
});

// ---------------------------------------------------------------------------
await scenario("Backups: a snapshot is taken before a merge changes anything, and can be restored", async (be, app) => {
  const A = await open(app, { inject: fakeSupabaseSource(sb) });
  await logMeal(A, 0, 100); await A.sleep(1000);
  const B = await open(app, { inject: fakeSupabaseSource(sb) });
  await logMeal(B, 1, 100); await B.sleep(1400);
  await skipClock(A, 20000); await foreground(A);
  const snaps = await A.eval(`(async () => { const db = await new Promise(r => { const q = indexedDB.open("insulinBuddyBackups", 1); q.onsuccess = () => r(q.result); }); const rows = await new Promise(r => { const q = db.transaction("snapshots").objectStore("snapshots").getAll(); q.onsuccess = () => r(q.result); }); return rows.map(x => ({ reason: x.reason, meals: x.meals })); })()`);
  t.check("a 'before-merge' snapshot exists (taken with the pre-merge data)", snaps.some(s => s.reason === "before-merge" && s.meals === 1), JSON.stringify(snaps));
  t.check("A now has both meals", (await localHistoryIds(A)).length === 2);
  await noErrors(A, "A");
});

// ---------------------------------------------------------------------------
await scenario("No passphrase ever set: the cloud row stays a plain, unencrypted object", async (be, app) => {
  const A = await open(app, { inject: fakeSupabaseSource(sb) });
  await logMeal(A, 0, 100); await A.sleep(900);
  t.check("cloud data is a plain state object, not ciphertext", be.row.data.schemaVersion === 2 && be.row.data.history.length === 1, JSON.stringify(be.row.data).slice(0, 120));
  t.check("no lock config was sent", be.row.lock == null);
});

// ---------------------------------------------------------------------------
await scenario("REGRESSION: setting a passphrase encrypts what reaches Supabase, and a second device is correctly prompted for it", async (be, app) => {
  const A = await open(app, { inject: fakeSupabaseSource(sb) });
  await logMeal(A, 0, 100); await A.sleep(800);

  // Set a passphrase on A (via the Settings UI, same as a real user would).
  await A.tab("settings"); await A.click('[data-seg="data"]'); await A.sleep(200);
  await A.click("#btn-set-pass"); await A.sleep(150);
  const fillDialog = async (dev, value) => { await dev.eval(`document.querySelector(".dialog__input").value = ${JSON.stringify(value)}`); await dev.click(".dialog__btn--primary"); await dev.sleep(150); };
  await fillDialog(A, "correct horse battery staple");
  await fillDialog(A, "correct horse battery staple"); // confirm
  await A.sleep(600);

  t.check("cloud data is now ciphertext (has iv+data, not a state shape)", typeof be.row.data.iv === "string" && typeof be.row.data.data === "string" && be.row.data.schemaVersion === undefined, JSON.stringify(be.row.data));
  t.check("a lock config (salt+verifier) was sent, but nothing resembling the passphrase itself", !!be.row.lock && !!be.row.lock.salt && JSON.stringify(be.row.lock).includes("correct horse") === false);

  // A second, brand-new device signs into the SAME account.
  const B = await openDevice(app, { height: 1000, inject: fakeSupabaseSource(sb), wait: 900 });
  devices.push(B);
  t.check("device B is stopped at the lock screen before seeing any data", await B.eval(`!document.getElementById("lock-screen").hidden`));
  t.check("device B's calculator hasn't loaded yet", await B.eval(`document.getElementById("loading-screen").hidden === false || document.getElementById("lock-screen").hidden === false`));

  // Wrong passphrase: rejected, stays on the lock screen.
  await B.eval(`document.getElementById("lock-passphrase").value = "wrong guess"`);
  await B.eval(`document.getElementById("lock-form").dispatchEvent(new Event("submit", {cancelable:true}))`);
  await B.sleep(300);
  t.check("wrong passphrase shows an error and does not proceed", !(await B.eval(`document.getElementById("lock-error").hidden`)) && !(await B.eval(`document.getElementById("lock-screen").hidden`)));

  // Correct passphrase: unlocks, then completes sign-in and decrypts A's data.
  await B.eval(`document.getElementById("lock-passphrase").value = "correct horse battery staple"`);
  await B.eval(`document.getElementById("lock-form").dispatchEvent(new Event("submit", {cancelable:true}))`);
  await B.sleep(700);
  t.check("device B's lock screen closed", await B.eval(`document.getElementById("lock-screen").hidden`));
  // B's local storage is now ciphertext, so we can't just JSON.parse it like localHistoryIds
  // does -- check the actual decrypted in-memory state via the rendered History tab instead.
  await B.tab("history"); await B.sleep(200);
  t.check("device B correctly decrypted and merged A's meal", (await B.eval(`document.querySelectorAll(".history-entry").length`)) === 1);
  const rawLocalB = await B.eval(`localStorage.getItem("insulinBuddy.v2")`);
  t.check("device B's own local storage is now encrypted too (ciphertext, not readable JSON)", !rawLocalB.includes('"history"'), rawLocalB.slice(0, 100));
  t.check("no JS errors on device B", (await B.eval(`window.__errs.length`)) === 0, JSON.stringify(await B.eval(`window.__errs`)));
});

// ---------------------------------------------------------------------------
await scenario("Removing the passphrase pushes plaintext + lock:null immediately, so a later device isn't prompted", async (be, app) => {
  const A = await open(app, { inject: fakeSupabaseSource(sb) });
  await logMeal(A, 0, 100); await A.sleep(700);
  const fillDialog = async (dev, value) => { await dev.eval(`document.querySelector(".dialog__input").value = ${JSON.stringify(value)}`); await dev.click(".dialog__btn--primary"); await dev.sleep(150); };
  await A.tab("settings"); await A.click('[data-seg="data"]'); await A.sleep(200);
  await A.click("#btn-set-pass"); await A.sleep(150);
  await fillDialog(A, "temporary-pass"); await fillDialog(A, "temporary-pass"); await A.sleep(600);
  t.check("cloud is encrypted after setting", typeof be.row.data.iv === "string");
  await A.click(".dialog__btn--primary"); await A.sleep(150); // dismiss the "now encrypted" confirmation alert

  await A.click("#btn-remove-pass"); await A.sleep(150);
  await fillDialog(A, "temporary-pass"); await A.sleep(700);
  t.check("cloud data is plaintext again after removing", be.row.data.schemaVersion === 2, JSON.stringify(be.row.data).slice(0, 120));
  t.check("cloud lock config was cleared", be.row.lock == null);

  const C = await openDevice(app, { height: 1000, inject: fakeSupabaseSource(sb), wait: 900 });
  devices.push(C);
  t.check("a fresh device afterward is NOT prompted for a passphrase", await C.eval(`document.getElementById("lock-screen").hidden`));
  t.check("and sees the meal normally", (await localHistoryIds(C)).length === 1);
});

// ---------------------------------------------------------------------------
await scenario("Forgot password: sends a reset email without revealing whether the account exists", async (be, app) => {
  const A = await openDevice(app, { height: 1000, inject: fakeSupabaseSource({ ...sb, signedIn: false }), wait: 700 });
  devices.push(A);
  await A.tab("settings"); await A.sleep(150);
  await A.eval(`document.getElementById("acct-email").value = "frenkmazza@gmail.com"`);
  await A.click("#btn-forgot-password"); await A.sleep(300);
  const calls = await A.eval(`window.__resetCalls`);
  t.check("resetPasswordForEmail was called with the typed email", calls && calls[0].email === "frenkmazza@gmail.com", JSON.stringify(calls));
  t.check("a redirect back to the app itself was specified", calls && /index\.html|\/$/.test(calls[0].redirectTo || ""), JSON.stringify(calls));
  const msg = await A.eval(`document.querySelector(".dialog__message").textContent`);
  t.check("the confirmation doesn't confirm the account exists (says 'if an account exists')", /if an account exists/i.test(msg), msg);
  await A.click(".dialog__btn--primary"); await A.sleep(150);
  t.check("no JS errors", (await A.eval(`window.__errs.length`)) === 0, JSON.stringify(await A.eval(`window.__errs`)));
});

await scenario("Forgot password: prompts for an email if the field was left empty", async (be, app) => {
  const A = await openDevice(app, { height: 1000, inject: fakeSupabaseSource({ ...sb, signedIn: false }), wait: 700 });
  devices.push(A);
  await A.tab("settings"); await A.sleep(150);
  await A.click("#btn-forgot-password"); await A.sleep(200);
  t.check("a dialog asks for the email", !!(await A.eval(`document.querySelector(".dialog__input")`)));
  await A.eval(`document.querySelector(".dialog__input").value = "typed-here@example.com"`);
  await A.click(".dialog__btn--primary"); await A.sleep(300);
  const calls = await A.eval(`window.__resetCalls`);
  t.check("used the email typed into the prompt", calls && calls[0].email === "typed-here@example.com", JSON.stringify(calls));
});

// ---------------------------------------------------------------------------
await scenario("REGRESSION: clicking the emailed reset link prompts for a new password, then signs in normally", async (be, app) => {
  be.row = { user_id: "user-1", data: stateBlob({ history: [meal("existing-1", Date.now() - 1000)] }), updated_at: be.stamp() };
  const A = await openDevice(app, { height: 1000, inject: fakeSupabaseSource({ ...sb, signedIn: false }), wait: 700 });
  devices.push(A);
  const fillDialog = async value => { await A.eval(`document.querySelector(".dialog__input").value = ${JSON.stringify(value)}`); await A.click(".dialog__btn--primary"); await A.sleep(200); };

  // Simulate what real supabase-js would do after parsing the emailed link's URL fragment.
  // Don't await this: it resolves the app's onAuthStateChange callback, which itself awaits the
  // dialog this triggers -- awaiting it here before ever touching that dialog would deadlock.
  const trigger = A.eval(`window.__authCb("PASSWORD_RECOVERY", { user: { id: "user-1", email: "frenkmazza@gmail.com" } })`);
  await A.sleep(200);
  t.check("a dialog asks for a new password", !!(await A.eval(`document.querySelector(".dialog__input")`)));
  await fillDialog("a-brand-new-password");
  await fillDialog("a-brand-new-password"); // confirm
  await A.sleep(200);
  const calls = await A.eval(`window.__updateUserCalls`);
  t.check("updateUser was called with the new password", calls && calls[0].password === "a-brand-new-password", JSON.stringify(calls));
  await A.click(".dialog__btn--primary"); await A.sleep(600); // dismiss "Password updated" and let sign-in proceed
  await trigger;
  t.check("the app proceeded into the normal signed-in flow with this session", (await localHistoryIds(A)).includes("existing-1"), JSON.stringify(await localHistoryIds(A)));
  t.check("no JS errors", (await A.eval(`window.__errs.length`)) === 0, JSON.stringify(await A.eval(`window.__errs`)));
});

await scenario("Mismatched new passwords are rejected without calling updateUser", async (be, app) => {
  const A = await openDevice(app, { height: 1000, inject: fakeSupabaseSource({ ...sb, signedIn: false }), wait: 700 });
  devices.push(A);
  const fillDialog = async value => { await A.eval(`document.querySelector(".dialog__input").value = ${JSON.stringify(value)}`); await A.click(".dialog__btn--primary"); await A.sleep(200); };
  const trigger = A.eval(`window.__authCb("PASSWORD_RECOVERY", { user: { id: "user-1", email: "frenkmazza@gmail.com" } })`);
  await A.sleep(200);
  await fillDialog("first-password");
  await fillDialog("a-different-password");
  await A.sleep(200);
  t.check("updateUser was never called", (await A.eval(`window.__updateUserCalls`)) == null);
  t.check("an explanatory alert is shown", /didn't match/i.test(await A.eval(`document.querySelector(".dialog__message").textContent`)));
  await A.click(".dialog__btn--primary"); await A.sleep(200); // dismiss the alert so the callback (and thus `trigger`) can finish
  await trigger;
});

// ---------------------------------------------------------------------------
await scenario("REGRESSION: \"Recently Logged\" shows up on first boot for a signed-in account, not just after some other action", async (be, app) => {
  const now = Date.now();
  be.row = { user_id: "user-1", data: stateBlob({ history: [
    { id: "h1", ts: now, mealType: "breakfast", noInsulin: false, totalCarbs: 50, mealDose: 4, correctionDose: 0, items: [{ name: "Toast" }] }
  ] }), updated_at: be.stamp() };
  const A = await open(app, { inject: fakeSupabaseSource(sb), wait: 1200 });
  // This must be true on the very first render after boot -- finishInit(), the function that
  // actually completes a signed-in boot, is a different code path than renderEverything() and
  // was missing this call entirely, so this asserts against that specific gap recurring.
  t.check("header visible immediately on boot, no other action needed", !(await A.eval(`document.getElementById("recent-meals-header").hidden`)));
  t.check("shows the seeded meal", /Toast/.test(await A.text("#recent-meals-row")));
  await noErrors(A, "device");
});

await scenario("The \"Show Recently Logged\" setting toggle actually hides and restores the row", async (be, app) => {
  const now = Date.now();
  be.row = { user_id: "user-1", data: stateBlob({ history: [
    { id: "h1", ts: now, mealType: "breakfast", noInsulin: false, totalCarbs: 50, mealDose: 4, correctionDose: 0, items: [{ name: "Toast" }] }
  ] }), updated_at: be.stamp() };
  const A = await open(app, { inject: fakeSupabaseSource(sb), wait: 1200 });
  t.check("on by default", !(await A.eval(`document.getElementById("recent-meals-header").hidden`)));

  await A.tab("settings"); await A.click('[data-seg="general"]'); await A.sleep(200);
  t.check("toggle reflects the on state", await A.eval(`document.getElementById("show-recent-meals-toggle").checked`));
  await A.click("#show-recent-meals-toggle"); await A.sleep(200);
  await A.tab("calculator"); await A.sleep(150);
  t.check("row hidden immediately after turning it off", await A.eval(`document.getElementById("recent-meals-header").hidden`));

  await A.go("index.html", 1200); // persists across a reload, not just in-memory for this session
  t.check("stays off after a reload", await A.eval(`document.getElementById("recent-meals-header").hidden`));

  await A.tab("settings"); await A.click('[data-seg="general"]'); await A.sleep(200);
  await A.click("#show-recent-meals-toggle"); await A.sleep(200);
  await A.tab("calculator"); await A.sleep(150);
  t.check("turning it back on restores the row", !(await A.eval(`document.getElementById("recent-meals-header").hidden`)));
  await noErrors(A, "device");
});

// ---------------------------------------------------------------------------
// Basal doses ride the same sync machinery as meals (same store, ids, updatedAt, tombstones). That's the claim
// that made it safe to reuse; this proves it across two real devices rather than assuming it.
await scenario("Basal: a dose logged on one device reaches the other intact, shows as Basal there, and a delete sticks", async (be, app) => {
  const A = await open(app, { inject: fakeSupabaseSource(sb) });
  await A.waitFor(`!!document.getElementById("cc-food-list").children.length`);
  const B = await open(app, { inject: fakeSupabaseSource(sb) });
  await B.waitFor(`!!document.getElementById("cc-food-list").children.length`);

  const when = new Date(); when.setDate(when.getDate() - 1); when.setHours(8, 0, 0, 0);
  const z = n => String(n).padStart(2, "0");
  const local = `${when.getFullYear()}-${z(when.getMonth() + 1)}-${z(when.getDate())}T${z(when.getHours())}:${z(when.getMinutes())}`;
  await A.tab("history"); await A.sleep(150);
  await A.click("#btn-log-basal"); await A.sleep(250);
  await A.eval(`(() => { const t = document.getElementById("basal-time"); t.value = ${JSON.stringify(local)}; t.dispatchEvent(new Event("change", { bubbles: true })); const u = document.getElementById("basal-units"); u.value = "14"; u.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await A.click("#basal-save"); await A.sleep(1300);

  const inCloud = () => (be.row.data.history || []).find(e => e.entryType === "basal");
  const c = inCloud() || {};
  t.check("the dose reached the cloud", cloudHistoryIds(be).length === 1 && c.entryType === "basal");
  t.check("...with its units in basalDose and nothing in the bolus fields", c.basalDose === 14 && c.mealDose === 0 && c.correctionDose === 0 && c.totalCarbs === 0, JSON.stringify(c));

  await skipClock(B, 20000); await foreground(B); await B.sleep(600);
  const onB = (await localState(B)).history.find(e => e.entryType === "basal") || {};
  t.check("device B received it", onB.id === c.id, JSON.stringify(onB));
  t.check("every basal field survived the round trip", onB.basalDose === 14 && onB.basalSlot === "am" && onB.periodName === "morning" && onB.ts === c.ts && onB.mealDose === 0 && onB.correctionDose === 0);
  await B.tab("history"); await B.sleep(250);
  const rowB = await B.text("#history-groups .history-entry--basal");
  t.check("on B it renders as a Basal row with the dose", /Basal/.test(rowB) && /14u/.test(rowB) && /Morning/.test(rowB), rowB);
  t.check("on B it isn't counted as a meal", (await B.text("#hist-count-pill")) === "0 meals");

  // B deletes it; A hasn't pulled, so this also checks the tombstone beats A's stale copy
  await B.eval(`document.getElementById("history-groups").querySelector('[data-id="${c.id}"]').click()`); await B.sleep(100);
  await B.click(`[data-del="${c.id}"]`); await B.sleep(1300);
  t.check("the delete reached the cloud", cloudHistoryIds(be).length === 0, JSON.stringify(cloudHistoryIds(be)));
  await skipClock(A, 20000); await foreground(A); await A.sleep(700);
  t.check("A drops it too, and doesn't resurrect it", (await localState(A)).history.filter(e => e.entryType === "basal").length === 0 && cloudHistoryIds(be).length === 0);
  await noErrors(A, "A"); await noErrors(B, "B");
});

process.exit(t.summary() ? 0 : 1);
