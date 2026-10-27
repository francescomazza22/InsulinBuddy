// The design tokens: one source (design/tokens.json), two generated files, and no CSS variable used without a definition.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildTokens } from "../../tools/make-tokens.mjs";

const read = f => fs.readFileSync(new URL("../../" + f, import.meta.url), "utf8");
const tokens = JSON.parse(read("design/tokens.json"));

test("tokens.css and DesignTokens.swift are in step with design/tokens.json (run node tools/make-tokens.mjs)", () => {
  const { css, swift } = buildTokens(tokens);
  assert.equal(read("tokens.css"), css);
  assert.equal(read("design/DesignTokens.swift"), swift);
});

test("every palette, theme and glass set defines the same keys, so switching can never leave a gap", () => {
  const sets = Object.values(tokens.palette.set).map(p => Object.keys(p).sort().join());
  assert.equal(new Set(sets).size, 1);
  assert.deepEqual(Object.keys(tokens.glass.light).sort(), Object.keys(tokens.glass.dark).sort());
  for (const k of Object.keys(tokens.color.dark)) assert.ok(k in tokens.color.light, `dark colour ${k} has a light twin`);
  assert.ok(tokens.palette.set[tokens.palette.default]);
});

test("every var(--x) the app uses is defined somewhere (tokens, style.css, or set from script)", () => {
  const defined = new Set();
  const grab = (text, re) => { for (const m of text.matchAll(re)) defined.add(m[1]); };
  const css = read("style.css"), tok = read("tokens.css"), app = read("app.js"), html = read("index.html");
  for (const t of [css, tok]) grab(t, /(--[a-z0-9-]+)\s*:/gi);
  grab(app, /setProperty\(\s*["'`](--[a-z0-9-]+)/gi);
  grab(app, /["'`](--[a-z0-9-]+)\s*:/gi);          // inline styles written from script
  grab(html, /(--[a-z0-9-]+)\s*:/gi);
  const used = new Map();
  for (const [name, t] of [["style.css", css], ["tokens.css", tok], ["app.js", app], ["index.html", html]])
    for (const m of t.matchAll(/var\(\s*(--[a-z0-9-]+)\s*(,|\))/gi)) if (m[2] === ")") used.set(m[1], name);   // a fallback means "may be undefined" on purpose
  const missing = [...used].filter(([v]) => !defined.has(v)).map(([v, f]) => `${v} (${f})`);
  assert.deepEqual(missing, []);
});

test("style.css keeps radius, type size and spacing on the scale (no stray raw values creeping back)", () => {
  const css = read("style.css");
  const raw = [...css.matchAll(/border-radius:\s*(\d+)px/g)].map(m => +m[1]).filter(n => n > 5);
  assert.deepEqual([...new Set(raw)], [], "use var(--radius-*) for radii above a hairline");
  const sizes = [...css.matchAll(/font-size:\s*([\d.]+)rem/g)].map(m => +m[1]).filter(n => n < 1.2);
  assert.deepEqual([...new Set(sizes)], [], "use var(--fs-*) for text sizes");
});

// 2.68.7: the colours each theme actually shows are readable in light and dark mode (WCAG AA), by construction.
import { contrast, over } from "../../tools/contrast-colours.mjs";
test("every theme's generated colours are readable: accent text, text on filled controls, and the dose card", () => {
  const css = read("tokens.css");
  const grab = (block, name) => (new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`).exec(block) || [])[1];
  const pages = { light: [tokens.color.light.surface, tokens.color.light.paper], dark: [tokens.color.dark.paper, tokens.color.dark.surface] };
  let checked = 0;
  for (const name of Object.keys(tokens.palette.set)) for (const mode of ["light", "dark"]) {
    const sel = mode === "light" ? `html[data-palette="${name}"]` : `html[data-theme="dark"][data-palette="${name}"]`;
    const line = css.split("\n").find(l => l.startsWith(sel));
    assert.ok(line, `${name}/${mode} missing from tokens.css`);
    const acc = grab(line, "acc-1"), onAcc = grab(line, "on-acc"), c1 = grab(line, "card-1"), c2 = grab(line, "card-2");
    for (const p of pages[mode]) assert.ok(contrast(acc, p) >= 4.5, `${name}/${mode}: accent text ${acc} on ${p} is ${contrast(acc, p).toFixed(2)}:1`);
    assert.ok(contrast(onAcc, acc) >= 4.5, `${name}/${mode}: ${onAcc} on a filled ${acc} control is ${contrast(onAcc, acc).toFixed(2)}:1`);
    for (const c of [c1, c2]) {
      assert.ok(contrast("#FFFFFF", c) >= 4.5, `${name}/${mode}: white on the dose card ${c}`);
      assert.ok(contrast("#FFFFFF", over("#FFFFFF", 0.06, c)) >= 4.5, `${name}/${mode}: white under the card's sheen on ${c}`);
    }
    checked++;
  }
  assert.equal(checked, Object.keys(tokens.palette.set).length * 2);
});
