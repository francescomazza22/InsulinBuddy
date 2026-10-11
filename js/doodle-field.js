// A doodle background that never repeats: instead of tiling one small picture, the doodles are laid out afresh for the
// actual screen (a jittered grid, so they look scattered, not ruled), and laid out again when the window changes size.
// Every cell's choices come from a fixed hash of its position, so growing or resizing the window keeps the doodles that were
// already there. The drawings are the same ones as tools/doodles.svg (tests/unit/doodle-field.test.js keeps them in step).

export const GLYPHS = `<g id='cup'><path d='M-8-4H4V4a6 6 0 0 1-6 6h0A6 6 0 0 1-8 4Z'/><path d='M4-1h3a3 3 0 0 1 0 6H4'/><path d='M-4-9c-1-2 1-3 0-5M0-9c-1-2 1-3 0-5'/></g><g id='apple'><path d='M0-5C-4-9-11-6-9 1-8 7-4 10 0 8 4 10 8 7 9 1 11-6 4-9 0-5Z'/><path d='M0-5 1-10'/><path d='M1-9C4-12 8-10 8-10 7-7 4-7 1-9Z'/></g><g id='carrot'><path d='M0 11L-5-4C-5-8 5-8 5-4Z'/><path d='M-3 0H-1M1 4H3'/><path d='M0-7C-1-10-4-11-5-12M0-7V-12M0-7C1-10 4-11 5-12'/></g><g id='banana'><path d='M-10-5C-9 5-1 10 10 5L10 2C2 5-5 2-6-5Z'/><path d='M-10-5-9-8H-6'/></g><g id='leaf'><path d='M-8 8C-8-2 0-9 9-8 9 1 2 8-8 8Z'/><path d='M-8 8 3-3'/></g><g id='bread'><path d='M-9-2C-12-8-4-11 0-9 4-11 12-8 9-2L9 9H-9Z'/><path d='M-4 2v4M0 2v4M4 2v4'/></g><g id='strawberry'><path d='M0 10C-8 5-10-3-6-6-3-8 3-8 6-6 10-3 8 5 0 10Z'/><path d='M-4-8 0-5 4-8'/><path d='M-3 0v1M2 1v1M0 5v1M-4 4v1'/></g><g id='cherry'><circle cx='-4' cy='5' r='4'/><circle cx='5' cy='6' r='4'/><path d='M-4 1C-3-4 0-8 3-9M5 2C5-3 4-7 3-9'/></g><g id='pill'><rect x='-11' y='-5' width='22' height='10' rx='5'/><path d='M0-5V5'/></g><g id='cloud'><path d='M-8 5H6a4 4 0 0 0 0-8 5 5 0 0 0-9-1 4.5 4.5 0 0 0-5 9Z'/></g><g id='sun'><circle r='4'/><path d='M0-9v-3M0 9v3M-9 0h-3M9 0h3M-6.4-6.4l-2.1-2.1M6.4 6.4l2.1 2.1M-6.4 6.4l-2.1 2.1M6.4-6.4l2.1-2.1'/></g><g id='carton'><path d='M-6-3V9H6V-3L0-9Z'/><path d='M-6-3H6M0-9V-3'/></g><g id='meter'><rect x='-8' y='-10' width='16' height='20' rx='3'/><rect x='-5' y='-7' width='10' height='7' rx='1.5'/><circle cx='0' cy='5' r='2'/></g><g id='drop'><path d='M0-10C0-10-8-1-8 4a8 8 0 0 0 16 0C8-1 0-10 0-10Z'/><path d='M-3 4a3 3 0 0 0 3 3'/></g><g id='fork'><path d='M-5-10V-3a3 3 0 0 0 3 3h0a3 3 0 0 0 3-3V-10M-2-10V-3M-2 0V11'/></g><g id='egg'><path d='M0-10C6-10 8-1 8 3a8 7 0 0 1-16 0C-8-1-6-10 0-10Z'/></g><g id='pen'><rect x='-3.5' y='-11' width='7' height='17' rx='2'/><path d='M-3.5-5h7M0 6v5'/></g><g id='moon'><path d='M4-9A9 9 0 1 0 9 4 7 7 0 0 1 4-9Z'/></g><g id='bolt'><path d='M2-10-6 2H0L-2 10 6-2H0Z'/></g><g id='glass'><path d='M-6-9H6L5 9H-5Z'/><path d='M-5.6-2H5.6'/></g><g id='clock'><circle r='9'/><path d='M0-5V0l4 3'/></g><g id='heart'><path d='M0 8C-12-1-7-9 0-4 7-9 12-1 0 8Z'/></g><g id='cookie'><circle r='9'/><circle cx='-3' cy='-3' r='1.2'/><circle cx='3' cy='-1' r='1.2'/><circle cx='-1' cy='4' r='1.2'/><circle cx='4' cy='5' r='1'/></g><g id='star'><path d='M0-9 2.6-3 9-2.5 4 2 5.5 9 0 5.5-5.5 9-4 2-9-2.5-2.6-3Z'/></g><g id='sparkle'><path d='M0-8 2-2 8 0 2 2 0 8-2 2-8 0-2-2Z'/></g><g id='plus'><path d='M0-5v10M-5 0h10'/></g><g id='ring'><circle r='3.4'/></g><g id='dot'><circle r='2.4'/></g>`;
export const BIG = ["cup", "apple", "carrot", "banana", "leaf", "bread", "strawberry", "cherry", "pill", "cloud", "sun", "carton", "meter", "drop", "fork", "egg", "pen", "moon", "bolt", "glass", "clock", "heart", "cookie", "star"];
export const SMALL = ["sparkle", "plus", "ring", "dot"];
const SMALL_PICK = ["sparkle", "plus", "plus", "ring", "ring", "dot", "dot", "dot"];

