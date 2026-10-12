// The Abstract background, laid out for the actual screen so it never repeats (see js/doodle-field.js for the same idea
// with the doodles). The shapes come from the owner's artwork, cut apart by tools/make-abstract-motifs.mjs.
import { MOTIFS, MOTIF_DEFS } from "./abstract-motifs.js";
import { rnd } from "./doodle-field.js";

// Only the artwork's own coloured shapes and its longer linework are used: no confetti, no tiny marks.
// Only the artwork's own coloured shapes and its longer linework are used: no confetti, no tiny marks.
const SHAPES = MOTIFS.filter(m => m.kind === "big" && m.r >= 38 && m.r < 90);
const SQUIGGLE = MOTIFS.find(m => m.kind === "big" && m.r >= 90);
const LINES = MOTIFS.filter(m => m.kind === "accent" && m.r >= 40);

/** Same three sizes as before (the width in px of the artwork's 300-unit square), as a scale factor. */
export function abstractScale(width, size) {
  const clamp = (lo, v, hi) => Math.min(hi, Math.max(lo, v));
  const tile = size === "large" ? clamp(350, 290 + 0.14 * width, 560) : size === "medium" ? clamp(250, 220 + 0.08 * width, 350) : clamp(180, 160 + 0.04 * width, 240);
  return tile / 300;
}

// How much of its radius a shape really fills (the radius in the artwork data is its outer reach, and most shapes are rounder
// or thinner than that), and the least clear space kept between neighbours, in the artwork's units.
const FILL = 0.84, LINE_FILL = 0.5, GAP = 14;

/**
 * [{ id, x, y, rot, scale, r, e }]. An even, uncluttered spread. Shapes go in one at a time; each is tried at many fixed
 * pseudo-random spots and put at the one furthest from everything already placed (and from a copy of itself), so the gaps
 * come out about equal instead of clumped. A spot is only ever used if it is clear of every neighbour (nothing overlaps).
 * About as many shapes as the original artwork had per square, then a few lines in the larger gaps.
 * Same screen size, same layout, every time.
 */
export function layoutAbstract(width, height, size = "small") {
  const k = abstractScale(width, size);
  const placed = [];
  const area = width * height;
  const shapeCount = Math.max(6, Math.round(area / ((88 * k) * (88 * k))));
  const lineCount = Math.round(shapeCount * 0.4);
  const CANDIDATES = 30;
  const gap = GAP * k;
  // Shapes come from shuffled rounds of the whole set (every shape once per round, in a fresh order each time), so each turns
  // up equally often and the same one is never bunched together by chance.
  const sequence = (list, n, salt) => {
    const out = [];
    for (let round = 0; out.length < n; round++) {
      const bag = [...list];
      for (let j = bag.length - 1; j > 0; j--) { const s = Math.floor(rnd(round, j, salt) * (j + 1)); [bag[j], bag[s]] = [bag[s], bag[j]]; }
      out.push(...bag);
    }
    return out.slice(0, n);
  };
  const place = (list, n, fill, salt, scaleLo, scaleHi, rotRange, same) => {
    const order = sequence(list, n, salt + 500);
    for (let i = 0; i < n; i++) {
      const m = order[i];
      const sc = k * (scaleLo + rnd(i, salt, 2) * (scaleHi - scaleLo));
      const e = m.r * fill * sc;
      let best = null, bestScore = -Infinity;
      for (let c = 0; c < CANDIDATES; c++) {
        const x = rnd(i, salt + 10 + c, 3) * (width + e) - e * 0.5, y = rnd(i, salt + 10 + c, 4) * (height + e) - e * 0.5;
        let score = Infinity, ok = true;
        for (const p of placed) {
          const d = Math.hypot(p.x - x, p.y - y) - p.e - e;
          if (d < gap) { ok = false; break; }                       // the collision gate: too close to a neighbour
          const eff = same && p.id === m.id ? d * 0.55 : d;         // a copy of the same shape counts as nearer than it is
          if (eff < score) score = eff;
        }
        if (ok && score > bestScore) { bestScore = score; best = { x, y }; }
      }
      if (best) placed.push({ id: m.id, x: best.x, y: best.y, rot: (rnd(i, salt, 5) - 0.5) * rotRange, scale: sc, r: m.r * sc, e });
    }
  };
  // the long coral squiggle is big, so only an occasional one is slipped in
  const withSquiggle = SQUIGGLE ? [...SHAPES, ...SHAPES, SQUIGGLE] : SHAPES;
  place(withSquiggle, shapeCount, FILL, 11, 0.95, 1.12, 70, true);
  place(LINES, lineCount, LINE_FILL, 12, 0.9, 1.1, 360, true);
  return placed;
}

const fmt = n => Math.round(n * 10) / 10;

/** The SVG markup. The black linework takes its colour from the page (the --abs-line variable) and the page fades the whole thing. */
export function abstractSvg(width, height, size = "small") {
  const uses = layoutAbstract(width, height, size).map(i => `<use href="#${i.id}" transform="translate(${fmt(i.x)} ${fmt(i.y)}) rotate(${fmt(i.rot)}) scale(${Math.round(i.scale * 1000) / 1000})"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true"><defs>${MOTIF_DEFS}</defs>${uses}</svg>`;
}
