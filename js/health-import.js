// Apple Health workouts -> activity entries (2.66.0).
//
// The "Health Webhook" iPhone app posts Apple Health data to the Supabase function health-webhook, which keeps each
// delivery untouched in the health_inbox table. The app reads only the workout part of new deliveries
// (payload.data.exercise_sessions; the calorie samples are fetched only when a delivery has a workout) and turns each
// workout into an ordinary activity entry. Pure functions only; app.js does the fetching and saving.
//
// No duplicates, ever: an imported entry's id is built from the workout's own Apple Health id ("hk-<uuid>"), so
//   * a workout already in the log is skipped,
//   * a workout you deleted is skipped (its deletion marker has the same id, and syncs to your other devices),
//   * two devices importing the same workout at once produce the same id, which cloud sync merges into one.
//
// Imported activities are never sent to Nightscout: Gluroo already reads the same workouts from Apple Health itself.

import { makeActivityEntry, ACTIVITY_MAX_MINUTES, ACTIVITY_NAME_MAX } from "./activity.js";

export const HEALTH_ID_PREFIX = "hk-";
export const HEALTH_SOURCE = "appleHealth";
export const MIN_WORKOUT_MINUTES = 5;      // shorter "workouts" are almost always accidental starts
export const HEALTH_NOTE = "From Apple Health";
export const UNKNOWN_INTENSITY_NOTE = `${HEALTH_NOTE} (intensity not known)`;
// Health Webhook sends new data in pieces, so a workout and the calories burned during it can arrive in different
// deliveries, in either order. Deliveries are therefore kept this long, calories are looked for across all of them, and
// an import still waiting for its calories is filled in when they turn up (2.66.1).
export const INBOX_KEEP_MS = 2 * 24 * 3600_000;
// Active calories per minute that separate light / moderate / hard. A rough guide (about 3 and 6 METs for an adult);
// the result is marked as estimated and can be changed on the entry.
export const KCAL_PER_MIN_MODERATE = 4;
export const KCAL_PER_MIN_HARD = 8;

const SAFE_SESSION_ID = /^[A-Za-z0-9-]{1,100}$/;

const LABEL_TYPES = {
  walk: ["walking", "hiking", "walk", "hike"],
  run: ["running", "run", "track_and_field"],
  cycle: ["cycling", "hand_cycling", "biking", "bike", "cycle", "indoor_cycling"],
  gym: ["traditional_strength_training", "functional_strength_training", "strength_training", "core_training", "weights", "weight_training"],
  hiit: ["high_intensity_interval_training", "hiit", "cross_training", "mixed_cardio", "circuit_training", "jump_rope"],
  swim: ["swimming", "swim", "water_fitness"],
  sport: ["soccer", "football", "american_football", "australian_football", "basketball", "rugby", "volleyball", "hockey",
    "tennis", "badminton", "squash", "padel", "pickleball", "table_tennis", "cricket", "baseball", "softball", "handball", "lacrosse", "racquetball"],
  yoga: ["yoga"]
};
const TYPE_BY_LABEL = new Map(Object.entries(LABEL_TYPES).flatMap(([type, labels]) => labels.map(l => [l, type])));

const normLabel = s => String(s == null ? "" : s).trim().toLowerCase().replace(/[\s-]+/g, "_");
const prettyLabel = s => {
  const words = normLabel(s).split("_").filter(Boolean).join(" ");
  return (words.charAt(0).toUpperCase() + words.slice(1)).slice(0, ACTIVITY_NAME_MAX) || "Workout";
};

/** Apple Health's workout label ("cycling", "traditional_strength_training", "Elliptical") -> { type, name }. */
export function mapWorkoutLabel(label) {
  const type = TYPE_BY_LABEL.get(normLabel(label));
  return type ? { type, name: "" } : { type: "other", name: prettyLabel(label) };
}

export const importIdFor = sessionId => HEALTH_ID_PREFIX + sessionId;

const timeOf = v => { const t = Date.parse(v); return Number.isFinite(t) ? t : NaN; };

/** Active calories burned inside [start, end], counting each sample for the share of it that overlaps. null when
 * there are no calorie samples at all for that window. */
