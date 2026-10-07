import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildDoodleCss, applyDoodleCss, dataUri, VARIANTS, START, END } from "../../tools/make-doodles.mjs";
import { buildDoodleSvg, layoutDoodles, placements, minClearance, ICONS, TILE } from "../../tools/make-doodle-tile.mjs";

const ROOT = new URL("../..", import.meta.url).pathname;
const css = fs.readFileSync(ROOT + "style.css", "utf8");
const svg = fs.readFileSync(ROOT + "tools/doodles.svg", "utf8");
const app = fs.readFileSync(ROOT + "app.js", "utf8");

// ---- WCAG helpers
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const blend = (fg, bg, a) => fg.map((c, i) => Math.round(c * a + bg[i] * (1 - a)));
const cssVar = (block, name) => hex(new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})`).exec(block)[1]);

test("the pattern in style.css is exactly what tools/doodles.svg produces (otherwise edit the SVG, then run node tools/make-doodles.mjs)", () => {
  assert.equal(applyDoodleCss(css, buildDoodleCss(ROOT)), css, "style.css is out of date with tools/doodles.svg");
});

test("tools/doodles.svg is exactly what tools/make-doodle-tile.mjs generates (edit the generator, then run it)", () => {
  assert.equal(svg, buildDoodleSvg(), "doodles.svg is out of date: run  node tools/make-doodle-tile.mjs  then  node tools/make-doodles.mjs");
});

test("DENSITY: the tile has twice the doodles it had (35 before), drawn from a wide set of shapes", () => {
  const items = layoutDoodles();
  assert.ok(items.length >= 70, `only ${items.length} doodles; the aim is at least double the old 35`);
  const kinds = new Set(items.map(i => i.id));
  assert.ok(kinds.size >= 25, `only ${kinds.size} different drawings (it was 14); doubling the count of the same few shapes would look repetitive`);
  for (const id of kinds) assert.ok(ICONS[id], `an unknown drawing: ${id}`);
});

test("EVEN SPREAD: no two doodles touch, and there are no big empty patches", () => {
  const items = layoutDoodles();
  assert.ok(minClearance(items) >= 8, `two doodles are only ${minClearance(items).toFixed(1)} units apart (need at least 8)`);
  const wrap = (a, b) => Math.min(Math.abs(a - b), TILE - Math.abs(a - b));
  let worst = 0;
  for (let gx = 0; gx < 60; gx++) for (let gy = 0; gy < 60; gy++) {
    const x = gx * TILE / 60, y = gy * TILE / 60;
    worst = Math.max(worst, Math.min(...items.map(i => Math.hypot(wrap(x, i.x), wrap(y, i.y)))));
  }
  assert.ok(worst <= 42, `there is a patch of the tile ${worst.toFixed(0)} units from the nearest doodle (max 42), which would show as a gap`);
});

test("SEAMLESS: every doodle that crosses an edge is also drawn on the far side, so the repeat has no join", () => {
  const items = layoutDoodles(), drawn = placements(items);
  const uses = [...svg.matchAll(/<use href='#(\w+)' transform='translate\((-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)\)/g)].map(m => ({ id: m[1], x: +m[2], y: +m[3] }));
  assert.equal(uses.length, drawn.length, "the SVG draws a different number of doodles than the layout says");
  for (const p of drawn) assert.ok(uses.some(u => u.id === p.id && Math.abs(u.x - p.x) < 0.06 && Math.abs(u.y - p.y) < 0.06), `${p.id} at (${p.x}, ${p.y}) is missing from the SVG`);
  const crossing = items.filter(i => i.x - i.radius < 0 || i.x + i.radius > TILE || i.y - i.radius < 0 || i.y + i.radius > TILE);
  assert.ok(crossing.length >= 3, "sanity: some doodles should cross an edge in a wrap-around layout");
  for (const c of crossing) assert.ok(drawn.filter(p => p.id === c.id && p.copy).length >= 1, `${c.id} crosses an edge but has no copy on the other side`);
  for (const p of drawn) assert.ok(p.x + p.radius > 0 && p.x - p.radius < TILE && p.y + p.radius > 0 && p.y - p.radius < TILE, "a drawn copy lies entirely outside the tile (wasted)");
});

test("the data URIs are valid CSS, decode to the right drawing, and use the right ink for light and dark", () => {
  for (const variant of ["light", "dark"]) {
    const uri = dataUri(svg, variant);
    assert.ok(!/[<>#"\s]/.test(uri.replace("data:image/svg+xml,", "")), `${variant}: the URI has characters that break a CSS url("...")`);
    const decoded = decodeURIComponent(uri.replace("data:image/svg+xml,", ""));
    assert.ok(decoded.startsWith("<svg ") && decoded.endsWith("</svg>") && decoded.includes("viewBox='0 0 360 360'"));
    assert.ok(decoded.includes(`stroke='${VARIANTS[variant].stroke}'`) && decoded.includes(`stroke-opacity='${VARIANTS[variant].opacity}'`), `${variant}: wrong colour or opacity`);
    assert.ok(!decoded.includes("%STROKE%") && !decoded.includes("%OPACITY%"), "an unfilled placeholder is left in the SVG");
    assert.ok((decoded.match(/<use /g) || []).length >= 70, "too few doodles in the drawing");
    assert.ok((decoded.match(/<g /g) || []).length === (decoded.match(/<\/g>/g) || []).length, "unbalanced groups");
    const defined = new Set([...decoded.matchAll(/<(?:g|circle) id='(\w+)'/g)].map(m => m[1]));
    for (const m of decoded.matchAll(/<use href='#(\w+)'/g)) assert.ok(defined.has(m[1]), `${variant}: a doodle refers to a drawing that isn't defined: ${m[1]}`);
  }
  assert.notEqual(dataUri(svg, "light"), dataUri(svg, "dark"));
  const lightInk = /--ink:\s*(#[0-9A-Fa-f]{6})/.exec(css.slice(0, css.indexOf('[data-theme="dark"]')))[1];
  const darkInk = /--ink:\s*(#[0-9A-Fa-f]{6})/.exec(css.slice(css.indexOf('[data-theme="dark"]')))[1];
  assert.equal(VARIANTS.light.stroke.toUpperCase(), lightInk.toUpperCase(), "the light pattern should be drawn in the app's own ink colour");
  assert.equal(VARIANTS.dark.stroke.toUpperCase(), darkInk.toUpperCase(), "the dark pattern should be drawn in the app's own dark-mode ink colour");
});

