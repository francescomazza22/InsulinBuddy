// Typical values used to fill BLANKS in a food library (never to overwrite anything already entered).
//   gi:      glycaemic index (glucose = 100). Only filled where there is a published value for the food or a very close equivalent.
//            [value, "H"] = published for this food; [value, "M"] = published for a close equivalent / typical for the type.
//            Foods with almost no carbohydrate (meat, fish, eggs, cheese, oils) have no meaningful GI and are left blank on purpose.
//   fat / protein / salt / kcal: typical label values per 100 g (salt = g of salt, not sodium).
// They are estimates from typical products, so the app marks what it filled (GI shows as "~55") and lists it for review.

/** name (lower-case) -> { gi?, fat?, protein?, salt?, kcal? } */
export const FOOD_REFERENCE = {
  "bastoncini findus (fish finger)": { gi: [38, "M"], salt: 0.9 },
  "mela": { protein: 0.3, salt: 0 },
  "succo di limone": { fat: 0.2, protein: 0.4, salt: 0.01 },
  "avocado": { fat: 15, protein: 2, salt: 0.01 },
  "riso integrale": { fat: 2.8, protein: 7.5, salt: 0.01 },
  "pane integrale": { fat: 2.5, protein: 9, salt: 1.0 },
  "passata di pomodoro": { gi: [45, "M"], fat: 0.2, protein: 1.3, salt: 0.1 },
  "tonno in scatola (sott'olio)": { fat: 10, protein: 26, salt: 1.0 },
  "mozzarella": { fat: 22, protein: 18, salt: 0.6 },
  "ricotta": { fat: 10, protein: 8, salt: 0.2 },
  "salmone fresco": { fat: 13, protein: 20, salt: 0.1 },
  "latte d'avena": { gi: [65, "M"], fat: 1.5, protein: 1.0, salt: 0.1 },
  "uova (per single piece)": { fat: 9.5, protein: 12.5, salt: 0.3 },
  "tenerina": { gi: [50, "M"] },
  "orange": { salt: 0 },
  "piselli (frozen)": { salt: 0.01 },
  "barley (orzo) secco": { salt: 0.01 },
  "polenta": { salt: 0.01 },
  "torta di mele": { gi: [50, "M"] },
  "riso nero": { salt: 0.01 },
  "tortelloni tesco": { gi: [50, "M"] },
  "pasta di semola": { salt: 0.01 },
  "ananas": { salt: 0 },
  "butternut squash": { salt: 0.01 },
  "mango": { salt: 0 },
  "lemon": { gi: [20, "M"], salt: 0 },
  "fragole": { salt: 0 },
  "riso cotto": { salt: 0.01 },
  "pane da toast con semi piccolo": { gi: [55, "M"] },
  "nutella": { salt: 0.11 },
  "crostata": { gi: [60, "M"] },
  "corn on cobs": { salt: 0 },
  "ferrero rocher (each)": { gi: [40, "M"] },
  "cornetto algida": { gi: [60, "M"] },
  "colomba bauli": { gi: [65, "M"] },
  "torta di riso": { gi: [55, "M"] },
  "uva": { salt: 0 },
  "apple juice": { salt: 0 },
  "additional sugar": { gi: [65, "H"], fat: 0, protein: 0, salt: 0 },
  "flat white": { gi: [30, "M"] },
  "tortellini": { gi: [50, "M"] },
  "riso": { salt: 0.01 },
  "patate gialle": { salt: 0.01 },
  "zuppa mista secca": { gi: [35, "M"] },
  "vino bianco": { fat: 0, salt: 0.01 },
  "beer lager": { fat: 0 },
  "ciliegie": { salt: 0 },
  "proper chips": { gi: [55, "M"] },
  "zucchero": { gi: [65, "H"], fat: 0, protein: 0, salt: 0 },
  "lindor": { gi: [40, "M"] },
  "torta soffice": { gi: [50, "M"] },
  "miele": { fat: 0, salt: 0.01 },
  "farina": { gi: [70, "M"], salt: 0.01 },
  "banana": { salt: 0 },
  "muffin banana": { gi: [50, "M"] },
  "pesca": { salt: 0 },
  "oat": { salt: 0.01 },
  "pane da toast con semi": { gi: [55, "M"] },
  "macedonia": { gi: [55, "M"], salt: 0 },
  "cioccolata": { gi: [40, "M"] },
  "pear": { salt: 0 },
  "berries": { salt: 0 },
  "sugo al pomodoro": { gi: [45, "M"] },
  "plum cake": { gi: [50, "M"] },
  "olio d’oliva (1 table spoon is 14 grams)": { protein: 0, salt: 0 },
  "quinoa": { salt: 0.01 },
  "cuscus crudo": { fat: 1.5, protein: 12, salt: 0.02 },
  "marmellata": { fat: 0.1, protein: 0.4, salt: 0.02 },
  "dried apricot": { fat: 0.5, protein: 3.4, salt: 0.03 },
  "parmiggiano reggiano": { fat: 28, protein: 33, salt: 1.6 },
  "nutella bisquit": { protein: 6, salt: 0.4 },
  "haribo starmix treat size": { gi: [78, "M"], kcal: 340, fat: 0.1, protein: 6.5, salt: 0.1 },
  "mela secca": { gi: [29, "M"], fat: 0.3 },
  "tortelloni rana": { gi: [50, "M"] },
  "tortelloni sainsbury": { gi: [50, "M"] },
  "croissant": { gi: [67, "H"] },
  "chicken dippers": { gi: [46, "M"] },
  "burger bun": { gi: [61, "M"] },
  "lettuce": { gi: [15, "M"] },
  "tomato": { gi: [15, "H"] },
  "red onion": { gi: [10, "M"] },
  "chips, cooked": { gi: [70, "M"] },
  "tomato ketchup": { gi: [55, "M"] }
};

