// 2.72.0: logging basal after moderate/hard activity suggests his own percentage less, and only when he taps it.
// Env: BA_WIDTH (default 390), BA_DARK=1, SHOTS=<dir>.
import { startApp, openDevice, makeChecker, seedLocal } from "./harness.js";
import { FOODS_JS, stateBlob, localState } from "./helpers.js";

const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const W = Number(process.env.BA_WIDTH || 390), DARK = process.env.BA_DARK === "1", SHOTS = process.env.SHOTS;
const app = await startApp(DIR, null, { "foods_data.js": FOODS_JS, "manifest.json": "{}" });
const MIN = 60000, now = Date.now();
const slot = new Date(now).getHours() < 14 ? "am" : "pm";
const hist = [
  { id: "b0", ts: now - 86400000, entryType: "basal", mealType: "basal", periodName: slot === "am" ? "morning" : "evening", basalDose: 10, basalSlot: slot,
    items: [], totalCarbs: 0, totalKcal: 0, mealDose: 0, correctionDose: 0, noInsulin: false, glucose: null },
  { id: "a1", ts: now - 75 * MIN, entryType: "activity", mealType: "activity", activityType: "run", activityName: "", durationMin: 45, intensity: "hard", note: "",
    items: [], totalCarbs: 0, totalKcal: 0, glycemicLoad: null, mealDose: 0, correctionDose: 0, noInsulin: false, glucose: null, ratioLabel: "", ratioValue: null }
];
const open = async () => { await dev.tab("history"); await dev.click('[data-seg="log"]'); await sleep(250); await dev.click("#btn-log-basal"); await sleep(500); };
const card = () => dev.text("#basal-activity");
const cardShown = () => dev.eval(`(() => { const e = document.getElementById("basal-activity"); return !!e && !e.hidden; })()`);
const units = () => dev.eval(`document.getElementById("basal-units").value`);
const close = async () => { await dev.click("#basal-cancel"); await sleep(400); };

const dev = await openDevice(app, { width: W, height: 900, mobile: W < 700, dark: DARK, inject: `if (!localStorage.getItem("insulinBuddy.v2")) { ${seedLocal(stateBlob({ history: hist }))} }`, wait: 1500 });

t.section(`OFF BY DEFAULT (${W}px${DARK ? ", dark" : ""}): no suggestion, the old note`);
await open();
t.check("no suggestion card", !(await cardShown()));
t.check("note still says it never works a basal dose out itself", /never works a basal dose out itself/.test(await dev.text(".basal-note")));
t.check("dose prefilled from the last one", (await units()) === "10", await units());
await close();

t.section("SETTINGS: turn it on and set the rule");
await dev.tab("settings"); await dev.click('#settings-segmented [data-seg="ratios"]'); await sleep(250);
t.check("fields hidden while off", await dev.eval(`document.getElementById("basal-activity-fields").hidden`));
await dev.eval(`(() => { const e = document.getElementById("basal-activity-toggle"); e.checked = true; e.dispatchEvent(new Event("change", { bubbles: true })); })()`); await sleep(200);
t.check("fields shown when on", !(await dev.eval(`document.getElementById("basal-activity-fields").hidden`)));
t.check("asks for the percentage first", /Set the percentage/.test(await dev.text("#basal-activity-status")));
const setBox = (id, v) => dev.eval(`(() => { const e = document.getElementById(${JSON.stringify(id)}); e.focus(); e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event("input", { bubbles: true })); e.dispatchEvent(new Event("change", { bubbles: true })); e.blur(); })()`);
await open(); t.check("on without a percentage: still no suggestion", !(await cardShown())); await close();
await dev.tab("settings"); await dev.click('#settings-segmented [data-seg="ratios"]'); await sleep(200);
await setBox("basal-activity-pct", "20"); await sleep(200);
t.check("example uses the last dose", /10u would be suggested as 8u/.test(await dev.text("#basal-activity-status")), await dev.text("#basal-activity-status"));
await setBox("basal-activity-pct", ""); await sleep(200);
t.check("clearing the box keeps 20%", (await dev.eval(`document.getElementById("basal-activity-pct").value`)) === "20");
await setBox("basal-activity-pct", "80"); await sleep(200);
t.check("over 50% is held at 50", (await dev.eval(`document.getElementById("basal-activity-pct").value`)) === "50");
await setBox("basal-activity-pct", "20"); await sleep(200);
if (SHOTS) { await dev.eval(`document.getElementById("basal-activity-card").scrollIntoView({ block: "center" })`); await sleep(200); await dev.shot(`${SHOTS}/basal-activity-settings-${W}${DARK ? "-dark" : ""}.png`); }
let s = (await localState(dev)).settings.basalActivity;
t.check("saved rule", s.enabled === true && s.reducePct === 20 && s.minMinutes === 30 && s.lookbackMin === 60, JSON.stringify(s));

