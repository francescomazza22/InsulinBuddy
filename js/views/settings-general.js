// Settings > General: palette, background, light / dark mode, the Privacy (passphrase) card, the version card and
// What's changed, Refresh App, and Delete Account & All Data.
import { CHANGELOG } from "../changelog.js";
import { BG_PRESETS, PALETTES, backgroundPatternOf } from "../constants.js";
import { KEYS } from "../keys.js";
import { currentUser, resetCloudTracking, signOut, supabaseClient } from "../services/cloud.js";
import { diag } from "../services/diagnostics.js";
import { clearLiveGlucose, glucoseReadingsCache } from "../services/glucose-data.js";
import { disableFaceId, enrollFaceId, faceIdSupported, forgetUnlockedKey, isFaceIdEnabled, isLockEnabled, lockNow, removePassphrase, setPassphrase, tryUnlock } from "../services/lock.js";
import { nsOutbox } from "../services/nightscout-sync.js";
import { adoptState, backups, normalizeState, saveState, state } from "../services/store.js";
import { dialogs, el } from "../ui/dom.js";
import { createSheet, sheetHeader } from "../ui/sheets.js";
import { escapeHtml } from "../util.js";
import { renderRecentMeals } from "./calculator.js";
import { applyBackgroundPattern, applyCustomBackground, applyTheme, isDarkModeActive, renderEverything } from "./shell.js";

function renderVersionCard() {
  const latest = CHANGELOG[0];
  el("version-badge-text").innerHTML = `v${latest.version} <svg viewBox="0 0 24 24" fill="none" width="14" height="14"><path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  el("version-summary-text").textContent = `${latest.summary} Tap to see what's changed.`;
}

function openChangelogSheet() {
  createSheet({
    labelledBy: "cl-title", returnFocus: el("btn-open-changelog"),
    content: `
      ${sheetHeader("What's changed", { titleId: "cl-title" })}
      ${CHANGELOG.map((entry, i) => `
        <div class="changelog-entry">
          <div class="changelog-entry__head">
            <span class="changelog-entry__version">v${entry.version}</span>
            ${i === 0 ? '<span class="changelog-entry__current">Current</span>' : ""}
          </div>
          <ul class="changelog-entry__list">
            ${entry.changes.map(c => `<li>${escapeHtml(c)}</li>`).join("")}
          </ul>
        </div>
      `).join("")}`
  });
}

export function renderBackgroundSection() {
  const grid = el("bg-swatch-grid");
  const resetBtn = el("btn-bg-reset");
  const darkNote = el("bg-dark-mode-note");
  const active = state.settings.customBackground;
  darkNote.hidden = !isDarkModeActive();
  grid.style.opacity = isDarkModeActive() ? "0.5" : "1";
  grid.innerHTML = BG_PRESETS.map(color => `
    <button class="bg-swatch${color === active ? " is-active" : ""}" type="button" data-color="${color}" style="background:${color};" aria-label="Background color ${color}">
      ${color === active ? '<svg viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' : ""}
    </button>
  `).join("");
  resetBtn.hidden = !active;
  const pattern = backgroundPatternOf(state.settings);
  el("bg-pattern-grid").innerHTML = [["none", "Plain"], ["doodles", "Doodles"], ["abstract", "Abstract"]].map(([id, label]) => `
    <button class="pattern-card${pattern === id ? " is-selected" : ""}" type="button" data-pattern="${id}" aria-pressed="${pattern === id}">
      <span class="pattern-card__preview${id === "none" ? "" : ` pattern-card__preview--${id}`}"></span>
      <span class="pattern-card__name">${label}</span>
    </button>
  `).join("");
  // The size choice only makes sense (and only shows) once there is a pattern to size.
  const size = ["small", "medium", "large"].includes(state.settings.backgroundPatternSize) ? state.settings.backgroundPatternSize : "small";
  const sizeBox = el("bg-pattern-size");
  sizeBox.hidden = pattern === "none";
  sizeBox.querySelectorAll("[data-size]").forEach(b => {
    const on = b.dataset.size === size;
    b.classList.toggle("is-active", on);
    b.setAttribute("aria-pressed", String(on));
  });
}

