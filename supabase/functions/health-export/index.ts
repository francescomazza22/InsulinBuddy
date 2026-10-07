// Supabase Edge Function: health-export
//
// A read-only endpoint an iOS Shortcut can call ("Get Contents of URL") to pull recent
// meal/correction insulin doses and carbs out of Insulin Buddy, so the Shortcut can log them
// into Apple Health with "Log Health Sample". This is NOT the same kind of access as your
// normal sign-in -- it's a separate, narrow token that can only ever read this one export.
//
// Requires no schema change: it reads the same app_state row the app already writes, using
// the service-role key (every Edge Function gets one automatically) to bypass RLS for the one
// configured account, since a Shortcut has no practical way to hold a refreshing login session.
//
// This has no access to anything encrypted by a passphrase lock -- if one is enabled, the
// history inside app_state.data is ciphertext this function cannot read, by design.
//
// Secrets to set (Project Settings -> Edge Functions -> Secrets):
//   HEALTH_EXPORT_TOKEN    a long random string you invent -- this goes in the Shortcut
//   HEALTH_EXPORT_USER_ID  your account's user id (Authentication -> Users -> copy the UUID)
//
// Call shape:  GET /health-export?since=2026-10-01T00:00:00Z
//   Authorization: Bearer <HEALTH_EXPORT_TOKEN>   (or ?token=... in the URL)
// `since` is optional (defaults to the last 24 hours); the response is sorted oldest-first.
//
// Basal (long-acting) insulin is OPT-IN:  GET /health-export?since=...&include=basal
// It is deliberately not sent by default. A Shortcut written before basal existed has no branch for
// the new "basalInsulin" type, and depending on how its final "Otherwise" is set up it could log a
// basal dose into Health as a bolus. Add &include=basal only once the Shortcut has a branch that logs
// type "basalInsulin" as Insulin Delivery with the reason set to Basal.

declare const Deno: any;

const MAX_LOOKBACK_DAYS = 30;
const DEFAULT_LOOKBACK_HOURS = 24;

export interface ExportEnv {
  token: string | null;
  userId: string | null;
  supabaseUrl: string | null;
  serviceRoleKey: string | null;
  appOrigins: string[];
}

export function readEnv(get: (k: string) => string | undefined): ExportEnv {
  return {
    token: get("HEALTH_EXPORT_TOKEN") || null,
    userId: get("HEALTH_EXPORT_USER_ID") || null,
    supabaseUrl: get("SUPABASE_URL") || null,
    serviceRoleKey: get("SUPABASE_SERVICE_ROLE_KEY") || null,
    appOrigins: (get("APP_ORIGINS") || "").split(",").map(s => s.trim()).filter(Boolean)
  };
}

