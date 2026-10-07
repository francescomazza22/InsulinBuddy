// Generates tools/doodles.svg: the repeating tile of food / insulin / daily-rhythm doodles behind the app.
//   node tools/make-doodle-tile.mjs && node tools/make-doodles.mjs
// (the second step turns the SVG into the CSS in style.css; tests/unit/doodles.test.js fails if either is out of date)
//
// How the layout works: a fixed seed and "best candidate" placement spread the doodles EVENLY (each new one goes where
// it keeps the most clear space from those already placed), measuring distance as if the tile wraps around at its
// edges. Any doodle that crosses an edge is drawn again on the opposite side, so when the tile repeats there is no seam
// and no thinner band where the tiles meet. Change COUNT or SEED here to get a different (but still even) arrangement.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const TILE = 360;
export const STROKE = 2.8;
export const SEED = 20261007;

// Simple original line art, drawn around (0, 0). r is a generous radius used to keep doodles from touching.
export const ICONS = {
  drop:       { r: 10, d: `<path d='M0-10C0-10-8-1-8 4a8 8 0 0 0 16 0C8-1 0-10 0-10Z'/><path d='M-3 4a3 3 0 0 0 3 3'/>` },
  apple:      { r: 12, d: `<path d='M0-5C-4-9-11-6-9 1-8 7-4 10 0 8 4 10 8 7 9 1 11-6 4-9 0-5Z'/><path d='M0-5 1-10'/><path d='M1-9C4-12 8-10 8-10 7-7 4-7 1-9Z'/>` },
  cup:        { r: 13, d: `<path d='M-8-4H4V4a6 6 0 0 1-6 6h0A6 6 0 0 1-8 4Z'/><path d='M4-1h3a3 3 0 0 1 0 6H4'/><path d='M-4-9c-1-2 1-3 0-5M0-9c-1-2 1-3 0-5'/>` },
  sparkle:    { r: 8,  d: `<path d='M0-8 2-2 8 0 2 2 0 8-2 2-8 0-2-2Z'/>` },
  heart:      { r: 11, d: `<path d='M0 8C-12-1-7-9 0-4 7-9 12-1 0 8Z'/>` },
  bread:      { r: 11, d: `<path d='M-9-2C-12-8-4-11 0-9 4-11 12-8 9-2L9 9H-9Z'/><path d='M-4 2v4M0 2v4M4 2v4'/>` },
  pen:        { r: 12, d: `<rect x='-3.5' y='-11' width='7' height='17' rx='2'/><path d='M-3.5-5h7M0 6v5'/>` },
  clock:      { r: 10, d: `<circle r='9'/><path d='M0-5V0l4 3'/>` },
  sun:        { r: 12, d: `<circle r='4'/><path d='M0-9v-3M0 9v3M-9 0h-3M9 0h3M-6.4-6.4l-2.1-2.1M6.4 6.4l2.1 2.1M-6.4 6.4l-2.1 2.1M6.4-6.4l2.1-2.1'/>` },
  fork:       { r: 12, d: `<path d='M-5-10V-3a3 3 0 0 0 3 3h0a3 3 0 0 0 3-3V-10M-2-10V-3M-2 0V11'/>` },
  moon:       { r: 10, d: `<path d='M4-9A9 9 0 1 0 9 4 7 7 0 0 1 4-9Z'/>` },
  meter:      { r: 12, d: `<rect x='-8' y='-10' width='16' height='20' rx='3'/><rect x='-5' y='-7' width='10' height='7' rx='1.5'/><circle cx='0' cy='5' r='2'/>` },
  carrot:     { r: 13, d: `<path d='M0 11L-5-4C-5-8 5-8 5-4Z'/><path d='M-3 0H-1M1 4H3'/><path d='M0-7C-1-10-4-11-5-12M0-7V-12M0-7C1-10 4-11 5-12'/>` },
  banana:     { r: 12, d: `<path d='M-10-5C-9 5-1 10 10 5L10 2C2 5-5 2-6-5Z'/><path d='M-10-5-9-8H-6'/>` },
  strawberry: { r: 11, d: `<path d='M0 10C-8 5-10-3-6-6-3-8 3-8 6-6 10-3 8 5 0 10Z'/><path d='M-4-8 0-5 4-8'/><path d='M-3 0v1M2 1v1M0 5v1M-4 4v1'/>` },
  cookie:     { r: 10, d: `<circle r='9'/><circle cx='-3' cy='-3' r='1.2'/><circle cx='3' cy='-1' r='1.2'/><circle cx='-1' cy='4' r='1.2'/><circle cx='4' cy='5' r='1'/>` },
  glass:      { r: 11, d: `<path d='M-6-9H6L5 9H-5Z'/><path d='M-5.6-2H5.6'/>` },
  carton:     { r: 12, d: `<path d='M-6-3V9H6V-3L0-9Z'/><path d='M-6-3H6M0-9V-3'/>` },
  egg:        { r: 10, d: `<path d='M0-10C6-10 8-1 8 3a8 7 0 0 1-16 0C-8-1-6-10 0-10Z'/>` },
  cherry:     { r: 11, d: `<circle cx='-4' cy='5' r='4'/><circle cx='5' cy='6' r='4'/><path d='M-4 1C-3-4 0-8 3-9M5 2C5-3 4-7 3-9'/>` },
  star:       { r: 10, d: `<path d='M0-9 2.6-3 9-2.5 4 2 5.5 9 0 5.5-5.5 9-4 2-9-2.5-2.6-3Z'/>` },
  pill:       { r: 12, d: `<rect x='-11' y='-5' width='22' height='10' rx='5'/><path d='M0-5V5'/>` },
  cloud:      { r: 11, d: `<path d='M-8 5H6a4 4 0 0 0 0-8 5 5 0 0 0-9-1 4.5 4.5 0 0 0-5 9Z'/>` },
  leaf:       { r: 11, d: `<path d='M-8 8C-8-2 0-9 9-8 9 1 2 8-8 8Z'/><path d='M-8 8 3-3'/>` },
  bolt:       { r: 10, d: `<path d='M2-10-6 2H0L-2 10 6-2H0Z'/>` },
  plus:       { r: 5,  d: `<path d='M0-5v10M-5 0h10'/>` },
  dot:        { r: 2.4, d: `<circle r='2.4'/>` },
  ring:       { r: 3.4, d: `<circle r='3.4'/>` }
};

