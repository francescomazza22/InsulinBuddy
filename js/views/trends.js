// History > Trends: daily carbs, insulin and basal over 7 / 14 / 30 days, the headline numbers, and the By Meal
// breakdown. Tap a day in any chart to see it in all of them.
import { basalByDay, buildTrendBuckets, mealTypeBreakdown, summarizeBasal, summarizeTrends } from "../calc.js";
import { MEAL_TYPES } from "../constants.js";
import { state } from "../services/store.js";
import { buildBasalChartSvg, buildCarbsChartSvg, buildDoseChartSvg } from "../ui/charts.js";
import { el } from "../ui/dom.js";
import { round1 } from "../util.js";
import { historyTrendsPanel } from "./history-log.js";

export let trendsRange = 14;
const trendsRangeSegmented = el("trends-range-segmented");

// Tapping a day highlights it in BOTH charts and shows its exact numbers,
// so carbs and insulin for the same day can be compared at a glance.
const trendChartCtx = {};   // container id -> { defaultText, describe(idx) }
let trendSelectedIdx = null;
function setTrendSelection(idx) {
  trendSelectedIdx = idx;
  Object.keys(trendChartCtx).forEach(id => {
    const box = el(id);
    const svg = box && box.querySelector("svg");
    const readout = box && box.querySelector(".trend-readout");
    if (!svg || !readout) return;
    box.querySelectorAll(".is-selected").forEach(n => n.classList.remove("is-selected"));
    if (idx == null) {
      svg.classList.remove("has-selection");
      readout.textContent = trendChartCtx[id].defaultText;
      return;
    }
    svg.classList.add("has-selection");
    box.querySelectorAll(`.trend-chart__bar[data-idx="${idx}"]`).forEach(n => n.classList.add("is-selected"));
    readout.textContent = trendChartCtx[id].describe(idx);
  });
}

function renderTrendMealBreakdown(entries) {
  const box = el("trend-meal-breakdown");
  if (!box) return;
  const rows = mealTypeBreakdown(entries);
  if (!rows.length) {
    box.innerHTML = `<p class="panel-card__hint">No regular meals logged in this period.</p>`;
    return;
  }
  const maxCarbs = Math.max(...rows.map(r => r.avgCarbs));
  box.innerHTML = `<p class="panel-card__hint">Average per meal over this period.</p>` + rows.map(r => {
    const m = MEAL_TYPES[r.type];
    const pct = Math.max(4, Math.round((r.avgCarbs / maxCarbs) * 100));
    return `
      <div class="meal-break-row">
        <div class="meal-break-row__head">
          <span class="meal-break-row__dot" style="background:${m.color};"></span>
          <span class="meal-break-row__name">${m.label}</span>
          <span class="meal-break-row__count">${r.count} meal${r.count === 1 ? "" : "s"}</span>
          <span class="meal-break-row__vals">${Math.round(r.avgCarbs)} g</span>
        </div>
        <div class="meal-break-row__track"><span class="meal-break-row__fill" style="width:${pct}%;background:${m.color};"></span></div>
        <div class="meal-break-row__sub">${round1(r.avgDose)} u avg dose${r.gPerU ? ` &middot; ${round1(r.gPerU)} g per unit` : ""}</div>
      </div>`;
  }).join("");
}

