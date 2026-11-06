// First sign-in on a new device (2.87.0). On 6 Nov 2026 a new device signed in with password + code and replaced the
// account's real settings (ratios, target, max dose, usual basal, Nightscout link) with its factory values, because its
// first save had stamped those defaults as "just edited". A new device must take the account's settings, Nightscout
// included, and leave the cloud copy's settings alone.
// FS_WIDTH (default 390), FS_DARK=1, SHOTS=<dir>.
import { createBackend, startApp, openDevice, fakeSupabaseSource, makeChecker } from "./harness.js";
import { FOODS_JS, stateBlob, meal } from "./helpers.js";

const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SHOTS = process.env.SHOTS || "";
const W = Number(process.env.FS_WIDTH || 390);
const dark = process.env.FS_DARK === "1";
const tag = `${W}${dark ? "-dark" : ""}`;
const be = createBackend();
const app = await startApp(DIR, be, { "foods_data.js": FOODS_JS });

const NS = "https://mysite.ns.example.com?token=secret-123";
const ACCOUNT = {
  target: 165, maxDose: 40, nightscoutUrl: NS, nsFormat: "split", reduceBelowTarget: true,
  timeRatios: [
    { id: "tr-morning", name: "Morning", ratio: 12, start: "05:30", end: "11:00", color: "#C93400" },
    { id: "tr-lunch", name: "Lunch", ratio: 6, start: "11:00", end: "15:00", color: "#248A3D" },
    { id: "tr-evening", name: "Evening", ratio: 15, start: "15:00", end: "05:30", color: "#8944AB" }
  ],
  activityRatios: [{ id: "ar-sport", name: "Sport", ratio: 18, color: "#8B5CF6" }],
  basalBaseline: { am: 10, pm: 18 },
  ratioHistory: [{ ts: Date.now() - 2 * 86400000, ratios: [{ id: "tr-morning", name: "Morning", ratio: 12, kind: "time" }, { id: "tr-lunch", name: "Lunch", ratio: 6, kind: "time" }, { id: "tr-evening", name: "Evening", ratio: 15, kind: "time" }, { id: "ar-sport", name: "Sport", ratio: 18, kind: "activity" }] }]
};
const freshRow = () => ({ user_id: "user-1", data: stateBlob({ history: [meal("cloud-meal-1", Date.now() - 3600_000)], settings: ACCOUNT, settingsUpdatedAt: Date.now() - 2 * 86400000 }), updated_at: be.stamp() });
const localSettings = dev => dev.eval(`(JSON.parse(localStorage.getItem("insulinBuddy.v2") || "{}").settings) || {}`);
const typeCode = async (dev, code) => { await dev.eval(`(() => { const i = document.getElementById("mfa-code"); i.value = ${JSON.stringify(code)}; i.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`); await sleep(400); };
const openSync = async dev => { await dev.tab("settings"); await dev.click('#settings-segmented [data-seg="sync"]'); await sleep(400); };
const signIn = dev => dev.eval(`(() => { document.getElementById("acct-email").value = "test@example.com"; document.getElementById("acct-password").value = "pw-123456"; document.getElementById("acct-signin-form").dispatchEvent(new Event("submit", { cancelable: true })); return true; })()`);
const loaded = dev => dev.waitFor(`(() => { try { return JSON.parse(localStorage.getItem("insulinBuddy.v2")).history.some(h => h.id === "cloud-meal-1"); } catch (e) { return false; } })()`, 8000);
const noErrors = async dev => (await dev.eval("window.__errs.length")) === 0 && dev.errors.length === 0;

