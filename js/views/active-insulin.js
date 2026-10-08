// The Active Insulin & Carbs panel on the Calculator, and the sheet it opens: Now (projected forward), Today (what
// happened since midnight) and, with Nightscout, a recent glucose trend. The models are in js/calc.js.
import { formatGlucose, glucoseRangeClass, glucoseRangeLabel, glucoseTrendArrow, glucoseUnitLabel } from "../calc.js";
import { fetchGlucoseHistory } from "../services/glucose-data.js";
import { nightscoutConfigured } from "../services/nightscout-sync.js";
import { calcActiveInsulinAndCarbs, state } from "../services/store.js";
import { renderActiveGraphSVG, renderGlucoseGraphSVG } from "../ui/charts.js";
import { el } from "../ui/dom.js";
import { createSheet, sheetHeader } from "../ui/sheets.js";
import { escapeHtml, formatDuration } from "../util.js";


// Same as buildActiveSeries, but a real historical view: from midnight
// today to now, showing what actually happened rather than a forward
// projection. No "no further doses" caveat needed here -- it's history.
function buildTodaySeries() {
  const now = Date.now();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const startTime = startOfDay.getTime();
  const stepMs = 10 * 60000; // 10-minute resolution is plenty over a full day
  const points = [];
  for (let t = startTime; t <= now; t += stepMs) {
    const r = calcActiveInsulinAndCarbs(t);
    points.push({ t, iob: r.iob, cob: r.cob });
  }
  return { points, startTime, endTime: now, now };
}

// Builds a (time, iob, cob) series for the detail graph: 30 minutes of
// recent context, then projected forward (assuming no further doses/meals)
// until whichever of IOB/COB clears last.
function buildActiveSeries() {
  const now = Date.now();
  const info = calcActiveInsulinAndCarbs(now);
  const startTime = now - 30 * 60000;
  const endTime = Math.max(info.iobClearAt || now, info.cobClearAt || now, now + 30 * 60000);
  const stepMs = 5 * 60000;
  const points = [];
  for (let t = startTime; t <= endTime; t += stepMs) {
    const r = calcActiveInsulinAndCarbs(t);
    points.push({ t, iob: r.iob, cob: r.cob });
  }
  return { points, startTime, endTime, now, info };
}


const AIOG_TABS = [
  { key: "now", label: "Now" },
  { key: "today", label: "Today" },
  { key: "glucose", label: "Glucose" }
];

function openActiveDetailSheet(initialTab) {
  const tabs = nightscoutConfigured() ? AIOG_TABS : AIOG_TABS.filter(t => t.key !== "glucose");
  const startTab = tabs.some(t => t.key === initialTab) ? initialTab : "now";
  const { backdrop } = createSheet({
    labelledBy: "aiog-title",
    content: `
      ${sheetHeader("Active Insulin &amp; Carbs", { titleId: "aiog-title" })}
      <div class="graph-tabs" id="aiog-tabs">
        ${tabs.map(t => `<button class="graph-tab${t.key === startTab ? " is-active" : ""}" data-tab="${t.key}" type="button">${t.label}</button>`).join("")}
      </div>
      <div id="aiog-content"></div>`
  });
  backdrop.querySelectorAll(".graph-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      backdrop.querySelectorAll(".graph-tab").forEach(b => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      renderAiogTab(backdrop, btn.dataset.tab);
    });
  });
  renderAiogTab(backdrop, startTab);
}

function aiogLegendHtml() {
  return `
    <div style="display:flex; gap:16px; justify-content:center; margin-top:8px;">
      <span style="display:flex; align-items:center; gap:6px; font-size:0.8rem; color:var(--ink-soft);"><span style="width:10px; height:10px; border-radius:50%; background:#3B82F6; display:inline-block;"></span>Insulin (u)</span>
      <span style="display:flex; align-items:center; gap:6px; font-size:0.8rem; color:var(--ink-soft);"><span style="width:10px; height:10px; border-radius:50%; background:#D97706; display:inline-block;"></span>Carbs (g)</span>
    </div>
  `;
}

const GLUCOSE_WINDOWS_HOURS = [3, 6, 12, 24];
let glucoseWindowHours = 6; // remembered for as long as the app stays open, not persisted

