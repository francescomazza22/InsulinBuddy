// The Abstract background, laid out for the actual screen so it never repeats (see js/doodle-field.js for the same idea
// with the doodles). The shapes come from the owner's artwork, cut apart by tools/make-abstract-motifs.mjs.
import { MOTIFS, MOTIF_DEFS } from "./abstract-motifs.js";
import { rnd } from "./doodle-field.js";

const BIG = MOTIFS.filter(m => m.kind === "big" && m.r < 90);   // the long coral squiggle is handled apart: it is big, so it is used sparingly
const SQUIGGLE = MOTIFS.find(m => m.kind === "big" && m.r >= 90);
const ACCENT = MOTIFS.filter(m => m.kind === "accent");

/** Same three sizes as before (the width in px of the artwork's 300-unit square), as a scale factor. */
export function abstractScale(width, size) {
  const clamp = (lo, v, hi) => Math.min(hi, Math.max(lo, v));
  const tile = size === "large" ? clamp(350, 290 + 0.14 * width, 560) : size === "medium" ? clamp(250, 220 + 0.08 * width, 350) : clamp(180, 160 + 0.04 * width, 240);
  return tile / 300;
}

/** [{ id, x, y, rot, scale }]: one big shape and one loose accent per cell, chosen and placed from a fixed hash of the cell. */
export function layoutAbstract(width, height, size = "small") {
  const k = abstractScale(width, size);
  const g = 112 * k;
  const cols = Math.ceil(width / g) + 2, rows = Math.ceil(height / g) + 2;
  const pick = (cx, cy) => Math.floor(rnd(cx, cy, 21) * BIG.length);
  const items = [];
  for (let cy = -1; cy < rows; cy++) {
    for (let cx = -1; cx < cols; cx++) {
      let b = pick(cx, cy), tries = 0;
      while ((b === pick(cx - 1, cy) || b === pick(cx, cy - 1) || b === pick(cx - 1, cy - 1)) && tries++ < 6) b = (b + 1 + Math.floor(rnd(cx, cy, 30 + tries) * (BIG.length - 1))) % BIG.length;
      const m = SQUIGGLE && rnd(cx, cy, 40) < 0.1 ? SQUIGGLE : BIG[b];
      items.push({ id: m.id, x: (cx + 0.5 + (rnd(cx, cy, 22) - 0.5) * 0.4) * g, y: (cy + 0.5 + (rnd(cx, cy, 23) - 0.5) * 0.4) * g, rot: (rnd(cx, cy, 24) - 0.5) * 100, scale: k * (0.9 + rnd(cx, cy, 25) * 0.25), r: m.r * k });
      const a = ACCENT[Math.floor(rnd(cx, cy, 26) * ACCENT.length)];
      items.push({ id: a.id, x: (cx + 1 + (rnd(cx, cy, 27) - 0.5) * 0.3) * g, y: (cy + 1 + (rnd(cx, cy, 28) - 0.5) * 0.3) * g, rot: (rnd(cx, cy, 29) - 0.5) * 360, scale: k * (0.85 + rnd(cx, cy, 31) * 0.3), r: a.r * k });
    }
  }
  return items.filter(i => i.x > -i.r * 1.2 && i.y > -i.r * 1.2 && i.x < width + i.r * 1.2 && i.y < height + i.r * 1.2);
}

const fmt = n => Math.round(n * 10) / 10;

/** The SVG markup. The black linework takes its colour from the page (the --abs-line variable) and the page fades the whole thing. */
export function abstractSvg(width, height, size = "small") {
  const uses = layoutAbstract(width, height, size).map(i => `<use href="#${i.id}" transform="translate(${fmt(i.x)} ${fmt(i.y)}) rotate(${fmt(i.rot)}) scale(${Math.round(i.scale * 1000) / 1000})"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true"><defs>${MOTIF_DEFS}</defs>${uses}</svg>`;
}
