// Regenerates the file fingerprints embedded in diagnose.html from the files as they are RIGHT NOW.
// Run after every release, before building the zip:     node tools/make-diagnose.mjs
// (tests/unit/diagnose.test.js fails if you forget, so a stale page can't ship and falsely call good files "old".)
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const sha = buf => crypto.createHash("sha256").update(buf).digest("hex");

/** SVG artwork is fingerprinted WITHOUT any <metadata> block. Tools that touch an image (an editor saving it, or the content-
 * credentials stamp added to files handed out by Claude) add one, and it doesn't change how the picture draws, so it must not
 * make a correct file look wrong. diagnose.html has the identical function (tests/unit/diagnose.test.js keeps them in step). */
export const normalizeSvg = t => t.replace(/<metadata[\s\S]*?<\/metadata>/g, "").replace(/ xmlns:c2pa="[^"]*"/g, "");
const fingerprint = (f, data) => f.endsWith(".svg") ? Buffer.from(normalizeSvg(data.toString("utf8")), "utf8") : data;

/** What diagnose.html should believe: the version, plus size, fingerprint and "must contain" tokens per file. */
export function buildExpect(root) {
  const read = f => fs.readFileSync(path.join(root, f));
  const version = /CACHE_VERSION = "([^"]+)"/.exec(read("sw.js").toString("utf8"))[1];
  // Tokens a file must contain to count as "this version". They are what lets the page say WHICH feature an old
  // file is missing, rather than just "different". Version-bound ones follow sw.js automatically.
  const musts = {
    "index.html": ["btn-log-basal", "btn-glucose-guide", "cc-cap-note", "calc-side", "hadController", "trend-card-basal", "bg-pattern-grid", "bg-pattern-size"],
    "app.js": [`version: "${version}"`, "capDoseParts", "isBasalEntry", "trackVisualViewport", "pagePinned", "RAIL_QUERY", "buildBasalChartSvg", "applyBackgroundPattern", "backgroundPatternSize", "backgroundPatternOf"],
    "style.css": [".dose-card__cap-note", ".basal-add-btn", ".glucose-guide", "--vv-height", "overscroll-behavior: contain", "RESPONSIVE LAYOUT", "trend-chart__bar--basal-am", "DOODLE-PATTERN:START", "--doodle-tile", "%3Cuse%20href=", "ABSTRACT-PATTERN"],
    "sw.js": [`CACHE_VERSION = "${version}"`],
    "js/calc.js": ["export function capDoseParts", "export function basalByDay"],
    "js/history.js": ["export function makeBasalEntry"],
    "js/nightscout.js": ['entryType === "basal"'],
    "js/glucose-stats.js": ["export function glucoseGuideRows"]
  };
  const files = {};
  const list = dir => fs.existsSync(path.join(root, dir)) ? fs.readdirSync(path.join(root, dir)).sort().map(n => dir + "/" + n) : [];
  const patternFiles = list("assets/patterns").filter(f => f.endsWith(".svg"));      // the Abstract background's artwork: fingerprinted
  const iconFiles = list("assets/icons").filter(f => /\.(png|svg|ico)$/.test(f));       // the icons: they only need to be there
  for (const f of ["index.html", "app.js", "style.css", "sw.js", ...patternFiles, ...fs.readdirSync(path.join(root, "js")).filter(n => n.endsWith(".js")).sort().map(n => "js/" + n)]) {
    const data = read(f);
    files[f] = { sha: sha(fingerprint(f, data)), size: data.length, must: musts[f] || [] };
  }
  // Where each picture used to sit in the main folder, so the page can point out leftover copies and fix manifest.json's paths.
  const moved = Object.fromEntries([...iconFiles, ...patternFiles].map(f => [f.split("/").pop(), f]));
  return { version, files, assets: iconFiles, moved };
}

const EXPECT_LINE = /const EXPECT = \{.*?\};\n/s;
export function applyExpect(html, expect) {
  if (!EXPECT_LINE.test(html)) throw new Error("diagnose.html has no `const EXPECT = {...};` line to update");
  return html.replace(EXPECT_LINE, () => `const EXPECT = ${JSON.stringify(expect)};\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const expect = buildExpect(root);
  const target = path.join(root, "diagnose.html");
  fs.writeFileSync(target, applyExpect(fs.readFileSync(target, "utf8"), expect));
  console.log(`diagnose.html updated for ${expect.version}: ${Object.keys(expect.files).length} files fingerprinted`);
}