// A FreeStyle-Libre-style colored banner: big number, trend arrow, how old the reading is.
function renderGlucoseBannerHtml(entry) {
  if (!entry || typeof entry.sgv !== "number") {
    return `<div class="glucose-banner glucose-banner--unknown"><div class="glucose-banner__label">NO RECENT GLUCOSE</div></div>`;
  }
  const unit = state.settings.units;
  const value = formatGlucose(entry.sgv, unit);
  const rangeClass = glucoseRangeClass(entry.sgv);
  const arrow = glucoseTrendArrow(entry.direction);
  const ageMin = Math.round((Date.now() - entry.date) / 60000);
  const ageText = ageMin <= 0 ? "Just now" : ageMin === 1 ? "1 minute ago" : ageMin < 60 ? `${ageMin} minutes ago` : "Over an hour ago";
  return `
    <div class="glucose-banner glucose-banner--${rangeClass}">
      <div class="glucose-banner__label">${escapeHtml(glucoseRangeLabel(rangeClass))}</div>
      <div class="glucose-banner__value">${value}${arrow ? ` <span class="glucose-banner__arrow">${arrow}</span>` : ""}</div>
      <div class="glucose-banner__meta">${glucoseUnitLabel(unit)} &middot; ${ageText}</div>
    </div>
  `;
}

async function renderAiogTab(backdrop, tab) {
  const content = backdrop.querySelector("#aiog-content");
  if (tab === "now") {
    const series = buildActiveSeries();
    content.innerHTML = `
      <p class="panel-card__hint">Projected forward from now assuming no further food or insulin — a real dose or meal will change this.</p>
      ${renderActiveGraphSVG(series)}
      ${aiogLegendHtml()}
    `;
  } else if (tab === "today") {
    const series = buildTodaySeries();
    content.innerHTML = `
      <p class="panel-card__hint">What actually happened today, from midnight to now.</p>
      ${renderActiveGraphSVG(series)}
      ${aiogLegendHtml()}
    `;
  } else if (tab === "glucose") {
    content.innerHTML = `<p class="panel-card__hint">Loading recent glucose…</p>`;
    const result = await fetchGlucoseHistory(glucoseWindowHours);
    if (!content.isConnected) return; // sheet was closed while this was loading
    const picker = `
      <div class="glucose-range-picker">
        ${GLUCOSE_WINDOWS_HOURS.map(h => `<button type="button" class="glucose-range-btn${h === glucoseWindowHours ? " is-active" : ""}" data-hours="${h}">${h}h</button>`).join("")}
      </div>
    `;
    if (!result.ok) {
      content.innerHTML = `${picker}<p class="panel-card__hint" style="color:#B91C1C;">Couldn't load glucose: ${escapeHtml(result.reason)}</p>`;
    } else {
      const entries = result.entries.filter(e => typeof e.sgv === "number").sort((a, b) => a.date - b.date);
      const latest = entries[entries.length - 1];
      const svg = renderGlucoseGraphSVG(result.entries, state.settings.units);
      content.innerHTML = `
        ${renderGlucoseBannerHtml(latest)}
        ${picker}
        ${svg ? svg : `<p class="panel-card__hint">No recent glucose data found.</p>`}
        ${svg ? `<p class="panel-card__hint" style="margin-top:10px;">Dashed lines mark the standard 70&ndash;180 range.</p>` : ""}
      `;
    }
    content.querySelectorAll(".glucose-range-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        glucoseWindowHours = Number(btn.dataset.hours);
        renderAiogTab(backdrop, "glucose");
      });
    });
  }
}

export function renderActivePanel() {
  const panel = el("active-panel");
  const { iob, cob, iobClearAt, cobClearAt } = calcActiveInsulinAndCarbs();
  if (iob <= 0 && cob <= 0) { panel.hidden = true; return; }
  panel.hidden = false;
  el("active-iob-value").textContent = `≈${iob.toFixed(1)} u`;
  el("active-cob-value").textContent = `≈${cob} g`;
  const now = Date.now();
  const clearParts = [];
  if (iobClearAt) clearParts.push(`Insulin clears in ~${formatDuration(iobClearAt - now)}`);
  if (cobClearAt) clearParts.push(`${iobClearAt ? "c" : "C"}arbs clear in ~${formatDuration(cobClearAt - now)}`);
  el("active-clear-text").textContent = clearParts.join(" · ");
}

/** Event wiring. Called once by app.js, after every module has loaded. */
export function initActiveInsulin() {
  el("active-panel").addEventListener("click", () => openActiveDetailSheet("now"));
  el("cc-live-glucose").addEventListener("click", () => openActiveDetailSheet("glucose"));
}
