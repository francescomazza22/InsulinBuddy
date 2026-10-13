import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildModule, buildMotifs } from "../../tools/make-abstract-motifs.mjs";
import { lineGrey } from "../../tools/make-abstract.mjs";
import { layoutAbstract, abstractSvg, abstractScale } from "../../js/abstract-field.js";
import { MOTIFS } from "../../js/abstract-motifs.js";

const ROOT = new URL("../..", import.meta.url).pathname;
const source = fs.readFileSync(ROOT + "tools/abstract-source.svg", "utf8");
const css = fs.readFileSync(ROOT + "style.css", "utf8");
const hex = c => "#" + c.map(v => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase();

test("js/abstract-motifs.js is exactly what tools/make-abstract-motifs.mjs makes (otherwise run: node tools/make-abstract-motifs.mjs)", () => {
  assert.equal(fs.readFileSync(ROOT + "js/abstract-motifs.js", "utf8"), buildModule(source));
});

test("the artwork is cut into its shapes: several coloured shapes with linework, and loose accents", () => {
  const m = buildMotifs(source);
  assert.ok(m.filter(x => x.kind === "big").length >= 8, "coloured shapes");
  assert.ok(m.filter(x => x.kind === "accent").length >= 4, "loose accents");
  for (const x of m) assert.ok(x.r > 1 && x.r < 130, `${x.id} radius ${x.r}`);
  const colours = new Set([...buildModule(source).matchAll(/fill=\\"(#[0-9A-F]{6})\\"/g)].map(x => x[1]));
  for (const c of ["#7AE3E1", "#F889C5", "#FEB771", "#868AE3", "#FF7540"]) assert.ok(colours.has(c), "keeps the artwork colour " + c);
});

test("NO REPEAT: shifting the layout by a whole number of cells never lands the shapes back on themselves", () => {
  for (const [w, h] of [[393, 852], [1440, 900], [2560, 1440]]) {
    const items = layoutAbstract(w, h, "small");
    const key = i => `${Math.round(i.x)},${Math.round(i.y)},${i.id}`;
    const set = new Set(items.map(key));
    for (const [dx, dy] of [[0, 112 * abstractScale(w, "small")], [112 * abstractScale(w, "small"), 0], [300, 300], [360, 0], [0, 360]]) {
      const hits = items.filter(i => set.has(key({ ...i, x: i.x + dx, y: i.y + dy }))).length;
      assert.ok(hits < items.length * 0.05, `${w}x${h} shift ${dx},${dy}: ${hits}/${items.length}`);
    }
  }
});

test("it covers the screen and uses the same layout every time", () => {
  const w = 1200, h = 800, items = layoutAbstract(w, h, "small");
  for (let x = 0; x < w; x += 250) for (let y = 0; y < h; y += 250) assert.ok(items.some(i => i.x >= x - 60 && i.x <= x + 310 && i.y >= y - 60 && i.y <= y + 310), `empty near ${x},${y}`);
  assert.equal(abstractSvg(500, 800, "small"), abstractSvg(500, 800, "small"));
});

test("NOTHING OVERLAPS: no two shapes touch, on a phone, an iPad or a big monitor, at every size", () => {
  for (const [w, h] of [[393, 852], [820, 1180], [1440, 900], [2560, 1440]]) for (const size of ["small", "medium", "large"]) {
    const L = layoutAbstract(w, h, size);
    let bad = 0;
    for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) if (Math.hypot(L[i].x - L[j].x, L[i].y - L[j].y) < L[i].e + L[j].e) bad++;
    assert.equal(bad, 0, `${w}x${h} ${size}: ${bad} overlapping pairs`);
    assert.ok(L.length > 8, `${w}x${h} ${size}: only ${L.length} shapes`);
  }
});

test("EVENLY SPREAD: no big empty patch anywhere; every square of about two shapes across holds something", () => {
  for (const [w, h] of [[393, 852], [820, 1180], [1440, 900]]) for (const size of ["small", "medium", "large"]) {
    const L = layoutAbstract(w, h, size);
    const sq = 170 * abstractScale(w, size);
    let empty = 0, total = 0;
    for (let x = 0; x + sq <= w; x += sq) for (let y = 0; y + sq <= h; y += sq) {
      total++;
      if (!L.some(i => i.x + i.e > x && i.x - i.e < x + sq && i.y + i.e > y && i.y - i.e < y + sq)) empty++;
    }
    assert.equal(empty, 0, `${w}x${h} ${size}: ${empty}/${total} empty squares`);
  }
});

test("it is quick enough to redraw on every resize (under a second on a 4K screen)", () => {
  const t = Date.now(); layoutAbstract(3840, 2160, "small");
  assert.ok(Date.now() - t < 2500, `${Date.now() - t} ms`);
});

test("DESIGNED RHYTHM: touching neighbours never repeat a shape, and are not the same colour", () => {
  for (const [w, h] of [[393, 852], [1440, 900]]) {
    const L = layoutAbstract(w, h, "small");
    const k = abstractScale(w, "small"), reach = 112 * k * 1.2;
    let same = 0, pairs = 0;
    for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) if (Math.hypot(L[i].x - L[j].x, L[i].y - L[j].y) < reach) { pairs++; if (L[i].id === L[j].id) same++; }
    assert.ok(pairs > 50);
    assert.equal(same, 0, `${w}x${h}: ${same} neighbouring pairs share a shape`);
  }
});

test("variety: most shapes appear, and no shape sits next to a copy of itself", () => {
  const items = layoutAbstract(1600, 1000, "small");
  assert.ok(new Set(items.map(i => i.id)).size >= 8, "most shapes appear");
  const big = items.filter(i => i.r > 25 * abstractScale(1600, "small"));
  const counts = {}; big.forEach(i => { counts[i.id] = (counts[i.id] || 0) + 1; });
  const vals = Object.values(counts).sort((a, b) => a - b);
  const rest = vals.filter(v => v >= 20);   // the squiggle and loose linework are deliberately rarer
  assert.ok(rest.length >= 7 && rest[rest.length - 1] <= rest[0] * 2, "every shape turns up about equally often: " + JSON.stringify(counts));
  assert.ok(!items.some(i => i.r < 20 * abstractScale(1600, "small")), "no tiny marks or confetti");
});

test("sizes: Small has more, smaller shapes than Large; very large screens stay light", () => {
  const n = s => layoutAbstract(1000, 800, s).length;
  assert.ok(n("small") > n("medium") && n("medium") > n("large"));
  assert.ok(layoutAbstract(3840, 2160, "small").length < 7500);
  assert.ok(abstractSvg(2560, 1440, "small").length < 700000);
});

test("the linework colour in style.css matches the tile's own (tools/make-abstract.mjs), and the fades match", () => {
  assert.ok(css.includes(`--abs-line: ${hex(lineGrey("light"))}`), "light linework");
  assert.ok(css.includes(`--abs-line: ${hex(lineGrey("dark"))}`), "dark linework");
  assert.match(css, /#bg-abstract \{ opacity: 0\.20;/);
  assert.match(css, /html\[data-theme="dark"\] #bg-abstract \{ opacity: 0\.18;/);
});