export function renderPrivacySection() {
  const box = el("privacy-lock-section");
  const cloudNote = currentUser ? " and what's synced to the cloud" : "";
  if (isLockEnabled()) {
    const faceIdRow = faceIdSupported() ? `
      <div class="toggle-row">
        <span>Unlock with Face ID / Touch ID</span>
        <label class="switch">
          <input type="checkbox" id="faceid-toggle" ${isFaceIdEnabled() ? "checked" : ""}>
          <span class="switch__track"></span>
        </label>
      </div>
      <p class="panel-card__hint" style="margin-top:0;">A convenience shortcut, not a cryptographic replacement — it stores your unlocked key on this device, gated behind a fresh Face ID check each time. Your passphrase still works as a fallback, always.</p>
    ` : "";
    box.innerHTML = `
      <p class="panel-card__hint" style="margin-top:-4px;">This device is locked with a passphrase. Your data${cloudNote} is encrypted at rest — forgetting it means it can't be recovered. Once unlocked, this device stays unlocked until you lock it again or fully close the app.</p>
      ${faceIdRow}
      <button class="dashed-btn" id="btn-lock-now" type="button" style="margin-bottom:8px;">Lock now</button>
      <button class="dashed-btn" id="btn-change-pass" type="button" style="margin-bottom:8px;">Change passphrase</button>
      <button class="dashed-btn" id="btn-remove-pass" type="button" style="color:var(--brick); border-color:var(--brick-soft);">Remove passphrase</button>
    `;
    el("btn-lock-now").addEventListener("click", lockNow);
    if (faceIdSupported()) {
      el("faceid-toggle").addEventListener("change", async e => {
        if (e.target.checked) {
          try { await enrollFaceId(); }
          catch (err) { e.target.checked = false; await dialogs.alert("Couldn't set up Face ID: " + ((err && err.message) || err)); }
        } else {
          disableFaceId();
        }
      });
    }
    el("btn-change-pass").addEventListener("click", onChangePassphrase);
    el("btn-remove-pass").addEventListener("click", onRemovePassphrase);
  } else {
    box.innerHTML = `
      <p class="panel-card__hint" style="margin-top:-4px;">Encrypt your library, ratios, and history${cloudNote} with a passphrase. It never leaves your browser — there's no account for it and no way to recover a forgotten passphrase.</p>
      <button class="dashed-btn" id="btn-set-pass" type="button">Set a passphrase</button>
    `;
    el("btn-set-pass").addEventListener("click", onSetPassphrase);
  }
}

async function onSetPassphrase() {
  const p1 = await dialogs.prompt("Choose a passphrase:", { title: "Set a passphrase", type: "password" });
  if (!p1) return;
  const p2 = await dialogs.prompt("Enter it again to confirm:", { title: "Confirm passphrase", type: "password" });
  if (p1 !== p2) { await dialogs.alert("Those didn't match — nothing was changed."); return; }
  await setPassphrase(p1);
  renderPrivacySection();
  await dialogs.alert(currentUser ? "Your data is now encrypted, on this device and in the cloud." : "Your data is now encrypted on this device.");
}
async function onChangePassphrase() {
  const current = await dialogs.prompt("Enter your current passphrase:", { title: "Change passphrase", type: "password" });
  if (!current) return;
  const ok = await tryUnlock(current);
  if (!ok) { await dialogs.alert("That passphrase doesn't match."); return; }
  const p1 = await dialogs.prompt("Choose a new passphrase:", { title: "Change passphrase", type: "password" });
  if (!p1) return;
  const p2 = await dialogs.prompt("Enter it again to confirm:", { title: "Confirm passphrase", type: "password" });
  if (p1 !== p2) { await dialogs.alert("Those didn't match — nothing was changed."); return; }
  await setPassphrase(p1);
  await dialogs.alert("Passphrase updated.");
}
async function onRemovePassphrase() {
  const current = await dialogs.prompt("Enter your current passphrase to remove it:", { title: "Remove passphrase", type: "password" });
  if (!current) return;
  const ok = await tryUnlock(current);
  if (!ok) { await dialogs.alert("That passphrase doesn't match."); return; }
  await removePassphrase();
  renderPrivacySection();
  await dialogs.alert(currentUser ? "Passphrase removed. Your data is stored unencrypted again, on this device and in the cloud." : "Passphrase removed. Your data is stored unencrypted on this device again.");
}

