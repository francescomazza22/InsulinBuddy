// The Abstract background, laid out for the actual screen so it never repeats (see js/doodle-field.js for the same idea
// with the doodles). The shapes come from the owner's artwork, cut apart by tools/make-abstract-motifs.mjs.
import { MOTIFS, MOTIF_DEFS } from "./abstract-motifs.js";
import { rnd } from "./doodle-field.js";

const SHAPES = MOTIFS.filter(m => m.kind === "big");
const LINES = MOTIFS.filter(m => m.kind === "accent");

/** Same three sizes as before (the width in px of the artwork's 300-unit square), as a scale factor. */
export function abstractScale(width, size) {
  const clamp = (lo, v, hi) => Math.min(hi, Math.max(lo, v));
  const tile = size === "large" ? clamp(350, 290 + 0.14 * width, 560) : size === "medium" ? clamp(250, 220 + 0.08 * width, 350) : clamp(180, 160 + 0.04 * width, 240);
  return tile / 300;
}

// How much of its radius a shape really fills (the radius in the artwork data is the outer reach, and most shapes are
// rounder or thinner than that), and the clear space kept between neighbours, in the artwork's units.
const FILL = 0.8, LINE_FILL = 0.55, GAP = 7;

/**
 * [{ id, x, y, rot, scale, r }]. Nothing overlaps: shapes are placed one at a time from a fixed hash of the cell, and a spot
 * is used only if it is clear of everything placed so far. The big coloured shapes go in first, then loose linework fills the
 * gaps that are left. Same screen size, same layout, every time.
 */
export function layoutAbstract(width, height, size = "small") {
  const k = abstractScale(width, size);
  const cell = 64 * k;
  const cols = Math.ceil(width / cell) + 1, rows = Math.ceil(height / cell) + 1;
  const placed = [];
  const buckets = new Map();
  const bk = (x, y) => Math.floor(x / (cell * 2)) + "," + Math.floor(y / (cell * 2));
  const clear = (x, y, e) => {
    const bx = Math.floor(x / (cell * 2)), by = Math.floor(y / (cell * 2));
    const reach = Math.ceil((e + 130 * k) / (cell * 2));
    for (let dx = -reach; dx <= reach; dx++) for (let dy = -reach; dy <= reach; dy++) {
      for (const p of buckets.get((bx + dx) + "," + (by + dy)) || []) {
        const d = Math.hypot(p.x - x, p.y - y);
        if (d < p.e + e + GAP * k) return false;
      }
    }
    return true;
  };
  const add = (it) => { placed.push(it); const key = bk(it.x, it.y); if (!buckets.has(key)) buckets.set(key, []); buckets.get(key).push(it); };
  const pass = (list, fill, salt, tries, scaleLo, scaleHi, rotRange, avoidSame) => {
    for (let cy = -1; cy < rows; cy++) {
      for (let cx = -1; cx < cols; cx++) {
        for (let t = 0; t < tries; t++) {
          const s = salt + t * 7;
          const m = list[Math.floor(rnd(cx, cy, s) * list.length)];
          const sc = k * (scaleLo + rnd(cx, cy, s + 1) * (scaleHi - scaleLo));
          const x = (cx + rnd(cx, cy, s + 2)) * cell, y = (cy + rnd(cx, cy, s + 3)) * cell;
          const e = m.r * fill * sc;
          if (x < -e || y < -e || x > width + e || y > height + e) continue;
          if (avoidSame && placed.some(p => p.id === m.id && Math.abs(p.x - x) < cell * 3.2 && Math.abs(p.y - y) < cell * 3.2)) continue;
          if (!clear(x, y, e)) continue;
          add({ id: m.id, x, y, rot: (rnd(cx, cy, s + 4) - 0.5) * rotRange, scale: sc, r: m.r * sc, e });
          break;
        }
      }
    }
  };
  pass(SHAPES, FILL, 100, 8, 0.9, 1.15, 100, true);
  pass(LINES, LINE_FILL, 400, 5, 0.85, 1.1, 360, false);
  return placed;
}

const fmt = n => Math.round(n * 10) / 10;

/** The SVG markup. The black linework takes its colour from the page (the --abs-line variable) and the page fades the whole thing. */
export function abstractSvg(width, height, size = "small") {
  const uses = layoutAbstract(width, height, size).map(i => `<use href="#${i.id}" transform="translate(${fmt(i.x)} ${fmt(i.y)}) rotate(${fmt(i.rot)}) scale(${Math.round(i.scale * 1000) / 1000})"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true"><defs>${MOTIF_DEFS}</defs>${uses}</svg>`;
}
