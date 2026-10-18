import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
test("index.html has as many closing </div> as opening <div> (a stray one pulls the whole app out of its container)", () => {
  const body = html.slice(html.indexOf("<body>"));
  assert.equal((body.match(/<div\b/g) || []).length, (body.match(/<\/div>/g) || []).length);
});
test("the opening screen and the theme script are in place before the stylesheets", () => {
  assert.ok(html.indexOf("data-tod") > -1 && html.indexOf('id="loading-screen"') > -1);
  assert.ok(html.indexOf('insulinBuddy.theme') < html.indexOf('href="tokens.css"'), "the early theme script must run before styles load");
  assert.ok(html.indexOf('name="theme-color"') < html.indexOf('insulinBuddy.theme'), "the meta tag must exist before the script edits it");
});
