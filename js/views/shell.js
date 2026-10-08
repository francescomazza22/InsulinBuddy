// The app shell: switching tabs, keeping the Log bar above the tab bar, applying the theme and background, and
// redrawing every screen at once (after sign-in, a merge from another device, a restore or delete-all).
import { backgroundPatternOf } from "../constants.js";
import { applyGiSeedPatch, state } from "../services/store.js";
import { el } from "../ui/dom.js";
import { renderActivePanel } from "./active-insulin.js";
import { recompute, renderFoodPickList, renderMealItems, renderRecentMeals, restoreDraftIfAny, startFreshDraft } from "./calculator.js";
import { renderHistory, showHistory } from "./history-log.js";
import { renderLibrary } from "./library.js";
import { renderSettings } from "./settings.js";

// Refresh what's on screen after a background merge WITHOUT resetting the
// meal being built in the Calculator (renderEverything() would).
export function renderAfterSync() {
  document.documentElement.setAttribute("data-palette", state.settings.palette);
  applyTheme();
  renderFoodPickList(); renderMealItems(); recompute(); renderActivePanel();
  renderRecentMeals();
  renderLibrary(); renderHistory();
  if (!el("view-settings").hidden) renderSettings();
}

const tabs = document.querySelectorAll(".tab");
const views = document.querySelectorAll("[data-view]");

// Measures the real rendered tabbar height (which already accounts for the
// device's own safe-area inset) so the sticky log bar can sit precisely
// above it, rather than guessing a fixed pixel value that would be wrong
// on some devices.
// Kept in step with the RESPONSIVE LAYOUT breakpoints in style.css (tests/e2e/layout.e2e.js checks they agree).
const RAIL_QUERY = "(min-width: 700px)";
export function syncTabbarHeightVar() {
  const tabbar = document.querySelector(".tabbar");
  // From 700px the tab bar is a rail down the left edge, not a bar along the bottom, so nothing sits above it: reading
  // its height there would give the whole screen height and push the Log bar and food list off the page.
  if (tabbar) document.documentElement.style.setProperty("--tabbar-height", (window.matchMedia(RAIL_QUERY).matches ? 0 : tabbar.offsetHeight) + "px");
  const logBar = document.getElementById("cc-sticky-log-bar");
  if (logBar) document.documentElement.style.setProperty("--sticky-log-bar-height", logBar.offsetHeight + "px");
}

export function showView(name) {
  if (!state) return; // still waiting on the cloud auth check (see boot()); nothing to show yet
  views.forEach(v => { v.hidden = v.id !== `view-${name}`; });
  tabs.forEach(t => {
    if (t.dataset.target === name) t.setAttribute("aria-current", "page");
    else t.removeAttribute("aria-current");
  });
  el("cc-sticky-log-bar").hidden = name !== "calculator";
  if (name === "calculator") renderActivePanel();
  if (name === "library") renderLibrary();
  if (name === "history") showHistory();
  if (name === "settings") renderSettings();
}

export function isDarkModeActive() {
  if (state.settings.darkModeAuto) {
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  }
  return state.settings.darkMode;
}
export function applyTheme() {
  document.documentElement.setAttribute("data-theme", isDarkModeActive() ? "dark" : "light");
  applyCustomBackground();
  applyBackgroundPattern();
}
// The pattern is pure CSS keyed off this attribute (see DOODLE-PATTERN and ABSTRACT-PATTERN in style.css), so applying it is one attribute.
export function applyBackgroundPattern() {
  document.documentElement.setAttribute("data-bg-pattern", backgroundPatternOf(state.settings));
  const size = state.settings.backgroundPatternSize;
  document.documentElement.setAttribute("data-bg-pattern-size", size === "medium" || size === "large" ? size : "small");
}
export function applyCustomBackground() {
  if (state.settings.customBackground && !isDarkModeActive()) {
    document.documentElement.style.setProperty("--app-bg", state.settings.customBackground);
  } else {
    document.documentElement.style.removeProperty("--app-bg");
  }
}

export function renderEverything() {
  document.documentElement.setAttribute("data-palette", state.settings.palette);
  applyTheme();
  applyGiSeedPatch();
  startFreshDraft();
  renderFoodPickList(); renderMealItems(); recompute();
  restoreDraftIfAny();
  renderActivePanel();
  renderRecentMeals();
  renderLibrary(); renderHistory(); renderSettings();
}

/** Event wiring. Called once by app.js, after every module has loaded. */
export function initShell() {
  tabs.forEach(t => t.addEventListener("click", () => showView(t.dataset.target)));
  window.addEventListener("resize", syncTabbarHeightVar);
}
