// Basal (long-acting) insulin, logged from the History tab: the Log / Edit basal sheet and its History row.
import { BASAL_COLOR } from "../constants.js";
import { basalDoseCheck, basalSlotForTime, basalSlotLabel, lastBasalDose, makeBasalEntry } from "../history.js";
import { queueNsDelete, queueNsUpdate, syncEntryToNightscout } from "../services/nightscout-sync.js";
import { saveState, state } from "../services/store.js";
import { dialogs, el } from "../ui/dom.js";
import { iconBasal } from "../ui/icons.js";
import { createSheet, sheetHeader } from "../ui/sheets.js";
import { showUndoToast } from "../ui/toast.js";
import { makeId, toDatetimeLocalValue } from "../util.js";
import { formatTime, nsBadgeHtml, renderHistory } from "./history-log.js";

// Records a long-acting dose. It deliberately never suggests one: it logs what was taken, nothing more.
// Entries live in the normal history (so sync, undo, backup and Nightscout just work) but are kept out of
// active insulin, corrections, trends and meal stats -- see isBasalEntry in js/history.js.
export function buildBasalRow(entry) {
  const row = document.createElement("div");
  row.className = "history-entry history-entry--basal";
  row.dataset.id = entry.id;
  const slotLabel = basalSlotLabel(entry.basalSlot);
  const units = Math.round((entry.basalDose || 0) * 100) / 100;
  row.innerHTML = `
    <div class="history-entry__icon" style="background:${BASAL_COLOR}">${iconBasal()}</div>
    <div class="history-entry__main">
      <p class="history-entry__title">Basal <span class="muted">· ${formatTime(entry.ts)}${slotLabel ? ` · ${slotLabel}` : ""}</span>${nsBadgeHtml(entry)}</p>
      <p class="history-entry__foods">Long-acting insulin</p>
      <div class="history-entry__detail" hidden>
        <div class="history-entry__row-actions">
          <button data-edit="${entry.id}" type="button">Edit</button>
          <button class="danger" data-del="${entry.id}" type="button">Delete</button>
        </div>
      </div>
    </div>
    <div class="history-entry__stats">
      <span class="dose-pill dose-pill--basal"><svg viewBox="0 0 24 24" fill="none"><path d="M12 2C12 2 5 10.5 5 15.5C5 19.6 8.13 22 12 22C15.87 22 19 19.6 19 15.5C19 10.5 12 2 12 2Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>${units}u</span>
    </div>
  `;
  return row;
}

