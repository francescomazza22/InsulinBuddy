// The app's SVG charts, as markup strings: Active Insulin & Carbs, the glucose trend, the daily glucose pattern,
// and the three Trends bar charts. Each takes its data (and the glucose unit) as arguments.
import { formatGlucose, niceScale } from "../calc.js";
import { round1 } from "../util.js";

export function renderActiveGraphSVG(series) {
  const { points, startTime, endTime, now } = series;
  const W = 320, H = 165, padL = 26, padR = 30, padT = 10, padB = 22;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const maxIob = Math.max(0.5, ...points.map(p => p.iob));
  const maxCob = Math.max(5, ...points.map(p => p.cob));
  const xFor = t => padL + ((t - startTime) / (endTime - startTime)) * plotW;
  const yForIob = v => padT + plotH - (v / maxIob) * plotH;
  const yForCob = v => padT + plotH - (v / maxCob) * plotH;

  const iobPath = points.map((p, i) => `${i === 0 ? "M" : "L"}${xFor(p.t).toFixed(1)},${yForIob(p.iob).toFixed(1)}`).join(" ");
  const cobPath = points.map((p, i) => `${i === 0 ? "M" : "L"}${xFor(p.t).toFixed(1)},${yForCob(p.cob).toFixed(1)}`).join(" ");
  const nowX = xFor(now).toFixed(1);
  const showStartLabel = (parseFloat(nowX) - padL) > 34;
  const nowIsAtEnd = (endTime - now) < ((endTime - startTime) * 0.02); // e.g. the Today tab, where "now" IS the right edge

  const fmtTime = t => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  // Three horizontal reference lines (0%, 50%, 100% of plot height). Since
  // both curves are scaled to their own max, the same height fractions map
  // to meaningful values on both axes at once -- just different numbers.
  const fracs = [0, 0.5, 1];
  const gridlines = fracs.map(f => {
    const y = padT + plotH * (1 - f);
    const iobVal = (maxIob * f).toFixed(maxIob < 2 ? 2 : 1);
    const cobVal = Math.round(maxCob * f);
    return `
      <line x1="${padL}" y1="${y.toFixed(1)}" x2="${padL + plotW}" y2="${y.toFixed(1)}" stroke="var(--line)" stroke-width="1" ${f === 0 ? "" : 'stroke-dasharray="2,3"'}/>
      <text x="${padL - 4}" y="${(y + 3).toFixed(1)}" font-size="8" fill="#3B82F6" text-anchor="end">${iobVal}</text>
      <text x="${padL + plotW + 4}" y="${(y + 3).toFixed(1)}" font-size="8" fill="#D97706" text-anchor="start">${cobVal}</text>
    `;
  }).join("");

  // Small hourly tick marks along the X-axis for a sense of time scale,
  // in addition to the start/now/end text labels.
  const hourMs = 60 * 60000;
  const firstTick = Math.ceil(startTime / hourMs) * hourMs;
  let xTicks = "";
  for (let t = firstTick; t < endTime; t += hourMs) {
    const x = xFor(t).toFixed(1);
    xTicks += `<line x1="${x}" y1="${padT + plotH}" x2="${x}" y2="${padT + plotH + 3}" stroke="var(--ink-soft)" stroke-width="1"/>`;
  }

  return `
    <svg viewBox="0 0 ${W} ${H}" style="width:100%; height:auto; display:block;">
      ${gridlines}
      ${nowIsAtEnd ? "" : `<line x1="${nowX}" y1="${padT}" x2="${nowX}" y2="${padT + plotH}" stroke="var(--ink-soft)" stroke-width="1" stroke-dasharray="3,3" opacity="0.6"/>`}
      <path d="${cobPath}" fill="none" stroke="#D97706" stroke-width="2" stroke-linejoin="round"/>
      <path d="${iobPath}" fill="none" stroke="#3B82F6" stroke-width="2" stroke-linejoin="round"/>
      ${xTicks}
      ${nowIsAtEnd
        ? `<text x="${padL}" y="${H - 4}" font-size="9" fill="var(--ink-soft)">${fmtTime(startTime)}</text>`
        : (showStartLabel ? `<text x="${padL}" y="${H - 4}" font-size="9" fill="var(--ink-soft)">${fmtTime(startTime)}</text>` : "")}
      ${nowIsAtEnd ? "" : `<text x="${nowX}" y="${H - 4}" font-size="9" fill="var(--ink-soft)" text-anchor="${showStartLabel ? "middle" : "start"}">now</text>`}
      <text x="${padL + plotW}" y="${H - 4}" font-size="9" fill="var(--ink-soft)" text-anchor="end">${nowIsAtEnd ? "now" : fmtTime(endTime)}</text>
    </svg>
  `;
}

