// Small, dependency-free helpers shared across modules.

const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

// Escape text for safe use inside HTML content AND quoted attribute values.
export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => HTML_ESCAPES[c]);
}
export const escapeAttr = escapeHtml;

export function round1(n) { return Math.round(n * 10) / 10; }

export function formatQty(n) { return n % 1 === 0 ? String(n) : String(round1(n)); }

// Local-midnight timestamp for the day containing `ts`.
export function dayKeyFromTs(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// "1h40", "35m", "6h"
export function formatDuration(ms) {
  const totalMin = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h${m}`;
}

export function timeAgo(ms, now = Date.now()) {
  if (!ms) return "";
  const s = Math.floor((now - ms) / 1000);
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// Strip anything that looks like a credential before text is logged, shown
// in a diagnostics report, or copied to the clipboard.
export function redact(text, secrets = []) {
  let out = String(text ?? "");
  out = out.replace(/(token|api[-_]?secret|apikey|access_token|password|passphrase)=([^&\s"']+)/gi, "$1=***");
  out = out.replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, "[jwt]");
  for (const s of secrets) {
    if (s && String(s).length >= 6) out = out.split(String(s)).join("***");
  }
  return out;
}

// A short random id with a readable prefix.
export function makeId(prefix = "id") {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
