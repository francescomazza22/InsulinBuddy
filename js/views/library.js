// The Food Library tab: foods and recipes, with search, filters, and the add / edit sheets for each.
import { CATEGORIES } from "../constants.js";
import { recipeTotals } from "../foods.js";
import { saveState, state } from "../services/store.js";
import { dialogs, el } from "../ui/dom.js";
import { createSheet, sheetHeader } from "../ui/sheets.js";
import { showUndoToast } from "../ui/toast.js";
import { escapeAttr, escapeHtml, makeId, round1 } from "../util.js";

let libSeg = "foods"; // 'foods' | 'recipes'
const libSegmented = el("lib-segmented");
const libFoodsList = el("lib-foods-list");
const libRecipesList = el("lib-recipes-list");
const libEmpty = el("lib-empty");
const libSearch = el("lib-search");
const libFilterBtn = el("lib-filter-btn");
const libFilterPanel = el("lib-filter-panel");
const libFavOnly = el("lib-fav-only");
const libCatFilter = el("lib-cat-filter");
const libSort = el("lib-sort");
const libAddBtn = el("lib-add-btn");

function categoryBadge(cat) {
  const c = CATEGORIES.find(x => x.id === cat) || CATEGORIES[CATEGORIES.length - 1];
  return `<span class="lib-item__badge cat-${c.id}">${c.label}</span>`;
}

export function renderLibrary() {
  libFoodsList.hidden = libSeg !== "foods";
  libRecipesList.hidden = libSeg !== "recipes";
  libAddBtn.setAttribute("aria-label", libSeg === "foods" ? "Add food" : "Add recipe");

  if (libSeg === "foods") renderFoodsLibrary(); else renderRecipesLibrary();
}

function renderFoodsLibrary() {
  const q = libSearch.value.trim().toLowerCase();
  let items = state.library.slice();
  if (q) items = items.filter(f => f.name.toLowerCase().includes(q));
  if (libFavOnly.checked) items = items.filter(f => f.favorite);
  if (libCatFilter.value) items = items.filter(f => f.category === libCatFilter.value);
  const sort = libSort.value;
  items.sort((a, b) => {
    if (sort === "usage") return (b.usageCount || 0) - (a.usageCount || 0);
    if (sort === "carbs") return (b.carbs || 0) - (a.carbs || 0);
    return a.name.localeCompare(b.name);
  });

  libFoodsList.innerHTML = "";
  libEmpty.hidden = items.length > 0;
  items.forEach(f => {
    const row = document.createElement("div");
    row.className = "lib-item";
    row.innerHTML = `
      <button class="lib-item__star${f.favorite ? " is-fav" : ""}" data-id="${f.id}" aria-label="Toggle favorite">
        <svg viewBox="0 0 24 24" fill="${f.favorite ? "currentColor" : "none"}"><path d="M12 3.5l2.6 5.6 6 .7-4.4 4.2 1.1 6-5.3-3-5.3 3 1.1-6-4.4-4.2 6-.7z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>
      </button>
      <div class="lib-item__main">
        <p class="lib-item__name">${escapeHtml(f.name)}</p>
        <div class="lib-item__badges">
          ${categoryBadge(f.category)}
          ${f.gi != null ? `<span class="lib-item__badge cat-other">GI ${f.gi}</span>` : ""}
        </div>
        <p class="lib-item__meta"><span class="c-carbs">${f.carbs}g carbs</span>${f.kcal ? ` · <span class="c-kcal">~${f.kcal} kcal</span>` : ""} <span class="lib-item__usage">· ${f.usageCount || 0}×</span></p>
        ${f.unitBased ? `<p class="lib-item__note">1 ${escapeHtml(f.unitLabel)} = ${f.gramsPerUnit}g → ${round1(f.carbs * f.gramsPerUnit / 100)}g carbs</p>` : ""}
        ${f.notes ? `<p class="lib-item__note">${escapeHtml(f.notes)}</p>` : ""}
      </div>
      <div class="lib-item__actions">
        <button data-act="edit" data-id="${f.id}" aria-label="Edit"><svg viewBox="0 0 24 24" fill="none"><path d="M4 20l4-1 11-11-3-3L5 16z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg></button>
        <button data-act="copy" data-id="${f.id}" aria-label="Duplicate"><svg viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M5 15V6a2 2 0 012-2h9" stroke="currentColor" stroke-width="1.6"/></svg></button>
        <button class="danger" data-act="delete" data-id="${f.id}" aria-label="Delete"><svg viewBox="0 0 24 24" fill="none"><path d="M5 7h14M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m-9 0l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      </div>
    `;
    libFoodsList.appendChild(row);
  });
}

