// One clear (X) button for every text-type field in the app.
//
// While a field is focused and has something in it, a small X sits inside its right-hand end; tapping it empties
// the field (firing "input" and "change" so the app reacts exactly as if the text had been deleted by hand) and
// keeps the keyboard up. A single button is moved to whichever field is being edited, so there is nothing to add
// to the markup and no work at all while nobody is typing (no timers, no scroll listeners).
//
// Skipped: checkboxes, dates, times and other non-text inputs; read-only or disabled fields; boxes too narrow to
// hold an X (inline grams editors, the 2-digit basal dose); passwords; and anything marked data-noclear (a field
// that already has its own clear button).

const IN_ROW = ".ingredient-row, .ratio-row, .ratio-x, .meal-item, .basal-dose-row, .em-grams-input";
const TEXT_TYPES = new Set(["text", "search", "number", "email", "url", "tel"]);
const MIN_WIDTH = 72;   // px: narrower boxes (inline grams editors, the 2-digit basal dose) would lose their content under the X
const SIZE = 28;        // px: the visible circle; ::after widens the touch area
const COMPACT_BELOW = 110, COMPACT_SIZE = 22;   // narrow boxes (the Calculator grams box) get a smaller X so their number stays readable
const X_SVG = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>`;

export function isClearable(input) {
  if (!input || input.tagName !== "INPUT") return false;
  const type = (input.getAttribute("type") || "text").toLowerCase();
  if (!TEXT_TYPES.has(type)) return false;
  if (input.readOnly || input.disabled) return false;
  if (input.hasAttribute("data-noclear") || input.closest("[data-noclear]")) return false;
  // Small amount boxes inside a list row (recipe ingredients, Edit Meal items, ratio rows, the Current meal) have their own
  // remove button right beside them, and too little room for a number plus an X: they never get one.
  if (input.closest(IN_ROW)) return false;
  return input.offsetWidth >= MIN_WIDTH;
}

export function installClearButtons(doc = document) {
  let current = null;
  const btn = doc.createElement("button");
  btn.type = "button";
  btn.className = "field-clear";
  btn.tabIndex = -1;
  btn.setAttribute("aria-label", "Clear");
  btn.innerHTML = X_SVG;
  // Pressing the X must not take focus away from the field (that would close the keyboard and hide the X).
  const keepFocus = e => e.preventDefault();
  btn.addEventListener("pointerdown", keepFocus);
  btn.addEventListener("mousedown", keepFocus);
  btn.addEventListener("touchstart", keepFocus, { passive: false });
  btn.addEventListener("click", e => {
    e.preventDefault(); e.stopPropagation();
    const input = current;
    if (!input) return;
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    try { input.focus({ preventScroll: true }); } catch { /* gone */ }
    place();
  });

  function hide() {
    if (current) current.classList.remove("has-clear", "has-clear--compact");
    btn.remove();
  }

  function place() {
    const input = current;
    if (!input || !input.isConnected || doc.activeElement !== input || !input.value || !isClearable(input)) { hide(); return; }
    const parent = input.parentNode;
    if (!parent) { hide(); return; }
    // The X is positioned inside the field's own parent, so it scrolls with it (sheets, panels) for free.
    if (doc.defaultView.getComputedStyle(parent).position === "static") parent.style.position = "relative";
    const compact = input.offsetWidth < COMPACT_BELOW, size = compact ? COMPACT_SIZE : SIZE;
    const was = input.getBoundingClientRect();
    if (btn.previousSibling !== input) input.after(btn);
    input.classList.add("has-clear");
    input.classList.toggle("has-clear--compact", compact);
    // Safety net: the X must never move or resize the box it sits in. If it did (a layout this code doesn't know about),
    // take it away again and leave that box without one.
    const now = input.getBoundingClientRect();
    if (Math.abs(now.left - was.left) > 1 || Math.abs(now.width - was.width) > 1) { hide(); input.setAttribute("data-noclear", ""); current = null; return; }
    btn.classList.toggle("field-clear--compact", compact);
    btn.style.top = `${input.offsetTop + (input.offsetHeight - size) / 2}px`;
    btn.style.left = `${input.offsetLeft + input.offsetWidth - size - (compact ? 5 : 8)}px`;
  }

  doc.addEventListener("focusin", e => {
    if (current && current !== e.target) hide();
    current = isClearable(e.target) ? e.target : null;
    if (current) place();
  });
  doc.addEventListener("focusout", e => {
    if (e.target === current) { hide(); current = null; }
  });
  doc.addEventListener("input", e => { if (e.target === current) place(); });
  doc.defaultView.addEventListener("resize", () => { if (current) place(); }, { passive: true });

  return { place, hide, button: btn };
}