// What goes in the tile: every drawing once, a few favourites again (so the theme shows), then the small fillers.
const BIG = [...Object.keys(ICONS).filter(k => !["plus", "dot", "ring"].includes(k)), "drop", "drop", "apple", "pen", "meter", "moon", "sun", "bread", "cup", "heart"];
const FILLERS = [...Array(15).fill("dot"), ...Array(9).fill("ring"), ...Array(8).fill("plus"), ...Array(4).fill("sparkle")];

function rng(seed) {   // mulberry32: small, fast, and the same numbers every time
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const wrapDist = (a, b) => { const dx = Math.abs(a.x - b.x), dy = Math.abs(a.y - b.y); return Math.hypot(Math.min(dx, TILE - dx), Math.min(dy, TILE - dy)); };

/** The placed doodles: [{ id, x, y, rot, scale, radius }], spread evenly over a wrap-around tile. */
export function layoutDoodles(seed = SEED) {
  const rand = rng(seed), placed = [];
  const queue = [
    ...BIG.map(id => ({ id, scale: 1.0 + rand() * 0.35, rot: Math.round((rand() * 80 - 40) * 10) / 10 })),
    ...FILLERS.map(id => ({ id, scale: id === "sparkle" ? 0.55 + rand() * 0.15 : 1, rot: id === "plus" || id === "dot" || id === "ring" ? 0 : Math.round((rand() * 60 - 30) * 10) / 10 }))
  ].map(q => ({ ...q, radius: ICONS[q.id].r * q.scale + STROKE / 2 }))
   .sort((a, b) => b.radius - a.radius);                               // big ones first, small ones fill the gaps
  for (const item of queue) {
    let best = null;
    for (let k = 0; k < 120; k++) {                                    // best candidate: of many random spots, the one with the most clear space
      const c = { x: rand() * TILE, y: rand() * TILE };
      const clearance = placed.length ? Math.min(...placed.map(p => wrapDist(c, p) - (item.radius + p.radius))) : 99;
      if (!best || clearance > best.clearance) best = { ...c, clearance };
    }
    placed.push({ id: item.id, x: Math.round(best.x * 10) / 10, y: Math.round(best.y * 10) / 10, rot: item.rot, scale: Math.round(item.scale * 100) / 100, radius: item.radius });
  }
  return placed;
}

/** The smallest gap between any two doodles across the whole wrap-around tile (negative would mean two touch). */
export function minClearance(items) {
  let m = Infinity;
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) m = Math.min(m, wrapDist(items[i], items[j]) - (items[i].radius + items[j].radius));
  return m;
}

/** Every drawing of a doodle that shows in the tile: itself, plus a copy on the far side for each edge it crosses. */
export function placements(items) {
  const out = [];
  for (const it of items) for (const dx of [-TILE, 0, TILE]) for (const dy of [-TILE, 0, TILE]) {
    const x = it.x + dx, y = it.y + dy;
    if (x + it.radius > 0 && x - it.radius < TILE && y + it.radius > 0 && y - it.radius < TILE) out.push({ ...it, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, copy: dx !== 0 || dy !== 0 });
  }
  return out;
}

export function buildDoodleSvg(seed = SEED) {
  const items = layoutDoodles(seed), drawn = placements(items);
  const used = [...new Set(items.map(i => i.id))];
  const defs = used.map(id => `    <g id='${id}'>${ICONS[id].d}</g>`).join("\n");
  const uses = drawn.map(p => `  <use href='#${p.id}' transform='translate(${p.x} ${p.y})${p.rot ? ` rotate(${p.rot})` : ""}${p.scale !== 1 ? ` scale(${p.scale})` : ""}'/>`).join("\n");
  return `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${TILE} ${TILE}' width='${TILE}' height='${TILE}'>
<!-- GENERATED by tools/make-doodle-tile.mjs: ${items.length} doodles (${drawn.length - items.length} extra copies where doodles cross the tile edge, so it repeats with no seam).
     To change the drawings, the count or the arrangement, edit that script, run it, then run: node tools/make-doodles.mjs -->
<defs>
${defs}
</defs>
<g fill='none' stroke='%STROKE%' stroke-opacity='%OPACITY%' stroke-width='${STROKE}' stroke-linecap='round' stroke-linejoin='round'>
${uses}
</g>
</svg>
`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const items = layoutDoodles();
  fs.writeFileSync(path.join(root, "tools", "doodles.svg"), buildDoodleSvg());
  console.log(`tools/doodles.svg: ${items.length} doodles (${items.filter(i => !["dot", "ring", "plus"].includes(i.id) && i.radius > 7).length} icons), smallest gap ${minClearance(items).toFixed(1)} units`);
}
