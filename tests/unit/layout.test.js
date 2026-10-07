import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const ROOT = new URL("../..", import.meta.url).pathname;
const css = fs.readFileSync(ROOT + "style.css", "utf8");
const app = fs.readFileSync(ROOT + "app.js", "utf8");
const html = fs.readFileSync(ROOT + "index.html", "utf8");
const block = css.slice(css.indexOf("/* ================= RESPONSIVE LAYOUT"), css.indexOf("@media print {"));

test("the rail breakpoint in app.js is the same one the CSS uses (else the Log bar would sit the wrong height)", () => {
  const js = /const RAIL_QUERY = "\(min-width: (\d+)px\)"/.exec(app);
  assert.ok(js, "RAIL_QUERY not found in app.js");
  const breakpoints = [...block.matchAll(/@media \(min-width: (\d+)px\)/g)].map(m => m[1]);
  assert.ok(breakpoints.includes(js[1]), `app.js says ${js[1]}px but the CSS responsive block uses ${breakpoints.join(", ")}`);
  assert.deepEqual(breakpoints, [js[1], "1000"], "the block should be exactly the rail breakpoint, then the wide one");
});

test("the responsive block exists, sits before the print rules, and the old partial wide-screen rules are gone", () => {
  assert.ok(block.length > 500, "responsive block missing");
  assert.ok(!/#view-calculator > \*/.test(css), "the old '600px column' rule is still there and would fight the new layout");
  assert.ok(!/\.tabbar \{ max-width: (760|1040)px/.test(css) && !/\.sticky-log-bar \{ max-width: (760|1040)px/.test(css), "old stepped max-widths still present");
});

test("the Calculator wrappers wrap the right things in the right order (phone order is the original order)", () => {
  const view = html.slice(html.indexOf('id="view-calculator"'), html.indexOf('id="view-library"'));
  const order = ['class="calc-side"', 'class="dose-card"', 'id="active-panel"', 'id="cc-ratio-picker"', 'id="cc-sticky-log-bar"', 'class="calc-main"', 'id="cc-food-section"', 'class="sticky-log-spacer"', 'class="disclaimer"'];
  const at = order.map(k => view.indexOf(k));
  assert.ok(at.every(i => i >= 0), "something is missing: " + JSON.stringify(at));
  assert.deepEqual([...at].sort((a, b) => a - b), at, "elements are out of order");
  const side = view.slice(view.indexOf('class="calc-side"'), view.indexOf('class="calc-main"'));
  for (const id of ['class="dose-card"', 'id="active-panel"', 'id="cc-ratio-picker"', 'id="cc-sticky-log-bar"']) assert.ok(side.includes(id), id + " should be in the left block");
  assert.ok(!side.includes('id="cc-food-section"'), "the meal must not be in the left block");
});

test("the wrappers collapse on phones: display: contents is the default, grid/block only inside the wide query", () => {
  assert.match(css, /\.calc-side, \.calc-main \{ display: contents; \}/);
  const wide = block.slice(block.indexOf("@media (min-width: 1000px)"));
  assert.match(wide, /#view-calculator \{ display: grid;/);
  assert.match(wide, /\.calc-side \{ display: block; position: sticky;/);
  assert.ok(!/#view-calculator \{ display: grid;/.test(block.slice(0, block.indexOf("@media (min-width: 1000px)"))), "the grid must not apply below 1000px");
});
