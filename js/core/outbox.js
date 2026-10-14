// A generic, offline-safe delivery queue for sending logged entries to an outside service.
// It knows nothing about any one service: everything service-specific lives in a "SyncTarget".
//
//   SyncTarget {
//     name:          short id, e.g. "nightscout"
//     statusKey:     the field on the history entry that records delivery state, e.g. "ns"
//     partsFor(entry, { units, format }) -> [{ key, treatment }]   what to send for an entry (one or more pieces)
//     create(cfg, payload)          -> { id }                      send a new piece; id is the remote record id ("" if unknown)
//     update(cfg, payload, remoteId)-> { id }                      replace a piece already sent
//     remove(cfg, remoteId)                                         delete a piece
//     isPermanent(err) -> bool      true = retrying will never help (bad config, rejected request); false = try again later
//     secrets(cfg)     -> [string]  values to scrub from log messages (tokens)
//   }
//
// Jobs are saved in device storage, retried with back-off, and a half-delivered create is never sent twice.
// A native app, or a second destination (Apple Health, say), plugs in by supplying another SyncTarget.
import { redact } from "../util.js";

export const SYNC_TARGET_METHODS = ["partsFor", "create", "update", "remove", "isPermanent", "secrets"];
export function assertSyncTarget(t) {
  if (!t || typeof t !== "object") throw new Error("A sync target is required");
  if (!t.name || !t.statusKey) throw new Error("A sync target needs a name and a statusKey");
  for (const m of SYNC_TARGET_METHODS) if (typeof t[m] !== "function") throw new Error(`Sync target "${t.name}" is missing ${m}()`);
  return t;
}

export const BACKOFF_MS = [30000, 120000, 600000, 1800000];

export class Outbox {
  /**
   * storage: { getItem, setItem, removeItem }   target: a SyncTarget (see assertSyncTarget below)
   * getConfig() -> whatever the target needs to connect (a URL and token, say) or null when it is not set up
   * onEntryPatch(entryId, patch): apply `patch` (e.g. { ns: {...} }) to the entry and save; the patch key is target.statusKey
   * onChange(): called whenever the queue changes (to refresh badges/status)
   */
  constructor({ storage, target, getConfig, onEntryPatch = () => {}, onChange = () => {}, diag = null, now = () => Date.now(), key }) {
    assertSyncTarget(target);
    Object.assign(this, { storage, target, getConfig, onEntryPatch, onChange, diag, now, key: key || `insulinBuddy.${target.name}Outbox` });
    this.jobs = this._load();
    this.flushing = false;
  }

  _load() { try { return JSON.parse(this.storage.getItem(this.key)) || []; } catch { return []; } }
  _save() { try { this.storage.setItem(this.key, JSON.stringify(this.jobs)); } catch { /* non-fatal */ } this.onChange(); }
  _log(level, msg) { if (this.diag) this.diag.log(level, "outbox", msg); }

  count() { return this.jobs.length; }
  pendingFor(entryId) { return this.jobs.find(j => j.entryId === entryId) || null; }
  lastError() { const j = this.jobs.find(x => x.lastError); return j ? j.lastError : null; }

  _newJob(entryId, op, fields) {
    return { id: `j-${this.now()}-${Math.random().toString(36).slice(2, 6)}`, entryId, op, attempts: 0, lastError: null, nextTryAt: 0, createdAt: this.now(), ...fields };
  }

  enqueueCreate(entry, { format = "combined", units = "mgdl" } = {}) {
    const parts = this.target.partsFor(entry, { units, format });
    this.jobs = this.jobs.filter(j => !(j.entryId === entry.id && j.op === "delete"));
    this.jobs.push(this._newJob(entry.id, "create", { parts, format }));
    this._save();
  }

  enqueueUpdate(entry, { format = "combined", units = "mgdl" } = {}) {
    const parts = this.target.partsFor(entry, { units, format });
    const existing = this.pendingFor(entry.id);
    if (existing && (existing.op === "create" || existing.op === "update")) {
      // Parts the pending job already delivered must be UPDATED from now on,
      // not created again (that would leave duplicates in Nightscout).
      const delivered = existing.done && Object.keys(existing.done).length ? { ...existing.done } : null;
      if (existing.op === "create" && delivered) { existing.op = "update"; existing.prevIds = delivered; existing.done = {}; }
      else if (existing.op === "update") { existing.prevIds = { ...(existing.prevIds || {}), ...(existing.done || {}) }; existing.done = {}; }
      existing.parts = parts; existing.format = format;
      existing.attempts = 0; existing.nextTryAt = 0; existing.lastError = null;
      this._save();
      return;
    }
    const status = entry[this.target.statusKey];
    const prevIds = status && status.ids ? { ...status.ids } : null;
    if (!prevIds) { this.enqueueCreate(entry, { format, units }); return; } // never reached Nightscout: send as new
    this.jobs.push(this._newJob(entry.id, "update", { parts, prevIds, format }));
    this._save();
  }

