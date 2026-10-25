// Logging physical activity (2.65.0): the sheet, the log row, editing, deleting with undo, and that an activity is never
// counted as a meal. ACT_WIDTH (default 390), ACT_DARK=1, SHOTS=<dir> for screenshots.
import { startApp, openDevice, makeChecker, seedLocal } from "./harness.js";
import { FOODS_JS, stateBlob, localState, meal } from "./helpers.js";
import { validateState } from "../../js/core/schema.js";

const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SHOTS = process.env.SHOTS || "";
const W = Number(process.env.ACT_WIDTH || 390), dark = process.env.ACT_DARK === "1";
const tag = `${W}${dark ? "-dark" : ""}`;
const app = await startApp(DIR, null, { "foods_data.js": FOODS_JS, "manifest.json": "{}" });
const hist = [meal("m1", Date.now() - 3 * 3600000)];
const dev = await openDevice(app, { width: W, height: 900, mobile: W < 1000, dark, inject: `if (!localStorage.getItem("insulinBuddy.v2")) { ${seedLocal(stateBlob({ history: hist }))} }`, wait: 1500 });
await dev.tab("history"); await dev.click('[data-seg="log"]'); await sleep(300);
const pill = () => dev.text("#hist-count-pill");
const pillBefore = await pill();
const sheetOpen = () => dev.eval(`!!document.querySelector(".activity-sheet")`);
const errText = () => dev.eval(`(() => { const e = document.getElementById("activity-error"); return e && !e.hidden ? e.textContent : ""; })()`);

t.section(`LOG ACTIVITY (${tag}): the button sits beside Basal and opens the sheet`);
const row = await dev.eval(`(() => { const s = document.getElementById("history-search").getBoundingClientRect(), b = document.getElementById("btn-log-basal").getBoundingClientRect(), a = document.getElementById("btn-log-activity").getBoundingClientRect();
  return { s: s.width, b: [b.top, b.right], a: [a.top, a.left, a.right], vw: innerWidth, h: [b.height, a.height] }; })()`);
t.check("the search box keeps a usable width (at least 110px)", row.s >= 110, `${row.s}px`);
t.check("Activity sits on the same line as Basal, after it", Math.abs(row.a[0] - row.b[0]) < 2 && row.a[1] > row.b[1] - 1, JSON.stringify(row));
t.check("nothing runs off the screen", row.a[2] <= row.vw, JSON.stringify(row));
t.check("both buttons are at least 44px tall", row.h.every(h => h >= 43.5), JSON.stringify(row.h));
if (SHOTS) await dev.shot(`${SHOTS}/activity-log-empty-${tag}.png`);
await dev.click("#btn-log-activity"); await sleep(500);
t.check("the sheet opens", await sheetOpen());
if (SHOTS) await dev.shot(`${SHOTS}/activity-sheet-${tag}.png`);

t.section("SAVING NEEDS WHAT, HOW LONG; 'OTHER' NEEDS A NAME");
await dev.click("#activity-save"); await sleep(250);
t.check("saving with nothing chosen asks what you did", /what you did/.test(await errText()), await errText());
await dev.click('[data-atype="other"]'); await sleep(150);
t.check("Other shows a name box", await dev.eval(`!document.getElementById("activity-name").hidden`));
await dev.click('[data-mins="45"]'); await sleep(150);
await dev.click("#activity-save"); await sleep(250);
t.check("Other without a name is refused", /name/.test(await errText()), await errText());
await dev.click('[data-atype="run"]'); await sleep(150);
t.check("picking Run hides the name box", await dev.eval(`document.getElementById("activity-name").hidden`));
const startGap = await dev.eval(`(Date.now() - new Date(document.getElementById("activity-time").value).getTime()) / 60000`);
t.check("the start time follows the duration (about 45 min ago)", startGap > 43 && startGap < 47, startGap.toFixed(1));
await dev.click('[data-int="hard"]'); await sleep(100);
t.check("the intensity hint explains Hard", /Hard: too out of breath/.test(await dev.text("#activity-int-hint")), await dev.text("#activity-int-hint"));
await dev.eval(`(() => { const n = document.getElementById("activity-note"); n.value = "intervals <b>x</b>"; n.dispatchEvent(new Event("input", { bubbles: true })); })()`);
await dev.click("#activity-save"); await sleep(600);
t.check("the sheet closes", !(await sheetOpen()));