t.section("BASAL SHEET: a hard run 30 min before the dose");
await open();
t.check("suggestion shown", await cardShown());
const c = await card();
t.check("names the activity and when it ended", /Run · 45 min · Hard, finished (29|30) min before this dose/.test(c), c);
t.check("suggests 8u instead of 10u", /suggests 8u instead of 10u/.test(c), c);
t.check("note mentions his rule", /from your own rule in Settings > Dosing \(20% less\)/.test(await dev.text(".basal-note")), await dev.text(".basal-note"));
t.check("nothing changed until he taps", (await units()) === "10");
if (SHOTS) await dev.shot(`${SHOTS}/basal-activity-${W}${DARK ? "-dark" : ""}.png`);
await dev.click('[data-activity="use"]'); await sleep(200);
t.check("Use puts 8u in the box", (await units()) === "8", await units());
t.check("card says it is using it, with Undo", /Using 8u: 20% less than 10u/.test(await card()) && /Undo, back to 10u/.test(await card()), await card());
await dev.click('[data-activity="undo"]'); await sleep(200);
t.check("Undo puts 10u back", (await units()) === "10");
t.check("and the suggestion is offered again", /suggests 8u instead of 10u/.test(await card()));
await dev.eval(`(() => { const e = document.getElementById("basal-units"); e.value = "12"; e.dispatchEvent(new Event("input", { bubbles: true })); })()`); await sleep(150);
t.check("typing a new dose re-works the suggestion from it", /suggests 9.5u instead of 12u/.test(await card()), await card());
await dev.click('[data-activity="use"]'); await sleep(150);
t.check("12u less 20% = 9.6, rounded to 9.5u", (await units()) === "9.5");
await dev.click("#basal-save"); await sleep(700);
const saved = (await localState(dev)).history.filter(h => h.entryType === "basal").sort((a, b) => b.ts - a.ts)[0];
t.check("saved dose is the one in the box", saved.basalDose === 9.5 && saved.id !== "b0", JSON.stringify({ d: saved.basalDose, id: saved.id }));

t.section("TIME: a dose taken before the run started gets no suggestion");
await open();
await dev.eval(`(() => { const e = document.getElementById("basal-time"); const d = new Date(Date.now() - 200 * 60000); const p = n => String(n).padStart(2, "0"); e.value = d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + "T" + p(d.getHours()) + ":" + p(d.getMinutes()); e.dispatchEvent(new Event("change", { bubbles: true })); })()`); await sleep(200);
t.check("dose 200 min ago (before the run started): no suggestion", !(await cardShown()), await card());
await close();

t.section("EDITING an existing dose shows no suggestion");
await dev.eval(`document.querySelector('[data-edit="b0"]') && document.querySelector('[data-edit="b0"]').click()`); await sleep(500);
t.check("edit sheet has no suggestion", !(await cardShown()));
await close();

t.section("TWO PIECES (2.72.1): a hard 25 min then a moderate 26 min, 2 min apart, count as one 51-min workout");
await dev.eval(`(() => {
  const k = "insulinBuddy.v2", st = JSON.parse(localStorage.getItem(k)), base = st.history.find(h => h.id === "a1"), t = Date.now(), M = 60000;
  st.history = st.history.filter(h => h.id !== "a1");
  st.history.push({ ...base, id: "p1", activityType: "other", activityName: "", intensity: "hard", durationMin: 25, ts: t - 83 * M });
  st.history.push({ ...base, id: "p2", activityType: "gym", intensity: "moderate", durationMin: 26, ts: t - 56 * M });
  st.history.sort((a, b) => b.ts - a.ts);
  localStorage.setItem(k, JSON.stringify(st));
})()`);
await dev.go(); await sleep(500);
await open();
const c2 = await card();
t.check("suggestion shown for the joined workout", await cardShown(), c2);
t.check("names both pieces and the total", /Other · 25 min · Hard, then Gym \/ weights · 26 min · Moderate \(51 min in all\), finished (29|30) min before this dose/.test(c2), c2);
if (SHOTS) await dev.shot(`${SHOTS}/basal-activity-joined-${W}${DARK ? "-dark" : ""}.png`);
await close();

t.check("no JS errors", (await dev.eval("window.__errs.length")) === 0 && dev.errors.length === 0, JSON.stringify(await dev.eval("window.__errs")));
dev.close(); await app.close();
process.exit(t.summary() ? 0 : 1);
