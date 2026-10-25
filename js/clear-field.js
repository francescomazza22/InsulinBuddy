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
  let lastClear = 0;           // when the X last cleared a field (a touch tap must not clear twice if a click follows)
  let clearedByX = null;       // the field the X emptied, until the person types in it again
  let armed = false;           // a touch began on the X and hasn't moved off into a scroll
  const broken = new WeakSet();   // fields whose layout the X would disturb: they go without one (this session only)
  const locked = new WeakMap();   // field -> its own inline width styles, put back when the X goes
  const btn = doc.createElement("button");
  btn.type = "button";
  btn.className = "field-clear";
  btn.tabIndex = -1;
  btn.setAttribute("aria-label", "Clear");
  btn.innerHTML = X_SVG;
  // Pressing the X must not take focus away from the field (that would close the keyboard and hide the X), so the
  // press is cancelled. On a touch screen, cancelling touchstart also cancels the click that would follow (on iPhone
  // the X did nothing at all), so a touch clears on touchend; a mouse or keyboard clears on click.
  const keepFocus = e => e.preventDefault();
  btn.addEventListener("pointerdown", keepFocus);
  btn.addEventListener("mousedown", keepFocus);
  btn.addEventListener("touchstart", e => { e.preventDefault(); armed = true; }, { passive: false });
  btn.addEventListener("touchmove", e => {
    const t = e.touches[0], r = btn.getBoundingClientRect();
    if (t && (t.clientX < r.left - 12 || t.clientX > r.right + 12 || t.clientY < r.top - 12 || t.clientY > r.bottom + 12)) armed = false;
  }, { passive: true });
  btn.addEventListener("touchcancel", () => { armed = false; });
  btn.addEventListener("touchend", e => { e.preventDefault(); if (armed) clearNow(); armed = false; }, { passive: false });
  btn.addEventListener("click", e => {
    e.preventDefault(); e.stopPropagation();
    if (Date.now() - lastClear < 350) return;   // the click some browsers still send after a touch clear
    clearNow();
  });
  // Empties the field the way deleting the text by hand does: "input" now, "change" when the field is left (a change
  // straight away made some boxes put their saved value back before the person could type a new one).
  function clearNow() {
    const input = current;
    if (!input) return;
    lastClear = Date.now();
    input.value = "";
    clearedByX = input;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    try { input.focus({ preventScroll: true }); } catch { /* gone */ }
    place();
  }

  // While the X shows, the field's width is held at what it was, so the room made for the X comes out of the inside of
  // the box. Without this, a box whose width follows its content (the Library search in its row, the Nightscout URL)
  // grew when the X appeared, the safety net below removed the X, and that field never got one again.
  function lockWidth(input) {
    if (locked.has(input)) return;
    const w = input.getBoundingClientRect().width, st = input.style;
    locked.set(input, { width: st.width, minWidth: st.minWidth, maxWidth: st.maxWidth, flex: st.flex });
    st.width = st.minWidth = st.maxWidth = `${w}px`;
    st.flex = `0 0 ${w}px`;
  }
  function unlockWidth(input) {
    const was = locked.get(input);
    if (!was) return;
    Object.assign(input.style, was);
    locked.delete(input);
  }
  function hide() {
    if (current) { current.classList.remove("has-clear", "has-clear--compact"); unlockWidth(current); }
    btn.remove();
  }

  function place() {
    const input = current;
    if (!input || !input.isConnected || doc.activeElement !== input || !input.value || broken.has(input) || !isClearable(input)) { hide(); return; }
    const parent = input.parentNode;
    if (!parent) { hide(); return; }
    // The X is positioned inside the field's own parent, so it scrolls with it (sheets, panels) for free.
    if (doc.defaultView.getComputedStyle(parent).position === "static") parent.style.position = "relative";
    const compact = input.offsetWidth < COMPACT_BELOW, size = compact ? COMPACT_SIZE : SIZE;
    const was = input.getBoundingClientRect();
    lockWidth(input);
    if (btn.previousSibling !== input) input.after(btn);
    input.classList.add("has-clear");
    input.classList.toggle("has-clear--compact", compact);
    // Safety net: the X must never move or resize the box it sits in. If it did (a layout this code doesn't know about),
    // take it away again and leave that box without one.
    const now = input.getBoundingClientRect();
    if (Math.abs(now.left - was.left) > 1 || Math.abs(now.width - was.width) > 1) { hide(); broken.add(input); return; }
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
    // Left empty after the X: tell the app now, as the browser would after text deleted by hand. (If the person typed
    // after the X, the browser sends its own change.)
    if (e.target === clearedByX) { clearedByX = null; if (e.target.value === "") e.target.dispatchEvent(new Event("change", { bubbles: true })); }
  });
  doc.addEventListener("input", e => {
    if (e.isTrusted && e.target === clearedByX) clearedByX = null;
    if (e.target === current) place();
  });
  // A rotation or a resized window: measure again from the box's natural width.
  doc.defaultView.addEventListener("resize", () => { if (current) { hide(); place(); } }, { passive: true });

  return { place, hide, button: btn };
}
