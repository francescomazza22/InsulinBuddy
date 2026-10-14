// The functions the conformance suite exercises, each with plain-JSON inputs and outputs.
// Where the real function takes a Date, a callback, or a Map, an adapter here takes plain data instead
// (a time as { hour, minute }, defaults as a state object, ids from a counter), so a port in another language can load the
// fixtures without needing JavaScript's types. The name used in a fixture's "fn" field is the key in this table.
import { convertGlucose, roundDose, capDoseParts, planDose, planEditDose, checkDoseConsistency, iobFraction, cobGrams, compoundGiInfo, activeAt, absorptionMinutesForEntry, giBand } from "../js/calc.js";
import { basalContext, basalDrop, expectedFromInsulin, observedCarbs, cobAt, projectGlucose, gapSummary, prepareReadings, glucoseNear, insulinDrop } from "../js/glucose-model.js";
import { percentile, estimatedA1c, glucoseSummaryStats, timeInRangeBreakdown } from "../js/glucose-stats.js";
import { median, quantile } from "../js/insights.js";
import { normalizeState, mergeStates, stampChanges, makeFingerprint, prepareRestoredState, unexplainedEmptying, statesEquivalent, pruneTombstones } from "../js/state.js";
import { treatmentsForEntry, nsToken, nsBaseUrl, nsConfigured, extractNsId, entriesToGlucoseRows } from "../js/nightscout.js";
import { validateEntry, validateFood, validateRecipe, validateSettings, validateState } from "../js/core/schema.js";
import { buildMealEntry, adjustUsage } from "../js/core/meal-entry.js";
import { toCsv, parseCsv, recipeTotals, parseLibraryFile, mergeLibrary } from "../js/core/library.js";
import { toMinutes, inRange, ratioAt, autoMealType, formatDuration, clampNum } from "../js/core/time.js";
import { makeBasalEntry, basalDoseCheck, lastBasalDose } from "../js/history.js";
import { parseDecimalInput } from "../js/util.js";

const at = ({ hour, minute = 0 }) => new Date(2026, 0, 15, hour, minute);          // a local clock time on a fixed day
const defaultsFn = d => () => structuredClone(d);

export const FUNCTIONS = {
  // ---- dosing (the safety-critical core)
  planDose: i => planDose({ ...i, correctionUnits: i.correctionUnits === "NaN" ? NaN : i.correctionUnits }),
  planEditDose, capDoseParts, roundDose: (v, step) => roundDose(v, step), convertGlucose, checkDoseConsistency,
  parseDecimalInput, iobFraction, cobGrams, compoundGiInfo, giBand, absorptionMinutesForEntry, activeAt,
  // ---- glucose model and statistics
  insulinDrop, basalContext, basalDrop, expectedFromInsulin, gapSummary, prepareReadings, glucoseNear, cobAt,
  observedCarbs: (entries, readings, s, now) => observedCarbs(entries, readings, { ...s, absMinutes: () => s.absMinutes }, now),
  projectGlucose: (entries, readings, s, now) => projectGlucose(entries, readings, { ...s, absMinutes: () => s.absMinutes }, now),
  percentile, estimatedA1c, glucoseSummaryStats, timeInRangeBreakdown, median, quantile,
  // ---- state, merge and backup
  normalizeState: (parsed, defaults) => normalizeState(parsed, defaultsFn(defaults)),
  mergeStates: (local, remote, defaults) => mergeStates(local, remote, defaultsFn(defaults)),
  prepareRestoredState: (snap, cur, defaults, now) => prepareRestoredState(snap, cur, defaultsFn(defaults), now),
  stampChanges: (state, previousState, now) => { const s = structuredClone(state); stampChanges(s, makeFingerprint(previousState), now); return s; },
  statesEquivalent, unexplainedEmptying: (state, ids) => unexplainedEmptying(state, new Set(ids)),
  pruneTombstones: (state, now, maxAge) => { const s = structuredClone(state); pruneTombstones(s, now, maxAge); return s.deleted; },
  // ---- sending to Nightscout
  treatmentsForEntry, nsToken, nsBaseUrl, nsConfigured, extractNsId, entriesToGlucoseRows,
  // ---- data contract and entry building
  validateEntry, validateFood, validateRecipe, validateSettings, validateState,
  buildMealEntry: i => buildMealEntry({ ...i, now: new Date(i.nowMs) }),
  adjustUsage: (library, recipes, refs, delta) => { const l = structuredClone(library), r = structuredClone(recipes); adjustUsage(l, r, refs, delta); return { library: l, recipes: r }; },
  makeBasalEntry, basalDoseCheck, lastBasalDose,
  // ---- food library and time
  recipeTotals, toCsv, parseCsv, parseLibraryFile,
  mergeLibrary: (library, recipes, parsed) => { const l = structuredClone(library), r = structuredClone(recipes); let n = 0; const result = mergeLibrary(l, r, parsed, p => p + (++n)); return { result, library: l, recipes: r }; },
  toMinutes, inRange, formatDuration, clampNum,
  ratioAt: (list, clock) => ratioAt(list, at(clock)),
  autoMealType: clock => autoMealType(at(clock))
};