function openFoodSheet(food) {
  const isEdit = !!food;
  const f = food || { name: "", category: "other", carbs: "", kcal: "", fat: "", protein: "", salt: "", notes: "", favorite: false, unitBased: false, unitLabel: "", gramsPerUnit: "" };
  const { backdrop, close } = createSheet({
    labelledBy: "fs-title", closeOn: ["#fs-cancel"],
    content: `
      ${sheetHeader(isEdit ? "Edit Food" : "Add New Food", { titleId: "fs-title" })}
      <div class="field">
        <label>Food Name</label>
        <input type="text" id="fs-name" value="${escapeAttr(f.name)}" placeholder="e.g., Brown Rice" autocomplete="off" autocorrect="off">
      </div>

      <div class="field-inline-row">
        <label>Carbs per 100g</label>
        <input type="number" id="fs-carbs" value="${f.carbs ?? ""}" step="0.1" placeholder="e.g., 28">
      </div>
      <div class="field-inline-row">
        <label>Calories per 100g <span class="field__optional">(optional)</span></label>
        <input type="number" id="fs-kcal" value="${f.kcal ?? ""}" step="1" placeholder="e.g., 150">
      </div>
      <div class="field-inline-row">
        <label>Fat per 100g <span class="field__optional">(optional)</span></label>
        <input type="number" id="fs-fat" value="${f.fat ?? ""}" step="0.1" placeholder="e.g., 5">
      </div>
      <div class="field-inline-row">
        <label>Protein per 100g <span class="field__optional">(optional)</span></label>
        <input type="number" id="fs-protein" value="${f.protein ?? ""}" step="0.1" placeholder="e.g., 8">
      </div>
      <div class="field-inline-row">
        <label>Salt per 100g <span class="field__optional">(optional)</span></label>
        <input type="number" id="fs-salt" value="${f.salt ?? ""}" step="0.1" placeholder="e.g., 0.5">
      </div>
      <div class="field-inline-row">
        <label>Glycemic Index <span class="field__optional">(optional)</span></label>
        <input type="number" id="fs-gi" value="${f.gi ?? ""}" step="1" min="0" max="110" placeholder="e.g., 55">
      </div>

      <div class="checkbox-row" style="margin-top:18px;">
        <label><input type="checkbox" id="fs-unit-based" ${f.unitBased ? "checked" : ""}> Log this by quantity, not weight</label>
      </div>
      <p class="panel-card__hint" style="margin:-10px 0 14px;">e.g., "1 sandwich" instead of grams. The nutrition above still applies per 100g — we just need to know how much one whole item weighs.</p>
      <div class="unit-fields" id="fs-unit-fields" ${f.unitBased ? "" : "hidden"}>
        <div class="field-grid" style="margin-bottom:16px;">
          <div class="field" style="margin-bottom:0;"><label>Unit name</label><input type="text" id="fs-unit-label" value="${escapeAttr(f.unitLabel || "")}" placeholder="e.g., sandwich"></div>
          <div class="field" style="margin-bottom:0;"><label>Weight per unit (g)</label><input type="number" id="fs-grams-per-unit" value="${f.gramsPerUnit ?? ""}" step="1" placeholder="e.g., 220"></div>
        </div>
      </div>

      <div class="field">
        <label>Category</label>
        <select id="fs-cat">
          ${CATEGORIES.map(c => `<option value="${c.id}" ${c.id === f.category ? "selected" : ""}>${c.label}</option>`).join("")}
        </select>
      </div>
      <div class="field">
        <label>Notes <span class="field__optional">(optional)</span></label>
        <textarea id="fs-notes" rows="2" placeholder="e.g., High fiber, good for breakfast&hellip;">${escapeHtml(f.notes || "")}</textarea>
      </div>
      <div class="checkbox-row"><label><input type="checkbox" id="fs-fav" ${f.favorite ? "checked" : ""}> Favorite</label></div>
      <div class="sheet-actions">
        <button class="btn btn--secondary" id="fs-cancel" type="button">Cancel</button>
        <button class="btn btn--primary" id="fs-save" type="button">${isEdit ? "Save Changes" : "Add Food"}</button>
      </div>`
  });
  backdrop.querySelector("#fs-unit-based").addEventListener("change", e => {
    backdrop.querySelector("#fs-unit-fields").hidden = !e.target.checked;
  });
  backdrop.querySelector("#fs-save").addEventListener("click", () => {
    const name = backdrop.querySelector("#fs-name").value.trim();
    const carbs = parseFloat(backdrop.querySelector("#fs-carbs").value);
    if (!name || isNaN(carbs)) { dialogs.alert("Please enter at least a name and carbs per 100g.", { title: "Missing details" }); return; }
    const unitBased = backdrop.querySelector("#fs-unit-based").checked;
    const unitLabel = backdrop.querySelector("#fs-unit-label").value.trim();
    const gramsPerUnit = parseFloat(backdrop.querySelector("#fs-grams-per-unit").value);
    if (unitBased && (!unitLabel || !gramsPerUnit || gramsPerUnit <= 0)) {
      dialogs.alert("For a quantity-based food, please give it a unit name and a weight per unit greater than 0.", { title: "Missing details" });
      return;
    }
    const payload = {
      name,
      category: backdrop.querySelector("#fs-cat").value,
      carbs,
      kcal: parseFloat(backdrop.querySelector("#fs-kcal").value) || null,
      fat: parseFloat(backdrop.querySelector("#fs-fat").value) || null,
      protein: parseFloat(backdrop.querySelector("#fs-protein").value) || null,
      salt: parseFloat(backdrop.querySelector("#fs-salt").value) || null,
      gi: parseFloat(backdrop.querySelector("#fs-gi").value) || null,
      notes: backdrop.querySelector("#fs-notes").value.trim(),
      favorite: backdrop.querySelector("#fs-fav").checked,
      unitBased,
      unitLabel: unitBased ? unitLabel : null,
      gramsPerUnit: unitBased ? gramsPerUnit : null
    };
    if (isEdit) Object.assign(f, payload);
    else state.library.unshift({ id: makeId("food"), usageCount: 0, ...payload });
    saveState();
    renderFoodsLibrary();
    close();
  });
}


