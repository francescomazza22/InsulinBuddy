INSULIN BUDDY 2.10.3  --  what is in this zip, and where each file goes
===========================================================================

THE ONE RULE
Upload the CONTENTS of this zip into your GitHub repo, keeping the folders exactly as
below. Not the zip itself, and not an extra wrapping folder.
(If your uploader only takes loose files: open the target folder in GitHub FIRST --
for example the js folder -- then Add file > Upload files.)

UPDATING FROM 2.10.2 (typed doses fix): upload these six files:
  into the main folder:   index.html   style.css   app.js   sw.js   diagnose.html
  into the js folder:     util.js
Nothing in assets/ changed, and manifest.json is untouched.
(Coming from 2.10.1 or earlier? Upload the whole zip's contents instead.)

LAYOUT  (repo root = what GitHub Pages serves)

  index.html   app.js   style.css   sw.js   diagnose.html          <- code, in the main folder
  manifest.json   foods_data.js                                    <- YOURS (not in this zip), same place

  js/                       code modules
    calc.js  history.js  nightscout.js  glucose-stats.js  glucose-model.js  sync-status.js  food-reference.js  changelog.js  seed-recipes.js
    util.js  state.js  diag.js  backup.js  dialogs.js  crypto.js  insights.js
    core/  (folder: time.js  library.js  meal-entry.js  storage.js)

  vendor/                   supabase.js  (the cloud-sync library, bundled so the app never needs a CDN to start)

  assets/                   EVERY picture lives here, nothing pictorial sits loose beside the code
    icons/                  favicon-16.png  favicon-32.png  icon-192.png  icon-512.png  apple-touch-icon.png
    patterns/               pattern-abstract-light.svg  pattern-abstract-dark.svg
                            (the Abstract background; a device only downloads it if it chooses Abstract)

  supabase/functions/       reference copies. NOT served by GitHub Pages.
    nightscout-proxy/index.ts   health-export/index.ts
    fetch-nightscout-glucose/index.ts   write-nightscout-treatment/index.ts   (older, no longer used)
  tests/  tools/            optional, for development only
  package.json              optional, for development only

NEW IN 2.10.1: THE PICTURES MOVED INTO assets/   (a one-time tidy-up, 4 steps)
  1. Upload the whole assets folder from this zip (it has icons/ and patterns/ inside).
     On a computer, drag the folder onto GitHub's "Upload files" page. On an iPad or iPhone,
     where folders can't be dragged: Add file > Create new file, type  assets/icons/x.txt  as
     the name (that creates the folders), commit it, then open assets/icons and upload the five
     PNGs, and repeat for assets/patterns with the two SVGs. Delete x.txt afterwards.
  2. Upload the five code files (index.html app.js style.css sw.js diagnose.html) as usual.
  3. Open YOUR manifest.json and change the two icon paths, because I can't see that file:
         "src": "icon-192.png"   ->   "src": "assets/icons/icon-192.png"
         "src": "icon-512.png"   ->   "src": "assets/icons/icon-512.png"
     (Only the icon used when installing the app to a Home Screen depends on this. The app
     itself runs either way.)
  4. Open  <your site>/diagnose.html.  It checks the icons, checks manifest.json points at
     them (and tells you the exact line to fix if not), and lists any OLD copies of the icons
     still in the main folder. Once it is green you can delete those old copies; leaving
     them does no harm.

SCREEN SIZES
  Phone (under 700px)     one column, tab bar along the bottom.
  Tablet and up (700px+)  tab bar becomes a navigation rail on the left; pop-ups are centred cards.
  Wide (1000px+)          Calculator is two columns; Settings and Trends use two columns.
  The 700px breakpoint appears in both style.css and app.js (RAIL_QUERY); a unit test checks they agree.

CHECK IT WORKED  -- the easy way
  Open  <your site>/diagnose.html  in Safari.
  GREEN = every file is the right 2.10.3 version and they all match each other.
  AMBER = fine to use, with notes (a missing picture, an icon path to fix, leftover old files).
  RED   = it names the exact file that is old, missing or in the wrong folder, and says which
          folder to put it in. (It clears only the browser's saved copy of the app's files,
          never your meals, settings or sign-in.)
  Then close the app completely and open it twice, so it refreshes its saved copy.

ABOUT THE ICONS
  The five PNGs are the icon set made on 30 Sept. If you have changed your icons since, keep
  yours: put them in assets/icons with these same five names.

ABOUT "CONTENT CREDENTIALS"
  Image files handed out by Claude (the icons, the pattern SVGs, screenshots) carry a small
  signed provenance label from Anthropic saying so. It doesn't change how a picture looks,
  and the file check page ignores it when comparing the pattern artwork.

NOT IN THIS ZIP (yours; leave them in your repo untouched)
  manifest.json     foods_data.js
Both sit in the repo ROOT next to index.html. I do not have your real copies.
IMPORTANT: if you ever come across a foods_data.js that is only a few bytes long
("var SEED_FOODS = [];"), it is an empty placeholder. Never upload it over yours.
Uploading this zip does not touch either file.

SUPABASE (separate from GitHub)
  Only supabase/functions/health-export/index.ts has changed since 2.5 (in 2.6.0), and it
  only matters if you want basal insulin in Apple Health. Deploy it from the Supabase
  dashboard: Edge Functions > health-export > paste the file > Deploy.
  Each function file is called index.ts, so keep each in its own function.

FOR DEVELOPMENT  (optional; needs Node 22 and a Chrome install)
  Unit tests:   node --test "tests/unit/*.test.js"
  End to end:   CHROME_PATH=/path/to/chrome node tests/e2e/history.e2e.js
                (also nightscout, sync, lock, layout, boot, appearance and diagnose: tests/e2e/<name>.e2e.js)
  THE ASSET RULE: every image lives under assets/ (tests/unit/assets.test.js fails if one is loose in the main folder).
  After ANY change to app files:  node tools/make-diagnose.mjs
                (refreshes the fingerprints inside diagnose.html; a unit test fails if you forget)
  After changing the doodle pattern (edit tools/make-doodle-tile.mjs):
                node tools/make-doodle-tile.mjs && node tools/make-doodles.mjs
  After changing the Abstract pattern's fade (edit tools/make-abstract.mjs):  node tools/make-abstract.mjs
  I have only run the tests in my own Linux environment. The "test:e2e" and "test:legacy"
  scripts in package.json point at files that no longer exist; ignore them.
