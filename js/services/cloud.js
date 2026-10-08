// Optional cloud sync through Supabase: sign-in, loading and saving the account's copy, and merging it with this
// device's copy (the merge rules are in js/state.js). Also guards against ever uploading an emptied history by
// accident, and retries whenever the app comes back online.
import { defaultState } from "../constants.js";
import { decryptString, encryptString, isEncryptedPayload } from "../crypto.js";
import { KEYS } from "../keys.js";
import { mergeStates, statesEquivalent, unexplainedEmptying } from "../state.js";
import { dialogs } from "../ui/dom.js";
import { renderStatusPanel } from "../views/settings-data.js";
import { renderAfterSync, renderEverything } from "../views/shell.js";
import { diag } from "./diagnostics.js";
import { encryptionKey, getLockConfig } from "./lock.js";
import { flushNightscoutQueue } from "./nightscout-sync.js";
import { adoptState, loadLocalState, localWasLegacy, markStateBaseline, normalizeState, saveStateRaw, snapshotNow, state } from "./store.js";

// Fill these in after creating a free Supabase project (see README.md).
// Left as placeholders, the app works exactly as before: local-only,
// stored in this browser. The anon key is meant to be public — it's
// useless without the Row Level Security policies set up in the SQL
// script, which restrict every row to its owning user.
const SUPABASE_URL = "https://igfunxofpkenyrzlcyyv.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_bi30N-e36pzW0qhEl_AXtA_SRARSbY4";

const cloudConfigured = SUPABASE_URL !== "YOUR_SUPABASE_URL" && SUPABASE_ANON_KEY !== "YOUR_SUPABASE_ANON_KEY";
export const supabaseClient = (cloudConfigured && window.supabase)
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;
export let currentUser = null; // { id, email } once signed in; null in local-only mode
export let cloudLoadStatus = { ok: true, message: "", at: null };
let lastKnownCloudHistoryIds = null;   // ...and exactly WHICH meals the cloud had, so a deliberate delete can be told from an accident
export let cloudSaveBlocked = null; // { fromCount, toCount } when the guard below trips, else null
const PENDING_SYNC_KEY = KEYS.pendingSync;
export let cloudSyncPending = localStorage.getItem(PENDING_SYNC_KEY) === "1";


export async function signUp(email, password) {
  if (!supabaseClient) throw new Error("Cloud sync isn't set up yet.");
  const { error } = await supabaseClient.auth.signUp({ email, password });
  if (error) throw error;
}
export async function signIn(email, password) {
  if (!supabaseClient) throw new Error("Cloud sync isn't set up yet.");
  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) throw error;
}
export async function signOut() {
  if (!supabaseClient) return;
  await supabaseClient.auth.signOut();
}

// `prefetched`, when given, is a { data, error } already fetched by the caller (boot() merges
// this with its own lock-config check into one round-trip, since both need the same row) --
// skips the query entirely rather than fetching the same row twice.
async function loadStateCloud(prefetched) {
  const { data, error } = prefetched || await supabaseClient
    .from("app_state").select("data, updated_at, lock").eq("user_id", currentUser.id).maybeSingle();
  if (error) {
    console.error("Cloud load failed:", error);
    diag.log("error", "sync", "Cloud load failed: " + (error.message || error));
    return { ok: false }; // couldn't reach the cloud -- NOT the same as "no data exists yet"
  }
  if (!data) return { ok: true, state: null }; // first sign-in, no row yet -- safe to initialize
  let raw = data.data;
  if (isEncryptedPayload(raw)) {
    // The account is passphrase-protected. By the time we get here boot()'s sign-in
    // flow should already have made sure encryptionKey is set (adopting this device
    // to the account's lock config and prompting to unlock first) -- but if it isn't,
    // fail gracefully rather than trying to treat ciphertext as a state object.
    if (!encryptionKey) { diag.log("warn", "sync", "Cloud data is encrypted but this device hasn't unlocked yet"); return { ok: false }; }
    try { raw = JSON.parse(await decryptString(encryptionKey, raw)); }
    catch (e) { diag.log("error", "sync", "Couldn't decrypt cloud data: " + ((e && e.message) || e)); return { ok: false }; }
  }
  return { ok: true, state: normalizeState(raw), updatedAt: data.updated_at };
}

/** The account's cloud row, fetched once at sign-in: its `lock` says whether the account needs a passphrase, and
 * its data is reused by adoptSignedInData instead of being downloaded a second time. Never throws. */
export async function fetchAccountRow() {
  try { return await supabaseClient.from("app_state").select("data, updated_at, lock").eq("user_id", currentUser.id).maybeSingle(); }
  catch (e) { return { data: null, error: e }; }
}