function renderRecipesLibrary() {
  const q = libSearch.value.trim().toLowerCase();
  let items = state.recipes.slice();
  if (q) items = items.filter(r => r.name.toLowerCase().includes(q));
  if (libFavOnly.checked) items = items.filter(r => r.favorite);
  libRecipesList.innerHTML = "";
  libEmpty.hidden = items.length > 0;
  items.forEach(r => {
    const t = recipeTotals(r, state.library);
    const row = document.createElement("div");
    row.className = "lib-item";
    const perG = t.carbsPer100g != null
      ? `<span class="c-carbs">${t.carbsPer100g}g carbs</span>${t.kcalPer100g ? ` · <span class="c-kcal">~${t.kcalPer100g} kcal</span>` : ""}`
      : `<span style="color:var(--brick);">Set a final weight to use this in the Calculator</span>`;
    row.innerHTML = `
      <button class="lib-item__star${r.favorite ? " is-fav" : ""}" data-id="${r.id}" aria-label="Toggle favorite">
        <svg viewBox="0 0 24 24" fill="${r.favorite ? "currentColor" : "none"}"><path d="M12 3.5l2.6 5.6 6 .7-4.4 4.2 1.1 6-5.3-3-5.3 3 1.1-6-4.4-4.2 6-.7z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>
      </button>
      <div class="lib-item__main">
        <p class="lib-item__name">${escapeHtml(r.name)}</p>
        <div class="lib-item__badges">${categoryBadge(r.category || "other")}</div>
        <p class="lib-item__meta">${perG} <span class="lib-item__usage">· ${r.usageCount || 0}×</span></p>
        <p class="lib-item__note">${r.items.map(it => {
          const name = it.name || (state.library.find(x => x.id === it.foodId) || {}).name;
          return name ? `${name} (${it.grams}g)` : "";
        }).filter(Boolean).join(", ")}${r.finalWeight ? ` — final weight ${r.finalWeight}g` : ""}</p>
      </div>
      <div class="lib-item__actions">
        <button data-act="edit" data-id="${r.id}" aria-label="Edit"><svg viewBox="0 0 24 24" fill="none"><path d="M4 20l4-1 11-11-3-3L5 16z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg></button>
        <button class="danger" data-act="delete" data-id="${r.id}" aria-label="Delete"><svg viewBox="0 0 24 24" fill="none"><path d="M5 7h14M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m-9 0l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      </div>
    `;
    libRecipesList.appendChild(row);
  });
}

