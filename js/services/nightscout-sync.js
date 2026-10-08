// Nightscout delivery for the app: when it's configured, every logged meal, edit and delete goes through the
// persistent outbox in js/nightscout.js, so it's delivered eventually even after time offline. Also records the
// latest real read and write for the System Status panel.
import { KEYS } from "../keys.js";
import { NightscoutClient, NsOutbox, nsBaseUrl, nsConfigured, nsToken } from "../nightscout.js";
import { el } from "../ui/dom.js";
import { renderHistoryBadges } from "../views/history-log.js";
import { renderNightscoutSection, renderStatusPanel } from "../views/settings-data.js";
import { currentUser, supabaseClient } from "./cloud.js";
import { addDiagSecret, diag } from "./diagnostics.js";
import { saveState, state } from "./store.js";

// Auditable record of the most recent real Nightscout read/write attempt --
// updated every time one actually happens (not just on manual test), so
// the System Status panel always reflects genuine, current behavior.
// via: "proxy" | "direct" | null (null = never attempted yet)
export let nightscoutReadStatus = { ok: null, via: null, at: null, message: "" };
export let nightscoutWriteStatus = { ok: null, via: null, at: null, message: "" };

// Nightscout: one client (proxy first, direct fallback) + a persistent outbox.
export const nsClient = new NightscoutClient({
  invoke: (name, body) => (supabaseClient && currentUser)
    ? supabaseClient.functions.invoke(name, { body })
    : Promise.reject(new Error("not signed in")),
  diag,
  onStatus: (kind, ok, via, message) => recordNightscoutStatus(kind, ok, via, message)
});
export const nsOutbox = new NsOutbox({
  storage: localStorage, key: KEYS.nsOutbox, client: nsClient, diag,
  getConfig: () => nsCfg(),
  onEntryPatch: (entryId, patch) => {
    const entry = state.history.find(h => h.id === entryId);
    if (!entry) return;
    Object.assign(entry, patch);
    saveState();
  },
  onChange: () => refreshNsUi()
});

// Sends the carbs + total insulin (and glucose, if a correction was used) for
// each logged meal to your own Nightscout site, as a standard "Meal Bolus"
// treatment — the same format apps like Loop and xDrip already use, so it
// shows up in Nightscout's normal treatment views/reports.

function nightscoutToken() { return nsToken(state.settings.nightscoutUrl); }
export function nightscoutBaseUrl() { return nsBaseUrl(state.settings.nightscoutUrl); }
export function nightscoutConfigured() { return nsConfigured(state.settings.nightscoutUrl); }
export function nsCfg() { return nightscoutConfigured() ? { baseUrl: nightscoutBaseUrl(), token: nightscoutToken() } : null; }
export const nsFormat = () => (state.settings.nsFormat === "split" ? "split" : "combined");

// Human wording for a Nightscout failure.
export function friendlyNsError(err) {
  if (!err) return "Something went wrong talking to Nightscout.";
  if (err.kind === "http") {
    return (err.status === 401 || err.status === 403)
      ? `Nightscout rejected the token (HTTP ${err.status}) — check it in Settings.`
      : `Nightscout responded with an error (HTTP ${err.status}).`;
  }
  if (err.kind === "proxy") return err.message;
  if (err.kind === "config") return "Nightscout isn't set up yet.";
  return /not signed in/.test(err.message || "")
    ? "Couldn't reach Nightscout directly (likely CORS) — sign in to Cloud Sync in Settings to fetch through Supabase instead."
    : "Couldn't reach Nightscout — this usually means CORS is blocking it, and the Supabase proxy isn't available either. You can still enter your glucose manually.";
}

// ---- delivery: everything goes through the outbox so it survives being offline ----
export function syncEntryToNightscout(entry) {
  if (!nightscoutConfigured()) return;
  nsOutbox.enqueueCreate(entry, { format: nsFormat(), units: state.settings.units });
  flushNightscoutQueue();
}
// Edits/deletes only follow a meal that has actually been (or is about to be) sent.
export function queueNsUpdate(entry) {
  if (!nightscoutConfigured() || state.settings.nsSyncEdits === false) return;
  if (!entry.ns && !nsOutbox.pendingFor(entry.id)) return;
  nsOutbox.enqueueUpdate(entry, { format: nsFormat(), units: state.settings.units });
  flushNightscoutQueue();
}
export function queueNsDelete(entry) {
  if (!nightscoutConfigured() || state.settings.nsSyncEdits === false) return;
  nsOutbox.enqueueDelete(entry.id, entry.ns && entry.ns.ids);
  flushNightscoutQueue();
}
// Undo of a delete: cancel the pending removal, or re-send if it already went out.
export function undoNsDelete(entry) {
  if (!nightscoutConfigured()) return;
  if (nsOutbox.cancelDelete(entry.id)) return;
  if (entry.ns && entry.ns.ids && Object.values(entry.ns.ids).some(Boolean)) { delete entry.ns; syncEntryToNightscout(entry); }
}
// immediate = the user (or the network coming back) asked for a retry, so skip the back-off wait.
export async function flushNightscoutQueue(immediate) {
  const r = immediate === true ? await nsOutbox.retryAll() : await nsOutbox.flush();
  refreshNsUi();
  return r;
}
function refreshNsUi() {
  try {
    if (!state) return;
    if (!el("view-settings").hidden) { renderNightscoutSection(); if (!el("panel-data").hidden) renderStatusPanel(); }
    if (!el("view-history").hidden) renderHistoryBadges();
  } catch (e) { /* UI not ready yet */ }
}

function recordNightscoutStatus(kind, ok, via, message) {
  const rec = { ok, via, at: Date.now(), message };
  if (kind === "read") nightscoutReadStatus = rec;
  else nightscoutWriteStatus = rec;
  // Keep the System Status panel live if it's currently on screen.
  if (!el("view-settings").hidden && !el("panel-data").hidden) renderStatusPanel();
}

/** Event wiring. Called once by app.js, after every module has loaded. */
export function initNightscoutSync() {
  addDiagSecret(nightscoutToken);
}
