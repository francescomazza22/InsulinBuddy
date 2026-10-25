// Field sweep: the 2.62.1 ratio-time test, applied to every editable field on every screen, Settings panel and sheet.
// For each visible field it (1) changes the value the way a picker or keyboard does (input + change events) and checks the
// field is still the same element on the page and still has the focus (a redraw under the field closes iPhone's pickers
// and keyboard and sends further typing to a dead field), and (2) clears it, leaves it, and checks that nothing invalid
// was saved (the saved state still passes the schema) and that no setting silently changed to something else.
import { startApp, openDevice, makeChecker, seedLocal } from "./harness.js";
import { FOODS_JS, stateBlob, meal } from "./helpers.js";
const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker(); const sleep = ms => new Promise(r => setTimeout(r, ms));
const app = await startApp(DIR, null, { "foods_data.js": FOODS_JS, "manifest.json": "{}" });
const blob = stateBlob({ history: [meal("m1", Date.now() - 2 * 3600e3)] });
blob.settings.timeRatios = [
  { id: "am", name: "Morning", start: "06:00", end: "11:00", ratio: 8, color: "#1F9E93" },
  { id: "rest", name: "Rest of day", start: "11:00", end: "06:00", ratio: 12, color: "#6366F1" }
];
blob.settings.activityRatios = [{ id: "ar1", name: "Sport", ratio: 15, color: "#D6A419" }];
blob.recipes = [{ id: "r1", name: "Torta", items: [{ refType: "food", refId: "s1", name: "Pane comune", grams: 200, carbsPer100g: 65, kcalPer100g: 300 }], rawWeight: 200, finalWeight: 180 }];
const dev = await openDevice(app, { width: Number(process.env.SWEEP_WIDTH || 390), height: 900, mobile: Number(process.env.SWEEP_WIDTH || 390) < 1000, inject: `if (!localStorage.getItem("insulinBuddy.v2")) { ${seedLocal(blob)} }`, wait: 1800 });
await dev.cdp.send("Page.bringToFront"); await dev.cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });

