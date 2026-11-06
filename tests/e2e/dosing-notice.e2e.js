// 2.88.0: dosing settings that arrive from another device are never changed silently. Two devices share one cloud;
// when A changes the target, B shows one notice listing the change. A setting that doesn't decide a dose (dark mode)
// shows nothing, and the device that made the change isn't told about its own edit.
// DN_WIDTH (default 390), DN_DARK=1, SHOTS=<dir>.
import { createBackend, startApp, openDevice, fakeSupabaseSource, makeChecker } from "./harness.js";
import { FOODS_JS, stateBlob, meal, skipClock, foreground } from "./helpers.js";

const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SHOTS = process.env.SHOTS || "";
const W = Number(process.env.DN_WIDTH || 390);
const dark = process.env.DN_DARK === "1";
const tag = `${W}${dark ? "-dark" : ""}`;
const be = createBackend();
const app = await startApp(DIR, be, { "foods_data.js": FOODS_JS });
be.row = { user_id: "user-1", data: stateBlob({ history: [meal("cloud-meal-1", Date.now() - 3600_000)], settings: { target: 165, maxDose: 40 }, settingsUpdatedAt: Date.now() - 86400000 }), updated_at: be.stamp() };

const open = () => openDevice(app, { width: W, height: 900, mobile: W < 1000, dark, inject: fakeSupabaseSource({ userId: "user-1" }), wait: 2500 });
const dialogText = dev => dev.eval(`(() => { const d = document.querySelector(".dialog-backdrop"); return d ? d.textContent : ""; })()`);
const noErrors = async dev => (await dev.eval("window.__errs.length")) === 0 && dev.errors.length === 0;

t.section(`DOSING NOTICE (${tag})`);
const A = await open();
const B = await open();
t.check("both devices start with the account's target", (await A.eval(`JSON.parse(localStorage.getItem("insulinBuddy.v2")).settings.target`)) === 165 && (await B.eval(`JSON.parse(localStorage.getItem("insulinBuddy.v2")).settings.target`)) === 165);

await A.tab("settings"); await sleep(300);
await A.eval(`(() => { document.getElementById("set-target").value = "150"; document.getElementById("btn-save-settings").click(); })()`);
await sleep(1500);
t.check("A's new target reached the cloud", be.row.data.settings.target === 150, String(be.row.data.settings.target));
t.check("A isn't told about its own change", (await dialogText(A)) === "");

await skipClock(B, 20000); await foreground(B); await sleep(500);
const msg = await dialogText(B);
t.check("B shows a notice that dosing settings changed", /Dosing settings changed/.test(msg), msg);
t.check("it lists the change with its unit", /Target: 165 → 150 mg\/dL/.test(msg), msg);
t.check("B now uses the new target", (await B.eval(`JSON.parse(localStorage.getItem("insulinBuddy.v2")).settings.target`)) === 150);
if (SHOTS) await B.shot(`${SHOTS}/dosing-notice-${tag}.png`);
await B.click(".dialog-backdrop .dialog__btn--primary"); await sleep(500);
t.check("Check settings opens Settings > Dosing", await B.eval(`!document.getElementById("view-settings").hidden && !document.getElementById("panel-ratios").hidden`));

await A.eval(`(() => { const c = document.getElementById("dark-mode-toggle"); c.click(); return true; })()`);
await sleep(1500);
await skipClock(B, 40000); await foreground(B); await sleep(500);
t.check("a change that doesn't decide a dose (dark mode) shows nothing", (await dialogText(B)) === "", await dialogText(B));
t.check("no JS errors", (await noErrors(A)) && (await noErrors(B)), (await A.eval("window.__errs")).concat(await B.eval("window.__errs")).join(" | "));
A.close(); B.close();
await app.close();
process.exit(t.summary() ? 0 : 1);
