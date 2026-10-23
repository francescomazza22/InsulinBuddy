// Turns design/tokens.json into tokens.css (web) and design/DesignTokens.swift (iOS).
// Run: node tools/make-tokens.mjs        Check only: node tools/make-tokens.mjs --check
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export function buildTokens(t) {
  const hexToRgb = h => { const n = parseInt(h.slice(1), 16); return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`; };
  const decl = (obj, prefix = "") => Object.entries(obj).map(([k, v]) => `  --${prefix}${k}: ${v};`).join("\n");
  const def = t.palette.set[t.palette.default];
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
${decl(rem(t.type.size), "fs-")}
${decl(t.motion, "motion-")}

  /* palette accents: overridden per data-palette */
${decl(def)}
  --acc-1-rgb: ${hexToRgb(def["acc-1"])};

  /* Liquid Glass */
${decl(t.glass.light, "glass-")}
  --glass-blur: ${t.glass.blur};
}

/* ---------- Palettes ---------- */
${Object.entries(t.palette.set).map(([n, p]) => `html[data-palette="${n}"], [data-swatch="${n}"] { --acc-1:${p["acc-1"]}; --acc-2:${p["acc-2"]}; --acc-3:${p["acc-3"]}; --acc-1-rgb: ${hexToRgb(p["acc-1"])}; }`).join("\n")}

/* ---------- Dark mode ---------- */
html[data-theme="dark"] {
${decl(t.color.dark)}
  --app-bg: var(--paper);
${decl(t.glass.dark, "glass-")}
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
${Object.entries(t.palette.set).map(([n, p]) => `        static let ${lower(n)} = (acc1: ${hex(p["acc-1"])}, acc2: ${hex(p["acc-2"])}, acc3: ${hex(p["acc-3"])})`).join("\n")}
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