/** After sign-in (and unlock, if the account has a passphrase): settle which data to use -- this device's copy,
 * the account's cloud copy, or the two merged -- make it the app's data, and bring the cloud copy up to date. */
export async function adoptSignedInData(accountRow) {
  const local = await loadLocalState();
  const localLegacy = localWasLegacy;
  const result = await loadStateCloud(accountRow);
  if (!result.ok) {
    // Couldn't reach the cloud right now (network hiccup, etc.) -- NOT the same as "no data exists yet". Use
    // what's saved on this device and leave the cloud row completely untouched.
    cloudLoadStatus = { ok: false, message: "Couldn't load your data from the cloud — showing what's saved on this device instead.", at: Date.now() };
    adoptState(local);
    return;
  }
  cloudLoadStatus = { ok: true, message: "", at: Date.now() };
  if (result.state) {
    lastKnownCloudUpdatedAt = result.updatedAt;
    lastKnownCloudHistoryIds = new Set(result.state.history.map(h => h.id));
    if (localLegacy && !cloudSyncPending) {
      // First run after upgrading (or a brand-new device): the old local copy has no change markers, so the
      // cloud copy is authoritative -- exactly what happened before merging existed.
      adoptState(result.state);
    } else {
      // Merge this device's edits (including any made offline) with the cloud's.
      snapshotNow("before-sign-in-merge", local);
      adoptState(mergeStates(local, result.state, defaultState));
      if (!statesEquivalent(state, result.state)) await saveStateCloud();
    }
  } else {
    // Genuinely no cloud row yet for this account: keep whatever is on this device (don't discard it) and
    // create the row from it.
    adoptState(local);
    lastKnownCloudHistoryIds = new Set();
    await saveStateCloud();
  }
  markStateBaseline();
  // Keep a local copy of what was just loaded/merged, so the app still shows your data if it's next opened
  // offline. Not awaited: the first render shouldn't wait on it, and the data it saves is captured immediately.
  saveStateRaw(state, encryptionKey).catch(e => diag.log("warn", "storage", "Local save after sign-in failed: " + ((e && e.message) || e)));
}

/** They've just opened the emailed reset link: this session is real, but its first job is choosing a new
 * password. Signing in then carries on as normal with the same session, whatever they do here. */
export async function handlePasswordRecovery() {
  const p1 = await dialogs.prompt("Choose a new password for your account:", { title: "Set a new password", type: "password" });
  if (!p1) return;
  const p2 = await dialogs.prompt("Enter it again to confirm:", { title: "Confirm new password", type: "password" });
  if (p1 !== p2) { await dialogs.alert("Those didn't match — nothing was changed. Use the emailed link again to retry."); return; }
  const { error } = await supabaseClient.auth.updateUser({ password: p1 });
  if (error) await dialogs.alert("Couldn't update your password: " + (error.message || error));
  else await dialogs.alert("Password updated. You're signed in.");
}

/** Who is signed in (a Supabase user), or null. */
export function setCurrentUser(user) { currentUser = user; }

let cloudSaveTimer = null;
export async function saveStateCloud(force) {
  if (!supabaseClient || !currentUser) return;

  // Data-loss guard: never silently push a history that's collapsed to zero
  // compared to the last count we confirmed was really in the cloud.
  // An empty history is only allowed through if every meal the cloud had was
  // deliberately deleted (each leaves a deletion marker). Anything else that
  // empties the history is a bug, not a decision, so it must not reach the cloud.
  if (!force && state.history.length === 0 && lastKnownCloudHistoryIds && lastKnownCloudHistoryIds.size > 0) {
    const unexplained = unexplainedEmptying(state, lastKnownCloudHistoryIds);
    if (unexplained.length > 0) {
      cloudSaveBlocked = { fromCount: lastKnownCloudHistoryIds.size, toCount: 0 };
      console.error(`Cloud save blocked: history would drop from ${lastKnownCloudHistoryIds.size} to 0.`);
      diag.log("error", "sync", `Cloud save blocked: history would drop from ${lastKnownCloudHistoryIds.size} to 0 with ${unexplained.length} meals not deliberately deleted`);
      markPending();
      renderStatusPanel();
      return;
    }
  }

  clearTimeout(cloudSaveTimer);
  await new Promise(resolve => {
    cloudSaveTimer = setTimeout(async () => {
      try {
        // Merge first: if another device wrote since we last synced, fold its
        // changes in BEFORE uploading, so nothing it saved can be overwritten.
        await pullAndMerge("before save");
        // When a passphrase is set, upload the encrypted blob, not the raw data -- and carry
        // the (non-secret) lock config along so any other device signing into this account
        // knows a passphrase is required, without either of them ever transmitting it.
        const payloadData = encryptionKey ? await encryptString(encryptionKey, JSON.stringify(state)) : state;
        const { data: up, error } = await supabaseClient.from("app_state")
          .upsert({ user_id: currentUser.id, data: payloadData, lock: getLockConfig(), updated_at: new Date().toISOString() })
          .select("updated_at").maybeSingle();
        if (error) throw error;
        lastKnownCloudUpdatedAt = up ? up.updated_at : null;   // unknown => next save re-checks (safe)
        cloudSaveBlocked = null;
        lastKnownCloudHistoryIds = new Set(state.history.map(h => h.id));
        markSynced();
      } catch (e) {
        console.error("Cloud save failed (offline?) -- will retry once back online:", e);
        diag.log("warn", "sync", "Cloud save failed, will retry: " + ((e && e.message) || e));
        markPending();
      }
      resolve();
    }, 500);
  });
}
// ---- multi-device merge (see js/state.js for the rules) ----
export let lastKnownCloudUpdatedAt = null; // the cloud row's updated_at as of our last sync
let lastPullAt = 0;

