// What changed in each release, newest first. The Settings version card is always drawn from CHANGELOG[0], so the badge and the
// summary can never drift. Bump CHANGELOG[0].version here (and CACHE_VERSION in sw.js) on every release.
export const CHANGELOG = [
  {
    version: "2.53.4",
    summary: "Swiping a log row is more precise, and the date and time box fits the screen on iPhone.",
    changes: [
      "Swipe to Edit / Delete follows your thumb: a slightly diagonal swipe now counts (it was often taken for a scroll and did nothing), and the row no longer jumps when the swipe starts",
      "A quick short flick opens or closes a row; a slow drag opens once it is 40% of the way. Before, only a drag past halfway counted",
      "Dragging past the buttons slows down gently instead of stopping dead",
      "Edit and Delete respond straight after the swipe that reveals them (a tap in the first moment used to be ignored)",
      "The Logged time box on Edit Meal (and the basal time) no longer runs off the right edge on iPhone; it lines up with the boxes below it",
      "Doses are unchanged"
    ]
  },
  {
    version: "2.53.3",
    summary: "You can now edit an Eating out entry: change its date and time, the insulin you took, or the meal type.",
    changes: [
      "Editing an Eating out entry used to stop with \"A meal needs at least one item\", so a new date or time could never be saved. It now opens as Eating out, with the time, the insulin you took and the meal type",
      "Your dose is kept exactly as entered. It is never recalculated from the 0 g of carbs on the entry (which would have set it to zero)",
      "Corrections can have their time changed too: the Logged time box now shows for every kind of entry",
      "Tidier Edit screen: the four entry types fit on one line, the time box is full width, and the meal-type buttons no longer show as white blocks in dark mode",
      "Doses are calculated exactly as before"
    ]
  },
  {
    version: "2.53.2",
    summary: "The Grams number stays centred while you type.",
    changes: [
      "On the Calculator, the number in the Grams box jumped to the left when the clear X appeared. It now stays in the middle of the box, with the X beside it",
      "The Grams box is a little wider so amounts up to four digits fit comfortably next to the X",
      "Doses are unchanged"
    ]
  },
  {
    version: "2.53.1",
    summary: "The Log Meal button no longer sits on top of the tab bar on iPhone.",
    changes: [
      "On the iPhone home-screen app the Log Meal to History bar could overlap the Calculator / Insights / Settings tabs. The phone adds its home-indicator space after the app starts, which made the tab bar taller, but the Log bar kept its old position. It now moves whenever the tab bar changes size",
      "Doses are unchanged"
    ]
  },
  {
    version: "2.53.0",
    summary: "Every text box gets a clear X, nothing opens pre-selected, and the rest of the app is tidied to match the Calculator.",
    changes: [
      "While you type in any text or number box, a small X sits at its right-hand end. Tap it to empty the box; the keyboard stays up. It disappears when you leave the box",
      "Nothing opens with its text already selected: the Log basal box shows last time's dose with the cursor after it, and editing a meal's grams does the same. Typing no longer wipes the number by surprise",
      "Every box looks the same when you're in it: an accent-coloured border with a soft glow (some had a double ring, others only changed colour)",
      "Date-range and sub-view switches (7 / 14 / 30 days, Daily Pattern, Foods / Recipes, the Browse tabs) are slimmer and quieter than the main tabs, so screens no longer stack two or three identical bars",
      "Trends: the line under each chart title is a quiet subtitle, and longer notes read left-aligned",
      "Glucose: not being signed in to Cloud Sync is shown as a calm empty message instead of red error text",
      "Settings: boxes with a unit (50 mg/dL) are one box instead of a box inside a box; the ratio pills and bins line up; the ratio timeline never cuts a label in half; the three insulin types sit on one row; Learn from my history now is no longer a glaring white block in dark mode; food category chips are softer in dark mode",
      "Recipe editor: ingredient search, grams and + now sit on one line, like the Calculator",
      "Doses are unchanged"
    ]
  },
  {
    version: "2.52.0",
    summary: "A tidier Calculator and log: even spacing, one text size per job, nothing cut off.",
    changes: [
      "The dose card has the same gap between every row. The Meal + correction line no longer sits on top of the Correction, Treating a Low and Eating Out buttons",
      "Add and Subtract are now a slim two-way switch, styled like the Correction button when it is on, and the correction number box matches the rest of the card instead of being oversized",
      "Current meal rows read 69g instead of 69   g: the grams number hugs its unit and is the same size as the text beside it (it looked bigger on iPad and computer)",
      "In the log, the GI chip is always one piece on the same line as the food names. Long food lists end in … instead of being cut mid-word; tap the row to see every food",
      "The NS and GI chips in a log row are the same height",
      "Doses are unchanged"
    ]
  },
  {
    version: "2.51.1",
    summary: "The Current meal tile and the log tiles now match in size and spacing.",
    changes: [
      "The Current meal tile on the Calculator had grown far too tall since 2.50 because a hidden text box inside it had been stretched. It is back to a compact tile, sized in step with the log rows",
      "Ingredient rows in the recipe editor are compact again for the same reason",
      "Log rows are all about the same height: the GI chip now sits next to the food names instead of stacking under the dose, and the Basal row is centred to match",
      "Doses are unchanged"
    ]
  },
  {
    version: "2.51.0",
    summary: "Fresher colours, a clearer dose badge in the log, editable entry type, and swipe to edit.",
    changes: [
      "New, cleaner colours: a cooler, lighter background, crisper text, deeper accent colours in every palette, and a dark mode with more contrast",
      "The dose badge in the log now shows the units actually injected as one clear number, with the split in small type underneath (for example 3 u, 2 meal + 1 corr., or 2 u, 3 meal \u2212 1 cut). A correction on its own and a treated low each have their own look",
      "Edit now has a This entry is switch: Meal dose, Correction or Treated low. Turn a meal into a treated low (no insulin, carbs kept), a meal into a correction (food removed, you choose the dose), or put it back. The row, active insulin, trends and Nightscout follow the change, and Undo restores it",
      "Swipe a log row to the left to reveal Edit and Delete. Tap an opened row to close it. Basal rows swipe too",
      "Doses you log are calculated exactly as before"
    ]
  },
  {
    version: "2.50.0",
    summary: "Tidier, more thumb-friendly forms and buttons across the app.",
    changes: [
      "Every text box, number box, date box and dropdown is now the same height. Three Settings dropdowns (units, rounding, check-after) were only half as tall as the rest",
      "Small buttons (close, back, delete, favourite, the ratio and Correction pills, Restore and the info dots) keep their look but have a bigger touch area, so they are easier to hit with a thumb",
      "The tick boxes (Favourite and so on) can be tapped anywhere on their line",
      "In dark mode the carbs and calorie figures in food lists are brighter and easier to read, and the labels on the Settings timeline have a soft shadow so they read on pale colours",
      "Doses are unchanged"
    ]
  },
  {
    version: "2.49.2",
    summary: "The ratio list on the calculator only shows ranges that apply today.",
    changes: [
      "A range limited to other days of the week (a Sunday-only range on a Monday) is left out of the ratio picker, so the list is shorter. Settings still shows them all",
      "Doses are unchanged"
    ]
  },
  {
    version: "2.49.1",
    summary: "Time-of-day ranges and activity ratios can now be renamed.",
    changes: [
      "Open a range in Settings and use the new Name box; activity ratios have their name field right on the row",
      "Meals already logged under the old name move to the new one, so your insights stay together",
      "Names must be unique and can't be blank. Doses are unchanged"
    ]
  },
  {
    version: "2.49.0",
    summary: "Ratio ranges can now be limited to certain days of the week, and can overlap.",
    changes: [
      "Each time-of-day ratio in Settings has Mon to Sun chips. Untick days to make it a special range, for example a Sunday morning ratio for a day you don't cycle",
      "Ranges can cover the same hours. A range limited to particular days wins over an every-day one on those days; if two are limited, the one with fewer days wins",
      "The timeline in Settings shows the ranges in force today, and the ratio picker and insights name the days",
      "Existing ranges keep applying every day, and doses are unchanged"
    ]
  },
  {
    version: "2.48.0",
    summary: "The recipe editor now adds up your ingredients and checks the weights you type against them.",
    changes: [
      "A new Ingredients total line under the list shows the combined grams and updates as you change an amount",
      "If the Raw weight you typed doesn't match the ingredients, or the Final weight is more than the ingredients weigh, it says so, with a one-tap button to set Raw weight to the total",
      "The Category dropdown and the weight boxes now match the Recipe Name box in height and padding",
      "Doses and saved recipes are unchanged"
    ]
  },
  {
    version: "2.47.2",
    summary: "Fixes the totals when a dose had a reduction taken off the meal.",
    changes: [
      "In the trends and the doctor report, a dose where the correction was negative (a reduction taken off the meal) used to be counted as a negative correction. It is now counted as a smaller meal dose, matching Nightscout, Apple Health and the active-insulin figure",
      "Doses are unchanged"
    ]
  },
  {
    version: "2.47.1",
    summary: "The opening screen is fully drawn from the first instant, even on a very quick start.",
    changes: [
      "On a fast start the opening screen used to show only a dark screen and a pale rectangle, because its parts faded in one after another and the app was ready before they appeared. Now the sun or moon, the trace, the greeting and the line of text are all there from the first frame",
      "The only motion left is a bright spark running along the trace and a ring pulsing at its end, a few times, then still. With Reduce Motion on, nothing moves",
      "Doses are unchanged"
    ]
  },
  {
    version: "2.47.0",
    summary: "A new opening screen that matches the hour and your light or dark look, instead of a blue spinner on white.",
    changes: [
      "The opening screen is now a glucose trace that draws itself, with a greeting for the time of day (Good morning, afternoon or evening) and a sun or moon over a sky that shifts through dawn, morning, day, dusk and night",
      "It is dark from the very first moment if you use dark mode, or if you follow your phone and your phone is in dark mode, so there is no bright white flash at night. The browser bar colour matches too",
      "The look is remembered from the last time you used the app, and your phone's own setting decides on a first start",
      "Battery: the animation plays a few times and then stops; nothing repeats forever. With Reduce Motion on, nothing moves at all",
      "Doses are unchanged"
    ]
  },
  {
    version: "2.46.2",
    summary: "A basal dose moved to a different time of day now changes between Morning and Evening by itself.",
    changes: [
      "Editing a basal dose and changing its time (say from 18:52 to 06:52) now switches it to Morning or Evening to match, unless you tapped Morning or Evening yourself. Before, an edited dose kept its old label, so a 06:52 dose could sit in the Evening bar of the daily basal chart",
      "If the label and the time disagree when you save (06:52 set to Evening), the app asks first, so it is a choice and not a slip",
      "To fix a dose already saved with the wrong label: tap it, choose Morning (or Evening) and Save. The charts update straight away",
      "Doses are unchanged"
    ]
  },
  {
    version: "2.46.1",
    summary: "The doctor report can now be saved as a PDF.",
    changes: [
      "The report has a Save PDF button. It makes a real PDF inside the app (text you can search and zoom, with the charts as pictures) and opens the share sheet, so you can put it in Files, Mail or Messages, or AirDrop it. Before, it relied on printing, which does nothing in the home-screen app",
      "Print is still there for a computer. If sharing is not available the PDF downloads instead",
      "Doses are unchanged"
    ]
  },
  {
    version: "2.46.0",
    summary: "A Statistics view with the figures FreeStyle Libre and Gluroo reports show.",
    changes: [
      "Insights > Glucose has a new Statistics view: average, GMI and the older eA1c Gluroo shows, median, standard deviation, variability (CV, with the 36% steady mark), lowest and highest, average daily range, time in tight range (70-180 and 70-140), and how much of the time the sensor was active",
      "Low and high events as the consensus counts them (15 minutes or more): low under 70, very low under 54, very high over 250, with how long they lasted",
      "Insulin and food, as in Gluroo: total daily insulin with the basal / bolus split, meals a day, average meal bolus and carbs, carbs per unit actually used, corrections up and down, largest dose, lows treated",
      "Daily graphs: a small line for each of the last 14 days with the 70-180 strip behind it",
      "The report for your doctor now lists eA1c, standard deviation, variability, tight range and the events too",
      "Battery: all of it is worked out once when you open the view from readings already loaded, with no timers and no extra fetching",
      "Doses are unchanged"
    ]
  },
  {
    version: "2.45.0",
    summary: "Switching glucose units now converts your target and correction factor, and a quiet note appears when a dose looks unusual.",
    changes: [
      "Changing Settings > Glucose units between mg/dL and mmol/L converts your target glucose and correction factor in the boxes (for example 100 mg/dL becomes 5.5 mmol/L) and tells you, instead of leaving 100 to be read as 100 mmol/L. Switch back before saving and the original numbers return exactly. Check them, then Save",
      "The correction factor box now takes a decimal comma (2,8) as well as a point, and a blank one keeps the old value",
      "A gentle note under the dose when it is much bigger than anything you took in the last 90 days, or very different from meals of the same size. It never blocks logging and only appears once there are enough recent meals to compare with",
      "Battery: nothing runs in the background for either. The unit conversion happens only when you change the box, and the dose check runs only when the dose is recalculated, against a short list built once from your history",
      "Doses are unchanged"
    ]
  },
  {
    version: "2.44.1",
    summary: "The Add / Subtract switch is readable, and there is now a one-command test runner.",
    changes: [
      "The selected side of the Add / Subtract switch is no longer white text on a white button: it now has a darker fill, a white outline and white text, so you can tell which one is on",
      "Doses are unchanged"
    ]
  },
  {
    version: "2.44.0",
    summary: "Combine a meal with a correction, up or down: a high reading adds to the dose, a low one can take units off, and you can type your own change either way.",
    changes: [
      "A manual correction now has Add / Subtract. Subtract takes units off the meal dose (say, 12 u meal minus 1 u because you are a little low). The dose never goes below zero",
      "New setting, Dosing > Lower the dose when glucose is below target (off by default): with it on, a reading under target reduces the meal dose by (reading - target) / sensitivity. With it off nothing changes",
      "The dose card shows the split, for example Meal 12 u + correction 4 u, or Meal 12 u - 1 u taken off",
      "Target glucose (the baseline corrections work from) is yours to set in Settings > Dosing. It now accepts a decimal comma, and a blank box keeps your old target instead of silently saving 0",
      "Logged meals, edits, Trends and the Health export all handle a reduction, and Health receives the net units injected"
    ]
  },
  {
    version: "2.43.1",
    summary: "Easier on the battery: no endless animation, and no background polling while the app is hidden.",
    changes: [
      "The Log button's glow and the sync dot now pulse a few times and then stay still. Before, they animated forever, which kept the screen redrawing (and the glass blur recalculating) for as long as a meal was waiting",
      "While the app is hidden or the phone is locked, its 30-second check-in no longer runs. Nothing is lost: the moment you open the app again it updates the ratio, glucose and sync status straight away",
      "Live glucose is now fetched at most about once a minute instead of every half minute. Opening the app, and the Fetch button, still always get a fresh reading",
      "Doses are unchanged"
    ]
  },
  {
    version: "2.43.0",
    summary: "Three tabs: Calculator, Insights, Settings. Library moves into the Calculator and Settings.",
    changes: [
      "The bottom bar is now Calculator, Insights and Settings. History is renamed Insights and holds Meals, Trends and Glucose in one place",
      "New Browse button next to Add Food Item in the Calculator: pick from your Favourites, Most used, Recipes or everything, with search, without leaving the meal you're building",
      "Your food and recipe library is managed under Settings > Library (add, edit, star, delete, import and export are all there, exactly as before). Browse has a shortcut to it",
      "Under the hood: all colours, corner radii, spacing, text sizes and the glass look now come from one design file, so the look can be changed in one place. Text and corners snap to a tidier scale, so a few things shift by a pixel or two",
      "Doses are unchanged: the calculator, the search list and Browse all end up in the same dose calculation"
    ]
  },
  {
    version: "2.42.3",
    summary: "Fix: Edit and the remove cross showing through meal rows.",
    changes: ["In the Current Meal list, the Edit button hidden behind each item showed through the item after the glass update, overlapping the X. The item face is solid again, and Edit only appears when you swipe"]
  },
  {
    version: "2.42.2",
    summary: "Fix: sheets no longer bounce or let the background scroll.",
    changes: ["Log basal (and any short panel) no longer rubber-bands or lets the page behind drift when you drag on it: with nothing to scroll, the drag is now ignored. Longer panels still scroll normally, and pulling past their top or bottom no longer drags the page behind"]
  },
  {
    version: "2.42.1",
    summary: "Soft rounded scrollbars on computers.",
    changes: ["On a computer or iPad with a mouse, scrollbars in panels like What's changed, dialogs and long lists were square bars with arrows that poked out of the rounded corners. They are now slim rounded bars, inset from the corners, with no arrows. Phones are unchanged"]
  },
  {
    version: "2.42.0",
    summary: "Liquid Glass applied consistently across the whole app.",
    changes: ["Every surface now follows one glass system: cards, panels, filter and ratio panels, the version card, trend cards, chips, tabs and graph switches are frosted; long lists (foods, history, recipes, setting rows) use the same tint and light edge without live blur so scrolling stays smooth; sheets and dialogs use a denser glass so text stays easy to read", "Fixed dark-mode text that was nearly invisible on the colour-theme cards, and the faint favourite stars in the Library", "The Food Name box in the add-food sheet now fills its row"]
  },
  {
    version: "2.41.4",
    summary: "The low-glucose note now matches the other banner notes.",
    changes: ["The \"Low (69 mg/dL)...\" note in the dose banner uses the same text size, padding and tint as the other notes, so its text lines up with them, with a small red edge to mark it"]
  },
  {
    version: "2.41.3",
    summary: "Fix: blank blurred box in Settings on iPad.",
    changes: ["On wide screens (iPad, computer) Settings showed an empty blurred panel where a card should be, a Safari quirk with the glass blur inside two-column layouts. Those cards now use the glass tint and edge without the live blur", "Dark mode: the titles of the Import / Export and Backup rows in Data were nearly black on dark and are now readable"]
  },
  {
    version: "2.41.2",
    summary: "Liquid Glass on the Calculator's food list too.",
    changes: ["The food search box, the Grams box and the food list on the Calculator now use the same frosted glass style as the other tabs, in light and dark"]
  },
  {
    version: "2.41.1",
    summary: "Fix: the Liquid Glass look now shows on iPhone.",
    changes: ["The glass style was switched off by a setting Safari does not understand, so on iPhone you saw no change. It is now on by default and only turns off if you enable Reduce Transparency on a browser that supports that setting"]
  },
  {
    version: "2.41.0",
    summary: "Settings reorganised into four tabs, and a Liquid Glass look.",
    changes: ["Settings now has four tabs: Dosing (ratios, correction, timing and the after-meal glucose check), Sync (status, account, Nightscout), Data (import/export, backups, diagnostics) and General (theme, background, privacy). Nothing was removed, things are just where you would look for them, and the long Data page is now much shorter", "A softer, translucent Liquid Glass style on the cards, the tab bar and the switches: frosted panels with a light edge and gentle shadows, and a glossy sheen on the dose banner. Long lists keep a lighter version so scrolling stays smooth. If your phone has Reduce Transparency on, it falls back to the plain look", "The sign-in email box now matches the other fields"]
  },
  {
    version: "2.40.0",
    summary: "Roomier dose banner on phone and on wide screens.",
    changes: ["On a phone the buttons in the top banner (Correction, Treating a Low, Eating Out) are slightly taller with a little more space between them, so they are easier to read and tap", "On tablets and computers the banner grows to match: larger buttons, more padding and more space between rows"]
  },
  {
    version: "2.39.1",
    summary: "Library tiles back to their compact size.",
    changes: ["The usage count in the corner no longer adds empty space: tiles are as short as before, and the count sits in the bottom right of the tile"]
  },
  {
    version: "2.39.0",
    summary: "Library tiles are tidier: usage count moved to a quiet corner.",
    changes: ["In Foods and Recipes, how many times you have used an item now sits as a small light icon and number in the bottom right of its tile, on every screen size, instead of wrapping onto the details line", "Tiles in the same row are now the same height, so wide screens look neater"]
  },
  {
    version: "2.38.0",
    summary: "Under the hood: ready for a real iOS app with Health and notifications.",
    changes: ["Nothing should look different. Saving files, copying text and the after-meal reminder now go through one device layer, so a future iPhone app can plug in real notifications, Apple Health and Face ID by swapping that one piece. An Apple Health destination for the sending queue is built and tested but stays switched off on the web", "355 shared test cases now pin down every dose, glucose and sync calculation, so a Swift version can be proven to give identical answers"]
  },
  {
    version: "2.37.0",
    summary: "Under the hood: cloud sync's safety rules are now separate and tested.",
    changes: ["Nothing should look different. When to upload, when to pull other devices' changes, and the guard that refuses to upload an emptied history now live in one tested module, with Supabase plugged in as the first destination. One real fix: if you saved twice within half a second, the first save used to wait forever instead of finishing"]
  },
  {
    version: "2.36.0",
    summary: "A readable event log, and a red dot when sync is stuck.",
    changes: ["Settings > Diagnostics has a new View log button: recent events newest first, in plain names (Nightscout sending, Cloud sync...), repeats folded together, problems picked out in colour, with a Problems only switch", "The Settings tab shows a red dot when sending is genuinely stuck: a real sync problem, or entries waiting more than 30 minutes while you are online. Being offline does not trigger it, and Diagnostics then says what needs attention"]
  },
  {
    version: "2.35.0",
    summary: "Under the hood: the sending queue no longer belongs to Nightscout.",
    changes: ["Nothing should look different. The offline-safe queue that sends meals to Nightscout is now a general one that works with any destination, with Nightscout plugged in as the first. Adding Apple Health, or a native app's own sync, later means adding one more destination, not rebuilding the queue. Tests now run the queue against a made-up second destination to prove it"]
  },
  {
    version: "2.34.0",
    summary: "Under the hood: one dose calculation, fixed test table, and a last check before saving.",
    changes: ["Doses are now worked out in exactly one place. The calculator and the edit-meal sheet used to each have their own copy of the maths; they now share one, proven identical to the old behaviour on 40,000 random cases, so the dose you see and the dose that is saved cannot disagree", "A table of 38 hand-checked dose scenarios is now part of the tests, so any future change to how doses are calculated has to be deliberate", "Log now re-works the dose from what is on screen and refuses to save if the parts don't add up to the number shown, with a clear message instead"]
  },
  {
    version: "2.33.0",
    summary: "Under the hood: a written data contract, checked in code.",
    changes: ["Nothing should look different. The exact shape of your saved data (meals, basal doses, foods, recipes, settings) is now written down in docs/DATA-CONTRACT.md and enforced by a tested checker. Importing a backup skips, and tells you about, any record that would break the app, and Settings diagnostics shows a data check line"]
  },
  {
    version: "2.32.0",
    summary: "Under the hood: one storage layer for everything saved on your device.",
    changes: ["Nothing should look different. Every read and write of saved data now goes through one tested module, so a blocked or full device can't crash the app, failures are written to the diagnostics log, and saved data now has a version number so future changes can upgrade it safely"]
  },
  {
    version: "2.31.0",
    summary: "Under the hood: the app's logic now lives in separate, tested modules.",
    changes: ["Nothing should look or behave differently. Meal logging, library import and export, recipe totals and the time-of-day ratio logic moved out of the screen code into a new js/core folder with its own tests, a first step toward a native app"]
  },
  {
    version: "2.30.2",
    summary: "Tidier History log cards.",
    changes: ["Each record now has the same layout: meal name, a quiet time line, and on the right the insulin dose with carbs and calories on one line and the GI chip below. The NS badge no longer wraps, the redundant period name is hidden unless a ratio was applied, 'No insulin' is a calm outlined chip, and the Basal card matches the others"]
  },
  {
    version: "2.30.1",
    summary: "The Undo bar no longer sits on the Log button.",
    changes: ["On the calculator the Undo bar now floats above the Log bar instead of over the Log and Reset buttons, so a second tap can never land on the wrong thing. On other screens it sits just above the tab bar"]
  },
  {
    version: "2.30.0",
    summary: "Sturdier startup and tidier code.",
    changes: ["The app no longer stops starting if a button is missing from an older index.html: it skips that button and notes it in the diagnostics log","Under the hood: the release notes and the ready-made recipes moved out of app.js into js/changelog.js and js/seed-recipes.js","A GitHub check now runs the unit tests on every push"]
  },
  {
    version: "2.29.0",
    summary: "Removed the insulin delivery experiment.",
    changes: ["Settings > Nightscout: the Insulin delivery experiment (the 0.1 u test record and its Delete button) is gone. It did its job: the app already sends insulin in the shape Gluroo keeps. Test Connection is unchanged"]
  },
  {
    version: "2.28.2",
    summary: "No more jump in the carbs line at now.",
    changes: ["Active insulin & carbs: the carbs line jumped upwards at the now marker when your readings said more carbs were left than the fixed timers. The past half-hour is now eased into the adjusted value, so the line is smooth. Nothing about your logged meals or doses changed"]
  },
  {
    version: "2.28.1",
    summary: "The 12h and 24h glucose windows now show the full period.",
    changes: ["Glucose tab: 12h and 24h did nothing because only the latest 300 readings were kept, which at a reading every minute or two is only about 5 to 9 hours. The saved glucose now reaches back a full 26 hours, however often your sensor reports"]
  },
  {
    version: "2.28.0",
    summary: "Observed vs expected now accounts for basal insulin.",
    changes: ["Observed vs expected: your logged basal doses are used. A usual dose is assumed to cancel what your liver releases, so only a dose that differs from your usual moves the dashed line; a missed basal is flagged instead of silently blamed on food","The dashed line no longer runs off the bottom: it stops at a floor, and says so. Basal doses show as teal triangles on the chart"]
  },
  {
    version: "2.27.1",
    summary: "Starts even if index.html is older than the app.",
    changes: ["Fixed the app staying on Loading your data when index.html on the site was older than app.js (the new Fill missing food details button was missing and its handler stopped startup). A missing optional button is now skipped"]
  },
  {
    version: "2.27.0",
    summary: "Reopens where you left off; one home for food reference data.",
    changes: ["The app now reopens on the screen you were on, scrolled to the same place, if you left it within the last 6 hours. After a longer break it opens on the calculator as before. A meal in progress was already kept","Under the hood: the built-in glycaemic index values now live in the same file as the fill-missing-details reference, so a correction is made in one place. Nothing changes in what you see"]
  },
  {
    version: "2.26.0",
    summary: "Fill in missing food details with typical values.",
    changes: ["Settings > Data > Fill missing food details: fills blank glycaemic index, fat, protein, salt and calories with typical values for the foods you already have. It only fills empty fields, never changes anything you entered, and offers Undo. Filled GIs show as GI ~55 and the food's edit sheet says which values were estimated","Zero-carb foods (meat, fish, eggs, cheese, oil) are left without a GI on purpose, as are foods I could not estimate honestly"]
  },
  {
    version: "2.25.1",
    summary: "The sync indicator now lives in Settings, where it can be seen.",
    changes: ["The sync chip moved from the top edge of every screen (where it was hard to see, especially in dark mode) to the top right of Settings, larger and with a clear outline. Tap it for the same breakdown and Try again now button"]
  },
  {
    version: "2.25.0",
    summary: "A sync indicator: always know whether it is saved and sent.",
    changes: ["A small chip at the top right of every screen says Synced, Sending, Offline, Check sync or On this device. Tap it for a plain-English breakdown of this device, your cloud account and Nightscout/Gluroo (how many entries are waiting, how old, and the last problem), with a Try again now button","It updates the moment something is logged, sent, fails or you go offline or back online"]
  },
  {
    version: "2.24.0",
    summary: "Undo for logging, editing and replacing; calmer undo bar.",
    changes: ["Logging a meal now shows an Undo bar: tapping it removes the entry (and its Nightscout record) and puts what you had in the Calculator back exactly as it was","Editing a meal can be undone the same way","Picking a past meal while the Calculator has something in it no longer asks 'Continue?': it just does it and offers Undo","The Undo bar stays for 8 seconds instead of 5, shows how much time is left, and holds still while you are touching it"]
  },
  {
    version: "2.23.0",
    summary: "Glucose now loads instantly everywhere, from one shared store.",
    changes: [
      "Recent glucose is kept on your device in one shared store that every screen reads from, and topped up quietly in the background with only the newest readings. The Now and Glucose tabs open instantly with the numbers already in place, instead of showing a loading message and redrawing",
      "Screens only redraw when a refresh actually brings a new reading, and never while an explanation (i) is open",
      "If Nightscout can't be reached, the saved readings stay on show with a note saying so",
      "Far fewer requests to Nightscout: switching between tabs no longer downloads the same readings again"
    ]
  },
  {
    version: "2.22.0",
    summary: "An \"i\" beside each graph explains how it is worked out.",
    changes: ["Active Insulin & Carbs: every graph and prediction (Now, projected glucose, observed vs expected, Today, Glucose) has an i button that explains in plain words how it is calculated, using your own settings","Settings: the Learn from my readings block has the same explainer"]
  },
  {
    version: "2.21.1",
    summary: "Spacing fixed in the Active Insulin & Carbs sheet.",
    changes: ["Text no longer sits on top of the chart legends and headings in the Now and Glucose tabs"]
  },
  {
    version: "2.21.0",
    summary: "Glucose model: observed vs expected, learned carb timers, projected glucose.",
    changes: [
      "Glucose tab: a new Observed vs expected chart shows your readings beside where the insulin you logged would have taken you from your last meal or dose, with the gap explained in words",
      "Now tab: the carbs line now follows what your glucose readings show (a fast or slow meal is seen as fast or slow), instead of always a fixed timer",
      "Now tab: a Projected glucose chart from your last reading, clearly labelled as a projection assuming no further food or insulin (not a measurement and not dosing advice)",
      "Settings: Learn from my readings works out how long carbs really take for each GI group from past meals eaten alone, with a switch to use those times instead of the fixed ones. Estimates ignore basal insulin, exercise, illness and sensor error"
    ]
  },
  {
    version: "2.20.2",
    summary: "Abstract background laid out as an even staggered pattern.",
    changes: ["The Abstract background is now a designed, staggered pattern instead of a random scatter: shapes sit in even rows, nudged slightly so it still looks hand-placed. Neighbouring shapes never repeat a shape or a colour, every shape turns up equally often, and each is sized to fill its slot evenly. Still drawn to fit your screen, so it never tiles"]
  },
  {
    version: "2.20.1",
    summary: "Calmer, evenly spaced Abstract background.",
    changes: ["The Abstract background is calmer: only your big coloured shapes and longer linework, no confetti or tiny marks, each placed at the best of many spots so the gaps come out even. Nothing overlaps, and every shape turns up about equally often"]
  },
  {
    version: "2.20.0",
    summary: "Three meal recipes added; batch-weight bar fixed.",
    changes: ["Added three ready-made recipes: a pub-style cheeseburger and chips, a classic chicken pad thai, and the sweet pancakes at Where Pancakes Are in Battersea. They are typical estimates (each recipe says so in its notes): weigh your own portion and adjust the amounts. They are added once and stay gone if you delete them", "The \"This batch's cooked weight\" bar was squashed (the g was pushed against the edge); it now has proper room"]
  },
  {
    version: "2.19.2",
    summary: "Abstract background packed evenly, with no gaps.",
    changes: ["The Abstract background now fills the whole screen evenly: big shapes first, then medium ones and loose linework in the gaps, then small shapes and confetti, and still nothing overlaps"]
  },
  {
    version: "2.19.1",
    summary: "Abstract shapes no longer overlap.",
    changes: ["The scattered Abstract shapes are now placed so none of them touch or overlap, with loose linework filling the gaps"]
  },
  {
    version: "2.19.0",
    summary: "Abstract background no longer repeats; thinner doodle lines.",
    changes: [
      "The Abstract background is now drawn to fit your screen too: your artwork's shapes are scattered across the whole screen, so nothing tiles or repeats. New files js/abstract-field.js and js/abstract-motifs.js",
      "The doodle lines are thinner"
    ]
  },
  {
    version: "2.18.0",
    summary: "Doodle background no longer repeats.",
    changes: ["The Doodles background is now drawn to fit your screen instead of tiling one small picture, so it never repeats, on a phone, an iPad or a big monitor. It is laid out again if the window changes size. Abstract still uses its tile. New file js/doodle-field.js"]
  },
  {
    version: "2.17.1",
    summary: "Edit a recipe ingredient's grams in place.",
    changes: ["In the recipe editor, tap the grams next to any ingredient to change it directly. No more removing and re-adding it"]
  },
  {
    version: "2.17.0",
    summary: "Last-time lines, usual low treatment, glucose-check reminder, recipe batch weight, report patterns.",
    changes: [
      "Pick a food and the calculator shows the last 3 times you had it: the amount, the insulin you took, and your glucose 3 hours later when readings are available",
      "Treating a low now shows your own usual amount (the middle of your last low treatments), and a low reading on the dose card points you to it. It is only your own history, not advice",
      "New “After-meal glucose check” setting (Settings): after you log a meal with insulin, a card on the calculator says when to check, with an Add to calendar button so your phone alerts you even when the app is closed",
      "Recipes: when you add a recipe you can enter this batch's cooked weight, and the carbs per 100 g update for that meal",
      "The doctor report now has a Patterns section: ratios used vs ideal vs set now, glucose 3 hours after meals, overnight drift, correction results and the foods with the biggest rise"
    ]
  },
  {
    version: "2.16.0",
    summary: "Glucose insights in Trends.",
    changes: [
      "New “Glucose insights” section under Trends, built from your stored glucose readings and the meals you logged: the typical glucose curve for 4 hours after a meal (per ratio bracket), where glucose is 3 hours after meals (low / in range / high), foods to watch (biggest rises and lows afterwards), how well corrections work compared with your set correction factor, meals taken with insulin still active, overnight drift and basal, weekdays vs weekends, and activity ratios vs everyday",
      "New file js/insights.js (the calculations). They describe what happened after past meals and doses; they are patterns to talk through with your care team, not dosing instructions"
    ]
  },
  {
    version: "2.15.2",
    summary: "Cloud sync no longer depends on a CDN being reachable.",
    changes: [
      "Fixed: the app could open saying “Cloud sync isn't set up yet” when the sync library failed to download from the internet. The library is now bundled with the app (vendor/supabase.js, new file) and works offline. If it ever fails to load, the message now says so and offers “Reload and try again”"
    ]
  },
  {
    version: "2.15.1",
    summary: "Foods logged by quantity now survive an import.",
    changes: [
      "Fixed: Import Library only recognised the exact text “true” for “log by quantity”, so foods whose file said “True” or “1” lost it (they kept their unit name and weight but showed per 100 g). Import now accepts any spelling and also treats a food with a unit and weight as logged by quantity",
      "Foods already damaged this way are repaired automatically the next time the app starts"
    ]
  },
  {
    version: "2.15.0",
    summary: "Recipes can now be imported as well as exported.",
    changes: [
      "Import Library now understands recipe files (Recipe_export.csv, or a JSON with a recipes list). Recipes are matched by name, so existing ones are updated and new ones added, and each ingredient is linked back to the matching food in your library. You can pick the foods file and the recipes file together (several files at once)",
      "New “Export Recipes only” button: phones often block the second file of a full export, so the recipes now have a download of their own"
    ]
  },
  {
    version: "2.14.2",
    summary: "Split meals: insulin stamped 1 second after the carbs.",
    changes: [
      "In split mode the insulin record is now time-stamped one second after the carbs record. Gluroo kept only the carbs when both had the exact same time"
    ]
  },
  {
    version: "2.14.1",
    summary: "Insulin now reaches Gluroo/Nightscout in split mode.",
    changes: [
      "Split format now sends the insulin in the exact shape the experiment showed Gluroo keeps (Correction Bolus, carbs 0, note “Bolus: Xu”). Glucose, if any, is written in the note. Use Settings → Send each meal as → Two entries"
    ]
  },
  {
    version: "2.14.0",
    summary: "Nightscout insulin experiment (Settings).",
    changes: [
      "Settings → Nightscout: new “Insulin delivery experiment”. It sends one clearly labelled 0.1 u test record in a chosen shape and shows exactly what Nightscout answered, to find a format Gluroo keeps the insulin for. A button removes the test record again"
    ]
  },
  {
    version: "2.13.0",
    summary: "Daily carbs graph split into meals and low treatment.",
    changes: [
      "The Daily carbs chart is now stacked: carbs eaten as meals (blue) with carbs eaten to treat a low (amber) on top. Tap a day to see the two figures, and a line under the chart gives the share eaten for lows"
    ]
  },
  {
    version: "2.12.1",
    summary: "The correction now shows its working.",
    changes: [
      "Under the glucose box the correction card now shows the sum it used, for example \"(217 \u2212 100 target) \u00f7 50 mg/dL per unit = 2.3u, rounded to 2.5u\", so you can see which Settings numbers produced the dose"
    ]
  },
  {
    version: "2.12.0",
    summary: "Trends: ideal ratio by time of day, counting carbs eaten to treat lows after an injection.",
    changes: [
      "New Trends card, \"Ideal ratio by time of day\": for every injection it adds the carbs you ate to treat a low in the following 2, 3 or 4 hours (your choice, 3 by default) to that meal, and shows the ratio that would have matched, next to the ratio you actually used and what each bracket is set to now",
      "Only carbs taken without insulin (Treating a Low) are added, and each is credited to the nearest injection before it, so nothing is counted twice"
    ]
  },
  {
    version: "2.11.0",
    summary: "Trends: average insulin-to-carb ratio by time of day. History shows the ratio used.",
    changes: [
      "New Trends card: for each of your brackets (Morning, Lunch, Evening, Night and any activity ratios), the average ratio actually used in the period, how many meals it is based on, its range if you changed it, and a tick for what it is set to now",
      "Each meal in the History log now shows the ratio used (for example 1:10) beside the time of day, and the full detail under Details. Entries where no ratio decided the dose (a low treated without insulin, Eating Out, a correction on its own) show none"
    ]
  },
  {
    version: "2.10.7",
    summary: "Fixed: the 90-day glucose view only showed about 51 days.",
    changes: [
      "Fixed: History > Glucose could silently stop at 30,000 readings. If your sensor or app records a reading every 2-3 minutes, that is only about 51 days, so the 30 and 90 day views were missing data. The limit is now far higher",
      "Long windows are now loaded a few pages at a time instead of all at once"
    ]
  },
  {
    version: "2.10.6",
    summary: "No more empty-looking app for a split second when opening online.",
    changes: [
      "Opening the app with a connection used to flash an empty Calculator while it waited for your cloud data. It now shows the \"Loading your data\" cover from the very first moment, then your real screen"
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
