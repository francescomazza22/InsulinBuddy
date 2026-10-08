// History > Glucose: average, estimated A1c and time in range, with the Daily Pattern and Time in Range views,
// over 7 to 90 days of the account's stored glucose history.
import { formatGlucose, glucoseUnitLabel } from "../calc.js";
import { dailyPatternBuckets, daysSpanned, glucoseSummaryStats, timeInRangeBreakdown } from "../glucose-stats.js";
import { fetchStoredGlucoseReadings } from "../services/glucose-data.js";
import { state } from "../services/store.js";
import { renderDailyPatternSVG } from "../ui/charts.js";
import { el } from "../ui/dom.js";
import { escapeHtml } from "../util.js";
import { openClinicReport } from "./report.js";

// A "daily pattern" band chart: every day in the selected range folded into one 24h view,
// showing the median (bold line) and the 25-75 / 10-90 percentile spread (shaded bands) at
// each time of day -- the shape of a typical day, not just one line through raw points.
export const MIN_PATTERN_DAYS = 5; // matches the convention CGM reports use (needs a real spread of days to mean anything)

// ---- Daily Pattern band presets: which percentiles to shade. All of these are already
// computed by dailyPatternBuckets (p5/p10/p25/p50/p75/p90/p95), so switching presets never
// needs a re-fetch -- just a re-render with different keys. ----
export const GLUCOSE_BAND_PRESETS = {
  narrow: { label: "25–75 / 10–90", outer: ["p10", "p90"], inner: ["p25", "p75"] },
  wide: { label: "5–95 / 25–75", outer: ["p5", "p95"], inner: ["p25", "p75"] },
  median: { label: "Median only", outer: null, inner: null }
};
let glucoseView = "pattern"; // 'pattern' | 'tir'
let glucoseBandPreset = "narrow";

export async function renderGlucoseTab(days) {
  const box = el("glucose-tab-content");
  box.innerHTML = `<p class="panel-card__hint">Loading…</p>`;
  const result = await fetchStoredGlucoseReadings(days);
  if (!box.isConnected) return; // left the tab while this was loading
  if (!result.ok) { box.innerHTML = `<p class="panel-card__hint" style="color:#B91C1C;">${escapeHtml(result.reason)}</p>`; return; }

  const readings = result.readings;
  const spanDays = daysSpanned(readings);
  if (readings.length === 0 || spanDays < MIN_PATTERN_DAYS) {
    box.innerHTML = `
      <div class="empty-state">
        <p>Not enough data yet for a daily pattern.</p>
        <p class="empty-state__sub">This needs at least ${MIN_PATTERN_DAYS} days of glucose history — you have ${spanDays}. It'll fill in automatically as you use the app, or use "Import history from Nightscout" in Settings → Nightscout Sync to backfill it right away.</p>
      </div>
    `;
    return;
  }

  const stats = glucoseSummaryStats(readings);
  const unit = state.settings.units;
  const fmtG = v => formatGlucose(v, unit);
  const statCard = (value, unitLabel, label, warn) => `
    <div class="trend-stat-card${warn ? " trend-stat-card--warn" : ""}">
      <div class="trend-stat-card__value">${value}<span class="trend-stat-card__unit">${unitLabel}</span></div>
      <div class="trend-stat-card__label">${label}</div>
    </div>
  `;
  const statsHtml = `
    <div class="trend-stats glucose-stats">
      ${statCard(fmtG(stats.avgMgdl), glucoseUnitLabel(unit), "Average glucose")}
      ${statCard(stats.gmi.toFixed(1), "%", "Est. A1c (GMI)")}
      ${statCard(Math.round(stats.timeInRangePct), "%", "Time in range (70–180)")}
      ${statCard(Math.round(stats.timeLowPct + stats.timeHighPct), "%", "Time low or high", stats.timeLowPct + stats.timeHighPct > 30)}
    </div>
  `;
  const footerHtml = `
    <p class="panel-card__hint">Based on ${stats.count.toLocaleString()} readings over ${spanDays} days. Estimated A1c (GMI) is informational only — not a lab result.</p>
  `;

  if (glucoseView === "tir") {
    box.innerHTML = `${statsHtml}<div class="panel-card">${renderTimeInRangeHtml(readings, unit)}</div>${footerHtml}`;
    return;
  }

  const preset = GLUCOSE_BAND_PRESETS[glucoseBandPreset];
  const buckets = dailyPatternBuckets(readings, 30);
  const svg = renderDailyPatternSVG(buckets, preset, unit);
  const bandPicker = `
    <div class="band-preset-row">
      <span class="band-preset-row__label">Bands:</span>
      <select id="band-preset-select">
        ${Object.entries(GLUCOSE_BAND_PRESETS).map(([key, p]) => `<option value="${key}"${key === glucoseBandPreset ? " selected" : ""}>${p.label}</option>`).join("")}
      </select>
    </div>
  `;
  box.innerHTML = `
    ${statsHtml}
    <div class="panel-card">
      <h2 class="panel-card__title">Daily pattern</h2>
      <p class="panel-card__hint" style="margin-top:-4px;">Every day over the last ${days} days folded into one.</p>
      ${bandPicker}
      ${svg}
      ${renderGlucoseLegend(preset)}
    </div>
    ${footerHtml}
  `;
  el("band-preset-select").addEventListener("change", e => {
    glucoseBandPreset = e.target.value;
    renderGlucoseTab(days); // re-render only -- readings are already cached, so this is instant
  });
}

