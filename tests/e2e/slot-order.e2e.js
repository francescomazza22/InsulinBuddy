// The Calculator's food list is ordered by what you eat in the current time slot (the time-of-day ratio range in
// force, or one picked by hand on the ratio pill), then by overall use. A caption names the slot.
import { startApp, openDevice, makeChecker, seedLocal } from "./harness.js";
import { FOODS_JS, stateBlob, localState } from "./helpers.js";
const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker(); const sleep = ms => new Promise(r => setTimeout(r, ms));
const app = await startApp(DIR, null, { "foods_data.js": FOODS_JS, "manifest.json": "{}" });

const now = Date.now(), DAY = 86400000, H = 3600000;
const hhmm = ms => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
// "Now" covers the hour either side of the current time; "Rest of day" is everything else.
const blob = stateBlob({ settings: { timeRatios: [
  { id: "now", name: "Now range", start: hhmm(now - H), end: hhmm(now + H), ratio: 10, color: "#1F9E93" },
  { id: "rest", name: "Rest of day", start: hhmm(now + H), end: hhmm(now - H), ratio: 12, color: "#6366F1" }
] } });
blob.library.push(
  { id: "oats", name: "Oats", category: "grains", carbs: 60, kcal: 370, usageCount: 3 },
  { id: "pasta", name: "Pasta", category: "grains", carbs: 70, kcal: 350, usageCount: 40 },
  { id: "kiwi", name: "Kiwi", category: "fruits", carbs: 10, kcal: 60, usageCount: 6 }
);
const meal = (id, ts, ...foods) => ({ id, ts, mealType: "lunch", totalCarbs: 30, totalKcal: 100, mealDose: 3, correctionDose: 0, ratioValue: 10, ratioLabel: "x", glucose: null,
  items: foods.map(f => ({ refType: "food", refId: f, name: f, grams: 50, carbsPer100g: 60, kcalPer100g: 300, carbs: 30, kcal: 150 })) });
blob.history = [
  meal("m1", now - 1 * DAY, "oats"), meal("m2", now - 2 * DAY - 20 * 60000, "oats", "kiwi"), meal("m3", now - 3 * DAY + 20 * 60000, "oats"),
  meal("m4", now - 1 * DAY + 6 * H, "pasta"), meal("m5", now - 2 * DAY + 6 * H, "pasta", "kiwi"), meal("m6", now - 4 * DAY + 7 * H, "pasta")
];
const dev = await openDevice(app, { width: 390, height: 900, mobile: true, inject: `if (!localStorage.getItem("insulinBuddy.v2")) { ${seedLocal(blob)} }`, wait: 1800 });
await dev.tab("calculator"); await sleep(300);
const names = () => dev.eval(`[...document.querySelectorAll("#cc-food-list .food-pick-item__name")].map(x => x.textContent)`);
const caption = () => dev.eval(`(() => { const h = document.getElementById("cc-food-order"); return h.hidden ? "" : h.textContent; })()`);

t.section("SLOT ORDER: the list follows what you eat at this time of day");
let n = await names();
t.check("Oats (3 meals in this range) comes first, ahead of Pasta (40 uses overall, none in this range)", n[0] === "Oats" && n.indexOf("Oats") < n.indexOf("Pasta"), n.slice(0, 5).join(", "));
t.check("Kiwi (1 meal in this range) comes next", n[1] === "Kiwi", n.slice(0, 5).join(", "));
t.check("foods never eaten in this range follow, by overall use (Pasta before Pane comune)", n.indexOf("Pasta") === 2 && n.indexOf("Pasta") < n.indexOf("Pane comune"), n.join(", "));
t.check("a caption names the range", /Most eaten in Now range \(\d\d:\d\d–\d\d:\d\d\) first/.test(await caption()), await caption());
await dev.eval(`(() => { const s = document.getElementById("cc-search"); s.value = "a"; s.dispatchEvent(new Event("input", { bubbles: true })); })()`); await sleep(200);
n = await names();
t.check("searching keeps the same order among the matches", n.indexOf("Oats") < n.indexOf("Pasta"), n.join(", "));
await dev.eval(`(() => { const s = document.getElementById("cc-search"); s.value = ""; s.dispatchEvent(new Event("input", { bubbles: true })); })()`); await sleep(200);

t.section("SLOT ORDER: picking a range by hand re-orders the list");
await dev.eval(`document.getElementById("cc-ratio-pill").click()`); await sleep(200);
await dev.eval(`document.querySelector('.ratio-picker__item[data-id="rest"]').click()`); await sleep(250);
n = await names();
t.check("with Rest of day picked, Pasta (3 meals there) is first", n[0] === "Pasta", n.slice(0, 4).join(", "));
t.check("and the caption follows", /Most eaten in Rest of day/.test(await caption()), await caption());
await dev.eval(`document.getElementById("cc-ratio-pill").click()`); await sleep(200);
await dev.eval(`document.querySelector('.ratio-picker__item[data-id="__auto__"]').click()`); await sleep(250);
t.check("back on automatic, Oats is first again", (await names())[0] === "Oats", (await names()).slice(0, 3).join(", "));

t.section("SLOT ORDER: a meal logged now counts straight away");
await dev.eval(`(() => { const s = document.getElementById("cc-search"); s.value = "Pane"; s.dispatchEvent(new Event("input", { bubbles: true })); })()`); await sleep(200);
for (let k = 0; k < 4; k++) {
  await dev.eval(`[...document.querySelectorAll("#cc-food-list > *")].find(e => e.textContent.includes("Pane comune")).click()`); await sleep(120);
  await dev.eval(`(() => { const g = document.getElementById("cc-grams"); g.value = "40"; g.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await dev.click("#cc-add-btn"); await sleep(150);
  await dev.click("#cc-log-btn"); await sleep(400);
  await dev.eval(`(() => { const s = document.getElementById("cc-search"); s.value = "Pane"; s.dispatchEvent(new Event("input", { bubbles: true })); })()`); await sleep(150);
}
await dev.eval(`(() => { const s = document.getElementById("cc-search"); s.value = ""; s.dispatchEvent(new Event("input", { bubbles: true })); })()`); await sleep(250);
const st = await localState(dev);
t.check("four meals were logged", st.history.length === 10, st.history.length);
t.check("Pane comune, now eaten 4 times in this range, moves to the top", (await names())[0] === "Pane comune", (await names()).slice(0, 3).join(", "));

const errs = [...dev.errors, ...(await dev.eval(`window.__errs || []`))];
t.check("no page errors", !errs.length, errs.join(" | "));
dev.close(); await app.close(); t.done && t.done(); process.exit(0);