/** Same size choices as the old tile (Small / Medium / Large), as the width in px of the 360-unit design square. */
export function doodleScale(width, size) {
  const clamp = (lo, v, hi) => Math.min(hi, Math.max(lo, v));
  const tile = size === "large" ? clamp(320, 260 + 0.14 * width, 520) : size === "medium" ? clamp(220, 190 + 0.08 * width, 300) : clamp(150, 130 + 0.04 * width, 200);
  return tile / 360;
}

/** A small deterministic hash -> [0,1). Same inputs, same number, on every device. */
export function rnd(x, y, salt) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(salt | 0, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return ((h >>> 0) % 1000003) / 1000003;
}

const fmt = n => Math.round(n * 10) / 10;

/** The doodles for a width x height screen: [{ id, x, y, rot, scale }], one big drawing and one small mark per cell. */
export function layoutField(width, height, size = "small") {
  const k = doodleScale(width, size);
  let g = 360 * k * Math.sqrt(2 / 71);   // the old tile held ~71 doodles per 360 units: here, a drawing and a mark per cell
  const cap = 4500;                         // keep very large screens light: never more than ~4500 cells
  g = Math.max(g, Math.sqrt((width * height) / cap));
  const cols = Math.ceil(width / g) + 1, rows = Math.ceil(height / g) + 1;
  const pickBig = (cx, cy) => Math.floor(rnd(cx, cy, 1) * BIG.length);
  const items = [];
  for (let cy = -1; cy < rows; cy++) {
    for (let cx = -1; cx < cols; cx++) {
      let b = pickBig(cx, cy), tries = 0;
      while ((b === pickBig(cx - 1, cy) || b === pickBig(cx, cy - 1)) && tries++ < 6) b = (b + 1 + Math.floor(rnd(cx, cy, 10 + tries) * 5)) % BIG.length;
      const ox = (rnd(cx, cy, 2) - 0.5) * 0.45, oy = (rnd(cx, cy, 3) - 0.5) * 0.45;
      items.push({ id: BIG[b], x: (cx + 0.3 + ox) * g, y: (cy + 0.3 + oy) * g, rot: (rnd(cx, cy, 4) - 0.5) * 80, scale: k * (1 + rnd(cx, cy, 5) * 0.34) });
      const s = SMALL_PICK[Math.floor(rnd(cx, cy, 6) * SMALL_PICK.length)];
      items.push({ id: s, x: (cx + 0.78 + (rnd(cx, cy, 7) - 0.5) * 0.3) * g, y: (cy + 0.78 + (rnd(cx, cy, 8) - 0.5) * 0.3) * g, rot: s === "plus" || s === "ring" || s === "dot" ? 0 : (rnd(cx, cy, 9) - 0.5) * 60, scale: k * (s === "sparkle" ? 0.6 + rnd(cx, cy, 11) * 0.45 : 1) });
    }
  }
  return items.filter(i => i.x > -20 * k * 1.4 && i.y > -20 * k * 1.4 && i.x < width + 20 * k * 1.4 && i.y < height + 20 * k * 1.4);
}

/** The SVG markup (no colour: it draws in the surrounding `color`, and the page sets that and the opacity). */
export function fieldSvg(width, height, size = "small") {
  const uses = layoutField(width, height, size).map(i => `<use href="#${i.id}" transform="translate(${fmt(i.x)} ${fmt(i.y)})${i.rot ? ` rotate(${fmt(i.rot)})` : ""} scale(${Math.round(i.scale * 1000) / 1000})"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true"><defs>${GLYPHS}</defs><g fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">${uses}</g></svg>`;
}
