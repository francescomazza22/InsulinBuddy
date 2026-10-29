// Still on board (2.73.0): the Now tab shows insulin and carbs in glucose terms from now on (down, up and net), with clock
// times, totals in words, and a clear "not where you'll end up" note. Replaces the two-axis units/grams chart.
// Env: OB_WIDTH (default 390), OB_DARK=1, OB_UNITS=mmol, SHOTS=<dir>.
import { createBackend, startApp, openDevice, fakeSupabaseSource, makeChecker } from "./harness.js";
import { FOODS_JS, stateBlob, meal } from "./helpers.js";

const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const W = Number(process.env.OB_WIDTH || 390), DARK = process.env.OB_DARK === "1", MMOL = process.env.OB_UNITS === "mmol", SHOTS = process.env.SHOTS;
const MIN = 60000, now = Date.now();
// like 29 Oct at 15:41: lunch 87.8 g / 12.5 u three hours ago (high GI), a 1 u correction 25 minutes ago
const lunch = meal("lunch", now - 179 * MIN, { totalCarbs: 87.8, mealDose: 11.5, correctionDose: 1, ratioValue: 7.5, glycemicLoad: { value: 75, partial: false } });
const corr = meal("corr", now - 25 * MIN, { totalCarbs: 0, mealDose: 0, correctionDose: 1, ratioValue: 15, mealType: "correction" });
const settings = { units: MMOL ? "mmol" : "mgdl", isf: MMOL ? 2.8 : 50, target: MMOL ? 6.1 : 110, carbAbsorptionMinutes: { high: 190, medium: 205, low: 240, unknown: 200 } };

async function open(history) {
  const be = createBackend();
  const app = await startApp(DIR, be, { "foods_data.js": FOODS_JS, "manifest.json": "{}" });
  be.row = { user_id: "user-1", data: stateBlob({ history, settings }), updated_at: be.stamp() };
  const dev = await openDevice(app, { width: W, height: 900, mobile: W < 700, dark: DARK, inject: fakeSupabaseSource({ userId: "user-1" }), wait: 2500 });
  return { app, dev };
}
const unit = MMOL ? "mmol/L" : "mg/dL";
const toMg = v => MMOL ? v * 18.016 : v;
const NUM = "(\\d+(?:\\.\\d+)?)";

