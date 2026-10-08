// History > Log: the list of logged meals and basal doses (searchable, paged by day), their Nightscout badges, and
// the Use Again / Edit / Delete actions. Also switches between the Log, Trends and Glucose panels.
import { giBand } from "../calc.js";
import { MEAL_TYPES } from "../constants.js";
import { PAGE_SIZE, groupByDay, isBasalEntry, matchesQuery, takeEntries } from "../history.js";
import { flushNightscoutQueue, nightscoutConfigured, nsFormat, nsOutbox, queueNsDelete, undoNsDelete } from "../services/nightscout-sync.js";
import { saveState, state } from "../services/store.js";
import { dialogs, el } from "../ui/dom.js";
import { showUndoToast } from "../ui/toast.js";
import { escapeAttr, escapeHtml, formatQty, round1 } from "../util.js";
import { renderActivePanel } from "./active-insulin.js";
import { buildBasalRow, openBasalSheet } from "./basal.js";
import { renderRecentMeals, useMealAgain } from "./calculator.js";
import { openEditMealSheet } from "./edit-meal.js";
import { glucoseRange, renderGlucoseTab } from "./glucose.js";
import { renderTrends, trendsRange } from "./trends.js";

const historyGroups = el("history-groups");
const historyEmpty = el("history-empty");
const histCountPill = el("hist-count-pill");
const historySearch = el("history-search");
const historyMore = el("history-more");
const historyNoMatch = el("history-nomatch");
let historyLimit = PAGE_SIZE;   // how many meals the Log shows before "Show older"

function formatDateHeader(ts) {
  return new Date(ts).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }).toUpperCase();
}
export function formatTime(ts) {
  return new Date(ts).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}


/** Opening the History tab: back to the first page of the log, then draw it. */
export function showHistory() {
  historyLimit = PAGE_SIZE;
  renderHistory();
}