let st = await localState(dev);
const a = st.history.find(h => h.entryType === "activity");
t.check("one activity is stored", !!a && st.history.filter(h => h.entryType === "activity").length === 1);
t.check("as Run, 45 min, Hard, with the note", a && a.activityType === "run" && a.durationMin === 45 && a.intensity === "hard" && a.note === "intervals <b>x</b>", JSON.stringify(a));
t.check("with no carbs or insulin", a && a.totalCarbs === 0 && a.mealDose === 0 && a.correctionDose === 0 && a.items.length === 0);
t.check("the saved state is schema-valid", validateState(st).filter(p => p.severity === "error").length === 0, JSON.stringify(validateState(st).slice(0, 3)));
t.check("the meal count is unchanged (an activity isn't a meal)", (await pill()) === pillBefore, `${pillBefore} -> ${await pill()}`);
const r = await dev.eval(`(() => { const r = document.querySelector(".history-entry--activity"); return r ? { name: r.querySelector(".history-entry__name").textContent, pill: r.querySelector(".dose-pill--activity").textContent, html: r.innerHTML.includes("<b>x</b>") } : null; })()`);
t.check("the log shows a Run row with a 45 min pill", r && r.name === "Run" && r.pill === "45 min", JSON.stringify(r));
t.check("the note is shown as text, never as markup", r && !r.html);
t.check("an undo toast is offered", /Run logged/.test(await dev.eval(`document.body.textContent`)));
if (SHOTS) await dev.shot(`${SHOTS}/activity-log-${tag}.png`);

t.section("EDITING keeps the same entry");
await dev.eval(`document.querySelector('.history-entry--activity [data-edit]').click()`); await sleep(500);
t.check("Edit opens it with Run and Hard chosen", await dev.eval(`document.querySelector('[data-atype="run"]').classList.contains("is-active") && document.querySelector('[data-int="hard"]').classList.contains("is-active")`));
await dev.eval(`(() => { const m = document.getElementById("activity-minutes"); m.value = "60"; m.dispatchEvent(new Event("input", { bubbles: true })); })()`);
await dev.click('[data-int="moderate"]'); await sleep(100);
await dev.click("#activity-save"); await sleep(600);
st = await localState(dev);
const a2 = st.history.find(h => h.entryType === "activity");
t.check("saved as 60 min, Moderate, same id", a2 && a2.id === a.id && a2.durationMin === 60 && a2.intensity === "moderate", JSON.stringify(a2 && [a2.id, a2.durationMin, a2.intensity]));
t.check("the start time didn't move when editing", a2 && a2.ts === a.ts);
t.check("the row now says 1 h", (await dev.text(".history-entry--activity .dose-pill--activity")) === "1 h");

t.section("SEARCH finds it; DELETE with undo");
await dev.eval(`(() => { const s = document.getElementById("history-search"); s.value = "run"; s.dispatchEvent(new Event("input", { bubbles: true })); })()`); await sleep(400);
t.check("searching 'run' shows the activity", await dev.eval(`!!document.querySelector(".history-entry--activity")`));
await dev.eval(`(() => { const s = document.getElementById("history-search"); s.value = ""; s.dispatchEvent(new Event("input", { bubbles: true })); })()`); await sleep(400);
await dev.eval(`document.querySelector('.history-entry--activity [data-del]').click()`); await sleep(400);
t.check("Delete removes it", !(await localState(dev)).history.some(h => h.entryType === "activity"));
t.check("the toast says Activity deleted", /Activity deleted/.test(await dev.eval(`document.body.textContent`)));
await dev.eval(`(() => { const b = [...document.querySelectorAll("button")].find(x => /^Undo$/i.test(x.textContent.trim())); if (b) b.click(); return !!b; })()`); await sleep(400);
t.check("Undo puts it back", (await localState(dev)).history.some(h => h.id === a.id));

t.section("PREFILL: picking Run again starts from last time");
await dev.click("#btn-log-activity"); await sleep(500);
await dev.click('[data-atype="run"]'); await sleep(150);
t.check("minutes start at 60 and Moderate (the last run)", await dev.eval(`document.getElementById("activity-minutes").value === "60" && document.querySelector('[data-int="moderate"]').classList.contains("is-active")`));
await dev.click("#activity-cancel"); await sleep(400);
t.check("Cancel saves nothing", (await localState(dev)).history.filter(h => h.entryType === "activity").length === 1);
t.check("no JS errors", (await dev.eval("window.__errs.length")) === 0 && dev.errors.length === 0, JSON.stringify(await dev.eval("window.__errs")));
dev.close(); await app.close();
process.exit(t.summary() ? 0 : 1);
