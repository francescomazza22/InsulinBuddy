// State schema + multi-device merge. Pure functions only.
//
// The problem this solves: the cloud copy used to be replaced wholesale on
// every save, so a stale second device (or tab) could silently overwrite meals
// logged elsewhere. Now every item carries an `updatedAt`, deletions leave a
// marker ("tombstone") so they propagate, and saves MERGE with the cloud copy.
//
// Merge rules
//   * item on one side only          -> kept (unless a newer deletion marker exists)
//   * item on both sides             -> the newer `updatedAt` wins
//   * equal / missing `updatedAt`    -> the cloud copy wins (it is canonical for
//                                       data nobody has touched since upgrading)
//   * deletion marker vs edit        -> whichever happened later wins
//   * settings                       -> the side with the newer `settingsUpdatedAt`

export const SCHEMA_VERSION = 2;
export const TOMBSTONE_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
export const COLLECTIONS = ["history", "library", "recipes"];

export function emptyDeleted() {
  return { history: {}, library: {}, recipes: {} };
}

/**
 * Bring any saved/remote/imported blob up to the current schema. `defaults` is a
 * function returning a fresh default state (it supplies settings defaults and
 * the seed food library). Unknown top-level keys are dropped on purpose.
 */
export function normalizeState(parsed, defaults) {
  const d = defaults();
  const p = parsed && typeof parsed === "object" ? parsed : {};
  const ps = p.settings && typeof p.settings === "object" ? p.settings : {};
  const settings = { ...d.settings, ...ps };
  // nested settings objects: merge key-by-key so a partial object can't lose keys
  for (const k of ["insulinModel", "carbAbsorptionMinutes"]) {
    settings[k] = { ...d.settings[k], ...(ps[k] && typeof ps[k] === "object" ? ps[k] : {}) };
  }
  const deleted = emptyDeleted();
  if (p.deleted && typeof p.deleted === "object") {
    for (const k of COLLECTIONS) {
      if (p.deleted[k] && typeof p.deleted[k] === "object") deleted[k] = { ...p.deleted[k] };
    }
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    settings,
    settingsUpdatedAt: Number(p.settingsUpdatedAt) || 0,
    library: Array.isArray(p.library) ? p.library : d.library,
    recipes: Array.isArray(p.recipes) ? p.recipes : [],
    history: Array.isArray(p.history) ? p.history : [],
    deleted
  };
}

const stripMeta = item => { const { updatedAt, ...rest } = item; return rest; };

/** A snapshot of "what was saved last", used to notice what changed since. */
export function makeFingerprint(state) {
  const fp = { settings: JSON.stringify(state.settings) };
  for (const k of COLLECTIONS) {
    const m = new Map();
    for (const it of state[k]) if (it && it.id != null) m.set(it.id, JSON.stringify(stripMeta(it)));
    fp[k] = m;
  }
  return fp;
}

/**
 * Compare `state` with the fingerprint of the previous save and stamp what
 * changed: new/edited items get `updatedAt = now`, removed items leave a
 * deletion marker, settings changes bump `settingsUpdatedAt`. Returns the new
 * fingerprint. With no previous fingerprint it only records a baseline.
 */
export function stampChanges(state, prevFp, now = Date.now()) {
  if (!prevFp) return makeFingerprint(state);
  const next = {};
  for (const k of COLLECTIONS) {
    const prev = prevFp[k];
    const cur = new Map();
    for (const it of state[k]) {
      if (!it || it.id == null) continue;
      const s = JSON.stringify(stripMeta(it));
      cur.set(it.id, s);
      if (!prev.has(it.id)) {
        it.updatedAt = now;                      // brand new (or restored by Undo)
        delete state.deleted[k][it.id];          // an Undo cancels the earlier deletion
      } else if (prev.get(it.id) !== s) {
        it.updatedAt = now;                      // edited
      }
    }
    for (const id of prev.keys()) if (!cur.has(id)) state.deleted[k][id] = now;
    next[k] = cur;
  }
  next.settings = JSON.stringify(state.settings);
  if (next.settings !== prevFp.settings) state.settingsUpdatedAt = now;
  pruneTombstones(state, now);
  return next;
}

