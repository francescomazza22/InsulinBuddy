// The Abstract background, laid out for the actual screen so it never repeats (see js/doodle-field.js for the same idea
// with the doodles). The shapes come from the owner's artwork, cut apart by tools/make-abstract-motifs.mjs.
import { MOTIFS, MOTIF_DEFS } from "./abstract-motifs.js";
import { rnd } from "./doodle-field.js";

// Only the artwork's own coloured shapes and its longer linework are used: no confetti, no tiny marks.
const SHAPES = MOTIFS.filter(m => m.kind === "big" && m.r >= 38 && m.r < 90);
const SQUIGGLE = MOTIFS.find(m => m.kind === "big" && m.r >= 90);
const LINES = MOTIFS.filter(m => m.kind === "accent" && m.r >= 70);

// Each shape's main colour, read from its drawing, so neighbours can be kept from sharing one.
const COLOUR = {};
for (const m of MOTIFS) {
  const at = MOTIF_DEFS.indexOf(`<g id=\"${m.id}\">`);
  const seg = MOTIF_DEFS.slice(at, MOTIF_DEFS.indexOf('<g id=\"m', at + 8) < 0 ? undefined : MOTIF_DEFS.indexOf('<g id=\"m', at + 8));
  COLOUR[m.id] = (/(?:fill|stroke)=\"(#[0-9A-F]{6})\"/.exec(seg) || [])[1] || "line";
}

/** Same three sizes as before (the width in px of the artwork's 300-unit square), as a scale factor. */
export function abstractScale(width, size) {
  const clamp = (lo, v, hi) => Math.min(hi, Math.max(lo, v));
  const tile = size === "large" ? clamp(350, 290 + 0.14 * width, 560) : size === "medium" ? clamp(250, 220 + 0.08 * width, 350) : clamp(180, 160 + 0.04 * width, 240);
  return tile / 300;
}

// How much of its radius a shape really fills (the radius in the artwork data is its outer reach, and most are rounder or thinner).
const FILL = 0.84, LINE_FILL = 0.5;

/**
 * [{ id, x, y, rot, scale, r, e }]. A designed rhythm instead of a random scatter: shapes sit on a staggered (brick-like)
 * lattice, nudged a little so it reads as hand-placed. That alone makes the gaps even, with no clumps and no voids. Which
 * shape goes where is decided so that neighbours never share a shape or a colour, every shape turns up equally often, and
 * each is sized to fill its slot evenly. The long squiggle and the loose linework take the odd slot for lightness.
 * Nothing overlaps. Same screen size, same layout, every time.
 */
export function layoutAbstract(width, height, size = "small") {
  const k = abstractScale(width, size);
  const s = 112 * k;                                   // distance between neighbouring slots
  const rowH = s * Math.sqrt(3) / 2;
  const jit = 0.05 * s;                               // how far a shape may be nudged from its slot
  const room = 0.43 * s;                               // the radius each slot may fill, so even nudged neighbours cannot touch
  const rows = Math.ceil(height / rowH) + 3, cols = Math.ceil(width / s) + 3;
  const grid = new Map();                              // "row,col" -> chosen motif id
  const use = {}; [...SHAPES, SQUIGGLE, ...LINES].filter(Boolean).forEach(m => { use[m.id] = 0; });
  const items = [];
  const neighbours = (r, c) => {                       // slots already decided that touch this one (above and to the left)
    const off = r % 2 === 0 ? 0 : 1;
    return [[r, c - 1], [r - 1, c - 1 + off], [r - 1, c + off], [r, c - 2], [r - 2, c]];
  };
  for (let r = -1; r < rows; r++) {
    for (let c = -1; c < cols; c++) {
      const near = neighbours(r, c).map(([rr, cc]) => grid.get(rr + "," + cc)).filter(Boolean);
      const nearCol = new Set(near.map(id => COLOUR[id]));
      let pool;
      const special = rnd(r, c, 61) < 0.13 && (SQUIGGLE || LINES.length);
      if (special) {
        const lines = [...(SQUIGGLE ? [SQUIGGLE] : []), ...LINES].filter(m => !near.includes(m.id));
        pool = lines.length ? lines : SHAPES;
      } else pool = SHAPES;
      let cand = pool.filter(m => !near.includes(m.id) && !nearCol.has(COLOUR[m.id]));
      if (!cand.length) cand = pool.filter(m => !near.includes(m.id));
      if (!cand.length) cand = pool;
      const least = Math.min(...cand.map(m => use[m.id]));
      const bag = cand.filter(m => use[m.id] <= least + 1);
      const m = bag[Math.floor(rnd(r, c, 62) * bag.length)];
      use[m.id]++;
      grid.set(r + "," + c, m.id);
      const fill = m.kind === "accent" ? LINE_FILL : FILL;
      const fit = room / (m.r * fill) / k;                         // the scale that would fill the slot exactly
      const sc = k * Math.min(fit, Math.pow(fit, 0.65)) * (0.92 + rnd(r, c, 63) * 0.08);   // evened out: small shapes are not blown up to fill
      const cx = (c + (r % 2 === 0 ? 0 : 0.5)) * s + (rnd(r, c, 64) - 0.5) * 2 * jit;
      const cy = r * rowH + (rnd(r, c, 65) - 0.5) * 2 * jit;
      const rot = (rnd(r, c, 66) - 0.5) * (m.kind === "accent" ? 360 : 50);
      items.push({ id: m.id, x: cx, y: cy, rot, scale: sc, r: m.r * sc, e: m.r * fill * sc });
    }
  }
  return items.filter(i => i.x > -i.e && i.y > -i.e && i.x < width + i.e && i.y < height + i.e);
}

const fmt = n => Math.round(n * 10) / 10;

/** The SVG markup. The black linework takes its colour from the page (the --abs-line variable) and the page fades the whole thing. */
export function abstractSvg(width, height, size = "small") {
  const uses = layoutAbstract(width, height, size).map(i => `<use href="#${i.id}" transform="translate(${fmt(i.x)} ${fmt(i.y)}) rotate(${fmt(i.rot)}) scale(${Math.round(i.scale * 1000) / 1000})"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true"><defs>${MOTIF_DEFS}</defs>${uses}</svg>`;
}