// A shared y-axis range for the glucose charts: scaling from 0 (as both charts used to)
// wastes the bottom ~30-40% of the chart on a 0-70 band real glucose is essentially never
// in, which visually compresses genuine variation in the 70-180 range most readings actually
// occupy. This scales tightly around the actual data instead (with the 70-180 band always
// guaranteed visible, never cropped out, plus a little breathing room), the same way
// LibreLink/Dexcom-style charts do.
function glucoseAxisRange(values) {
  const finite = (values || []).filter(v => typeof v === "number" && Number.isFinite(v));
  const dataMin = finite.length ? Math.min(70, ...finite) : 70;
  const dataMax = finite.length ? Math.max(180, ...finite) : 180;
  const pad = Math.max(10, (dataMax - dataMin) * 0.12);
  return { min: Math.max(0, Math.floor((dataMin - pad) / 10) * 10), max: Math.ceil((dataMax + pad) / 10) * 10 };
}

export function renderDailyPatternSVG(buckets, preset, unit) {
  if (buckets.length === 0) return null;
  const sorted = buckets.slice().sort((a, b) => a.minute - b.minute);
  const W = 340, H = 220, padL = 32, padR = 10, padT = 10, padB = 26;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const fmtVal = v => formatGlucose(v, unit);
  // Always scale against p5/p95 (the widest band ever computed), regardless of which preset
  // is showing -- so switching presets never rescales the y-axis and makes the chart feel
  // like it's jumping around.
  const { min: axisMin, max: axisMax } = glucoseAxisRange(sorted.flatMap(b => [b.p5, b.p95]));

  const xFor = min => padL + (min / 1440) * plotW;
  const yFor = v => padT + plotH - ((v - axisMin) / (axisMax - axisMin)) * plotH;
  const band = (hi, lo) => {
    const top = sorted.map(b => `${xFor(b.minute).toFixed(1)},${yFor(b[hi]).toFixed(1)}`).join(" L");
    const bottom = sorted.slice().reverse().map(b => `${xFor(b.minute).toFixed(1)},${yFor(b[lo]).toFixed(1)}`).join(" L");
    return `M${top} L${bottom} Z`;
  };
  const line = key => sorted.map((b, i) => `${i === 0 ? "M" : "L"}${xFor(b.minute).toFixed(1)},${yFor(b[key]).toFixed(1)}`).join(" ");
  const lowY = yFor(70).toFixed(1), highY = yFor(180).toFixed(1);

  const fmtHour = h => h === 0 || h === 24 ? "12 AM" : h === 12 ? "12 PM" : h < 12 ? `${h} AM` : `${h - 12} PM`;
  let xTicks = "", xLabels = "";
  for (let h = 0; h <= 24; h += 3) {
    const x = xFor(h * 60).toFixed(1);
    xTicks += `<line x1="${x}" y1="${padT + plotH}" x2="${x}" y2="${padT + plotH + 3}" stroke="var(--ink-soft)" stroke-width="1"/>`;
    const anchor = h === 0 ? "start" : h === 24 ? "end" : "middle";
    xLabels += `<text x="${x}" y="${H - 6}" font-size="9" fill="var(--ink-soft)" text-anchor="${anchor}">${fmtHour(h)}</text>`;
  }

  return `
    <svg viewBox="0 0 ${W} ${H}" style="width:100%; height:auto; display:block;">
      <rect x="${padL}" y="${highY}" width="${plotW}" height="${(parseFloat(lowY) - parseFloat(highY)).toFixed(1)}" fill="#22C55E" opacity="0.07"/>
      <line x1="${padL}" y1="${lowY}" x2="${padL + plotW}" y2="${lowY}" stroke="#EF4444" stroke-width="1" stroke-dasharray="2,3" opacity="0.6"/>
      <line x1="${padL}" y1="${highY}" x2="${padL + plotW}" y2="${highY}" stroke="#F59E0B" stroke-width="1" stroke-dasharray="2,3" opacity="0.6"/>
      <text x="${padL - 4}" y="${(parseFloat(lowY) + 3).toFixed(1)}" font-size="8" fill="#EF4444" text-anchor="end">${fmtVal(70)}</text>
      <text x="${padL - 4}" y="${(parseFloat(highY) + 3).toFixed(1)}" font-size="8" fill="#F59E0B" text-anchor="end">${fmtVal(180)}</text>
      ${preset.outer ? `<path d="${band(preset.outer[1], preset.outer[0])}" fill="#3B82F6" opacity="0.14"/>` : ""}
      ${preset.inner ? `<path d="${band(preset.inner[1], preset.inner[0])}" fill="#3B82F6" opacity="0.28"/>` : ""}
      <path d="${line("p50")}" fill="none" stroke="#2563EB" stroke-width="2.25" stroke-linejoin="round" stroke-linecap="round"/>
      <line x1="${padL}" y1="${padT + plotH}" x2="${padL + plotW}" y2="${padT + plotH}" stroke="var(--line)" stroke-width="1"/>
      ${xTicks}
      ${xLabels}
    </svg>
  `;
}

