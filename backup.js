// Rolling local backups. Cloud sync protects against losing a device; this
// protects against losing DATA (a bad merge, an accidental import, "delete
// everything"). Snapshots live in IndexedDB on this device and are encrypted
// when the passphrase lock is enabled, so they never weaken it.

export const DEFAULT_KEEP = 10;
export const MIN_AUTO_GAP_MS = 30 * 60 * 1000;

/** Which snapshot timestamps to delete so only the newest `keep` remain. */
export function timestampsToPrune(all, keep = DEFAULT_KEEP) {
  return [...all].sort((a, b) => b - a).slice(keep);
}
export function shouldAutoSnapshot(lastTs, now, minGap = MIN_AUTO_GAP_MS) {
  return !lastTs || now - lastTs >= minGap;
}

const STORE = "snapshots";

function req(r) {
  return new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
}

export class LocalBackups {
  constructor({ idb = (typeof indexedDB !== "undefined" ? indexedDB : null), dbName = "insulinBuddyBackups", keep = DEFAULT_KEEP, now = () => Date.now() } = {}) {
    this.idb = idb; this.dbName = dbName; this.keep = keep; this.now = now;
    this._db = null;
  }
  available() { return !!this.idb; }

  async _open() {
    if (this._db) return this._db;
    if (!this.idb) throw new Error("IndexedDB isn't available");
    this._db = await new Promise((resolve, reject) => {
      const open = this.idb.open(this.dbName, 1);
      open.onupgradeneeded = () => { open.result.createObjectStore(STORE, { keyPath: "ts" }); };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    return this._db;
  }
  async _tx(mode, fn) {
    const db = await this._open();
    const tx = db.transaction(STORE, mode);
    const result = await fn(tx.objectStore(STORE));
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); });
    return result;
  }

  /** payload: the serialised state (already encrypted if `encrypted`). */
  async snapshot(payload, { reason = "auto", meals = 0, foods = 0, encrypted = false } = {}) {
    let ts = this.now();
    const existing = new Set(await this._tx("readonly", s => req(s.getAllKeys())));
    while (existing.has(ts)) ts += 1;                       // keep keys unique
    await this._tx("readwrite", s => req(s.put({ ts, reason, meals, foods, encrypted, data: payload })));
    const all = await this._tx("readonly", s => req(s.getAllKeys()));
    for (const old of timestampsToPrune(all, this.keep)) await this._tx("readwrite", s => req(s.delete(old)));
    return ts;
  }
  /** Newest first, without the (large) data blobs. */
  async list() {
    const rows = await this._tx("readonly", s => req(s.getAll()));
    return rows.map(({ data, ...meta }) => ({ ...meta, bytes: data ? data.length : 0 })).sort((a, b) => b.ts - a.ts);
  }
  async get(ts) { return this._tx("readonly", s => req(s.get(ts))); }
  async clear() { return this._tx("readwrite", s => req(s.clear())); }
}
