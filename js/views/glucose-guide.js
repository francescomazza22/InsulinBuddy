// The mg/dL <-> mmol/L glucose guide, opened from the Correction section of the dose card.
import { glucoseGuideRows } from "../glucose-stats.js";
import { el } from "../ui/dom.js";
import { createSheet, sheetHeader } from "../ui/sheets.js";

// Quick-reference panel: mg/dL and mmol/L side by side, 40-400 in steps of 10. Split into two halves
// shown next to each other (rather than one long list) so the whole range fits on a phone screen at a
// glance with no scrolling. Rows are tinted by the same bands the Time in Range chart uses.
function openGlucoseGuide() {
  const trigger = el("btn-glucose-guide");
  const rows = glucoseGuideRows(40, 400, 10);
  const half = Math.ceil(rows.length / 2);
  const tableHtml = list => `
    <table class="glucose-guide__table" aria-label="Conversion table, ${list[0].mgdl} to ${list[list.length - 1].mgdl} mg/dL">
      <thead><tr><th scope="col">mg/dL</th><th scope="col">mmol/L</th></tr></thead>
      <tbody>${list.map(r => `<tr class="glucose-guide__row glucose-guide__row--${r.band}"><td>${r.mgdl}</td><td>${r.mmol.toFixed(1)}</td></tr>`).join("")}</tbody>
    </table>`;
  // Legend ranges are stated in mg/dL (the bands' native unit); the table itself gives every mmol/L equivalent.
  const legend = [
    ["veryLow", "Very low", "<54"], ["low", "Low", "54–69"], ["target", "Target", "70–180"],
    ["high", "High", "181–250"], ["veryHigh", "Very high", ">250"]
  ];
  const { $ } = createSheet({
    className: "glucose-guide", labelledBy: "glucose-guide-title", returnFocus: trigger,
    content: `
      ${sheetHeader("Glucose guide", { titleId: "glucose-guide-title" })}
      <div class="glucose-guide__tables">${tableHtml(rows.slice(0, half))}${tableHtml(rows.slice(half))}</div>
      <ul class="glucose-guide__legend">
        ${legend.map(([key, name, range]) => `<li class="glucose-guide__row--${key}"><i class="glucose-guide__swatch"></i>${name} <b>${range}</b></li>`).join("")}
      </ul>
      <p class="glucose-guide__foot">mmol/L = mg/dL &divide; 18. Colours match the Time in Range chart.</p>`
  });
  $(".sheet-close").focus({ preventScroll: true });
}

/** Event wiring. Called once by app.js, after every module has loaded. */
export function initGlucoseGuide() {
  el("btn-glucose-guide").addEventListener("click", openGlucoseGuide);
}