function renderGlucoseLegend(preset) {
  const items = [`<span class="glucose-legend__item"><span class="glucose-legend__swatch glucose-legend__swatch--line"></span>Median</span>`];
  if (preset.inner) items.push(`<span class="glucose-legend__item"><span class="glucose-legend__swatch glucose-legend__swatch--inner"></span>${preset.inner[0].slice(1)}–${preset.inner[1].slice(1)}th percentile</span>`);
  if (preset.outer) items.push(`<span class="glucose-legend__item"><span class="glucose-legend__swatch glucose-legend__swatch--outer"></span>${preset.outer[0].slice(1)}–${preset.outer[1].slice(1)}th percentile</span>`);
  items.push(`<span class="glucose-legend__item"><span class="glucose-legend__swatch glucose-legend__swatch--threshold"></span>70–180 range</span>`);
  return `<div class="glucose-legend">${items.join("")}</div>`;
}

// The same Time-in-Range breakdown screenshot you shared -- horizontal bars, high to low,
// using the standard ADA/ATTD consensus bands (the same ones Dexcom Clarity and LibreLink use).
function renderTimeInRangeHtml(readings, unit) {
  const breakdown = timeInRangeBreakdown(readings);
  const colors = { veryHigh: "#D97706", high: "#FBBF24", target: "#22C55E", low: "#FCA5A5", veryLow: "#DC2626" };
  const fmtB = v => formatGlucose(v, unit);
  const rangeLabel = b => {
    if (b.key === "veryHigh") return `&gt; ${fmtB(b.low - 1)}`;
    if (b.key === "veryLow") return `&lt; ${fmtB(b.high + 1)}`;
    return `${fmtB(b.low)}&ndash;${fmtB(b.high)}`;
  };
  const rows = breakdown.map(b => `
    <div class="tir-row">
      <div class="tir-row__range">${rangeLabel(b)}</div>
      <div class="tir-row__track"><div class="tir-row__fill" style="width:${Math.max(b.pct, b.pct > 0 ? 2 : 0)}%; background:${colors[b.key]};"></div></div>
      <div class="tir-row__pct">${Math.round(b.pct)}%</div>
    </div>
  `).join("");
  return `
    <h2 class="panel-card__title">Time in Range</h2>
    <p class="panel-card__hint" style="margin-top:-4px;">${glucoseUnitLabel(unit)}</p>
    <div class="tir-bars">${rows}</div>
    <p class="panel-card__hint" style="margin-top:10px;">Target range: ${fmtB(70)}&ndash;${fmtB(180)} ${glucoseUnitLabel(unit)}</p>
  `;
}
export let glucoseRange = 14;
const glucoseRangeSegmented = el("glucose-range-segmented");

const glucoseViewSegmented = el("glucose-view-segmented");

/** Event wiring. Called once by app.js, after every module has loaded. */
export function initGlucose() {
  glucoseRangeSegmented.addEventListener("click", e => {
    const btn = e.target.closest(".segmented__btn");
    if (!btn) return;
    glucoseRange = parseInt(btn.dataset.range, 10);
    glucoseRangeSegmented.querySelectorAll(".segmented__btn").forEach(b => b.classList.toggle("is-active", b === btn));
    renderGlucoseTab(glucoseRange);
  });
  el("btn-generate-report").addEventListener("click", () => openClinicReport(glucoseRange));
  glucoseViewSegmented.addEventListener("click", e => {
    const btn = e.target.closest(".segmented__btn");
    if (!btn) return;
    glucoseView = btn.dataset.glview;
    glucoseViewSegmented.querySelectorAll(".segmented__btn").forEach(b => b.classList.toggle("is-active", b === btn));
    renderGlucoseTab(glucoseRange); // readings are cached -- this re-render is instant, no re-fetch
  });
}
