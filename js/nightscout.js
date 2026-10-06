// Nightscout integration, split into three parts:
//   1. pure helpers   -- config parsing, building treatments from a logged meal
//   2. NightscoutClient -- talks to Nightscout via the Supabase proxy (which
//      sidesteps browser CORS) and falls back to a direct request
//   3. NsOutbox       -- a persistent queue so every create / edit / delete is
//      eventually delivered, with a clear per-meal state (synced / failed)
// Nothing here touches the DOM, so all of it is unit-tested in Node.

import { round1, redact } from "./util.js";
import { convertGlucose } from "./calc.js";

// ------------------------------------------------------------- pure helpers
export function nsToken(url) {
  const m = String(url || "").match(/[?&]token=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}
export function nsBaseUrl(url) {
  return String(url || "").split("?")[0].replace(/\/+$/, "");
}
export function nsConfigured(url) {
  return !!(url && nsToken(url));
}

/** The `_id` Nightscout assigned, from a POST/PUT response (object, array, or wrapped). */
export function extractNsId(body) {
  const doc = Array.isArray(body) ? body[0] : body;
  if (doc && typeof doc === "object") {
    if (doc._id) return String(doc._id);
    if (doc.identifier) return String(doc.identifier);
    if (doc.result && doc.result.identifier) return String(doc.result.identifier);
  }
  return null;
}

/**
 * Turn one logged entry into Nightscout treatments, using the event types from
 * the official docs: `Meal Bolus` = food + its insulin, `Carb Correction` =
 * food only, `Correction Bolus` = insulin only.
 *   format "combined": one treatment per entry (default)
 *   format "split":    a carbs treatment and a separate insulin treatment
 * Returns [{ key, treatment }] -- `key` names the part so edits can update the
 * right remote record later.
 */
export function treatmentsForEntry(entry, { units = "mgdl", format = "combined" } = {}) {
  const carbs = entry.totalCarbs || 0;
  const insulin = round1((entry.mealDose || 0) + (entry.correctionDose || 0));
  const notes = (entry.items || []).map(i => i.name).join(", ");
  const base = { created_at: new Date(entry.ts).toISOString(), enteredBy: "Insulin Buddy" };
  // A basal (long-acting) dose goes to Nightscout as a plain Note with the dose written in the text and
  // NO `insulin` field. Nightscout's IOB plugin runs `treatment.insulin` through a rapid-acting curve for
  // every treatment that has one, whatever its eventType, so sending basal as insulin would make
  // Nightscout (and anything built on its IOB: bolus wizard preview, alarms) believe rapid-acting
  // insulin is on board. A Note still shows on its chart and in its reports.
  if (entry.entryType === "basal") {
    const units = Math.round((entry.basalDose || 0) * 100) / 100;
    const slot = entry.basalSlot === "am" ? " (morning)" : entry.basalSlot === "pm" ? " (evening)" : "";
    return [{ key: "main", treatment: { eventType: "Note", notes: `Basal insulin: ${units}u${slot}`, ...base } }];
  }
  const glucose = entry.glucose != null
    ? { glucose: units === "mmol" ? round1(convertGlucose(entry.glucose, "mmol", "mgdl")) : entry.glucose, glucoseType: "Finger", units: "mg/dl" }
    : {};
  const hasCarbs = carbs > 0, hasInsulin = insulin > 0;

  if (!hasCarbs && !hasInsulin) {
    return [{ key: "note", treatment: { eventType: "Note", notes: notes || "Logged in Insulin Buddy", ...base } }];
  }
  if (format === "split") {
    const out = [];
    if (hasCarbs) out.push({ key: "carbs", treatment: { eventType: "Carb Correction", carbs, notes, ...base } });
    if (hasInsulin) {
      out.push({ key: "insulin", treatment: { eventType: "Correction Bolus", insulin, notes: hasCarbs ? `Bolus for ${notes}` : (notes || "Correction"), ...glucose, ...base } });
    }
    return out;
  }
  if (hasCarbs && hasInsulin) return [{ key: "main", treatment: { eventType: "Meal Bolus", carbs, insulin, notes, ...glucose, ...base } }];
  if (hasCarbs) return [{ key: "main", treatment: { eventType: "Carb Correction", carbs, notes, ...base } }];
  return [{ key: "main", treatment: { eventType: "Correction Bolus", insulin, notes: notes || "Correction", ...glucose, ...base } }];
}

// ------------------------------------------------------------------ client
export class NsError extends Error {
  constructor(kind, message, extra = {}) {
    super(message);
    this.name = "NsError";
    this.kind = kind;          // "network" | "http" | "proxy" | "config"
    Object.assign(this, extra); // status, via
  }
}

function isNotDeployed(error) {
  const status = error && error.context && error.context.status;
  const msg = String((error && error.message) || "").toLowerCase();
  return status === 404 || msg.includes("not found");
}

export class NightscoutClient {
  /**
   * invoke:  async (functionName, body) => ({ data, error })  -- or null when
   *          the proxy is unavailable (not signed in, cloud not configured)
   * onStatus(kind, ok, via, message): kind is "read" or "write"
   */
  constructor({ invoke = null, fetchImpl = null, diag = null, onStatus = null, timeoutMs = 15000 } = {}) {
    this.invoke = invoke;
    this.fetchImpl = fetchImpl || (typeof fetch === "function" ? fetch.bind(globalThis) : null);
    this.diag = diag;
    this.onStatus = onStatus;
    this.timeoutMs = timeoutMs;
  }

  _log(level, msg) { if (this.diag) this.diag.log(level, "nightscout", msg); }
  _status(op, ok, via, message) { if (this.onStatus) this.onStatus(op === "read" ? "read" : "write", ok, via, message); }

  /** opts: { before } pages backward through history (backfill); { after } asks for
   * everything newer than a known point (catching up). At most one of the two. */
  async read(cfg, count = 1, opts = {}) {
    const r = await this._run("read", cfg, { count, before: opts.before, after: opts.after });
    return { entries: Array.isArray(r.body) ? r.body : (r.body && r.body.entries) || [], via: r.via };
  }
  async create(cfg, treatment) {
    const r = await this._run("create", cfg, { treatment });
    return { id: extractNsId(r.body), body: r.body, via: r.via };
  }
  async update(cfg, treatment) {
    if (!treatment || !treatment._id) throw new NsError("config", "update needs a treatment with an _id");
    const r = await this._run("update", cfg, { treatment });
    return { id: extractNsId(r.body) || treatment._id, body: r.body, via: r.via };
  }
  async remove(cfg, id) {
    const r = await this._run("delete", cfg, { id });
    return { via: r.via };
  }

  async _run(op, cfg, payload) {
    if (!cfg || !cfg.baseUrl || !cfg.token) throw new NsError("config", "Nightscout isn't configured");
    let proxyProblem = null;
    try {
      if (this.invoke) {
        const p = await this._viaProxy(op, cfg, payload);
        if (p.ok) return this._done(op, "proxy", p.body);
        proxyProblem = p.problem;
      }
      const d = await this._viaDirect(op, cfg, payload);
      return this._done(op, "direct", d.body);
    } catch (e) {
      const err = e instanceof NsError ? e : new NsError("network", (e && e.message) || "Request failed");
      if (!err.via) err.via = proxyProblem ? "none" : "direct";
      if (proxyProblem && err.kind === "network") err.message = `${err.message} (proxy: ${proxyProblem})`;
      this._log("error", `${op} failed (${err.kind}${err.status ? " " + err.status : ""}): ${redact(err.message, [cfg.token])}`);
      this._status(op, false, err.via, redact(err.message, [cfg.token]));
      throw err;
    }
  }

  _done(op, via, body) {
    this._log("info", `${op} ok via ${via}`);
    this._status(op, true, via, `${op === "read" ? "Read" : "Write"} succeeded via ${via === "proxy" ? "the Supabase proxy" : "a direct request"}.`);
    return { via, body };
  }

  // Returns { ok:true, body } or { ok:false, problem } when the proxy simply
  // isn't usable (so the caller may try something else). Throws NsError when
  // the proxy REACHED Nightscout and it answered with a failure -- retrying
  // that another way could duplicate a write, so we don't.
  async _viaProxy(op, cfg, payload) {
    let res;
    try {
      res = await this.invoke("nightscout-proxy", { action: op, baseUrl: cfg.baseUrl, token: cfg.token, ...payload });
    } catch (e) {
      return { ok: false, problem: (e && e.message) || "proxy call failed" };
    }
    const { data, error } = res || {};
    if (error) {
      if (isNotDeployed(error) && (op === "read" || op === "create")) return this._viaLegacyProxy(op, cfg, payload);
      return { ok: false, problem: isNotDeployed(error) ? "nightscout-proxy isn't deployed yet" : (error.message || "proxy error") };
    }
    if (!data || typeof data !== "object") return { ok: false, problem: "empty proxy response" };
    if (data.ok) return { ok: true, body: data.body };
    if (data.code === "UPSTREAM_HTTP") throw new NsError("http", data.error || `Nightscout responded with HTTP ${data.status}`, { status: data.status, via: "proxy" });
    if (data.code === "UPSTREAM_NETWORK") throw new NsError("network", data.error || "Proxy couldn't reach Nightscout", { via: "proxy" });
    throw new NsError("proxy", data.error || "The proxy rejected the request", { via: "proxy", code: data.code });
  }

  // Older deployments only have the two original functions.
  async _viaLegacyProxy(op, cfg, payload) {
    try {
      if (op === "read") {
        const { data, error } = await this.invoke("fetch-nightscout-glucose", { baseUrl: cfg.baseUrl, token: cfg.token, count: payload.count || 1 });
        if (error || !data || data.error) return { ok: false, problem: "legacy read proxy failed" };
        return { ok: true, body: data.entries };
      }
      const { data, error } = await this.invoke("write-nightscout-treatment", { baseUrl: cfg.baseUrl, token: cfg.token, treatment: payload.treatment });
      if (error || !data || !data.ok) return { ok: false, problem: "legacy write proxy failed" };
      return { ok: true, body: data.body };
    } catch (e) {
      return { ok: false, problem: (e && e.message) || "legacy proxy failed" };
    }
  }

  async _viaDirect(op, cfg, payload) {
    if (!this.fetchImpl) throw new NsError("network", "No network available");
    const tok = encodeURIComponent(cfg.token);
    let url, init;
    if (op === "read") {
      const find = payload.before !== undefined ? `&find[date][$lt]=${payload.before}` : payload.after !== undefined ? `&find[date][$gte]=${payload.after}` : "";
      url = `${cfg.baseUrl}/api/v1/entries.json?count=${payload.count || 1}${find}&token=${tok}`;
      init = { method: "GET" };
    }
    else if (op === "create") { url = `${cfg.baseUrl}/api/v1/treatments?token=${tok}`; init = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload.treatment) }; }
    else if (op === "update") { url = `${cfg.baseUrl}/api/v1/treatments?token=${tok}`; init = { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload.treatment) }; }
    else if (op === "delete") { url = `${cfg.baseUrl}/api/v1/treatments/${encodeURIComponent(payload.id)}?token=${tok}`; init = { method: "DELETE" }; }
    else throw new NsError("config", `unknown operation ${op}`);

    let res, text;
    try {
      const ctl = typeof AbortController === "function" ? new AbortController() : null;
      const timer = ctl ? setTimeout(() => ctl.abort(), this.timeoutMs) : null;
      try { res = await this.fetchImpl(url, ctl ? { ...init, signal: ctl.signal } : init); text = await res.text(); }
      finally { if (timer) clearTimeout(timer); }
    } catch (e) {
      throw new NsError("network", "Couldn't reach Nightscout directly (likely blocked by CORS)", { via: "direct" });
    }
    if (!res.ok) throw new NsError("http", `Nightscout responded with HTTP ${res.status}`, { status: res.status, via: "direct" });
    let body = text;
    try { body = JSON.parse(text); } catch { /* keep raw text */ }
    return { body };
  }
}

