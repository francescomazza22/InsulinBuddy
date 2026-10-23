// Food library and recipe logic: CSV in and out, recipe totals, and merging an imported file into a library.
// Pure functions: they take data and return data (mergeLibrary changes the lists it is given, nothing else).
export const truthy = v => /^(true|1|yes|y|vero|si|sì)$/i.test(String(v ?? "").trim());

export function toCsv(rows, headers) {
  const esc = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [headers.map(esc).join(",")];
  rows.forEach(r => lines.push(headers.map(h => esc(r[h])).join(",")));
  return lines.join("\n");
}

export function splitCsvLine(line) {
  const out = [];
  let cur = "", inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else cur += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { out.push(cur); cur = ""; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

export function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length);
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]);
  return lines.slice(1).map(line => {
    const cells = splitCsvLine(line);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = cells[i]; });
    return obj;
  });
}

// Totals for a recipe. `library` is only used for older recipes saved before ingredients kept their own rates.
export function recipeTotals(recipe, library) {
  let carbs = 0, kcal = 0;
  recipe.items.forEach(it => {
    let cp100 = it.carbsPer100g, kp100 = it.kcalPer100g;
    if (cp100 == null) {
      const food = (library || []).find(f => f.id === it.foodId);
      cp100 = food ? food.carbs : 0;
      kp100 = food ? food.kcal : null;
    }
    carbs += (cp100 || 0) * it.grams / 100;
    kcal += (kp100 || 0) * it.grams / 100;
  });
  const totalCarbs = Math.round(carbs * 10) / 10;
  const totalKcal = Math.round(kcal);
  const fw = recipe.finalWeight;
  return {
    totalCarbs, totalKcal,
    carbsPer100g: fw ? Math.round((totalCarbs / fw) * 1000) / 10 : null,
    kcalPer100g: fw ? Math.round((totalKcal / fw) * 1000) / 10 : null
  };
}

// Reads a library file (.json or .csv, foods or recipes) into plain {foods, recipes} lists. Throws on unreadable JSON.
export function parseLibraryFile(name, text) {
  let foods = [], recipes = [];
  const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
  if (/\.json$/i.test(name)) {
    const data = JSON.parse(text);
    foods = Array.isArray(data) ? data : (data.foods || data.library || []);
    recipes = Array.isArray(data) ? [] : (data.recipes || []);
  } else {
    const rows = parseCsv(text);
    const isRecipe = rows.length ? Object.prototype.hasOwnProperty.call(rows[0], "ingredients") : /(^|,)"?ingredients"?(,|$)/.test((text.split(/\r?\n/)[0] || ""));
    if (isRecipe) {
      recipes = rows.filter(r => r.name).map(r => {
        let ings = [];
        try { ings = JSON.parse(r.ingredients || "[]"); } catch { ings = []; }
        return {
          name: r.name, category: r.category || "other", notes: r.notes || "",
          rawWeight: num(r.raw_weight), finalWeight: num(r.final_weight) ?? "",
          usageCount: parseInt(r.usage_count, 10) || 0,
          items: (Array.isArray(ings) ? ings : []).map(i => ({
            foodId: i.food_id || null, name: i.food_name || "", grams: num(i.weight_grams) || 0,
            carbsPer100g: num(i.carbs_per_100g) ?? 0, kcalPer100g: num(i.calories_per_100g)
          })).filter(i => i.grams > 0)
        };
      });
    } else {
      foods = rows.map(r => ({
        name: r.name, category: r.category || "other",
        carbs: parseFloat(r.carbs_per_100g) || 0, kcal: parseFloat(r.calories_per_100g) || null,
        protein: parseFloat(r.protein_per_100g) || null, fat: parseFloat(r.fat_per_100g) || null,
        salt: parseFloat(r.salt_per_100g) || null, notes: r.notes || "",
        favorite: truthy(r.is_favorite), usageCount: parseInt(r.usage_count, 10) || 0,
        unitBased: truthy(r.unit_based) || (!!r.unit_label && parseFloat(r.grams_per_unit) > 0), unitLabel: r.unit_label || null,
        gramsPerUnit: parseFloat(r.grams_per_unit) || null,
        gi: parseFloat(r.glycemic_index) || null
      }));
    }
  }
  return { foods, recipes };
}

// Adds or updates foods and recipes in `library` / `recipes` (matched by name, case-insensitive). Returns the counts.
// `makeId` is passed in so tests can be deterministic.
export function mergeLibrary(library, recipes, parsed, makeId = (p) => p + Date.now() + "-" + Math.random().toString(36).slice(2, 6)) {
  const res = { foodsAdded: 0, foodsUpdated: 0, recipesAdded: 0, recipesUpdated: 0 };
  parsed.foods.forEach(item => {
    if (!item.name) return;
    const existing = library.find(f => f.name.toLowerCase() === item.name.toLowerCase());
    if (existing) { Object.assign(existing, item, { id: existing.id }); res.foodsUpdated++; }
    else { library.push({ usageCount: 0, ...item, id: makeId("food-") }); res.foodsAdded++; }   // always our own id: a file's id is never trusted
  });
  parsed.recipes.forEach(item => {
    if (!item.name) return;
    // Point each ingredient at the matching food in THIS library (by id, else by name); keep its saved rates.
    item.items = (item.items || []).map(i => {
      const f = library.find(x => x.id === i.foodId) || library.find(x => x.name.toLowerCase() === String(i.name || "").toLowerCase());
      return { ...i, foodId: f ? f.id : (i.foodId || null) };
    });
    const existing = recipes.find(r => r.name.toLowerCase() === item.name.toLowerCase());
    if (existing) { Object.assign(existing, item, { id: existing.id }); res.recipesUpdated++; }
    else { recipes.unshift({ favorite: false, ...item, id: makeId("recipe-") }); res.recipesAdded++; }
  });
  return res;
}
