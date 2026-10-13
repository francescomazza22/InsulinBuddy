// Ready-made meal recipes the app adds once to a new or existing library (never brought back if deleted).
// A few ready-made meal recipes, added once (and never brought back if you delete them). The numbers are typical estimates
// for each dish, not a lab analysis: each says so in its notes, so weigh your own portion and adjust the amounts.
// Each ingredient is [name, grams, carbs per 100 g, kcal per 100 g].
export const SEED_RECIPES = [
  {
    key: "pub-cheeseburger-chips", name: "Pub-style cheeseburger and chips", category: "other",
    notes: "Typical estimate for a pub cheeseburger with a brioche-style bun, sauce and chunky chips. Weigh your own portion and adjust the amounts.",
    items: [["Burger bun", 85, 49, 280], ["Beef burger patty, cooked", 140, 0, 250], ["Cheddar cheese", 25, 1.3, 403], ["Lettuce", 20, 2.9, 15], ["Tomato", 40, 3.9, 18], ["Red onion", 20, 9.3, 40], ["Burger sauce", 20, 10, 450], ["Chips, cooked", 200, 38, 280], ["Tomato ketchup", 20, 26, 110]]
  },
  {
    key: "chicken-pad-thai", name: "Classic chicken pad thai", category: "grains",
    notes: "Typical estimate for a restaurant-style chicken pad thai (stir-fried rice noodles, egg, bean sprouts, crushed peanuts, tamarind and fish sauce). Takeaway portions vary a lot: weigh yours and adjust.",
    items: [["Rice noodles, cooked", 250, 24, 108], ["Petto di pollo", 100, 0, 165], ["Egg", 50, 0.7, 143], ["Bean sprouts", 40, 3.7, 31], ["Dry roasted peanuts", 15, 7.3, 595], ["Zucchero", 15, 100, 400], ["Tamarind paste", 10, 62.5, 239], ["Fish sauce", 10, 3.6, 35], ["Vegetable oil", 15, 0, 900], ["Spring onion", 15, 7, 32], ["Lime juice", 10, 7, 25]]
  },
  {
    key: "where-pancakes-are-sweet", name: "Where Pancakes Are (Battersea): sweet pancakes", category: "other",
    notes: "Estimate for the sweet pancakes served there (pancakes with cinnamon-poached pineapple, pomegranate, flaked coconut, lime syrup and cream). The restaurant does not publish its portion sizes, so the amounts are a guess for a typical stack of three: adjust them to what you were served.",
    items: [["Pancakes (plain, American style)", 180, 27, 227], ["Poached pineapple", 80, 13, 50], ["Pomegranate seeds", 20, 19, 83], ["Flaked coconut", 5, 7, 660], ["Lime syrup", 25, 70, 280], ["Whipped cream", 30, 2.5, 340]]
  }
];