// The "Daily basal insulin" card. Shown only when a basal dose was logged in the period; it joins the tap-a-day
// selection shared by the other charts (see setTrendSelection) while it is showing.
function renderBasalTrend(buckets, sum, fallbackWidth) {
  const card = el("trend-card-basal"), box = el("trend-chart-basal"), panel = el("history-trends-panel");
  if (!card || !box) return;
  delete trendChartCtx["trend-chart-basal"];
  card.hidden = !sum.hasData;
  if (panel) panel.classList.toggle("has-basal", sum.hasData);
  if (!sum.hasData) { box.innerHTML = ""; return; }
  const fmtDay = ts => new Date(ts).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  trendChartCtx["trend-chart-basal"] = {
    defaultText: `Avg ${round1(sum.avg)} u / day \u00b7 tap a day for details`,
    describe: i => {
      const b = buckets[i];
      if (b.basal <= 0) return `${fmtDay(b.key)} \u00b7 no basal logged`;
      const parts = [];
      if (b.bAm > 0) parts.push(`morning ${round1(b.bAm)}`);
      if (b.bPm > 0) parts.push(`evening ${round1(b.bPm)}`);
      return `${fmtDay(b.key)} \u00b7 ${round1(b.basal)} u basal (${parts.join(" + ")})`;
    }
  };
  const averages = [];
  if (sum.avgAm > 0) averages.push(`Morning avg ${round1(sum.avgAm)} u`);
  if (sum.avgPm > 0) averages.push(`Evening avg ${round1(sum.avgPm)} u`);
  box.innerHTML =
    `<p class="trend-readout">${trendChartCtx["trend-chart-basal"].defaultText}</p>` +
    buildBasalChartSvg(buckets, sum.avg, box.clientWidth || fallbackWidth) +
    `<div class="trend-legend"><span><span class="trend-legend__dot" style="background:#8DB9DE;"></span>Morning</span><span><span class="trend-legend__dot" style="background:#356E9C;"></span>Evening</span></div>` +
    (averages.length ? `<p class="trend-caption trend-caption--tight">${averages.join(" \u00b7 ")}</p>` : "");
}

