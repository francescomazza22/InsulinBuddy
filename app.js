(() => {
  "use strict";

  const STORAGE_KEY = "insulinBuddy.v2";

  const CATEGORIES = [
    { id: "fruits", label: "Fruits" },
    { id: "vegetables", label: "Vegetables" },
    { id: "grains", label: "Grains" },
    { id: "protein", label: "Protein" },
    { id: "dairy", label: "Dairy" },
    { id: "beverages", label: "Beverages" },
    { id: "snacks", label: "Snacks" },
    { id: "other", label: "Other" }
  ];

  const PALETTES = [
    { id: "tealViolet", name: "Teal & Violet", dots: ["#1F9E93", "#8B5CF6", "#38BDF8"] },
    { id: "blueViolet", name: "Blue & Purple", dots: ["#3B82F6", "#8B5CF6", "#6366F1"] },
    { id: "emeraldRose", name: "Emerald & Rose", dots: ["#10B981", "#F43F5E", "#34D399"] },
    { id: "orangePink", name: "Orange & Pink", dots: ["#F97316", "#EC4899", "#F59E0B"] },
    { id: "cyanIndigo", name: "Cyan & Indigo", dots: ["#22B8CE", "#6366F1", "#3B82F6"] },
    { id: "greenAmber", name: "Green & Amber", dots: ["#22C55E", "#F59E0B", "#84CC16"] }
  ];

  const MEAL_TYPES = {
    breakfast: { label: "Breakfast", color: "#E8935D", icon: iconSun() },
    lunch:     { label: "Lunch",     color: "#D6A419", icon: iconSun() },
    dinner:    { label: "Dinner",    color: "#6B5FD0", icon: iconMoon() },
    snack:     { label: "Snack",     color: "#4C9A6A", icon: iconApple() }
  };

  function iconSun() { return '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="1.8"/><path d="M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>'; }
  function iconMoon() { return '<svg viewBox="0 0 24 24" fill="none"><path d="M20 14.5A8 8 0 1110 3.2 6.5 6.5 0 0020 14.5z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>'; }
  function iconApple() { return '<svg viewBox="0 0 24 24" fill="none"><path d="M12 8.5c-3.5-2.5-8 0-8 5S7.5 21 10 20c1-.4 1-.4 2 0 2.5 1 6-2.5 6-6.5s-4.5-7.5-6-5z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M12 8.5c0-1.5.5-3 2-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>'; }

  const DEFAULT_TIME_RATIOS = [
    { id: "tr-morning", name: "Morning", start: "05:30", end: "11:00", ratio: 10, color: "#1F9E93" },
    { id: "tr-lunch",   name: "Lunch",   start: "11:00", end: "15:00", ratio: 8,  color: "#D6A419" },
    { id: "tr-evening", name: "Evening", start: "15:00", end: "23:30", ratio: 15, color: "#6366F1" },
    { id: "tr-night",   name: "Night",   start: "23:30", end: "05:30", ratio: 12, color: "#D9534F" }
  ];
  const DEFAULT_ACTIVITY_RATIOS = [
    { id: "ar-sport", name: "Sport", ratio: 18, color: "#8B5CF6" }
  ];

  function defaultState() {
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
        darkMode: false
      },
      library: structuredClone(typeof SEED_FOODS !== "undefined" ? SEED_FOODS : []),
      recipes: structuredClone(typeof SEED_RECIPES !== "undefined" ? SEED_RECIPES : []),
      history: []
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      const d = defaultState();
      return {
        settings: { ...d.settings, ...(parsed.settings || {}) },
        library: Array.isArray(parsed.library) ? parsed.library : d.library,
        recipes: Array.isArray(parsed.recipes) ? parsed.recipes : [],
        history: Array.isArray(parsed.history) ? parsed.history : []
      };
    } catch (e) {
      console.error("Could not read saved data, starting fresh.", e);
      return defaultState();
    }
  }

  let state = loadState();
  function saveState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }

  // ---------- draft (in-progress calculator entry, not persisted) ----------
  let draft = {
    items: [],          // { refType, refId, name, grams, carbs, kcal }
    correctionOn: false,
    glucose: "",
    manualRatioId: null // overrides time-of-day auto ratio; can be a timeRatio or activityRatio id
  };

  // ================= Navigation =================
  const tabs = document.querySelectorAll(".tab");
  const views = document.querySelectorAll("[data-view]");

  function showView(name) {
    views.forEach(v => { v.hidden = v.id !== `view-${name}`; });
    tabs.forEach(t => {
      if (t.dataset.target === name) t.setAttribute("aria-current", "page");
      else t.removeAttribute("aria-current");
    });
    if (name === "library") renderLibrary();
    if (name === "history") renderHistory();
    if (name === "settings") renderSettings();
  }
  tabs.forEach(t => t.addEventListener("click", () => showView(t.dataset.target)));

  // ================= Time helpers =================
  function toMinutes(hhmm) {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
  }
  function inRange(minutes, start, end) {
    const s = toMinutes(start), e = toMinutes(end);
    if (s === e) return true;
    if (s < e) return minutes >= s && minutes < e;
    return minutes >= s || minutes < e; // wraps past midnight
  }
  function currentTimeRatio(atDate) {
    const d = atDate || new Date();
    const minutes = d.getHours() * 60 + d.getMinutes();
    const list = state.settings.timeRatios;
    return list.find(r => inRange(minutes, r.start, r.end)) || list[0] || null;
  }
  function unitLabel() { return state.settings.units === "mmol" ? "mmol/L" : "mg/dL"; }

  function activeRatioEntry() {
    if (draft.manualRatioId) {
      const t = state.settings.timeRatios.find(r => r.id === draft.manualRatioId);
      if (t) return t;
      const a = state.settings.activityRatios.find(r => r.id === draft.manualRatioId);
      if (a) return a;
    }
    return currentTimeRatio();
  }

  // ================= Calculator =================
  const el = id => document.getElementById(id);
  const carbsPill = el("cc-carbs-pill");
  const doseNumber = el("cc-dose-number");
  const correctionToggle = el("cc-correction-toggle");
  const correctionRow = el("cc-correction-row");
  const glucoseInput = el("cc-glucose");
  const glucoseUnitLabel = el("cc-glucose-unit");
  const ratioPill = el("cc-ratio-pill");
  const ratioValueLabel = el("cc-ratio-value");
  const ratioPicker = el("cc-ratio-picker");
  const mealItemsBox = el("cc-meal-items");
  const searchInput = el("cc-search");
  const gramsInput = el("cc-grams");
  const addBtn = el("cc-add-btn");
  const foodListBox = el("cc-food-list");
  const logBtn = el("cc-log-btn");
  const resetBtn = el("cc-reset-btn");
  const clearAllBtn = el("cc-clear-all-btn");

  let selectedPickId = null; // id of highlighted item in the pick list (format "food:ID" or "recipe:ID")

  function roundDose(value) {
    const step = parseFloat(state.settings.rounding);
    return Math.round((Math.round(value / step) * step) * 100) / 100;
  }

  function recipeTotals(recipe) {
    let carbs = 0, kcal = 0;
    recipe.items.forEach(it => {
      let cp100 = it.carbsPer100g, kp100 = it.kcalPer100g;
      if (cp100 == null) {
        // older recipes saved before ingredients snapshotted their rates — fall back to a live lookup
        const food = state.library.find(f => f.id === it.foodId);
        cp100 = food ? food.carbs : 0;
        kp100 = food ? food.kcal : null;
      }
      carbs += (cp100 || 0) * it.grams / 100;
      kcal += (kp100 || 0) * it.grams / 100;
    });
    const totalCarbs = Math.round(carbs * 10) / 10;
    const totalKcal = Math.round(kcal);
    const fw = recipe.finalWeight;
    return {
      totalCarbs, totalKcal,
      carbsPer100g: fw ? Math.round((totalCarbs / fw) * 1000) / 10 : null,
      kcalPer100g: fw ? Math.round((totalKcal / fw) * 1000) / 10 : null
    };
  }

  function pickableItems() {
    const foods = state.library.map(f => ({
      id: "food:" + f.id, refType: "food", refId: f.id, name: f.name,
      carbsPer100g: f.carbs, kcalPer100g: f.kcal, notes: f.notes,
      usageCount: f.usageCount || 0, favorite: f.favorite
    }));
    const recipes = state.recipes.filter(r => r.finalWeight > 0).map(r => {
      const t = recipeTotals(r);
      return {
        id: "recipe:" + r.id, refType: "recipe", refId: r.id, name: r.name,
        carbsPer100g: t.carbsPer100g, kcalPer100g: t.kcalPer100g, notes: r.notes,
        usageCount: r.usageCount || 0, favorite: r.favorite
      };
    });
    return [...recipes, ...foods];
  }

  function renderFoodPickList() {
    const q = searchInput.value.trim().toLowerCase();
    let items = pickableItems();
    if (q) items = items.filter(i => i.name.toLowerCase().includes(q));
    items.sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0) || a.name.localeCompare(b.name));
    items = items.slice(0, 40);

    foodListBox.innerHTML = "";
    items.forEach(item => {
      const row = document.createElement("div");
      row.className = "food-pick-item" + (selectedPickId === item.id ? " is-selected" : "");
      row.dataset.id = item.id;
      const meta = `<span class="c-carbs">${item.carbsPer100g ?? "?"}g carbs</span>${item.kcalPer100g ? ` · <span class="c-kcal">~${item.kcalPer100g} kcal</span> / 100g` : " / 100g"}`;
      row.innerHTML = `
        <div class="food-pick-item__main">
          <p class="food-pick-item__name">${escapeHtml(item.name)}</p>
          <p class="food-pick-item__meta">${meta}</p>
          ${item.notes ? `<p class="food-pick-item__note">${escapeHtml(item.notes)}</p>` : ""}
        </div>
        ${item.refType === "recipe" ? '<span class="food-pick-item__badge">Recipe</span>' : (item.usageCount ? `<span class="food-pick-item__badge">${item.usageCount}×</span>` : "")}
      `;
      foodListBox.appendChild(row);
    });
  }

  foodListBox.addEventListener("click", e => {
    const row = e.target.closest(".food-pick-item");
    if (!row) return;
    selectedPickId = row.dataset.id;
    const items = pickableItems();
    const item = items.find(i => i.id === selectedPickId);
    if (!item) return;
    searchInput.value = item.name;
    renderFoodPickList();
    gramsInput.disabled = false;
    gramsInput.focus();
  });

  searchInput.addEventListener("input", () => { selectedPickId = null; renderFoodPickList(); });

  function addSelectedToMeal() {
    if (!selectedPickId) return;
    const [type, id] = selectedPickId.split(":");
    const items = pickableItems();
    const item = items.find(i => i.id === selectedPickId);
    if (!item || item.carbsPer100g == null) return;
    const grams = parseFloat(gramsInput.value);
    if (!grams || grams <= 0) { gramsInput.focus(); return; }
    draft.items.push({
      refType: type, refId: id, name: item.name, grams,
      carbsPer100g: item.carbsPer100g, kcalPer100g: item.kcalPer100g,
      carbs: Math.round(item.carbsPer100g * grams) / 100,
      kcal: item.kcalPer100g ? Math.round(item.kcalPer100g * grams) / 100 : null
    });
    selectedPickId = null;
    searchInput.value = "";
    gramsInput.value = "";
    gramsInput.disabled = false;
    renderFoodPickList();
    renderMealItems();
    recompute();
  }

  addBtn.addEventListener("click", addSelectedToMeal);
  gramsInput.addEventListener("keydown", e => { if (e.key === "Enter") addSelectedToMeal(); });

  function renderMealItems() {
    el("cc-current-meal-header").hidden = draft.items.length === 0;
    mealItemsBox.innerHTML = "";
    draft.items.forEach((item, idx) => {
      const row = document.createElement("div");
      row.className = "meal-item";
      row.innerHTML = `
        <div class="meal-item__main">
          <p class="meal-item__name">${escapeHtml(item.name)}</p>
          <p class="meal-item__meta">${item.grams}g${item.kcal ? " · ~" + Math.round(item.kcal) + " kcal" : ""}</p>
        </div>
        <div class="meal-item__carbs">${round1(item.carbs)}g</div>
        <button class="meal-item__remove" data-idx="${idx}" aria-label="Remove">
          <svg viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button>
      `;
      mealItemsBox.appendChild(row);
    });
  }

  mealItemsBox.addEventListener("click", e => {
    const btn = e.target.closest(".meal-item__remove");
    if (!btn) return;
    draft.items.splice(parseInt(btn.dataset.idx, 10), 1);
    renderMealItems();
    recompute();
  });

  function round1(n) { return Math.round(n * 10) / 10; }

  function totalCarbs() { return draft.items.reduce((s, i) => s + i.carbs, 0); }

  function recompute() {
    const carbs = totalCarbs();
    carbsPill.textContent = `${round1(carbs)}g Carbs`;

    const ratioEntry = activeRatioEntry();
    ratioValueLabel.textContent = ratioEntry ? `1:${ratioEntry.ratio}` : "—";

    const mealPart = ratioEntry && ratioEntry.ratio > 0 ? carbs / ratioEntry.ratio : 0;

    let correctionPart = 0;
    if (draft.correctionOn) {
      const bg = parseFloat(glucoseInput.value);
      if (!isNaN(bg) && bg > 0 && state.settings.isf > 0) {
        correctionPart = Math.max(0, (bg - state.settings.target) / state.settings.isf);
      }
    }

    let total = mealPart + correctionPart;
    if (state.settings.maxDose > 0 && total > state.settings.maxDose) total = state.settings.maxDose;
    const finalDose = Math.max(0, roundDose(total));
    doseNumber.textContent = finalDose.toFixed(1);

    logBtn.disabled = carbs <= 0;
    clearAllBtn.hidden = carbs <= 0;

    draft._computed = { carbs, mealDose: roundDose(mealPart), correctionDose: roundDose(correctionPart), finalDose, ratioEntry };
  }

  correctionToggle.addEventListener("click", () => {
    draft.correctionOn = !draft.correctionOn;
    correctionToggle.classList.toggle("is-active", draft.correctionOn);
    correctionRow.hidden = !draft.correctionOn;
    glucoseUnitLabel.textContent = unitLabel();
    if (draft.correctionOn) glucoseInput.focus();
    recompute();
  });
  glucoseInput.addEventListener("input", recompute);

  function renderRatioPicker() {
    const rows = [
      ...state.settings.timeRatios.map(r => ({ ...r, kind: "time" })),
      ...state.settings.activityRatios.map(r => ({ ...r, kind: "activity" }))
    ];
    ratioPicker.innerHTML = rows.map(r => `
      <button class="ratio-picker__item" data-id="${r.id}" type="button">
        <span class="ratio-picker__name"><span class="ratio-picker__dot" style="background:${r.color}"></span>${escapeHtml(r.name)}${r.kind === "time" ? ` <span style="color:var(--ink-soft);font-weight:400;">${r.start}–${r.end}</span>` : ""}</span>
        <span class="ratio-picker__value">1:${r.ratio}</span>
      </button>
    `).join("") + `
      <button class="ratio-picker__item" data-id="__auto__" type="button">
        <span class="ratio-picker__name">Use automatic (time-of-day)</span>
        <span class="ratio-picker__value"></span>
      </button>
    `;
  }

  ratioPill.addEventListener("click", e => {
    e.stopPropagation();
    if (ratioPicker.hidden) { renderRatioPicker(); ratioPicker.hidden = false; }
    else ratioPicker.hidden = true;
  });
  ratioPicker.addEventListener("click", e => {
    e.stopPropagation();
    const btn = e.target.closest(".ratio-picker__item");
    if (!btn) return;
    draft.manualRatioId = btn.dataset.id === "__auto__" ? null : btn.dataset.id;
    ratioPicker.hidden = true;
    recompute();
  });
  document.addEventListener("click", () => { ratioPicker.hidden = true; });
  document.addEventListener("keydown", e => { if (e.key === "Escape") ratioPicker.hidden = true; });

  function resetDraft() {
    draft = { items: [], correctionOn: false, glucose: "", manualRatioId: null };
    searchInput.value = ""; gramsInput.value = ""; gramsInput.disabled = false;
    glucoseInput.value = "";
    correctionToggle.classList.remove("is-active");
    correctionRow.hidden = true;
    ratioPicker.hidden = true;
    selectedPickId = null;
    renderFoodPickList();
    renderMealItems();
    recompute();
  }
  resetBtn.addEventListener("click", resetDraft);
  clearAllBtn.addEventListener("click", resetDraft);

  // Meal type is detected automatically from time of day — no prompt needed
  function autoMealType(date) {
    const h = date.getHours() + date.getMinutes() / 60;
    if (h >= 5 && h < 10.5) return "breakfast";
    if (h >= 10.5 && h < 14.5) return "lunch";
    if (h >= 14.5 && h < 18) return "snack";
    if (h >= 18 && h < 22.5) return "dinner";
    return "snack";
  }

  logBtn.addEventListener("click", () => {
    if (totalCarbs() <= 0) return;
    logMeal(autoMealType(new Date()));
  });

  // ---- Bottom-sheet helpers: lock background scroll on mobile while a sheet is open ----
  let openSheetCount = 0;
  function openSheet(backdrop) {
    document.body.appendChild(backdrop);
    openSheetCount++;
    document.body.classList.add("sheet-open");
  }
  function closeSheet(backdrop) {
    backdrop.remove();
    openSheetCount = Math.max(0, openSheetCount - 1);
    if (openSheetCount === 0) document.body.classList.remove("sheet-open");
  }

  function logMeal(mealType) {
    const ratioEntry = draft._computed.ratioEntry;
    const now = new Date();
    const periodEntry = currentTimeRatio(now);
    const glucoseVal = draft.correctionOn ? (parseFloat(glucoseInput.value) || null) : null;
    const entry = {
      id: "h-" + Date.now(),
      ts: now.getTime(),
      mealType,
      periodName: periodEntry ? periodEntry.name.toLowerCase() : "",
      items: draft.items.map(i => ({
        refType: i.refType, refId: i.refId, name: i.name, grams: i.grams,
        carbsPer100g: i.carbsPer100g, kcalPer100g: i.kcalPer100g,
        carbs: i.carbs, kcal: i.kcal
      })),
      totalCarbs: round1(totalCarbs()),
      totalKcal: Math.round(draft.items.reduce((s, i) => s + (i.kcal || 0), 0)),
      mealDose: draft._computed.mealDose,
      correctionDose: draft._computed.correctionDose,
      glucose: glucoseVal,
      ratioLabel: ratioEntry ? ratioEntry.name : "",
      ratioValue: ratioEntry ? ratioEntry.ratio : null
    };
    state.history.unshift(entry);
    draft.items.forEach(i => {
      if (i.refType === "food") {
        const f = state.library.find(x => x.id === i.refId);
        if (f) f.usageCount = (f.usageCount || 0) + 1;
      } else {
        const r = state.recipes.find(x => x.id === i.refId);
        if (r) r.usageCount = (r.usageCount || 0) + 1;
      }
    });
    saveState();
    resetDraft();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // ================= Library =================
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

  function categoryBadge(cat) {
    const c = CATEGORIES.find(x => x.id === cat) || CATEGORIES[CATEGORIES.length - 1];
    return `<span class="lib-item__badge cat-${c.id}">${c.label}</span>`;
  }

  function renderLibrary() {
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
          <div class="lib-item__title-row">
            <p class="lib-item__name">${escapeHtml(f.name)}</p>
            ${categoryBadge(f.category)}
          </div>
          <p class="lib-item__meta"><span class="c-carbs">${f.carbs}g carbs/100g</span>${f.kcal ? ` · <span class="c-kcal">~${f.kcal} kcal/100g</span>` : ""}</p>
          ${f.notes ? `<p class="lib-item__note">${escapeHtml(f.notes)}</p>` : ""}
          <p class="lib-item__usage">Used ${f.usageCount || 0}× times</p>
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
      const copy = { ...f, id: "food-" + Date.now(), name: f.name + " (copy)", usageCount: 0 };
      state.library.unshift(copy);
      saveState(); renderFoodsLibrary();
    }
    if (actBtn.dataset.act === "delete") {
      if (confirm(`Delete "${f.name}"?`)) {
        state.library = state.library.filter(x => x.id !== id);
        saveState(); renderFoodsLibrary();
      }
    }
  });

  function openFoodSheet(food) {
    const isEdit = !!food;
    const f = food || { name: "", category: "other", carbs: "", kcal: "", fat: "", protein: "", salt: "", notes: "", favorite: false };
    const backdrop = document.createElement("div");
    backdrop.className = "sheet-backdrop";
    backdrop.innerHTML = `
      <div class="sheet">
        <div class="sheet-head">
          <h2>${isEdit ? "Edit Food" : "Add New Food"}</h2>
          <button class="sheet-close" id="fs-close" type="button" aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
          </button>
        </div>
        <div class="field">
          <label>Food Name</label>
          <input type="text" id="fs-name" value="${escapeAttr(f.name)}" placeholder="e.g., Brown Rice">
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

        <div class="field" style="margin-top:18px;">
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
        </div>
      </div>
    `;
    openSheet(backdrop);
    backdrop.addEventListener("click", e => { if (e.target === backdrop || e.target.id === "fs-cancel" || e.target.closest("#fs-close")) closeSheet(backdrop); });
    backdrop.querySelector("#fs-save").addEventListener("click", () => {
      const name = backdrop.querySelector("#fs-name").value.trim();
      const carbs = parseFloat(backdrop.querySelector("#fs-carbs").value);
      if (!name || isNaN(carbs)) { alert("Please enter at least a name and carbs per 100g."); return; }
      const payload = {
        name,
        category: backdrop.querySelector("#fs-cat").value,
        carbs,
        kcal: parseFloat(backdrop.querySelector("#fs-kcal").value) || null,
        fat: parseFloat(backdrop.querySelector("#fs-fat").value) || null,
        protein: parseFloat(backdrop.querySelector("#fs-protein").value) || null,
        salt: parseFloat(backdrop.querySelector("#fs-salt").value) || null,
        notes: backdrop.querySelector("#fs-notes").value.trim(),
        favorite: backdrop.querySelector("#fs-fav").checked
      };
      if (isEdit) Object.assign(f, payload);
      else state.library.unshift({ id: "food-" + Date.now(), usageCount: 0, ...payload });
      saveState();
      renderFoodsLibrary();
      closeSheet(backdrop);
    });
  }

  function escapeAttr(s) { return escapeHtml(s).replace(/"/g, "&quot;"); }

  function renderRecipesLibrary() {
    const q = libSearch.value.trim().toLowerCase();
    let items = state.recipes.slice();
    if (q) items = items.filter(r => r.name.toLowerCase().includes(q));
    if (libFavOnly.checked) items = items.filter(r => r.favorite);
    libRecipesList.innerHTML = "";
    libEmpty.hidden = items.length > 0;
    items.forEach(r => {
      const t = recipeTotals(r);
      const row = document.createElement("div");
      row.className = "lib-item";
      const perG = t.carbsPer100g != null
        ? `<span class="c-carbs">${t.carbsPer100g}g carbs/100g</span>${t.kcalPer100g ? ` · <span class="c-kcal">~${t.kcalPer100g} kcal/100g</span>` : ""}`
        : `<span style="color:var(--brick);">Set a final weight to use this in the Calculator</span>`;
      row.innerHTML = `
        <button class="lib-item__star${r.favorite ? " is-fav" : ""}" data-id="${r.id}" aria-label="Toggle favorite">
          <svg viewBox="0 0 24 24" fill="${r.favorite ? "currentColor" : "none"}"><path d="M12 3.5l2.6 5.6 6 .7-4.4 4.2 1.1 6-5.3-3-5.3 3 1.1-6-4.4-4.2 6-.7z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>
        </button>
        <div class="lib-item__main">
          <div class="lib-item__title-row">
            <p class="lib-item__name">${escapeHtml(r.name)}</p>
            ${categoryBadge(r.category || "other")}
          </div>
          <p class="lib-item__meta">${perG}</p>
          <p class="lib-item__note">${r.items.map(it => {
            const name = it.name || (state.library.find(x => x.id === it.foodId) || {}).name;
            return name ? `${name} (${it.grams}g)` : "";
          }).filter(Boolean).join(", ")}${r.finalWeight ? ` — final weight ${r.finalWeight}g` : ""}</p>
          <p class="lib-item__usage">Used ${r.usageCount || 0}× times</p>
        </div>
        <div class="lib-item__actions">
          <button data-act="edit" data-id="${r.id}" aria-label="Edit"><svg viewBox="0 0 24 24" fill="none"><path d="M4 20l4-1 11-11-3-3L5 16z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg></button>
          <button class="danger" data-act="delete" data-id="${r.id}" aria-label="Delete"><svg viewBox="0 0 24 24" fill="none"><path d="M5 7h14M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m-9 0l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        </div>
      `;
      libRecipesList.appendChild(row);
    });
  }

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
      if (confirm(`Delete recipe "${r.name}"?`)) {
        state.recipes = state.recipes.filter(x => x.id !== r.id);
        saveState(); renderRecipesLibrary();
      }
    }
  });

  function openRecipeSheet(recipe) {
    const isEdit = !!recipe;
    const r = recipe || { name: "", category: "other", notes: "", favorite: false, items: [], rawWeight: null, finalWeight: "" };
    let items = r.items.length ? r.items.map(it => ({ ...it })) : [];
    let ingredientSelection = null; // { foodId, name }

    const backdrop = document.createElement("div");
    backdrop.className = "sheet-backdrop";
    backdrop.innerHTML = `
      <div class="sheet">
        <div class="sheet-head sheet-head--recipe">
          <button class="sheet-back" id="rs-back" type="button" aria-label="Back">
            <svg viewBox="0 0 24 24" fill="none"><path d="M15 5l-7 7 7 7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <span class="sheet-head__icon">
            <svg viewBox="0 0 24 24" fill="none"><path d="M6 10.5c0-2.5 2.5-5 6-5s6 2.5 6 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M4.5 10.5h15L18 20a1.5 1.5 0 01-1.5 1.3h-9A1.5 1.5 0 016 20l-1.5-9.5z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
          </span>
          <h2>${isEdit ? "Edit Recipe" : "Create Recipe"}</h2>
          <button class="sheet-close" id="rs-close" type="button" aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
          </button>
        </div>

        <div class="field-grid">
          <div class="field"><label>Recipe Name</label><input type="text" id="rs-name" value="${escapeAttr(r.name)}" placeholder="e.g., Chocolate Cake"></div>
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
            <input type="number" id="rs-ing-weight" placeholder="Weight (g)" min="0">
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
        </div>
      </div>
    `;
    openSheet(backdrop);

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

    backdrop.addEventListener("click", e => {
      if (e.target === backdrop || e.target.id === "rs-cancel" || e.target.closest("#rs-close") || e.target.closest("#rs-back")) closeSheet(backdrop);
    });
    backdrop.querySelector("#rs-save").addEventListener("click", () => {
      const name = backdrop.querySelector("#rs-name").value.trim();
      const finalWeight = parseFloat(backdrop.querySelector("#rs-final-weight").value);
      if (!name) { alert("Give the recipe a name."); return; }
      if (items.length === 0) { alert("Add at least one ingredient."); return; }
      if (!finalWeight || finalWeight <= 0) { alert("Final Weight is required — it's the total weight of the finished dish, used to work out carbs per 100g."); return; }
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
      else state.recipes.unshift({ id: "recipe-" + Date.now(), usageCount: 0, ...payload });
      saveState();
      renderRecipesLibrary();
      closeSheet(backdrop);
    });
  }

  libAddBtn.addEventListener("click", () => { if (libSeg === "foods") openFoodSheet(null); else openRecipeSheet(null); });

  // ================= History =================
  const historyGroups = el("history-groups");
  const historyEmpty = el("history-empty");
  const histCountPill = el("hist-count-pill");

  function formatDateHeader(ts) {
    return new Date(ts).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }).toUpperCase();
  }
  function formatTime(ts) {
    return new Date(ts).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  function dateKey(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  }

  let expandedHistoryId = null;

  function renderHistory() {
    histCountPill.textContent = `${state.history.length} meal${state.history.length === 1 ? "" : "s"}`;
    historyEmpty.hidden = state.history.length > 0;
    historyGroups.innerHTML = "";
    if (state.history.length === 0) return;

    const groups = [];
    let currentKey = null, currentGroup = null;
    state.history.forEach(entry => {
      const k = dateKey(entry.ts);
      if (k !== currentKey) {
        currentGroup = { key: k, ts: entry.ts, entries: [] };
        groups.push(currentGroup);
        currentKey = k;
      }
      currentGroup.entries.push(entry);
    });

    groups.forEach(group => {
      const groupEl = document.createElement("div");
      groupEl.className = "history-group";
      const header = document.createElement("p");
      header.className = "history-group__date";
      header.textContent = formatDateHeader(group.ts);
      groupEl.appendChild(header);

      group.entries.forEach(entry => {
        const meal = MEAL_TYPES[entry.mealType] || MEAL_TYPES.snack;
        const row = document.createElement("div");
        row.className = "history-entry";
        row.style.borderLeftColor = meal.color;
        row.dataset.id = entry.id;
        const doseText = entry.correctionDose > 0 ? `${entry.mealDose}+${entry.correctionDose}u` : `${entry.mealDose}u`;
        row.innerHTML = `
          <div class="history-entry__icon" style="background:${meal.color}">${meal.icon}</div>
          <div class="history-entry__main">
            <p class="history-entry__title">${meal.label} <span class="muted">· ${formatTime(entry.ts)} · ${escapeHtml(entry.periodName || "")}</span></p>
            <p class="history-entry__foods">${entry.items.map(i => escapeHtml(i.name)).join(", ")}</p>
            <div class="history-entry__detail" hidden>
              ${entry.items.map(i => `<div><span>${escapeHtml(i.name)}${i.grams ? " (" + i.grams + "g)" : ""}</span><span>${round1(i.carbs)}g carbs</span></div>`).join("")}
              <div class="history-entry__row-actions">
                <button data-use="${entry.id}" type="button">Use Again</button>
                <button data-edit="${entry.id}" type="button">Edit</button>
                <button class="danger" data-del="${entry.id}" type="button">Delete</button>
              </div>
            </div>
          </div>
          <div class="history-entry__stats">
            <span class="stat-kcal">${entry.totalKcal || 0} kcal</span>
            <span class="stat-grams">${entry.totalCarbs}g</span>
            <span class="dose-pill"><svg viewBox="0 0 24 24" fill="none"><path d="M12 2C12 2 5 10.5 5 15.5C5 19.6 8.13 22 12 22C15.87 22 19 19.6 19 15.5C19 10.5 12 2 12 2Z" stroke="currentColor" stroke-width="2"/></svg>${doseText}</span>
          </div>
        `;
        groupEl.appendChild(row);
      });
      historyGroups.appendChild(groupEl);
    });
  }

  historyGroups.addEventListener("click", e => {
    const delBtn = e.target.closest("[data-del]");
    if (delBtn) {
      if (confirm("Delete this logged meal?")) {
        state.history = state.history.filter(h => h.id !== delBtn.dataset.del);
        saveState();
        renderHistory();
      }
      return;
    }
    const useBtn = e.target.closest("[data-use]");
    if (useBtn) {
      const entry = state.history.find(h => h.id === useBtn.dataset.use);
      if (entry) useMealAgain(entry);
      return;
    }
    const editBtn = e.target.closest("[data-edit]");
    if (editBtn) {
      const entry = state.history.find(h => h.id === editBtn.dataset.edit);
      if (entry) openEditMealSheet(entry);
      return;
    }
    const row = e.target.closest(".history-entry");
    if (!row) return;
    const detail = row.querySelector(".history-entry__detail");
    detail.hidden = !detail.hidden;
  });

  function useMealAgain(entry) {
    if (draft.items.length > 0 && !confirm("This replaces what's currently in the Calculator. Continue?")) return;
    draft = {
      items: entry.items.map(i => ({
        refType: i.refType, refId: i.refId, name: i.name, grams: i.grams,
        carbsPer100g: i.carbsPer100g, kcalPer100g: i.kcalPer100g, carbs: i.carbs, kcal: i.kcal
      })),
      correctionOn: false, glucose: "", manualRatioId: null
    };
    searchInput.value = ""; gramsInput.value = ""; gramsInput.disabled = false;
    glucoseInput.value = ""; correctionToggle.classList.remove("is-active"); correctionRow.hidden = true;
    ratioPicker.hidden = true; selectedPickId = null;
    renderFoodPickList(); renderMealItems(); recompute();
    showView("calculator");
  }

  function openEditMealSheet(entry) {
    let items = entry.items.map(i => ({ ...i }));
    let mealType = entry.mealType;
    let glucose = entry.glucose;

    const backdrop = document.createElement("div");
    backdrop.className = "sheet-backdrop";
    backdrop.innerHTML = `
      <div class="sheet">
        <div class="sheet-head">
          <h2>Edit Meal</h2>
          <button class="sheet-close" id="em-close" type="button" aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
          </button>
        </div>
        <label class="block-label">Meal type</label>
        <div class="field-grid" id="em-meal-types" style="margin-bottom:18px;">
          ${Object.entries(MEAL_TYPES).map(([key, m]) => `
            <button class="btn btn--secondary" data-meal="${key}" type="button" style="display:flex;align-items:center;gap:8px;justify-content:center;${key === mealType ? `border-color:${m.color};color:${m.color};` : ""}">
              <span style="color:${m.color};width:18px;height:18px;">${m.icon}</span>${m.label}
            </button>
          `).join("")}
        </div>
        <label class="block-label">Items</label>
        <div id="em-items" class="ingredient-list" style="margin-bottom:16px;"></div>
        ${entry.glucose != null ? `
          <div class="field">
            <label>Current glucose at the time</label>
            <div class="field__row"><input type="number" id="em-glucose" value="${entry.glucose}" step="0.1"><span>${unitLabel()}</span></div>
          </div>
        ` : ""}
        <p class="disclaimer" id="em-preview" style="margin-bottom:16px;"></p>
        <div class="sheet-actions">
          <button class="btn btn--secondary" id="em-cancel" type="button">Cancel</button>
          <button class="btn btn--primary" id="em-save" type="button">Save Changes</button>
        </div>
      </div>
    `;
    openSheet(backdrop);

    function renderItems() {
      backdrop.querySelector("#em-items").innerHTML = items.map((it, idx) => `
        <div class="ingredient-row">
          <span class="ingredient-row__name">${escapeHtml(it.name)}</span>
          <input type="number" min="0" value="${it.grams}" data-idx="${idx}" class="em-grams-input" style="width:70px;padding:6px 8px;text-align:right;">
          <span style="width:14px;"></span>
          <button type="button" data-idx="${idx}" class="em-remove" aria-label="Remove item">
            <svg viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
          </button>
        </div>
      `).join("");
      updatePreview();
    }

    function updatePreview() {
      const totalCarbs = round1(items.reduce((s, i) => s + i.carbs, 0));
      let correctionDose = 0;
      const glucoseInputEl = backdrop.querySelector("#em-glucose");
      if (glucoseInputEl) {
        const g = parseFloat(glucoseInputEl.value);
        if (!isNaN(g) && g > 0) correctionDose = Math.max(0, (g - state.settings.target) / state.settings.isf);
      }
      const mealDose = entry.ratioValue ? totalCarbs / entry.ratioValue : 0;
      let total = mealDose + correctionDose;
      if (state.settings.maxDose > 0 && total > state.settings.maxDose) total = state.settings.maxDose;
      backdrop.querySelector("#em-preview").textContent =
        `New total: ${round1(totalCarbs)}g carbs → ${roundDose(total).toFixed(1)} units` +
        (entry.ratioValue ? ` (using the original 1:${entry.ratioValue} ratio)` : "");
    }

    backdrop.querySelector("#em-meal-types").addEventListener("click", e => {
      const btn = e.target.closest("[data-meal]");
      if (!btn) return;
      mealType = btn.dataset.meal;
      backdrop.querySelectorAll("#em-meal-types button").forEach(b => { b.style.borderColor = ""; b.style.color = ""; });
      const m = MEAL_TYPES[mealType];
      btn.style.borderColor = m.color; btn.style.color = m.color;
    });
    backdrop.querySelector("#em-items").addEventListener("input", e => {
      if (!e.target.classList.contains("em-grams-input")) return;
      const idx = parseInt(e.target.dataset.idx, 10);
      const grams = parseFloat(e.target.value) || 0;
      items[idx].grams = grams;
      items[idx].carbs = items[idx].carbsPer100g != null ? Math.round(items[idx].carbsPer100g * grams) / 100 : items[idx].carbs;
      items[idx].kcal = items[idx].kcalPer100g ? Math.round(items[idx].kcalPer100g * grams) / 100 : items[idx].kcal;
      updatePreview();
    });
    backdrop.querySelector("#em-items").addEventListener("click", e => {
      const btn = e.target.closest(".em-remove");
      if (!btn) return;
      items.splice(parseInt(btn.dataset.idx, 10), 1);
      renderItems();
    });
    const glucoseEl = backdrop.querySelector("#em-glucose");
    if (glucoseEl) glucoseEl.addEventListener("input", updatePreview);

    renderItems();
    backdrop.addEventListener("click", e => { if (e.target === backdrop || e.target.id === "em-cancel" || e.target.closest("#em-close")) closeSheet(backdrop); });
    backdrop.querySelector("#em-save").addEventListener("click", () => {
      if (items.length === 0) { alert("A meal needs at least one item — delete it instead if you want it gone."); return; }
      const totalCarbs = round1(items.reduce((s, i) => s + i.carbs, 0));
      const totalKcal = Math.round(items.reduce((s, i) => s + (i.kcal || 0), 0));
      const mealDose = entry.ratioValue ? roundDose(totalCarbs / entry.ratioValue) : entry.mealDose;
      let correctionDose = 0;
      const glucoseInputEl2 = backdrop.querySelector("#em-glucose");
      let newGlucose = entry.glucose;
      if (glucoseInputEl2) {
        newGlucose = parseFloat(glucoseInputEl2.value) || null;
        if (newGlucose) correctionDose = roundDose(Math.max(0, (newGlucose - state.settings.target) / state.settings.isf));
      }
      entry.mealType = mealType;
      entry.items = items;
      entry.totalCarbs = totalCarbs;
      entry.totalKcal = totalKcal;
      entry.mealDose = mealDose;
      entry.correctionDose = correctionDose;
      entry.glucose = newGlucose;
      saveState();
      renderHistory();
      closeSheet(backdrop);
    });
  }

  // ================= Settings =================
  let settingsSeg = "ratios";
  const settingsSegmented = el("settings-segmented");
  const panelRatios = el("panel-ratios");
  const panelData = el("panel-data");
  const panelGeneral = el("panel-general");

  settingsSegmented.addEventListener("click", e => {
    const btn = e.target.closest(".segmented__btn");
    if (!btn) return;
    settingsSeg = btn.dataset.seg;
    settingsSegmented.querySelectorAll(".segmented__btn").forEach(b => b.classList.toggle("is-active", b === btn));
    panelRatios.hidden = settingsSeg !== "ratios";
    panelData.hidden = settingsSeg !== "data";
    panelGeneral.hidden = settingsSeg !== "general";
  });

  function renderSettings() {
    panelRatios.hidden = settingsSeg !== "ratios";
    panelData.hidden = settingsSeg !== "data";
    panelGeneral.hidden = settingsSeg !== "general";
    renderTimeline();
    renderTimeRatioList();
    renderActivityRatioList();
    fillCorrectionForm();
    el("export-count-label").textContent = `${state.library.length} foods · ${state.recipes.length} recipes`;
    renderPaletteGrid();
    el("dark-mode-toggle").checked = state.settings.darkMode;
  }

  function renderTimeline() {
    const bar = el("timeline-bar");
    bar.innerHTML = "";
    // build 24h segments, splitting any range that wraps midnight into two
    const segs = [];
    state.settings.timeRatios.forEach(r => {
      const s = toMinutes(r.start), e = toMinutes(r.end);
      if (s < e) segs.push({ start: s, end: e, r });
      else { segs.push({ start: s, end: 1440, r }); segs.push({ start: 0, end: e, r }); }
    });
    segs.sort((a, b) => a.start - b.start);
    segs.forEach(seg => {
      const width = ((seg.end - seg.start) / 1440) * 100;
      if (width <= 0) return;
      const div = document.createElement("div");
      div.className = "timeline__seg";
      div.style.width = width + "%";
      div.style.background = seg.r.color;
      div.textContent = width > 10 ? `${seg.r.name} · 1:${seg.r.ratio}` : "";
      bar.appendChild(div);
    });

    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const marker = document.createElement("div");
    marker.className = "timeline__now";
    marker.style.left = ((nowMinutes / 1440) * 100) + "%";
    marker.title = "Now";
    bar.appendChild(marker);
  }

  function renderTimeRatioList() {
    const box = el("time-ratio-list");
    box.innerHTML = "";
    state.settings.timeRatios.forEach(r => {
      const row = document.createElement("div");
      row.className = "ratio-row";
      row.innerHTML = `
        <div class="ratio-row__top" data-toggle="${r.id}" style="cursor:pointer;">
          <span class="ratio-row__dot" style="background:${r.color}"></span>
          <span>
            <span class="ratio-row__name">${escapeHtml(r.name)}</span>
            <span class="ratio-row__time">${r.start} – ${r.end}</span>
          </span>
          <span class="ratio-row__value">1:${r.ratio}</span>
          <button class="ratio-row__del" data-del="${r.id}" aria-label="Delete" style="margin-left:4px;">
            <svg viewBox="0 0 24 24" fill="none"><path d="M5 7h14M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m-9 0l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>
        <div class="ratio-row__edit" id="edit-${r.id}" hidden>
          <input type="time" value="${r.start}" data-field="start" data-id="${r.id}">
          <span>to</span>
          <input type="time" value="${r.end}" data-field="end" data-id="${r.id}">
          <span class="ratio-x">1 unit per <input type="number" min="1" value="${r.ratio}" data-field="ratio" data-id="${r.id}"> g</span>
        </div>
      `;
      box.appendChild(row);
    });
  }

  el("time-ratio-list").addEventListener("click", e => {
    const del = e.target.closest("[data-del]");
    if (del) {
      if (state.settings.timeRatios.length <= 1) { alert("You need at least one time range."); return; }
      state.settings.timeRatios = state.settings.timeRatios.filter(r => r.id !== del.dataset.del);
      saveState(); renderTimeline(); renderTimeRatioList();
      return;
    }
    const toggle = e.target.closest("[data-toggle]");
    if (toggle) {
      const box = el("edit-" + toggle.dataset.toggle);
      box.hidden = !box.hidden;
    }
  });
  el("time-ratio-list").addEventListener("change", e => {
    const field = e.target.dataset.field;
    if (!field) return;
    const r = state.settings.timeRatios.find(x => x.id === e.target.dataset.id);
    if (!r) return;
    if (field === "ratio") r.ratio = parseFloat(e.target.value) || r.ratio;
    else r[field] = e.target.value;
    saveState();
    renderTimeline();
    renderTimeRatioList();
  });

  const RANGE_COLORS = ["#1F9E93", "#D6A419", "#6366F1", "#D9534F", "#EC4899", "#22B8CE"];
  el("add-time-range-btn").addEventListener("click", () => {
    const id = "tr-" + Date.now();
    state.settings.timeRatios.push({ id, name: "New range", start: "12:00", end: "14:00", ratio: 10, color: RANGE_COLORS[state.settings.timeRatios.length % RANGE_COLORS.length] });
    saveState(); renderTimeline(); renderTimeRatioList();
  });

  function renderActivityRatioList() {
    const box = el("activity-ratio-list");
    box.innerHTML = "";
    state.settings.activityRatios.forEach(r => {
      const row = document.createElement("div");
      row.className = "ratio-row";
      row.innerHTML = `
        <div class="ratio-row__top">
          <span class="ratio-row__dot" style="background:${r.color}"></span>
          <span class="ratio-row__name" style="flex:1;">${escapeHtml(r.name)}</span>
          <span class="ratio-x">1 unit per <input type="number" min="1" value="${r.ratio}" data-field="ratio" data-id="${r.id}" style="width:52px;padding:6px;text-align:center;"> g</span>
          <button class="ratio-row__del" data-del="${r.id}" aria-label="Delete">
            <svg viewBox="0 0 24 24" fill="none"><path d="M5 7h14M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m-9 0l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>
      `;
      box.appendChild(row);
    });
  }
  el("activity-ratio-list").addEventListener("click", e => {
    const del = e.target.closest("[data-del]");
    if (!del) return;
    state.settings.activityRatios = state.settings.activityRatios.filter(r => r.id !== del.dataset.del);
    saveState(); renderActivityRatioList();
  });
  el("activity-ratio-list").addEventListener("change", e => {
    if (e.target.dataset.field !== "ratio") return;
    const r = state.settings.activityRatios.find(x => x.id === e.target.dataset.id);
    if (r) { r.ratio = parseFloat(e.target.value) || r.ratio; saveState(); }
  });
  el("add-activity-btn").addEventListener("click", () => {
    const name = prompt("Activity name (e.g. Sport, Stress):");
    if (!name) return;
    state.settings.activityRatios.push({ id: "ar-" + Date.now(), name, ratio: 15, color: RANGE_COLORS[state.settings.activityRatios.length % RANGE_COLORS.length] });
    saveState(); renderActivityRatioList();
  });

  function fillCorrectionForm() {
    el("set-isf").value = state.settings.isf;
    el("set-target").value = state.settings.target;
    el("set-units").value = state.settings.units;
    el("set-rounding").value = state.settings.rounding;
    el("set-max").value = state.settings.maxDose;
    const u = unitLabel();
    el("isf-unit-label").textContent = u;
    el("target-unit-label").textContent = u;
  }
  el("btn-save-settings").addEventListener("click", () => {
    state.settings.isf = parseFloat(el("set-isf").value) || state.settings.isf;
    state.settings.target = parseFloat(el("set-target").value) || 0;
    state.settings.units = el("set-units").value;
    state.settings.rounding = el("set-rounding").value;
    state.settings.maxDose = parseFloat(el("set-max").value) || 0;
    saveState();
    fillCorrectionForm();
    const conf = el("save-confirm");
    conf.hidden = false;
    setTimeout(() => { conf.hidden = true; }, 1500);
    recompute();
  });

  // ---- Data tab: export/import ----
  function toCsv(rows, headers) {
    const esc = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [headers.map(esc).join(",")];
    rows.forEach(r => lines.push(headers.map(h => esc(r[h])).join(",")));
    return lines.join("\n");
  }
  function downloadText(filename, text, mime) {
    const blob = new Blob([text], { type: mime || "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

  el("btn-export-library").addEventListener("click", () => {
    const foodHeaders = ["fat_per_100g", "usage_count", "is_favorite", "notes", "calories_per_100g", "salt_per_100g", "name", "carbs_per_100g", "category", "protein_per_100g", "id"];
    const foodRows = state.library.map(f => ({
      fat_per_100g: f.fat, usage_count: f.usageCount || 0, is_favorite: !!f.favorite,
      notes: f.notes, calories_per_100g: f.kcal, salt_per_100g: f.salt, name: f.name,
      carbs_per_100g: f.carbs, category: f.category, protein_per_100g: f.protein, id: f.id
    }));
    downloadText("Food_export.csv", toCsv(foodRows, foodHeaders), "text/csv");

    if (state.recipes.length) {
      const recipeHeaders = ["raw_weight", "total_carbs", "usage_count", "final_weight", "notes", "total_calories", "calories_per_100g", "name", "ingredients", "carbs_per_100g", "category", "id"];
      const recipeRows = state.recipes.map(r => {
        const t = recipeTotals(r);
        const ingredients = r.items.map(it => {
          const cp100 = it.carbsPer100g ?? 0, kp100 = it.kcalPer100g ?? null;
          return {
            food_name: it.name || "", weight_grams: it.grams,
            carbs: Math.round(cp100 * it.grams) / 100,
            calories_per_100g: kp100, carbs_per_100g: cp100,
            calories: kp100 ? Math.round(kp100 * it.grams) / 100 : null,
            food_id: it.foodId
          };
        });
        return {
          raw_weight: r.rawWeight ?? "", total_carbs: t.totalCarbs, usage_count: r.usageCount || 0,
          final_weight: r.finalWeight ?? "", notes: r.notes, total_calories: t.totalKcal,
          calories_per_100g: t.kcalPer100g ?? "",
          name: r.name, ingredients: JSON.stringify(ingredients),
          carbs_per_100g: t.carbsPer100g ?? "",
          category: r.category || "other",
          id: r.id
        };
      });
      setTimeout(() => downloadText("Recipe_export.csv", toCsv(recipeRows, recipeHeaders), "text/csv"), 300);
    }
  });

  el("btn-import-library").addEventListener("click", () => el("import-file-input").click());
  el("import-file-input").addEventListener("change", e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        let imported = [];
        if (file.name.endsWith(".json")) {
          const data = JSON.parse(reader.result);
          imported = Array.isArray(data) ? data : (data.foods || []);
        } else {
          imported = parseCsv(reader.result).map(r => ({
            name: r.name, category: r.category || "other",
            carbs: parseFloat(r.carbs_per_100g) || 0, kcal: parseFloat(r.calories_per_100g) || null,
            protein: parseFloat(r.protein_per_100g) || null, fat: parseFloat(r.fat_per_100g) || null,
            salt: parseFloat(r.salt_per_100g) || null, notes: r.notes || "",
            favorite: r.is_favorite === "true", usageCount: parseInt(r.usage_count, 10) || 0
          }));
        }
        let added = 0, updated = 0;
        imported.forEach(item => {
          if (!item.name) return;
          const existing = state.library.find(f => f.name.toLowerCase() === item.name.toLowerCase());
          if (existing) { Object.assign(existing, item, { id: existing.id }); updated++; }
          else { state.library.push({ id: "food-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6), usageCount: 0, ...item }); added++; }
        });
        saveState();
        renderLibrary();
        renderSettings();
        alert(`Import complete: ${added} added, ${updated} updated.`);
      } catch (err) {
        console.error(err);
        alert("Could not read that file. Make sure it's a CSV or JSON export.");
      }
      e.target.value = "";
    };
    reader.readAsText(file);
  });

  function parseCsv(text) {
    const lines = text.split(/\r?\n/).filter(l => l.trim().length);
    if (lines.length < 2) return [];
    const headers = splitCsvLine(lines[0]);
    return lines.slice(1).map(line => {
      const cells = splitCsvLine(line);
      const obj = {};
      headers.forEach((h, i) => { obj[h] = cells[i]; });
      return obj;
    });
  }
  function splitCsvLine(line) {
    const out = [];
    let cur = "", inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQuotes) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') { inQuotes = false; }
        else cur += c;
      } else {
        if (c === '"') inQuotes = true;
        else if (c === ",") { out.push(cur); cur = ""; }
        else cur += c;
      }
    }
    out.push(cur);
    return out;
  }

  el("btn-export-all").addEventListener("click", () => {
    downloadText(`insulin-buddy-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(state, null, 2), "application/json");
  });

  el("btn-import-all").addEventListener("click", () => el("import-all-file-input").click());
  el("import-all-file-input").addEventListener("change", e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        let foodsAdded = 0, foodsUpdated = 0, recipesAdded = 0, recipesUpdated = 0, historyAdded = 0;

        (data.library || []).forEach(item => {
          if (!item.name) return;
          const existing = state.library.find(f => f.name.toLowerCase() === item.name.toLowerCase());
          if (existing) { Object.assign(existing, item, { id: existing.id }); foodsUpdated++; }
          else { state.library.push({ ...item, id: item.id || ("food-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6)) }); foodsAdded++; }
        });
        (data.recipes || []).forEach(item => {
          if (!item.name) return;
          const existing = state.recipes.find(r => r.name.toLowerCase() === item.name.toLowerCase());
          if (existing) { Object.assign(existing, item, { id: existing.id }); recipesUpdated++; }
          else { state.recipes.push({ ...item, id: item.id || ("recipe-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6)) }); recipesAdded++; }
        });
        (data.history || []).forEach(entry => {
          if (!state.history.find(h => h.id === entry.id)) { state.history.push(entry); historyAdded++; }
        });
        state.history.sort((a, b) => b.ts - a.ts);

        saveState();
        renderLibrary(); renderHistory(); renderSettings();
        alert(`Import complete.\nFoods: ${foodsAdded} added, ${foodsUpdated} updated.\nRecipes: ${recipesAdded} added, ${recipesUpdated} updated.\nHistory: ${historyAdded} added.\n\nSettings were left untouched.`);
      } catch (err) {
        console.error(err);
        alert("Could not read that file. Make sure it's a JSON backup exported from this app.");
      }
      e.target.value = "";
    };
    reader.readAsText(file);
  });

  // ---- General tab ----
  function renderPaletteGrid() {
    const grid = el("palette-grid");
    grid.innerHTML = PALETTES.map(p => `
      <button class="palette-card${state.settings.palette === p.id ? " is-selected" : ""}" data-id="${p.id}" type="button">
        ${state.settings.palette === p.id ? `<span class="palette-card__check"><svg viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>` : ""}
        <span class="palette-card__dots">${p.dots.map(c => `<span style="background:${c}"></span>`).join("")}</span>
        <span class="palette-card__name">${p.name}</span>
      </button>
    `).join("");
  }
  el("palette-grid").addEventListener("click", e => {
    const card = e.target.closest(".palette-card");
    if (!card) return;
    state.settings.palette = card.dataset.id;
    document.documentElement.setAttribute("data-palette", card.dataset.id);
    saveState();
    renderPaletteGrid();
  });

  el("dark-mode-toggle").addEventListener("change", e => {
    state.settings.darkMode = e.target.checked;
    document.documentElement.setAttribute("data-theme", state.settings.darkMode ? "dark" : "light");
    saveState();
  });

  el("btn-refresh-app").addEventListener("click", () => location.reload());

  el("btn-delete-all").addEventListener("click", () => {
    if (!confirm("This deletes ALL data — settings, library, recipes and history — from this browser. This can't be undone. Continue?")) return;
    localStorage.removeItem(STORAGE_KEY);
    state = defaultState();
    document.documentElement.setAttribute("data-palette", state.settings.palette);
    document.documentElement.setAttribute("data-theme", "light");
    draft = { items: [], correctionOn: false, glucose: "", manualRatioId: null };
    renderFoodPickList(); renderMealItems(); recompute();
    renderLibrary(); renderHistory(); renderSettings();
    alert("All data has been deleted.");
  });

  // ================= Init =================
  document.documentElement.setAttribute("data-palette", state.settings.palette);
  document.documentElement.setAttribute("data-theme", state.settings.darkMode ? "dark" : "light");
  renderFoodPickList();
  renderMealItems();
  recompute();
  showView("calculator");

  // Keep the auto-selected ratio (and the settings timeline's "now" marker) accurate
  // as real time passes, not just at page load.
  setInterval(() => {
    if (!draft.manualRatioId) recompute();
    if (!el("view-settings").hidden && !panelRatios.hidden) renderTimeline();
  }, 30000);
})();
