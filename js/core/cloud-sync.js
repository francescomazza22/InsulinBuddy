// Cloud copy of the whole state: when to upload, when to pull, and the guards that stop a bad save from wiping the cloud.
// The engine knows nothing about Supabase or the screen. It talks to a "CloudTarget" and reports through callbacks, so a native
// app can supply its own target (CloudKit, a different backend) and keep every safety rule.
//
//   CloudTarget {
//     head()        -> { updatedAt } | null    cheap check of the cloud copy (null = nothing there yet). Throws if unreachable.
//     fetch(pre?)   -> { ok:true, state, updatedAt } | { ok:true, state:null } | { ok:false }   the full copy, decrypted and normalised
//     push(state)   -> updatedAt | null        upload (encrypting if the account has a passphrase). Throws on failure.
//   }
//
// Rules this engine enforces (each has a test):
//   * Never upload a history that has collapsed to empty unless every meal the cloud had was deliberately deleted.
//   * Always pull and merge before uploading, so another device's changes are folded in, not overwritten.
//   * A failed upload is reported as pending, never as success. A load failure is never mistaken for "no data yet".
import { unexplainedEmptying } from "../state.js";

export function createCloudSync({ target, getState, mergeRemote, onPending = () => {}, onSynced = () => {}, onBlocked = () => {}, log = () => {}, delayMs = 500, now = () => Date.now() }) {
  let lastUpdatedAt = null;      // the cloud copy's updated_at as of our last sync (null = unknown, so the next save re-checks)
  let historyIds = null;         // exactly WHICH meals the cloud is known to hold: a deliberate delete vs an accident
  let blocked = null;            // { fromCount, toCount } while the guard has paused uploads
  let lastPullAt = 0;
  let timer = null;
  let waiters = [];             // every caller waiting on the debounced upload; all are released when it finishes

  const engine = {
    get lastUpdatedAt() { return lastUpdatedAt; },
    get blocked() { return blocked; },
    get lastPullAt() { return lastPullAt; },
    get knownHistoryIds() { return historyIds; },

    /** Record what the cloud is known to hold (after the first load). */
    baseline({ updatedAt = null, history = [] } = {}) {
      lastUpdatedAt = updatedAt;
      historyIds = new Set(history.map(h => h.id));
    },
    /** Forget everything (signing out, deleting all data). */
    reset() { lastUpdatedAt = null; historyIds = null; blocked = null; clearTimeout(timer); const w = waiters; waiters = []; w.forEach(r => r()); },
    unblock() { blocked = null; },
    fetch: pre => target.fetch(pre),

    /** Download and merge if someone else has written since we last synced. Throws if the cloud can't be reached. */
    async pull(reason) {
      const head = await target.head();
      if (!head) return false;
      lastPullAt = now();
      if (head.updatedAt === lastUpdatedAt) return false;
      const full = await target.fetch();
      if (!full.ok) throw new Error("Couldn't download the cloud copy");
      if (!full.state) return false;
      lastUpdatedAt = full.updatedAt;
      return mergeRemote(full.state, reason);
    },

    /** Upload (debounced). `force` bypasses the data-loss guard exactly once, on explicit request. */
    async save(force) {
      const state = getState();
      if (!force && state.history.length === 0 && historyIds && historyIds.size > 0) {
        const unexplained = unexplainedEmptying(state, historyIds);
        if (unexplained.length > 0) {
          blocked = { fromCount: historyIds.size, toCount: 0 };
          log("error", `Cloud save blocked: history would drop from ${historyIds.size} to 0 with ${unexplained.length} meals not deliberately deleted`);
          onPending();
          onBlocked(blocked);
          return;
        }
      }
      clearTimeout(timer);
      // A save that arrives while another is waiting replaces it. (Before 2.37.0 the replaced callers waited forever.)
      await new Promise(resolve => {
        waiters.push(resolve);
        timer = setTimeout(async () => {
          try {
            await engine.pull("before save");           // fold in other devices' changes BEFORE uploading
            const current = getState();
            const updatedAt = await target.push(current);
            lastUpdatedAt = updatedAt ?? null;
            blocked = null;
            historyIds = new Set(current.history.map(h => h.id));
            onSynced();
          } catch (e) {
            log("warn", "Cloud save failed, will retry: " + ((e && e.message) || e));
            onPending();
          }
          const w = waiters; waiters = [];
          w.forEach(r => r());
        }, delayMs);
      });
    }
  };
  return engine;
}

/** Supabase as a CloudTarget. Everything it needs from the app is passed in, so it can be tested without a network. */
export function supabaseCloudTarget({ getClient, getUserId, getKey, getLock, isEncrypted, encrypt, decrypt, normalize, log = () => {}, nowIso = () => new Date().toISOString() }) {
  return {
    async head() {
      const r = await getClient().from("app_state").select("updated_at").eq("user_id", getUserId()).maybeSingle();
      if (r.error) throw r.error;
      return r.data ? { updatedAt: r.data.updated_at } : null;
    },
    async fetch(prefetched) {
      const { data, error } = prefetched || await getClient().from("app_state").select("data, updated_at, lock").eq("user_id", getUserId()).maybeSingle();
      if (error) { log("error", "Cloud load failed: " + (error.message || error)); return { ok: false }; }   // unreachable is NOT "no data yet"
      if (!data) return { ok: true, state: null };                                                              // first sign-in, no row yet
      let raw = data.data;
      if (isEncrypted(raw)) {
        const key = getKey();
        if (!key) { log("warn", "Cloud data is encrypted but this device hasn't unlocked yet"); return { ok: false }; }
        try { raw = JSON.parse(await decrypt(key, raw)); }
        catch (e) { log("error", "Couldn't decrypt cloud data: " + ((e && e.message) || e)); return { ok: false }; }
      }
      return { ok: true, state: normalize(raw), updatedAt: data.updated_at };
    },
    async push(state) {
      const key = getKey();
      const payload = key ? await encrypt(key, JSON.stringify(state)) : state;
      const { data, error } = await getClient().from("app_state")
        .upsert({ user_id: getUserId(), data: payload, lock: getLock(), updated_at: nowIso() })
        .select("updated_at").maybeSingle();
      if (error) throw error;
      return data ? data.updated_at : null;
    }
  };
}
