// What changed in the settings that decide a dose (2.88.0). When a sync brings in settings from another device, the
// app tells you what changed, so a bad change (6 Nov 2026: factory ratios replaced the real ones) can't go unnoticed
// before the next dose. Pure: no DOM.

const num = v => { if (v == null || v === "") return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const fmt = v => (v == null ? "not set" : String(Math.round(v * 100) / 100));

/** Returns a list of plain-English lines, empty when nothing dose-relevant changed. */
export function dosingChanges(before, after, { glucoseUnit = "mg/dL" } = {}) {
  const b = before || {}, a = after || {};
  const out = [];
  const ratioLists = s => [
    ...(Array.isArray(s.timeRatios) ? s.timeRatios : []),
    ...(Array.isArray(s.activityRatios) ? s.activityRatios : [])
  ].filter(r => r && r.id != null);
  const bRatios = new Map(ratioLists(b).map(r => [String(r.id), r]));
  const aRatios = new Map(ratioLists(a).map(r => [String(r.id), r]));
  for (const [id, r] of aRatios) {
    const old = bRatios.get(id);
    const name = r.name || old?.name || "Ratio";
    if (!old) out.push(`${name}: new ratio 1u:${fmt(num(r.ratio))}g`);
    else if (num(old.ratio) !== num(r.ratio)) out.push(`${name}: 1u:${fmt(num(old.ratio))}g → 1u:${fmt(num(r.ratio))}g`);
  }
  for (const [id, r] of bRatios) if (!aRatios.has(id)) out.push(`${r.name || "Ratio"}: removed (was 1u:${fmt(num(r.ratio))}g)`);
  const field = (key, label, unit) => {
    const x = num(b[key]), y = num(a[key]);
    if (x !== y) out.push(`${label}: ${fmt(x)} → ${fmt(y)}${unit ? " " + unit : ""}`);
  };
  field("target", "Target", glucoseUnit);
  field("isf", "Correction factor", `${glucoseUnit} per unit`);
  field("maxDose", "Max dose", "u");
  if (String(b.units || "") !== String(a.units || "") && b.units && a.units) out.push(`Glucose units: ${b.units} → ${a.units}`);
  const bb = b.basalBaseline || {}, ab = a.basalBaseline || {};
  for (const [k, label] of [["am", "Usual morning basal"], ["pm", "Usual evening basal"]]) {
    const x = num(bb[k]), y = num(ab[k]);
    if (x !== y) out.push(`${label}: ${fmt(x)} → ${fmt(y)}${y != null ? " u" : ""}`);
  }
  if ((b.nightscoutUrl || "") && !(a.nightscoutUrl || "")) out.push("Nightscout: the link was removed");
  return out;
}
