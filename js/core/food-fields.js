// Small rules for food fields (2.86.0). Pure: used by the food sheet, the library file import and the tests.

/** Where a food's figures come from. "" = not said (stored as null). */
export const FOOD_SOURCES = [
  { id: "", label: "Not said" },
  { id: "label", label: "Pack label" },
  { id: "estimate", label: "Estimate (typical value)" }
];

/** "label" / "estimate", else null. Accepts the words people might type in a spreadsheet. */
export function foodSource(v) {
  const t = String(v ?? "").trim().toLowerCase();
  if (t === "label" || t === "pack label" || t === "etichetta") return "label";
  if (t === "estimate" || t === "estimated" || t === "stima") return "estimate";
  return null;
}

/** A unit is a name, not an amount: "1 bag" → "bag", "  slice " → "slice". Anything else is kept as typed. */
export function cleanUnitLabel(v) {
  return String(v ?? "").trim().replace(/^1\s+(?=\S)/, "").trim();
}