export function renderHistory(opts = {}) {
  const mealCount = state.history.filter(e => !isBasalEntry(e)).length;   // a basal dose isn't a meal
  histCountPill.textContent = `${mealCount} meal${mealCount === 1 ? "" : "s"}`;
  historyEmpty.hidden = state.history.length > 0;
  historyGroups.innerHTML = "";
  if (state.history.length === 0) {
    historyMore.hidden = true; historyNoMatch.hidden = true;
    if (!opts.skipTrends) renderTrends(trendsRange);
    return;
  }

  // Search, then page: only the newest days are drawn until "Show older" is tapped,
  // so the list stays fast however long the history gets.
  const query = historySearch.value.trim();
  const filtered = query ? state.history.filter(e => matchesQuery(e, query, ts => formatDateHeader(ts))) : state.history;
  if (query) histCountPill.textContent = `${filtered.filter(e => !isBasalEntry(e)).length} of ${mealCount}`;
  historyNoMatch.hidden = filtered.length > 0;
  const { visible, hidden } = takeEntries(filtered, historyLimit);
  const groups = groupByDay(visible);
  historyMore.hidden = hidden === 0;
  historyMore.textContent = `Show older meals (${hidden} more)`;

  groups.forEach(group => {
    const groupEl = document.createElement("div");
    groupEl.className = "history-group";
    const header = document.createElement("p");
    header.className = "history-group__date";
    header.textContent = formatDateHeader(group.ts);
    groupEl.appendChild(header);

    group.entries.forEach(entry => {
      if (isBasalEntry(entry)) { groupEl.appendChild(buildBasalRow(entry)); return; }
      const meal = MEAL_TYPES[entry.mealType] || MEAL_TYPES.snack;
      const row = document.createElement("div");
      row.className = "history-entry";
      row.style.borderLeftColor = meal.color;
      row.dataset.id = entry.id;
      const doseText = entry.correctionDose > 0 ? `${entry.mealDose}+${entry.correctionDose}u` : `${entry.mealDose}u`;
      const dosePillHtml = entry.noInsulin
        ? `<span class="dose-pill dose-pill--warn"><svg viewBox="0 0 24 24" fill="none"><path d="M12 19V5M12 19l-5-5M12 19l5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>No Insulin</span>`
        : `<span class="dose-pill"><svg viewBox="0 0 24 24" fill="none"><path d="M12 2C12 2 5 10.5 5 15.5C5 19.6 8.13 22 12 22C15.87 22 19 19.6 19 15.5C19 10.5 12 2 12 2Z" stroke="currentColor" stroke-width="2"/></svg>${doseText}</span>`;
      row.innerHTML = `
        <div class="history-entry__icon" style="background:${meal.color}">${meal.icon}</div>
        <div class="history-entry__main">
          <p class="history-entry__title">${meal.label} <span class="muted">· ${formatTime(entry.ts)} · ${escapeHtml(entry.periodName || "")}</span>${nsBadgeHtml(entry)}</p>
          <p class="history-entry__foods">${entry.items.length ? entry.items.map(i => escapeHtml(i.name)).join(", ") : (entry.carbsUnknown ? "Eating out — carbs not logged" : "No food — correction only")}</p>
          <div class="history-entry__detail" hidden>
            ${entry.items.map(i => {
              const isUnit = i.quantity != null && i.unitLabel;
              const qtyLabel = isUnit ? `${formatQty(i.quantity)} ${escapeHtml(i.unitLabel)}${i.quantity === 1 ? "" : "s"}` : (i.grams ? escapeHtml(i.grams) + "g" : "");
              return `<div class="history-entry__item"><span class="history-entry__item-name">${escapeHtml(i.name)}</span><span class="history-entry__item-qty">${qtyLabel}</span><span class="history-entry__item-carbs">${round1(i.carbs)}g</span></div>`;
            }).join("")}
            ${entry.cappedFrom ? `<p class="history-entry__cap">Capped at your maximum dose (calculated ${entry.cappedFrom}u)</p>` : ""}
            <div class="history-entry__row-actions">
              <button data-use="${entry.id}" type="button">Use Again</button>
              <button data-edit="${entry.id}" type="button">Edit</button>
              <button class="danger" data-del="${entry.id}" type="button">Delete</button>
            </div>
          </div>
        </div>
        <div class="history-entry__stats">
          ${entry.carbsUnknown ? `<span class="stat-grams">Carbs not logged</span>` : `
            <span class="stat-kcal">${entry.totalKcal || 0} kcal</span>
            <span class="stat-grams">${entry.totalCarbs}g</span>
          `}
          ${entry.glycemicLoad ? `<span class="gl-indicator gl-indicator--${giBand(entry.glycemicLoad.value)} gl-indicator--compact">GI ${entry.glycemicLoad.value}${entry.glycemicLoad.partial ? "*" : ""}</span>` : ""}
          ${dosePillHtml}
        </div>
      `;
      groupEl.appendChild(row);
    });
    historyGroups.appendChild(groupEl);
  });
  if (!opts.skipTrends) renderTrends(trendsRange);
}

// ---- the Log / Trends / Glucose switcher ----
let historySeg = "log"; // 'log' | 'trends' | 'glucose'
const historySegmented = el("history-segmented");
const historyLogPanel = el("history-log-panel");
export const historyTrendsPanel = el("history-trends-panel");
const historyGlucosePanel = el("history-glucose-panel");

