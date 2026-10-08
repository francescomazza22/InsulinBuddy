// The Calculator tab: building a meal from the food list, the correction / Treating a Low / Eating Out modes, the
// dose card (its numbers all come from calculatorDose in js/calc.js), logging the meal, and the "Recently Logged"
// row. The meal being built (the draft) is saved as it changes, so it survives the app being reloaded.
import { calculatorDose, compoundGiInfo, convertGlucose, giBand, glucoseRangeClass, glucoseTrendArrow } from "../calc.js";
import { pickableItems } from "../foods.js";
import { isBasalEntry, mealLabel, recentDistinctMeals } from "../history.js";
import { KEYS } from "../keys.js";
import { timeRatioAt } from "../ratios.js";
import { LIVE_GLUCOSE_STALE_MS, liveGlucose, saveGlucoseReadings } from "../services/glucose-data.js";
import { friendlyNsError, nightscoutConfigured, nsCfg, nsClient, syncEntryToNightscout } from "../services/nightscout-sync.js";
import { calcActiveInsulinAndCarbs, saveState, state, unitLabel } from "../services/store.js";
import { dialogs, el } from "../ui/dom.js";
import { escapeHtml, formatQty, makeId, parseDecimalInput, round1 } from "../util.js";
import { renderActivePanel } from "./active-insulin.js";
import { showView } from "./shell.js";

// ---------- draft (the in-progress calculator entry; saved to localStorage as it changes, see saveDraftLocal) ----------
function emptyDraft() {
  return {
    items: [],               // { refType, refId, name, grams, carbs, kcal, ... }
    correctionOn: false,
    correctionManual: false, // correction typed in units rather than calculated from glucose
    noInsulinOn: false,      // "Treating a Low" — logs carbs with zero insulin regardless of ratio/correction
    eatingOutOn: false,      // "Eating Out" — logs a typed insulin dose with no carb count
    glucose: "",
    glucoseUnit: null,       // "mgdl" | "mmol" — which unit the glucose reading is entered in; null = follow Settings
    manualRatioId: null      // overrides time-of-day auto ratio; can be a timeRatio or activityRatio id
  };
}
export let draft = emptyDraft();

function activeRatioEntry() {
  if (draft.manualRatioId) {
    const t = state.settings.timeRatios.find(r => r.id === draft.manualRatioId);
    if (t) return t;
    const a = state.settings.activityRatios.find(r => r.id === draft.manualRatioId);
    if (a) return a;
  }
  return timeRatioAt(state.settings.timeRatios);
}

// ---------- the Calculator's elements ----------
const carbsPill = el("cc-carbs-pill");
const doseNumber = el("cc-dose-number");
const correctionToggle = el("cc-correction-toggle");
const correctionRow = el("cc-correction-row");
const glucoseInput = el("cc-glucose");
const glucoseUnitBtn = el("cc-glucose-unit");
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

export function renderFoodPickList() {
  const q = searchInput.value.trim().toLowerCase();
  let items = pickableItems(state.library, state.recipes);
  if (q) items = items.filter(i => i.name.toLowerCase().includes(q));
  items.sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0) || a.name.localeCompare(b.name));
  items = items.slice(0, 40);

  foodListBox.innerHTML = "";
  items.forEach(item => {
    const row = document.createElement("div");
    row.className = "food-pick-item" + (selectedPickId === item.id ? " is-selected" : "");
    row.dataset.id = item.id;
    const unitSuffix = item.unitBased ? `/${escapeHtml(item.unitLabel)}` : "/100g";
    const meta = `<span class="c-carbs">${item.carbsPer100g ?? "?"}g</span>${item.kcalPer100g ? ` · <span class="c-kcal">~${item.kcalPer100g}kcal</span>` : ""} ${unitSuffix}`;
    row.innerHTML = `
      <div class="food-pick-item__main">
        <p class="food-pick-item__row">
          <span class="food-pick-item__name">${escapeHtml(item.name)}</span>
          <span class="food-pick-item__meta">${meta}</span>
        </p>
        ${item.notes ? `<p class="food-pick-item__note">${escapeHtml(item.notes)}</p>` : ""}
      </div>
      ${item.refType === "recipe" ? '<span class="food-pick-item__badge">Recipe</span>' : (item.usageCount ? `<span class="food-pick-item__badge">${item.usageCount}×</span>` : "")}
    `;
    foodListBox.appendChild(row);
  });
}

const searchClearBtn = el("cc-search-clear");

