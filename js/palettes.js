// The colour themes offered in Settings > General. Colours live in design/tokens.json (Apple's iOS system colours since
// 2.55.0); this file only names them and maps themes from older versions onto the nearest current one, so a saved or
// synced setting from an old device never leaves the app without accent colours.

export const DEFAULT_PALETTE = "blueIndigo";

// Each card shows the theme's two working colours -- colour 1 (buttons, switches, charts) and colour 2 (where the dose
// card fades to) -- read straight from the design tokens via data-swatch, so the card can never drift from the real theme.
export const PALETTES = [
  { id: "blueIndigo", name: "Blue & Indigo" },
  { id: "indigoPurple", name: "Indigo & Purple" },
  { id: "purplePink", name: "Purple & Pink" },
  { id: "blueTeal", name: "Blue & Teal" },
  { id: "indigoCyan", name: "Indigo & Cyan" }
];

// Themes before 2.55.0. Green and orange themes are gone on purpose: those colours now mean glucose in range / high,
// so a theme should never look like a warning.
const RETIRED = {
  tealViolet: "blueTeal",
  blueViolet: "blueIndigo",
  emeraldRose: "purplePink",
  orangePink: "purplePink",
  cyanIndigo: "indigoCyan",
  greenAmber: "blueTeal"
};

export function paletteId(id) {
  if (PALETTES.some(p => p.id === id)) return id;
  return RETIRED[id] || DEFAULT_PALETTE;
}

// Ratio colours (time and activity ranges) carry white labels, so they use Apple's higher-contrast system colours:
// mint, yellow, indigo, red, pink, cyan.
export const RATIO_COLOURS = ["#0C817B", "#B25000", "#6155F5", "#D70015", "#D30F45", "#0071A4"];
const OLD_RATIO_COLOURS = { "#1F9E93": 0, "#D6A419": 1, "#6366F1": 2, "#D9534F": 3, "#EC4899": 4, "#22B8CE": 5 };

// Ranges saved before 2.55.0 keep their old preset colours; swap each one for its iOS twin. Only the six presets are
// touched; returns true if anything changed.
export function refreshRatioColours(settings) {
  let changed = false;
  for (const list of [settings && settings.timeRatios, settings && settings.activityRatios]) {
    if (!Array.isArray(list)) continue;
    for (const r of list) {
      const i = r && typeof r.color === "string" ? OLD_RATIO_COLOURS[r.color.toUpperCase()] : undefined;
      if (i !== undefined) { r.color = RATIO_COLOURS[i]; changed = true; }
    }
  }
  return changed;
}
