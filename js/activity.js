// Logged physical activity (2.65.0): what you did, for how long and how hard, so its effect on glucose can be looked at later.
//
// An activity is stored as an ordinary history entry (entryType "activity"), so cloud sync, tombstones, undo, backup and the
// Nightscout outbox work for it exactly as they do for meals and basal. Every meal-shaped field is present and zero, and every
// place that counts meals, carbs or insulin skips it (the same places that skip basal), so it can never change a dose, active
// insulin, carbs on board, trends or meal stats. It is a record, nothing more. Tests pin that property.

export const ACTIVITY_TYPES = [
  { id: "walk", label: "Walk" },
  { id: "run", label: "Run" },
  { id: "cycle", label: "Cycling" },
  { id: "gym", label: "Gym / weights" },
  { id: "hiit", label: "HIIT / circuits" },
  { id: "swim", label: "Swimming" },
  { id: "sport", label: "Team sport" },
  { id: "yoga", label: "Yoga" },
  { id: "other", label: "Other" }
];
export const INTENSITIES = [
  { id: "light", label: "Light", hint: "easy, could sing" },
  { id: "moderate", label: "Moderate", hint: "could talk, not sing" },
  { id: "hard", label: "Hard", hint: "too out of breath to talk" }
];
export const DURATION_CHIPS = [15, 30, 45, 60, 90];
export const ACTIVITY_MAX_MINUTES = 24 * 60;
export const ACTIVITY_NAME_MAX = 40;
export const ACTIVITY_NOTE_MAX = 200;

const TYPE_IDS = new Set(ACTIVITY_TYPES.map(t => t.id));
const INTENSITY_IDS = new Set(INTENSITIES.map(i => i.id));
export const isActivityType = id => TYPE_IDS.has(id);
export const isIntensity = id => INTENSITY_IDS.has(id);

export const isActivityEntry = e => !!e && e.entryType === "activity";

const clean = (s, max) => String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, max);

/** The name shown for an activity: the typed name for "Other" (when there is one), otherwise the type's label. */
export function activityLabel(entry) {
  if (!entry) return "";
  const own = clean(entry.activityName, ACTIVITY_NAME_MAX);
  if (own) return own;
  const t = ACTIVITY_TYPES.find(x => x.id === entry.activityType);
  return t ? t.label : "Activity";
}
export const intensityLabel = id => { const i = INTENSITIES.find(x => x.id === id); return i ? i.label : ""; };

/** 45 -> "45 min", 90 -> "1 h 30 min", 120 -> "2 h". */
export function formatDuration(minutes) {
  const m = Math.round(Number(minutes) || 0);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

/** "Run · 45 min · Moderate" */
export function describeActivity(entry) {
  return [activityLabel(entry), formatDuration(entry.durationMin), intensityLabel(entry.intensity)].filter(Boolean).join(" · ");
}

/** Checks what was typed. Returns a message for the first problem, or "" when it can be saved. */
export function activityCheck({ type, minutes, intensity, ts, name = "" }, now = Date.now()) {
  if (!isActivityType(type)) return "Choose what you did.";
  if (type === "other" && !clean(name, ACTIVITY_NAME_MAX)) return "Give the activity a name.";
  if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes <= 0) return "Enter how long it lasted, in minutes.";
  if (minutes > ACTIVITY_MAX_MINUTES) return "That is more than 24 hours. Check the number of minutes.";
  if (!isIntensity(intensity)) return "Choose how hard it was.";
  if (typeof ts !== "number" || !Number.isFinite(ts)) return "Choose when it started.";
  if (ts > now + 5 * 60000) return "That start time is in the future.";
  return "";
}

/** A history entry for an activity. `ts` is when it started. The id comes from when it was logged (like meals and basal),
 * not from `ts`, which is usually backdated. */
export function makeActivityEntry({ type, name = "", minutes, intensity, ts, note = "", now = Date.now() }) {
  return {
    id: `h-${now}`, ts, entryType: "activity", mealType: "activity",
    activityType: type, activityName: type === "other" ? clean(name, ACTIVITY_NAME_MAX) : "",
    durationMin: Math.round(minutes), intensity, note: clean(note, ACTIVITY_NOTE_MAX),
    items: [], totalCarbs: 0, totalKcal: 0, glycemicLoad: null,
    mealDose: 0, correctionDose: 0, noInsulin: false, glucose: null, ratioLabel: "", ratioValue: null
  };
}

/** Changes an existing activity entry in place (an edit keeps its id, so sync updates rather than duplicates). */
export function applyActivityEdit(entry, { type, name = "", minutes, intensity, ts, note = "" }) {
  entry.activityType = type;
  entry.activityName = type === "other" ? clean(name, ACTIVITY_NAME_MAX) : "";
  entry.durationMin = Math.round(minutes);
  entry.intensity = intensity;
  entry.ts = ts;
  entry.note = clean(note, ACTIVITY_NOTE_MAX);
  return entry;
}

/** The most recent activity of a type (and name, for "Other"), so picking it can start from the usual duration and intensity. */
export function lastActivity(history, type, name = "") {
  const nm = clean(name, ACTIVITY_NAME_MAX).toLowerCase();
  let best = null;
  for (const e of history || []) {
    if (!isActivityEntry(e) || e.activityType !== type || !Number.isFinite(e.ts)) continue;
    if (type === "other" && nm && clean(e.activityName, ACTIVITY_NAME_MAX).toLowerCase() !== nm) continue;
    if (!best || e.ts > best.ts) best = e;
  }
  return best ? { minutes: best.durationMin, intensity: best.intensity, ts: best.ts } : null;
}

/** Words the log search matches for an activity. */
export function activitySearchText(entry) {
  return ["activity exercise sport workout", activityLabel(entry), intensityLabel(entry.intensity), formatDuration(entry.durationMin), entry.note || ""].join(" ");
}

/** The Nightscout note for an activity. A plain Note (no insulin, no carbs) is the same shape basal already uses, so it
 * shows on the Nightscout/Gluroo timeline and can't touch anything's insulin or carbs on board. */
export function activityNsNote(entry) {
  return `Activity: ${describeActivity(entry)}${entry.note ? ` (${clean(entry.note, ACTIVITY_NOTE_MAX)})` : ""}`;
}
