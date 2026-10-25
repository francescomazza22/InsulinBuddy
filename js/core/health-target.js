// Apple Health as a SyncTarget for the generic Outbox (js/core/outbox.js): logged entries become Health samples.
// On the web there is no Health, so the app never registers this target; a native build whose platform.health.available()
// is true registers it and every meal, correction and basal dose flows to Health with the same offline-safe queue and retries.
//
// What goes to Health (units are insulin delivery samples, grams are dietary carbohydrate samples):
//   a meal or correction -> "bolus" insulin (meal + correction) and, if carbs were counted, a carbohydrate sample
//   a basal dose         -> "basal" insulin
// Samples carry the entry id as an external id so an edit replaces them and a delete removes them (never duplicates).

export function healthTarget(platform) {
  const unsupported = r => r && r.ok === false && r.reason === "unsupported";
  const must = r => { if (!r || r.ok === false) { const e = new Error((r && r.reason) || "Health write failed"); e.kind = r && r.reason === "unsupported" ? "unsupported" : r && r.reason === "denied" ? "denied" : "health"; throw e; } return r; };
  return {
    name: "health", statusKey: "hk",
    partsFor(entry) {
      const ts = entry.ts;
      if (entry.entryType === "activity") return [];   // nothing to write: Health gets workouts from the watch/phone itself
      if (entry.entryType === "basal") {
        const units = Math.round((entry.basalDose || 0) * 100) / 100;
        return units > 0 ? [{ key: "basal", treatment: { id: `${entry.id}:basal`, ts, units, kind: "basal" } }] : [];
      }
      const parts = [];
      const units = Math.round(((entry.mealDose || 0) + (entry.correctionDose || 0)) * 100) / 100;
      if (units > 0 && !entry.noInsulin) parts.push({ key: "bolus", treatment: { id: `${entry.id}:bolus`, ts, units, kind: "bolus" } });
      if ((entry.totalCarbs || 0) > 0) parts.push({ key: "carbs", treatment: { id: `${entry.id}:carbs`, ts, grams: Math.round(entry.totalCarbs * 10) / 10 } });
      return parts;
    },
    async create(cfg, p) { return must(p.units != null ? await platform.health.writeInsulin(p) : await platform.health.writeCarbs(p)); },
    async update(cfg, p, remoteId) {
      if (remoteId) must(await platform.health.remove(remoteId));
      return must(p.units != null ? await platform.health.writeInsulin(p) : await platform.health.writeCarbs(p));
    },
    async remove(cfg, remoteId) { must(await platform.health.remove(remoteId)); },
    // not allowed / not available will not fix itself by retrying; anything else (Health busy, device locked) will
    isPermanent: err => err && (err.kind === "unsupported" || err.kind === "denied"),
    secrets: () => []
  };
}