t.section(`STILL ON BOARD (${W}px${DARK ? ", dark" : ""}${MMOL ? ", mmol/L" : ""})`);
{
  const { app, dev } = await open([lunch, corr]);
  await dev.click(".active-panel"); await sleep(500);
  await dev.waitFor(`/Still on board/.test(document.getElementById("aiog-content").textContent)`, 20000, 300);
  const txt = await dev.text("#aiog-content");
  t.check("headed 'Still on board'; the old units/grams legend is gone", /Still on board/.test(txt) && !/Insulin \(u\)/.test(txt) && !/Carbs \(g\)/.test(txt) && !/Projected forward/.test(txt));
  const ins = new RegExp(`${NUM} u insulin \\(about ${NUM} ${unit.replace("/", "\\/")} still to lower\\)`).exec(txt);
  const carbs = new RegExp(`${NUM} g carbs \\(about ${NUM} ${unit.replace("/", "\\/")} still to raise\\)`).exec(txt);
  t.check("says the insulin and carbs left, each in glucose terms", !!ins && !!carbs, txt.slice(0, 300));
  if (ins && carbs) {
    t.check("insulin about 3.4-3.9 u, about 170-195 mg/dL", +ins[1] >= 3.4 && +ins[1] <= 3.9 && toMg(+ins[2]) > 165 && toMg(+ins[2]) < 200, `${ins[1]} u, ${ins[2]}`);
    t.check("insulin's pull is several times the carbs' push", toMg(+ins[2]) > 3 * toMg(+carbs[2]), `${ins[2]} vs ${carbs[2]}`);
  }
  const net = new RegExp(`Together, about ${NUM} ${unit.replace("/", "\\/")} lower than now by`).exec(txt);
  t.check("the net is spelled out, with the caveat that real glucose usually moves less", !!net && /Real glucose usually moves less/.test(txt) && /counting only what you logged/.test(txt), txt.slice(-400));
  const svg = await dev.eval(`(() => { const s = document.querySelector("#aiog-content svg"); return { ins: !!s.querySelector("path.onboard-insulin"), carbs: !!s.querySelector("path.onboard-carbs"), net: !!s.querySelector("path.onboard-net[stroke-dasharray]"), labels: [...s.querySelectorAll("text")].map(x => x.textContent) }; })()`);
  t.check("three lines: insulin, carbs and a dashed net", svg.ins && svg.carbs && svg.net);
  const clocks = svg.labels.filter(l => /^\d{1,2}:\d{2}( ?[AP]M)?$/i.test(l));
  t.check("time axis: 'now' then at least two clock times", svg.labels.includes("now") && clocks.length >= 2, svg.labels.join(" | "));
  t.check("y axis is in glucose change, with a zero line and signed values", svg.labels.includes("0") && svg.labels.some(l => /^−/.test(l)) && svg.labels.some(l => /^\+/.test(l)), svg.labels.join(" | "));
  const ends = await dev.eval(`(() => { const p = document.querySelector("#aiog-content path.onboard-net").getAttribute("d").match(/[ML][-\\d.]+,[-\\d.]+/g); return p.length; })()`);
  t.check("the chart stops once the effect is spent (well under the 6 h insulin time)", ends > 12 && ends < 60, `${ends} points of 5 min`);
  t.check("legend: Insulin, Carbs, Net", /Insulin\s*Carbs\s*Net/.test(txt.replace(/\s+/g, " ")));
  const n = await dev.eval(`[...document.querySelectorAll("#aiog-content .aiog-head")].findIndex(h => /Still on board/.test(h.textContent))`);
  await dev.eval(`document.querySelectorAll("#aiog-content .aiog-head")[${n}].querySelector(".info-btn").click()`); await sleep(200);
  const info = await dev.eval(`document.querySelectorAll("#aiog-content .aiog-head")[${n}].nextElementSibling.textContent`);
  t.check("the i explains it in his numbers and says it isn't where glucose ends up", /same terms, glucose/.test(info) && /correction factor \((50|2.8)/.test(info) && /not where your glucose will end up/.test(info) && /Basal is left out/.test(info), info.slice(0, 200));
  if (SHOTS) { await dev.eval(`document.querySelectorAll("#aiog-content .aiog-head")[${n}].querySelector(".info-btn").click()`); await sleep(150); await dev.shot(`${SHOTS}/onboard-${W}${DARK ? "-dark" : ""}${MMOL ? "-mmol" : ""}.png`); }
  t.check("no JS errors", (await dev.eval("window.__errs.length")) === 0 && dev.errors.length === 0, JSON.stringify(dev.errors).slice(0, 300));
  dev.close(); await app.close();
}

t.section("INSULIN ONLY, AND NOTHING ON BOARD");
{
  const { app, dev } = await open([corr]);
  await dev.click(".active-panel"); await sleep(500);
  await dev.waitFor(`/Still on board/.test(document.getElementById("aiog-content").textContent)`, 20000, 300);
  const txt = await dev.text("#aiog-content");
  t.check("insulin only: no carbs line, no carbs words or legend", /u insulin/.test(txt) && !/g carbs/.test(txt) && !/Carbs\s*Net/.test(txt) && !(await dev.eval(`!!document.querySelector("#aiog-content path.onboard-carbs")`)));
  dev.close(); await app.close();
}
{
  const { app, dev } = await open([meal("old", now - 8 * 60 * MIN, { totalCarbs: 40, mealDose: 4, ratioValue: 10 })]);
  const panelHidden = await dev.eval(`document.getElementById("active-panel").hidden`);
  if (!panelHidden) {
    await dev.click(".active-panel"); await sleep(500);
    const txt = await dev.text("#aiog-content");
    t.check("nothing acting: says so, no chart", /No logged insulin or carbs are still acting/.test(txt) && !(await dev.eval(`!!document.querySelector("#aiog-content path.onboard-net")`)));
  } else t.check("nothing acting: the panel that opens the sheet is hidden, as before", panelHidden);
  dev.close(); await app.close();
}
process.exit(t.summary() ? 0 : 1);
