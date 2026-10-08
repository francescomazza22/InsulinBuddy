// The Settings tab and its Insulin Ratios panel: time-of-day and activity ratios, correction settings, and insulin
// & carb timing. The Data and General panels are in settings-data.js and settings-general.js.
import { INSULIN_PRESETS, RANGE_COLORS } from "../constants.js";
import { toMinutes } from "../ratios.js";
import { saveState, state, unitLabel } from "../services/store.js";
import { dialogs, el } from "../ui/dom.js";
import { escapeHtml, makeId } from "../util.js";
import { renderActivePanel } from "./active-insulin.js";
import { recompute } from "./calculator.js";
import { renderAccountSection, renderBackupsSection, renderDiagSection, renderNightscoutSection, renderStatusPanel } from "./settings-data.js";
import { renderBackgroundSection, renderPaletteGrid, renderPrivacySection } from "./settings-general.js";

let settingsSeg = "ratios";
const settingsSegmented = el("settings-segmented");
export const panelRatios = el("panel-ratios");
const panelData = el("panel-data");
const panelGeneral = el("panel-general");

export function renderSettings() {
  panelRatios.hidden = settingsSeg !== "ratios";
  panelData.hidden = settingsSeg !== "data";
  panelGeneral.hidden = settingsSeg !== "general";
  renderTimeline();
  renderTimeRatioList();
  renderActivityRatioList();
  fillCorrectionForm();
  el("export-count-label").textContent = `${state.library.length} foods · ${state.recipes.length} recipes`;
  renderPaletteGrid();
  renderBackgroundSection();
  renderStatusPanel();
  renderInsulinCarbSettings();
  el("dark-mode-toggle").checked = state.settings.darkMode;
  el("dark-mode-toggle").disabled = state.settings.darkModeAuto;
  el("show-recent-meals-toggle").checked = state.settings.showRecentMeals !== false;
  el("dark-mode-auto-toggle").checked = state.settings.darkModeAuto;
  renderAccountSection();
  renderNightscoutSection();
  renderBackupsSection();
  renderDiagSection();

  renderPrivacySection();
}


export function statusRow(label, dotClass, detail) {
  return `<div class="status-row"><span class="status-dot status-dot--${dotClass}"></span><div><p class="status-row__title">${label}</p><p class="status-row__detail">${detail}</p></div></div>`;
}
function clampNum(n, min, max) { return Math.min(max, Math.max(min, n)); }

function renderInsulinCarbSettings() {
  const im = state.settings.insulinModel;
  const ca = state.settings.carbAbsorptionMinutes;
  document.querySelectorAll("#insulin-preset-buttons .insulin-preset-btn").forEach(btn => {
    btn.classList.toggle("is-active", btn.dataset.preset === im.preset);
  });
  el("insulin-peak-input").value = im.peakMinutes;
  el("insulin-dia-input").value = im.diaMinutes;
  el("carb-abs-high").value = ca.high;
  el("carb-abs-medium").value = ca.medium;
  el("carb-abs-low").value = ca.low;
  el("carb-abs-unknown").value = ca.unknown;
  el("iob-aware-correction-toggle").checked = state.settings.iobAwareCorrection;
}

function handleInsulinFieldEdit() {
  const dia = clampNum(parseInt(el("insulin-dia-input").value, 10) || 360, 180, 600);
  const peakRaw = clampNum(parseInt(el("insulin-peak-input").value, 10) || 75, 20, 120);
  // tau's denominator is (1 - 2*peak/dia); peak must stay well below half of
  // DIA or the exponential curve becomes numerically unstable. Clamping here
  // rather than just validating keeps the field always usable.
  const peak = Math.min(peakRaw, Math.floor(dia / 2) - 10);
  state.settings.insulinModel = { preset: "custom", peakMinutes: peak, diaMinutes: dia };
  saveState();
  renderInsulinCarbSettings();
  renderActivePanel();
}

