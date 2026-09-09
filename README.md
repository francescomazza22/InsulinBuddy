# Insulin Buddy

A dependency-free rebuild of your Base44 app: Calculator, Library, History, and Settings, preloaded with your **119 foods** (`Food_export__1_.csv`) and **4 recipes** (`Recipe_export.csv`), matched up by ingredient name. No React, no build step, no backend — plain HTML/CSS/JS that runs entirely in the browser and drops straight into GitHub Pages.

## What's in each tab

**Calculator** — search your library, add items with grams to build up the current meal. The dose updates live. The ratio pill shows whichever time-based ratio is automatically active right now (tap it to override with another time range or an activity ratio like "Sport"). Toggle "Correction" to add a glucose reading into the dose. **Meal type (Breakfast/Lunch/Dinner/Snack) is detected automatically from the time of day** — there's no prompt. "Log Meal to History" saves and clears the current meal; "Clear All" (which appears once you've added something) discards it instead.

**Library** — your preloaded foods, searchable and filterable by category or favorites. Star, edit, duplicate, or delete any item — deleting doesn't ask for confirmation, it just deletes and shows an **Undo** toast for a few seconds instead. The "Recipes" segment lets you build a dish from ingredients — add each one by weight, then set the dish's **Final Weight** (the total finished weight after cooking, since baking loses water — this is required and is what makes the recipe usable per-100g, exactly like a food). Each ingredient's carb/calorie rate is captured at the moment you add it, so editing or deleting that food later won't silently change an existing recipe's numbers.

**History** — a Log/Trends toggle at the top.
- *Log*: every meal, grouped by day, color-coded by meal type, showing the food list, kcal, carbs, and the dose given (split as `meal+correction` when a correction was included). Tap a row for the itemized breakdown. Each entry also has:
  - **Use Again** — loads that meal's items back into the Calculator so you can log it again (with today's date) or tweak it first
  - **Edit** — adjust the meal type, change or remove items (grams rescale the carbs live), and edit the glucose reading if one was used; the dose recalculates using the ratio that was active when you originally logged it
  - **Delete** — same as Library, deletes immediately with an Undo toast rather than a confirmation prompt
- *Trends*: three stat cards (meals logged, average carbs/day, average dose/day) and two bar charts (daily carbs, daily insulin dose) over a 7/14/30-day range you can switch between.

Like the original app, each logged item stores its own carb/calorie rate at logging time — so if you later edit a food in your library, your history stays accurate to what you actually ate.

**Settings**
- *Insulin Ratios* — a 24-hour timeline with a live marker showing where you are right now, editable time ranges each with their own ratio, plus custom "activity ratios" (Sport, etc.) you can pick manually in the Calculator. Correction factor, target, units, rounding, and safety cap live here too.
- *Data* — export/import your food library as CSV (compatible with the same columns as your Base44 export), plus export/import a full JSON backup covering settings, library, recipes, and history. **Import never wipes anything** — foods and recipes are matched and updated by name (or added if new), history entries are added if not already present, and your settings are always left untouched.
- *General* — six color palettes, dark mode, app info, and a "Delete Account & All Data" button that clears everything from this browser.

Everything lives in `localStorage`. There's no account and nothing is sent anywhere — which also means clearing your browser data wipes it, so use the backup export periodically.

## A couple of intentional differences from the original

- **iOS zoom prevention**: the original kept inputs at 14px and disabled pinch-zoom (`user-scalable=no`) to stop Safari's auto-zoom-on-focus. This rebuild instead keeps every input at 16px+ (the actual threshold that triggers the zoom) and leaves pinch-zoom enabled — same effect, without taking away a low-vision user's ability to zoom in on the page if they need to.
- **No `backdrop-blur` anywhere** in this build, consistent with the GPU-freeze issue noted from the original.

## Running it locally

Nothing to install — open `index.html` directly, or serve the folder:

```
python3 -m http.server 8000
```

## Deploying to GitHub Pages

1. Push `index.html`, `style.css`, `app.js`, `foods_data.js`, `sw.js`, `manifest.json`, and the icon PNGs (`favicon-16.png`, `favicon-32.png`, `icon-192.png`, `icon-512.png`, `apple-touch-icon.png`) to a new GitHub repo — keep them all in the same folder.
2. In the repo, go to **Settings → Pages**.
3. Set **Source** to "Deploy from a branch", pick `main` and `/ (root)`, save.
4. Your app is live at `https://<your-username>.github.io/<repo-name>/` within a couple of minutes.

## Offline app loading

`sw.js` is a service worker that caches the app shell (HTML/CSS/JS/icons) the first time you load the page, so it can still open with no signal at all — not just the data-sync offline handling described in `SUPABASE_SETUP.md`, but the app being able to *open* in the first place. It fetches fresh files whenever you're online and only falls back to the cached copy when the network fails.

If you change any of the cached files, bump the `CACHE_NAME` version string at the top of `sw.js` (e.g. `insulin-buddy-v1` → `v2`) so the old cached copy gets replaced rather than lingering indefinitely.

## Optional: cloud sync and accounts

By default everything stays in this browser. If you'd rather have real accounts and cross-device sync (still free, still hosted on GitHub Pages), see **`SUPABASE_SETUP.md`** for a step-by-step guide using Supabase.

## Running the test suite

There's a small test suite in `tests/run.js` that drives the actual UI (clicking buttons, filling in fields) in a simulated browser, covering dose math, library/recipe CRUD, the full history lifecycle, trends, and settings. It's dev-only tooling — the app itself has no dependencies or build step.

```
npm install
npm test
```

## The dose math

```
meal dose       = total carbs ÷ active ratio        (active ratio = time-of-day, or your manual override)
correction dose = max(0, (current glucose − target) ÷ correction factor)
dose            = meal dose + correction dose, rounded to your chosen increment, capped at your safety limit
```

It never subtracts insulin for a low reading. The ratios, correction factor, and target should come from your care team — this app only does the arithmetic on the numbers you give it. It isn't a substitute for medical advice.