function openRecipeSheet(recipe) {
  const isEdit = !!recipe;
  const r = recipe || { name: "", category: "other", notes: "", favorite: false, items: [], rawWeight: null, finalWeight: "" };
  let items = r.items.length ? r.items.map(it => ({ ...it })) : [];
  let ingredientSelection = null; // { foodId, name }

  const { backdrop, close } = createSheet({
    labelledBy: "rs-title", closeOn: ["#rs-cancel", "#rs-back"],
    content: `
      <div class="sheet-head sheet-head--recipe">
        <button class="sheet-back" id="rs-back" type="button" aria-label="Back">
          <svg viewBox="0 0 24 24" fill="none"><path d="M15 5l-7 7 7 7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <span class="sheet-head__icon">
          <svg viewBox="0 0 24 24" fill="none"><path d="M6 10.5c0-2.5 2.5-5 6-5s6 2.5 6 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M4.5 10.5h15L18 20a1.5 1.5 0 01-1.5 1.3h-9A1.5 1.5 0 016 20l-1.5-9.5z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
        </span>
        <h2 id="rs-title">${isEdit ? "Edit Recipe" : "Create Recipe"}</h2>
        <button class="sheet-close" id="rs-close" type="button" aria-label="Close">
          <svg viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        </button>
      </div>

      <div class="field-grid">
        <div class="field"><label>Recipe Name</label><input type="text" id="rs-name" value="${escapeAttr(r.name)}" placeholder="e.g., Chocolate Cake" autocomplete="off" autocorrect="off"></div>
        <div class="field"><label>Category</label>
          <select id="rs-cat">${CATEGORIES.map(c => `<option value="${c.id}" ${c.id === r.category ? "selected" : ""}>${c.label}</option>`).join("")}</select>
        </div>
      </div>

      <label class="block-label">Ingredients</label>
      <div class="ingredient-box">
        <div class="ingredient-search-wrap">
          <input type="text" id="rs-ing-search" placeholder="Search ingredients&hellip;" autocomplete="off">
          <div class="ingredient-dropdown" id="rs-ing-dropdown" hidden></div>
        </div>
        <div class="ingredient-add-row">
          <input type="number" id="rs-ing-weight" placeholder="Grams" min="0">
          <button type="button" id="rs-ing-add" aria-label="Add ingredient">
            <svg viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          </button>
        </div>
        <div id="rs-ing-list" class="ingredient-list"></div>
      </div>

      <div class="field-grid" style="margin-top:16px;">
        <div class="field"><label>Raw Weight (g)</label><input type="number" id="rs-raw-weight" min="0" value="${r.rawWeight ?? ""}" placeholder="Optional"></div>
        <div class="field"><label>Final Weight (g) *</label><input type="number" id="rs-final-weight" min="0" value="${r.finalWeight ?? ""}" placeholder="e.g., 800"></div>
      </div>

      <div class="field">
        <label>Notes <span class="field__optional">(Optional)</span></label>
        <textarea id="rs-notes" rows="2" placeholder="Cooking instructions, tips, etc&hellip;">${escapeHtml(r.notes || "")}</textarea>
      </div>
      <div class="checkbox-row"><label><input type="checkbox" id="rs-fav" ${r.favorite ? "checked" : ""}> Favorite</label></div>

      <div class="sheet-actions">
        <button class="btn btn--secondary" id="rs-cancel" type="button">Cancel</button>
        <button class="btn btn--primary" id="rs-save" type="button">${isEdit ? "Save Changes" : "Save Recipe"}</button>
      </div>`
  });

  function renderIngredientList() {
    const box = backdrop.querySelector("#rs-ing-list");
    if (items.length === 0) { box.innerHTML = ""; return; }
    box.innerHTML = items.map((it, idx) => {
      const name = it.name || (state.library.find(x => x.id === it.foodId) || {}).name || "(missing food)";
      return `
        <div class="ingredient-row">
          <span class="ingredient-row__name">${escapeHtml(name)}</span>
          <span class="ingredient-row__grams">${it.grams}g</span>
          <button type="button" data-idx="${idx}" aria-label="Remove ingredient">
            <svg viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
          </button>
        </div>
      `;
    }).join("");
  }
  renderIngredientList();

  function renderDropdown() {
    const dd = backdrop.querySelector("#rs-ing-dropdown");
    const q = backdrop.querySelector("#rs-ing-search").value.trim().toLowerCase();
    if (!q) { dd.hidden = true; dd.innerHTML = ""; return; }
    const matches = state.library.filter(f => f.name.toLowerCase().includes(q)).slice(0, 8);
    if (matches.length === 0) { dd.hidden = true; dd.innerHTML = ""; return; }
    dd.innerHTML = matches.map(f => `<button type="button" class="ingredient-dropdown__item" data-id="${f.id}">${escapeHtml(f.name)} <span>${f.carbs}g carbs/100g</span></button>`).join("");
    dd.hidden = false;
  }

  backdrop.querySelector("#rs-ing-search").addEventListener("input", () => { ingredientSelection = null; renderDropdown(); });
  backdrop.querySelector("#rs-ing-dropdown").addEventListener("click", e => {
    const btn = e.target.closest(".ingredient-dropdown__item");
    if (!btn) return;
    const f = state.library.find(x => x.id === btn.dataset.id);
    if (!f) return;
    ingredientSelection = { foodId: f.id, name: f.name };
    backdrop.querySelector("#rs-ing-search").value = f.name;
    backdrop.querySelector("#rs-ing-dropdown").hidden = true;
    backdrop.querySelector("#rs-ing-weight").focus();
  });

  function addIngredient() {
    const weight = parseFloat(backdrop.querySelector("#rs-ing-weight").value);
    if (!ingredientSelection) { backdrop.querySelector("#rs-ing-search").focus(); return; }
    if (!weight || weight <= 0) { backdrop.querySelector("#rs-ing-weight").focus(); return; }
    const food = state.library.find(f => f.id === ingredientSelection.foodId);
    items.push({
      foodId: ingredientSelection.foodId, name: ingredientSelection.name, grams: weight,
      carbsPer100g: food ? food.carbs : 0, kcalPer100g: food ? food.kcal : null
    });
    ingredientSelection = null;
    backdrop.querySelector("#rs-ing-search").value = "";
    backdrop.querySelector("#rs-ing-weight").value = "";
    renderIngredientList();
  }
  backdrop.querySelector("#rs-ing-add").addEventListener("click", addIngredient);
  backdrop.querySelector("#rs-ing-weight").addEventListener("keydown", e => { if (e.key === "Enter") addIngredient(); });
  backdrop.querySelector("#rs-ing-list").addEventListener("click", e => {
    const btn = e.target.closest("button[data-idx]");
    if (!btn) return;
    items.splice(parseInt(btn.dataset.idx, 10), 1);
    renderIngredientList();
  });

  backdrop.querySelector("#rs-save").addEventListener("click", () => {
    const name = backdrop.querySelector("#rs-name").value.trim();
    const finalWeight = parseFloat(backdrop.querySelector("#rs-final-weight").value);
    if (!name) { dialogs.alert("Give the recipe a name.", { title: "Missing details" }); return; }
    if (items.length === 0) { dialogs.alert("Add at least one ingredient.", { title: "Missing details" }); return; }
    if (!finalWeight || finalWeight <= 0) { dialogs.alert("Final Weight is required — it's the total weight of the finished dish, used to work out carbs per 100g.", { title: "Missing details" }); return; }
    const payload = {
      name,
      category: backdrop.querySelector("#rs-cat").value,
      notes: backdrop.querySelector("#rs-notes").value.trim(),
      favorite: backdrop.querySelector("#rs-fav").checked,
      items,
      rawWeight: parseFloat(backdrop.querySelector("#rs-raw-weight").value) || null,
      finalWeight
    };
    if (isEdit) Object.assign(r, payload);
    else state.recipes.unshift({ id: makeId("recipe"), usageCount: 0, ...payload });
    saveState();
    renderRecipesLibrary();
    close();
  });
}