test("it stays a vector tile in three sizes (Small by default), and is never printed", () => {
  const block = css.slice(css.indexOf(START), css.indexOf(END));
  // Three sizes, set once as a variable. Small is the default and grows only gently with the screen (a fine texture on a phone,
  // an iPad and a desktop alike); Large is the original, bigger look.
  assert.match(block, /html \{ --doodle-tile: clamp\(150px, calc\(130px \+ 4vw\), 200px\); \}/, "Small (the default) is missing or changed");
  assert.match(block, /data-bg-pattern-size="medium"\] \{ --doodle-tile: clamp\(220px, calc\(190px \+ 8vw\), 300px\); \}/);
  assert.match(block, /data-bg-pattern-size="large"\] \{ --doodle-tile: clamp\(320px, calc\(260px \+ 14vw\), 520px\); \}/);
  assert.match(block, /html\[data-bg-pattern="doodles"\] body \{ background-image: var\(--doodles\); background-size: var\(--doodle-tile\);/);
  assert.ok(block.length < 28 * 1024, `the pattern block is ${(block.length / 1024).toFixed(1)} KB (two colour versions of 71 doodles); keep it under 28`);
  assert.match(css, /@media print \{[^}]*html\[data-bg-pattern\] body \{ background-image: none !important; \}/);
});

test("READABILITY: text keeps its contrast even on the darkest pixel of the pattern, over every background colour you can pick", () => {
  const rootBlock = css.slice(0, css.indexOf("[data-theme=\"dark\"]"));
  const darkBlock = css.slice(css.indexOf("[data-theme=\"dark\"]"), css.indexOf("[data-theme=\"dark\"]") + 900);
  const presets = [...app.slice(app.indexOf("const BG_PRESETS"), app.indexOf("const BG_PRESETS") + 400).matchAll(/#[0-9A-Fa-f]{6}/g)].map(m => m[0]);
  assert.ok(presets.length >= 5, "found the background colour presets: " + presets.length);
  const cases = [
    ...[cssVar(rootBlock, "--paper"), ...presets.map(hex)].map(bg => ({ label: "light", bg: Array.isArray(bg) ? bg : hex(bg), ink: cssVar(rootBlock, "--ink"), soft: cssVar(rootBlock, "--ink-soft"), stroke: hex(VARIANTS.light.stroke), a: +VARIANTS.light.opacity })),
    { label: "dark", bg: cssVar(darkBlock, "--paper"), ink: cssVar(darkBlock, "--ink"), soft: cssVar(darkBlock, "--ink-soft"), stroke: hex(VARIANTS.dark.stroke), a: +VARIANTS.dark.opacity }
  ];
  for (const c of cases) {
    const worst = blend(c.stroke, c.bg, c.a);                       // the pixel in the middle of a doodle line: the most the pattern can ever change the background
    assert.ok(contrast(c.ink, worst) >= 9, `${c.label} ${c.bg}: main text only ${contrast(c.ink, worst).toFixed(1)}:1 on the pattern`);
    // The grey secondary text was already below 4.5:1 on the plain light backgrounds (about 3.6 to 4.0), and the pattern can only
    // touch it where a thin line passes directly behind a letter. It must never fall below 3:1 in light mode; dark mode starts
    // at 7.2:1 so it has to stay comfortably above the 4.5:1 standard.
    const floor = c.label === "dark" ? 4.5 : 3.0;
    assert.ok(contrast(c.soft, worst) >= floor, `${c.label} ${c.bg}: secondary text drops to ${contrast(c.soft, worst).toFixed(2)}:1 on the pattern (floor ${floor})`);
  }
});
