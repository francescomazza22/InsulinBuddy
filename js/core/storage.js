// The one place the app touches device storage. Everything else asks this object, so a native app only has to supply a
// different backend (SQLite, Core Data, Keychain...) with the same four methods: getItem, setItem, removeItem, keys.
//
// Reads never throw (a blocked or cleared store just reads as empty). Writes tell you whether they worked:
//   setItem  -> true / false          for things that are fine to lose (caches, view position)
//   mustSet  -> returns true or THROWS  for things that must not silently fail (your data, the lock, sign-in keys)
export function createStorage(backend, { onError } = {}) {
  const note = (op, key, err) => { try { onError && onError(op, key, err); } catch { /* the reporter must never break storage */ } };
  const api = {
    getItem(key) {
      try { const v = backend.getItem(key); return v === undefined ? null : v; }
      catch (e) { note("read", key, e); return null; }
    },
    setItem(key, value) {
      try { backend.setItem(key, String(value)); return true; }
      catch (e) { note("write", key, e); return false; }
    },
    mustSet(key, value) {
      try { backend.setItem(key, String(value)); return true; }
      catch (e) { note("write", key, e); throw new Error(`Could not save "${key}" on this device (${e && e.name ? e.name : "storage error"}). Storage may be full or blocked.`); }
    },
    removeItem(key) {
      try { backend.removeItem(key); return true; }
      catch (e) { note("remove", key, e); return false; }
    },
    keys() {
      try { return backend.keys(); } catch (e) { note("list", "*", e); return []; }
    },
    getJson(key, fallback = null) {
      const raw = api.getItem(key);
      if (raw == null) return fallback;
      try { return JSON.parse(raw); } catch (e) { note("parse", key, e); return fallback; }
    },
    setJson(key, value) { return api.setItem(key, JSON.stringify(value)); }
  };
  return api;
}

// A backend over the browser's localStorage (looked up lazily, so a browser that blocks it still loads the app).
export function localStorageBackend(win = globalThis) {
  return {
    getItem: k => win.localStorage.getItem(k),
    setItem: (k, v) => win.localStorage.setItem(k, v),
    removeItem: k => win.localStorage.removeItem(k),
    keys: () => Array.from({ length: win.localStorage.length }, (_, i) => win.localStorage.key(i))
  };
}

// A backend that lives in memory: for tests, and as a fallback when the device blocks storage.
export function memoryBackend(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: k => { m.delete(k); },
    keys: () => [...m.keys()]
  };
}

// Versioned migrations for what is stored on the device. `migrations` is a list of { version, run(store) } in order.
// Each runs once, in order, and the version is recorded after it succeeds, so a failure is retried next start, never skipped.
export const STORAGE_VERSION_KEY = "insulinBuddy.storageVersion";
export function runMigrations(store, migrations, log = () => {}) {
  let current = Number(store.getItem(STORAGE_VERSION_KEY)) || 0;
  const ran = [];
  for (const m of [...migrations].sort((a, b) => a.version - b.version)) {
    if (m.version <= current) continue;
    try { m.run(store); }
    catch (e) { log("error", `storage migration ${m.version} failed`, e); break; }
    if (!store.setItem(STORAGE_VERSION_KEY, m.version)) break;
    current = m.version; ran.push(m.version);
  }
  return { version: current, ran };
}

// What the app has needed so far. Version 1 is the baseline: it just stamps the store, so later changes have a starting point.
export const STORAGE_MIGRATIONS = [
  { version: 1, run() { /* baseline, nothing to change */ } }
];
