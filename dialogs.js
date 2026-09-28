// In-app replacements for window.alert / confirm / prompt. They match the app's
// look, work the same in an installed PWA, support Escape / Enter, keep focus
// inside, and can ask for a password without echoing it.

export function createDialogs(doc = document) {
  let chain = Promise.resolve();   // dialogs are shown one at a time, in order

  function show(build) {
    const run = () => new Promise(resolve => {
      const previouslyFocused = doc.activeElement;
      const backdrop = doc.createElement("div");
      backdrop.className = "dialog-backdrop";
      const card = doc.createElement("div");
      card.className = "dialog";
      card.setAttribute("role", "dialog");
      card.setAttribute("aria-modal", "true");
      backdrop.appendChild(card);

      let closed = false;
      const close = value => {
        if (closed) return;
        closed = true;
        doc.removeEventListener("keydown", onKey, true);
        backdrop.remove();
        if (previouslyFocused && previouslyFocused.focus) try { previouslyFocused.focus(); } catch { /* element gone */ }
        resolve(value);
      };
      const ctl = build(card, close);
      function onKey(e) {
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(ctl.onCancel()); }
        else if (e.key === "Tab") {                                 // keep focus inside the dialog
          const f = [...card.querySelectorAll("button, input")].filter(x => !x.disabled);
          if (!f.length) return;
          const first = f[0], last = f[f.length - 1];
          if (e.shiftKey && doc.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      }
      doc.addEventListener("keydown", onKey, true);
      backdrop.addEventListener("click", e => { if (e.target === backdrop) close(ctl.onCancel()); });
      doc.body.appendChild(backdrop);
      if (ctl.focus) ctl.focus.focus();
    });
    const p = chain.then(run, run);
    chain = p.catch(() => {});
    return p;
  }

  function header(card, title, message, labelId) {
    if (title) { const h = doc.createElement("h2"); h.className = "dialog__title"; h.id = labelId; h.textContent = title; card.appendChild(h); card.setAttribute("aria-labelledby", labelId); }
    const p = doc.createElement("p");
    p.className = "dialog__message";
    p.textContent = message;              // textContent: message text can never inject markup
    card.appendChild(p);
    return p;
  }
  function button(text, cls, onClick) {
    const b = doc.createElement("button");
    b.type = "button"; b.className = `dialog__btn ${cls}`; b.textContent = text;
    b.addEventListener("click", onClick);
    return b;
  }

  return {
    alert(message, { title = "", okText = "OK" } = {}) {
      return show((card, close) => {
        header(card, title, message, "dlg-title");
        const actions = doc.createElement("div"); actions.className = "dialog__actions";
        const ok = button(okText, "dialog__btn--primary", () => close());
        actions.appendChild(ok); card.appendChild(actions);
        return { focus: ok, onCancel: () => undefined };
      });
    },
    confirm(message, { title = "", confirmText = "Continue", cancelText = "Cancel", danger = false } = {}) {
      return show((card, close) => {
        header(card, title, message, "dlg-title");
        const actions = doc.createElement("div"); actions.className = "dialog__actions";
        const cancel = button(cancelText, "dialog__btn--ghost", () => close(false));
        const ok = button(confirmText, danger ? "dialog__btn--danger" : "dialog__btn--primary", () => close(true));
        actions.append(cancel, ok); card.appendChild(actions);
        return { focus: danger ? cancel : ok, onCancel: () => false };   // destructive actions default to Cancel
      });
    },
    prompt(message, { title = "", type = "text", placeholder = "", value = "", confirmText = "OK", cancelText = "Cancel" } = {}) {
      return show((card, close) => {
        header(card, title, message, "dlg-title");
        const input = doc.createElement("input");
        input.className = "dialog__input"; input.type = type; input.placeholder = placeholder; input.value = value;
        input.autocomplete = "off"; input.autocapitalize = "off"; input.spellcheck = false;
        input.setAttribute("aria-label", title || message);
        card.appendChild(input);
        const actions = doc.createElement("div"); actions.className = "dialog__actions";
        const cancel = button(cancelText, "dialog__btn--ghost", () => close(null));
        const ok = button(confirmText, "dialog__btn--primary", () => close(input.value));
        actions.append(cancel, ok); card.appendChild(actions);
        input.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); close(input.value); } });
        return { focus: input, onCancel: () => null };
      });
    }
  };
}
