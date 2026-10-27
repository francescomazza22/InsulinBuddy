// Text contrast audit (2.68.7): every visible piece of text on the main screens, in every theme, light and dark, measured
// against what is really behind it (solid colours, gradients and see-through layers composited), against WCAG AA: 4.5:1, or
// 3:1 for large text (24px+, or 18.66px+ bold). Disabled controls are exempt, as in WCAG.
// CONTRAST_REPORT=1 prints every failure; SHOTS=<dir> saves the dose card in each theme.
import { startApp, openDevice, makeChecker, seedLocal } from "./harness.js";
import { FOODS_JS, stateBlob, meal } from "./helpers.js";

const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SHOTS = process.env.SHOTS || "", REPORT = process.env.CONTRAST_REPORT === "1";
const PALETTES = (process.env.PALETTES || "redOrange,orangeYellow,greenMint,tealCyan,blueIndigo,purplePink").split(",");
const MODES = (process.env.MODES || "light,dark").split(",");
const app = await startApp(DIR, null, { "foods_data.js": FOODS_JS, "manifest.json": "{}" });

const AUDIT = String.raw`(() => {
  const parse = s => { const m = /rgba?\(([^)]+)\)/.exec(s || ""); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const over = (top, bottom) => { const a = top.a + bottom.a * (1 - top.a); if (a === 0) return { r: 0, g: 0, b: 0, a: 0 }; return { r: (top.r * top.a + bottom.r * bottom.a * (1 - top.a)) / a, g: (top.g * top.a + bottom.g * bottom.a * (1 - top.a)) / a, b: (top.b * top.a + bottom.b * bottom.a * (1 - top.a)) / a, a }; };
  const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const colorsIn = s => (s.match(/rgba?\([^)]+\)/g) || []).map(parse).filter(Boolean);
  // Each layer behind the text: a list of possible colours (a gradient gives each of its stops).
  function layers(el) {
    const out = [];
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.opacity === "0") return null;
      // Several gradients stack (the first listed is on top): each is its own layer, its stops the possible colours.
      const grads = [];
      const src = cs.backgroundImage || "";
      for (let i = 0, depth = 0, start = -1; i < src.length; i++) {
        if (src.startsWith("gradient(", i) && depth === 0) start = src.lastIndexOf(",", i) + 1;
        if (src[i] === "(") depth++;
        else if (src[i] === ")") { depth--; if (depth === 0 && start >= 0) { grads.push(src.slice(start, i + 1)); start = -1; } }
      }
      let opaque = false;
      for (const g of grads) { const cols = colorsIn(g); if (cols.length) { out.push(cols); if (cols.every(c => c.a >= 0.999)) { opaque = true; break; } } }
      if (opaque) return out;
      const bg = parse(cs.backgroundColor);
      if (bg && bg.a > 0) out.push([bg]);
      if (bg && bg.a >= 0.999) return out;
    }
    out.push([parse(getComputedStyle(document.body).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 }]);
    return out;
  }
  const results = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  while (walker.nextNode()) {
    const tn = walker.currentNode, el = tn.parentElement;
    if (!el || seen.has(el) || !tn.textContent.trim()) continue;
    seen.add(el);
    if (el.closest("[hidden], svg, script, style, .loading-screen, [aria-hidden=true]")) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1 || r.bottom < 0 || r.top > innerHeight * 3) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") continue;
    if (el.closest("button:disabled, input:disabled, select:disabled, [aria-disabled=true]")) continue;
    let ls = layers(el); if (!ls) continue;
    // Composite from the back: every combination of gradient stops (bounded).
    let bgs = [ls[ls.length - 1][0]];
    for (let i = ls.length - 2; i >= 0; i--) { const next = []; for (const top of ls[i]) for (const b of bgs) next.push(over(top, b)); bgs = next.slice(0, 64); }
    const fg0 = parse(cs.color); if (!fg0) continue;
    const op = Number(cs.opacity) < 1 ? Number(cs.opacity) : 1;
    let worst = Infinity, worstBg = null;
    for (const bg of bgs) { const fg = over({ ...fg0, a: fg0.a * op }, bg); const c = ratio(fg, bg); if (c < worst) { worst = c; worstBg = bg; } }
    const size = parseFloat(cs.fontSize), weight = Number(cs.fontWeight) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const need = large ? 3 : 4.5;
    const id = el.id ? "#" + el.id : "";
    const cls = typeof el.className === "string" && el.className ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : "";
    const hex = c => "#" + [c.r, c.g, c.b].map(v => Math.round(v).toString(16).padStart(2, "0")).join("");
    results.push({ sel: el.tagName.toLowerCase() + id + cls, text: tn.textContent.trim().slice(0, 30), ratio: Math.round(worst * 100) / 100, need, fg: cs.color, bg: worstBg ? hex(worstBg) : "?" });
  }
  return results;
})()`;

