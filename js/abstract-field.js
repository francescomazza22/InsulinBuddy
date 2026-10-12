// The Abstract background, laid out for the actual screen so it never repeats (see js/doodle-field.js for the same idea
// with the doodles). The shapes come from the owner's artwork, cut apart by tools/make-abstract-motifs.mjs.
import { MOTIFS, MOTIF_DEFS } from "./abstract-motifs.js";
import { rnd } from "./doodle-field.js";

const SHAPES = MOTIFS.filter(m => m.kind === "big");
const LINES = MOTIFS.filter(m => m.kind === "accent");

// Confetti in the artwork's own palette, drawn here, to fill the small gaps the larger shapes leave.
const L = 'class="l"', PAL = ["#7AE3E1", "#F889C5", "#FEB771", "#868AE3", "#FF7540"];
const FILLERS = [
  { id: "f0", r: 4, svg: `<g id="f0"><circle r="3.6" ${L}/></g>` },
  { id: "f1", r: 9, svg: `<g id="f1"><circle cx="-4" cy="3" r="2.8" ${L}/><circle cx="4" cy="-3" r="2.8" ${L}/><circle cx="5" cy="5" r="2.2" ${L}/></g>` },
  { id: "f2", r: 7, svg: `<g id="f2"><path d="M-6 0H6" fill="none" stroke-width="3" stroke-linecap="round" style="stroke:var(--abs-line)"/></g>` },
  { id: "f3", r: 8, svg: `<g id="f3"><path d="M-5 -5 5 5M5 -5-5 5" fill="none" stroke-width="2.6" stroke-linecap="round" style="stroke:var(--abs-line)"/></g>` },
  ...PAL.map((c, n) => ({ id: "f" + (4 + n), r: 6 + (n % 3) * 2, svg: `<g id="f${4 + n}"><circle r="${6 + (n % 3) * 2}" fill="${c}"/></g>` })),
  { id: "f9", r: 8, svg: `<g id="f9"><circle r="7" fill="none" stroke-width="2.6" style="stroke:var(--abs-line)"/></g>` }
];
const FILLER_DEFS = FILLERS.map(f => f.svg).join("");

/** Same three sizes as before (the width in px of the artwork's 300-unit square), as a scale factor. */
export function abstractScale(width, size) {
  const clamp = (lo, v, hi) => Math.min(hi, Math.max(lo, v));
  const tile = size === "large" ? clamp(350, 290 + 0.14 * width, 560) : size === "medium" ? clamp(250, 220 + 0.08 * width, 350) : clamp(180, 160 + 0.04 * width, 240);
  return tile / 300;
}

// How much of its radius a shape really fills (the radius in the artwork data is its outer reach, and most shapes are rounder
// or thinner than that), and the clear space kept between neighbours, in the artwork's units.
const FILL = 0.84, LINE_FILL = 0.5, GAP = 5;

/**
 * [{ id, x, y, rot, scale, r, e }]. Nothing overlaps, and the screen is packed evenly: shapes are tried at fixed pseudo-random
 * spots, biggest first, and each is kept only if it is clear of everything already placed. Then the medium shapes and loose
 * linework go into the gaps, then the small ones, and last the confetti, so no gap is left that anything could fill.
 * Same screen size, same layout, every time.
 */
export function layoutAbstract(width, height, size = "small") {
  const k = abstractScale(width, size);
  const B = 40 * k;                                     // bucket size for neighbour lookups
  let maxE = 0;
  const placed = [], buckets = new Map();
  const clear = (x, y, e) => {
    const bx = Math.floor(x / B), by = Math.floor(y / B);
    const rr = Math.ceil((e + maxE + GAP * k) / B);
    for (let dx = -rr; dx <= rr; dx++) for (let dy = -rr; dy <= rr; dy++) {
      const list = buckets.get((bx + dx) + "," + (by + dy));
      if (!list) continue;
      for (const p of list) if (Math.hypot(p.x - x, p.y - y) < p.e + e + GAP * k) return false;
    }
    return true;
  };
  const add = it => { if (it.e > maxE) maxE = it.e; placed.push(it); const key = Math.floor(it.x / B) + "," + Math.floor(it.y / B); (buckets.get(key) || buckets.set(key, []).get(key)).push(it); };
  const area = width * height;
  const tier = (list, fill, salt, perArea, scaleLo, scaleHi, rotRange, avoidSame, maxTries) => {
    const avgE = list.reduce((s, m) => s + m.r * fill, 0) / list.length * k * ((scaleLo + scaleHi) / 2);
    const tries = Math.min(maxTries, Math.ceil((area / (Math.PI * avgE * avgE)) * perArea));
    for (let n = 0; n < tries; n++) {
      const m = list[Math.floor(rnd(n, salt, 1) * list.length)];
      const sc = k * (scaleLo + rnd(n, salt, 2) * (scaleHi - scaleLo));
      const e = m.r * fill * sc;
      const x = rnd(n, salt, 3) * (width + 2 * e) - e, y = rnd(n, salt, 4) * (height + 2 * e) - e;
      if (avoidSame && placed.some(p => p.id === m.id && Math.abs(p.x - x) < B * 5 && Math.abs(p.y - y) < B * 5)) continue;
      if (!clear(x, y, e)) continue;
      add({ id: m.id, x, y, rot: (rnd(n, salt, 5) - 0.5) * rotRange, scale: sc, r: m.r * sc, e });
    }
  };
  const bigShapes = SHAPES.filter(m => m.r >= 38), smallShapes = SHAPES.filter(m => m.r < 38);
  const longLines = LINES.filter(m => m.r > 40), tinyLines = LINES.filter(m => m.r <= 40);
  tier(bigShapes, FILL, 11, 14, 0.92, 1.18, 100, true, 24000);
  tier(longLines, LINE_FILL, 12, 10, 0.85, 1.1, 360, false, 20000);
  tier(smallShapes.length ? smallShapes : bigShapes, FILL, 13, 1, 0.9, 1.2, 100, false, 8000);
  tier(tinyLines.length ? tinyLines : longLines, 0.8, 14, 2, 0.9, 1.2, 360, false, 20000);
  tier(FILLERS, 1, 15, 6, 0.9, 1.25, 360, false, 30000);
  return placed;
}

const fmt = n => Math.round(n * 10) / 10;

/** The SVG markup. The black linework takes its colour from the page (the --abs-line variable) and the page fades the whole thing. */
export function abstractSvg(width, height, size = "small") {
  const uses = layoutAbstract(width, height, size).map(i => `<use href="#${i.id}" transform="translate(${fmt(i.x)} ${fmt(i.y)}) rotate(${fmt(i.rot)}) scale(${Math.round(i.scale * 1000) / 1000})"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true"><defs>${MOTIF_DEFS}${FILLER_DEFS}</defs>${uses}</svg>`;
}
