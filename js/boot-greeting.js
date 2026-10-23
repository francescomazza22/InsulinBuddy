// Moved out of index.html so the page can run with a strict Content Security Policy (no inline scripts allowed).
// Runs right after the opening screen's heading exists, so the greeting is in place before it is painted.
(function(){var g=document.getElementById("boot-greeting"),t=document.documentElement.getAttribute("data-greeting");if(g&&t)g.textContent=t;})();
