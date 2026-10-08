// The release notes shown in Settings > What's changed, newest first. VERSION is always CHANGELOG[0].version, so the
// version badge, the diagnostics report, package.json and the service worker cache name all follow this one place
// (tools/sync-version.mjs copies it into package.json, sw.js, index.html and diagnose.html).

export const CHANGELOG = [
  {
    version: "2.11.0",
    summary: "A big tidy-up under the hood, plus fixes for a passphrase problem, Delete All, and editing an Eating Out meal.",
    changes: [
      "Fixed: with a passphrase set while signed out of Cloud Sync, opening the app could show no data at all, and the next save would then replace your encrypted data with an empty copy. It now asks for the passphrase first, as it should",
      "Fixed: Delete Account & All Data now really deletes everything: the Face ID unlock and its stored key, the meal you were building and the Nightscout queue, and it also deletes your stored glucose readings from the cloud. If the cloud can't be reached it now stops and deletes nothing, instead of deleting this device's copy only",
      "Fixed: editing an Eating Out meal showed 0 units and wouldn't save. It now keeps the dose you typed",
      "The Calculator and Edit Meal now share one dose calculation, checked against the old ones on thousands of test meals, so the two can never disagree again",
      "One report for your doctor instead of two slightly different ones: it now includes the By Meal table and is shown in your own glucose unit",
      "Every pop-up message now uses the app's own style (a few still used the browser's plain ones), and Escape closes every pop-up sheet on a computer",
      "When active insulin already covers a correction, the note under Log now says so instead of \"no correction is needed\"",
      "On iPad and computer screens the Undo message now sits centred over the content, clear of the side rail",
      "Importing a backup or a food library now takes a local snapshot first, so it can be undone from Settings > Data",
      "Internal: the app is now split into small modules with automated tests, and the background doodles load only if you choose them"
    ]
  },
  {
    version: "2.10.5",
    summary: "Better use of large screens: bigger text and tidier alignment.",
    changes: [
      "On a laptop or desktop screen the whole app is now drawn a size larger (and larger again on very big screens), so text is no longer tiny",
      "On the History > Glucose tab the range buttons, charts and cards now line up with the heading and tabs instead of floating in the middle",
      "The dose number in the Calculator is bigger on large screens"
    ]
  },
  {
    version: "2.10.4",
    summary: "The Log button now says why it is off.",
    changes: [
      "When Log Meal to History is greyed out in the correction panel, a short line under it now says why (nothing typed yet, a 0 dose, or a glucose that needs no correction)"
    ]
  },
  {
    version: "2.10.3",
    summary: "Fixed: typing a manual correction or Eating Out dose, especially with a decimal comma.",
    changes: [
      "Fixed: a manual correction (or an Eating Out dose) typed with a decimal comma, like 1,5, could be misread as 15 or rejected, which left the Log button greyed out. Both a decimal point and a decimal comma now work",
      "If what you type can't be read as a number, a short message now says so, instead of the Log button silently staying off",
      "Fixed: a correction typed on its own (no foods in the meal) was thrown away if the app reloaded in the background, for example after switching to another app. It is now kept, along with a glucose reading typed for an automatic correction"
    ]
  },
  {
    version: "2.10.2",
    summary: "Fixed: Save could be out of reach in edit sheets, especially with the keyboard up.",
    changes: [
      "Fixed: in the Edit Meal sheet (and the basal, food and recipe sheets) the Save and Cancel buttons sat at the very end of a long form, so on a phone they were below the screen, and once you typed a number the keypad hid them completely. They are now pinned to the bottom of the sheet and always visible and pressable, with or without the keyboard, on iPhone, iPad and computer",
      "No change to how anything is saved"
    ]
  },
  {
    version: "2.10.1",
    summary: "Housekeeping: pictures and icons now live in an assets folder.",
    changes: [
      "All the app's pictures are now sorted into one assets folder: the icons in assets/icons and the Abstract background artwork in assets/patterns, instead of sitting loose beside the code",
      "The file check page (diagnose.html) now also checks the icons, checks that manifest.json points at them (and tells you the exact line to change if it doesn't), and notes any old copies left behind",
      "No change to how the app looks or works"
    ]
  },
  {
    version: "2.10.0",
    summary: "New Abstract background: soft, colorful shapes as a second pattern.",
    changes: [
      "Settings > General > Background > Pattern now has a third choice, Abstract: a soft wallpaper of colorful abstract shapes, squiggles and dots, drawn over whichever background color you pick. It works in dark mode too, with its own muted version",
      "It has the same Small / Medium / Large size choice as Doodles, with sizes suited to its bigger shapes",
      "It is kept faint on purpose, so the small grey labels stay easy to read even where a colored shape sits behind them. Its artwork files are only downloaded if you choose Abstract"
    ]
  },
  {
    version: "2.9.2",
    summary: "The doodle background is now twice as dense, with many more drawings.",
    changes: [
      "The doodle pattern now has twice as many doodles, spread evenly, and 28 different drawings instead of 14 (bananas, strawberries, cookies, pills, clouds, leaves, cherries and more join the original food and insulin icons)",
      "The pattern now repeats with no visible seam or gap where the tiles meet, at every size and on every screen"
    ]
  },
  {
    version: "2.9.1",
    summary: "The doodle background is now much smaller and finer, with a Small / Medium / Large choice.",
    changes: [
      "The doodle pattern is now small and fine by default (about a third of the size it was), so it reads as a texture rather than big scattered stickers, and it no longer grows large on iPad and computer screens",
      "New Size choice under Background > Pattern: Small (the new default), Medium, or Large (the previous look)",
      "The doodle lines are slightly bolder so the small size stays easy to see"
    ]
  },
  {
    version: "2.9.0",
    summary: "New Background pattern option: faint food and insulin doodles behind the app.",
    changes: [
      "Settings > General > Background now has a Pattern choice. Pick Doodles for a faint pattern of food and insulin doodles behind everything, drawn over whichever background color you choose. It works in dark mode too, and Plain turns it off",
      "The pattern is a drawing rather than a photo, so it stays sharp on iPhone, iPad and computer screens, and it scales gently with the size of the screen. It never changes the layout and is never printed",
      "Fixed: the file checker page (diagnose.html) quoted the wrong version number in its result message"
    ]
  },
  {
    version: "2.8.0",
    summary: "New Daily basal insulin chart in History > Trends.",
    changes: [
      "History > Trends has a new Daily basal insulin chart: one bar per day, with the morning dose (light blue) and the evening dose (dark blue) stacked, a dashed average line, and morning and evening averages underneath",
      "Tap a day to see that day's doses; the same day lights up in the other charts too, so basal can be compared with carbs and mealtime insulin",
      "It follows the 7 / 14 / 30 day choice, only appears once you have logged basal, and also shows if you have logged basal but no meals in that period"
    ]
  },
  {
    version: "2.7.0",
    summary: "Proper layouts for iPad and computer screens. The phone layout is unchanged.",
    changes: [
      "On iPad and computer screens the bottom tab bar becomes a navigation rail down the left edge, the content fills the space beside it, and pop-up sheets appear as centred cards instead of sticking to the bottom",
      "On iPad landscape and computers the Calculator is two columns: the dose and the Log button stay pinned on the left while you build the meal on the right",
      "On wide screens Settings and Trends use two columns (the two charts sit side by side) and History fits more entries across",
      "Phones are exactly as they were, and rotating an iPad or resizing a window switches layout live"
    ]
  },
  {
    version: "2.6.3",
    summary: "The page behind a pop-up sheet no longer scrolls while it is open, and the basal dose box reads properly.",
    changes: [
      "Fixed: the page behind a pop-up sheet (Log basal, editing a meal, Active Insulin, What's New, and the rest) no longer scrolls or shifts while the sheet is open, and it is back exactly where it was when you close it",
      "Fixed: in the basal dose box, the number and \"units\" now sit together in the middle instead of \"units\" being pushed against the right edge; tapping anywhere in the box starts typing"
    ]
  },
  {
    version: "2.6.2",
    summary: "The basal sheet (and other pop-up sheets) now sit above the iPhone keyboard instead of underneath it, and its buttons and spacing are tidied.",
    changes: [
      "Fixed: on iPhone the keyboard covered the bottom of the Log basal sheet, hiding the dose field you were typing into. Pop-up sheets now sit in the visible area above the keyboard, and scroll if there is very little room",
      "Morning and Evening now look right on iPhone: the selected one is clearly outlined in the app colour and the other is in normal text (they were showing in Safari's own grey and blue)",
      "The basal sheet is more compact, and drops its reminder line while the keyboard is up so everything fits"
    ]
  },
  {
    version: "2.6.1",
    summary: "Fixed a meal being logged with a bigger dose than the one the calculator showed when your maximum dose applied.",
    changes: [
      "Fixed: when a meal calculated to more than your maximum dose, the card showed the capped dose (say 15u) but the log saved the uncapped one (say 19.5u). The logged dose now always matches the dose shown, and so does what is sent to Nightscout and Apple Health",
      "The dose card now says when the cap applies (\"Capped at your 15 u maximum. The calculation came to 19.5 u.\"), and History notes it when you expand a capped meal",
      "A dose you type yourself (Eating Out, or a manual correction) is never changed: if it is above your maximum you get a warning instead of a silent change",
      "Editing a meal now uses the same calculation as its preview, so re-saving a capped meal can no longer push its dose back up. To repair a meal that was already logged too high, open it in History, tap Edit, then Save Changes"
    ]
  },
  {
    version: "2.6.0",
    summary: "You can now log basal (long-acting) insulin, with its own entries in History, kept out of your active insulin and correction maths.",
    changes: [
      "New \"+ Basal\" button next to the History search: pick Morning or Evening, enter the dose and the time, and save. It starts from your last dose in that slot, and asks you to confirm if a dose looks like a typo (for example 14 turning into 140)",
      "Basal shows in History as its own row; tap it to edit or delete, and Undo works. It is never counted as a meal, and it never changes active insulin, IOB or the correction suggestion",
      "Basal is sent to Nightscout as a Note (\"Basal insulin: 14u (morning)\") with no insulin amount, because Nightscout would otherwise count it as rapid-acting insulin on board",
      "The clinic report adds basal doses logged, average daily basal and average total daily insulin whenever basal was logged in the period; the meal figures are unchanged",
      "Apple Health export can include basal when you add &include=basal to the Shortcut's URL (off by default, so an existing Shortcut can't misfile it)"
    ]
  },
  {
    version: "2.5.0",
    summary: "Added a mg/dL and mmol/L conversion guide you can open from the Correction section.",
    changes: [
      "New glucose guide: tap \"mg/dL · mmol/L\" next to Current glucose (in Correction) to see both units side by side, 40 to 400 mg/dL in steps of 10",
      "The whole range fits on one screen without scrolling on a normal phone, split into two tables sitting next to each other",
      "Rows are colour-coded with the same bands as the Time in Range chart (very low, low, target, high, very high)",
      "Works the same whichever unit the app is set to; close it with the X, by tapping outside it, or with Escape"
    ]
  },
  {
    version: "2.4.6",
    summary: "The Ratio pill is now exactly centred between the carbs pill and Eating Out, and the gap under the Active Insulin banner is much tighter.",
    changes: [
      "Ratio pill vertically centred between the carbs pill above and the Eating Out pill below -- it was sitting about 3px too high, and the three pills were different heights",
      "Space between the Active Insulin banner and the next section (Recently Logged / Add Food Item) cut from 28px to 12px -- an empty, invisible container was adding 12px on its own"
    ]
  },
  {
    version: "2.4.5",
    summary: "Fixed both reports printing as a blank page, plus several accessibility and styling fixes found in a CSS review.",
    changes: [
      "Printing a report (Save as PDF) gave a blank page for both the Summary Report and the clinic report -- fixed, and reports now always print dark-on-white even when the app is in dark mode",
      "The clinic report keeps a light palette on screen too, instead of pale text on a white page in dark mode",
      "Keyboard focus is now visible on the glucose, manual correction and Eating Out inputs, and on settings switches",
      "Recently Logged chips and the clinic report toolbar had no background colour (they referenced theme variables that didn't exist) -- they now match the rest of the app",
      "With Reduce Motion turned on, the pulsing log button and loading spinner now actually stop instead of repeating rapidly"
    ]
  },
  {
    version: "2.4.4",
    summary: "Fixed real crowding in the dose card's top row when a live glucose reading, Eating Out, and Ratio all showed at once, and fixed the Meal insulin dose label rendering oversized.",
    changes: [
      "The top row (live glucose, carbs status, reset) was overflowing and wrapping badly when a live Nightscout reading was showing at the same time as Eating Out -- Ratio moved back next to the dose value, which has consistent free space for it regardless of what else is showing",
      "Fixed the \"Meal insulin dose\" label rendering at browser-default size instead of matching \"Current glucose\" next to it"
    ]
  },
  {
    version: "2.4.3",
    summary: "Rebuilt the dose card's layout: Correction, Treating a Low and Eating Out now fill the full bar edge to edge, and Ratio moved into the top row as a compact badge.",
    changes: [
      "Correction, Treating a Low and Eating Out now stretch to fill the whole width of the bar, instead of sitting at their natural size with empty space left over",
      "Ratio moved out of its own row entirely and into the top row next to the carbs badge, as a small dark badge rather than a full-size pill"
    ]
  },
  {
    version: "2.4.2",
    summary: "Correction, Treating a Low and Eating Out now sit together on one line, with Ratio moved above them to the right in a darker shade.",
    changes: ["Ratio pill moved to its own row above the three toggles, right-aligned, with darker shading to set it apart from the on/off pills below it"]
  },
  {
    version: "2.4.1",
    summary: "Small layout tweak: Ratio now sits before Eating Out, with a slightly different shade since it isn't a toggle like the others.",
    changes: ["Ratio pill reordered and given a distinct shade from the on/off toggles next to it"]
  },
  {
    version: "2.4.0",
    summary: "Added Eating Out mode for logging insulin without a precise carb count, and condensed the food list to show more at a glance.",
    changes: [
      "New \"Eating Out\" button next to Correction and Treating a Low — skips food search entirely and lets you log the insulin dose you're giving directly, for meals where counting carbs precisely isn't realistic",
      "An Eating Out entry is clearly marked in History (\"Eating out — carbs not logged\") rather than looking like a correction-only entry",
      "The clinic report now counts Eating Out meals in your meal total and insulin average, and lists how many meals had no carb count, instead of silently excluding them",
      "Food list items are now condensed onto a single line each — noticeably more fit on screen at once"
    ]
  },
  {
    version: "2.3.0",
    summary: "Correction can now be entered manually, skipping the glucose/ISF calculation when you'd rather set the dose yourself.",
    changes: [
      "Added \"Enter dose manually\" under Correction — type a units amount directly instead of a glucose reading, for days the automatic calculation isn't what you want",
      "A manual dose is used exactly as typed, not rounded to your usual dose step",
      "Starts fresh in automatic mode for every new meal, rather than carrying a manual override into an unrelated future dose",
      "Fixed: editing a manually-corrected meal afterward could show a misleading preview as if the correction had been dropped — the dose itself was always saved correctly, this was a display-only issue"
    ]
  },
  {
    version: "2.2.1",
    summary: "Boot speed improvements: fewer network round-trips at startup, and static files load instantly from cache instead of re-fetching every time.",
    changes: [
      "Merged two separate startup database checks (passphrase lookup + loading your data) into one",
      "A background local backup no longer makes the first screen wait on it",
      "App files now load instantly from cache and quietly check for updates in the background, instead of re-downloading everything fresh on every single open",
      "The food database file no longer blocks the rest of the app from starting to load alongside it",
      "Fixed two app files (Face ID, glucose charts) missing from the offline cache list"
    ]
  },
  {
    version: "2.2.0",
    summary: "Quick-carb chips for treating lows, a \"Recently Logged\" row for one-tap repeat meals, and a clinic report you can generate and save as a PDF.",
    changes: [
      "Treating a Low now has 15g/20g/30g quick-add buttons — one tap logs carbs only, no food search needed",
      "Added a \"Recently Logged\" row above food search showing your last few distinct meals, one tap to log the same thing again — can be turned off in Settings → General if you'd rather not see it",
      "Added \"Generate clinic report\" in History → Glucose: a printable summary (glucose stats, time in range, daily pattern, and what you've actually been logging) you can save as a PDF for a doctor visit — works even without much glucose history",
      "Fixed the Recently Logged row not showing up right after signing in"
    ]
  },
  {
    version: "2.1.0",
    summary: "Added a real glucose history (not just live readings), a Daily Pattern/Time in Range tab, Face ID unlock, and an Apple Health export.",
    changes: [
      "Glucose readings are now saved to your own database as they're fetched, not just shown live — this is what makes everything below possible",
      "New History → Glucose tab: a daily pattern chart (median + percentile bands, adjustable), a Time in Range breakdown, and real stats (average, estimated A1c, time in range) over 7/14/30/90 days",
      "Added a one-time \"Import history from Nightscout\" backfill (Settings → Nightscout Sync) to seed that history from what Nightscout already has",
      "Fixed glucose charts silently truncating to Supabase's row-return cap on large windows, and sped up loading by fetching in parallel instead of one page at a time",
      "Fixed the glucose charts' vertical scale wasting space on the 0–70 range, which made real variation look flatter than it was",
      "Passphrase-locked devices now stay unlocked until you lock them again or fully close the app, instead of re-prompting on every reload",
      "Added optional Face ID / Touch ID unlock as a faster alternative to retyping your passphrase (the passphrase itself still exists and still matters)",
      "Added a read-only Health export endpoint so an iOS Shortcut can pull recent insulin doses and carbs into Apple Health automatically",
      "Internal: another ~250 automated tests added across this work"
    ]
  },
  {
    version: "2.0.0",
    summary: "Multi-device sync no longer loses data; Nightscout sync now follows edits and deletes; big safety net added underneath everything.",
    changes: [
      "Fixed: using the app on two devices could silently overwrite meals logged on the other one — changes from both devices are now merged instead",
      "Fixed: deleting a meal could come back if another device synced afterwards — deletes now stick",
      "Editing or deleting a logged meal now updates or removes it in Nightscout too (previously only the first write ever reached Nightscout); this can be turned off in Settings",
      "Nightscout can now send each meal as one combined entry or as separate carb/insulin entries — your choice in Settings",
      "The Nightscout connection now goes through a rewritten, hardened proxy (no more open-URL risk) — old direct-URL fallback still works if you're briefly offline",
      "Fixed a security issue where a food's saved name/unit could run code on the History screen",
      "History now loads instantly regardless of how many meals you have (older meals load with a \"Show older\" button), and can be searched",
      "Added a Nightscout sync status badge on each meal in History — tap it to see details or retry a failed one",
      "Fixed: editing a \"treating a low\" entry could accidentally add back an insulin dose",
      "Fixed: correction-only entries (no food) couldn't be saved from the edit sheet",
      "Fixed: editing a meal's items didn't recompute how quickly its carbs are absorbed, leaving Active Insulin & Carbs slightly stale afterwards",
      "This device now automatically keeps its last 10 backups (Settings → Data), so a bad sync or accidental import/delete can be undone",
      "Added a Diagnostics report (Settings → Data) — a copyable, redacted summary to help track down sync or Nightscout problems",
      "Alerts and confirmations now use the app's own style instead of the browser's plain pop-ups",
      "Added offline caching (a service worker) that updates itself automatically on each new deploy, so you are never stuck on stale code",
      "Internal: rebuilt on a tested module architecture (over 140 automated tests covering the sync/merge logic, Nightscout delivery, and the security proxy)"
    ]
  },
  {
    version: "1.12.1",
    summary: "The food list now uses the full window height on tablets and computers.",
    changes: [
      "On wider screens the Add Food list grows to fill the window instead of stopping at a fixed height, so you see many more foods at once",
      "Phones are unchanged, and the list never gets shorter than before on small windows"
    ]
  },
  {
    version: "1.12.0",
    summary: "Trends overhaul: real axes and averages, tap any day for exact numbers, meal vs correction insulin, and a per-meal breakdown.",
    changes: [
      "Charts now have proper axes, a dashed average line, weekend shading and weekday labels, with today highlighted",
      "Tap any day to see its exact carbs and insulin -- the same day lights up in both charts so you can compare them",
      "Insulin bars now split meal insulin from correction insulin, with the correction share shown underneath",
      "New insight cards: carbs per unit, corrections, and lows treated",
      "New 'By meal' card comparing average carbs, dose and g-per-unit for breakfast, lunch, dinner and snacks",
      "Averages now use complete days only (today is left out until it's over) so a half-finished day no longer drags them down",
      "Fixed day buckets breaking across clock changes, which would have blanked days in the charts after 25 October"
    ]
  },
  {
    version: "1.11.1",
    summary: "Actually fixed the Active Insulin & Carbs panel's spacing this time -- the chevron was leaving ~100px of dead space after it.",
    changes: [
      "The stat content and the chevron are now properly balanced across the full row, instead of clustering left with a large empty gap afterward",
      "The chevron sits at the true trailing edge of the panel, matching standard disclosure-indicator placement"
    ]
  },
  {
    version: "1.11.0",
    summary: "The Active Insulin & Carbs graph now has three tabs: the forward projection, today's real history, and (with Nightscout) an actual glucose trend.",
    changes: [
      "Added tabs to the graph: \"Now\" (the existing forward projection), \"Today\" (what actually happened from midnight to now), and \"Glucose\" (a real CGM trend from Nightscout, when configured)",
      "The Glucose tab shows the last ~6 hours with the standard 70\u2013180 range shaded, using the same Supabase proxy as the rest of Nightscout sync",
      "Fixed a label overlap on the Today tab, where \"now\" and the end-of-graph time always coincide"
    ]
  },
  {
    version: "1.10.3",
    summary: "Test Connection now shows Nightscout's actual response (including the created-document id), to diagnose writes that report success but don't persist.",
    changes: [
      "The write proxy now forwards Nightscout's real response body instead of a plain yes/no",
      "Test Connection and every real sync now report the id Nightscout assigned the new record, or a clear note when one wasn't returned",
      "This surfaces cases where a write reports success but nothing actually lands in the treatments collection"
    ]
  },
  {
    version: "1.10.2",
    summary: "System Status now shows Nightscout read and write separately, and Test Connection reports the real, complete picture.",
    changes: [
      "Split \"Nightscout Sync\" into separate, auditable Read and Write rows, showing which path (Supabase proxy or direct) actually succeeded and when",
      "Both rows reflect real usage automatically -- every actual fetch or sync updates them, not just a manual test",
      "Test Connection now actually exercises the Supabase proxy for both read and write, instead of only ever testing the direct path -- so it no longer says \"could not reach\" when sync is genuinely working via the proxy"
    ]
  },
  {
    version: "1.10.1",
    summary: "Nightscout sync (carbs and insulin) now also routes through the Supabase proxy, fixing the CORS block that stopped writes before.",
    changes: [
      "New Supabase Edge Function (write-nightscout-treatment) posts meal/correction data to Nightscout server-side",
      "Meal sync and the queued-retry sync both now try this proxy first when signed in, falling back to a direct request otherwise",
      "Test Connection now clarifies that a direct CORS failure doesn't mean sync itself is broken, since the proxy covers it"
    ]
  },
  {
    version: "1.10.0",
    summary: "Nightscout glucose fetch now routes through a Supabase proxy first, sidestepping the CORS block entirely when you're signed in.",
    changes: [
      "New Supabase Edge Function (fetch-nightscout-glucose) makes the Nightscout request server-side, where browser CORS restrictions don't apply",
      "Fetch from Nightscout now tries this proxy first when signed in to Cloud Sync, falling back to a direct request otherwise",
      "Clear messaging when the proxy isn't available because you're not signed in"
    ]
  },
  {
    version: "1.9.2",
    summary: "Fixed an oversized logged-time field and a wasted line taken up by the reset icon.",
    changes: [
      "The logged-time field in Edit Meal now sizes to its content instead of stretching full width",
      "Moved the reset (trash) icon up next to the carbs pill, so it no longer forces the dose card's pills onto an extra line by itself"
    ]
  },
  {
    version: "1.9.1",
    summary: "Edit a meal's logged time (with Active Insulin & Carbs updating to match), and a more compact dose card.",
    changes: [
      "Edit Meal now includes the logged time — changing it correctly re-sorts History and recalculates Active Insulin & Carbs",
      "Reduced the size of the dose card at the top of the Calculator — smaller text, tighter spacing, pills now fit on one line"
    ]
  },
  {
    version: "1.9.0",
    summary: "Log carbs with no insulin when treating a low, and optionally pull your glucose straight from Nightscout.",
    changes: [
      "New \"Treating a Low\" toggle — logs your food and carbs as usual but always records zero insulin, regardless of your ratio",
      "Carbs logged this way still count toward Carbs on Board; insulin correctly stays at zero on the Active Insulin & Carbs panel",
      "New \"Fetch from Nightscout\" option in the Correction row, pulling your latest CGM reading (shows its age, and flags it if it's more than 15 minutes stale)"
    ]
  },
  {
    version: "1.8.3",
    summary: "The Active Insulin & Carbs graph now shows real axis values, and corrections can optionally account for IOB.",
    changes: [
      "The graph now shows actual insulin (units) and carb (grams) values on its axes, color-matched to each line, plus hourly time ticks",
      "New optional setting (off by default): subtract active insulin from a correction dose, the same way pump bolus calculators do — your meal dose is never affected",
      "When active, the Calculator shows the exact breakdown (e.g. \"Correction: 4u − 3.6u IOB = 0.4u\") rather than hiding the adjustment"
    ]
  },
  {
    version: "1.8.2",
    summary: "The Active Insulin & Carbs panel is now tappable for a graph, and more compact.",
    changes: [
      "Tap the Active Insulin & Carbs panel to see a graph of insulin and carbs projected forward until both clear",
      "Made the panel itself noticeably smaller",
      "Moved its Insulin & Carb Timing settings into the Insulin Ratios tab, alongside your other dosing settings"
    ]
  },
  {
    version: "1.8.1",
    summary: "You can now log a correction on its own, with no food required.",
    changes: [
      "The Log button now works for a correction-only entry (no food added)",
      "Correction-only entries get their own label and icon in History, instead of being mislabeled by time of day",
      "Active Insulin & Carbs correctly counts a correction-only dose as IOB"
    ]
  },
  {
    version: "1.8.0",
    summary: "New: an Active Insulin & Carbs panel on the Calculator, estimating what's still on board.",
    changes: [
      "Added an Active Insulin & Carbs panel showing estimated IOB and COB, with time until each clears",
      "Uses the same exponential insulin model as Loop/AndroidAPS/OpenAPS, with editable peak time and duration (presets for NovoRapid/Humalog and Fiasp/Lyumjev)",
      "Carb absorption time now editable per GI band in Settings",
      "Display only — these estimates never feed into your suggested dose"
    ]
  },
  {
    version: "1.7.0",
    summary: "Ratio editing on logged meals, clearer meal icons, and a quicker way to clear search.",
    changes: [
      "Edit a previously logged meal's insulin ratio, not just its items",
      "Breakfast, Lunch, and Dinner now each have a distinct, clearer icon",
      "Added a quick clear (×) button to the food search field"
    ]
  },
  {
    version: "1.6.0",
    summary: "A cloud sync bug that could lose history has been fixed, with a permanent safeguard added.",
    changes: [
      "Fixed a bug where a failed cloud sync could overwrite real data with an empty state",
      "Added a general safeguard that blocks any future sync from silently erasing existing history",
      "Added a System Status panel showing cloud sync, Nightscout, and offline status at a glance"
    ]
  },
  {
    version: "1.5.0",
    summary: "Personalize your background, and let the app follow your device's appearance automatically.",
    changes: [
      "Added custom background colors, independent of your color theme",
      'Added "Match System Appearance" to follow your device\'s light/dark setting automatically'
    ]
  },
  {
    version: "1.4.0",
    summary: "A visual refresh across Settings for better consistency and readability.",
    changes: [
      "Insulin ratio rows are now color-coded to match the 24h timeline",
      "Distinct icons and colors for Account, Nightscout, and Privacy sections",
      "Reduced clutter and tightened spacing throughout Settings and the Food Library"
    ]
  },
  {
    version: "1.3.0",
    summary: "Faster logging with a sticky Log button, and a more compact calculator.",
    changes: [
      "The Log Meal button now stays fixed at the bottom of the screen",
      "Reduced font sizes and spacing across the calculator for more content per screen"
    ]
  },
  {
    version: "1.2.0",
    summary: "Glycemic index tracking, so you can see how a meal might affect your blood sugar.",
    changes: [
      "Added glycemic index (GI) to many common foods",
      "Meals now show a carb-weighted compound GI, not just total carbs"
    ]
  },
  {
    version: "1.1.0",
    summary: "Unit-based foods, trends, and Nightscout integration.",
    changes: [
      'Foods can now be logged by quantity (e.g. "1 slice") instead of just grams',
      "Added a Trends view with daily carb and dose charts",
      "Added automatic Nightscout sync for logged meals"
    ]
  },
  {
    version: "1.0.0",
    summary: "The original rebuild — a dependency-free, static version of the Base44 app.",
    changes: [
      "Full rebuild of the original insulin dose calculator as a static web app",
      "Runs entirely in your browser — nothing is sent anywhere unless you set up sync"
    ]
  }
];

export const VERSION = CHANGELOG[0].version;
