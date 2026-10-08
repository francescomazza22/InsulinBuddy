// Run before uploading a new version:   node tools/release.mjs
//  1. copies VERSION (js/changelog.js, the newest entry) into package.json, index.html's version badge and, when
//     it's here, sw.js's CACHE_VERSION -- so the four can never disagree again;
//  2. rebuilds diagnose.html's list of expected files (with their fingerprints), so the file check page knows
//     exactly what this version's files should be;
//  3. rewrites sw.js's list of files to keep for offline use (PRECACHE_URLS), or prints it when sw.js isn't here.
// It replaces tools/make-diagnose.mjs. It never touches foods_data.js or manifest.json (they are yours, not part of
// the release).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rel = p => path.relative(root, p).split(path.sep).join("/");
const read = p => fs.readFileSync(path.join(root, p), "utf8");
const write = (p, s) => fs.writeFileSync(path.join(root, p), s);
const { VERSION } = await import(pathToFileURL(path.join(root, "js/changelog.js")).href);
const log = [];

// ---- 1. version everywhere
const pkg = JSON.parse(read("package.json"));
if (pkg.version !== VERSION) { pkg.version = VERSION; write("package.json", JSON.stringify(pkg, null, 2) + "\n"); log.push(`package.json -> ${VERSION}`); }
const html = read("index.html");
const badged = html.replace(/(<span class="version-card__badge" id="version-badge-text">)v[\d.]+/, `$1v${VERSION}`);
if (badged !== html) { write("index.html", badged); log.push(`index.html badge -> v${VERSION}`); }
const hasSw = fs.existsSync(path.join(root, "sw.js"));
if (hasSw) {
  const sw = read("sw.js");
  const next = sw.replace(/CACHE_VERSION\s*=\s*["'][^"']*["']/, `CACHE_VERSION = "${VERSION}"`);
  if (next !== sw) { write("sw.js", next); log.push(`sw.js CACHE_VERSION -> ${VERSION}`); }
  if (!/CACHE_VERSION\s*=/.test(sw)) log.push("WARNING: sw.js has no CACHE_VERSION = \"...\" line to update");
}

// ---- 2. the files that make up a release
const walk = dir => fs.existsSync(path.join(root, dir)) ? fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(d => d.isDirectory() ? walk(`${dir}/${d.name}`) : [`${dir}/${d.name}`]) : [];
const appFiles = [
  "index.html", "app.js", "sw.js",
  ...walk("styles").filter(f => f.endsWith(".css")).sort(),
  ...walk("js").filter(f => f.endsWith(".js")).sort(),
  ...walk("assets/patterns").filter(f => f.endsWith(".svg")).sort()
];
const iconsHere = walk("assets/icons").filter(f => /\.(png|svg)$/.test(f)).sort();

// SVG artwork is compared without any <metadata> block (an editor, or a content-credentials stamp, adds one without
// changing how the picture draws). Must stay identical to normalizeSvg in diagnose.html.
const normalizeSvg = t => t.replace(/<metadata[\s\S]*?<\/metadata>/g, "").replace(/ xmlns:c2pa="[^"]*"/g, "");
// A few strings that only this version's files contain, so an old file is reported as "old version" rather than
// just "different". The version itself is the most reliable one.
const KEPT = {};
const MUST = {
  "index.html": [`v${VERSION}`, "styles/base.css", "styles/utilities.css", "js/views"].filter(Boolean),
  "app.js": ["initSettingsGeneral", "adoptSignedInData"],
  "sw.js": [`CACHE_VERSION = "${VERSION}"`],
  "js/changelog.js": [`version: "${VERSION}"`],
  "js/calc.js": ["export function calculatorDose", "export function recalculateEntryDose"],
  "js/ui/sheets.js": ["export function createSheet"],
  "styles/patterns.css": ["pattern-doodles-light.svg"]
};
// Artwork that isn't in this folder (built separately and uploaded once) keeps the fingerprint the file check
// already has for it, so it's still checked.
const previous = (() => { try { return JSON.parse(read("diagnose.html").match(/const EXPECT = (\{.*\});\n/)[1]); } catch { return null; } })();
// The icons are uploaded once and rarely change; when they aren't in this folder, keep the list the check page has.
const icons = iconsHere.length ? iconsHere : ((previous && previous.assets) || []);
if (previous) for (const [f, v] of Object.entries(previous.files)) {
  if (f.startsWith("assets/") && !appFiles.includes(f) && !fs.existsSync(path.join(root, f))) appFiles.push(f), (MUST[f] = v.must || []), (KEPT[f] = v);
}
// ---- sw.js's offline list (before fingerprinting, so sw.js is fingerprinted as written) (PRECACHE_URLS): every app file, plus your own foods_data.js and manifest.json and the
// icons. The Abstract artwork stays out on purpose: it's only downloaded if that pattern is chosen.
const precache = ["./", ...appFiles.filter(f => f !== "sw.js" && !/pattern-abstract/.test(f)), "foods_data.js", "manifest.json", ...icons];
const precacheJs = `const PRECACHE_URLS = [\n${precache.map(u => `  ${JSON.stringify(u)}`).join(",\n")}\n];`;
if (hasSw) {
  const sw = read("sw.js");
  const next = sw.replace(/const PRECACHE_URLS = \[[\s\S]*?\];/, precacheJs);
  if (next === sw && !sw.includes(precacheJs)) log.push("WARNING: sw.js has no `const PRECACHE_URLS = [...]` list to update; paste the one below into it");
  else if (next !== sw) { write("sw.js", next); log.push(`sw.js PRECACHE_URLS -> ${precache.length} files`); }
}
const files = {};
for (const f of appFiles) {
  if (KEPT[f]) { files[f] = KEPT[f]; continue; }
  const full = path.join(root, f);
  if (!fs.existsSync(full)) { files[f] = { sha: null, size: null, must: MUST[f] || [] }; continue; }
  const buf = fs.readFileSync(full);
  const hashed = f.endsWith(".svg") ? Buffer.from(normalizeSvg(buf.toString("utf8"))) : buf;
  files[f] = { sha: crypto.createHash("sha256").update(hashed).digest("hex"), size: buf.length, must: MUST[f] || [] };
}
const expect = {
  version: VERSION, files, assets: icons,
  moved: {
    "apple-touch-icon.png": "assets/icons/apple-touch-icon.png", "favicon-16.png": "assets/icons/favicon-16.png",
    "favicon-32.png": "assets/icons/favicon-32.png", "icon-192.png": "assets/icons/icon-192.png", "icon-512.png": "assets/icons/icon-512.png",
    "pattern-abstract-dark.svg": "assets/patterns/pattern-abstract-dark.svg", "pattern-abstract-light.svg": "assets/patterns/pattern-abstract-light.svg",
    "style.css": "styles/ (split into several files)"
  }
};
const diag = read("diagnose.html");
const nextDiag = diag.replace(/const EXPECT = \{.*\};\n/, `const EXPECT = ${JSON.stringify(expect)};\n`);
if (nextDiag === diag && !diag.includes(JSON.stringify(expect))) throw new Error("couldn't find the EXPECT line in diagnose.html");
write("diagnose.html", nextDiag);
log.push(`diagnose.html: ${Object.keys(files).length} files fingerprinted for ${VERSION}`);
const missing = Object.entries(files).filter(([, v]) => v.sha === null).map(([k]) => k);
if (missing.length) log.push(`not here, so not fingerprinted (the check page only looks for their version text): ${missing.join(", ")}`);

console.log(log.join("\n"));
if (!hasSw) console.log(`\nsw.js isn't here. Its offline list should be:\n${precacheJs}`);