// Fields whose empty value legitimately means something ("no URL", "nothing searched"), so clearing them may change state.
const CLEAR_OK = new Set(["ns-url", "ns-token", "ns-secret", "lib-search", "history-search", "cc-search", "cc-glucose", "cc-batch-weight", "cc-grams", "cc-correction-manual-input", "cc-eating-out-dose"]);
await dev.eval(`window.__probe = async (rootSel, label) => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const { validateState, hasErrors } = await import("./js/core/schema.js");
  const stored = () => { try { return JSON.parse(localStorage.getItem("insulinBuddy.v2")); } catch { return null; } };
  const valid = () => { const s = stored(); return !s || !hasErrors(validateState(s).filter(p => p.severity === "error")) ; };
  const closeDialogs = async () => { for (const b of document.querySelectorAll(".dialog-backdrop .dialog__btn--ghost, .dialog-backdrop .dialog__btn--primary")) { b.click(); await sleep(60); } };
  const pad = n => String(n).padStart(2, "0");
  const local = ts => { const d = new Date(ts); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes()); };
  const skip = new Set(["file", "password", "hidden", "checkbox", "radio", "button", "submit", "range", "color", "search-none"]);
  const visible = e => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length) && !e.closest("[hidden]");
  const root = document.querySelector(rootSel);
  if (!root) return [{ label, name: "(root missing: " + rootSel + ")", missing: true }];
  const fields = [...root.querySelectorAll("input, select, textarea")].filter(e => !skip.has(e.type) && !e.disabled && !e.readOnly && visible(e));
  const out = [];
  for (const f of fields) {
    const name = f.id || (f.dataset.field ? f.dataset.field + "[" + (f.dataset.id || f.dataset.idx || f.dataset.gidx || "") + "]" : "") || f.name || f.getAttribute("aria-label") || f.className || f.type;
    if (!f.isConnected) { out.push({ label, name, type: f.type, lostEarlier: true }); continue; }
    const rec = { label, name, type: f.type || f.tagName.toLowerCase() };
    const orig = f.value;
    // 1) change it
    f.focus();
    let nv;
    if (f.tagName === "SELECT") { const alt = [...f.options].find(o => !o.disabled && o.value !== orig); nv = alt ? alt.value : orig; }
    else if (f.type === "time") nv = orig === "13:30" ? "14:30" : "13:30";
    else if (f.type === "datetime-local") nv = local(Date.now() - 3600e3);
    else if (f.type === "date") nv = local(Date.now() - 86400e3).slice(0, 10);
    else if (f.type === "number" || f.inputMode === "decimal" || f.inputMode === "numeric") nv = String((parseFloat(String(orig).replace(",", ".")) || 4) + 1);
    else nv = orig ? orig + " 2" : "a";
    f.value = nv;
    f.dispatchEvent(new Event("input", { bubbles: true })); await sleep(40);
    f.dispatchEvent(new Event("change", { bubbles: true })); await sleep(150);
    rec.dialog = !!document.querySelector(".dialog-backdrop");
    rec.kept = f.isConnected;
    rec.focused = document.activeElement === f;
    await closeDialogs();
    if (!f.isConnected || f.tagName === "SELECT") { out.push(rec); continue; }
    // 2) clear it and leave it
    const before = JSON.stringify((stored() || {}).settings);
    f.focus();
    f.value = "";
    f.dispatchEvent(new Event("input", { bubbles: true })); await sleep(40);
    f.dispatchEvent(new Event("change", { bubbles: true })); await sleep(120);
    rec.clearDialog = !!document.querySelector(".dialog-backdrop");
    await closeDialogs();
    if (f.isConnected) { f.blur(); await sleep(120); }
    rec.validAfterClear = valid();
    rec.settingsChangedByClear = JSON.stringify((stored() || {}).settings) !== before;
    rec.valueAfterClear = f.isConnected ? f.value : "(gone)";
    // put the original back so later fields start from sane values
    if (f.isConnected) { f.focus(); f.value = orig; f.dispatchEvent(new Event("input", { bubbles: true })); f.dispatchEvent(new Event("change", { bubbles: true })); await sleep(80); await closeDialogs(); f.blur(); await sleep(40); }
    out.push(rec);
  }
  return out;
}`);

const all = [];
const probe = async (sel, label) => { const r = await dev.eval(`window.__probe(${JSON.stringify(sel)}, ${JSON.stringify(label)})`); all.push(...r); return r; };
const closeSheet = async () => {
  await dev.eval(`(() => { const b = document.querySelector(".sheet-backdrop .sheet-close, .sheet-backdrop #em-cancel, .sheet-backdrop [id$='-cancel']"); if (b) b.click(); else document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); })()`);
  await sleep(450);
  await dev.eval(`document.querySelectorAll(".sheet-backdrop").forEach(b => b.remove())`);
};

// Screens
await dev.tab("calculator"); await sleep(300);
await dev.waitFor(`document.getElementById("cc-food-list").children.length > 0`).catch(() => {});
await dev.eval(`document.getElementById("cc-food-list").children[0].click()`); await sleep(150);
await dev.eval(`(() => { const g = document.getElementById("cc-grams"); g.value = "80"; g.dispatchEvent(new Event("input", { bubbles: true })); })()`);
await dev.click("#cc-add-btn"); await sleep(200);
await probe("#view-calculator", "Calculator");
await dev.click("#cc-browse-btn").catch(() => {}); await sleep(400);
await probe(".sheet-backdrop", "Browse sheet"); await closeSheet();
await dev.eval(`document.getElementById("active-panel") && document.getElementById("active-panel").click()`); await sleep(400);
if (await dev.eval(`!!document.querySelector(".sheet-backdrop")`)) { await probe(".sheet-backdrop", "Active insulin sheet"); await closeSheet(); }

