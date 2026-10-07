import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildExpect, applyExpect } from "../../tools/make-diagnose.mjs";

const ROOT = new URL("../..", import.meta.url).pathname;
const html = fs.readFileSync(ROOT + "diagnose.html", "utf8");
const embedded = JSON.parse(/const EXPECT = (\{.*?\});\n/s.exec(html)[1]);
const HOW = "diagnose.html is out of date: run  node tools/make-diagnose.mjs";

test("diagnose.html describes exactly the files and version that are here now (otherwise it would call good files 'old')", () => {
  const now = buildExpect(ROOT);
  assert.equal(embedded.version, now.version, HOW + ` (page says ${embedded.version}, sw.js says ${now.version})`);
  for (const [file, exp] of Object.entries(now.files)) {
    assert.ok(embedded.files[file], `${file} is not covered by diagnose.html. ${HOW}`);
    assert.equal(embedded.files[file].sha, exp.sha, `${file} has changed since diagnose.html was generated. ${HOW}`);
  }
  assert.deepEqual(Object.keys(embedded.files).sort(), Object.keys(now.files).sort(), "the list of files differs. " + HOW);
});

test("every check token diagnose.html uses really is in the file it is meant to vouch for", () => {
  for (const [file, exp] of Object.entries(embedded.files)) {
    const text = fs.readFileSync(ROOT + file, "utf8");
    for (const token of exp.must) assert.ok(text.includes(token), `${file} lacks its own check token ${JSON.stringify(token)}`);
  }
});

test("the changelog's newest version matches the service worker's, so the page isn't vouching for a half-bumped release", () => {
  const appVersion = /CHANGELOG = \[\s*\{\s*version: "([^"]+)"/.exec(fs.readFileSync(ROOT + "app.js", "utf8"))[1];
  assert.equal(appVersion, embedded.version);
});

test("every module app.js imports is covered by the page (a new module can't slip through unchecked)", () => {
  const app = fs.readFileSync(ROOT + "app.js", "utf8");
  const imported = [...app.matchAll(/from\s+"\.\/(js\/[a-z-]+\.js)"/g)].map(m => m[1]);
  assert.ok(imported.length >= 8, "sanity: found the imports");
  for (const f of imported) assert.ok(embedded.files[f], `${f} is imported by app.js but not covered by diagnose.html. ${HOW}`);
});

test("regenerating is stable: applying the current expectation changes nothing", () => {
  assert.equal(applyExpect(html, buildExpect(ROOT)), html);
});

test("the page never has a version number typed into its text: every one must come from the version it is checking (a hard-coded 2.6.1 once sat under a 2.8.0 heading)", () => {
  const outsideData = html.replace(/const EXPECT = \{.*?\};\n/s, "");
  const stray = [...outsideData.matchAll(/\b\d+\.\d+\.\d+\b/g)].map(m => m[0]);
  assert.deepEqual(stray, [], "version numbers written into diagnose.html itself: use EXPECT.version instead");
});

test("the Abstract pattern's artwork files (in assets/patterns) are covered too (the page would otherwise not notice one missing)", () => {
  const onDisk = fs.readdirSync(ROOT + "assets/patterns").filter(n => n.endsWith(".svg")).map(n => "assets/patterns/" + n);
  assert.ok(onDisk.length >= 2, "expected the light and dark pattern files in assets/patterns");
  for (const f of onDisk) assert.ok(embedded.files[f], `${f} is in the repo but not covered by diagnose.html. ${HOW}`);
});

import { normalizeSvg } from "../../tools/make-diagnose.mjs";

test("ICONS: every icon in assets/icons is checked for presence, and the old-to-new map covers every moved picture", () => {
  const icons = fs.readdirSync(ROOT + "assets/icons").sort().map(n => "assets/icons/" + n);
  assert.deepEqual([...embedded.assets].sort(), icons, "diagnose.html's icon list doesn't match assets/icons");
  for (const [name, now] of Object.entries(embedded.moved)) { assert.equal(now.split("/").pop(), name); assert.ok(fs.existsSync(ROOT + now), `${now} is in the old-to-new map but isn't on disk`); }
  for (const f of [...icons, ...Object.keys(embedded.files).filter(f => f.startsWith("assets/"))]) assert.ok(embedded.moved[f.split("/").pop()], `${f} is missing from the old-to-new map, so a leftover copy of it in the main folder wouldn't be noticed`);
});

test("METADATA: a provenance stamp or editor metadata inside an SVG doesn't make a correct file look wrong, and a real change still does", () => {
  const clean = fs.readFileSync(ROOT + "assets/patterns/pattern-abstract-light.svg", "utf8");
  const stamped = clean.replace(/^<svg ([^>]*)>/, '<svg $1 xmlns:c2pa="http://c2pa.org/manifest"><metadata><c2pa:manifest>AAAWgmp1bWIAAAAeanVtZGMycGEAEQAQ</c2pa:manifest></metadata>');
  assert.notEqual(stamped, clean, "sanity: the stamped copy really differs");
  assert.equal(normalizeSvg(stamped), clean, "stripping the metadata should give back exactly the clean file");
  assert.equal(normalizeSvg(clean), clean, "a clean file is unchanged");
  assert.notEqual(normalizeSvg(clean.replace('opacity="0.2"', 'opacity="0.5"')), clean, "a real change to the drawing must still be noticed");
});

test("the page's own copy of that normaliser behaves exactly like the generator's (they hash the same bytes, or every SVG would look 'changed')", () => {
  const src = /const normalizeSvg = (t => [^\n]+);\n/.exec(html);
  assert.ok(src, "diagnose.html has no normalizeSvg function");
  const pageFn = new Function("return " + src[1])();
  const clean = fs.readFileSync(ROOT + "assets/patterns/pattern-abstract-dark.svg", "utf8");
  const samples = [clean, clean.replace(/^<svg ([^>]*)>/, '<svg $1 xmlns:c2pa="http://c2pa.org/manifest"><metadata>\n<c2pa:manifest>QUJD</c2pa:manifest>\n</metadata>'), "<svg><metadata>a</metadata><g/><metadata>b</metadata></svg>", "no svg at all"];
  for (const s of samples) assert.equal(pageFn(s), normalizeSvg(s));
});
