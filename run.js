// Insulin Buddy — test suite
//
// Run with: npm test  (or: node tests/run.js)
// Requires Node + jsdom (npm install first — this is dev-only, the app
// itself has no dependencies and no build step).
//
// This loads the real index.html/app.js/foods_data.js into a simulated
// browser (jsdom) and drives the UI exactly like a person would — clicking
// buttons, filling in fields — rather than calling internal functions
// directly, so it exercises the same code paths a real user hits.

const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

let passed = 0;
let failed = 0;
const failures = [];

function check(desc, condition) {
  if (condition) {
    passed++;
  } else {
    failed++;
    failures.push(desc);
    console.error("  ✗ " + desc);
  }
}
function section(name) {
  console.log("\n" + name);
}

function newApp({ withSupabase = false, mockFetch = null, preSeedStorage = null } = {}) {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://localhost/", pretendToBeVisual: true });
  const { window } = dom;
  window.crypto.subtle = global.crypto.subtle;
  window.structuredClone = window.structuredClone || (obj => JSON.parse(JSON.stringify(obj)));
  const store = {};
  window.localStorage = {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }
  };
  window.confirm = () => true;
  window.alert = () => {};
  if (mockFetch) window.fetch = mockFetch;
  window.supabase = withSupabase ? withSupabase : {
    createClient: () => ({
      auth: {
        onAuthStateChange(cb) {
          setTimeout(() => cb("INITIAL_SESSION", null), 0);
          return { data: { subscription: { unsubscribe() {} } } };
        }
      }
    })
  };
  const errors = [];
  window.addEventListener("error", e => errors.push(e.error ? e.error.stack : e.message));
  window.addEventListener("unhandledrejection", e => errors.push(e.reason ? (e.reason.stack || e.reason) : e));

  // window.localStorage = {...} above doesn't actually replace jsdom's own
  // real localStorage (a known jsdom quirk — the assignment is silently a
  // no-op), so app.js's own calls always hit jsdom's real store underneath,
  // not the `store` object above. That's harmless for tests that only read
  // and write during the test itself (both sides consistently hit the same
  // real store), but a test that needs an EXISTING saved state before boot
  // must seed it through the real API, not by pre-populating `store`.
  if (preSeedStorage) {
    for (const [k, v] of Object.entries(preSeedStorage)) window.localStorage.setItem(k, v);
  }

  window.eval(fs.readFileSync(path.join(ROOT, "foods_data.js"), "utf8"));
  window.eval(fs.readFileSync(path.join(ROOT, "app.js"), "utf8"));

  return { window, d: window.document, errors };
}

