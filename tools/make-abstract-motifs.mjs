// Cuts the Abstract artwork (tools/abstract-source.svg) into its separate shapes, so the page can scatter them across the
// whole screen without ever repeating (js/abstract-field.js), instead of tiling one 300 x 300 picture.
//   node tools/make-abstract-motifs.mjs      -> writes js/abstract-motifs.js   (tests/unit/abstract-field.test.js fails if it is out of date)
// Each coloured blob is one shape together with the black linework drawn on it; linework with no blob under it is grouped by
// closeness into small accents (dots, zigzags, loops, ticks). Black becomes class "l" so the page can colour and fade it.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TILE = 300;
const num = d => (d.match(/-?\d+\.?\d*/g) || []).map(Number);
function bbox(d, tf) {
  const n = num(d), xs = [], ys = [];
  for (let i = 0; i + 1 < n.length; i += 2) { xs.push(n[i]); ys.push(n[i + 1]); }
  const [tx, ty] = tf || [0, 0];
  return [Math.min(...xs) + tx, Math.min(...ys) + ty, Math.max(...xs) + tx, Math.max(...ys) + ty];
}

export function parsePaths(source) {
  const out = [];
  const re = /<path\b([^>]*?)\/>/g;
  let m;
  while ((m = re.exec(source))) {
    const a = m[1];
    const d = /\sd="([^"]+)"/.exec(a)?.[1];
    if (!d) continue;
    const fill = /\sfill="([^"]+)"/.exec(a)?.[1] ?? "none";
    const stroke = /\sstroke="([^"]+)"/.exec(a)?.[1] ?? null;
    const sw = /\sstroke-width="([^"]+)"/.exec(a)?.[1] ?? null;
    const t = /transform="matrix\(1, 0, 0, 1, ([-\d.]+), ([-\d.]+)\)"/.exec(a);
    out.push({ d, fill, stroke, sw, tf: t ? [+t[1], +t[2]] : null });
  }
  return out;
}

export function buildMotifs(source) {
  const all = parsePaths(source).map(p => ({ ...p, bb: bbox(p.d, p.tf) }));
  // the artwork repeats every 300 (shapes crossing an edge appear again on the far side): keep one copy of each
  const seen = new Set(), uniq = [];
  for (const p of all) {
    const k = [p.fill, p.d.length, Math.round(((p.bb[0] % TILE) + TILE) % TILE), Math.round(((p.bb[1] % TILE) + TILE) % TILE), Math.round(p.bb[2] - p.bb[0]), Math.round(p.bb[3] - p.bb[1])].join("|");
    if (seen.has(k)) continue; seen.add(k); uniq.push(p);
  }
  const isBlack = p => p.fill === "#000000";
  const blobs = [], blacks = uniq.filter(isBlack);
  for (const p of uniq) if (!isBlack(p) && p.fill !== "none") {
    if (!blobs.some(b => b.fill === p.fill && Math.round(b.bb[2] - b.bb[0]) === Math.round(p.bb[2] - p.bb[0]) && Math.round(b.bb[3] - b.bb[1]) === Math.round(p.bb[3] - p.bb[1]))) blobs.push(p);
  }
  const curls = uniq.filter(p => p.fill === "none" && p.stroke);
  const groups = blobs.map(b => ({ kind: "big", members: [{ p: b, tx: 0, ty: 0 }] }));
  const free = [];
  for (const k of blacks) {
    let placed = false;
    for (const g of groups) {
      const B = g.members[0].p.bb;
      for (const tx of [-TILE, 0, TILE]) { for (const ty of [-TILE, 0, TILE]) {
        const cx = (k.bb[0] + k.bb[2]) / 2 + tx, cy = (k.bb[1] + k.bb[3]) / 2 + ty;
        if (cx >= B[0] - 3 && cx <= B[2] + 3 && cy >= B[1] - 3 && cy <= B[3] + 3) { g.members.push({ p: k, tx, ty }); placed = true; break; }
      } if (placed) break; }
      if (placed) break;
    }
    if (!placed) free.push(k);
  }
  for (const c of curls) groups.push({ kind: "big", members: [{ p: c, tx: 0, ty: 0 }] });
  // linework with no blob: join pieces that are within 12 units of each other into one accent
  const parent = free.map((_, i) => i);
  const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < free.length; i++) for (let j = i + 1; j < free.length; j++) {
    const a = free[i].bb, b = free[j].bb;
    if (a[0] - 12 <= b[2] && b[0] - 12 <= a[2] && a[1] - 12 <= b[3] && b[1] - 12 <= a[3]) parent[find(i)] = find(j);
  }
  const acc = new Map();
  free.forEach((p, i) => { const r = find(i); if (!acc.has(r)) acc.set(r, []); acc.get(r).push({ p, tx: 0, ty: 0 }); });
  for (const members of acc.values()) groups.push({ kind: "accent", members });

  const motifs = groups.map((g, i) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const { p, tx, ty } of g.members) {
      const sw = p.stroke ? (+p.sw || 0) / 2 : 0;
      x0 = Math.min(x0, p.bb[0] + tx - sw); x1 = Math.max(x1, p.bb[2] + tx + sw);
      const fy0 = TILE - (p.bb[3] + ty) - sw, fy1 = TILE - (p.bb[1] + ty) + sw;   // the artwork is drawn upside down: flip it upright
      y0 = Math.min(y0, fy0); y1 = Math.max(y1, fy1);
    }
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const paths = g.members.map(({ p, tx, ty }) => {
      const t = p.tf ? `translate(${p.tf[0] + tx} ${p.tf[1] + ty})` : (tx || ty ? `translate(${tx} ${ty})` : "");
      const attrs = p.stroke
        ? `fill="none" stroke="${p.stroke}" stroke-width="${p.sw}" stroke-linecap="round" stroke-linejoin="round"`
        : (p.fill === "#000000" ? `class="l"` : `fill="${p.fill}"`);
      return `<path ${attrs}${t ? ` transform="${t}"` : ""} d="${p.d}"/>`;
    }).join("");
    const r = Math.round(Math.max(x1 - x0, y1 - y0) / 2);
    return { id: `m${i}`, kind: g.kind, r, svg: `<g id="m${i}"><g transform="translate(${-Math.round(cx * 10) / 10} ${-Math.round(cy * 10) / 10}) matrix(1 0 0 -1 0 ${TILE})">${paths}</g></g>` };
  });
  return motifs;
}

export function buildModule(source) {
  const motifs = buildMotifs(source);
  return `// GENERATED by tools/make-abstract-motifs.mjs from tools/abstract-source.svg: do not edit by hand.
// The Abstract artwork cut into separate shapes ("big": a coloured blob with its linework; "accent": loose linework).
// r is each shape's rough radius in the artwork's own units (a 300-unit tile held about ten of them).
export const MOTIFS = ${JSON.stringify(motifs.map(({ id, kind, r }) => ({ id, kind, r })))};
export const MOTIF_DEFS = ${JSON.stringify(motifs.map(m => m.svg).join(""))};
`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const out = buildModule(fs.readFileSync(path.join(root, "tools", "abstract-source.svg"), "utf8"));
  fs.writeFileSync(path.join(root, "js", "abstract-motifs.js"), out);
  console.log(`js/abstract-motifs.js: ${(out.length / 1024).toFixed(1)} KB`);
}