  enqueueDelete(entryId, ids) {
    const existing = this.pendingFor(entryId);
    if (existing && existing.op === "create") {
      const sent = existing.done ? Object.values(existing.done).filter(Boolean) : [];
      this.jobs = this.jobs.filter(j => j !== existing);
      if (sent.length) this.jobs.push(this._newJob(entryId, "delete", { ids: sent }));
      this._save();
      return;
    }
    if (existing && existing.op === "update") {
      const all = { ...(existing.prevIds || {}), ...(existing.done || {}) };
      this.jobs = this.jobs.filter(j => j !== existing);
      const list = Object.values(all).filter(Boolean);
      if (list.length) this.jobs.push(this._newJob(entryId, "delete", { ids: list }));
      this._save();
      return;
    }
    const list = ids ? Object.values(ids).filter(Boolean) : [];
    if (list.length === 0) return;                                  // nothing was ever sent
    this.jobs.push(this._newJob(entryId, "delete", { ids: list }));
    this._save();
  }

  /** Undo of a delete: cancel the pending delete if it hasn't gone out yet. */
  cancelDelete(entryId) {
    const before = this.jobs.length;
    this.jobs = this.jobs.filter(j => !(j.entryId === entryId && j.op === "delete"));
    if (this.jobs.length !== before) { this._save(); return true; }
    return false;
  }

  /** Retry everything now, ignoring back-off timers (manual "Retry"). */
  retryAll() { this.jobs.forEach(j => { j.nextTryAt = 0; }); this._save(); return this.flush(); }

  async flush() {
    if (this.flushing) return { sent: 0, failed: 0, remaining: this.jobs.length, skipped: true };
    const cfg = this.getConfig();
    if (!cfg) return { sent: 0, failed: 0, remaining: this.jobs.length, unconfigured: true };
    this.flushing = true;
    let sent = 0, failed = 0;
    try {
      for (const job of [...this.jobs]) {
        if (job.nextTryAt > this.now()) continue;
        try {
          await this._run(job, cfg);
          this.jobs = this.jobs.filter(j => j !== job);
          this._save();
          sent++;
        } catch (err) {
          job.attempts = (job.attempts || 0) + 1;
          job.lastError = err.message || String(err);
          if (this.target.isPermanent(err)) {
            this.jobs = this.jobs.filter(j => j !== job);
            failed++;
            this._log("error", `${job.op} for ${job.entryId || "legacy item"} failed permanently: ${redact(job.lastError, this.target.secrets(cfg))}`);
            if (job.entryId && job.op !== "delete") {
              this.onEntryPatch(job.entryId, { [this.target.statusKey]: { status: "failed", ids: { ...(job.prevIds || {}), ...(job.done || {}) }, format: job.format, at: this.now(), error: redact(job.lastError, this.target.secrets(cfg)) } });
            }
            this._save();
          } else {
            job.nextTryAt = this.now() + BACKOFF_MS[Math.min(job.attempts - 1, BACKOFF_MS.length - 1)];
            this._log("warn", `${job.op} will retry (attempt ${job.attempts}): ${redact(job.lastError, this.target.secrets(cfg))}`);
            this._save();
            break; // probably offline -- stop and try again later
          }
        }
      }
    } finally { this.flushing = false; }
    return { sent, failed, remaining: this.jobs.length };
  }

  async _run(job, cfg) {
    if (job.op === "delete") {
      for (const id of job.ids) await this.target.remove(cfg, id);
      return;
    }
    const prev = job.prevIds || {};
    const done = job.done || (job.done = {});
    let unknownIdSkipped = false;
    for (const part of job.parts) {
      if (job.op === "create" && done[part.key]) continue;
      if (job.op === "update" && Object.prototype.hasOwnProperty.call(done, part.key)) continue;
      if (job.op === "update" && Object.prototype.hasOwnProperty.call(prev, part.key)) {
        if (!prev[part.key]) { done[part.key] = ""; unknownIdSkipped = true; }   // remote id was never returned: can't edit remotely
        else { const r = await this.target.update(cfg, part.treatment, prev[part.key]); done[part.key] = r.id || prev[part.key]; }
      } else {
        const r = await this.target.create(cfg, part.treatment);
        done[part.key] = r.id || "";
        if (!r.id) unknownIdSkipped = true;
      }
      this._save();
    }
    if (job.op === "update") {
      for (const k of Object.keys(prev)) {
        if (!job.parts.some(p => p.key === k) && prev[k]) await this.target.remove(cfg, prev[k]);
      }
    }
    if (job.entryId) {
      this.onEntryPatch(job.entryId, { [this.target.statusKey]: {
        status: "synced", ids: { ...done }, format: job.format, at: this.now(),
        ...(unknownIdSkipped ? { warn: "The destination didn't return a record id, so later edits/deletes can't be synced for this meal." } : {})
      } });
    }
  }
}