function addSelectedToMeal() {
  if (!selectedPickId) return;
  const [type, id] = selectedPickId.split(":");
  const items = pickableItems(state.library, state.recipes);
  const item = items.find(i => i.id === selectedPickId);
  if (!item || item.carbsPer100g == null) return;
  const entered = parseFloat(gramsInput.value);
  if (!entered || entered <= 0) { gramsInput.focus(); return; }

  let grams, quantity = null, unitLabel = null;
  if (item.unitBased) {
    quantity = entered;
    unitLabel = item.unitLabel;
    grams = quantity * item.gramsPerUnit;
  } else {
    grams = entered;
  }

  draft.items.push({
    refType: type, refId: id, name: item.name, grams, quantity, unitLabel,
    gramsPerUnit: item.unitBased ? item.gramsPerUnit : null,
    carbsPer100g: item.carbsPer100g, kcalPer100g: item.kcalPer100g, gi: item.gi || null,
    carbs: Math.round(item.carbsPer100g * grams) / 100,
    kcal: item.kcalPer100g ? Math.round(item.kcalPer100g * grams) / 100 : null
  });
  selectedPickId = null;
  searchInput.value = "";
  searchClearBtn.hidden = true;
  gramsInput.value = "";
  gramsInput.disabled = false;
  gramsInput.placeholder = "Grams";
  gramsInput.step = "1";
  renderFoodPickList();
  renderMealItems();
  recompute();
  saveDraftLocal();
}

export function renderMealItems() {
  el("cc-current-meal-header").hidden = draft.items.length === 0;
  mealItemsBox.innerHTML = "";
  draft.items.forEach((item, idx) => {
    const row = document.createElement("div");
    row.className = "meal-item";
    row.dataset.idx = idx;
    const isUnit = item.quantity != null && item.unitLabel;
    const qtyDisplay = isUnit ? formatQty(item.quantity) : item.grams;
    const suffix = isUnit ? " " + escapeHtml(item.unitLabel) + (item.quantity === 1 ? "" : "s") : "g";
    row.innerHTML = `
      <button class="meal-item__edit-reveal" type="button" aria-label="Edit">
        <svg viewBox="0 0 24 24" fill="none"><path d="M4 20l4-1 11-11-3-3L5 16z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>
        Edit
      </button>
      <div class="meal-item__content">
        <div class="meal-item__main">
          <p class="meal-item__name">${escapeHtml(item.name)}</p>
          <p class="meal-item__meta">
            <input type="number" class="meal-item__grams-input" min="0" step="${isUnit ? "0.5" : "1"}" value="${qtyDisplay}" data-idx="${idx}" aria-label="${isUnit ? "Quantity" : "Grams"}">${suffix}${item.kcal ? " · ~<span class=\"meal-item__kcal\">" + Math.round(item.kcal) + "</span> kcal" : ""}
          </p>
        </div>
        <div class="meal-item__carbs">${round1(item.carbs)}g</div>
        <button class="meal-item__remove" data-idx="${idx}" aria-label="Remove">
          <svg viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button>
      </div>
    `;
    mealItemsBox.appendChild(row);
  });
}

// ---- Swipe-to-reveal (pointer events unify touch + mouse) ----
const SWIPE_REVEAL_PX = 72;
let swipe = null;
function endSwipe(e) {
  if (!swipe || (e && e.pointerId !== swipe.pointerId)) return;
  swipe.content.style.transition = "";
  const open = swipe.dx < -SWIPE_REVEAL_PX / 2;
  swipe.content.style.transform = open ? `translateX(-${SWIPE_REVEAL_PX}px)` : "translateX(0)";
  swipe.row.classList.toggle("is-swiped", open);
  swipe = null;
}


function totalCarbs() { return draft.items.reduce((s, i) => s + i.carbs, 0); }

// A typed dose that can't be read as a number (letters, "1.2.3") is never half-understood, and must never leave the Log button
// greyed out for no visible reason: say so. (A lone "." or "," is just someone part-way through typing, so it isn't flagged.)
function showDoseEntryProblem(inputId, messageId, active) {
  const text = el(inputId).value.trim();
  const unreadable = active && text !== "" && isNaN(parseDecimalInput(text)) && !/^[.,]$/.test(text);
  el(messageId).hidden = !unreadable;
  el(inputId).setAttribute("aria-invalid", unreadable ? "true" : "false");
}