// ---- Nightscout sync badge shown on each logged meal ----
export function nsBadgeHtml(entry) {
  if (!nightscoutConfigured()) return "";
  const pending = nsOutbox.pendingFor(entry.id);
  let cls, label, title;
  if (pending) { cls = "pending"; label = "NS ↻"; title = pending.lastError ? `Waiting to sync — ${pending.lastError}` : "Waiting to sync to Nightscout"; }
  else if (entry.ns && entry.ns.status === "failed") { cls = "failed"; label = "NS !"; title = `Couldn't sync: ${entry.ns.error || "unknown error"}. Tap to retry.`; }
  else if (entry.ns && entry.ns.status === "synced") { cls = entry.ns.warn ? "warn" : "ok"; label = "NS ✓"; title = entry.ns.warn || "Synced to Nightscout"; }
  else return "";
  return `<button type="button" class="ns-badge ns-badge--${cls}" data-nsbadge="${escapeAttr(entry.id)}" title="${escapeAttr(title)}">${label}</button>`;
}
export function renderHistoryBadges() {
  historyGroups.querySelectorAll(".history-entry").forEach(row => {
    const entry = state.history.find(h => h.id === row.dataset.id);
    const title = row.querySelector(".history-entry__title");
    if (!entry || !title) return;
    const old = title.querySelector(".ns-badge");
    if (old) old.remove();
    const html = nsBadgeHtml(entry);
    if (html) title.insertAdjacentHTML("beforeend", html);
  });
}
async function onNsBadgeClick(entry) {
  const pending = nsOutbox.pendingFor(entry.id);
  if (!pending && entry.ns && entry.ns.status === "failed") {
    const retry = await dialogs.confirm(`This meal couldn't be sent to Nightscout:\n${entry.ns.error || "unknown error"}\n\nTry again?`, { title: "Nightscout sync", confirmText: "Retry" });
    if (!retry) return;
    const hasIds = entry.ns.ids && Object.values(entry.ns.ids).some(Boolean);
    if (hasIds) nsOutbox.enqueueUpdate(entry, { format: nsFormat(), units: state.settings.units });
    else nsOutbox.enqueueCreate(entry, { format: nsFormat(), units: state.settings.units });
    flushNightscoutQueue(true);
    return;
  }
  if (pending) { await dialogs.alert(pending.lastError ? `Still waiting to sync.\nLast problem: ${pending.lastError}` : "Waiting to sync to Nightscout.", { title: "Nightscout sync" }); return; }
  await dialogs.alert(entry.ns && entry.ns.warn ? entry.ns.warn : "This meal is in Nightscout.", { title: "Nightscout sync" });
}

/** Event wiring. Called once by app.js, after every module has loaded. */
export function initHistoryLog() {

  historySegmented.addEventListener("click", e => {
    const btn = e.target.closest(".segmented__btn");
    if (!btn) return;
    historySeg = btn.dataset.seg;
    historySegmented.querySelectorAll(".segmented__btn").forEach(b => b.classList.toggle("is-active", b === btn));
    historyLogPanel.hidden = historySeg !== "log";
    historyTrendsPanel.hidden = historySeg !== "trends";
    historyGlucosePanel.hidden = historySeg !== "glucose";
    if (historySeg === "trends") renderTrends(trendsRange);
    if (historySeg === "glucose") renderGlucoseTab(glucoseRange);
  });
  historySearch.addEventListener("input", () => { historyLimit = PAGE_SIZE; renderHistory({ skipTrends: true }); });
  historyMore.addEventListener("click", () => { historyLimit += PAGE_SIZE; renderHistory({ skipTrends: true }); });

  historyGroups.addEventListener("click", e => {
    const badgeBtn = e.target.closest("[data-nsbadge]");
    if (badgeBtn) {
      const entry = state.history.find(h => h.id === badgeBtn.dataset.nsbadge);
      if (entry) onNsBadgeClick(entry);
      return;
    }
    const delBtn = e.target.closest("[data-del]");
    if (delBtn) {
      const idx = state.history.findIndex(h => h.id === delBtn.dataset.del);
      const [removed] = state.history.splice(idx, 1);
      saveState();
      queueNsDelete(removed);
      renderHistory();
      renderActivePanel();
      renderRecentMeals();
      showUndoToast(isBasalEntry(removed) ? "Basal dose deleted" : "Meal deleted", () => {
        state.history.splice(idx, 0, removed);
        saveState();
        undoNsDelete(removed);
        renderHistory();
        renderActivePanel();
        renderRecentMeals();
      });
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
      if (entry) (isBasalEntry(entry) ? openBasalSheet : openEditMealSheet)(entry);
      return;
    }
    const row = e.target.closest(".history-entry");
    if (!row) return;
    const detail = row.querySelector(".history-entry__detail");
    const summary = row.querySelector(".history-entry__foods");
    detail.hidden = !detail.hidden;
    summary.hidden = !detail.hidden;
  });
}