// ------------------------------------------------------------------ outbox
const BACKOFF_MS = [30000, 120000, 600000, 1800000];
const isPermanent = err =>
  err.kind === "config" || err.kind === "proxy" ||
  (err.kind === "http" && err.status >= 400 && err.status < 500 && err.status !== 408 && err.status !== 429);

export class NsOutbox {
  /**
   * storage: { getItem, setItem, removeItem }   client: NightscoutClient
   * getConfig() -> { baseUrl, token } | null     getUnits() -> "mgdl" | "mmol"
   * onEntryPatch(entryId, patch): apply `patch` (e.g. { ns: {...} }) to the entry and save
   * onChange(): called whenever the queue changes (to refresh badges/status)
   */
  constructor({ storage, client, getConfig, onEntryPatch = () => {}, onChange = () => {}, diag = null, now = () => Date.now(), key = "insulinBuddy.nsOutbox" }) {
    Object.assign(this, { storage, client, getConfig, onEntryPatch, onChange, diag, now, key });
    this.jobs = this._load();
    this.flushing = false;
  }

  _load() { try { return JSON.parse(this.storage.getItem(this.key)) || []; } catch { return []; } }
  _save() { try { this.storage.setItem(this.key, JSON.stringify(this.jobs)); } catch { /* non-fatal */ } this.onChange(); }
  _log(level, msg) { if (this.diag) this.diag.log(level, "outbox", msg); }

