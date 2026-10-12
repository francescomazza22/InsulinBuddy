// One plain-English answer to "is everything I did actually saved and sent?", worked out from the app's three destinations:
// this device (always), the cloud account, and Nightscout/Gluroo. Pure: it only reads what it is given.
import { timeAgo } from "./util.js";

const RANK = { off: 0, ok: 1, pending: 2, problem: 3 };

/**
 * input: {
 *   online, now,
 *   cloud: { configured, signedIn, blocked, loadOk, loadMessage, pending, checkedAt },
 *   ns: { configured, queued, lastError, oldestAt, writeOk, writeAt }
 * }
 * Returns { level: "ok"|"pending"|"problem"|"local", short, title, rows: [{ key, name, level, text }] }.
 */
export function summarizeSync(input = {}) {
  const now = input.now ?? Date.now();
  const online = input.online !== false;
  const c = input.cloud || {}, n = input.ns || {};
  const rows = [{ key: "device", name: "This device", level: "ok", text: "Everything is saved here." }];

  // cloud account
  if (!c.configured || !c.signedIn) rows.push({ key: "cloud", name: "Cloud account", level: "off", text: "Not signed in, so your data lives only on this device." });
  else if (c.blocked) rows.push({ key: "cloud", name: "Cloud account", level: "problem", text: "Paused to protect your data: your history would have shrunk, which looks like a bug. Details are in Settings > Data > Status." });
  else if (c.loadOk === false) rows.push({ key: "cloud", name: "Cloud account", level: "problem", text: c.loadMessage || "Couldn't load your data from the cloud." });
  else if (c.pending) rows.push({ key: "cloud", name: "Cloud account", level: "pending", text: online ? "Changes are waiting to upload and will go up shortly." : "You're offline. Changes are saved here and will upload when you're back online." });
  else rows.push({ key: "cloud", name: "Cloud account", level: "ok", text: `Up to date${c.checkedAt ? ", checked " + timeAgo(c.checkedAt, now) : ""}.` });

  // Nightscout / Gluroo
  const q = Number(n.queued) || 0;
  if (!n.configured) rows.push({ key: "ns", name: "Nightscout / Gluroo", level: "off", text: "Not set up." });
  else if (q > 0 && n.lastError && online) rows.push({ key: "ns", name: "Nightscout / Gluroo", level: "problem", text: `${q} ${q === 1 ? "entry is" : "entries are"} not sent yet. Last problem: ${n.lastError}` });
  else if (q > 0) rows.push({ key: "ns", name: "Nightscout / Gluroo", level: "pending", text: online ? `${q} ${q === 1 ? "entry is" : "entries are"} on the way${n.oldestAt ? ` (oldest ${timeAgo(n.oldestAt, now)})` : ""}.` : `You're offline. ${q} ${q === 1 ? "entry" : "entries"} will be sent when you're back online.` });
  else rows.push({ key: "ns", name: "Nightscout / Gluroo", level: "ok", text: `Everything sent${n.writeAt && n.writeOk ? ", last " + timeAgo(n.writeAt, now) : ""}.` });

  const remote = rows.filter(r => r.key !== "device" && r.level !== "off");
  let level = "local";
  if (remote.length) level = remote.reduce((w, r) => (RANK[r.level] > RANK[w] ? r.level : w), "ok");
  const waiting = q + (c.pending && c.signedIn ? 1 : 0);
  const short = level === "ok" ? "Synced" : level === "pending" ? (online ? "Sending" : "Offline") + (waiting > 1 ? ` · ${waiting}` : "") : level === "problem" ? "Check sync" : "On this device";
  const title = level === "ok" ? "Everything is saved and sent" : level === "pending" ? "Saved on this device; waiting to send" : level === "problem" ? "Something isn't syncing" : "Saved on this device only";
  return { level, short, title, rows };
}
