// Glucose readings: the live reading on the dose card, the recent trend in the Active Insulin sheet, and the
// account's own long-term history in Supabase that the History > Glucose tab and the report read from.
import { KEYS } from "../keys.js";
import { entriesToGlucoseRows } from "../nightscout.js";
import { renderLiveGlucosePill } from "../views/calculator.js";
import { currentUser, supabaseClient } from "./cloud.js";
import { diag } from "./diagnostics.js";
import { friendlyNsError, nightscoutConfigured, nsCfg, nsClient } from "./nightscout-sync.js";

// ---- our own glucose history, backed by Supabase when signed in ----
// Persist whatever Nightscout hands back, so graphs and future stats read from data we
// control instead of re-fetching (and re-trusting) Nightscout every single time.
export async function saveGlucoseReadings(entries) {
  if (!supabaseClient || !currentUser) return { ok: true, saved: 0 }; // this table only exists for signed-in accounts
  const rows = entriesToGlucoseRows(entries, currentUser.id);
  if (rows.length === 0) return { ok: true, saved: 0 };
  try {
    const { error } = await supabaseClient.from("glucose_readings").upsert(rows, { onConflict: "user_id,at" });
    if (error) { diag.log("warn", "glucose-db", "Couldn't save glucose readings: " + (error.message || error)); return { ok: false, saved: 0, error: error.message || String(error) }; }
    glucoseReadingsCache.clear(); // new data invalidates every cached window
    return { ok: true, saved: rows.length };
  } catch (e) {
    const msg = (e && e.message) || String(e);
    diag.log("warn", "glucose-db", "Couldn't save glucose readings: " + msg);
    return { ok: false, saved: 0, error: msg };
  }
}
async function getLatestStoredGlucoseAt() {
  try {
    const { data, error } = await supabaseClient.from("glucose_readings").select("at").eq("user_id", currentUser.id).order("at", { ascending: false }).limit(1).maybeSingle();
    return error || !data ? null : data.at;
  } catch (e) { return null; }
}
async function getOldestStoredGlucoseAt() {
  try {
    const { data, error } = await supabaseClient.from("glucose_readings").select("at").eq("user_id", currentUser.id).order("at", { ascending: true }).limit(1).maybeSingle();
    return error || !data ? null : data.at;
  } catch (e) { return null; }
}

/** Pages backward through Nightscout history from `before`, saving as it goes, until either
 * `cutoffMs` is reached, history is exhausted, or the safety cap kicks in. Shared by the
 * backfill button (always runs) and ensureGlucoseCoverage (only runs when actually needed). */
async function pageBackwardImporting(cfg, cutoffMs) {
  let before = Date.now() + 60_000;
  let fetched = 0, saved = 0, saveFailures = 0, lastSaveError = null;
  for (let i = 0; i < 200; i++) { // safety cap -- 200 batches of 1000 is 200k readings, far beyond any realistic need
    let r;
    try { r = await nsClient.read(cfg, 1000, { before }); }
    catch (e) { return { fetched, saved, reason: friendlyNsError(e) }; }
    if (!r.entries.length) break; // Nightscout has nothing older than `before` -- history exhausted
    fetched += r.entries.length;
    const result = await saveGlucoseReadings(r.entries);
    if (result.ok) saved += result.saved;
    else {
      saveFailures++;
      lastSaveError = result.error;
      // A couple of failures could be transient; a run of them means something is
      // fundamentally broken (the table doesn't exist, a bad RLS policy, etc.) -- stop
      // rather than "successfully" fetching thousands more readings we can't actually store.
      if (saveFailures >= 3) return { fetched, saved, reason: `Couldn't save to the database: ${lastSaveError}` };
    }
    const dates = r.entries.map(e => e.date).filter(d => typeof d === "number");
    const oldest = dates.length ? Math.min(...dates) : null;
    if (oldest == null || oldest >= before) break; // no progress -- stop rather than loop forever
    before = oldest;
    if (before <= cutoffMs || r.entries.length < 1000) break;
  }
  return { fetched, saved, reason: saveFailures > 0 ? `${saveFailures} batch(es) failed to save: ${lastSaveError}` : undefined };
}

