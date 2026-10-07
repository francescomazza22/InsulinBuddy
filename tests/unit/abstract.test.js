import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildAbstractSvg, lineGrey, VARIANTS } from "../../tools/make-abstract.mjs";

const ROOT = new URL("../..", import.meta.url).pathname;
const source = fs.readFileSync(ROOT + "tools/abstract-source.svg", "utf8");
const files = { light: fs.readFileSync(ROOT + "assets/patterns/pattern-abstract-light.svg", "utf8"), dark: fs.readFileSync(ROOT + "assets/patterns/pattern-abstract-dark.svg", "utf8") };
const css = fs.readFileSync(ROOT + "style.css", "utf8");
const app = fs.readFileSync(ROOT + "app.js", "utf8");

// ---- helpers
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const blend = (fg, bg, a) => fg.map((c, i) => c * a + bg[i] * (1 - a));
/** A small well-formedness check (Node has no XML parser built in): tags nest and close properly, one root. Returns an error or null. */
function xmlProblem(text) {
  const stack = []; let roots = 0;
  const body = text.replace(/<!--[\s\S]*?-->/g, "").replace(/<\?[\s\S]*?\?>/g, "");
  for (const m of body.matchAll(/<(\/?)([\w:-]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g)) {
    const [, closing, name, , selfClosing] = m;
    if (selfClosing) { if (!stack.length) roots++; continue; }
    if (!closing) { if (!stack.length) roots++; stack.push(name); continue; }
    const top = stack.pop();
    if (top !== name) return `</${name}> closes <${top || "nothing"}>`;
  }
  if (stack.length) return `<${stack[stack.length - 1]}> is never closed`;
  return roots === 1 ? null : `${roots} root elements`;
}

test("the two files are exactly what tools/make-abstract.mjs builds (run: node tools/make-abstract.mjs)", () => {
  for (const v of ["light", "dark"]) assert.equal(files[v], buildAbstractSvg(source, v), `assets/patterns/pattern-abstract-${v}.svg is out of date`);
});

test("the files are valid XML. A file that isn't draws NOTHING and fails silently: the pattern just doesn't appear", () => {
  for (const [v, text] of Object.entries(files)) assert.equal(xmlProblem(text), null, `${v}: ${xmlProblem(text)}`);
  assert.equal(xmlProblem("<svg><g></svg></g>"), "</svg> closes <g>", "sanity: the checker really does catch the bug that once shipped");
  assert.equal(xmlProblem("<svg><g></g></svg>"), null);
});

test("they are a single self-contained 300x300 tile: no pictures, scripts, styles or links to anywhere else", () => {
  for (const [v, text] of Object.entries(files)) {
    assert.match(text, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 300 300"/, v);
    for (const banned of ["<image", "<script", "<style", "<foreignObject", "href=", "xlink:", "http://", "https://"].filter(b => b !== "http://")) assert.ok(!text.includes(banned), `${v}: contains ${banned}`);
    // A rectangle inside a <clipPath> is only an invisible cut-out (the tile's own edge), never drawn. A rectangle anywhere
    // else would be a solid block, such as the original's peach background, hiding the color the app is set to.
    assert.ok(!/<rect/.test(text.replace(/<clipPath[\s\S]*?<\/clipPath>/g, "")), `${v}: has a visible rectangle, which would hide the app's own background color`);
    assert.ok(text.length < 90 * 1024, `${v}: ${(text.length / 1024).toFixed(0)} KB (keep under 90)`);
    const defined = new Set([...text.matchAll(/<clipPath id="([\w-]+)"/g)].map(m => m[1]));
    const used = [...text.matchAll(/url\(#([\w-]+)\)/g)].map(m => m[1]);
    assert.ok(used.length >= 20, `${v}: expected the tile's clip paths`);
    for (const id of used) assert.ok(defined.has(id), `${v}: refers to ${id}, which isn't defined`);
  }
});

test("the artwork itself is unchanged: the same six-colour palette, and no pure black left (it is softened to grey)", () => {
  const palette = t => [...new Set([...t.matchAll(/(?:fill|stroke)="(#[0-9A-F]{6})"/g)].map(m => m[1]))].sort();
  const original = palette(source);
  assert.deepEqual(original, ["#000000", "#7AE3E1", "#868AE3", "#F889C5", "#FEB771", "#FF7540"], "the source tile should have the artwork's six colours");
  for (const v of ["light", "dark"]) {
    const got = palette(files[v]);
    assert.ok(!got.includes("#000000"), `${v}: black is still there`);
    for (const c of original.filter(c => c !== "#000000")) assert.ok(got.includes(c), `${v}: the colour ${c} is missing`);
    assert.equal(got.length, original.length, `${v}: the palette changed`);
  }
  // the same number of shapes as the source: nothing lost, nothing added
  const shapes = t => (t.match(/<path /g) || []).length;
  assert.equal(shapes(files.light), shapes(source)); assert.equal(shapes(files.dark), shapes(source));
});

test("the linework is softened so that, after the fade, it matches the faint ink the Doodles use", () => {
  for (const v of ["light", "dark"]) {
    const o = VARIANTS[v], grey = lineGrey(v);
    const effective = blend(grey, o.paper, o.opacity), expected = blend(o.ink, o.paper, o.lineOpacity);
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(effective[i] - expected[i]) < 0.5, `${v}: the lines land on the wrong shade`);
  }
});

test("READABILITY: grey text stays at 3:1 (4.5:1 in dark mode) and main text at 9:1, even on the strongest artwork colour behind it, over every background you can pick", () => {
  const rootBlock = css.slice(0, css.indexOf('[data-theme="dark"]')), darkBlock = css.slice(css.indexOf('[data-theme="dark"]'), css.indexOf('[data-theme="dark"]') + 900);
  const v = (block, name) => hex(new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})`).exec(block)[1]);
  const presets = [...app.slice(app.indexOf("const BG_PRESETS"), app.indexOf("const BG_PRESETS") + 400).matchAll(/#[0-9A-Fa-f]{6}/g)].map(m => hex(m[0]));
  const cases = [
    { name: "light", text: files.light, bgs: [v(rootBlock, "--paper"), ...presets], ink: v(rootBlock, "--ink"), soft: v(rootBlock, "--ink-soft"), floor: 3.0 },
    { name: "dark", text: files.dark, bgs: [v(darkBlock, "--paper")], ink: v(darkBlock, "--ink"), soft: v(darkBlock, "--ink-soft"), floor: 4.5 }
  ];
  for (const c of cases) {
    const opacity = +/<g opacity="([\d.]+)">/.exec(c.text)[1];
    const colours = [...new Set([...c.text.matchAll(/(?:fill|stroke)="(#[0-9A-F]{6})"/g)].map(m => hex(m[1])).map(String))].map(s => s.split(",").map(Number));
    for (const bg of c.bgs) for (const col of colours) {
      const worst = blend(col, bg, opacity);
      assert.ok(contrast(c.ink, worst) >= 9, `${c.name} bg ${bg}: main text only ${contrast(c.ink, worst).toFixed(1)}:1 behind colour ${col}`);
      assert.ok(contrast(c.soft, worst) >= c.floor, `${c.name} bg ${bg}: grey text only ${contrast(c.soft, worst).toFixed(2)}:1 behind colour ${col} (floor ${c.floor})`);
    }
  }
});

test("it is wired into the app: three choices, an unknown saved value means none, its own sizes, and a dark version", () => {
  assert.match(app, /const BACKGROUND_PATTERNS = \["none", "doodles", "abstract"\];/);
  assert.match(app, /function backgroundPatternOf\(settings\) \{ return BACKGROUND_PATTERNS\.includes\(settings\.backgroundPattern\) \? settings\.backgroundPattern : "none"; \}/);
  assert.match(css, /html\[data-bg-pattern="abstract"\] body \{ background-image: url\("assets\/patterns\/pattern-abstract-light\.svg"\);/);
  assert.match(css, /html\[data-bg-pattern="abstract"\]\[data-theme="dark"\] body \{ background-image: url\("assets\/patterns\/pattern-abstract-dark\.svg"\); \}/);
  assert.match(css, /html \{ --abstract-tile: clamp\(180px, calc\(160px \+ 4vw\), 240px\); \}/);
  assert.match(css, /data-bg-pattern-size="medium"\] \{ --abstract-tile: clamp\(250px, calc\(220px \+ 8vw\), 350px\); \}/);
  assert.match(css, /data-bg-pattern-size="large"\] \{ --abstract-tile: clamp\(350px, calc\(290px \+ 14vw\), 560px\); \}/);
});
