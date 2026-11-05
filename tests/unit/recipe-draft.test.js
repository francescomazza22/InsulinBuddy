// Recipe autosave (2.84.0): what counts as a complete recipe, change detection and the stored draft.
import test from "node:test";
import assert from "node:assert/strict";
import { readRecipeForm, recipeFingerprint, formHasContent, parseRecipeDraft, RECIPE_DRAFT_TTL } from "../../js/recipe-draft.js";

const form = (o = {}) => ({ name: "Lasagne", category: "pasta", notes: "", favorite: false, rawText: "", finalText: "1200", slicesText: "", ...o });
const items = [{ foodId: "f1", name: "Pasta", grams: 250, carbsPer100g: 70, kcalPer100g: 350 }, { foodId: "f2", name: "Ragù", grams: 600, carbsPer100g: 5, kcalPer100g: 120 }];

test("a complete recipe reads into the same shape the Save button used to store", () => {
  const { payload, problem } = readRecipeForm(form({ rawText: "850", slicesText: "8", favorite: true }), items);
  assert.equal(problem, null);
  assert.deepEqual(payload, { name: "Lasagne", category: "pasta", notes: "", favorite: true, items, rawWeight: 850, slices: 8, finalWeight: 1200 });
  assert.notEqual(payload.items, items, "items are copied, so later typing can't change a saved recipe behind its back");
  assert.equal(readRecipeForm(form({ finalText: "1200,5" }), items).payload.finalWeight, 1200.5, "decimal comma");
});

test("an incomplete recipe says why, and is never a payload", () => {
  const cases = [
    [form({ name: " " }), items, /name/],
    [form(), [], /ingredient/],
    [form(), [{ ...items[0], grams: 0 }], /grams/],
    [form({ slicesText: "2.5" }), items, /Slices/],
    [form({ rawText: "abc" }), items, /Raw Weight/],
    [form({ finalText: "" }), items, /Final Weight/]
  ];
  for (const [f, i, re] of cases) {
    const r = readRecipeForm(f, i);
    assert.equal(r.payload, null); assert.match(r.problem, re);
  }
});

test("fingerprint: the same recipe matches, any edited field doesn't", () => {
  const a = readRecipeForm(form(), items).payload;
  const stored = { id: "recipe-1", usageCount: 4, ...a };
  assert.equal(recipeFingerprint(stored), recipeFingerprint(a), "id and usage don't count");
  assert.notEqual(recipeFingerprint(a), recipeFingerprint({ ...a, items: [{ ...items[0], grams: 260 }, items[1]] }));
  assert.notEqual(recipeFingerprint(a), recipeFingerprint({ ...a, finalWeight: 1100 }));
});

test("formHasContent ignores an untouched new sheet", () => {
  assert.equal(formHasContent({ name: "", notes: "", rawText: "", finalText: "", slicesText: "" }, []), false);
  assert.equal(formHasContent({ name: "", finalText: "900" }, []), true);
  assert.equal(formHasContent({}, [items[0]]), true);
});

test("a stored draft reads back; broken, old or hostile ones read as none", () => {
  const now = 1_700_000_000_000;
  const d = { recipeId: null, form: form({ finalText: "" }), items, at: now - 1000 };
  const back = parseRecipeDraft(JSON.stringify(d), now);
  assert.equal(back.recipeId, null); assert.equal(back.form.name, "Lasagne"); assert.equal(back.items.length, 2);
  assert.equal(parseRecipeDraft("{", now), null);
  assert.equal(parseRecipeDraft(JSON.stringify({ ...d, at: now - RECIPE_DRAFT_TTL - 1 }), now), null);
  assert.equal(parseRecipeDraft(JSON.stringify({ ...d, items: "x" }), now), null);
  const odd = parseRecipeDraft(JSON.stringify({ ...d, items: [null, { name: "Salt", grams: "-3" }, 7] }), now);
  assert.deepEqual(odd.items.map(i => [i.name, i.grams]), [["Salt", 0]]);
});