/** Event wiring. Called once by app.js, after every module has loaded. */
export function initLibrary() {

  CATEGORIES.forEach(c => {
    const opt = document.createElement("option");
    opt.value = c.id; opt.textContent = c.label;
    libCatFilter.appendChild(opt);
  });

  libSegmented.addEventListener("click", e => {
    const btn = e.target.closest(".segmented__btn");
    if (!btn) return;
    libSeg = btn.dataset.seg;
    libSegmented.querySelectorAll(".segmented__btn").forEach(b => b.classList.toggle("is-active", b === btn));
    libSearch.placeholder = libSeg === "foods" ? "Search foods…" : "Search recipes…";
    renderLibrary();
  });

  libFilterBtn.addEventListener("click", () => {
    libFilterPanel.hidden = !libFilterPanel.hidden;
    libFilterBtn.classList.toggle("is-active", !libFilterPanel.hidden);
  });
  [libSearch, libFavOnly, libCatFilter, libSort].forEach(elx => elx.addEventListener("input", renderLibrary));

  libFoodsList.addEventListener("click", e => {
    const starBtn = e.target.closest(".lib-item__star");
    if (starBtn) {
      const f = state.library.find(x => x.id === starBtn.dataset.id);
      if (f) { f.favorite = !f.favorite; saveState(); renderFoodsLibrary(); }
      return;
    }
    const actBtn = e.target.closest("[data-act]");
    if (!actBtn) return;
    const id = actBtn.dataset.id;
    const f = state.library.find(x => x.id === id);
    if (!f) return;
    if (actBtn.dataset.act === "edit") openFoodSheet(f);
    if (actBtn.dataset.act === "copy") {
      const copy = { ...f, id: makeId("food"), name: f.name + " (copy)", usageCount: 0 };
      state.library.unshift(copy);
      saveState(); renderFoodsLibrary();
    }
    if (actBtn.dataset.act === "delete") {
      const idx = state.library.findIndex(x => x.id === id);
      const [removed] = state.library.splice(idx, 1);
      saveState(); renderFoodsLibrary();
      showUndoToast(`Deleted "${removed.name}"`, () => {
        state.library.splice(idx, 0, removed);
        saveState(); renderFoodsLibrary();
      });
    }
  });

  libRecipesList.addEventListener("click", e => {
    const starBtn = e.target.closest(".lib-item__star");
    if (starBtn) {
      const r = state.recipes.find(x => x.id === starBtn.dataset.id);
      if (r) { r.favorite = !r.favorite; saveState(); renderRecipesLibrary(); }
      return;
    }
    const actBtn = e.target.closest("[data-act]");
    if (!actBtn) return;
    const r = state.recipes.find(x => x.id === actBtn.dataset.id);
    if (!r) return;
    if (actBtn.dataset.act === "edit") openRecipeSheet(r);
    if (actBtn.dataset.act === "delete") {
      const idx = state.recipes.findIndex(x => x.id === r.id);
      const [removed] = state.recipes.splice(idx, 1);
      saveState(); renderRecipesLibrary();
      showUndoToast(`Deleted "${removed.name}"`, () => {
        state.recipes.splice(idx, 0, removed);
        saveState(); renderRecipesLibrary();
      });
    }
  });

  libAddBtn.addEventListener("click", () => { if (libSeg === "foods") openFoodSheet(null); else openRecipeSheet(null); });
}
