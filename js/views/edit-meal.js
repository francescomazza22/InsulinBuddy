// The Edit Meal sheet for a logged meal. Its dose comes from recalculateEntryDose in js/calc.js -- the same
// calculation as the Calculator -- so the preview it shows is exactly what saving stores.
import { compoundGiInfo, recalculateEntryDose } from "../calc.js";
import { MEAL_TYPES } from "../constants.js";
import { queueNsUpdate } from "../services/nightscout-sync.js";
import { saveState, state, unitLabel } from "../services/store.js";
import { dialogs } from "../ui/dom.js";
import { createSheet, sheetHeader } from "../ui/sheets.js";
import { escapeHtml, formatQty, round1, toDatetimeLocalValue } from "../util.js";
import { renderActivePanel } from "./active-insulin.js";
import { renderRecentMeals } from "./calculator.js";
import { renderHistory } from "./history-log.js";


export function openEditMealSheet(entry) {
  let items = entry.items.map(i => ({ ...i }));
  let mealType = entry.mealType;
  const allRatios = [
    ...state.settings.timeRatios.map(r => ({ ...r, kind: "time" })),
    ...state.settings.activityRatios.map(r => ({ ...r, kind: "activity" }))
  ];
  const matchedRatio = allRatios.find(r => r.name === entry.ratioLabel);
  let selectedRatioValue = entry.ratioValue;
  let selectedRatioLabel = entry.ratioLabel;

  const { backdrop, close } = createSheet({
    labelledBy: "em-title", closeOn: ["#em-cancel"],
    content: `
      ${sheetHeader("Edit Meal", { titleId: "em-title" })}
      <label class="block-label">Meal type</label>
      <div class="field-grid" id="em-meal-types" style="margin-bottom:18px;">
        ${Object.entries(MEAL_TYPES).map(([key, m]) => `
          <button class="btn btn--secondary" data-meal="${key}" type="button" style="display:flex;align-items:center;gap:8px;justify-content:center;${key === mealType ? `border-color:${m.color};color:${m.color};background:${m.color}1a;` : ""}">
            <span style="color:${m.color};width:18px;height:18px;">${m.icon}</span>${m.label}
          </button>
        `).join("")}
      </div>
      <div class="field">
        <label for="em-logged-time">Logged time</label>
        <input type="datetime-local" id="em-logged-time" value="${toDatetimeLocalValue(entry.ts)}" style="padding:12px 14px; border:1.5px solid var(--line); border-radius:var(--radius-s); font-size:16px; background:var(--surface); color:var(--ink); font-family:var(--font-ui);">
        <p class="panel-card__hint" style="margin-top:6px;">Changing this updates Active Insulin &amp; Carbs and Trends to match.</p>
      </div>
      <label class="block-label">Insulin ratio</label>
      <select id="em-ratio" style="width:100%; padding:12px 14px; border:1.5px solid var(--line); border-radius:var(--radius-s); font-size:0.96rem; margin-bottom:18px; background:var(--surface); color:var(--ink);">
        ${!matchedRatio ? `<option value="__original__" selected>Original: ${escapeHtml(entry.ratioLabel || "—")} (1:${entry.ratioValue})</option>` : ""}
        ${allRatios.map(r => `<option value="${r.id}" ${matchedRatio && matchedRatio.id === r.id ? "selected" : ""}>${escapeHtml(r.name)} (1:${r.ratio})</option>`).join("")}
      </select>
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
      </div>`
  });

  function renderItems() {
    backdrop.querySelector("#em-items").innerHTML = items.map((it, idx) => {
      const isUnit = it.quantity != null && it.unitLabel;
      const val = isUnit ? formatQty(it.quantity) : it.grams;
      const suffix = isUnit ? escapeHtml(it.unitLabel) + (it.quantity === 1 ? "" : "s") : "g";
      return `
      <div class="ingredient-row">
        <span class="ingredient-row__name">${escapeHtml(it.name)}</span>
        <input type="number" min="0" step="${isUnit ? "0.5" : "1"}" value="${val}" data-idx="${idx}" class="em-grams-input" style="width:70px;padding:6px 8px;text-align:right;">
        <span style="width:34px;font-size:0.8rem;color:var(--ink-soft);">${suffix}</span>
        <button type="button" data-idx="${idx}" class="em-remove" aria-label="Remove item">
          <svg viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        </button>
      </div>
    `;
    }).join("");
    updatePreview();
  }

  // ONE calculation for both the preview and the save, so the preview can never promise a dose that saving then
  // stores differently -- and it is the same computeDose the Calculator uses (see recalculateEntryDose).
  function editDose(totalCarbs) {
    const glucoseEl = backdrop.querySelector("#em-glucose");
    return recalculateEntryDose({ entry, carbs: totalCarbs, ratio: selectedRatioValue, glucose: glucoseEl ? glucoseEl.value : null, settings: state.settings });
  }

  function updatePreview() {
    const totalCarbs = round1(items.reduce((s, i) => s + i.carbs, 0));
    const dose = editDose(totalCarbs);
    const capText = dose.capped ? ` — capped at your ${state.settings.maxDose} u maximum (calculated ${dose.requestedDose} u)`
      : dose.overMax ? ` — above your ${state.settings.maxDose} u maximum` : "";
    const carbsText = entry.carbsUnknown ? "carbs not logged" : `${round1(totalCarbs)}g carbs`;
    const ratioText = selectedRatioValue && !entry.carbsUnknown ? ` (using ${selectedRatioLabel ? selectedRatioLabel + " " : ""}1:${selectedRatioValue})` : "";
    backdrop.querySelector("#em-preview").textContent = `New total: ${carbsText} → ${dose.finalDose.toFixed(1)} units${ratioText}${capText}`;
  }

  backdrop.querySelector("#em-meal-types").addEventListener("click", e => {
    const btn = e.target.closest("[data-meal]");
    if (!btn) return;
    mealType = btn.dataset.meal;
    backdrop.querySelectorAll("#em-meal-types button").forEach(b => { b.style.borderColor = ""; b.style.color = ""; b.style.background = ""; });
    const m = MEAL_TYPES[mealType];
    btn.style.borderColor = m.color; btn.style.color = m.color; btn.style.background = m.color + "1a";
  });
  backdrop.querySelector("#em-items").addEventListener("input", e => {
    if (!e.target.classList.contains("em-grams-input")) return;
    const idx = parseInt(e.target.dataset.idx, 10);
    const entered = parseFloat(e.target.value) || 0;
    const it = items[idx];
    let grams;
    if (it.quantity != null && it.gramsPerUnit) {
      it.quantity = entered;
      grams = entered * it.gramsPerUnit;
    } else {
      grams = entered;
    }
    it.grams = grams;
    it.carbs = it.carbsPer100g != null ? Math.round(it.carbsPer100g * grams) / 100 : it.carbs;
    it.kcal = it.kcalPer100g ? Math.round(it.kcalPer100g * grams) / 100 : it.kcal;
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
  backdrop.querySelector("#em-ratio").addEventListener("change", e => {
    const chosen = allRatios.find(r => r.id === e.target.value);
    if (chosen) { selectedRatioValue = chosen.ratio; selectedRatioLabel = chosen.name; }
    else { selectedRatioValue = entry.ratioValue; selectedRatioLabel = entry.ratioLabel; } // "__original__"
    updatePreview();
  });

  renderItems();
  backdrop.querySelector("#em-save").addEventListener("click", () => {
    // An Eating Out entry never had items (its carbs weren't counted), so it can be saved without any.
    if (items.length === 0 && entry.mealType !== "correction" && !entry.carbsUnknown) { dialogs.alert("A meal needs at least one item — delete it instead if you want it gone."); return; }
    const totalCarbs = round1(items.reduce((s, i) => s + i.carbs, 0));
    const totalKcal = Math.round(items.reduce((s, i) => s + (i.kcal || 0), 0));
    // The same calculation the preview just showed, so what it promised is what gets saved.
    const dose = editDose(totalCarbs);
    const mealDose = dose.loggedMeal;
    const correctionDose = dose.loggedCorrection;
    const glucoseInputEl2 = backdrop.querySelector("#em-glucose");
    let newGlucose = entry.glucose;
    if (glucoseInputEl2) newGlucose = parseFloat(glucoseInputEl2.value) || null;
    entry.mealType = mealType;
    entry.items = items;
    entry.totalCarbs = totalCarbs;
    entry.totalKcal = totalKcal;
    entry.mealDose = mealDose;
    entry.correctionDose = correctionDose;
    if (dose.capped) entry.cappedFrom = dose.requestedDose; else delete entry.cappedFrom;
    entry.glucose = newGlucose;
    entry.ratioValue = selectedRatioValue;
    entry.ratioLabel = selectedRatioLabel;
    entry.glycemicLoad = compoundGiInfo(items);   // was left stale, which skewed carb absorption after an edit
    const timeInputEl = backdrop.querySelector("#em-logged-time");
    if (timeInputEl && timeInputEl.value) {
      const newTs = new Date(timeInputEl.value).getTime();
      if (!isNaN(newTs)) {
        entry.ts = newTs;
        state.history.sort((a, b) => b.ts - a.ts);
      }
    }
    saveState();
    queueNsUpdate(entry);
    renderHistory();
    renderActivePanel();
    renderRecentMeals();
    close();
  });
}