/** Pulls the bearer token from the Authorization header, or a ?token= query param. */
export function extractToken(req: Request, url: URL): string | null {
  const auth = req.headers.get("Authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
  if (m) return m[1];
  return url.searchParams.get("token");
}

// Not cryptographically constant-time, but this gates a personal-use export token, not a
// high-value secret -- the main goal is simply "don't compare with a naive `!==` that's easy
// to get subtly wrong", not resisting a timing side-channel.
export function tokensMatch(a: string | null, b: string | null): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export type SinceResult = { ok: true; sinceMs: number } | { ok: false; error: string };

/** Parses & sanitizes the `since` param: defaults to the last 24h, and refuses to let a
 * request pull more than MAX_LOOKBACK_DAYS worth of history at once. */
export function parseSince(param: string | null, nowMs: number): SinceResult {
  const minMs = nowMs - MAX_LOOKBACK_DAYS * 86_400_000;
  if (!param) return { ok: true, sinceMs: nowMs - DEFAULT_LOOKBACK_HOURS * 3_600_000 };
  const ms = Date.parse(param);
  if (!Number.isFinite(ms)) return { ok: false, error: "since must be a valid ISO-8601 date" };
  if (ms > nowMs) return { ok: false, error: "since can't be in the future" };
  return { ok: true, sinceMs: Math.max(ms, minMs) };
}

export interface HistoryEntry {
  ts?: number; mealDose?: number; correctionDose?: number; totalCarbs?: number;
  items?: { name?: string }[]; noInsulin?: boolean;
  entryType?: string; basalDose?: number; basalSlot?: string;
}
export interface ExportEntry { type: "carbs" | "mealInsulin" | "correctionInsulin" | "basalInsulin"; at: string; value: number; label: string }
export interface FlattenOptions { includeBasal?: boolean }

function labelFor(entry: HistoryEntry): string {
  if (entry.entryType === "basal") return entry.basalSlot === "am" ? "Basal insulin (morning)" : entry.basalSlot === "pm" ? "Basal insulin (evening)" : "Basal insulin";
  const names = (entry.items || []).map(i => i && i.name).filter(Boolean);
  if (names.length) return names.join(", ");
  return entry.noInsulin ? "Treating a low" : "Correction";
}

/** The actual transformation: raw meal-history rows -> flat, Health-sample-shaped entries,
 * one per non-zero quantity, filtered to `sinceMs` and sorted oldest-first (a Shortcut logging
 * them in order is more predictable to debug than an arbitrary order). */
export function flattenHistoryEntries(history: HistoryEntry[], sinceMs: number, opts: FlattenOptions = {}): ExportEntry[] {
  const out: ExportEntry[] = [];
  for (const entry of history || []) {
    if (!entry || typeof entry.ts !== "number" || entry.ts < sinceMs) continue;
    const at = new Date(entry.ts).toISOString();
    const label = labelFor(entry);
    if (entry.entryType === "basal") {
      // Never reaches the meal/correction branches below (a basal entry has none of those quantities),
      // and only leaves this function when the caller has explicitly asked for it.
      if (opts.includeBasal && typeof entry.basalDose === "number" && entry.basalDose > 0) out.push({ type: "basalInsulin", at, value: entry.basalDose, label });
      continue;
    }
    if (typeof entry.totalCarbs === "number" && entry.totalCarbs > 0) out.push({ type: "carbs", at, value: entry.totalCarbs, label });
    if (typeof entry.mealDose === "number" && entry.mealDose > 0) out.push({ type: "mealInsulin", at, value: entry.mealDose, label });
    if (typeof entry.correctionDose === "number" && entry.correctionDose > 0) out.push({ type: "correctionInsulin", at, value: entry.correctionDose, label });
  }
  return out.sort((a, b) => a.at < b.at ? -1 : a.at > b.at ? 1 : 0);
}

function corsHeaders(req: Request, env: ExportEnv): Record<string, string> {
  const origin = req.headers.get("Origin");
  const h: Record<string, string> = { "Access-Control-Allow-Headers": "authorization, content-type", "Access-Control-Allow-Methods": "GET, OPTIONS", "Vary": "Origin" };
  if (env.appOrigins.length === 0) h["Access-Control-Allow-Origin"] = "*";
  else if (origin && env.appOrigins.includes(origin)) h["Access-Control-Allow-Origin"] = origin;
  return h;
}

/** Reads app_state.data.history for the configured user via the service-role key (bypasses
 * RLS -- intentional, since a Shortcut has no practical login session to present instead). */
async function fetchHistory(env: ExportEnv, fetchImpl: typeof fetch): Promise<{ ok: true; history: HistoryEntry[] } | { ok: false; status: number; error: string }> {
  const url = `${env.supabaseUrl}/rest/v1/app_state?user_id=eq.${encodeURIComponent(env.userId!)}&select=data`;
  let res: Response;
  try {
    res = await fetchImpl(url, { headers: { apikey: env.serviceRoleKey!, Authorization: `Bearer ${env.serviceRoleKey}` } });
  } catch (e) {
    return { ok: false, status: 502, error: "Couldn't reach the database." }; // never echo the caught error -- it could contain request details
  }
  if (!res.ok) return { ok: false, status: 502, error: `Couldn't read your data (HTTP ${res.status})` };
  const rows = await res.json();
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row || !row.data) return { ok: true, history: [] }; // no row yet -- nothing to export, not an error
  if (row.data && typeof row.data === "object" && typeof row.data.iv === "string" && typeof row.data.data === "string") {
    return { ok: false, status: 409, error: "Your data is passphrase-encrypted -- this export can't read it, by design. Remove the passphrase lock to use this." };
  }
  return { ok: true, history: Array.isArray(row.data.history) ? row.data.history : [] };
}

export async function handle(req: Request, env: ExportEnv, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const cors = corsHeaders(req, env);
  const reply = (status: number, payload: unknown) => new Response(JSON.stringify(payload), { status, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "GET") return reply(405, { error: "Use GET" });
  if (!env.token || !env.userId || !env.supabaseUrl || !env.serviceRoleKey) return reply(500, { error: "This export isn't fully configured yet (missing secrets)." });

  const url = new URL(req.url);
  const provided = extractToken(req, url);
  if (!tokensMatch(provided, env.token)) return reply(401, { error: "Missing or incorrect token" });

  const since = parseSince(url.searchParams.get("since"), Date.now());
  if (!since.ok) return reply(400, { error: since.error });

  const result = await fetchHistory(env, fetchImpl);
  if (!result.ok) return reply(result.status, { error: result.error });

  const include = (url.searchParams.get("include") || "").toLowerCase().split(",").map(x => x.trim());
  return reply(200, { entries: flattenHistoryEntries(result.history, since.sinceMs, { includeBasal: include.includes("basal") }) });
}

if (typeof Deno !== "undefined" && Deno.serve && !(globalThis as any).__HEALTH_EXPORT_TEST__) {
  Deno.serve((req: Request) => handle(req, readEnv(k => Deno.env.get(k))));
}