  count() { return this.jobs.length; }
  pendingFor(entryId) { return this.jobs.find(j => j.entryId === entryId) || null; }
  lastError() { const j = this.jobs.find(x => x.lastError); return j ? j.lastError : null; }

  /** Move jobs saved by the old queue (raw treatments) into the outbox. */
  migrateLegacy(oldKey = "insulinBuddy.nsQueue") {
    let old = [];
    try { old = JSON.parse(this.storage.getItem(oldKey)) || []; } catch { old = []; }
    if (!Array.isArray(old) || old.length === 0) { try { this.storage.removeItem(oldKey); } catch { /* */ } return 0; }
    for (const t of old) {
      this.jobs.push({ id: `j-${this.now()}-${Math.random().toString(36).slice(2, 6)}`, entryId: null, op: "create", parts: [{ key: "main", treatment: t }], attempts: 0, lastError: null, nextTryAt: 0, createdAt: this.now() });
    }
    try { this.storage.removeItem(oldKey); } catch { /* */ }
    this._save();
    return old.length;
  }

  _newJob(entryId, op, fields) {
    return { id: `j-${this.now()}-${Math.random().toString(36).slice(2, 6)}`, entryId, op, attempts: 0, lastError: null, nextTryAt: 0, createdAt: this.now(), ...fields };
  }

