// Builds the two deployable files for the Abstract background pattern from tools/abstract-source.svg:
//   assets/patterns/pattern-abstract-light.svg   assets/patterns/pattern-abstract-dark.svg
//   node tools/make-abstract.mjs        (tests/unit/abstract.test.js fails if the files are out of date)
//
// The artwork is bright and busy, so it is shown as a soft wallpaper: the WHOLE tile is drawn first, exactly as the artist
// made it, and then faded as one group. (Fading shape by shape would double up wherever two pieces overlap and leave darker
// seams; fading the group cannot.) The artwork's black linework would be far too heavy even faded, so it is first turned a
// pale grey chosen so that, after the fade, it lands on the same faint ink the Doodles pattern uses.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// paper / ink are the app's own colours for each theme (see :root and [data-theme="dark"] in style.css)
export const VARIANTS = {
  // The fades are the strongest that still keep text readable: with every artwork colour behind it, over every background
  // colour you can pick, grey labels stay at 3:1 or better in light mode and 4.5:1 in dark mode (tests/unit/abstract.test.js).
  light: { opacity: 0.20, paper: [245, 243, 238], ink: [27, 42, 58],    lineOpacity: 0.09 },
  dark:  { opacity: 0.18, paper: [20, 24, 29],    ink: [236, 234, 227], lineOpacity: 0.075 }
};
const hex = c => "#" + c.map(v => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase();

/** The pale grey that, drawn opaque and then faded by `opacity`, looks like the ink at `lineOpacity` over the paper. */
export function lineGrey(variant) {
  const v = VARIANTS[variant], k = v.lineOpacity / v.opacity;
  return v.paper.map((p, i) => p + k * (v.ink[i] - p));
}

export function buildAbstractSvg(source, variant) {
  const v = VARIANTS[variant];
  const open = source.indexOf(">", source.indexOf("<svg")) + 1;
  // `rest` is everything between the opening <svg> tag and the closing </svg>: that closing tag must come off before the fade
  // group is wrapped around the artwork, or the file ends up with mismatched tags (which a browser refuses to draw at all).
  const head = source.slice(0, open), rest = source.slice(open).replace(/<!--[\s\S]*?-->/g, "").replace(/<\/svg>\s*$/, "").trim();
  const defsEnd = rest.indexOf("</defs>") + "</defs>".length;
  const defs = rest.slice(0, defsEnd), art = rest.slice(defsEnd).replace(/(fill|stroke)="#000000"/g, `$1="${hex(lineGrey(variant))}"`);
  return `${head}\n${defs}\n<g opacity="${v.opacity}">${art}</g>\n</svg>\n`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const source = fs.readFileSync(path.join(root, "tools", "abstract-source.svg"), "utf8");
  for (const variant of Object.keys(VARIANTS)) {
    const out = buildAbstractSvg(source, variant);
    fs.mkdirSync(path.join(root, "assets", "patterns"), { recursive: true });
    fs.writeFileSync(path.join(root, "assets", "patterns", `pattern-abstract-${variant}.svg`), out);
    console.log(`pattern-abstract-${variant}.svg: ${(out.length / 1024).toFixed(1)} KB, lines ${hex(lineGrey(variant))}, faded to ${VARIANTS[variant].opacity * 100}%`);
  }
}
