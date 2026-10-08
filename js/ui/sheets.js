// Opening and closing bottom sheets (pop-ups): the page behind is pinned so it can't scroll or jump, and on
// iPhone the sheet follows the visible area so the keyboard never covers it. createSheet() builds one with the
// standard header and all the usual ways to close it; openSheet / closeSheet are the low-level halves it uses.

let openSheetCount = 0;
// On iPhone the on-screen keyboard does NOT shrink the page: the layout stays full-height and the keyboard just
// sits on top of its bottom edge. A sheet anchored to the bottom of the page therefore ends up underneath it,
// with the field being typed into half hidden. The "visual viewport" is the part you can actually see, so while
// any sheet is open its position and height are mirrored into CSS variables (--vv-top / --vv-height) that the
// sheet's backdrop uses to sit exactly in the visible area, above the keyboard; `kb-open` is set while the
// keyboard is up so the sheet can drop its non-essential parts. The field being typed into is scrolled into view.
let stopTrackingViewport = null;
function trackVisualViewport() {
  const vv = window.visualViewport;
  if (!vv) return null;                                   // an older browser: sheets just behave as they always did
  const root = document.documentElement;
  const clear = () => { root.style.removeProperty("--vv-top"); root.style.removeProperty("--vv-height"); root.classList.remove("kb-open"); };
  const sync = () => {
    if (vv.scale > 1.01) { clear(); return; }             // pinch-zoomed: the visible area says nothing about a keyboard
    root.style.setProperty("--vv-top", vv.offsetTop + "px");
    root.style.setProperty("--vv-height", vv.height + "px");
    root.classList.toggle("kb-open", window.innerHeight - vv.height > 120);
  };
  const onFocusIn = e => {
    const t = e.target;
    if (!t || !t.closest || !t.closest(".sheet") || !/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    // After the keyboard has finished sliding up, centre the field in the SHEET. scrollIntoView would also be
    // free to scroll the page behind it, which is exactly what must not move.
    const sheet = t.closest(".sheet");
    setTimeout(() => {
      const sr = sheet.getBoundingClientRect(), tr = t.getBoundingClientRect();
      const delta = (tr.top + tr.height / 2) - (sr.top + sr.height / 2);
      try { sheet.scrollBy({ top: delta, behavior: "smooth" }); } catch { sheet.scrollTop += delta; }
    }, 350);
  };
  vv.addEventListener("resize", sync); vv.addEventListener("scroll", sync);
  document.addEventListener("focusin", onFocusIn);
  sync();
  return () => { vv.removeEventListener("resize", sync); vv.removeEventListener("scroll", sync); document.removeEventListener("focusin", onFocusIn); clear(); };
}
// While a sheet is open the page behind must not move. `overflow: hidden` on the body alone isn't enough on iPhone
// Safari (the page can still be dragged, and the keyboard can nudge it), so the body is instead pinned in place with
// position: fixed -- shifted up by however far the page was scrolled so nothing visibly jumps -- and the scroll
// position is put back exactly on close. Touches on the dimmed area outside the sheet are swallowed.
let lockedScrollY = 0, pagePinned = false;
function openSheet(backdrop) {
  document.body.appendChild(backdrop);
  openSheetCount++;
  if (openSheetCount === 1) {
    lockedScrollY = window.scrollY || document.documentElement.scrollTop || 0;
    document.body.style.top = `-${lockedScrollY}px`;
    document.body.classList.add("sheet-open");
    pagePinned = true;
    if (!stopTrackingViewport) stopTrackingViewport = trackVisualViewport();
  }
  backdrop.addEventListener("touchmove", e => { if (!e.target.closest(".sheet")) e.preventDefault(); }, { passive: false });
}
function closeSheet(backdrop) {
  if (!backdrop.isConnected) return;                      // already closed: don't count it twice
  backdrop.remove();
  openSheetCount = Math.max(0, openSheetCount - 1);
  if (openSheetCount === 0) {
    document.body.classList.remove("sheet-open");
    document.body.style.top = "";
    // Only put the page back if we were the ones who pinned it. Restoring a scroll position that was never
    // saved would fling the page to wherever it happened to be last time (usually the very top).
    if (pagePinned) { window.scrollTo(0, lockedScrollY); pagePinned = false; }
    if (stopTrackingViewport) { stopTrackingViewport(); stopTrackingViewport = null; }
  }
}

const CLOSE_ICON = '<svg viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

/** The standard sheet header: the title and the X button. `titleId` lets the sheet be labelled by its title. */
export function sheetHeader(title, { titleId = "" } = {}) {
  return `
    <div class="sheet-head">
      <h2${titleId ? ` id="${titleId}"` : ""}>${title}</h2>
      <button class="sheet-close" type="button" aria-label="Close">${CLOSE_ICON}</button>
    </div>`;
}

/**
 * Builds a sheet around `content` (the HTML inside .sheet, usually starting with sheetHeader()) and opens it.
 * It closes on a tap outside the sheet, on the X (anything with .sheet-close), on anything matching `closeOn`
 * (a Cancel button, say), and on Escape -- unless an app dialog is open on top, which handles its own Escape.
 * When it closes, focus goes back to `returnFocus` if that's still on the page, and `onClose` runs.
 * Returns { backdrop, sheet, $, close }: `$` is querySelector within the sheet.
 */
export function createSheet({ content, className = "", labelledBy = "", closeOn = [], returnFocus = null, onClose = null }) {
  const backdrop = document.createElement("div");
  backdrop.className = "sheet-backdrop";
  backdrop.innerHTML = `<div class="sheet${className ? " " + className : ""}" role="dialog" aria-modal="true"${labelledBy ? ` aria-labelledby="${labelledBy}"` : ""}>${content}</div>`;
  const closeSelector = [".sheet-close", ...closeOn].join(", ");
  const onKey = e => { if (e.key === "Escape" && !document.querySelector(".dialog-backdrop")) close(); };
  function close() {
    if (!backdrop.isConnected) return;
    document.removeEventListener("keydown", onKey);
    closeSheet(backdrop);
    if (returnFocus && returnFocus.isConnected) returnFocus.focus({ preventScroll: true });
    if (onClose) onClose();
  }
  backdrop.addEventListener("click", e => { if (e.target === backdrop || e.target.closest(closeSelector)) close(); });
  document.addEventListener("keydown", onKey);
  openSheet(backdrop);
  return { backdrop, sheet: backdrop.firstElementChild, $: sel => backdrop.querySelector(sel), close };
}
