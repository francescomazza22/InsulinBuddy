// Turns design/tokens.json into tokens.css (web) and design/DesignTokens.swift (iOS).
// Run: node tools/make-tokens.mjs        Check only: node tools/make-tokens.mjs --check
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readableAccents, contrast, rgbToHex, hexToRgb } from "./contrast-colours.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export function buildTokens(t) {
  const rgbCsv = h => hexToRgb(h).join(",");
  const decl = (obj, prefix = "") => Object.entries(obj).map(([k, v]) => `  --${prefix}${k}: ${v};`).join("\n");
  const def = t.palette.set[t.palette.default];
  // Each palette carries light accents (acc-1..3) and dark-mode twins (acc-1-dark, acc-2-dark): Apple's system colours
  // shift brighter on black, so a theme swaps to its own dark pair when dark mode is on.
  // Day mode shows each theme's designed colours exactly (Francesco, 2.68.8: he preferred them to the deepened 2.68.7 set).
  // Night mode starts from the SAME day colours (not Apple's brighter night variants, which made the dose card unreadable)
  // and only changes their lightness (tools/contrast-colours.mjs): darker for the dose card and filled controls so white text
  // reads (--card-1/--card-2, --acc-fill), lighter only where the accent is text on the black page (--acc-1).
  const PAGES_DARK = [t.color.dark.paper, t.color.dark.surface, "#2C2C2E"];
  const mixHex = (a, b, w) => rgbToHex(hexToRgb(a).map((v, i) => Math.round(v * (1 - w) + hexToRgb(b)[i] * w)));
  const readable = (p, mode) => {
    const a1 = p["acc-1"], a2 = p["acc-2"];
    if (mode !== "dark") return { text: a1, a2, fill: a1, onAcc: "#FFFFFF", card1: a1, card2: a2 };
    const cardA2 = p["card-mix"] ? mixHex(a2, a1, p["card-mix"]) : a2;
    const r = readableAccents({ a1, a2: cardA2, pages: PAGES_DARK, mode: "dark", sheen: 0.06, cardRatio: 5.5 });
    if (contrast("#FFFFFF", r.fill) < 4.5) throw new Error(`white text unreadable on ${r.fill}`);
    return { text: r.text, a2, fill: r.fill, onAcc: "#FFFFFF", card1: r.card1, card2: r.card2 };
  };
  const accents = (p, mode) => { const r = readable(p, mode); return `--acc-1:${r.text}; --acc-2:${r.a2}; --acc-3:${r.text}; --acc-1-rgb: ${rgbCsv(r.text)}; --acc-fill:${r.fill}; --on-acc:${r.onAcc}; --card-1:${r.card1}; --card-2:${r.card2};`; };
  const px = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v + "px"]));
  const rem = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v + "rem"]));

  const css = `/* GENERATED from design/tokens.json by tools/make-tokens.mjs. Do not edit by hand: change the JSON and run the tool. */
:root {
  /* colour */
${decl(t.color.light)}
  --app-bg: var(--paper);

  /* shape, spacing, type, motion */
${decl(px(t.radius), "radius-")}
${decl(px(t.space), "space-")}
  --font-ui: ${t.type.family.ui};
  --font-display: ${t.type.family.display};
  /* Text follows the iPhone's text size (Dynamic Type, see the end of this file); --rem is 16px everywhere else. */
  --rem: 1rem;
${Object.entries(t.type.size).map(([k, v]) => `  --fs-${k}: calc(${v} * var(--rem));`).join("\n")}
${decl(t.motion, "motion-")}

  /* palette accents: overridden per data-palette */
  ${accents(def, "light")}

  /* Liquid Glass */
${decl(t.glass.light, "glass-")}
  --glass-blur: ${t.glass.blur};
}

/* ---------- Palettes ---------- */
${Object.entries(t.palette.set).filter(([n]) => !n.startsWith("_")).map(([n, p]) => `html[data-palette="${n}"], [data-swatch="${n}"] { ${accents(p, "light")} }`).join("\n")}
${Object.entries(t.palette.set).filter(([n]) => !n.startsWith("_")).map(([n, p]) => `html[data-theme="dark"][data-palette="${n}"], html[data-theme="dark"] [data-swatch="${n}"] { ${accents(p, "dark")} }`).join("\n")}

/* ---------- Dark mode ---------- */
html[data-theme="dark"] {
${decl(t.color.dark)}
  --app-bg: var(--paper);
${decl(t.glass.dark, "glass-")}
  ${accents(def, "dark")}
}

/* ---------- Increase Contrast (iOS Settings > Accessibility) ---------- */
@media (prefers-contrast: more) {
  :root {
${decl(t.contrast.light).replace(/^/gm, "  ")}
  }
  html[data-theme="dark"] {
${decl(t.contrast.dark).replace(/^/gm, "  ")}
  }
}

/* ---------- Dynamic Type: iPhone and iPad only ----------
   -apple-system-body is the iPhone's chosen text size (17px at the default setting). Every text size is written as a
   multiple of --rem, scaled so the default setting looks exactly as before (17px x 16/17 = 16px) and capped at 140% so
   the largest accessibility sizes can't break the layout. Mac Safari also knows the font but reports 13px, so the
   block is limited to touch Safari (-webkit-touch-callout exists only on iOS). Spacing stays in px and never changes. */
@supports (font: -apple-system-body) and (-webkit-touch-callout: none) {
  html { font: -apple-system-body; font-family: var(--font-ui); line-height: normal; --rem: min(calc(1rem * 16 / 17), 22.4px); }
  body { font-size: var(--rem); }   /* text with no size of its own inherits 16px at the default setting, as before */
}
`;

  const cap = s => s.replace(/(^|-)(\w)/g, (_, __, c) => c.toUpperCase());
  const lower = s => { const c = cap(s); return c[0].toLowerCase() + c.slice(1); };
  const swiftName = s => lower(/^\d/.test(s) ? "n" + s : s);
  const pts = r => Math.round(r * 16 * 10) / 10;
  const hex = h => `Color(hex: 0x${h.slice(1).toUpperCase()})`;
  const colors = (o, indent) => Object.entries(o).map(([k, v]) => `${indent}static let ${swiftName(k)} = ${hex(v)}`).join("\n");

  const swift = `// GENERATED from design/tokens.json by tools/make-tokens.mjs. Do not edit by hand.
// The native iOS app gets real Liquid Glass from the system, so the web glass recipe is deliberately not exported.
import SwiftUI

enum IBTokens {
    enum Light {
${colors(t.color.light, "        ")}
    }
    enum Dark {
${colors(t.color.dark, "        ")}
    }
    enum Palette {
${Object.entries(t.palette.set).map(([n, p]) => `        static let ${lower(n)} = (acc1: ${hex(readable(p, "light").text)}, acc2: ${hex(p["acc-2"])}, acc3: ${hex(readable(p, "light").text)}, acc1Dark: ${hex(readable(p, "dark").text)}, acc2Dark: ${hex(p["acc-2-dark"])}, fill: ${hex(readable(p, "light").fill)}, fillDark: ${hex(readable(p, "dark").fill)}, card1: ${hex(readable(p, "light").card1)}, card2: ${hex(readable(p, "light").card2)}, card1Dark: ${hex(readable(p, "dark").card1)}, card2Dark: ${hex(readable(p, "dark").card2)})`).join("\n")}
        static let \`default\` = ${lower(t.palette.default)}
    }
    enum Radius {
${Object.entries(t.radius).map(([k, v]) => `        static let ${swiftName(k)}: CGFloat = ${v}`).join("\n")}
    }
    enum Space {
${Object.entries(t.space).map(([k, v]) => `        static let ${swiftName(k)}: CGFloat = ${v}`).join("\n")}
    }
    /// Point sizes at the web's 16px base (1rem = 16pt).
    enum FontSize {
${Object.entries(t.type.size).map(([k, v]) => `        static let ${swiftName(k)}: CGFloat = ${pts(v)}`).join("\n")}
    }
    enum Motion {
        static let fast = ${parseFloat(t.motion.fast) / 1000}
        static let base = ${parseFloat(t.motion.base) / 1000}
    }
}

extension Color {
    init(hex: UInt32) {
        self.init(.sRGB, red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255, blue: Double(hex & 0xFF) / 255, opacity: 1)
    }
}
`;
  return { css, swift };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const t = JSON.parse(fs.readFileSync(path.join(ROOT, "design/tokens.json"), "utf8"));
  const { css, swift } = buildTokens(t);
  const files = { "tokens.css": css, "design/DesignTokens.swift": swift };
  if (process.argv.includes("--check")) {
    let bad = 0;
    for (const [f, body] of Object.entries(files)) if (fs.readFileSync(path.join(ROOT, f), "utf8") !== body) { console.error(`${f} is out of date: run node tools/make-tokens.mjs`); bad++; }
    process.exit(bad ? 1 : 0);
  }
  for (const [f, body] of Object.entries(files)) { fs.writeFileSync(path.join(ROOT, f), body); console.log("wrote", f); }
}
