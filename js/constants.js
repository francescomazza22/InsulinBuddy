// Fixed lists and defaults: food categories, colour palettes, meal types, the default settings and seed data.
import { iconApple, iconCoffee, iconMoon, iconPulse, iconSun } from "./ui/icons.js";

export const CATEGORIES = [
  { id: "fruits", label: "Fruits" },
  { id: "vegetables", label: "Vegetables" },
  { id: "grains", label: "Grains" },
  { id: "protein", label: "Protein" },
  { id: "dairy", label: "Dairy" },
  { id: "beverages", label: "Beverages" },
  { id: "snacks", label: "Snacks" },
  { id: "other", label: "Other" }
];

export const PALETTES = [
  { id: "tealViolet", name: "Teal & Violet", dots: ["#1F9E93", "#8B5CF6", "#38BDF8"] },
  { id: "blueViolet", name: "Blue & Purple", dots: ["#3B82F6", "#8B5CF6", "#6366F1"] },
  { id: "emeraldRose", name: "Emerald & Rose", dots: ["#10B981", "#F43F5E", "#34D399"] },
  { id: "orangePink", name: "Orange & Pink", dots: ["#F97316", "#EC4899", "#F59E0B"] },
  { id: "cyanIndigo", name: "Cyan & Indigo", dots: ["#22B8CE", "#6366F1", "#3B82F6"] },
  { id: "greenAmber", name: "Green & Amber", dots: ["#22C55E", "#F59E0B", "#84CC16"] }
];

export const MEAL_TYPES = {
  breakfast: { label: "Breakfast", color: "#E8935D", icon: iconCoffee() },
  lunch:     { label: "Lunch",     color: "#D6A419", icon: iconSun() },
  dinner:    { label: "Dinner",    color: "#6B5FD0", icon: iconMoon() },
  snack:     { label: "Snack",     color: "#4C9A6A", icon: iconApple() },
  correction: { label: "Correction", color: "#C0392B", icon: iconPulse() }
};
export const BASAL_COLOR = "#356E9C";

const DEFAULT_TIME_RATIOS = [
  { id: "tr-morning", name: "Morning", start: "05:30", end: "11:00", ratio: 10, color: "#1F9E93" },
  { id: "tr-lunch",   name: "Lunch",   start: "11:00", end: "15:00", ratio: 8,  color: "#D6A419" },
  { id: "tr-evening", name: "Evening", start: "15:00", end: "23:30", ratio: 15, color: "#6366F1" },
  { id: "tr-night",   name: "Night",   start: "23:30", end: "05:30", ratio: 12, color: "#D9534F" }
];
const DEFAULT_ACTIVITY_RATIOS = [
  { id: "ar-sport", name: "Sport", ratio: 18, color: "#8B5CF6" }
];

/** A brand-new install: default settings, the seed food library from foods_data.js, no history. */
export function defaultState() {
  return {
    settings: {
      isf: 50,
      target: 100,
      units: "mgdl",
      rounding: "0.5",
      maxDose: 15,
      timeRatios: structuredClone(DEFAULT_TIME_RATIOS),
      activityRatios: structuredClone(DEFAULT_ACTIVITY_RATIOS),
      palette: "blueViolet",
      darkMode: false,
      darkModeAuto: false,
      showRecentMeals: true,
      backgroundPattern: "none",   // "none" or "doodles": a faint pattern drawn over the background color
      backgroundPatternSize: "small",   // "small" | "medium" | "large": how big the doodles are
      insulinModel: { preset: "rapid", peakMinutes: 75, diaMinutes: 360 },
      carbAbsorptionMinutes: { high: 120, medium: 180, low: 240, unknown: 180 },
      iobAwareCorrection: false,
      nightscoutUrl: "",
      nsFormat: "combined",   // "combined" (one Meal Bolus) or "split" (carbs and insulin separately)
      nsSyncEdits: true,       // also update / delete in Nightscout when a meal is edited / deleted
      customBackground: null
    },
    library: structuredClone(typeof SEED_FOODS !== "undefined" ? SEED_FOODS : []),
    recipes: structuredClone(typeof SEED_RECIPES !== "undefined" ? SEED_RECIPES : []),
    history: []
  };
}

// Settings > General > Background colour swatches.
export const BG_PRESETS = ["#F5F3EE", "#E1EDF7", "#EDE5F5", "#E5EFE7", "#F7E8E6", "#E7E9EC"];

// Settings > Insulin & Carb Timing presets.
export const INSULIN_PRESETS = {
  rapid: { peakMinutes: 75, diaMinutes: 360 },
  fiasp: { peakMinutes: 55, diaMinutes: 360 }
};

// Colours handed to new time ranges and activities, in turn.
export const RANGE_COLORS = ["#1F9E93", "#D6A419", "#6366F1", "#D9534F", "#EC4899", "#22B8CE"];

// Glycemic Index values for the original seed foods, used by applyGiSeedPatch (js/services/store.js) to add a GI to
// matching foods in a library saved before GI existed (seed data in foods_data.js only ever populates a BRAND
// NEW install — it can't retroactively update a library that's already
// sitting in someone's browser). Only ever sets the gi field, never touches
// anything else, and never overwrites a gi value someone's already set.
export const GI_SEED_MAP = {
  "Mela": 36, "Riso Integrale": 68, "Pane Integrale": 74, "Orange": 43, "Piselli (frozen)": 51,
  "Polenta": 68, "Fagioli": 24, "Riso Nero": 42, "Pasta di semola": 53, "Ananas": 59, "Mango": 51,
  "Lenticchie bollite": 32, "Fragole": 40, "Riso Cotto": 73, "Ceci cotti": 28, "Uva": 59,
  "Apple Juice": 41, "Riso": 73, "Patate gialle": 78, "Pane comune": 75, "Pane in cassetta": 75,
  "Ciliegie": 22, "Pasta all'uovo": 49, "Patate dolci": 63, "Latte semiskimmed": 32, "Parsnip": 52,
  "Zucchero": 65, "Additional sugar": 65, "Gnocchi di patate": 68, "Miele": 61, "Banana": 51,
  "Tortilla": 52, "Pesca": 42, "Oat": 55, "Lenticchie cotte": 32, "Lenticchie secche": 32,
  "Piadina": 67, "Pear": 38, "Berries": 40, "Quinoa": 53, "Cuscus crudo": 65,
  "Fette Biscottate (each)": 70, "Marmellata": 49, "Dried apricot": 30, "Ceci secchi": 28,
  "Fagioli secchi": 24, "Croissant (Gails)": 67,
  "Special K": 69, "Wrap": 52, "Gelato": 57, "Hummus": 6, "Peanut Butter": 14,
  "Corn on Cobs": 52, "Butternut squash": 51, "Avocado": 15, "Dry roasted peanuts": 14,
  "Croutons": 70, "Cracker misura": 65, "Pangrattato": 70, "Barley (orzo) secco": 28, "Yogurt": 35
};

// The background patterns on offer. Anything else (a typo, a value from a newer version) means no pattern rather than a broken page.
const BACKGROUND_PATTERNS = ["none", "doodles", "abstract"];
export function backgroundPatternOf(settings) { return BACKGROUND_PATTERNS.includes(settings.backgroundPattern) ? settings.backgroundPattern : "none"; }
