# Insulin Buddy data contract (version 1)

What the app stores, in words. `js/core/schema.js` checks the same rules in code. If you change one, change the other.
This is the file a native app, a backup tool or another device must agree with. Anything it reads should be checked with the
same rules; anything it writes must pass them.

## The saved state
One JSON object, kept on the device (key `insulinBuddy.v2`), in the cloud (Supabase `app_state`), and in backup files.

| Field | Type | Meaning |
|---|---|---|
| `schemaVersion` | number | State layout version (now 2). Set by `normalizeState` in `js/state.js`. |
| `settings` | object | Everything under *Settings* (below). |
| `settingsUpdatedAt` | number (ms) | When settings last changed. The newer side wins when devices merge, except on a device's first sync with the account (it holds none of the account's meals and hasn't recorded the account as its settings' owner): the account's settings win (2.87.0). Adding a `ratioHistory` record alone does not change it. |
| `library` | list of foods | The food library. |
| `recipes` | list of recipes | Saved recipes. |
| `history` | list of entries | Logged meals, corrections, basal doses and activities, newest first. |
| `deleted` | `{history, library, recipes}` | Id → time of deletion, so deletions reach other devices. Pruned after 90 days. |

Every food, recipe and entry has a text `id`, unique within its list, and gets `updatedAt` (ms) whenever it changes.
Times are milliseconds since 1970 (`ts`). Glucose and insulin are always stored in **mg/dL** and **units**; `settings.units`
only changes how glucose is shown and typed.

## History entry: meal or correction
| Field | Type | Notes |
|---|---|---|
| `id`, `ts` | text, number | Required. |
| `mealType` | text | `breakfast`, `lunch`, `dinner`, `snack` or `correction`. |
| `periodName` | text | The time-of-day bracket in force, lower case (`morning`). May be empty. |
| `items` | list | Empty for Eating Out. Each: `refType` (`food`, `recipe`, or `quick` for the Fast carbs chips, whose `refId` is null), `refId`, `name`, `grams`, `carbs`, `kcal`, `carbsPer100g`, `kcalPer100g`, optional `quantity`, `unitLabel`, `gramsPerUnit`, `gi`. |
| `totalCarbs`, `totalKcal` | number | 0 when carbs were not counted. |
| `carbsUnknown` | boolean | True for Eating Out. |
| `knownKcal` | number ≥ 0, optional | 2.96.0: calories typed for an Eating Out meal; used instead of the estimate from its insulin. Absent = not known. |
| `glycemicLoad` | object or null | From the items' GI. |
| `mealDose` | number ≥ 0 | Units. The saved dose is exactly what the calculator showed. |
| `correctionDose` | number | Units; positive adds to the meal dose, negative (since 2.44.0) is a reduction taken off it. `mealDose + correctionDose` is the injected total and never goes below 0. |
| `extraDose` | number, optional | (2.84.0) Units changed by hand. Positive: added on top of the calculated dose, INCLUDED in `mealDose` (or in `correctionDose` when the entry has no meal part, i.e. `mealDose` < `extraDose`). Negative (2.85.0): taken off, INCLUDED in `correctionDose`, never more than the dose. Totals never add it again. Absent when nothing was changed. |
| `cappedFrom` | number | Present only when the maximum-dose cap reduced the dose. |
| `noInsulin` | boolean | Carbs logged with no insulin (treating a low). |
| `glucose` | number or null | Reading used for the correction, in mg/dL. |
| `ratioLabel`, `ratioValue` | text, number or null | The carb ratio used (1 unit per `ratioValue` g). |
| `ns` | object | Nightscout sync state: `status` (`synced`/`failed`), `error`, `warn`. |

## History entry: basal
`entryType: "basal"` and `mealType: "basal"`, plus `basalDose` (units ≥ 0) and `basalSlot` (`am` before 14:00, else `pm`).
The meal fields are present but zero. Basal never feeds the meal-dose calculation.

## History entry: activity (2.65.0)
`entryType: "activity"` and `mealType: "activity"`, plus `activityType` (`walk`, `run`, `cycle`, `gym`, `hiit`, `swim`, `sport`,
`yoga`, `other`), `activityName` (text, only for `other`), `durationMin` (minutes ≥ 0, required), `intensity` (`light`,
`moderate`, `hard`) and `note` (text, may be empty). `ts` is when it started. The meal fields are present but zero; an activity
never feeds a dose, active insulin, carbs on board, trends or meal stats. Nightscout gets it as a plain Note.

## Food
`name` (required), `carbs` per 100 g (required, ≥ 0), optional `kcal`, `protein`, `fat`, `salt`, `gi`, `category`, `notes`,
`favorite`, `usageCount`. Per-unit foods (a biscuit, a pint) set `unitBased: true`, `unitLabel` (a name such as `bag`, never an
amount such as `1 bag`) and `gramsPerUnit` (> 0). Optional `source` (2.86.0): `label` (from the pack) or `estimate` (a typical
value); absent or null = not said. `estimated` lists fields filled from typical values by "Fill in missing details".