/** Published GI values for the common foods in the starter library (exact name, any case). Applied once at start-up to a library saved before GI existed. */
export const PUBLISHED_GI = {
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

const blank = v => v === null || v === undefined || v === "" || (typeof v === "number" && !Number.isFinite(v));
const norm = s => String(s || "").trim().toLowerCase().replace(/[’‘`]/g, "'");
const REF_BY_NORM = Object.fromEntries(Object.entries(FOOD_REFERENCE).map(([k, v]) => [norm(k), v]));
// published values count as reference data too, so a food with one is never listed as "could not fill"
for (const [name, gi] of Object.entries(PUBLISHED_GI)) {
  const k = norm(name);
  REF_BY_NORM[k] = { ...(REF_BY_NORM[k] || {}), gi: (REF_BY_NORM[k] && REF_BY_NORM[k].gi) || [gi, "H"] };
}
const PUBLISHED_BY_NORM = Object.fromEntries(Object.entries(PUBLISHED_GI).map(([k, v]) => [norm(k), v]));

/** Sets gi (and only gi) on foods that have none and whose name has a published value. Returns how many changed. Not marked as estimated. */
export function applyPublishedGi(library) {
  let n = 0;
  for (const f of library || []) {
    const v = PUBLISHED_BY_NORM[norm(f.name)];
    if (f.gi == null && v != null) { f.gi = v; n++; }
  }
  return n;
}

/**
 * Fills ONLY empty fields on foods whose name is in the reference. Returns { changes, foodsTouched }, where each change is
 * { id, name, field, value, confidence } and `field` is one of gi | fat | protein | salt | kcal. Mutates the foods it changes
 * (adds them to `estimated`, so the app can mark them) and nothing else. Running it again changes nothing.
 */
export function fillMissingFoodDetails(library, reference = REF_BY_NORM) {
  const changes = [];
  const touched = new Set();
  for (const f of library || []) {
    const ref = reference[norm(f.name)];
    if (!ref) continue;
    for (const field of ["gi", "fat", "protein", "salt", "kcal"]) {
      if (ref[field] === undefined || !blank(f[field])) continue;
      const isGi = field === "gi";
      const value = isGi ? ref.gi[0] : ref[field];
      f[field] = value;
      f.estimated = [...new Set([...(Array.isArray(f.estimated) ? f.estimated : []), field])];
      changes.push({ id: f.id, name: f.name, field, value, confidence: isGi ? ref.gi[1] : "M" });
      touched.add(f.id);
    }
  }
  return { changes, foodsTouched: touched.size };
}

/** Which foods still have a gap this could not fill, and why (for the "left blank" list). */
export function stillBlank(library, reference = REF_BY_NORM) {
  const out = [];
  for (const f of library || []) {
    const ref = reference[norm(f.name)] || {};
    const missing = ["gi", "fat", "protein", "salt", "kcal"].filter(k => blank(f[k]) && ref[k] === undefined);
    if (missing.length) out.push({ id: f.id, name: f.name, missing });
  }
  return out;
}