export function recompute() {
  // Eating Out: carbs aren't being tracked for this entry at all, so the carbs pill and the
  // ratio-based formula are both bypassed in favor of the insulin dose entered directly.
  const carbs = draft.eatingOutOn ? 0 : totalCarbs();
  carbsPill.textContent = draft.eatingOutOn ? "Carbs not logged" : `${round1(carbs)}g Carbs`;

  const ratioEntry = activeRatioEntry();
  ratioValueLabel.textContent = ratioEntry ? `1:${ratioEntry.ratio}` : "—";

  showDoseEntryProblem("cc-eating-out-dose", "cc-eating-out-error", draft.eatingOutOn);
  showDoseEntryProblem("cc-correction-manual-input", "cc-correction-manual-error", draft.correctionOn && draft.correctionManual);

  // All the maths is computeDose in js/calc.js -- the one dose calculation, shared with Edit Meal. A typed dose
  // (Eating Out, manual correction) is used exactly as typed and never capped; it warns instead.
  const calculatingCorrection = draft.correctionOn && !draft.correctionManual;
  const dose = calculatorDose({
    carbs, ratio: ratioEntry ? ratioEntry.ratio : 0, settings: state.settings,
    iob: calculatingCorrection && state.settings.iobAwareCorrection ? calcActiveInsulinAndCarbs().iob : 0,
    noInsulin: draft.noInsulinOn,
    eatingOut: draft.eatingOutOn, eatingOutDose: parseDecimalInput(el("cc-eating-out-dose").value),
    correctionOn: draft.correctionOn, correctionManual: draft.correctionManual,
    correctionDose: parseDecimalInput(el("cc-correction-manual-input").value),
    glucose: glucoseInput.value, glucoseUnit: draft.glucoseUnit
  });

  const iobNote = el("cc-iob-adjust-note");
  if (dose.iobSubtracted > 0.05) {
    iobNote.textContent = `Correction: ${round1(dose.rawCorrection)}u − ${round1(dose.iobSubtracted)}u IOB = ${round1(dose.correctionPart)}u`;
    iobNote.hidden = false;
  } else {
    iobNote.hidden = true;
  }

  doseNumber.textContent = dose.finalDose.toFixed(1);
  const capNote = el("cc-cap-note");
  const showCapNote = dose.capped || dose.overMax;
  capNote.hidden = !showCapNote;
  if (showCapNote) {
    capNote.textContent = dose.capped
      ? `Capped at your ${state.settings.maxDose} u maximum. The calculation came to ${dose.requestedDose} u.`
      : `${dose.finalDose} u is above your ${state.settings.maxDose} u maximum dose. You typed it, so it hasn't been changed. Check it is right.`;
  }

  const hasSomethingToLog = draft.noInsulinOn ? carbs > 0 : (carbs > 0 || dose.correctionPart > 0 || dose.mealPart > 0);
  logBtn.disabled = !hasSomethingToLog;
  // When Log is off, say why, in words, so a greyed-out button is never a mystery.
  const whyEl = el("cc-log-why");
  let why = "";
  if (!hasSomethingToLog) {
    if (draft.correctionOn && draft.correctionManual) {
      const raw = el("cc-correction-manual-input").value.trim();
      if (raw === "") why = "Type the correction dose in the box above.";
      else if (isNaN(parseDecimalInput(raw))) why = "";
      else why = `The dose read as ${raw}, and 0 units has nothing to log.`;
    } else if (draft.correctionOn && glucoseInput.value.trim() !== "") {
      const reading = `${glucoseInput.value.trim()} ${unitLabel(draft.glucoseUnit || state.settings.units)}`;
      why = dose.iobSubtracted > 0.05
        ? `At ${reading} the correction would be ${round1(dose.rawCorrection)}u, but your active insulin (${round1(dose.iobSubtracted)}u) already covers it, so there is nothing to log. Use "Enter dose manually" to give a dose anyway.`
        : `No correction is needed at ${reading}, so there is nothing to log. Use "Enter dose manually" to give a dose anyway.`;
    }
  }
  whyEl.textContent = why; whyEl.hidden = !why;
  logBtn.classList.toggle("btn--pulse", hasSomethingToLog);
  clearAllBtn.hidden = !hasSomethingToLog;

  const glIndicator = el("cc-gl-indicator");
  const giInfo = compoundGiInfo(draft.items);
  if (giInfo) {
    const band = giBand(giInfo.value);
    glIndicator.textContent = `GI ${giInfo.value}${giInfo.partial ? "*" : ""}`;
    glIndicator.className = `gl-indicator gl-indicator--${band}`;
    glIndicator.title = giInfo.partial ? "Compound GI, carb-weighted across this meal's items — not all items have a GI value, so this is a partial estimate" : "Compound GI for this meal, weighted by each item's carb contribution";
    glIndicator.hidden = false;
  } else {
    glIndicator.hidden = true;
  }

  draft._computed = { carbs, mealDose: dose.loggedMeal, correctionDose: dose.loggedCorrection, finalDose: dose.finalDose, ratioEntry, requested: dose.requestedDose, capped: dose.capped };
}

// Manual correction mode: lets a dose be entered directly, skipping the glucose/ISF formula
// for cases where the automatic calculation isn't what's wanted right now (illness, exercise,
// a clinician's instruction for the day, etc.). Starts fresh in automatic mode every time
// correction is turned on for a new meal -- deliberately not sticky across meals, since a
// silent manual override carrying into an unrelated future dose would be an easy way to end
// up giving an unintended dose.
function setCorrectionManualMode(manual) {
  draft.correctionManual = manual;
  el("cc-correction-auto-wrap").hidden = manual;
  el("cc-correction-manual-wrap").hidden = !manual;
  if (manual) { el("cc-correction-manual-input").focus(); }
  else { if (!draft.glucoseUnit) draft.glucoseUnit = state.settings.units; glucoseUnitBtn.textContent = unitLabel(draft.glucoseUnit); glucoseInput.focus(); }
  recompute();
  saveDraftLocal();
}