// Cheap check first (just updated_at); only download + merge when someone else wrote.
export async function pullAndMerge(reason) {
  if (!supabaseClient || !currentUser) return false;
  const head = await supabaseClient.from("app_state").select("updated_at").eq("user_id", currentUser.id).maybeSingle();
  if (head.error) throw head.error;
  if (!head.data) return false;
  lastPullAt = Date.now();
  if (head.data.updated_at === lastKnownCloudUpdatedAt) return false;
  const full = await loadStateCloud();
  if (!full.ok) throw new Error("Couldn't download the cloud copy");
  if (!full.state) return false;
  lastKnownCloudUpdatedAt = full.updatedAt;
  return applyRemoteState(full.state, reason);
}

function applyRemoteState(remote, reason) {
  const merged = mergeStates(state, remote, defaultState);
  if (statesEquivalent(merged, state)) return false;
  snapshotNow("before-merge");
  state.settings = merged.settings;
  state.settingsUpdatedAt = merged.settingsUpdatedAt;
  state.library = merged.library;
  state.recipes = merged.recipes;
  state.history = merged.history;
  state.deleted = merged.deleted;
  markStateBaseline();                         // merged data is already known: don't re-stamp it
  saveStateRaw(state, encryptionKey).catch(e => console.error("Local save after merge failed:", e));
  diag.log("info", "sync", `Merged changes from another device (${reason}); ${state.history.length} meals`);
  renderAfterSync();
  return true;
}

/** Forget everything known about the cloud copy (after it has been deleted). */
export function resetCloudTracking() {
  cloudSyncPending = false;
  cloudSaveBlocked = null;
  lastKnownCloudUpdatedAt = null;
  lastKnownCloudHistoryIds = null;
}

// Escape hatch for the rare genuine case (someone really did delete all their
// history) — bypasses the data-loss guard in saveStateCloud exactly once, on explicit request.
export async function forceSyncNow() {
  cloudSaveBlocked = null;
  await saveStateCloud(true);
  renderStatusPanel();
}
function markPending() {
  cloudSyncPending = true;
  localStorage.setItem(PENDING_SYNC_KEY, "1");
  renderSyncStatus();
}
function markSynced() {
  cloudSyncPending = false;
  localStorage.removeItem(PENDING_SYNC_KEY);
  renderSyncStatus();
}
export function renderSyncStatus() {
  const el2 = document.getElementById("sync-status");
  if (!el2) return;
  el2.textContent = cloudSyncPending
    ? "Offline — changes are saved on this device and will sync once you're back online."
    : "All changes saved to your account.";
  el2.style.color = cloudSyncPending ? "var(--amber)" : "var(--ink-soft)";
}

// Retry a failed sync as soon as connectivity returns, or when the app
// becomes visible again (covers phones where the 'online' event can be
// unreliable, e.g. coming back from a lift or a tunnel).
export async function attemptReconnectSync() {
  if (!supabaseClient) return;
  if (currentUser) {
    try {
      if (cloudSyncPending) await saveStateCloud();                       // merges, then uploads
      else if (Date.now() - lastPullAt > 15000) await pullAndMerge("returned to app");
    } catch (e) { diag.log("warn", "sync", "Background sync failed: " + ((e && e.message) || e)); }
    flushNightscoutQueue();
    return;
  }
  // We're in local-fallback mode (e.g. the app booted while fully offline).
  // See if a session is reachable now; if so, our local copy is what should be
  // merged with the cloud and pushed up.
  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session && session.user) {
      currentUser = session.user;
      await saveStateCloud();
      renderEverything();
    }
  } catch (e) {
    // still offline -- nothing to do, we'll try again on the next trigger
  }
}