  enqueueCreate(entry, { format = "combined", units = "mgdl" } = {}) {
    const parts = treatmentsForEntry(entry, { units, format });
    this.jobs = this.jobs.filter(j => !(j.entryId === entry.id && j.op === "delete"));
    this.jobs.push(this._newJob(entry.id, "create", { parts, format }));
    this._save();
  }

  enqueueUpdate(entry, { format = "combined", units = "mgdl" } = {}) {
    const parts = treatmentsForEntry(entry, { units, format });
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
    const prevIds = entry.ns && entry.ns.ids ? { ...entry.ns.ids } : null;
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
          if (isPermanent(err)) {
            this.jobs = this.jobs.filter(j => j !== job);
            failed++;
            this._log("error", `${job.op} for ${job.entryId || "legacy item"} failed permanently: ${redact(job.lastError, [cfg.token])}`);
            if (job.entryId && job.op !== "delete") {
              this.onEntryPatch(job.entryId, { ns: { status: "failed", ids: { ...(job.prevIds || {}), ...(job.done || {}) }, format: job.format, at: this.now(), error: redact(job.lastError, [cfg.token]) } });
            }
            this._save();
          } else {
            job.nextTryAt = this.now() + BACKOFF_MS[Math.min(job.attempts - 1, BACKOFF_MS.length - 1)];
            this._log("warn", `${job.op} will retry (attempt ${job.attempts}): ${redact(job.lastError, [cfg.token])}`);
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
      for (const id of job.ids) await this.client.remove(cfg, id);
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
        else { const r = await this.client.update(cfg, { ...part.treatment, _id: prev[part.key] }); done[part.key] = r.id || prev[part.key]; }
      } else {
        const r = await this.client.create(cfg, part.treatment);
        done[part.key] = r.id || "";
        if (!r.id) unknownIdSkipped = true;
      }
      this._save();
    }
    if (job.op === "update") {
      for (const k of Object.keys(prev)) {
        if (!job.parts.some(p => p.key === k) && prev[k]) await this.client.remove(cfg, prev[k]);
      }
    }
    if (job.entryId) {
      this.onEntryPatch(job.entryId, { ns: {
        status: "synced", ids: { ...done }, format: job.format, at: this.now(),
        ...(unknownIdSkipped ? { warn: "Nightscout didn't return a record id, so later edits/deletes can't be synced for this meal." } : {})
      } });
    }
  }
}

/** Nightscout /entries.json rows -> the shape our own glucose_readings table stores.
 * Filters out anything without a usable numeric glucose value or timestamp, and drops
 * duplicate timestamps within one batch (upsert on the server handles duplicates across
 * separate fetches; this just keeps one fetched batch itself clean). */
export function entriesToGlucoseRows(entries, userId) {
  const rows = [];
  const seen = new Set();
  for (const e of entries || []) {
    if (!e) continue;
    const mgdl = typeof e.sgv === "number" ? e.sgv : typeof e.mbg === "number" ? e.mbg : null;
    const at = typeof e.date === "number" ? e.date : null;
    if (mgdl == null || at == null || !Number.isFinite(mgdl) || mgdl <= 0 || !Number.isFinite(at)) continue;
    const iso = new Date(at).toISOString();
    if (seen.has(iso)) continue;
    seen.add(iso);
    rows.push({ user_id: userId, at: iso, mgdl: Math.round(mgdl), direction: e.direction || null });
  }
  return rows;
}
