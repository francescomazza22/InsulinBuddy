// The "Deleted · Undo" toast at the bottom of the screen. One at a time: a new one replaces the last, and its
// Undo stops being offered after five seconds.
import { el } from "./dom.js";

let undoTimer = null;
let undoAction = null;

export function showUndoToast(message, onUndo) {
  clearTimeout(undoTimer);
  undoAction = onUndo;
  const toast = el("undo-toast");
  el("undo-toast-message").textContent = message;
  toast.hidden = false;
  undoTimer = setTimeout(() => { toast.hidden = true; undoAction = null; }, 5000);
}

export function initToast() {
  el("undo-toast-btn").addEventListener("click", () => {
    if (undoAction) undoAction();
    el("undo-toast").hidden = true;
    clearTimeout(undoTimer);
    undoAction = null;
  });
}
