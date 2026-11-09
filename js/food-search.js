// Food name search (2.100.1). Accents and case don't matter, and common foods are found in English or Italian: his library
// mixes both ("Vino Bianco e Rosso" must come up for "wine", "Pane comune" for "bread"). Every word typed has to match; a
// word matches a name directly, or through its group of translations. Words of 3+ letters also match as the start of a
// translation, so the list already narrows while "win" is being typed. Pure functions only.

const fold = s => String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Each group: words that mean the same food. Singular and plural forms are listed where they differ.
export const FOOD_SYNONYMS = [
  ["wine", "vino", "vini"], ["red wine", "vino rosso"], ["white wine", "vino bianco"], ["prosecco", "spumante", "sparkling"],
  ["beer", "birra"], ["coffee", "caffe", "espresso"], ["milk", "latte"], ["water", "acqua"],
  ["juice", "succo", "spremuta"], ["bread", "pane", "panino", "panini", "roll", "sandwich"], ["toast", "pane tostato", "fette biscottate"],
  ["pasta", "spaghetti", "penne", "fusilli", "rigatoni", "tagliatelle", "linguine"], ["rice", "riso", "risotto"],
  ["pizza", "pizze"], ["potato", "potatoes", "patata", "patate", "chips", "fries"], ["flour", "farina"],
  ["cheese", "formaggio", "formaggi", "parmigiano", "mozzarella", "ricotta"], ["butter", "burro"], ["egg", "eggs", "uovo", "uova"],
  ["yogurt", "yoghurt", "yogurth"], ["cream", "panna"], ["ice cream", "gelato", "gelati"],
  ["chicken", "pollo"], ["beef", "manzo", "carne"], ["pork", "maiale"], ["ham", "prosciutto"], ["fish", "pesce"], ["salmon", "salmone"], ["tuna", "tonno"],
  ["apple", "apples", "mela", "mele"], ["pear", "pears", "pera", "pere"], ["orange", "oranges", "arancia", "arance"], ["lemon", "limone"],
  ["peach", "pesca", "pesche"], ["grape", "grapes", "uva"], ["strawberry", "strawberries", "fragola", "fragole"], ["cherry", "cherries", "ciliegia", "ciliegie"],
  ["banana", "banane"], ["melon", "melone"], ["watermelon", "anguria", "cocomero"], ["fig", "figs", "fico", "fichi"], ["apricot", "albicocca", "albicocche"],
  ["tomato", "tomatoes", "pomodoro", "pomodori"], ["salad", "insalata"], ["beans", "fagioli"], ["peas", "piselli"], ["lentils", "lenticchie"],
  ["chickpeas", "ceci"], ["corn", "mais"], ["carrot", "carrots", "carota", "carote"], ["onion", "cipolla"], ["mushroom", "mushrooms", "funghi"],
  ["vegetables", "verdure", "verdura"], ["soup", "zuppa", "minestra", "minestrone"],
  ["biscuit", "biscuits", "cookie", "cookies", "biscotto", "biscotti"], ["cake", "torta", "dolce"], ["chocolate", "cioccolato", "cioccolata"],
  ["croissant", "cornetto", "brioche"], ["jam", "marmellata", "confettura"], ["honey", "miele"], ["sugar", "zucchero"],
  ["nuts", "noci", "frutta secca"], ["almonds", "mandorle"], ["hazelnuts", "nocciole"], ["cereal", "cereals", "cereali"], ["oats", "avena"],
  ["oil", "olio"], ["olive", "oliva", "olive"], ["sauce", "sugo", "salsa"], ["sweets", "caramelle", "candy"]
].map(g => g.map(fold));

const WORD_GROUPS = new Map();   // every single word -> the groups it belongs to
for (const g of FOOD_SYNONYMS) for (const term of g) for (const w of term.split(" ")) {
  if (!WORD_GROUPS.has(w)) WORD_GROUPS.set(w, new Set());
  WORD_GROUPS.get(w).add(g);
}

/** The groups a typed word stands for: exact words, and (3+ letters) words starting with it. */
function groupsFor(word) {
  const out = new Set(WORD_GROUPS.get(word) || []);
  if (word.length >= 3) for (const [w, gs] of WORD_GROUPS) if (w.startsWith(word)) gs.forEach(g => out.add(g));
  return out;
}

/** Does a food name match what was typed? Empty query matches everything. */
export function foodNameMatches(name, query) {
  const n = fold(name), q = fold(query).trim();
  if (!q) return true;
  if (n.includes(q)) return true;
  const words = q.split(/\s+/).filter(Boolean);
  return words.every(w => {
    if (n.includes(w)) return true;
    for (const g of groupsFor(w)) if (g.some(term => (" " + n + " ").includes(" " + term) || n.includes(term) && term.length >= 4)) return true;
    return false;
  });
}