export function pruneTombstones(state, now = Date.now(), maxAge = TOMBSTONE_MAX_AGE_MS) {
  for (const k of COLLECTIONS) {
    for (const [id, t] of Object.entries(state.deleted[k])) if (now - t > maxAge) delete state.deleted[k][id];
  }
}

function mergeCollection(local, remote, tombs) {
  const byId = new Map();
  // local first, remote last: remote wins ties
  for (const it of [...local, ...remote]) {
    if (!it || it.id == null) continue;
    const cur = byId.get(it.id);
    if (!cur || (it.updatedAt || 0) >= (cur.updatedAt || 0)) byId.set(it.id, it);
  }
  const out = [];
  for (const [id, it] of byId) {
    const t = tombs[id];
    if (t != null && t >= (it.updatedAt || 0)) continue; // deleted after its last edit
    out.push(it);
  }
  return out;
}

/** Merge two states into a new one. Inputs are not mutated. Items that win from
 *  `local` keep their object identity (open editors stay valid). */
export function mergeStates(local, remote, defaults) {
  const L = normalizeState(local, defaults);
  if (!remote) return L;
  const R = normalizeState(remote, defaults);
  const deleted = emptyDeleted();
  for (const k of COLLECTIONS) {
    for (const src of [L.deleted[k], R.deleted[k]]) {
      for (const [id, t] of Object.entries(src)) deleted[k][id] = Math.max(deleted[k][id] || 0, t);
    }
  }
  const useLocalSettings = L.settingsUpdatedAt > R.settingsUpdatedAt;
  const out = {
    schemaVersion: SCHEMA_VERSION,
    settings: useLocalSettings ? L.settings : R.settings,
    settingsUpdatedAt: Math.max(L.settingsUpdatedAt, R.settingsUpdatedAt),
    library: mergeCollection(L.library, R.library, deleted.library),
    recipes: mergeCollection(L.recipes, R.recipes, deleted.recipes),
    history: mergeCollection(L.history, R.history, deleted.history),
    deleted
  };
  out.history.sort((a, b) => b.ts - a.ts);
  return out;
}

/** True when two states hold the same items (ids + updatedAt), settings stamp
 *  and deletion markers -- used to skip re-rendering/re-uploading a no-op merge. */
export function statesEquivalent(a, b) {
  if (a.settingsUpdatedAt !== b.settingsUpdatedAt) return false;
  for (const k of COLLECTIONS) {
    if (a[k].length !== b[k].length) return false;
    const m = new Map(a[k].map(it => [it.id, it.updatedAt || 0]));
    for (const it of b[k]) if (!m.has(it.id) || m.get(it.id) !== (it.updatedAt || 0)) return false;
    if (Object.keys(a.deleted[k]).length !== Object.keys(b.deleted[k]).length) return false;
  }
  return true;
}

/**
 * Turn an old snapshot into the state to adopt when the user restores a backup.
 * A plain "replace" would be undone by the next sync merge (the cloud still has
 * the newer meals, and the older versions of edited ones), so the restore has to
 * win explicitly: everything in the snapshot is stamped as newest, and anything
 * that exists now but isn't in the snapshot gets a deletion marker.
 */
export function prepareRestoredState(snapshotState, currentState, defaults, now = Date.now()) {
  const restored = normalizeState(snapshotState, defaults);
  const cur = normalizeState(currentState, defaults);
  const deleted = emptyDeleted();
  for (const k of COLLECTIONS) {
    const keep = new Set(restored[k].filter(it => it && it.id != null).map(it => it.id));
    for (const [id, t] of Object.entries(cur.deleted[k])) if (!keep.has(id)) deleted[k][id] = t;
    for (const it of cur[k]) if (it && it.id != null && !keep.has(it.id)) deleted[k][it.id] = now;
    for (const it of restored[k]) if (it) it.updatedAt = now;
  }
  restored.deleted = deleted;
  restored.settingsUpdatedAt = now;
  return restored;
}

/**
 * Data-loss guard: if the history is now empty, which meals the cloud is known
 * to have were NOT deliberately deleted? A non-empty result means "don't upload".
 */
export function unexplainedEmptying(state, knownCloudIds) {
  if (!knownCloudIds || knownCloudIds.size === 0 || state.history.length > 0) return [];
  return [...knownCloudIds].filter(id => !state.deleted || state.deleted.history[id] == null);
}
