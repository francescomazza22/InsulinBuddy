import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
test("index.html has as many closing </div> as opening <div> (a stray one pulls the whole app out of its container)", () => {
  const body = html.slice(html.indexOf("<body>"));
  assert.equal((body.match(/<div\b/g) || []).length, (body.match(/<\/div>/g) || []).length);
});
test("the opening screen and the theme script are in place before the stylesheets", () => {
  assert.ok(html.indexOf('id="loading-screen"') > -1);
  // The theme script lives in js/boot-head.js (no inline scripts, for the Content Security Policy), loaded synchronously.
  const tag = '<script src="js/boot-head.js"></script>';
  assert.ok(html.includes(tag), "the early theme script is loaded as a plain (blocking) script");
  assert.ok(readFileSync(new URL("../../js/boot-head.js", import.meta.url), "utf8").includes("insulinBuddy.theme") && readFileSync(new URL("../../js/boot-head.js", import.meta.url), "utf8").includes("data-tod"));
  assert.ok(html.indexOf(tag) < html.indexOf('href="tokens.css"'), "the early theme script must run before styles load");
  assert.ok(html.indexOf('name="theme-color"') < html.indexOf(tag), "the meta tag must exist before the script edits it");
});