// Eating Out: the opposite of Treating a Low -- insulin is known exactly (already decided or
// already taken) but carbs aren't worth estimating precisely, so skip food entry entirely and
// log just the insulin dose. Mutually exclusive with Treating a Low (can't simultaneously be
// "no insulin" and "insulin only"); independent of Correction, which can still stack on top.
function setEatingOutMode(on) {
  draft.eatingOutOn = on;
  el("cc-eating-out-toggle").classList.toggle("is-active", on);
  el("cc-eating-out-note").hidden = !on;
  el("cc-eating-out-row").hidden = !on;
  el("cc-food-section").hidden = on;
  if (on) el("cc-eating-out-dose").focus();
}

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

// Persist the in-progress (not-yet-logged) meal to localStorage as it's built,
// so it survives the browser/app reloading the page after being backgrounded —
// which mobile browsers commonly do under memory pressure when you switch apps.
const DRAFT_KEY = KEYS.draft;
export function saveDraftLocal() {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      items: draft.items,
      correctionOn: draft.correctionOn,
      correctionManual: draft.correctionManual,
      correctionManualValue: el("cc-correction-manual-input").value || "",
      noInsulinOn: draft.noInsulinOn,
      eatingOutOn: draft.eatingOutOn,
      eatingOutValue: el("cc-eating-out-dose").value || "",
      glucose: glucoseInput.value || "",
      glucoseUnit: draft.glucoseUnit,
      manualRatioId: draft.manualRatioId
    }));
  } catch (e) { /* storage unavailable — non-fatal, draft just won't survive a reload */ }
}
function loadDraftLocal() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}
function clearDraftLocal() { localStorage.removeItem(DRAFT_KEY); }

export function restoreDraftIfAny() {
  const saved = loadDraftLocal();
  // Eating Out drafts have no items at all (that's the point), so they'd never pass an
  // items-only guard here -- the eatingOutOn flag is itself evidence of a real in-progress
  // entry worth restoring (a typed insulin dose), same as a non-empty item list is otherwise.
  // A correction typed with no foods at all (a manual dose, or a glucose reading) is just as real an in-progress entry as an
  // Eating Out dose, and was being thrown away on reload because it has no items.
  const hasTypedCorrection = !!saved && !!saved.correctionOn && !!(saved.correctionManualValue || saved.glucose);
  if (!saved || (!Array.isArray(saved.items) || saved.items.length === 0) && !saved.eatingOutOn && !hasTypedCorrection) return;
  draft.items = saved.items || [];
  draft.manualRatioId = saved.manualRatioId || null;
  draft.glucoseUnit = saved.glucoseUnit || state.settings.units;
  if (saved.glucose) glucoseInput.value = saved.glucose;
  if (saved.correctionOn) {
    draft.correctionOn = true;
    correctionToggle.classList.add("is-active");
    correctionRow.hidden = false;
    glucoseUnitBtn.textContent = unitLabel(draft.glucoseUnit);
    if (saved.correctionManual) {
      draft.correctionManual = true;
      el("cc-correction-auto-wrap").hidden = true;
      el("cc-correction-manual-wrap").hidden = false;
      if (saved.correctionManualValue) el("cc-correction-manual-input").value = saved.correctionManualValue;
    }
  }
  if (saved.noInsulinOn) {
    draft.noInsulinOn = true;
    el("cc-no-insulin-toggle").classList.add("is-active");
    el("cc-no-insulin-note").hidden = false;
    el("quick-carb-row").hidden = false;
  }
  if (saved.eatingOutOn) {
    draft.eatingOutOn = true;
    el("cc-eating-out-toggle").classList.add("is-active");
    el("cc-eating-out-note").hidden = false;
    el("cc-eating-out-row").hidden = false;
    el("cc-food-section").hidden = true;
    if (saved.eatingOutValue) el("cc-eating-out-dose").value = saved.eatingOutValue;
  }
  renderMealItems();
  recompute();
}


// Puts every Calculator control back to "nothing entered", matching a fresh emptyDraft(). The one place this is
// done, so Reset, Use Again and a full re-render can't drift apart. Doesn't render or save.
function resetCalculatorControls() {
  searchInput.value = ""; searchClearBtn.hidden = true;
  gramsInput.value = ""; gramsInput.disabled = false; gramsInput.placeholder = "Grams"; gramsInput.step = "1";
  glucoseInput.value = "";
  correctionToggle.classList.remove("is-active"); correctionRow.hidden = true;
  el("cc-correction-auto-wrap").hidden = false; el("cc-correction-manual-wrap").hidden = true;
  el("cc-correction-manual-input").value = ""; el("cc-fetch-glucose-status").hidden = true;
  el("cc-no-insulin-toggle").classList.remove("is-active"); el("cc-no-insulin-note").hidden = true; el("quick-carb-row").hidden = true;
  el("cc-eating-out-toggle").classList.remove("is-active"); el("cc-eating-out-note").hidden = true;
  el("cc-eating-out-row").hidden = true; el("cc-eating-out-dose").value = ""; el("cc-food-section").hidden = false;
  ratioPicker.hidden = true;
  selectedPickId = null;
}

