// Moved out of index.html so the page can run with a strict Content Security Policy (no inline scripts allowed).
// Loaded synchronously in <head>: sets the light/dark look before the first paint.
/* Runs before anything is painted, so the opening screen already matches the night or day and the chosen light or dark look
   (the app's own settings load later). The look comes from a small hint the app saves ("dark", "light" or "auto" = follow the
   phone); with no hint yet, the phone's own setting decides, and without even that, the hour does. */
(function () {
  try {
    var h = new Date().getHours(), root = document.documentElement;
    var tod = h < 5 ? "night" : h < 8 ? "dawn" : h < 12 ? "morning" : h < 17 ? "day" : h < 20 ? "dusk" : "night";
    var hint = null; try { hint = localStorage.getItem("insulinBuddy.theme"); } catch (e) {}
    var sys = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)").matches : (h >= 19 || h < 7);
    var dark = hint === "dark" ? true : hint === "light" ? false : sys;
    root.setAttribute("data-theme", dark ? "dark" : "light");
    root.setAttribute("data-tod", tod);
    root.setAttribute("data-greeting", h < 5 ? "Good night" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening");
    var m = document.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute("content", dark ? "#000000" : "#F2F2F7");
  } catch (e) {}
})();

/* 2.104.0: touch or mouse layout, per device. "Mouse" when the main pointer is precise and can hover and the screen has no
   touch at all (a PC or Mac with a mouse or trackpad); anything with a touchscreen (iPhone, iPad, even with a trackpad
   attached, or a touchscreen laptop) stays "touch", so the iPad layout never changes by itself. The choice in
   Settings > General > Layout (saved on this device only, never synced) wins over the automatic one. */
window.ibInputMode = function (pref) {
  var root = document.documentElement, mm = window.matchMedia, auto = "touch";
  try {
    if (pref === undefined) { try { pref = localStorage.getItem("insulinBuddy.input"); } catch (e) { pref = null; } }
    var fine = !!(mm && mm("(pointer: fine)").matches && mm("(hover: hover)").matches);
    var touch = (navigator.maxTouchPoints || 0) > 0;
    auto = fine && !touch ? "mouse" : "touch";
  } catch (e) {}
  var chosen = pref === "mouse" || pref === "touch" ? pref : "auto";
  var mode = chosen === "auto" ? auto : chosen;
  root.setAttribute("data-input", mode);
  return { pref: chosen, mode: mode, auto: auto };
};
try { window.ibInputMode(); } catch (e) {}
