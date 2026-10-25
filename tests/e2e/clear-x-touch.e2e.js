// The clear X, tapped for real. Earlier tests called button.click() from script, which skips the touch events an iPhone
// sends; the X cancelled touchstart (to keep the keyboard up), and on a touch screen that also cancels the click, so
// tapping the X did nothing. This test finds every field that gets an X on every screen, panel and sheet and taps the X
// with real touch events (and, separately, a real mouse click), checking the field empties, keeps the focus and the app
// hears about it (an "input" event fires).
import { startApp, openDevice, makeChecker, seedLocal } from "./harness.js";
import { FOODS_JS, stateBlob, meal } from "./helpers.js";
const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker(); const sleep = ms => new Promise(r => setTimeout(r, ms));
const app = await startApp(DIR, null, { "foods_data.js": FOODS_JS, "manifest.json": "{}" });
const blob = stateBlob({ history: [meal("m1", Date.now() - 2 * 3600e3)] });
blob.settings.timeRatios = [{ id: "all", name: "All day", start: "00:00", end: "00:00", ratio: 10, color: "#1F9E93" }];
blob.recipes = [{ id: "r1", name: "Torta", items: [{ refType: "food", refId: "s1", name: "Pane comune", grams: 200, carbsPer100g: 65, kcalPer100g: 300 }], rawWeight: 200, finalWeight: 180 }];
const W = Number(process.env.X_WIDTH || 390);
const dev = await openDevice(app, { width: W, height: 900, mobile: W < 1000, inject: `if (!localStorage.getItem("insulinBuddy.v2")) { ${seedLocal(blob)} }`, wait: 1800 });
await dev.cdp.send("Page.bringToFront"); await dev.cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
await dev.cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });

