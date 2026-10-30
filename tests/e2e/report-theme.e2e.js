import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
// Both reports follow dark mode on screen (2.77.1) and still save light PDFs. RT2_WIDTH (default 420), SHOTS=<dir>.
// Was: Doctor report > Save PDF: a real PDF is made in the app and shared (printing does nothing in a home-screen app). Was: Glucose > Statistics: the figures a FreeStyle Libre report and Gluroo show, from stored readings and logged insulin.
import { createBackend, startApp, openDevice, fakeSupabaseSource, makeChecker } from "./harness.js";
import { FOODS_JS, stateBlob } from "./helpers.js";
import { entriesToGlucoseRows } from "../../js/nightscout.js";

const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const be = createBackend();
const app = await startApp(DIR, be, { "foods_data.js": FOODS_JS, "manifest.json": "{}" });
const MIN = 60000, H = 3600000, DAY = 86400000;
const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
const base = midnight.getTime() - 10 * DAY;
const at = (d, h, m = 0) => base + d * DAY + h * H + m * MIN;
// meals: lunch (12:00) and evening (19:00) on days 0-8, a correction on day 3 at 15:30, a sport meal on day 6
const meal = (id, ts, over = {}) => ({ id, ts, mealType: "lunch", periodName: "lunch", items: [{ refType: "food", refId: "s1", name: "Pane comune", grams: 80, carbsPer100g: 65, kcalPer100g: 300, carbs: 52, kcal: 240 }], totalCarbs: 52, totalKcal: 240, mealDose: 5, correctionDose: 0, noInsulin: false, glucose: null, ratioLabel: "Lunch", ratioValue: 10, ...over });
const history = [];
for (let d = 0; d <= 8; d++) { history.push(meal("l" + d, at(d, 12))); if (d !== 3) history.push(meal("e" + d, at(d, 19), { ratioLabel: "Evening", ratioValue: 15, mealType: "dinner" })); }
history.push({ id: "c3", ts: at(3, 15, 30), mealType: "correction", items: [], totalCarbs: 0, mealDose: 0, correctionDose: 2, noInsulin: false, ratioLabel: "", ratioValue: null });
history.push(meal("sp", at(6, 16), { ratioLabel: "Sport", ratioValue: 18 }));
// readings every 5 min: baseline 110, +60 over the first hour after a meal, gently back down; correction day drops 100
const mealTimes = history.filter(h => h.totalCarbs > 0).map(h => h.ts);
const entries = [];
for (let tt = base; tt < midnight.getTime(); tt += 5 * MIN) {
  let g = 110;
  for (const mt of mealTimes) { const m = (tt - mt) / MIN; if (m >= 0 && m < 240) g += 60 * Math.sin((Math.PI * m) / 240); }
  const cm = (tt - at(3, 15, 30)) / MIN; if (cm >= 0 && cm < 200) g = 210 - (cm / 180) * 100;
  entries.push({ sgv: Math.round(g), date: tt, direction: "Flat" });
}
be.glucose = entriesToGlucoseRows(entries, "user-1");
be.row = { user_id: "user-1", data: stateBlob({ history, settings: { darkMode: true, darkModeAuto: false, nightscoutUrl: "https://demo.ns.example.com/?token=tok-abcdef-123456", activityRatios: [{ id: "x", name: "Sport", color: "#8B5CF6", ratio: 18 }], timeRatios: [{ id: "a", name: "Lunch", color: "#D6A419", ratio: 10, start: "11:00", end: "15:00" }, { id: "b", name: "Evening", color: "#6366F1", ratio: 15, start: "15:00", end: "23:30" }] } }), updated_at: be.stamp() };


const W = Number(process.env.RT2_WIDTH || 420), SHOTS = process.env.SHOTS;
const dev = await openDevice(app, { width: W, height: 900, mobile: W < 1000, dark: true, inject: fakeSupabaseSource({ userId: "user-1" }) + `
  window.__shared = null; navigator.canShare = () => true;
  navigator.share = async d => { const f = d.files[0]; const buf = new Uint8Array(await f.arrayBuffer()); let s = ""; for (const b of buf) s += String.fromCharCode(b); window.__shared = { name: f.name, type: f.type, b64: btoa(s) }; };`, wait: 2000 });
// luminance of an element's own background (walking up past transparent ones) and of its text
const lum = sel => dev.eval(`(() => { const L = c => { const m = c.match(/[\\d.]+/g).map(Number); const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); };
  let e = document.querySelector(${JSON.stringify(sel)}); const text = getComputedStyle(e).color; let bg = "rgba(0, 0, 0, 0)";
  while (e && /rgba\\(0, 0, 0, 0\\)|transparent/.test(bg = getComputedStyle(e).backgroundColor)) e = e.parentElement;
  return { bg: L(bg), text: L(text) }; })()`);