export function renderTrends(days) {
  const chartCarbsBox = el("trend-chart-carbs");
  const chartDoseBox = el("trend-chart-dose");
  const statsBox = el("trend-stats");
  const emptyBox = el("trends-empty");
  if (!chartCarbsBox) return; // view not in the DOM yet on first boot
  const cards = ["trend-card-carbs", "trend-card-dose", "trend-card-meals"].map(id => el(id));
  const captionBox = el("trend-caption");

  // Day buckets (oldest first, on true local midnights) and the headline numbers: js/calc.js, unit-tested there.
  const { buckets, inRange, todayKey } = buildTrendBuckets(state.history, days);
  // Basal (long-acting) insulin per day, over these same day buckets.
  const bucketKeys = buckets.map(b => b.key);
  const basalMap = basalByDay(state.history, bucketKeys);
  buckets.forEach(b => { const x = basalMap.get(b.key); b.bAm = x.am; b.bPm = x.pm; b.basal = x.total; b.bCount = x.count; });
  const basalSummary = summarizeBasal(basalMap, bucketKeys, todayKey);

  trendSelectedIdx = null;
  if (inRange.length === 0) {
    cards.forEach(c => { if (c) c.hidden = true; });
    statsBox.innerHTML = "";
    if (captionBox) captionBox.textContent = "";
    chartCarbsBox.innerHTML = "";
    chartDoseBox.innerHTML = "";
    Object.keys(trendChartCtx).forEach(k => delete trendChartCtx[k]);
    // No meals in this period, but basal doses are still worth charting, so only call it empty if there's neither.
    emptyBox.hidden = basalSummary.hasData;
    renderBasalTrend(buckets, basalSummary, 320);
    return;
  }
  emptyBox.hidden = true;
  cards.forEach(c => { if (c) c.hidden = false; });

  // Averages use complete days with logs (today is still in progress), unless today is the only day with data.
  const { avgCarbs, avgDose, avgDays, usingToday, regularMeals, corrections, lows, gPerU, totalCorrIns, totalIns, corrPct } = summarizeTrends(buckets, inRange, todayKey);

  const card = (value, unit, label, warn) =>
    `<div class="trend-stat-card${warn ? " trend-stat-card--warn" : ""}"><div class="trend-stat-card__value">${value}${unit ? `<span class="trend-stat-card__unit">${unit}</span>` : ""}</div><div class="trend-stat-card__label">${label}</div></div>`;
  statsBox.innerHTML =
    card(regularMeals, "", "Meals logged") +
    card(round1(avgCarbs), "g", "Avg carbs / day") +
    card(round1(avgDose), "u", "Avg dose / day") +
    card(gPerU == null ? "&mdash;" : gPerU, gPerU == null ? "" : "g/u", "Carbs per unit") +
    card(corrections, "", "Corrections") +
    card(lows, "", "Lows treated", lows > 0);

  const fmtShort = ts => new Date(ts).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  if (captionBox) {
    captionBox.textContent = `${fmtShort(buckets[0].key)} \u2013 ${fmtShort(todayKey)} \u00b7 ` +
      (usingToday ? "averages include today so far" : `averages use ${avgDays} full day${avgDays === 1 ? "" : "s"} with logs`);
  }

  const fmtDay = ts => new Date(ts).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  const width = chartCarbsBox.clientWidth || 320;

  trendChartCtx["trend-chart-carbs"] = {
    defaultText: `Avg ${Math.round(avgCarbs)} g / day \u00b7 tap a day for details`,
    describe: i => {
      const b = buckets[i];
      if (b.entries === 0) return `${fmtDay(b.key)} \u00b7 nothing logged`;
      return `${fmtDay(b.key)} \u00b7 ${b.carbs > 0 ? Math.round(b.carbs) + " g carbs" : "no carbs"} \u00b7 ${b.entries} entr${b.entries === 1 ? "y" : "ies"}`;
    }
  };
  trendChartCtx["trend-chart-dose"] = {
    defaultText: `Avg ${round1(avgDose)} u / day \u00b7 tap a day for details`,
    describe: i => {
      const b = buckets[i];
      if (b.entries === 0) return `${fmtDay(b.key)} \u00b7 nothing logged`;
      if (b.dose <= 0) return `${fmtDay(b.key)} \u00b7 no insulin logged`;
      return `${fmtDay(b.key)} \u00b7 ${round1(b.dose)} u ` + (b.corr > 0 ? `(meal ${round1(b.meal)} + correction ${round1(b.corr)})` : "(all meal insulin)");
    }
  };

  chartCarbsBox.innerHTML =
    `<p class="trend-readout">${trendChartCtx["trend-chart-carbs"].defaultText}</p>` +
    buildCarbsChartSvg(buckets, avgCarbs, width);
  chartDoseBox.innerHTML =
    `<p class="trend-readout">${trendChartCtx["trend-chart-dose"].defaultText}</p>` +
    buildDoseChartSvg(buckets, avgDose, width) +
    `<div class="trend-legend"><span><span class="trend-legend__dot" style="background:var(--acc-1);"></span>Meal insulin</span><span><span class="trend-legend__dot" style="background:#C0392B;"></span>Correction</span></div>` +
    (totalIns > 0 ? `<p class="trend-caption trend-caption--tight">Corrections were ${corrPct}% of logged insulin (${round1(totalCorrIns)} of ${round1(totalIns)} u).</p>` : "");

  renderBasalTrend(buckets, basalSummary, width);
  renderTrendMealBreakdown(inRange);
}

let trendResizeTimer = null;

/** Event wiring. Called once by app.js, after every module has loaded. */
export function initTrends() {
  trendsRangeSegmented.addEventListener("click", e => {
    const btn = e.target.closest(".segmented__btn");
    if (!btn) return;
    trendsRange = parseInt(btn.dataset.range, 10);
    trendsRangeSegmented.querySelectorAll(".segmented__btn").forEach(b => b.classList.toggle("is-active", b === btn));
    renderTrends(trendsRange);
  });
  ["trend-chart-carbs", "trend-chart-dose", "trend-chart-basal"].forEach(id => {
    const box = el(id);
    if (!box) return;
    box.addEventListener("click", e => {
      const hit = e.target.closest("[data-idx]");
      if (!hit) return;
      const idx = parseInt(hit.dataset.idx, 10);
      setTrendSelection(idx === trendSelectedIdx ? null : idx);
    });
  });
  window.addEventListener("resize", () => {
    clearTimeout(trendResizeTimer);
    trendResizeTimer = setTimeout(() => { if (!historyTrendsPanel.hidden) renderTrends(trendsRange); }, 150);
  });
}