/** Makes sure our database has at least `hours` worth of recent history for this account,
 * doing as little work as possible: a cheap "catch up since our latest point" when we
 * already have enough depth, or a full paginated pull when we don't (e.g. right after
 * signing in, before any backfill). Silent/best-effort -- callers read the DB afterward
 * regardless of whether this fully succeeded. */
async function ensureGlucoseCoverage(hours) {
  if (!supabaseClient || !currentUser || !nightscoutConfigured()) return;
  const cfg = nsCfg();
  const sinceMs = Date.now() - hours * 3600_000;
  try {
    const [latestAt, oldestAt] = await Promise.all([getLatestStoredGlucoseAt(), getOldestStoredGlucoseAt()]);
    if (oldestAt && new Date(oldestAt).getTime() <= sinceMs) {
      // Already covered -- just catch up anything newer than our latest stored point.
      const r = latestAt
        ? await nsClient.read(cfg, 1000, { after: new Date(latestAt).getTime() + 1000 })
        : await nsClient.read(cfg, Math.min(hours * 12, 1000));
      if (r.entries.length) await saveGlucoseReadings(r.entries);
      return;
    }
  } catch (e) { /* fall through to a full paginated pull below */ }
  await pageBackwardImporting(cfg, sinceMs);
}

/** Recent glucose for the Active Insulin & Carbs "Glucose" tab. Always fetches this window fresh, directly from Nightscout, rather than asking "do we
 * already have enough stored?" -- that coverage question is exactly what could let a stale,
 * sparse database win over what Nightscout actually has right now. This viewer only ever
 * shows up to 24 hours, which Nightscout returns in a single request anyway, so there's no
 * real pagination/speed reason to prefer the database here the way the much bigger History
 * tab needs to. Still saves what it gets (fire-and-forget) so the database that DOES benefit
 * from density -- the History tab -- keeps accumulating real readings over time. */
export async function fetchGlucoseHistory(hours) {
  if (!nightscoutConfigured()) return { ok: false, reason: "Nightscout isn't set up yet." };
  try {
    const r = await nsClient.read(nsCfg(), Math.min(hours * 12 + 12, 1000)); // +12 is a small safety margin, not load-bearing -- 24h at a 5-min interval is ~288, nowhere near Nightscout's own 1000 cap
    if (r.entries.length) saveGlucoseReadings(r.entries);
    return { ok: true, entries: r.entries };
  } catch (e) { return { ok: false, reason: friendlyNsError(e) }; }
}

/** Explicit, always-runs pull of as much history as Nightscout will give (the Settings
 * button) -- as opposed to ensureGlucoseCoverage, which skips the work when we already
 * have enough. Reports how much it actually imported. */
export async function backfillGlucoseHistory(days = 90) {
  if (!supabaseClient || !currentUser) return { ok: false, reason: "Sign in to Cloud Sync first." };
  if (!nightscoutConfigured()) return { ok: false, reason: "Set up Nightscout first." };
  const { fetched, saved, reason } = await pageBackwardImporting(nsCfg(), Date.now() - days * 86400_000);
  if (reason) return { ok: saved > 0, imported: saved, fetched, reason };
  return { ok: true, imported: saved, fetched };
}

// In-memory only (never persisted): avoids re-fetching + re-paginating the same window
// repeatedly when switching between tabs/views/band presets within one visit. Cleared
// whenever a fresh reading is saved, so it can never show stale data as if it were current.
export const glucoseReadingsCache = new Map(); // days -> { readings, at }
const GLUCOSE_CACHE_TTL_MS = 60_000;

/** Readings for the History > Glucose tab: ensures coverage, then reads the window straight
 * from our database as { at (ms), mgdl } pairs -- the shape js/glucose-stats.js expects. */