await dev.tab("history"); await sleep(400);
for (const sub of await dev.eval(`[...document.querySelectorAll("#history-segmented .segmented__btn")].map(b => b.dataset.seg || b.dataset.hseg || b.textContent.trim())`)) {
  await dev.eval(`(() => { const b = [...document.querySelectorAll("#history-segmented .segmented__btn")].find(x => (x.dataset.seg || x.dataset.hseg || x.textContent.trim()) === ${JSON.stringify(sub)}); b && b.click(); })()`); await sleep(400);
  await probe("#view-history", "Insights · " + sub);
}
await dev.eval(`[...document.querySelectorAll("#history-segmented .segmented__btn")][0].click()`); await sleep(300);
await dev.eval(`(() => { const b = document.querySelector('#view-history [data-edit="m1"]'); if (b) b.click(); })()`); await sleep(450);
await probe(".sheet-backdrop", "Edit Meal sheet"); await closeSheet();
await dev.click("#btn-log-basal").catch(() => {}); await sleep(450);
await probe(".sheet-backdrop", "Basal sheet"); await closeSheet();

await dev.tab("settings"); await sleep(300);
for (const seg of ["ratios", "library", "sync", "data", "general"]) {
  await dev.click(`#settings-segmented [data-seg="${seg}"]`); await sleep(350);
  if (seg === "ratios") { await dev.eval(`document.querySelectorAll("#time-ratio-list [data-toggle]").forEach(x => x.click())`); await sleep(150); }
  await probe(`#panel-${seg}`, "Settings · " + seg);
  if (seg === "library") {
    for (const lseg of ["foods", "recipes"]) {
      await dev.eval(`(() => { const b = document.querySelector('#panel-library [data-libseg="${lseg}"], #panel-library [data-seg="${lseg}"]'); b && b.click(); })()`); await sleep(300);
      await dev.eval(`(() => { const b = document.getElementById("lib-add-btn") || document.querySelector("#panel-library .lib-add, #panel-library [data-act='add']"); b && b.click(); })()`); await sleep(450);
      if (await dev.eval(`!!document.querySelector(".sheet-backdrop")`)) { await probe(".sheet-backdrop", (lseg === "foods" ? "Food" : "Recipe") + " sheet (new)"); await closeSheet(); }
    }
  }
}
await dev.click("#btn-diag-view").catch(() => {}); await sleep(450);
if (await dev.eval(`!!document.querySelector(".sheet-backdrop")`)) { await probe(".sheet-backdrop", "Diagnostics log sheet"); await closeSheet(); }
await dev.click("#sync-chip").catch(() => {}); await sleep(450);
if (await dev.eval(`!!document.querySelector(".sheet-backdrop")`)) { await probe(".sheet-backdrop", "Sync sheet"); await closeSheet(); }

// Report
const fields = all.filter(r => !r.missing);
const where = r => `${r.label} › ${r.name} (${r.type})`;
t.section(`FIELD SWEEP: ${fields.length} fields in ${new Set(fields.map(r => r.label)).size} places`);
console.log([...new Set(fields.map(r => r.label))].map(l => `  ${l}: ${fields.filter(r => r.label === l).length}`).join("\n"));
for (const m of all.filter(r => r.missing)) console.log("  (not found) " + m.label + " " + m.name);
const rebuilt = fields.filter(r => r.kept === false || r.lostEarlier);
t.check("no field is rebuilt under the finger when it changes", !rebuilt.length, rebuilt.map(where).join("; "));
const unfocused = fields.filter(r => r.kept && !r.focused && !r.dialog);
t.check("every field keeps the focus after a change", !unfocused.length, unfocused.map(where).join("; "));
const invalid = fields.filter(r => r.validAfterClear === false);
t.check("clearing a field never saves an invalid state", !invalid.length, invalid.map(where).join("; "));
const silent = fields.filter(r => r.settingsChangedByClear && !CLEAR_OK.has(r.name));
t.check("clearing a field never silently changes a setting", !silent.length, silent.map(r => `${where(r)} → box shows "${r.valueAfterClear}"`).join("; "));
const errs = [...dev.errors, ...(await dev.eval(`window.__errs || []`))];
t.check("no page errors", !errs.length, errs.slice(0, 5).join(" | "));
dev.close(); await app.close(); t.done && t.done(); process.exit(0);