export function renderGlucoseGraphSVG(entries, unit) {
  const points = entries
    .filter(e => typeof e.sgv === "number")
    .map(e => ({ t: e.date, sgv: e.sgv }))
    .sort((a, b) => a.t - b.t);
  if (points.length === 0) return null;

  const W = 320, H = 165, padL = 30, padR = 10, padT = 10, padB = 22;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const startTime = points[0].t, endTime = points[points.length - 1].t;
  const span = Math.max(1, endTime - startTime);
  const { min: axisMin, max: axisMax } = glucoseAxisRange(points.map(p => p.sgv));
  const fmtVal = v => formatGlucose(v, unit);

  const xFor = t => padL + ((t - startTime) / span) * plotW;
  const yFor = v => padT + plotH - ((v - axisMin) / (axisMax - axisMin)) * plotH;

  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${xFor(p.t).toFixed(1)},${yFor(p.sgv).toFixed(1)}`).join(" ");
  const lowY = yFor(70).toFixed(1), highY = yFor(180).toFixed(1);

  const fmtTime = t => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const hourMs = 60 * 60000;
  // Pick a labeling interval so ticks and their text always line up -- previously the two
  // edge labels showed the raw fetch start/end time while the tick marks sat on round hours,
  // so the labels never landed under any tick.
  const spanHours = span / hourMs;
  const niceHours = [1, 2, 3, 4, 6, 8, 12].find(h => spanHours / h <= 6) || 12;
  const tickMs = niceHours * hourMs;
  const firstTick = Math.ceil(startTime / tickMs) * tickMs;
  // Every label sits directly under its own tick (same x for both) -- guaranteed aligned,
  // rather than the old approach of separately placing the two edge labels at the raw
  // fetch start/end time, which rarely lined up with the hourly tick marks at all.
  let xTicks = "", xLabels = "";
  for (let t = firstTick; t <= endTime; t += tickMs) {
    const x = xFor(t).toFixed(1);
    xTicks += `<line x1="${x}" y1="${padT + plotH}" x2="${x}" y2="${padT + plotH + 3}" stroke="var(--ink-soft)" stroke-width="1"/>`;
    const anchor = parseFloat(x) < padL + 14 ? "start" : parseFloat(x) > padL + plotW - 14 ? "end" : "middle";
    xLabels += `<text x="${x}" y="${H - 4}" font-size="9" fill="var(--ink-soft)" text-anchor="${anchor}">${fmtTime(t)}</text>`;
  }

  return `
    <svg viewBox="0 0 ${W} ${H}" style="width:100%; height:auto; display:block;">
      <rect x="${padL}" y="${highY}" width="${plotW}" height="${(parseFloat(lowY) - parseFloat(highY)).toFixed(1)}" fill="#22C55E" opacity="0.08"/>
      <line x1="${padL}" y1="${lowY}" x2="${padL + plotW}" y2="${lowY}" stroke="#EF4444" stroke-width="1" stroke-dasharray="2,3" opacity="0.6"/>
      <line x1="${padL}" y1="${highY}" x2="${padL + plotW}" y2="${highY}" stroke="#F59E0B" stroke-width="1" stroke-dasharray="2,3" opacity="0.6"/>
      <text x="${padL - 4}" y="${(parseFloat(lowY) + 3).toFixed(1)}" font-size="8" fill="#EF4444" text-anchor="end">${fmtVal(70)}</text>
      <text x="${padL - 4}" y="${(parseFloat(highY) + 3).toFixed(1)}" font-size="8" fill="#F59E0B" text-anchor="end">${fmtVal(180)}</text>
      <path d="${path}" fill="none" stroke="#3B82F6" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      <line x1="${padL}" y1="${padT + plotH}" x2="${padL + plotW}" y2="${padT + plotH}" stroke="var(--line)" stroke-width="1"/>
      ${xTicks}
      ${xLabels}
    </svg>
  `;
}


function trendGeometry(n, maxVal, containerWidth) {
  const W = Math.max(containerWidth || 320, 220), H = 172;
  const padL = 30, padR = 6, padT = 10, padB = 30;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const slotW = plotW / n;
  const barW = Math.min(26, Math.max(3, slotW * 0.68));
  const { max, step } = niceScale(maxVal, 3);
  return {
    W, H, padL, padR, padT, padB, plotW, plotH, n, slotW, barW, max, step,
    yFor: v => padT + plotH - (v / max) * plotH,
    xSlot: i => padL + i * slotW,
    xBar: i => padL + i * slotW + (slotW - barW) / 2
  };
}

// Everything that isn't a bar: weekend shading, gridlines + value labels,
// the dashed average line, and the date / weekday labels.
function trendFrameSvg(g, buckets, avgValue, avgText) {
  const fmtAxis = v => Number.isInteger(v) ? String(v) : v.toFixed(1);
  let weekend = "", grid = "", labels = "";
  const labelStep = g.n <= 14 ? 1 : 5; // anchored on today so it's always labeled
  buckets.forEach((b, i) => {
    const d = new Date(b.key);
    const dow = d.getDay();
    if (dow === 0 || dow === 6) {
      weekend += `<rect class="trend-chart__weekend" x="${g.xSlot(i).toFixed(1)}" y="${g.padT}" width="${g.slotW.toFixed(1)}" height="${g.plotH}"></rect>`;
    }
    if ((g.n - 1 - i) % labelStep === 0) {
      const isToday = i === g.n - 1;
      const cx = (g.xSlot(i) + g.slotW / 2).toFixed(1);
      const todayCls = isToday ? " trend-chart__axis-label--today" : "";
      labels += `<text class="trend-chart__axis-label${todayCls}" x="${cx}" y="${g.H - 17}" text-anchor="middle">${d.getDate()}</text>`;
      if (g.n <= 14) {
        labels += `<text class="trend-chart__axis-label trend-chart__axis-label--dow${todayCls}" x="${cx}" y="${g.H - 6}" text-anchor="middle">${d.toLocaleDateString(undefined, { weekday: "narrow" })}</text>`;
      }
    }
  });
  const ticks = Math.round(g.max / g.step);
  for (let k = 0; k <= ticks; k++) {
    const v = k * g.step, y = g.yFor(v);
    grid += `<line class="trend-chart__grid${k === 0 ? " is-base" : ""}" x1="${g.padL}" y1="${y.toFixed(1)}" x2="${g.W - g.padR}" y2="${y.toFixed(1)}"></line>`;
    grid += `<text class="trend-chart__axis-label" x="${g.padL - 5}" y="${(y + 3).toFixed(1)}" text-anchor="end">${fmtAxis(v)}</text>`;
  }
  let avg = "";
  if (avgValue > 0) {
    const y = g.yFor(avgValue);
    avg = `<line class="trend-chart__avg" x1="${g.padL}" y1="${y.toFixed(1)}" x2="${g.W - g.padR}" y2="${y.toFixed(1)}"></line>` +
          `<text class="trend-chart__avg-label" x="${g.W - g.padR - 2}" y="${(y - 4).toFixed(1)}">${avgText}</text>`;
  }
  return { under: weekend + grid, over: avg + labels };
}

// Invisible full-height column per day, so a tap anywhere in the column
// selects that day (much easier than hitting a thin bar on a phone).
function trendHitAreas(g) {
  let out = "";
  for (let i = 0; i < g.n; i++) {
    out += `<rect class="trend-chart__hit" data-idx="${i}" x="${g.xSlot(i).toFixed(1)}" y="${g.padT}" width="${g.slotW.toFixed(1)}" height="${g.plotH}"></rect>`;
  }
  return out;
}

export function buildCarbsChartSvg(buckets, avg, width) {
  const g = trendGeometry(buckets.length, Math.max(...buckets.map(b => b.carbs)), width);
  const frame = trendFrameSvg(g, buckets, avg, `avg ${Math.round(avg)}g`);
  const base = g.padT + g.plotH;
  const bars = buckets.map((b, i) => {
    const has = b.carbs > 0;
    const h = has ? Math.max(2, (b.carbs / g.max) * g.plotH) : 1;
    const cls = `trend-chart__bar${has ? "" : " trend-chart__bar--empty"}${i === g.n - 1 ? " trend-chart__bar--today" : ""}`;
    return `<rect class="${cls}" data-idx="${i}" x="${g.xBar(i).toFixed(1)}" y="${(base - h).toFixed(1)}" width="${g.barW.toFixed(1)}" height="${h.toFixed(1)}" rx="2"></rect>`;
  }).join("");
  return `<svg class="trend-chart" viewBox="0 0 ${g.W} ${g.H}" style="width:100%;height:${g.H}px;display:block;">${frame.under}${bars}${frame.over}${trendHitAreas(g)}</svg>`;
}

// Stacked: meal insulin on the bottom, correction insulin on top.
export function buildDoseChartSvg(buckets, avg, width) {
  const g = trendGeometry(buckets.length, Math.max(...buckets.map(b => b.dose)), width);
  const frame = trendFrameSvg(g, buckets, avg, `avg ${round1(avg)}u`);
  const base = g.padT + g.plotH;
  const bars = buckets.map((b, i) => {
    const todayCls = i === g.n - 1 ? " trend-chart__bar--today" : "";
    if (b.dose <= 0) {
      return `<rect class="trend-chart__bar trend-chart__bar--empty${todayCls}" data-idx="${i}" x="${g.xBar(i).toFixed(1)}" y="${(base - 1).toFixed(1)}" width="${g.barW.toFixed(1)}" height="1" rx="2"></rect>`;
    }
    const hMeal = b.meal > 0 ? Math.max(2, (b.meal / g.max) * g.plotH) : 0;
    const hCorr = b.corr > 0 ? Math.max(2, (b.corr / g.max) * g.plotH) : 0;
    let out = "";
    if (hMeal > 0) {
      out += `<rect class="trend-chart__bar${todayCls}" data-idx="${i}" x="${g.xBar(i).toFixed(1)}" y="${(base - hMeal).toFixed(1)}" width="${g.barW.toFixed(1)}" height="${hMeal.toFixed(1)}" rx="${hCorr > 0 ? 0 : 2}"></rect>`;
    }
    if (hCorr > 0) {
      out += `<rect class="trend-chart__bar trend-chart__bar--corr${todayCls}" data-idx="${i}" x="${g.xBar(i).toFixed(1)}" y="${(base - hMeal - hCorr).toFixed(1)}" width="${g.barW.toFixed(1)}" height="${hCorr.toFixed(1)}" rx="2"></rect>`;
    }
    return out;
  }).join("");
  return `<svg class="trend-chart" viewBox="0 0 ${g.W} ${g.H}" style="width:100%;height:${g.H}px;display:block;">${frame.under}${bars}${frame.over}${trendHitAreas(g)}</svg>`;
}

// Basal insulin per day. Stacked like the dose chart: the morning dose on the bottom (light blue) and the evening dose
// on top (dark blue), so with variable doses you can see which of the two is moving, not just the daily total.
export function buildBasalChartSvg(buckets, avg, width) {
  const g = trendGeometry(buckets.length, Math.max(1, ...buckets.map(b => b.basal)), width);
  const frame = trendFrameSvg(g, buckets, avg, `avg ${round1(avg)}u`);
  const base = g.padT + g.plotH;
  const bars = buckets.map((b, i) => {
    const todayCls = i === g.n - 1 ? " trend-chart__bar--today" : "";
    const x = g.xBar(i).toFixed(1), w = g.barW.toFixed(1);
    if (b.basal <= 0) return `<rect class="trend-chart__bar trend-chart__bar--empty${todayCls}" data-idx="${i}" x="${x}" y="${(base - 1).toFixed(1)}" width="${w}" height="1" rx="2"></rect>`;
    const hAm = b.bAm > 0 ? Math.max(2, (b.bAm / g.max) * g.plotH) : 0;
    const hPm = b.bPm > 0 ? Math.max(2, (b.bPm / g.max) * g.plotH) : 0;
    let out = "";
    if (hAm > 0) out += `<rect class="trend-chart__bar trend-chart__bar--basal-am${todayCls}" data-idx="${i}" x="${x}" y="${(base - hAm).toFixed(1)}" width="${w}" height="${hAm.toFixed(1)}" rx="${hPm > 0 ? 0 : 2}"></rect>`;
    if (hPm > 0) out += `<rect class="trend-chart__bar trend-chart__bar--basal-pm${todayCls}" data-idx="${i}" x="${x}" y="${(base - hAm - hPm).toFixed(1)}" width="${w}" height="${hPm.toFixed(1)}" rx="2"></rect>`;
    return out;
  }).join("");
  return `<svg class="trend-chart" viewBox="0 0 ${g.W} ${g.H}" style="width:100%;height:${g.H}px;display:block;">${frame.under}${bars}${frame.over}${trendHitAreas(g)}</svg>`;
}