// ---- General tab ----
export function renderPaletteGrid() {
  const grid = el("palette-grid");
  grid.innerHTML = PALETTES.map(p => `
    <button class="palette-card${state.settings.palette === p.id ? " is-selected" : ""}" data-id="${p.id}" type="button">
      ${state.settings.palette === p.id ? `<span class="palette-card__check"><svg viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>` : ""}
      <span class="palette-card__dots">${p.dots.map(c => `<span style="background:${c}"></span>`).join("")}</span>
      <span class="palette-card__name">${p.name}</span>
    </button>
  `).join("");
}

/** Event wiring. Called once by app.js, after every module has loaded. */
export function initSettingsGeneral() {
  el("btn-open-changelog").addEventListener("click", openChangelogSheet);
  renderVersionCard();
  el("bg-pattern-size").addEventListener("click", e => {
    const btn = e.target.closest("[data-size]");
    if (!btn) return;
    state.settings.backgroundPatternSize = btn.dataset.size;
    applyBackgroundPattern();
    saveState();
    renderBackgroundSection();
  });
  el("bg-pattern-grid").addEventListener("click", e => {
    const btn = e.target.closest(".pattern-card");
    if (!btn) return;
    state.settings.backgroundPattern = backgroundPatternOf({ backgroundPattern: btn.dataset.pattern });
    applyBackgroundPattern();
    saveState();
    renderBackgroundSection();
  });
  el("bg-swatch-grid").addEventListener("click", e => {
    const btn = e.target.closest(".bg-swatch");
    if (!btn) return;
    state.settings.customBackground = btn.dataset.color;
    applyCustomBackground();
    saveState();
    renderBackgroundSection();
  });
  el("btn-bg-reset").addEventListener("click", () => {
    state.settings.customBackground = null;
    applyCustomBackground();
    saveState();
    renderBackgroundSection();
  });
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
    applyTheme();
    renderBackgroundSection();
    saveState();
  });
  el("show-recent-meals-toggle").addEventListener("change", e => {
    state.settings.showRecentMeals = e.target.checked;
    saveState();
    renderRecentMeals();
  });
  el("dark-mode-auto-toggle").addEventListener("change", e => {
    state.settings.darkModeAuto = e.target.checked;
    el("dark-mode-toggle").disabled = state.settings.darkModeAuto;
    applyTheme();
    renderBackgroundSection();
    saveState();
  });
  if (window.matchMedia) {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      if (state.settings.darkModeAuto) { applyTheme(); renderBackgroundSection(); }
    });
  }

  el("btn-refresh-app").addEventListener("click", () => location.reload());

  // Wipes everything the app keeps, anywhere: the cloud copy (first, so a failure there leaves everything intact),
  // every localStorage key in js/keys.js, the session key, the Face ID credential and stashed key, the local
  // snapshots, the Nightscout queue and the in-progress meal.
  el("btn-delete-all").addEventListener("click", async () => {
    const ok = await dialogs.confirm("This deletes ALL data — settings, library, recipes and history — permanently, on this device and in your cloud account if you're signed in. This can't be undone.", { title: "Delete everything?", confirmText: "Delete everything", danger: true });
    if (!ok) return;
    if (supabaseClient && currentUser) {
      try {
        const { error } = await supabaseClient.from("app_state").delete().eq("user_id", currentUser.id);
        if (error) throw error;
      } catch (e) {
        diag.log("error", "sync", "Delete-all couldn't delete the cloud copy: " + ((e && e.message) || e));
        await dialogs.alert("Couldn't reach your cloud account, so nothing has been deleted (on this device or in the cloud). Try again when you're online.", { title: "Nothing deleted" });
        return;
      }
      try {
        const { error } = await supabaseClient.from("glucose_readings").delete().eq("user_id", currentUser.id);
        if (error) diag.log("warn", "sync", "Couldn't delete stored glucose readings: " + (error.message || error));
      } catch (e) { /* the app data is already gone; stored readings are best-effort */ }
      await signOut();
    }
    try { await backups.clear(); } catch (e) { /* none */ }
    nsOutbox.clear();
    forgetUnlockedKey();
    for (const k of Object.values(KEYS)) { try { localStorage.removeItem(k); } catch (e) { /* non-fatal */ } }
    clearLiveGlucose();
    glucoseReadingsCache.clear();
    diag.clear();
    resetCloudTracking();
    adoptState(normalizeState({}));
    renderEverything();   // also clears the Calculator
    await dialogs.alert("All data has been deleted.", { title: "Deleted" });
  });
}
