// Foods and recipes as the Calculator offers them. Pure: the library is passed in, so this is testable in Node.

/** A recipe's totals, and per 100g of the finished dish (null until it has a final weight). Ingredients carry their
 * own carbs / kcal per 100g; recipes saved before they did fall back to the matching food in `library`. */
export function recipeTotals(recipe, library = []) {
  let carbs = 0, kcal = 0;
  recipe.items.forEach(it => {
    let cp100 = it.carbsPer100g, kp100 = it.kcalPer100g;
    if (cp100 == null) {
      const food = library.find(f => f.id === it.foodId);
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

/** Everything that can be added to a meal, recipes first: id is "food:<id>" or "recipe:<id>". A recipe needs a
 * final weight to be pickable (its carbs per 100g depend on it). */
export function pickableItems(library, recipes) {
  const foods = library.map(f => ({
    id: "food:" + f.id, refType: "food", refId: f.id, name: f.name,
    carbsPer100g: f.carbs, kcalPer100g: f.kcal, notes: f.notes, gi: f.gi || null,
    usageCount: f.usageCount || 0, favorite: f.favorite,
    unitBased: !!f.unitBased, unitLabel: f.unitLabel || null, gramsPerUnit: f.gramsPerUnit || null
  }));
  const pickRecipes = recipes.filter(r => r.finalWeight > 0).map(r => {
    const t = recipeTotals(r, library);
    return {
      id: "recipe:" + r.id, refType: "recipe", refId: r.id, name: r.name,
      carbsPer100g: t.carbsPer100g, kcalPer100g: t.kcalPer100g, notes: r.notes,
      usageCount: r.usageCount || 0, favorite: r.favorite,
      unitBased: false, unitLabel: null, gramsPerUnit: null
    };
  });
  return [...pickRecipes, ...foods];
}