async function checkAccountSettings(dev, label) {
  await sleep(1500);   // let the after-sign-in upload finish
  const s = await localSettings(dev);
  const ratios = (s.timeRatios || []).map(r => `${r.name} ${r.ratio}`).join(", ");
  t.check(`${label}: this device has the account's ratios`, ratios === "Morning 12, Lunch 6, Evening 15", ratios);
  t.check(`${label}: target and max dose came in`, s.target === 165 && s.maxDose === 40, `${s.target} / ${s.maxDose}`);
  t.check(`${label}: usual basal came in`, s.basalBaseline && s.basalBaseline.am === 10 && s.basalBaseline.pm === 18, JSON.stringify(s.basalBaseline));
  t.check(`${label}: the Nightscout link and token came in`, s.nightscoutUrl === NS, s.nightscoutUrl);
  await openSync(dev);
  t.check(`${label}: Settings > Data shows the Nightscout link`, (await dev.eval(`document.getElementById("ns-url").value`)) === NS);
  const c = be.row.data.settings;
  t.check(`${label}: the cloud copy still has the account's settings`, c.target === 165 && c.maxDose === 40 && c.nightscoutUrl === NS && c.timeRatios[0].ratio === 12, JSON.stringify({ t: c.target, m: c.maxDose, ns: c.nightscoutUrl, r: c.timeRatios && c.timeRatios[0].ratio }));
  const rh = (c.ratioHistory || []).map(h => h.ratios.map(r => r.ratio).join("/"));
  t.check(`${label}: Ratio over time didn't gain the factory ratios`, rh.length === 1 && rh[0] === "12/6/15/18", JSON.stringify(rh));
  t.check(`${label}: no JS errors`, await noErrors(dev), (await dev.eval("window.__errs")).join(" | "));
}

// ---------------------------------------------------------------- 1. Password + code, as on 6 Nov
t.section(`NEW DEVICE, PASSWORD AND CODE (${tag})`);
be.row = freshRow();
let dev = await openDevice(app, { width: W, height: 900, mobile: W < 1000, dark, inject: fakeSupabaseSource({ userId: "user-1", signedIn: false, mfa: { verified: true } }), wait: 2500 });
await dev.tab("history"); await sleep(300); await dev.tab("calculator"); await sleep(1200);   // used a little before signing in
await openSync(dev);
await signIn(dev);
await dev.waitFor(`!document.getElementById("mfa-screen").hidden`, 6000);
await typeCode(dev, "123456");
await loaded(dev);
await checkAccountSettings(dev, "password + code");
if (SHOTS) await dev.shot(`${SHOTS}/first-sign-in-${tag}.png`);
dev.close();

// ---------------------------------------------------------------- 2. A setting touched before signing in
t.section(`NEW DEVICE, A SETTING CHANGED BEFORE SIGNING IN (${tag})`);
be.row = freshRow();
dev = await openDevice(app, { width: W, height: 900, mobile: W < 1000, dark, inject: fakeSupabaseSource({ userId: "user-1", signedIn: false }), wait: 2500 });
await dev.tab("settings"); await sleep(300);
await dev.eval(`(() => { const i = document.getElementById("set-target"); if (!i) return false; i.value = "120"; document.getElementById("btn-save-settings").click(); return true; })()`);
await sleep(600);
t.check("the signed-out edit was saved on this device", (await localSettings(dev)).target === 120, String((await localSettings(dev)).target));
await openSync(dev);
await signIn(dev);
await loaded(dev);
await checkAccountSettings(dev, "after a signed-out edit");
dev.close();

// ---------------------------------------------------------------- 3. A device that already synced keeps newest-wins
t.section(`DEVICE THAT ALREADY SYNCED (${tag}): its later edit still reaches the cloud`);
be.row = freshRow();
dev = await openDevice(app, { width: W, height: 900, mobile: W < 1000, dark, inject: fakeSupabaseSource({ userId: "user-1" }), wait: 2500 });
await loaded(dev);
t.check("starts with the account's target", (await localSettings(dev)).target === 165);
await dev.tab("settings"); await sleep(300);
const changed = await dev.eval(`(() => { const i = document.getElementById("set-target"); if (!i) return false; i.value = "150"; document.getElementById("btn-save-settings").click(); return true; })()`);
await sleep(1500);
t.check("its edit reaches the cloud as before", changed && be.row.data.settings.target === 150, String(be.row.data.settings.target));
dev.close();

await app.close();
process.exit(t.summary() ? 0 : 1);