const results = [];
// Every visible field that gets an X, as a list of selectors we can find again.
const listFields = sel => dev.eval(`(async () => {
  const { isClearable } = await import("./js/clear-field.js");
  const root = document.querySelector(${JSON.stringify(sel)}); if (!root) return [];
  const vis = e => !!(e.offsetWidth || e.offsetHeight) && !e.closest("[hidden]");
  return [...root.querySelectorAll("input")].filter(i => vis(i) && isClearable(i)).map((i, k) => { i.dataset.xprobe = ${JSON.stringify(sel)}.replace(/\\W/g, "") + k; return { key: i.dataset.xprobe, name: i.id || i.placeholder || i.getAttribute("aria-label") || i.type, type: i.type }; });
})()`);
const tapAt = async (x, y, how) => {
  if (how === "touch") {
    await dev.cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] }); await sleep(40);
    await dev.cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } else {
    await dev.cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 }); await sleep(30);
    await dev.cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  }
  await sleep(200);
};
async function tryField(label, f, how) {
  const sel = `[data-xprobe="${f.key}"]`;
  const prep = await dev.eval(`(() => {
    const i = document.querySelector('${sel}'); if (!i) return null;
    i.scrollIntoView({ block: "center" }); i.focus();
    i.value = i.type === "number" || i.inputMode === "decimal" || i.inputMode === "numeric" ? "12" : "abc";
    i.dispatchEvent(new Event("input", { bubbles: true }));
    window.__xin = 0; i.addEventListener("input", () => window.__xin++, { once: true });
    const b = document.querySelector(".field-clear"); if (!b || !b.isConnected) return { noX: true };
    const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (!prep) return;
  const rec = { label, name: f.name, how };
  if (prep.noX) { rec.noX = true; results.push(rec); return; }
  await tapAt(prep.x, prep.y, how);
  Object.assign(rec, await dev.eval(`(() => { const i = document.querySelector('${sel}'); return { cleared: !!i && i.value === "", heard: window.__xin > 0, focused: document.activeElement === i }; })()`));
  results.push(rec);
  await dev.eval(`(() => { const i = document.querySelector('${sel}'); if (i) { i.blur(); } })()`); await sleep(60);
}
async function probe(sel, label) {
  for (const f of await listFields(sel)) for (const how of ["touch", "mouse"]) { await tryField(label, f, how); await sleep(400); }
}
const closeSheet = async () => {
  await dev.eval(`(() => { const b = document.querySelector(".sheet-backdrop .sheet-close, .sheet-backdrop [id$='-cancel']"); if (b) b.click(); })()`); await sleep(450);
  await dev.eval(`document.querySelectorAll(".sheet-backdrop").forEach(b => b.remove())`);
};
const opened = () => dev.eval(`!!document.querySelector(".sheet-backdrop")`);

await dev.tab("calculator"); await sleep(300);
await probe("#view-calculator", "Calculator");
await dev.eval(`document.getElementById("cc-browse-btn").click()`); await sleep(400);
if (await opened()) { await probe(".sheet-backdrop", "Browse sheet"); await closeSheet(); }
await dev.tab("history"); await sleep(400);
for (const seg of ["log", "trends", "glucose"]) { await dev.eval(`document.querySelector('#history-segmented [data-seg="${seg}"]').click()`); await sleep(350); await probe("#view-history", "Insights · " + seg); }
await dev.eval(`document.querySelector('#history-segmented [data-seg="log"]').click()`); await sleep(300);
await dev.eval(`(() => { const b = document.querySelector('#view-history [data-edit="m1"]'); b && b.click(); })()`); await sleep(450);
if (await opened()) { await probe(".sheet-backdrop", "Edit Meal sheet"); await closeSheet(); }
await dev.eval(`document.getElementById("btn-log-basal").click()`); await sleep(450);
if (await opened()) { await probe(".sheet-backdrop", "Basal sheet"); await closeSheet(); }
await dev.tab("settings"); await sleep(300);
for (const seg of ["ratios", "library", "sync", "data", "general"]) {
  await dev.eval(`document.querySelector('#settings-segmented [data-seg="${seg}"]').click()`); await sleep(350);
  if (seg === "library") {
    for (const l of ["foods", "recipes"]) {
      await dev.eval(`document.querySelector('#lib-segmented [data-seg="${l}"]').click()`); await sleep(300);
      await probe("#panel-library", "Library · " + l);
      await dev.eval(`document.getElementById("lib-add-btn").click()`); await sleep(450);
      if (await opened()) { await probe(".sheet-backdrop", (l === "foods" ? "Food" : "Recipe") + " sheet"); await closeSheet(); }
    }
  } else await probe(`#panel-${seg}`, "Settings · " + seg);
}

const where = r => `${r.label} › ${r.name} (${r.how})`;
t.section(`CLEAR X: ${new Set(results.map(r => r.label + r.name)).size} fields, each tapped by touch and by mouse`);
console.log([...new Set(results.map(r => r.label))].map(l => `  ${l}: ${results.filter(r => r.label === l && r.how === "touch").map(r => r.name).join(", ")}`).join("\n"));
t.check("found the Library search among them", results.some(r => r.name === "lib-search"));
const noX = results.filter(r => r.noX);
t.check("every clearable field shows an X once it has text", !noX.length, noX.map(where).join("; "));
for (const how of ["touch", "mouse"]) {
  const bad = results.filter(r => r.how === how && !r.noX && !r.cleared);
  t.check(`tapping the X by ${how} empties the field`, !bad.length, bad.map(where).join("; "));
  const deaf = results.filter(r => r.how === how && r.cleared && !r.heard);
  t.check(`and the app hears it (${how})`, !deaf.length, deaf.map(where).join("; "));
  const lost = results.filter(r => r.how === how && r.cleared && !r.focused);
  t.check(`and the field keeps the focus, so the keyboard stays up (${how})`, !lost.length, lost.map(where).join("; "));
}
t.section("CLEAR X: clearing a box and leaving it");
await dev.eval(`document.querySelector('#settings-segmented [data-seg="ratios"]').click()`); await sleep(300);
const tapX = async (id, typed) => {
  const p = await dev.eval(`(() => { const i = document.getElementById("${id}"); i.scrollIntoView({ block: "center" }); i.focus(); i.value = "${typed}"; i.dispatchEvent(new Event("input", { bubbles: true })); const r = document.querySelector(".field-clear").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await tapAt(p.x, p.y, "touch");
};
const savedDia = await dev.eval(`JSON.parse(localStorage.getItem("insulinBuddy.v2")).settings.insulinModel.diaMinutes`);
await tapX("insulin-dia-input", "300");
t.check("the X empties a timing box and it stays empty while you type", (await dev.eval(`document.getElementById("insulin-dia-input").value`)) === "");
await dev.eval(`document.getElementById("insulin-dia-input").blur()`); await sleep(250);
t.check("leaving it empty puts the saved value back (nothing changed)", (await dev.eval(`document.getElementById("insulin-dia-input").value`)) === String(savedDia), await dev.eval(`document.getElementById("insulin-dia-input").value`));
await tapX("insulin-dia-input", String(savedDia));
await dev.eval(`(() => { const i = document.getElementById("insulin-dia-input"); i.value = "300"; i.dispatchEvent(new Event("input", { bubbles: true })); i.dispatchEvent(new Event("change", { bubbles: true })); i.blur(); })()`); await sleep(250);
t.check("clearing then typing a new value saves the new value", (await dev.eval(`JSON.parse(localStorage.getItem("insulinBuddy.v2")).settings.insulinModel.diaMinutes`)) === 300);

t.section("OTHER X BUTTONS: tapped by touch");
const tapSel = async sel => {
  const p = await dev.eval(`(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (!b) return null; b.scrollIntoView({ block: "center" }); const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  if (p) await tapAt(p.x, p.y, "touch");
  return !!p;
};
await dev.tab("calculator"); await sleep(300);
await dev.eval(`(() => { const s = document.getElementById("cc-search"); s.focus(); s.value = "Pane"; s.dispatchEvent(new Event("input", { bubbles: true })); })()`); await sleep(250);
await tapSel("#cc-search-clear");
t.check("the food search's own X clears it", (await dev.eval(`document.getElementById("cc-search").value`)) === "");
await dev.eval(`document.getElementById("cc-food-list").children[0].click()`); await sleep(150);
await dev.eval(`(() => { const g = document.getElementById("cc-grams"); g.value = "50"; g.dispatchEvent(new Event("input", { bubbles: true })); document.getElementById("cc-add-btn").click(); })()`); await sleep(250);
await tapSel(".meal-item__remove");
t.check("a meal item's remove X removes it", (await dev.eval(`document.querySelectorAll(".meal-item").length`)) === 0);
await dev.eval(`document.getElementById("cc-browse-btn").click()`); await sleep(400);
await tapSel(".sheet-backdrop .sheet-close"); await sleep(400);
t.check("a sheet's close X closes it", !(await opened()));
const errs = [...dev.errors, ...(await dev.eval(`window.__errs || []`))];
t.check("no page errors", !errs.length, errs.slice(0, 4).join(" | "));
dev.close(); await app.close(); t.done && t.done(); process.exit(0);