export async function fetchStoredGlucoseReadings(days) {
  if (!supabaseClient || !currentUser) return { ok: false, reason: "Sign in to Cloud Sync to build up glucose history." };
  if (!nightscoutConfigured()) return { ok: false, reason: "Set up Nightscout Sync first." };
  const cached = glucoseReadingsCache.get(days);
  if (cached && Date.now() - cached.at < GLUCOSE_CACHE_TTL_MS) return { ok: true, readings: cached.readings };
  await ensureGlucoseCoverage(days * 24);
  try {
    const sinceISO = new Date(Date.now() - days * 86400_000).toISOString();
    // A Supabase project enforces its own server-side max-rows cap (Project Settings > API >
    // "Max Rows", 1000 by default) that a client .limit() can request FEWER rows than but
    // never override -- a single large .limit() silently gets clamped back down. The only
    // way to actually get more than that cap is genuine pagination: fetch bounded pages with
    // .range(). 90 days at a 5-minute CGM interval is ~26,000 readings, so a large window
    // can mean dozens of pages -- fetch them all CONCURRENTLY (we know the page boundaries
    // upfront from the count) rather than one at a time, which is the main thing that made
    // opening a 30/90-day view feel slow.
    const PAGE = 1000, HARD_CAP = 30000;
    const { count, error: countErr } = await supabaseClient.from("glucose_readings").select("at", { count: "exact", head: true }).eq("user_id", currentUser.id).gte("at", sinceISO);
    if (countErr) throw countErr;
    const total = Math.min(count || 0, HARD_CAP);
    const pageCount = Math.max(1, Math.ceil(total / PAGE)) || 1;
    const pages = await Promise.all(Array.from({ length: total === 0 ? 0 : pageCount }, (_, i) => {
      const offset = i * PAGE;
      return supabaseClient.from("glucose_readings").select("at, mgdl").eq("user_id", currentUser.id).gte("at", sinceISO).order("at").range(offset, offset + PAGE - 1);
    }));
    const firstError = pages.find(p => p.error);
    if (firstError) throw firstError.error;
    const readings = pages.flatMap(p => p.data || []).map(row => ({ at: new Date(row.at).getTime(), mgdl: row.mgdl }));
    // Don't cache an empty result: it's most often a transient state (a write just failed, or
    // coverage hasn't caught up yet) rather than a durable "there's truly nothing here" fact,
    // and caching it would block the self-healing retry-on-reopen behavior from ever helping.
    if (readings.length > 0) glucoseReadingsCache.set(days, { readings, at: Date.now() });
    return { ok: true, readings };
  } catch (e) { return { ok: false, reason: "Couldn't load your glucose history." }; }
}

// ---- live glucose pill on the dose card ----
const LIVE_GLUCOSE_CACHE_KEY = KEYS.liveGlucose;
export const LIVE_GLUCOSE_STALE_MS = 15 * 60 * 1000;
// { mgdl, direction, at } -- cached across reloads so the pill isn't blank while the first fetch is in flight
export let liveGlucose = (() => { try { return JSON.parse(localStorage.getItem(LIVE_GLUCOSE_CACHE_KEY)); } catch (e) { return null; } })();

/** Forget the cached reading (the Nightscout site changed, or everything is being deleted). */
export function clearLiveGlucose() {
  liveGlucose = null;
  try { localStorage.removeItem(LIVE_GLUCOSE_CACHE_KEY); } catch (e) { /* non-fatal */ }
}

export async function refreshLiveGlucose() {
  if (!nightscoutConfigured()) return;
  try {
    const r = await nsClient.read(nsCfg(), 1);
    const entry = Array.isArray(r.entries) ? r.entries[0] : null;
    if (entry && typeof entry.sgv === "number") {
      liveGlucose = { mgdl: entry.sgv, direction: entry.direction || null, at: entry.date || Date.now() };
      localStorage.setItem(LIVE_GLUCOSE_CACHE_KEY, JSON.stringify(liveGlucose));
      saveGlucoseReadings(r.entries); // fire-and-forget: don't hold up the pill on a DB write
    }
  } catch (e) {
    // a background poll failing isn't worth interrupting anyone for -- just keep showing the last known reading
  }
  renderLiveGlucosePill();
}