export function caloriesDuring(startMs, endMs, samples) {
  let total = 0, any = false;
  // Health Webhook can send the same delivery twice (seen 30 Oct 2026: two identical deliveries one second apart), and
  // calories are gathered across deliveries, so the same sample can be here more than once. Count each sample once:
  // by its id, or, without one, by its times and value (2.75.1).
  const seen = new Set();
  for (const s of samples || []) {
    if (!s || typeof s.value !== "number" || !Number.isFinite(s.value) || s.value < 0) continue;
    const key = typeof s.id === "string" && s.id ? "id:" + s.id : `t:${s.start_time}|${s.end_time}|${s.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (s.unit && String(s.unit).toLowerCase() !== "kcal") continue;
    const a = timeOf(s.start_time), b = timeOf(s.end_time);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) continue;
    const overlap = Math.min(b, endMs) - Math.max(a, startMs);
    if (b === a) { if (a >= startMs && a <= endMs) { total += s.value; any = true; } continue; }
    if (overlap <= 0) continue;
    total += s.value * (overlap / (b - a)); any = true;
  }
  return any ? total : null;
}

/** { intensity, kcal } from calories per minute; with no calorie data, "moderate" and kcal null (shown as estimated). */
export function estimateIntensity(minutes, kcal) {
  if (kcal == null || !(minutes > 0)) return { intensity: "moderate", kcal: null };
  const perMin = kcal / minutes;
  return { intensity: perMin >= KCAL_PER_MIN_HARD ? "hard" : perMin >= KCAL_PER_MIN_MODERATE ? "moderate" : "light", kcal: Math.round(kcal) };
}

/**
 * Inbox rows -> new activity entries, oldest first.
 * rows: [{ sessions: [...exercise_sessions], calories: [...active_calories] | null }]
 * known: { history, deleted } -- the current state, to skip workouts already logged or deleted.
 */
export function workoutsToActivities(rows, { history = [], deleted = {}, now = Date.now() } = {}) {
  const have = new Set((history || []).map(h => h && h.id));
  const gone = deleted || {};
  const calories = (rows || []).flatMap(r => (r && Array.isArray(r.calories) ? r.calories : []));
  const out = new Map();
  for (const row of rows || []) {
    for (const s of (row && Array.isArray(row.sessions) ? row.sessions : [])) {
      if (!s || typeof s.id !== "string" || !SAFE_SESSION_ID.test(s.id)) continue;
      const id = importIdFor(s.id);
      if (have.has(id) || gone[id] != null || out.has(id)) continue;
      const start = timeOf(s.start_time), end = timeOf(s.end_time);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
      if (start > now + 5 * 60000) continue;
      const minutes = Math.round((end - start) / 60000);
      if (minutes < MIN_WORKOUT_MINUTES || minutes > ACTIVITY_MAX_MINUTES) continue;
      const { type, name } = mapWorkoutLabel(s.label);
      const { intensity, kcal } = estimateIntensity(minutes, caloriesDuring(start, end, calories));
      const note = kcal == null ? UNKNOWN_INTENSITY_NOTE : estimatedNote(kcal);
      const entry = makeActivityEntry({ type, name, minutes, intensity, ts: start, note, now });
      entry.id = id;
      entry.source = HEALTH_SOURCE;
      out.set(id, entry);
    }
  }
  return [...out.values()].sort((a, b) => a.ts - b.ts);
}

export const isImportedActivity = e => !!e && e.source === HEALTH_SOURCE;
const estimatedNote = kcal => `${HEALTH_NOTE} · ${kcal} kcal (intensity estimated)`;

/** An import still waiting for its calories: untouched since it was added (same note), and recent enough that its
 * calories could still be in the inbox. Anything you have edited is left alone. */
export function awaitingIntensity(e, now = Date.now()) {
  return isImportedActivity(e) && e.note === UNKNOWN_INTENSITY_NOTE && Number.isFinite(e.ts) && now - e.ts <= INBOX_KEEP_MS;
}

/** The calories an untouched estimate was made from, or null: the note is still the one the import wrote, and the
 * intensity is still the one those calories give (so a changed intensity is left alone). */
export function estimatedKcal(e) {
  if (!isImportedActivity(e) || typeof e.note !== "string" || !(e.durationMin > 0)) return null;
  const m = /^From Apple Health · (\d+) kcal \(intensity estimated\)$/.exec(e.note);
  if (!m) return null;
  const kcal = Number(m[1]);
  return estimateIntensity(e.durationMin, kcal).intensity === e.intensity ? kcal : null;
}
/** Imports whose estimate may have counted the same calories twice (2.75.1): untouched and recent enough to re-check. */
export function mayBeDoubleCounted(e, now = Date.now()) {
  return estimatedKcal(e) != null && Number.isFinite(e.ts) && now - e.ts <= INBOX_KEEP_MS;
}

/** [{ id, intensity, note }] for imports waiting for calories that the samples now cover, and for untouched estimates
 * that come out LOWER once each sample is counted once (duplicates only ever add, so a lower figure is the fix; a
 * higher one could just mean part of the samples have already been tidied away, so it is left alone). */
export function intensityUpdates(entries, calories) {
  const out = [];
  for (const e of entries || []) {
    if (!isImportedActivity(e) || !(e.durationMin > 0)) continue;
    const kcal = caloriesDuring(e.ts, e.ts + e.durationMin * 60000, calories);
    if (kcal == null) continue;
    const est = estimateIntensity(e.durationMin, kcal);
    const before = estimatedKcal(e);
    if (e.note !== UNKNOWN_INTENSITY_NOTE && !(before != null && est.kcal < before)) continue;
    out.push({ id: e.id, intensity: est.intensity, note: estimatedNote(est.kcal) });
  }
  return out;
}