function handleCarbAbsEdit() {
  state.settings.carbAbsorptionMinutes = {
    high: clampNum(parseInt(el("carb-abs-high").value, 10) || 120, 30, 360),
    medium: clampNum(parseInt(el("carb-abs-medium").value, 10) || 180, 30, 360),
    low: clampNum(parseInt(el("carb-abs-low").value, 10) || 240, 30, 480),
    unknown: clampNum(parseInt(el("carb-abs-unknown").value, 10) || 180, 30, 480)
  };
  saveState();
  renderInsulinCarbSettings();
  renderActivePanel();
}

export function renderTimeline() {
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
    row.style.borderLeft = `4px solid ${r.color}`;
    row.style.background = `${r.color}12`;
    row.innerHTML = `
      <div class="ratio-row__top" data-toggle="${r.id}" style="cursor:pointer;">
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

function renderActivityRatioList() {
  const box = el("activity-ratio-list");
  box.innerHTML = "";
  state.settings.activityRatios.forEach(r => {
    const row = document.createElement("div");
    row.className = "ratio-row";
    row.style.borderLeft = `4px solid ${r.color}`;
    row.style.background = `${r.color}12`;
    row.innerHTML = `
      <div class="ratio-row__top">
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

/** Event wiring. Called once by app.js, after every module has loaded. */
export function initSettings() {

  settingsSegmented.addEventListener("click", e => {
    const btn = e.target.closest(".segmented__btn");
    if (!btn) return;
    settingsSeg = btn.dataset.seg;
    settingsSegmented.querySelectorAll(".segmented__btn").forEach(b => b.classList.toggle("is-active", b === btn));
    panelRatios.hidden = settingsSeg !== "ratios";
    panelData.hidden = settingsSeg !== "data";
    panelGeneral.hidden = settingsSeg !== "general";
  });

  el("iob-aware-correction-toggle").addEventListener("change", e => {
    state.settings.iobAwareCorrection = e.target.checked;
    saveState();
    recompute();
  });

  el("insulin-preset-buttons").addEventListener("click", e => {
    const btn = e.target.closest(".insulin-preset-btn");
    if (!btn) return;
    const preset = btn.dataset.preset;
    state.settings.insulinModel.preset = preset;
    if (INSULIN_PRESETS[preset]) Object.assign(state.settings.insulinModel, INSULIN_PRESETS[preset]);
    saveState();
    renderInsulinCarbSettings();
    renderActivePanel();
  });
  el("insulin-peak-input").addEventListener("change", handleInsulinFieldEdit);
  el("insulin-dia-input").addEventListener("change", handleInsulinFieldEdit);
  ["carb-abs-high", "carb-abs-medium", "carb-abs-low", "carb-abs-unknown"].forEach(id => {
    el(id).addEventListener("change", handleCarbAbsEdit);
  });

  el("time-ratio-list").addEventListener("click", e => {
    const del = e.target.closest("[data-del]");
    if (del) {
      if (state.settings.timeRatios.length <= 1) { dialogs.alert("You need at least one time range."); return; }
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
  el("add-time-range-btn").addEventListener("click", () => {
    const id = makeId("tr");
    state.settings.timeRatios.push({ id, name: "New range", start: "12:00", end: "14:00", ratio: 10, color: RANGE_COLORS[state.settings.timeRatios.length % RANGE_COLORS.length] });
    saveState(); renderTimeline(); renderTimeRatioList();
  });
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
  el("add-activity-btn").addEventListener("click", async () => {
    const name = ((await dialogs.prompt("Activity name (e.g. Sport, Stress):", { title: "Add activity" })) || "").trim();
    if (!name) return;
    state.settings.activityRatios.push({ id: makeId("ar"), name, ratio: 15, color: RANGE_COLORS[state.settings.activityRatios.length % RANGE_COLORS.length] });
    saveState(); renderActivityRatioList();
  });
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
}
