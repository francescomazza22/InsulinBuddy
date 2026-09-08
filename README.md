# Insulin Buddy

A dependency-free rebuild of your Base44 app: Calculator, Library, History, and Settings, preloaded with your **119 foods** (`Food_export__1_.csv`) and **4 recipes** (`Recipe_export.csv`), matched up by ingredient name. No React, no build step, no backend — plain HTML/CSS/JS that runs entirely in the browser and drops straight into GitHub Pages.

## What's in each tab

**Calculator** — search your library, add items with grams to build up a meal, and the dose updates live. The ratio pill shows whichever time-based ratio is active right now (tap it to override with another time range or an activity ratio like "Sport"). Toggle "Correction" to add a glucose reading into the dose. "Log this meal" asks which meal type it is, then saves it to History.

**Library** — your preloaded foods, searchable and filterable by category or favorites. Star, edit, duplicate, or delete any item. The "Recipes" segment lets you build a dish from ingredients — add each one by weight, then set the dish's **Final Weight** (the total finished weight after cooking, since baking loses water — this is required and is what makes the recipe usable per-100g, exactly like a food). The recipe then behaves just like any other library item: search for it in the Calculator and enter however many grams you're eating.

**History** — every logged meal, grouped by day, color-coded by meal type, showing the food list, kcal, carbs, and the dose given (split as `meal+correction` when a correction was included). Tap a row to see the itemized breakdown or delete it.

**Settings**
- *Insulin Ratios* — the same time-based ratio model as the original: a 24-hour timeline, editable time ranges each with their own ratio, plus custom "activity ratios" (Sport, etc.) you can pick manually in the Calculator. Correction factor, target, units, rounding, and safety cap live here too.
- *Data* — export/import your food library as CSV (compatible with the same columns as your Base44 export), or download a full JSON backup of everything.
- *General* — six color palettes, dark mode, app info, and a "Delete Account & All Data" button that clears everything from this browser.

Everything lives in `localStorage`. There's no account and nothing is sent anywhere — which also means clearing your browser data wipes it, so use the backup export periodically.

## Running it locally

Nothing to install — open `index.html` directly, or serve the folder:

```
python3 -m http.server 8000
```

## Deploying to GitHub Pages

1. Push `index.html`, `style.css`, `app.js`, and `foods_data.js` to a new GitHub repo (keep them all in the same folder).
2. In the repo, go to **Settings → Pages**.
3. Set **Source** to "Deploy from a branch", pick `main` and `/ (root)`, save.
4. Your app is live at `https://<your-username>.github.io/<repo-name>/` within a couple of minutes.

## The dose math

```
meal dose       = total carbs ÷ active ratio        (active ratio = time-of-day, or your manual override)
correction dose = max(0, (current glucose − target) ÷ correction factor)
dose            = meal dose + correction dose, rounded to your chosen increment, capped at your safety limit
```

It never subtracts insulin for a low reading. The ratios, correction factor, and target should come from your care team — this app only does the arithmetic on the numbers you give it. It isn't a substitute for medical advice.