function click(win, elx) {
  elx.dispatchEvent(new win.Event("click", { bubbles: true }));
}
function input(win, elx, value) {
  elx.value = value;
  elx.dispatchEvent(new win.Event("input", { bubbles: true }));
}
function wait(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function run() {
  // ================= Boot =================
  section("Boot");
  {
    const { d, errors } = newApp();
    await wait(100);
    check("app boots with no JS errors", errors.length === 0);
    check("dose card renders", d.getElementById("cc-dose-number").textContent === "0.0");
    click(d.defaultView, d.querySelector('[data-target="library"]'));
    check("library has items", document_query_count(d, "#lib-foods-list .lib-item") > 0);
  }

  // ================= Calculator: dose math =================
  section("Calculator dose math");
  {
    const { window: win, d, errors } = newApp();
    await wait(100);

    // Add 150g of "Mela" (apple, 25g carbs/100g in the seed data) — expect 37.5g carbs
    input(win, d.getElementById("cc-search"), "Mela");
    click(win, d.getElementById("cc-food-list").children[0]);
    input(win, d.getElementById("cc-grams"), "150");
    click(win, d.getElementById("cc-add-btn"));
    check("carbs pill shows 37.5g after adding 150g apple", d.getElementById("cc-carbs-pill").textContent.includes("37.5"));

    const ratioText = d.getElementById("cc-ratio-value").textContent; // "1:X"
    const ratio = parseFloat(ratioText.split(":")[1]);
    const expectedDose = Math.round((37.5 / ratio) / 0.5) * 0.5; // default rounding is 0.5
    check("dose matches carbs ÷ active ratio, rounded",
      Math.abs(parseFloat(d.getElementById("cc-dose-number").textContent) - expectedDose) < 0.01);

    // Correction
    click(win, d.getElementById("cc-correction-toggle"));
    input(win, d.getElementById("cc-glucose"), "200");
    const isf = 50, target = 100; // app defaults
    const correction = Math.max(0, (200 - target) / isf);
    const expectedTotal = Math.round((expectedDose + correction) / 0.5) * 0.5;
    check("dose includes correction when toggled on",
      Math.abs(parseFloat(d.getElementById("cc-dose-number").textContent) - expectedTotal) < 0.01);

    // Glucose unit toggle (mg/dL <-> mmol/L)
    const doseAtMgdl = d.getElementById("cc-dose-number").textContent;
    check("glucose unit defaults to mg/dL", d.getElementById("cc-glucose-unit").textContent === "mg/dL");
    click(win, d.getElementById("cc-glucose-unit"));
    check("toggling converts 200 mg/dL to ~11.1 mmol/L", d.getElementById("cc-glucose").value === "11.1");
    check("dose is unchanged by the unit toggle (same physical reading)", d.getElementById("cc-dose-number").textContent === doseAtMgdl);
    input(win, d.getElementById("cc-glucose"), "11.1");
    check("entering 11.1 mmol/L directly gives the same dose as 200 mg/dL", d.getElementById("cc-dose-number").textContent === doseAtMgdl);

    check("no JS errors during calculator use", errors.length === 0);
  }

  // ================= Library: CRUD + undo =================
  section("Library CRUD + undo");
  {
    const { window: win, d, errors } = newApp();
    await wait(100);
    click(win, d.querySelector('[data-target="library"]'));

    const beforeCount = document_query_count(d, "#lib-foods-list .lib-item");

    // Add a new food via the sheet
    click(win, d.getElementById("lib-add-btn"));
    const sheet = d.querySelector(".sheet-backdrop");
    check("Add Food sheet opens", !!sheet);
    input(win, sheet.querySelector("#fs-name"), "Test Oats");
    input(win, sheet.querySelector("#fs-carbs"), "60");
    click(win, sheet.querySelector("#fs-save"));
    check("food count increases by 1 after adding", document_query_count(d, "#lib-foods-list .lib-item") === beforeCount + 1);

    // Delete it (should be undo-able, no confirm dialog needed)
    input(win, d.getElementById("lib-search"), "Test Oats");
    const delBtn = d.querySelector('#lib-foods-list [data-act="delete"]');
    check("found the delete button for the new food", !!delBtn);
    click(win, delBtn);
    check("food removed immediately (no confirm needed)", document_query_count(d, "#lib-foods-list .lib-item") === 0);
    check("undo toast appears", !d.getElementById("undo-toast").hidden);
    check("undo toast message names the food", d.getElementById("undo-toast-message").textContent.includes("Test Oats"));

    click(win, d.getElementById("undo-toast-btn"));
    check("food restored after clicking undo", document_query_count(d, "#lib-foods-list .lib-item") === 1);
    check("undo toast hides after use", d.getElementById("undo-toast").hidden);

    check("no JS errors during library CRUD", errors.length === 0);
  }

  // ================= Recipes: per-100g math =================
  section("Recipes (per-100g via Final Weight)");
  {
    const { window: win, d, errors } = newApp();
    await wait(100);
    click(win, d.querySelector('[data-target="library"]'));
    click(win, d.querySelectorAll("#lib-segmented .segmented__btn")[1]); // Recipes
    click(win, d.getElementById("lib-add-btn"));
    const sheet = d.querySelector(".sheet-backdrop");
    input(win, sheet.querySelector("#rs-name"), "Test Recipe");

    const ingSearch = sheet.querySelector("#rs-ing-search");
    input(win, ingSearch, "Banana");
    const dropdown = sheet.querySelector("#rs-ing-dropdown");
    check("ingredient dropdown shows matches", dropdown.children.length > 0);
    click(win, dropdown.children[0]);
    input(win, sheet.querySelector("#rs-ing-weight"), "200");
    click(win, sheet.querySelector("#rs-ing-add"));
    check("ingredient added to the list", sheet.querySelectorAll(".ingredient-row").length === 1);

    // Try saving without a final weight -- should be rejected
    const originalAlert = win.alert;
    let alertMsg = "";
    win.alert = m => { alertMsg = m; };
    click(win, sheet.querySelector("#rs-save"));
    check("save without Final Weight is rejected", alertMsg.includes("Final Weight"));
    check("sheet stays open after rejection", !!d.querySelector(".sheet-backdrop"));

    input(win, sheet.querySelector("#rs-final-weight"), "160");
    click(win, sheet.querySelector("#rs-save"));
    check("sheet closes after valid save", !d.querySelector(".sheet-backdrop"));

    input(win, d.getElementById("lib-search"), "Test Recipe");
    const recipeRow = d.querySelector("#lib-recipes-list .lib-item");
    check("recipe appears in the library", !!recipeRow);

    check("no JS errors during recipe creation", errors.length === 0);
  }

  // ================= History: log, edit, use again, delete+undo =================
  section("History: log, edit, use again, delete + undo");
  {
    const { window: win, d, errors } = newApp();
    await wait(100);

    input(win, d.getElementById("cc-search"), "Mela");
    click(win, d.getElementById("cc-food-list").children[0]);
    input(win, d.getElementById("cc-grams"), "150");
    click(win, d.getElementById("cc-add-btn"));
    click(win, d.getElementById("cc-log-btn"));
    check("Clear All / current-meal UI resets after logging", d.getElementById("cc-clear-all-btn").hidden);

    click(win, d.querySelector('[data-target="history"]'));
    check("meal appears in history", document_query_count(d, ".history-entry") === 1);

    // Use Again
    click(win, d.querySelector("[data-use]"));
    check("Use Again switches to Calculator", !d.getElementById("view-calculator").hidden);
    check("Use Again loads the item into the current meal", d.getElementById("cc-meal-items").children.length === 1);

    // Edit
    click(win, d.querySelector('[data-target="history"]'));
    click(win, d.querySelector("[data-edit]"));
    const editSheet = d.querySelector(".sheet-backdrop");
    check("Edit Meal sheet opens", !!editSheet);
    const gramsInput = editSheet.querySelector(".em-grams-input");
    input(win, gramsInput, "300");
    check("preview updates live as grams change", editSheet.querySelector("#em-preview").textContent.includes("75"));
    click(win, editSheet.querySelector("#em-save"));

    const entryAfterEdit = d.querySelector(".history-entry");
    check("edited entry reflects new total carbs", entryAfterEdit.textContent.includes("75"));

    // Delete + undo
    click(win, d.querySelector("[data-del]"));
    check("history entry removed immediately", document_query_count(d, ".history-entry") === 0);
    check("undo toast shown for meal deletion", d.getElementById("undo-toast-message").textContent.includes("Meal deleted"));
    click(win, d.getElementById("undo-toast-btn"));
    check("history entry restored after undo", document_query_count(d, ".history-entry") === 1);

    check("no JS errors during history flow", errors.length === 0);
  }

  // ================= Trends =================
  section("Trends");
  {
    const { window: win, d, errors } = newApp();
    await wait(100);

    input(win, d.getElementById("cc-search"), "Mela");
    click(win, d.getElementById("cc-food-list").children[0]);
    input(win, d.getElementById("cc-grams"), "100");
    click(win, d.getElementById("cc-add-btn"));
    click(win, d.getElementById("cc-log-btn"));

    input(win, d.getElementById("cc-search"), "Mela");
    click(win, d.getElementById("cc-food-list").children[0]);
    input(win, d.getElementById("cc-grams"), "200");
    click(win, d.getElementById("cc-add-btn"));
    click(win, d.getElementById("cc-log-btn"));

    click(win, d.querySelector('[data-target="history"]'));
    click(win, d.querySelectorAll("#history-segmented .segmented__btn")[1]);
    check("Trends panel becomes visible", !d.getElementById("history-trends-panel").hidden);
    check("Log panel hides", d.getElementById("history-log-panel").hidden);

    const stats = [...d.getElementById("trend-stats").children].map(c => c.textContent);
    check("meals-logged stat shows 2", stats[0].includes("2"));
    check("avg carbs stat shows 75g (25g + 50g on the same day)", stats[1].includes("75"));

    check("carbs chart has 14 bars by default", (d.getElementById("trend-chart-carbs").innerHTML.match(/<rect/g) || []).length === 14);
    click(win, d.querySelectorAll("#trends-range-segmented .segmented__btn")[0]); // 7 days
    check("switching to 7-day range redraws with 7 bars", (d.getElementById("trend-chart-carbs").innerHTML.match(/<rect/g) || []).length === 7);

    check("no JS errors during trends", errors.length === 0);
  }

  // ================= GI seed-patch migration (existing saved libraries) =================
  section("GI migration patches existing libraries without disturbing other fields");
  {
    const oldLibrary = [
      { id: "food-mela", name: "Mela", category: "fruits", carbs: 30, kcal: 60, protein: null, fat: 0.3, salt: null, notes: "my own note", favorite: true, usageCount: 42 },
      { id: "food-avocado", name: "Avocado", category: "fruits", carbs: 2, kcal: 160, protein: 2, fat: 15, salt: null, notes: "", favorite: false, usageCount: 5 },
      { id: "food-custom-gi", name: "Pane comune", category: "grains", carbs: 50, kcal: 250, protein: 8, fat: 1, salt: null, gi: 60, notes: "already has a manually-set GI", favorite: false, usageCount: 10 }
    ];
    const oldState = { settings: { isf: 50, target: 100, units: "mgdl", rounding: "0.5", maxDose: 15, timeRatios: [], activityRatios: [], palette: "blueViolet", darkMode: false }, library: oldLibrary, recipes: [], history: [] };
    const { window: win, d, errors } = newApp({ preSeedStorage: { "insulinBuddy.v2": JSON.stringify(oldState) } });
    await wait(300); // the migration's saveState() is async

    const saved = JSON.parse(win.localStorage.getItem("insulinBuddy.v2"));
    const mela = saved.library.find(f => f.name === "Mela");
    check("GI gets patched onto a matching existing food", mela.gi === 36);
    check("that food's other custom fields are untouched (carbs)", mela.carbs === 30);
    check("...and kcal", mela.kcal === 60);
    check("...and favorite/usageCount/notes", mela.favorite === true && mela.usageCount === 42 && mela.notes === "my own note");

    const avocado = saved.library.find(f => f.name === "Avocado");
    check("a food with no seed match is left alone", avocado.gi === undefined);

    const paneComune = saved.library.find(f => f.name === "Pane comune");
    check("an already-set GI value is never overwritten by the seed patch", paneComune.gi === 60);

    check("no JS errors during the migration", errors.length === 0);
  }

  // ================= Glycemic index / glycemic load =================
  section("Glycemic index & glycemic load");
  {
    const { window: win, d, errors } = newApp();
    await wait(100);

    // Mela is seeded with GI 36, 25g carbs/100g. 150g -> 37.5g carbs -> GL = 36*37.5/100 = 13.5
    input(win, d.getElementById("cc-search"), "Mela");
    click(win, d.getElementById("cc-food-list").children[0]);
    input(win, d.getElementById("cc-grams"), "150");
    click(win, d.getElementById("cc-add-btn"));

    const glIndicator = d.getElementById("cc-gl-indicator");
    check("GL indicator becomes visible once an item with a GI value is added", !glIndicator.hidden);
    check("GL computed correctly (36 x 37.5 / 100 = 13.5)", glIndicator.textContent === "GL 13.5");
    check("GL band is 'medium' for a value in the 11-19 range", glIndicator.className.includes("gl-indicator--medium"));

    // Adding a food with no GI data should mark the total as partial
    input(win, d.getElementById("cc-search"), "Avocado");
    click(win, d.getElementById("cc-food-list").children[0]);
    input(win, d.getElementById("cc-grams"), "50");
    click(win, d.getElementById("cc-add-btn"));
    check("GL total is marked partial when an item has no GI value", glIndicator.textContent === "GL 13.5*");

    click(win, d.getElementById("cc-log-btn"));
    click(win, d.querySelector('[data-target="history"]'));
    const entry = d.querySelector(".history-entry");
    click(win, entry);
    check("history detail shows the same GL, snapshotted", entry.querySelector(".gl-indicator").textContent === "GL 13.5*");

    // Editing a food's GI in the Library should show up there, and the CSV round-trip should carry it
    click(win, d.querySelector('[data-target="library"]'));
    input(win, d.getElementById("lib-search"), "Mela");
    click(win, d.querySelector('#lib-foods-list [data-act="edit"]'));
    const sheet = d.querySelector(".sheet-backdrop");
    check("Edit Food sheet pre-fills the existing GI value", sheet.querySelector("#fs-gi").value === "36");
    input(win, sheet.querySelector("#fs-gi"), "40");
    click(win, sheet.querySelector("#fs-save"));
    input(win, d.getElementById("lib-search"), "Mela");
    check("Library reflects the updated GI badge", d.querySelector("#lib-foods-list .lib-item").textContent.includes("GI 40"));

    check("no JS errors during GI/GL flow", errors.length === 0);
  }

  // ================= Unit-based (quantity) foods =================
  section("Unit-based foods (e.g. '1 sandwich' instead of grams)");
  {
    const { window: win, d, errors } = newApp();
    await wait(100);
    click(win, d.querySelector('[data-target="library"]'));
    click(win, d.getElementById("lib-add-btn"));
    const sheet = d.querySelector(".sheet-backdrop");
    input(win, sheet.querySelector("#fs-name"), "Pret Sandwich");
    input(win, sheet.querySelector("#fs-carbs"), "26");
    const checkbox = sheet.querySelector("#fs-unit-based");
    checkbox.checked = true;
    checkbox.dispatchEvent(new win.Event("change", { bubbles: true }));
    check("unit fields reveal when checkbox is checked", !sheet.querySelector("#fs-unit-fields").hidden);

    click(win, sheet.querySelector("#fs-save"));
    check("save is rejected without unit name/weight", !!d.querySelector(".sheet-backdrop"));

    input(win, sheet.querySelector("#fs-unit-label"), "sandwich");
    input(win, sheet.querySelector("#fs-grams-per-unit"), "220");
    click(win, sheet.querySelector("#fs-save"));
    check("sheet closes once unit info is complete", !d.querySelector(".sheet-backdrop"));

    click(win, d.querySelector('[data-target="calculator"]'));
    input(win, d.getElementById("cc-search"), "Pret Sandwich");
    click(win, d.getElementById("cc-food-list").children[0]);
    check("grams field relabels to Qty for a unit-based food", d.getElementById("cc-grams").placeholder === "Qty");
    input(win, d.getElementById("cc-grams"), "1");
    click(win, d.getElementById("cc-add-btn"));

    const mealItem = d.querySelector(".meal-item");
    const qtyInput = mealItem.querySelector(".meal-item__grams-input");
    check("meal item stores quantity (1), not raw grams", qtyInput.value === "1");
    check("meal item displays the unit label", mealItem.querySelector(".meal-item__meta").textContent.includes("sandwich"));
    check("carbs computed via grams-per-unit conversion (26 x 220/100 = 57.2g)", d.getElementById("cc-carbs-pill").textContent.includes("57.2"));

    click(win, mealItem.querySelector(".meal-item__edit-reveal"));
    input(win, qtyInput, "0.5");
    check("editing quantity recomputes carbs (26 x 110/100 = 28.6g)", mealItem.querySelector(".meal-item__carbs").textContent.includes("28.6"));

    click(win, d.getElementById("cc-log-btn"));
    click(win, d.querySelector('[data-target="history"]'));
    const entry = d.querySelector(".history-entry");
    click(win, entry);
    check("history entry preserves quantity + unit label", entry.textContent.includes("0.5 sandwich"));

    check("no JS errors during unit-based food flow", errors.length === 0);
  }

  // ================= Nightscout sync =================
  section("Nightscout sync");
  {
    const calls = [];
    let shouldFail = false;
    const mockFetch = async (url, opts) => {
      calls.push({ url, body: JSON.parse(opts.body) });
      return shouldFail ? { ok: false, status: 500 } : { ok: true, status: 200 };
    };
    const { window: win, d, errors } = newApp({ mockFetch });
    await wait(100);

    click(win, d.querySelector('[data-target="settings"]'));
    click(win, d.querySelectorAll("#settings-segmented .segmented__btn")[2]);
    input(win, d.getElementById("ns-url"), "https://f1b1.ns.gluroo.com?token=abc123");
    check("status shows connected once the URL (with token) is filled in", d.getElementById("ns-status").textContent.includes("Connected"));

    click(win, d.querySelector('[data-target="calculator"]'));
    input(win, d.getElementById("cc-search"), "Mela");
    click(win, d.getElementById("cc-food-list").children[0]);
    input(win, d.getElementById("cc-grams"), "150");
    click(win, d.getElementById("cc-add-btn"));
    click(win, d.getElementById("cc-correction-toggle"));
    input(win, d.getElementById("cc-glucose"), "180");
    const expectedDose = parseFloat(d.getElementById("cc-dose-number").textContent);
    click(win, d.getElementById("cc-log-btn"));
    await wait(100);

    check("a request was sent on logging a meal", calls.length === 1);
    check("the base URL's own ?token= is stripped and rebuilt cleanly", calls[0].url === "https://f1b1.ns.gluroo.com/api/v1/treatments?token=abc123");
    check("carbs sent correctly (150g apple @ 25g/100g = 37.5g)", calls[0].body.carbs === 37.5);
    check("insulin sent matches the dose actually shown (meal + correction combined)", calls[0].body.insulin === expectedDose);
    check("glucose included when a correction was used", calls[0].body.glucose === 180);
    check("eventType matches Nightscout's convention", calls[0].body.eventType === "Meal Bolus");

    // Now simulate Nightscout being unreachable
    shouldFail = true;
    input(win, d.getElementById("cc-search"), "Mela");
    click(win, d.getElementById("cc-food-list").children[0]);
    input(win, d.getElementById("cc-grams"), "100");
    click(win, d.getElementById("cc-add-btn"));
    click(win, d.getElementById("cc-log-btn"));
    await wait(100);
    const gramsInputStillWorks = d.getElementById("cc-grams").value === ""; // draft reset confirms logMeal completed normally
    check("logMeal completes normally even when Nightscout is unreachable", gramsInputStillWorks);
    const queueAfterFail = JSON.parse(win.localStorage.getItem("insulinBuddy.nsQueue") || "[]");
    check("failed sync gets queued for retry", queueAfterFail.length === 1);

    // Reconnect — queue should flush
    shouldFail = false;
    win.dispatchEvent(new win.Event("online"));
    await wait(150);
    const queueAfterFlush = JSON.parse(win.localStorage.getItem("insulinBuddy.nsQueue") || "[]");
    check("queue empties once the connection is restored", queueAfterFlush.length === 0);

    check("no JS errors during Nightscout sync", errors.length === 0);
  }

  section("Nightscout Test Connection button");
  {
    // A reachable status endpoint but a rejected token should give a specific,
    // actionable message rather than a generic failure.
    const mockFetch = async url => {
      if (url.includes("status.json")) return { ok: true, status: 200 };
      return { ok: false, status: 401 };
    };
    const { window: win, d, errors } = newApp({ mockFetch });
    await wait(100);
    click(win, d.querySelector('[data-target="settings"]'));
    click(win, d.querySelectorAll("#settings-segmented .segmented__btn")[2]);
    input(win, d.getElementById("ns-url"), "https://f1b1.ns.gluroo.com?token=bad-token");
    click(win, d.getElementById("btn-ns-test"));
    await wait(100);
    check("a rejected token gives a specific 401 message, not a generic one", d.getElementById("ns-status").textContent.includes("401"));
    check("no JS errors during connection test", errors.length === 0);
  }

  // ================= Settings: ratios, palette, dark mode =================
  section("Settings");
  {
    const { window: win, d, errors } = newApp();
    await wait(100);
    click(win, d.querySelector('[data-target="settings"]'));

    const ratiosBefore = document_query_count(d, "#time-ratio-list .ratio-row");
    click(win, d.getElementById("add-time-range-btn"));
    check("adding a time range increases the count", document_query_count(d, "#time-ratio-list .ratio-row") === ratiosBefore + 1);

    click(win, d.querySelectorAll("#settings-segmented .segmented__btn")[2]); // General
    const paletteCard = d.querySelectorAll(".palette-card")[2];
    click(win, paletteCard);
    check("palette switch applies to <html data-palette>", d.documentElement.getAttribute("data-palette") === paletteCard.dataset.id);

    const darkToggle = d.getElementById("dark-mode-toggle");
    darkToggle.checked = true;
    darkToggle.dispatchEvent(new win.Event("change", { bubbles: true }));
    check("dark mode applies to <html data-theme>", d.documentElement.getAttribute("data-theme") === "dark");

    check("no JS errors during settings changes", errors.length === 0);
  }

  // ================= Summary =================
  console.log("\n" + "=".repeat(40));
  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log("\nFailed checks:");
    failures.forEach(f => console.log("  - " + f));
    process.exit(1);
  }
  process.exit(0);
}

// jsdom's Document doesn't expose a shorthand for counting matches; small helper for readability.
function document_query_count(d, selector) {
  return d.querySelectorAll(selector).length;
}

run().catch(err => {
  console.error("Test run crashed:", err);
  process.exit(1);
});
