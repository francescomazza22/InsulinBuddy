// The printable report for a doctor visit (History > Glucose > Generate Report for Doctor).
import { formatGlucose, glucoseUnitLabel, mealTypeBreakdown } from "../calc.js";
import { MEAL_TYPES } from "../constants.js";
import { dailyPatternBuckets, daysSpanned, glucoseSummaryStats, timeInRangeBreakdown } from "../glucose-stats.js";
import { dosingSummary, isBasalEntry } from "../history.js";
import { fetchStoredGlucoseReadings } from "../services/glucose-data.js";
import { state } from "../services/store.js";
import { renderDailyPatternSVG } from "../ui/charts.js";
import { el } from "../ui/dom.js";
import { escapeHtml, round1 } from "../util.js";
import { GLUCOSE_BAND_PRESETS, MIN_PATTERN_DAYS } from "./glucose.js";

// The report for a doctor visit: glucose control plus what was actually logged, over the period the Glucose tab
// is showing. Delivered through the browser's own print sheet (Share Sheet -> Save PDF on iOS) rather than a PDF
// library: the app has no build step or dependencies, and print-to-PDF needs neither. Every number comes from the
// tested helpers (glucose-stats.js, history.js dosingSummary, calc.js mealTypeBreakdown).
export async function openClinicReport(days) {
  const overlay = el("clinic-report-overlay");
  const content = el("clinic-report-content");
  content.innerHTML = `<p class="panel-card__hint">Preparing report…</p>`;
  overlay.hidden = false;

  const result = await fetchStoredGlucoseReadings(days); // usually cached from the tab itself -- instant
  const unit = state.settings.units;
  const unitLbl = glucoseUnitLabel(unit);
  const fmtG = v => formatGlucose(v, unit);
  const sinceMs = Date.now() - days * 86400_000;
  const dosing = dosingSummary(state.history, sinceMs);
  const byType = mealTypeBreakdown(state.history.filter(e => e.ts >= sinceMs && !isBasalEntry(e)));
  const periodLabel = `${new Date(sinceMs).toLocaleDateString()} – ${new Date().toLocaleDateString()}`;
  const bandRange = b => b.key === "veryHigh" ? `&gt; ${fmtG(b.low - 1)}` : b.key === "veryLow" ? `&lt; ${fmtG(b.high + 1)}` : `${fmtG(b.low)}–${fmtG(b.high)}`;

  let glucoseSectionHtml;
  if (result.ok && result.readings.length > 0 && daysSpanned(result.readings) >= MIN_PATTERN_DAYS) {
    const stats = glucoseSummaryStats(result.readings);
    const tir = timeInRangeBreakdown(result.readings);
    const svg = renderDailyPatternSVG(dailyPatternBuckets(result.readings, 30), GLUCOSE_BAND_PRESETS.narrow, unit);
    glucoseSectionHtml = `
      <table class="clinic-report__table">
        <tr><td>Average glucose</td><td>${fmtG(stats.avgMgdl)} ${unitLbl}</td></tr>
        <tr><td>Estimated A1c (GMI)</td><td>${stats.gmi.toFixed(1)}%</td></tr>
        <tr><td>Time in range (${fmtG(70)}–${fmtG(180)} ${unitLbl})</td><td>${Math.round(stats.timeInRangePct)}%</td></tr>
        <tr><td>Readings analysed</td><td>${stats.count.toLocaleString()} over ${daysSpanned(result.readings)} days</td></tr>
      </table>
      <h3>Time in Range breakdown</h3>
      <table class="clinic-report__table">
        ${tir.map(b => `<tr><td>${escapeHtml(b.label)} (${bandRange(b)} ${unitLbl})</td><td>${Math.round(b.pct)}%</td></tr>`).join("")}
      </table>
      <h3>Daily pattern</h3>
      ${svg}
    `;
  } else {
    const why = !result.ok ? result.reason : `Not enough stored glucose history for this period yet (it needs at least ${MIN_PATTERN_DAYS} days).`;
    glucoseSectionHtml = `<p>No glucose summary: ${escapeHtml(why)}</p>`;
  }

  content.innerHTML = `
    <div class="clinic-report">
      <h1>Insulin Buddy — Glucose &amp; Dosing Summary</h1>
      <p class="clinic-report__meta">Period: last ${days} days (${periodLabel}) · Generated ${new Date().toLocaleString()}</p>
      <h2>Glucose</h2>
      ${glucoseSectionHtml}
      <h2>Dosing &amp; Food</h2>
      <table class="clinic-report__table">
        <tr><td>Meals logged</td><td>${dosing.mealsLogged} over ${dosing.days} day${dosing.days === 1 ? "" : "s"}</td></tr>
        <tr><td>Average daily carbs${dosing.eatingOutCount ? "*" : ""}</td><td>${round1(dosing.avgDailyCarbs)} g</td></tr>
        <tr><td>Average daily insulin</td><td>${round1(dosing.avgDailyInsulin)} u</td></tr>
        <tr><td>Lows treated</td><td>${dosing.lowsTreated}</td></tr>
        <tr><td>Correction-only entries</td><td>${dosing.correctionsOnly}</td></tr>
        ${dosing.eatingOutCount ? `<tr><td>Eating out (carbs not tracked)</td><td>${dosing.eatingOutCount}</td></tr>` : ""}
        ${dosing.basalDoses ? `
          <tr><td>Basal doses logged</td><td>${dosing.basalDoses}</td></tr>
          <tr><td>Average daily basal</td><td>${round1(dosing.avgDailyBasal)} u</td></tr>
          <tr><td>Average total daily insulin (basal + bolus)</td><td>${round1(dosing.avgDailyTotalInsulin)} u</td></tr>` : ""}
      </table>
      ${dosing.eatingOutCount ? `<p class="clinic-report__note">*Excludes ${dosing.eatingOutCount} meal${dosing.eatingOutCount === 1 ? "" : "s"} eaten out without a carb count.</p>` : ""}
      ${byType.length ? `
        <h3>By meal</h3>
        <table class="clinic-report__table clinic-report__table--grid">
          <thead><tr><th>Meal</th><th>Count</th><th>Avg carbs</th><th>Avg dose</th><th>Carbs per unit</th></tr></thead>
          <tbody>${byType.map(t => `<tr><td>${MEAL_TYPES[t.type].label}</td><td>${t.count}</td><td>${round1(t.avgCarbs)} g</td><td>${round1(t.avgDose)} u</td><td>${t.gPerU ? round1(t.gPerU) + " g" : "—"}</td></tr>`).join("")}</tbody>
        </table>` : ""}
      ${dosing.topFoods.length ? `
        <h3>Most frequently logged</h3>
        <ul>${dosing.topFoods.map(f => `<li>${escapeHtml(f.name)} (${f.count}×)</li>`).join("")}</ul>
      ` : ""}
      <p class="clinic-report__disclaimer">Generated from self-reported data logged in Insulin Buddy. Informational only — not a substitute for clinical judgment. Estimated A1c (GMI) is not a lab result.</p>
    </div>
  `;
}

/** Event wiring. Called once by app.js, after every module has loaded. */
export function initReport() {
  el("clinic-report-close").addEventListener("click", () => { el("clinic-report-overlay").hidden = true; });
  el("clinic-report-print").addEventListener("click", () => window.print());
}
