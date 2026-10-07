// Shared helpers for the e2e scripts.

// A small seed library (the real app loads foods_data.js; tests ship their own).
export const FOODS_JS = `var SEED_FOODS = [
  {"id":"s1","name":"Pane comune","category":"grains","carbs":65,"kcal":300,"protein":null,"fat":null,"salt":null,"gi":75,"notes":"","favorite":false,"usageCount":9},
  {"id":"s2","name":"Banana","category":"fruits","carbs":23,"kcal":89,"protein":null,"fat":null,"salt":null,"gi":51,"notes":"","favorite":false,"usageCount":5}
];
var SEED_RECIPES = [];
`;

// Log one meal through the real UI: pick a food, set grams, add, log.
export async function logMeal(dev, foodIdx = 0, grams = 100) {
  await dev.tab("calculator");
  // The food list populates asynchronously after boot; without this, a slower environment
  // (cold caches, contended CPU) can reach the click below before item `foodIdx` exists yet.
  await dev.waitFor(`document.getElementById("cc-food-list").children.length > ${foodIdx}`);
  await dev.eval(`document.getElementById("cc-food-list").children[${foodIdx}].click()`);
  await dev.eval(`(() => { const g = document.getElementById("cc-grams"); g.value = "${grams}"; g.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await dev.click("#cc-add-btn"); await dev.sleep(100);
  await dev.click("#cc-log-btn"); await dev.sleep(200);
}

export const localState = dev => dev.eval(`JSON.parse(localStorage.getItem("insulinBuddy.v2"))`);
export const localHistoryIds = async dev => (await localState(dev)).history.map(h => h.id).sort();
export const cloudHistoryIds = be => ((be.row && be.row.data.history) || []).map(h => h.id).sort();

// Shift the page's clock forward (used to step past the app's 15 s foreground-pull throttle).
export const skipClock = (dev, ms) => dev.eval(`(() => { const real = Date.now.bind(Date); const off = ${ms}; Date.now = () => real() + off; })()`);

// Pretend the app just came back to the foreground.
export const foreground = async dev => { await dev.eval(`document.dispatchEvent(new Event("visibilitychange"))`); await dev.sleep(700); };

export const dbCalls = (be, op) => be.log.filter(l => l.kind === "db" && (!op || l.op === op));

// A ready-made meal entry for seeding state directly.
export function meal(id, ts, over = {}) {
  return {
    id, ts, mealType: "lunch", periodName: "lunch", totalCarbs: 40, totalKcal: 160, mealDose: 4, correctionDose: 0, noInsulin: false,
    ratioValue: 10, ratioLabel: "Test", glucose: null, glycemicLoad: null,
    items: [{ refType: "food", refId: "s1", name: "Pane comune", grams: 60, carbsPer100g: 65, kcalPer100g: 300, gi: 75, carbs: 39, kcal: 180 }],
    ...over
  };
}

// A complete v2 state blob for seeding cloud or local storage.
export function stateBlob({ history = [], library, settings = {}, deleted, settingsUpdatedAt = 0, schemaVersion = 2 } = {}) {
  const base = {
    schemaVersion, settingsUpdatedAt,
    settings: { isf: 50, target: 100, units: "mgdl", rounding: "0.5", maxDose: 15, ...settings },
    library: library || [
      { id: "s1", name: "Pane comune", category: "grains", carbs: 65, kcal: 300, protein: null, fat: null, salt: null, gi: 75, notes: "", favorite: false, usageCount: 9 },
      { id: "s2", name: "Banana", category: "fruits", carbs: 23, kcal: 89, protein: null, fat: null, salt: null, gi: 51, notes: "", favorite: false, usageCount: 5 }
    ],
    recipes: [], history, deleted: deleted || { history: {}, library: {}, recipes: {} }
  };
  if (schemaVersion !== 2) { delete base.schemaVersion; delete base.deleted; delete base.settingsUpdatedAt; }
  return base;
}