// True when the Calculator holds something the person entered: foods, a typed Eating Out dose, or a correction.
function draftHasContent() {
  return draft.items.length > 0
    || (draft.eatingOutOn && el("cc-eating-out-dose").value.trim() !== "")
    || (draft.correctionOn && (glucoseInput.value.trim() !== "" || el("cc-correction-manual-input").value.trim() !== ""));
}

/** A new, empty meal in the Calculator (controls included). Doesn't render or touch the saved draft. */
export function startFreshDraft() {
  draft = emptyDraft();
  resetCalculatorControls();
}

function resetDraft() {
  startFreshDraft();
  clearDraftLocal();
  renderFoodPickList();
  renderMealItems();
  recompute();
}

// Meal type is detected automatically from time of day — no prompt needed
function autoMealType(date) {
  const h = date.getHours() + date.getMinutes() / 60;
  if (h >= 5 && h < 10.5) return "breakfast";
  if (h >= 10.5 && h < 14.5) return "lunch";
  if (h >= 14.5 && h < 18) return "snack";
  if (h >= 18 && h < 22.5) return "dinner";
  return "snack";
}

function logMeal(mealType) {
  const ratioEntry = draft._computed.ratioEntry;
  const now = new Date();
  const periodEntry = timeRatioAt(state.settings.timeRatios, now);
  // Never save a glucose reading for a manual correction, even if one is still sitting in the
  // (now hidden) field from before switching modes -- it wasn't what the logged dose came from.
  const glucoseRaw = (draft.correctionOn && !draft.correctionManual) ? parseFloat(glucoseInput.value) : NaN;
  const glucoseVal = !isNaN(glucoseRaw) ? round1(convertGlucose(glucoseRaw, draft.glucoseUnit || state.settings.units, state.settings.units)) : null;
  const entry = {
    id: makeId("h"),
    ts: now.getTime(),
    mealType,
    periodName: periodEntry ? periodEntry.name.toLowerCase() : "",
    // Eating Out: items aren't saved even if some were added before switching modes -- the
    // whole point of this entry is that carbs weren't counted, so a saved item list with real
    // carb numbers would contradict that.
    items: draft.eatingOutOn ? [] : draft.items.map(i => ({
      refType: i.refType, refId: i.refId, name: i.name, grams: i.grams,
      quantity: i.quantity ?? null, unitLabel: i.unitLabel ?? null, gramsPerUnit: i.gramsPerUnit ?? null,
      gi: i.gi ?? null,
      carbsPer100g: i.carbsPer100g, kcalPer100g: i.kcalPer100g,
      carbs: i.carbs, kcal: i.kcal
    })),
    totalCarbs: draft.eatingOutOn ? 0 : round1(totalCarbs()),
    totalKcal: draft.eatingOutOn ? 0 : Math.round(draft.items.reduce((s, i) => s + (i.kcal || 0), 0)),
    glycemicLoad: draft.eatingOutOn ? null : compoundGiInfo(draft.items),
    carbsUnknown: draft.eatingOutOn,
    mealDose: draft._computed.mealDose,
    correctionDose: draft._computed.correctionDose,
    ...(draft._computed.capped ? { cappedFrom: draft._computed.requested } : {}),   // what it calculated before the cap
    noInsulin: draft.noInsulinOn,
    glucose: glucoseVal,
    ratioLabel: ratioEntry ? ratioEntry.name : "",
    ratioValue: ratioEntry ? ratioEntry.ratio : null
  };
  state.history.unshift(entry);
  if (!draft.eatingOutOn) draft.items.forEach(i => {
    if (i.refType === "food") {
      const f = state.library.find(x => x.id === i.refId);
      if (f) f.usageCount = (f.usageCount || 0) + 1;
    } else {
      const r = state.recipes.find(x => x.id === i.refId);
      if (r) r.usageCount = (r.usageCount || 0) + 1;
    }
  });
  saveState();
  syncEntryToNightscout(entry);
  resetDraft();
  renderActivePanel();
  renderRecentMeals();
}