const screens = [
  ["calculator", async dev => { await dev.tab("calculator"); }],
  ["calculator with a meal", async dev => {
    await dev.tab("calculator");
    await dev.waitFor(`document.getElementById("cc-food-list").children.length > 0`, 6000);
    await dev.eval(`document.getElementById("cc-food-list").children[0].click()`);
    await dev.eval(`(() => { const g = document.getElementById("cc-grams"); g.value = "80"; g.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    await dev.click("#cc-add-btn"); await sleep(200);
    await dev.eval(`document.getElementById("cc-correction-toggle") && document.getElementById("cc-correction-toggle").click()`); await sleep(200);
    await dev.eval(`(() => { const g = document.getElementById("cc-glucose"); if (g) { g.value = "190"; g.dispatchEvent(new Event("input", { bubbles: true })); } })()`); await sleep(200);
  }],
  ["insights meals", async dev => { await dev.tab("history"); await dev.click('#history-segmented [data-seg="log"]'); }],
  ["insights trends", async dev => { await dev.tab("history"); await dev.click('#history-segmented [data-seg="trends"]'); await sleep(400); }],
  ["settings dosing", async dev => { await dev.tab("settings"); await dev.click('#settings-segmented [data-seg="ratios"]'); }],
  ["settings general", async dev => { await dev.tab("settings"); await dev.click('#settings-segmented [data-seg="general"]'); }],
  ["settings library", async dev => { await dev.tab("settings"); await dev.click('#settings-segmented [data-seg="library"]'); }],
  ["settings sync", async dev => { await dev.tab("settings"); await dev.click('#settings-segmented [data-seg="sync"]'); }],
  ["settings data", async dev => { await dev.tab("settings"); await dev.click('#settings-segmented [data-seg="data"]'); }],
  ["insights glucose stats", async dev => { await dev.tab("history"); await dev.click('#history-segmented [data-seg="glucose"]'); await dev.click('[data-glview="stats"]'); await sleep(400); }],
  ["insights glucose day", async dev => { await dev.tab("history"); await dev.click('#history-segmented [data-seg="glucose"]'); await dev.click('[data-glview="day"]'); await sleep(500); }],
  ["edit meal sheet", async dev => { await dev.tab("history"); await dev.click('#history-segmented [data-seg="log"]'); await dev.eval(`document.querySelector('[data-edit="m1"]').click()`); await sleep(500); }]
];

const now = Date.now();
const hist = [meal("m1", now - 2 * 3600000, { correctionDose: 1, glucose: 180 }), meal("m2", now - 26 * 3600000), meal("m3", now - 50 * 3600000, { noInsulin: true, mealDose: 0 })];
const failures = new Map();   // "selector" -> { themes: Set, worst, text }
let total = 0;
for (const palette of PALETTES) for (const mode of MODES) {
  const dark = mode === "dark";
  const blob = stateBlob({ history: hist, settings: { palette, darkMode: dark, darkModeAuto: false } });
  const live = `localStorage.setItem("insulinBuddy.liveGlucose", JSON.stringify({ mgdl: 130, direction: "Flat", at: Date.now() }));`;
  // Twelve Chrome starts in one run: retry a start that stalls (a known quirk of the test sandbox).
  let dev = null;
  for (let attempt = 0; attempt < 4 && !dev; attempt++) {
    try { dev = await openDevice(app, { width: 390, height: 1400, mobile: true, dark, inject: `if (!localStorage.getItem("insulinBuddy.v2")) { ${seedLocal(blob)} } ${live}`, wait: 1500 }); }
    catch { await sleep(1500); }
  }
  if (!dev) throw new Error(`Chrome would not start for ${palette}/${mode}`);
  for (const [name, go] of screens) {
    try { await go(dev); } catch { /* a screen that can't be reached in this setup is skipped */ }
    await sleep(350);
    const res = await dev.eval(AUDIT);
    for (const r of res) {
      total++;
      if (r.ratio + 1e-9 >= r.need) continue;
      const key = `${r.sel}`;
      const f = failures.get(key) || { themes: new Set(), worst: Infinity, text: r.text, screens: new Set(), sample: r };
      f.themes.add(`${palette}/${mode}`); f.screens.add(name);
      if (r.ratio < f.worst) { f.worst = r.ratio; f.sample = r; }
      failures.set(key, f);
    }
    if (SHOTS && name === "calculator with a meal") { await dev.eval(`document.querySelector(".dose-card").scrollIntoView({ block: "start" })`); await sleep(200); await dev.shot(`${SHOTS}/contrast-dose-${palette}-${mode}.png`); }
  }
  dev.close();
}

t.section(`TEXT CONTRAST: ${total} text checks across ${PALETTES.length} themes x ${MODES.join("/")}`);
const sorted = [...failures.entries()].sort((a, b) => a[1].worst - b[1].worst);
if (REPORT || sorted.length) for (const [sel, f] of sorted) console.log(`   ${String(f.worst).padEnd(5)} (needs ${f.sample.need})  ${sel}  "${f.text}"  fg ${f.sample.fg} on ${f.sample.bg}  in ${f.themes.size} theme/modes: ${[...f.themes].slice(0, 6).join(", ")}${f.themes.size > 6 ? "…" : ""}  [${[...f.screens].join(", ")}]`);
t.check("every piece of text meets WCAG AA contrast in every theme, light and dark", sorted.length === 0, `${sorted.length} elements below the minimum`);
await app.close();
process.exit(t.summary() ? 0 : 1);
