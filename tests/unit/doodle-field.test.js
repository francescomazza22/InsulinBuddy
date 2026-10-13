import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { GLYPHS, BIG, SMALL, layoutField, fieldSvg, doodleScale } from "../../js/doodle-field.js";

const ROOT = new URL("../..", import.meta.url).pathname;
const tileSvg = fs.readFileSync(ROOT + "tools/doodles.svg", "utf8");
const norm = x => x.replace(/\s+/g, " ").replace(/> </g, "><").trim();

test("the drawings are exactly the ones in tools/doodles.svg", () => {
  assert.equal(norm(/<defs>([\s\S]*?)<\/defs>/.exec(tileSvg)[1]), GLYPHS);
  for (const id of [...BIG, ...SMALL]) assert.ok(GLYPHS.includes(`id='${id}'`), id);
});

test("NO REPEAT: no stretch of the layout is a copy of another one, on a phone or a big monitor", () => {
  for (const [w, h] of [[393, 852], [820, 1180], [2560, 1440]]) {
    const items = layoutField(w, h, "small");
    // fingerprint each window of 8 consecutive drawings by (id, rounded rotation); a tiled picture would repeat them exactly
    const big = items.filter(i => BIG.includes(i.id));
    const seen = new Set(); let dupes = 0;
    for (let i = 0; i + 8 <= big.length; i++) { const k = big.slice(i, i + 8).map(b => b.id + Math.round(b.rot)).join("|"); if (seen.has(k)) dupes++; seen.add(k); }
    assert.equal(dupes, 0, `${w}x${h}: ${dupes} repeated runs`);
    // and the pattern has no translation period: shifting by any whole row/column never lands every drawing on another
    const key = i => `${Math.round(i.x)},${Math.round(i.y)},${i.id}`;
    const set = new Set(items.map(key));
    for (const [dx, dy] of [[0, 120], [120, 0], [240, 240], [360, 0], [0, 360]]) {
      const hits = items.filter(i => set.has(key({ ...i, x: i.x + dx, y: i.y + dy }))).length;
      assert.ok(hits < items.length * 0.05, `${w}x${h}: shifting by ${dx},${dy} re-lands ${hits}/${items.length}`);
    }
  }
});

test("it covers the whole screen: doodles reach every edge and corner", () => {
  const w = 1440, h = 900, items = layoutField(w, h, "small");
  const inBox = (x0, y0, x1, y1) => items.some(i => i.x >= x0 && i.x <= x1 && i.y >= y0 && i.y <= y1);
  assert.ok(inBox(0, 0, 60, 60) && inBox(w - 60, 0, w, 60) && inBox(0, h - 60, 60, h) && inBox(w - 60, h - 60, w, h));
  // no big empty patch: every 200px square has doodles
  for (let x = 0; x < w; x += 200) for (let y = 0; y < h; y += 200) assert.ok(inBox(x, y, x + 200, y + 200), `empty at ${x},${y}`);
});

test("SAME LOOK: the same screen always gives the same layout, and a taller one keeps the doodles it already had", () => {
  assert.equal(fieldSvg(500, 800, "small"), fieldSvg(500, 800, "small"));
  const a = layoutField(500, 800, "small"), b = layoutField(500, 1000, "small");
  const kb = new Set(b.map(i => `${i.id}${i.x}${i.y}`));
  const kept = a.filter(i => kb.has(`${i.id}${i.x}${i.y}`)).length;
  assert.ok(kept > a.length * 0.9, `${kept}/${a.length} kept`);
});

test("variety and no neighbouring twins", () => {
  const items = layoutField(1000, 1000, "small");
  const ids = new Set(items.map(i => i.id));
  assert.ok(BIG.filter(b => ids.has(b)).length >= 20, "most drawings appear");
});

test("sizes: Small < Medium < Large, and the density caps on a huge screen", () => {
  const n = s => layoutField(1000, 800, s).length;
  assert.ok(n("small") > n("medium") && n("medium") > n("large"));
  assert.ok(layoutField(5000, 3000, "small").length <= 9500);
  assert.ok(doodleScale(390, "small") < doodleScale(390, "large"));
});

test("the SVG draws in the page's colour (set in CSS) and is a sane size", () => {
  const svg = fieldSvg(393, 852, "small");
  assert.match(svg, /stroke="currentColor"/);
  assert.ok(svg.length < 140000, String(svg.length));
});