export function renderLiveGlucosePill() {
  const pill = el("cc-live-glucose");
  if (!pill) return;
  if (!nightscoutConfigured() || !liveGlucose || typeof liveGlucose.mgdl !== "number") { pill.hidden = true; return; }
  const stale = Date.now() - liveGlucose.at > LIVE_GLUCOSE_STALE_MS;
  const value = round1(convertGlucose(liveGlucose.mgdl, "mgdl", state.settings.units));
  const arrow = glucoseTrendArrow(liveGlucose.direction);
  const rangeClass = glucoseRangeClass(liveGlucose.mgdl); // "low" | "high" | "in-range" | null
  const classes = ["glucose-pill"];
  if (rangeClass === "low" || rangeClass === "high") classes.push(`glucose-pill--${rangeClass}`);
  if (stale) classes.push("glucose-pill--stale");
  pill.className = classes.join(" ");
  pill.textContent = arrow ? `${value} ${arrow}` : `${value}`;
  pill.title = stale
    ? "Last reading is more than 15 minutes old"
    : "Latest glucose from Nightscout — always double-check before dosing";
  pill.hidden = false;
}

async function fetchCurrentGlucoseFromNightscout() {
  const statusEl = el("cc-fetch-glucose-status");
  statusEl.hidden = false;
  statusEl.className = "correction-row__fetch-status";
  statusEl.textContent = "Fetching…";
  const cfg = nsCfg();
  if (!cfg) { statusEl.textContent = "Nightscout isn't set up yet."; statusEl.classList.add("correction-row__fetch-status--error"); return; }
  try {
    const r = await nsClient.read(cfg, 1);
    applyFetchedGlucoseEntries(r.entries, statusEl);
    saveGlucoseReadings(r.entries);
  } catch (e) {
    statusEl.textContent = friendlyNsError(e);
    statusEl.classList.add("correction-row__fetch-status--error");
  }
}

function applyFetchedGlucoseEntries(data, statusEl) {
  if (!Array.isArray(data) || data.length === 0 || typeof data[0].sgv !== "number") {
    statusEl.textContent = "Reached Nightscout, but it didn't return a recent glucose reading.";
    statusEl.classList.add("correction-row__fetch-status--error");
    return;
  }
  const latest = data[0];
  const ageMin = Math.round((Date.now() - latest.date) / 60000);
  const ageText = ageMin <= 0 ? "just now" : ageMin === 1 ? "1 minute ago" : `${ageMin} minutes ago`;
  const converted = round1(convertGlucose(latest.sgv, "mgdl", draft.glucoseUnit || state.settings.units));
  glucoseInput.value = converted;
  glucoseInput.dispatchEvent(new Event("input", { bubbles: true }));
  if (ageMin > 15) {
    statusEl.textContent = `Loaded, but this reading is from ${ageText} — that's fairly stale. Worth double-checking before dosing.`;
    statusEl.classList.add("correction-row__fetch-status--error");
  } else {
    statusEl.textContent = `Loaded from ${ageText}. Double-check it looks right before dosing.`;
  }
}

// Recently logged meals: one-tap re-add for the repeats that make up most real usage
// (the same handful of breakfasts/snacks over and over) -- reuses useMealAgain below,
// the same path History's own "repeat this meal" button already takes.
export function renderRecentMeals() {
  const meals = state.settings.showRecentMeals === false ? [] : recentDistinctMeals(state.history, 6);
  el("recent-meals-header").hidden = meals.length === 0;
  el("recent-meals-row").hidden = meals.length === 0;
  el("recent-meals-row").innerHTML = meals.map(entry => `
    <button class="recent-meal-chip" data-id="${entry.id}" type="button">
      <span class="recent-meal-chip__name">${escapeHtml(mealLabel(entry))}</span>
      <span class="recent-meal-chip__meta">${round1(entry.totalCarbs)}g carbs</span>
    </button>
  `).join("");
}

export async function useMealAgain(entry) {
  if (isBasalEntry(entry)) return;   // a basal dose isn't a meal; nothing to put back in the calculator
  if (draftHasContent() && !(await dialogs.confirm("This replaces what's currently in the Calculator.", { title: "Use this meal again?", confirmText: "Replace" }))) return;
  draft = {
    ...emptyDraft(),
    items: entry.items.map(i => ({
      refType: i.refType, refId: i.refId, name: i.name, grams: i.grams,
      quantity: i.quantity ?? null, unitLabel: i.unitLabel ?? null, gramsPerUnit: i.gramsPerUnit ?? null,
      carbsPer100g: i.carbsPer100g, kcalPer100g: i.kcalPer100g, gi: i.gi ?? null, carbs: i.carbs, kcal: i.kcal
    }))
  };
  resetCalculatorControls();
  renderFoodPickList(); renderMealItems(); recompute();
  saveDraftLocal();   // so a reload keeps the repeated meal instead of bringing back whatever was saved before
  showView("calculator");
}