## Recipe
`name` (required), `items` (each `foodId`, `name`, `grams` > 0, `carbsPer100g`, `kcalPer100g`; the rates are a snapshot so the
recipe survives its foods changing; since 2.86.0 the app shows when a linked food's figures differ and updates them only
when asked), `finalWeight` (g, total cooked weight), `rawWeight`, `category`, `notes`, `favorite`, `usageCount`.

## Settings
Required: `isf` (mg/dL per unit), `target` (mg/dL), `maxDose` (units), `units` (`mgdl`/`mmol`), `timeRatios` (at least one
bracket: `id`, `name`, `start`, `end` as `HH:MM`, `ratio`; a bracket may wrap past midnight; optional `days`, a list of weekday numbers 0=Sunday..6=Saturday, limits it to those days, absent or all seven = every day. Brackets may overlap: a day-limited one beats an every-day one, and fewer days beats more, then list order). Also `activityRatios`,
`insulinModel` (`peakMinutes`, `diaMinutes`), `carbAbsorptionMinutes`, `rounding`, appearance and Nightscout options.
`basalActivity` (2.72.0, optional): `enabled` (boolean), `reducePct` (1–50, or null = not set, no suggestion),
`minMinutes` (5–240, for a workout: moderate/hard pieces under 15 min apart add up), `lookbackMin` (15–240). It only shapes a suggestion in the basal sheet; nothing is stored on the basal entry.
`basalBaseline` (2.77.0, optional): `{ am, pm }`, the person's usual morning / evening basal in units (above 0, up to 200, two
decimals), or null = not set. The basal sheet starts from it (else the last dose in that slot) and checks big changes against it; nothing is calculated from it.
`calories` (2.78.0, optional): `sex` (`male`/`female` or null), `birthYear`, `heightCm` (120–230), `weightKg` (30–250), each null = not set,
`lifeFactor` (1.1–1.8, default 1.3: everyday moving, not exercise), `eatingOutKcal` (2.78.3: 0–5000, default 900, kcal for an eating-out meal with no insulin or ratio to work from; null = not counted), `eatingOutMultiplier` (2.82.0: 1–5, default 2; an eating-out meal counts (its meal units + corrections in the next 4 h until the next meal) × its ratioValue × 4 kcal/g × this; null = always the fixed figure) and `dayOneOffs` (2.91.0, optional: `{ "YYYY-MM-DD": [{ id ("once-…"), name, unit, kcalPerUnit, count 0–50 }] }`, items had on that day only, at most 12 a day, the latest 120 days), `dayExtras` (2.83.0, optional: `{ "YYYY-MM-DD": { <extra id>: count 0–50 } }`, a day's own amounts where they differ from the usual `perDay`; the latest 120 days; unknown ids dropped) and `extras` (at most 12: `id`, `name`, `unit`, `kcalPerUnit` 0–2000,
`perDay` 0–50, optional `proteinPerUnit` / `carbsPerUnit` / `fatPerUnit` / `saltPerUnit` (2.102.0, grams per unit, 0–1000; set when added from the library; one-off items in `dayOneOffs` may carry them too), `meals` (2.95.0; 2.94.0 saved a single `meal`, still read) a list of `breakfast`/`lunch`/`dinner`/`snack`, empty = every logged day; with meals, the amount is split evenly between them and each meal logged with its foods brings its share), `days` (2.98.0, weekday numbers 0=Sunday..6=Saturday, empty or all seven = every day; on other weekdays its usual amount is 0, a count set for that day still wins), things eaten daily but never logged. Only drawn in the Trends Calories card; never used for a dose.
`ratioHistory` (2.76.0, optional): `[{ ts, ratios: [{ id, name, ratio, kind }] }]`, a dated snapshot each time a ratio, bracket name or the set of
brackets changes (at most 400). Sync keeps both devices' records. Only drawn in Trends; never used for a dose.
Secrets (the Nightscout token) are stored per URL outside the state and are never part of a backup.

## Other things on the device (not in the state)
`insulinBuddy.storageVersion` (migration level), `.draft` (meal in progress), `.place` (screen to reopen), `.glucoseRecent2`
(glucose cache), `.nsQueue` (unsent Nightscout jobs), `.diag` (diagnostics log), `.lock` (passphrase verifier).
These can be deleted without losing data, except `.lock`, which only matters if a passphrase is set.

## Rules for any app that reads or writes this
1. Check with the validators; skip records with **errors**, keep records with warnings.
2. Never drop unknown fields on an entry you are only passing along.
3. Never overwrite stored data with an empty copy; deletions go through `deleted`.
4. Changing a field's meaning means a new `CONTRACT_VERSION` and a migration, not a silent change.