export function openBasalSheet(existing = null) {
  const editing = !!existing;
  const trigger = el("btn-log-basal");
  const startTs = editing ? existing.ts : Date.now();
  let slot = editing ? (existing.basalSlot || basalSlotForTime(startTs)) : basalSlotForTime(startTs);
  let slotChosenByHand = editing;   // until the person picks one, the time of day decides the slot
  let prefilled = null;             // what we put in the dose field ourselves, so we never overwrite typing
  let busy = false;
  const others = () => state.history.filter(e => e !== existing);   // an edit shouldn't compare against itself
  const fieldStyle = "padding:12px 14px; border:1.5px solid var(--line); border-radius:var(--radius-s); font-size:16px; background:var(--surface); color:var(--ink); font-family:var(--font-ui);";
  const when = ts => `${new Date(ts).toLocaleDateString(undefined, { weekday: "short" })} ${formatTime(ts)}`;

  const { backdrop, $, close } = createSheet({
    className: "basal-sheet", labelledBy: "basal-title", closeOn: ["#basal-cancel"],
    returnFocus: editing ? null : trigger,
    content: `
      ${sheetHeader(editing ? "Edit basal dose" : "Log basal insulin", { titleId: "basal-title" })}
      <div class="field-grid basal-slots" role="group" aria-label="Which dose">
        <button class="btn btn--secondary" data-slot="am" type="button">Morning</button>
        <button class="btn btn--secondary" data-slot="pm" type="button">Evening</button>
      </div>
      <div class="field">
        <label for="basal-units">Dose</label>
        <div class="basal-dose-row">
          <button class="basal-step" data-step="-1" type="button" aria-label="One unit less">&minus;</button>
          <div class="field__row"><input type="number" id="basal-units" inputmode="decimal" step="any" min="0" placeholder="0" value="${editing ? existing.basalDose : ""}"><span>units</span></div>
          <button class="basal-step" data-step="1" type="button" aria-label="One unit more">+</button>
        </div>
        <p class="basal-hint" id="basal-hint"></p>
        <p class="basal-error" id="basal-error" role="alert" hidden></p>
      </div>
      <div class="field">
        <label for="basal-time">Taken at</label>
        <input type="datetime-local" id="basal-time" value="${toDatetimeLocalValue(startTs)}" style="${fieldStyle}">
      </div>
      <p class="basal-note">Logged only. Insulin Buddy never suggests a basal dose, and it isn't counted in active insulin.</p>
      <div class="sheet-actions">
        <button class="btn btn--secondary" id="basal-cancel" type="button">Cancel</button>
        <button class="btn btn--primary" id="basal-save" type="button">${editing ? "Save Changes" : "Log dose"}</button>
      </div>`
  });
  const unitsInput = $("#basal-units"), timeInput = $("#basal-time"), hintEl = $("#basal-hint"), errEl = $("#basal-error"), saveBtn = $("#basal-save");

  // Sized to what is typed (digits are all the same width here), so "14 units" reads as one centred group. When the
  // field stretched to fill the box it pushed "units" to the far edge. A half-typed "14." reads as empty to a number
  // field, so that case keeps a sensible width rather than collapsing.
  const fitDose = () => {
    const len = unitsInput.value ? unitsInput.value.length : (unitsInput.validity && unitsInput.validity.badInput ? 4 : 1);
    unitsInput.style.width = Math.max(2, len + 0.5) + "ch";
  };
  const refreshSlot = () => {
    backdrop.querySelectorAll("[data-slot]").forEach(b => {
      const on = b.dataset.slot === slot;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-pressed", String(on));
    });
    const last = lastBasalDose(others(), slot);
    const name = basalSlotLabel(slot).toLowerCase();
    hintEl.textContent = last ? `Last ${name} dose: ${last.units}u · ${when(last.ts)}. Change it if today's differs.` : `No ${name} dose logged yet.`;
    // Start from the last dose in this slot, but only ever replace a value we put there ourselves.
    const untouched = unitsInput.value === "" || unitsInput.value === String(prefilled);
    if (!editing && untouched) {
      if (last) { unitsInput.value = last.units; prefilled = last.units; }
      else { unitsInput.value = ""; prefilled = null; }
    }
    fitDose();
  };

  const save = async () => {
    if (busy) return;
    busy = true; saveBtn.disabled = true;
    try {
      errEl.hidden = true;
      const fail = msg => { errEl.textContent = msg; errEl.hidden = false; };
      const units = parseFloat(unitsInput.value);
      const ts = new Date(timeInput.value).getTime();
      if (isNaN(ts)) return fail("Choose when you took it.");
      if (ts > Date.now() + 5 * 60000) return fail("That time is in the future.");
      const check = basalDoseCheck(units, lastBasalDose(others(), slot));
      if (check.level === "block") return fail(check.message);
      if (check.level === "confirm" && !(await dialogs.confirm(`${check.message} Log it anyway?`, { title: "Check this dose", confirmText: "Log it", danger: true }))) return;

      const dose = Math.round(units * 100) / 100;
      if (editing) {
        existing.basalDose = dose; existing.basalSlot = slot; existing.periodName = slot === "am" ? "morning" : "evening"; existing.ts = ts;
        state.history.sort((a, b) => b.ts - a.ts);
        saveState(); queueNsUpdate(existing); renderHistory();
        close();
      } else {
        const entry = makeBasalEntry({ units: dose, ts, slot, id: makeId("h") });
        state.history.unshift(entry);
        state.history.sort((a, b) => b.ts - a.ts);
        saveState(); syncEntryToNightscout(entry); renderHistory();
        close();
        showUndoToast(`Basal ${entry.basalDose}u logged`, () => {
          const i = state.history.findIndex(h => h.id === entry.id);
          if (i >= 0) state.history.splice(i, 1);
          saveState(); queueNsDelete(entry); renderHistory();
        });
      }
    } finally { busy = false; saveBtn.disabled = false; }
  };

  backdrop.addEventListener("click", e => {
    const slotBtn = e.target.closest("[data-slot]");
    if (slotBtn) { slot = slotBtn.dataset.slot; slotChosenByHand = true; return refreshSlot(); }
    const stepBtn = e.target.closest("[data-step]");
    if (stepBtn) {
      const next = Math.max(0, Math.round(((parseFloat(unitsInput.value) || 0) + Number(stepBtn.dataset.step)) * 100) / 100);
      unitsInput.value = next; prefilled = null;   // a hand-set value is the person's, not a prefill
      fitDose();
    }
  });
  unitsInput.addEventListener("input", () => { errEl.hidden = true; fitDose(); });
  // The field is now only as wide as its digits, so the space around it is part of the box and should still focus it.
  $(".basal-dose-row .field__row").addEventListener("click", e => { if (e.target !== unitsInput) unitsInput.focus(); });
  timeInput.addEventListener("change", () => {
    const t = new Date(timeInput.value).getTime();
    if (!slotChosenByHand && !isNaN(t)) { slot = basalSlotForTime(t); refreshSlot(); }
  });
  saveBtn.addEventListener("click", save);

  refreshSlot();
  unitsInput.focus({ preventScroll: true }); unitsInput.select();   // so typing today's dose replaces the prefilled one
}

/** Event wiring. Called once by app.js, after every module has loaded. */
export function initBasal() {
  el("btn-log-basal").addEventListener("click", () => openBasalSheet());
}