const imageInk = async (pdf, name) => {   // darkest pixels in the PDF's embedded images: a chart's labels and lines must be dark on the white image
  writeFileSync(`/tmp/shots/${name}.pdf`, Buffer.from(pdf.b64, "base64"));
  execFileSync("sh", ["-c", `rm -rf /tmp/shots/${name}-img && mkdir -p /tmp/shots/${name}-img && pdfimages -png /tmp/shots/${name}.pdf /tmp/shots/${name}-img/i`]);
  const out = execFileSync("python3", ["-c", `
import glob,sys
from PIL import Image
best=[]
for f in sorted(glob.glob('/tmp/shots/${name}-img/*.png')):
  im=Image.open(f).convert('L'); px=list(im.tobytes()); n=len(px)
  best.append([round(sum(1 for p in px if p<110)/n*1000,2), round(sum(1 for p in px if p<60)/n*1000,2)])
print(best)`]).toString().trim();
  return JSON.parse(out);
};
await dev.tab("history"); await dev.click('[data-seg="glucose"]'); await sleep(500);
await dev.click('[data-range="14"]');
t.check("the app is in dark mode", await dev.eval(`document.documentElement.dataset.theme === "dark"`));

t.section("DOCTOR REPORT in dark mode");
await dev.eval(`document.getElementById("btn-generate-report").click()`);
await dev.waitFor(`/Patterns/.test(document.getElementById("report-content").textContent)`, 30000, 300);
const doc = await lum("#report-content");
t.check("dark page, light text on screen", doc.bg < 0.05 && doc.text > 0.5, JSON.stringify(doc));
if (SHOTS) await dev.shot(`${SHOTS}/doctor-report-dark.png`);
await dev.eval(`document.getElementById("btn-report-save").click()`);
await dev.waitFor(`!!window.__shared`, 30000, 300);
const docInk = await imageInk(await dev.eval(`window.__shared`), "doctor-dark");
t.check("its PDF chart has readable labels on the white page", docInk.length > 0 && docInk.every(v => v[0] >= 5), JSON.stringify(docInk));
t.check("and paper colours: faint gridlines, not the dark theme's black ones", docInk.every(v => v[1] < 1), JSON.stringify(docInk));
t.check("the app is still dark after saving", await dev.eval(`document.documentElement.dataset.theme === "dark"`) && (await lum("#report-content")).bg < 0.05);
await dev.eval(`document.getElementById("btn-report-close").click(); window.__shared = null;`);

t.section("CLINIC REPORT in dark mode");
await dev.eval(`document.getElementById("btn-clinic-report").click()`);
await dev.waitFor(`/clinical judgment/.test(document.getElementById("clinic-report-content").textContent)`, 30000, 300);
const cl = await lum("#clinic-report-content");
t.check("dark page, light text on screen (was white)", cl.bg < 0.05 && cl.text > 0.5, JSON.stringify(cl));
const tb = await lum(".clinic-report-toolbar");
t.check("its toolbar is dark too", tb.bg < 0.05, JSON.stringify(tb));
const soft = await lum(".clinic-report__meta");
t.check("secondary text still readable on black", soft.text > 0.2, JSON.stringify(soft));
if (SHOTS) await dev.shot(`${SHOTS}/clinic-report-dark.png`);
await dev.eval(`document.getElementById("clinic-report-save").click()`);
await dev.waitFor(`!!window.__shared`, 30000, 300);
const clPdf = await dev.eval(`window.__shared`);
const clTxt = (writeFileSync("/tmp/shots/clinic-dark.pdf", Buffer.from(clPdf.b64, "base64")), execFileSync("pdftotext", ["-layout", "/tmp/shots/clinic-dark.pdf", "-"]).toString());
t.check("its PDF still has the figures as text", /Time in range|time in range/i.test(clTxt) && /clinical judgment/.test(clTxt), clTxt.slice(0, 200));
const clInk = await imageInk(clPdf, "clinic-dark");
t.check("its chart is in paper colours (readable labels, faint gridlines)", clInk.length > 0 && clInk.every(v => v[0] >= 5 && v[1] < 1), JSON.stringify(clInk));
t.check("the app is still dark after saving", await dev.eval(`document.documentElement.dataset.theme === "dark"`) && (await lum("#clinic-report-content")).bg < 0.05);

t.section("LIGHT MODE unchanged");
await dev.eval(`document.getElementById("clinic-report-close").click()`);
await dev.eval(`document.documentElement.setAttribute("data-theme", "light"); document.getElementById("btn-clinic-report").click()`);
await sleep(800);
const cll = await lum("#clinic-report-content");
t.check("clinic report is light with dark text in light mode", cll.bg > 0.8 && cll.text < 0.1, JSON.stringify(cll));
t.check("no JS errors", (await dev.eval("window.__errs.length")) === 0 && dev.errors.length === 0, JSON.stringify(await dev.eval("window.__errs")) + dev.errors.join("|"));
dev.close(); await app.close();
process.exit(t.summary() ? 0 : 1);
