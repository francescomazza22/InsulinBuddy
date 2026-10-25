// The colour themes offered in Settings > General. Colours live in design/tokens.json (Apple's iOS system colours since
// 2.55.0); this file only names them and maps themes from older versions onto the nearest current one, so a saved or
// synced setting from an old device never leaves the app without accent colours.

export const DEFAULT_PALETTE = "blueIndigo";

// Each card shows the theme's two working colours -- colour 1 (buttons, switches, charts) and colour 2 (where the dose
// card fades to) -- read straight from the design tokens via data-swatch, so the card can never drift from the real theme.
export const PALETTES = [
  { id: "redOrange", name: "Red & Orange" },
  { id: "orangeYellow", name: "Orange & Yellow" },
  { id: "greenMint", name: "Green & Mint" },
  { id: "tealCyan", name: "Teal & Cyan" },
  { id: "blueIndigo", name: "Blue & Indigo" },
  { id: "purplePink", name: "Purple & Pink" }
];

// Themes from older versions, mapped to the closest current one.
const RETIRED = {
  tealViolet: "tealCyan",
  blueViolet: "blueIndigo",
  emeraldRose: "greenMint",
  orangePink: "orangeYellow",
  cyanIndigo: "tealCyan",
  greenAmber: "greenMint",
  indigoPurple: "purplePink",   // 2.55.0
  blueTeal: "tealCyan",         // 2.55.0
  indigoCyan: "blueIndigo"      // 2.55.0
};

export function paletteId(id) {
  if (PALETTES.some(p => p.id === id)) return id;
  return RETIRED[id] || DEFAULT_PALETTE;
}

// Ratio colours (time and activity ranges) carry white labels, so they use Apple's higher-contrast system colours, one
// clearly different hue each: orange, green, purple, blue, pink, brown.
export const RATIO_COLOURS = ["#C93400", "#248A3D", "#8944AB", "#0064D2", "#D30F45", "#7F6545"];
// Preset colours from earlier versions, by slot: before 2.55.0, then 2.55.0's (too alike).
const OLD_RATIO_COLOURS = {
  "#1F9E93": 0, "#D6A419": 1, "#6366F1": 2, "#D9534F": 3, "#EC4899": 4, "#22B8CE": 5,
  "#0C817B": 0, "#B25000": 1, "#6155F5": 2, "#D70015": 3, "#0071A4": 5
};

// Ranges saved with an old preset colour get the current colour for the same slot. Only presets are touched (custom
// colours are left alone); returns true if anything changed.
export function refreshRatioColours(settings) {
  let changed = false;
  for (const list of [settings && settings.timeRatios, settings && settings.activityRatios]) {
    if (!Array.isArray(list)) continue;
    for (const r of list) {
      const i = r && typeof r.color === "string" ? OLD_RATIO_COLOURS[r.color.toUpperCase()] : undefined;
      if (i !== undefined && r.color.toUpperCase() !== RATIO_COLOURS[i]) { r.color = RATIO_COLOURS[i]; changed = true; }
    }
  }
  return changed;
}
