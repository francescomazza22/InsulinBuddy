// The app's data on this device: `state` itself, loading and saving it (encrypted when a passphrase is set),
// the change baseline that powers multi-device merging, and the rolling local snapshots.
//
// `state` is a live binding: every module reads the current data through it. Only this module assigns it --
// everyone else goes through adoptState() -- so there is one place that decides what "the data" is.
import { LocalBackups, shouldAutoSnapshot } from "../backup.js";
import { activeAt, glucoseUnitLabel } from "../calc.js";
import { GI_SEED_MAP, defaultState } from "../constants.js";
import { decryptString, encryptString } from "../crypto.js";
import { KEYS } from "../keys.js";
import { SCHEMA_VERSION, makeFingerprint, normalizeState as normalizeStateWith, stampChanges } from "../state.js";
import { currentUser, saveStateCloud } from "./cloud.js";
import { diag } from "./diagnostics.js";
import { encryptionKey, getLockConfig, showLockScreen, tryRestoreSessionKey } from "./lock.js";

const STORAGE_KEY = KEYS.state;
const LAST_SNAPSHOT_KEY = KEYS.lastSnapshot;

export let state;               // populated by boot(), once (and if) the lock screen is cleared
export let stateFp = null;      // fingerprint of the last saved state, to spot what changed (js/state.js)
export let localWasLegacy = false; // true when the saved copy predates the versioned schema (or doesn't exist)

/** Make `next` the app's data AND the baseline later saves are compared against (see stampChanges in
 * js/state.js). For data that is already known to be saved -- just loaded, merged, restored or reset -- so the
 * next save doesn't re-stamp every item in it as freshly edited. */
export function adoptState(next) { state = next; stateFp = makeFingerprint(state); }
/** The current data is already saved (e.g. just merged from the cloud): use it as the change baseline. */
export function markStateBaseline() { stateFp = makeFingerprint(state); }

// ---- thin wrappers: the logic lives in the pure modules, these bind it to the live data ----
export function calcActiveInsulinAndCarbs(atTime) { return activeAt(state.history, state.settings, atTime); }
export function normalizeState(parsed) { return normalizeStateWith(parsed, defaultState); }
/** "mmol/L" or "mg/dL": for `unit`, or for the unit chosen in Settings. */
export function unitLabel(unit) { return glucoseUnitLabel(unit || state.settings.units); }

// ---------------------------------------------------------------- loading
function loadStatePlain() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) { localWasLegacy = true; return normalizeState({}); }
    const parsed = JSON.parse(raw);
    localWasLegacy = parsed.schemaVersion !== SCHEMA_VERSION;
    return normalizeState(parsed);
  } catch (e) {
    console.error("Could not read saved data, starting fresh.", e);
    diag.log("error", "storage", "Could not read saved data, starting fresh: " + (e && e.message));
    localWasLegacy = true;
    return normalizeState({});
  }
}
async function loadStateEncrypted(key) {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) { localWasLegacy = true; return normalizeState({}); }
  const payload = JSON.parse(raw);
  const json = await decryptString(key, payload);
  const parsed = JSON.parse(json);
  localWasLegacy = parsed.schemaVersion !== SCHEMA_VERSION;
  return normalizeState(parsed);
}

/** The local baseline, whichever form it's actually in. A device can have plaintext local
 * storage from before it ever knew about a passphrase (e.g. it used cloud sync, then later
 * adopted a passphrase set on another device) -- so even with a key in hand, fall back to a
 * plain read if what's stored isn't actually encrypted. */
export async function loadLocalState() {
  if (!encryptionKey) return loadStatePlain();
  try { return await loadStateEncrypted(encryptionKey); }
  catch (e) { return loadStatePlain(); }
}

/** loadLocalState, but unlocking first if this device has a passphrase. Reading an encrypted copy with
 * loadStatePlain() finds no data at all, and the next save would then replace the encrypted copy with an empty
 * one -- which is what the signed-out and offline start-up paths used to do. */
export async function loadLocalStateUnlocking() {
  const cfg = getLockConfig();
  if (cfg && !encryptionKey && !(await tryRestoreSessionKey(cfg))) await showLockScreen();
  return loadLocalState();
}

// ---------------------------------------------------------------- saving
/** Write `s` to this device, encrypted with `key` when there is one. No change-stamping, no cloud. */
export async function saveStateRaw(s, key) {
  if (key) {
    const payload = await encryptString(key, JSON.stringify(s));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } else {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  }
}

/** Save after any change: stamp what changed since the last save (so merges know what's newer), write it here,
 * take an automatic snapshot if one is due, and sync to the cloud when signed in. */
export async function saveState() {
  if (!stateFp) { stateFp = makeFingerprint(state); diag.log("warn", "state", "saveState ran before the change baseline existed"); }
  stateFp = stampChanges(state, stateFp);   // notice what changed since the last save
  await saveStateRaw(state, encryptionKey);
  maybeAutoSnapshot();
  if (currentUser) await saveStateCloud();
}

// ---------------------------------------------------------------- local snapshots
// Rolling snapshots on this device (js/backup.js): a safety net under sync merges, imports, restores and sign-in.
export const backups = new LocalBackups();

export async function snapshotNow(reason, stateOverride) {
  try {
    const st = stateOverride || state;
    if (!backups.available() || !st) return;
    const json = JSON.stringify(st);            // captured synchronously, before any caller mutates state
    let payload = json, encrypted = false;
    if (encryptionKey) { payload = JSON.stringify(await encryptString(encryptionKey, json)); encrypted = true; }
    await backups.snapshot(payload, { reason, meals: st.history.length, foods: st.library.length, encrypted });
    localStorage.setItem(LAST_SNAPSHOT_KEY, String(Date.now()));
    diag.log("info", "backup", `Snapshot saved (${reason}): ${st.history.length} meals`);
  } catch (e) { diag.log("warn", "backup", "Snapshot failed: " + ((e && e.message) || e)); }
}
function maybeAutoSnapshot() {
  const last = Number(localStorage.getItem(LAST_SNAPSHOT_KEY)) || 0;
  if (shouldAutoSnapshot(last, Date.now())) { localStorage.setItem(LAST_SNAPSHOT_KEY, String(Date.now())); snapshotNow("auto"); }
}

// ---------------------------------------------------------------- data patches
// One-time patch: adds Glycemic Index values to library foods that match a seed food by name, for libraries
// saved before GI existed (foods_data.js only seeds a brand-new install). Only ever fills in a missing gi.
export function applyGiSeedPatch() {
  let changed = false;
  state.library.forEach(f => {
    if (f.gi == null && GI_SEED_MAP[f.name] != null) {
      f.gi = GI_SEED_MAP[f.name];
      changed = true;
    }
  });
  if (changed) saveState();
}