/** Event wiring. Called once by app.js, after every module has loaded. */
export function initCalculator() {

  foodListBox.addEventListener("click", e => {
    const row = e.target.closest(".food-pick-item");
    if (!row) return;
    selectedPickId = row.dataset.id;
    const items = pickableItems(state.library, state.recipes);
    const item = items.find(i => i.id === selectedPickId);
    if (!item) return;
    searchInput.value = item.name;
    renderFoodPickList();
    gramsInput.disabled = false;
    gramsInput.placeholder = item.unitBased ? "Qty" : "Grams";
    gramsInput.step = item.unitBased ? "0.5" : "1";
    gramsInput.focus();
  });
  searchInput.addEventListener("input", () => {
    selectedPickId = null;
    gramsInput.placeholder = "Grams";
    gramsInput.step = "1";
    searchClearBtn.hidden = searchInput.value.length === 0;
    renderFoodPickList();
  });
  searchClearBtn.addEventListener("click", () => {
    searchInput.value = "";
    searchInput.dispatchEvent(new Event("input", { bubbles: true }));
    searchInput.focus();
  });

  addBtn.addEventListener("click", addSelectedToMeal);
  gramsInput.addEventListener("keydown", e => { if (e.key === "Enter") addSelectedToMeal(); });

  // Quick-carb chips (Treating a Low): one tap to log a fixed amount of fast carbs, no food
  // search needed. carbsPer100g: 100 is a deliberate trick, not an approximation -- it makes
  // "grams entered" exactly equal "carbs", so this plugs into the normal item-editing flow
  // (the grams input, recompute, etc.) with no special-casing needed anywhere else.
  el("quick-carb-row").addEventListener("click", e => {
    const chip = e.target.closest(".quick-carb-chip");
    if (!chip) return;
    const grams = parseFloat(chip.dataset.grams);
    draft.items.push({
      refType: "quick", refId: null, name: "Fast carbs", grams, quantity: null, unitLabel: null,
      gramsPerUnit: null, carbsPer100g: 100, kcalPer100g: 0, gi: null, carbs: grams, kcal: null
    });
    renderMealItems();
    recompute();
    saveDraftLocal();
  });

  mealItemsBox.addEventListener("click", e => {
    const removeBtn = e.target.closest(".meal-item__remove");
    if (removeBtn) {
      draft.items.splice(parseInt(removeBtn.dataset.idx, 10), 1);
      renderMealItems();
      recompute();
      saveDraftLocal();
      return;
    }
    const editBtn = e.target.closest(".meal-item__edit-reveal");
    if (editBtn) {
      const row = editBtn.closest(".meal-item");
      const content = row.querySelector(".meal-item__content");
      content.style.transform = "translateX(0)";
      row.classList.remove("is-swiped");
      const gramsInput = row.querySelector(".meal-item__grams-input");
      gramsInput.classList.add("is-editing");
      gramsInput.focus();
      gramsInput.select();
    }
  });

  mealItemsBox.addEventListener("focusout", e => {
    if (!e.target.classList.contains("meal-item__grams-input")) return;
    e.target.classList.remove("is-editing");
  });

  mealItemsBox.addEventListener("input", e => {
    if (!e.target.classList.contains("meal-item__grams-input")) return;
    const idx = parseInt(e.target.dataset.idx, 10);
    const item = draft.items[idx];
    if (!item) return;
    const entered = parseFloat(e.target.value) || 0;
    let grams;
    if (item.quantity != null && item.gramsPerUnit) {
      item.quantity = entered;
      grams = entered * item.gramsPerUnit;
    } else {
      grams = entered;
    }
    item.grams = grams;
    item.carbs = item.carbsPer100g != null ? Math.round(item.carbsPer100g * grams) / 100 : item.carbs;
    item.kcal = item.kcalPer100g ? Math.round(item.kcalPer100g * grams) / 100 : item.kcal;
    const row = e.target.closest(".meal-item");
    row.querySelector(".meal-item__carbs").textContent = round1(item.carbs) + "g";
    const kcalEl = row.querySelector(".meal-item__kcal");
    if (kcalEl && item.kcal) kcalEl.textContent = Math.round(item.kcal);
    recompute();
    saveDraftLocal();
  });
  mealItemsBox.addEventListener("pointerdown", e => {
    const content = e.target.closest(".meal-item__content");
    if (!content || e.target.closest(".meal-item__remove") || e.target.closest(".meal-item__grams-input")) return;
    swipe = { content, row: content.closest(".meal-item"), startX: e.clientX, dx: 0, pointerId: e.pointerId };
    content.style.transition = "none";
    try { content.setPointerCapture(e.pointerId); } catch (err) { /* not supported everywhere, harmless to skip */ }
  });
  mealItemsBox.addEventListener("pointermove", e => {
    if (!swipe || e.pointerId !== swipe.pointerId) return;
    const alreadyOpen = swipe.row.classList.contains("is-swiped");
    const base = alreadyOpen ? -SWIPE_REVEAL_PX : 0;
    swipe.dx = Math.max(-SWIPE_REVEAL_PX, Math.min(0, base + (e.clientX - swipe.startX)));
    swipe.content.style.transform = `translateX(${swipe.dx}px)`;
  });
  mealItemsBox.addEventListener("pointerup", endSwipe);
  mealItemsBox.addEventListener("pointercancel", endSwipe);
  el("cc-correction-manual-link").addEventListener("click", () => setCorrectionManualMode(true));
  el("cc-correction-auto-link").addEventListener("click", () => setCorrectionManualMode(false));
  el("cc-correction-manual-input").addEventListener("input", () => { recompute(); saveDraftLocal(); });

  correctionToggle.addEventListener("click", () => {
    draft.correctionOn = !draft.correctionOn;
    correctionToggle.classList.toggle("is-active", draft.correctionOn);
    correctionRow.hidden = !draft.correctionOn;
    draft.correctionManual = false;
    el("cc-correction-auto-wrap").hidden = false;
    el("cc-correction-manual-wrap").hidden = true;
    el("cc-correction-manual-input").value = "";
    el("cc-fetch-glucose").hidden = !(draft.correctionOn && nightscoutConfigured());
    el("cc-fetch-glucose-status").hidden = true;
    if (draft.correctionOn && draft.noInsulinOn) {
      draft.noInsulinOn = false;
      el("cc-no-insulin-toggle").classList.remove("is-active");
      el("cc-no-insulin-note").hidden = true;
      el("quick-carb-row").hidden = true;
    }
    if (!draft.glucoseUnit) draft.glucoseUnit = state.settings.units;
    glucoseUnitBtn.textContent = unitLabel(draft.glucoseUnit);
    if (draft.correctionOn) glucoseInput.focus();
    recompute();
    saveDraftLocal();
  });

  el("cc-no-insulin-toggle").addEventListener("click", () => {
    draft.noInsulinOn = !draft.noInsulinOn;
    el("cc-no-insulin-toggle").classList.toggle("is-active", draft.noInsulinOn);
    el("cc-no-insulin-note").hidden = !draft.noInsulinOn;
    el("quick-carb-row").hidden = !draft.noInsulinOn;
    if (draft.noInsulinOn && draft.correctionOn) {
      draft.correctionOn = false;
      correctionToggle.classList.remove("is-active");
      correctionRow.hidden = true;
    }
    if (draft.noInsulinOn && draft.eatingOutOn) setEatingOutMode(false);
    recompute();
    saveDraftLocal();
  });
  el("cc-eating-out-toggle").addEventListener("click", () => {
    setEatingOutMode(!draft.eatingOutOn);
    if (draft.eatingOutOn && draft.noInsulinOn) {
      draft.noInsulinOn = false;
      el("cc-no-insulin-toggle").classList.remove("is-active");
      el("cc-no-insulin-note").hidden = true;
      el("quick-carb-row").hidden = true;
    }
    recompute();
    saveDraftLocal();
  });
  el("cc-eating-out-dose").addEventListener("input", () => { recompute(); saveDraftLocal(); });
  glucoseInput.addEventListener("input", () => { recompute(); saveDraftLocal(); });
  glucoseUnitBtn.addEventListener("click", () => {
    const newUnit = draft.glucoseUnit === "mmol" ? "mgdl" : "mmol";
    const current = parseFloat(glucoseInput.value);
    if (!isNaN(current)) {
      const converted = convertGlucose(current, draft.glucoseUnit, newUnit);
      glucoseInput.value = newUnit === "mmol" ? round1(converted) : Math.round(converted);
    }
    draft.glucoseUnit = newUnit;
    glucoseUnitBtn.textContent = unitLabel(newUnit);
    recompute();
    saveDraftLocal();
  });

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
    saveDraftLocal();
  });
  document.addEventListener("click", () => { ratioPicker.hidden = true; });
  document.addEventListener("keydown", e => { if (e.key === "Escape") ratioPicker.hidden = true; });
  resetBtn.addEventListener("click", resetDraft);
  clearAllBtn.addEventListener("click", resetDraft);

  logBtn.addEventListener("click", () => {
    const hasCorrection = draft._computed && draft._computed.correctionDose > 0;
    const hasEatingOutDose = draft.eatingOutOn && draft._computed && draft._computed.mealDose > 0;
    if (totalCarbs() <= 0 && !hasCorrection && !hasEatingOutDose) return;
    logMeal(totalCarbs() > 0 || hasEatingOutDose ? autoMealType(new Date()) : "correction");
  });

  el("cc-fetch-glucose").addEventListener("click", fetchCurrentGlucoseFromNightscout);
  el("recent-meals-row").addEventListener("click", e => {
    const chip = e.target.closest(".recent-meal-chip");
    if (!chip) return;
    const entry = state.history.find(h => h.id === chip.dataset.id);
    if (entry) useMealAgain(entry);
  });
}
