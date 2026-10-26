// Supabase Edge Function: health-webhook
//
// Receives Apple Health data POSTed by the "Health Webhook" iPhone app and keeps each delivery,
// untouched, in the `health_inbox` table (see supabase/health-inbox.sql). Step 1 of importing
// Apple Health workouts into Insulin Buddy as activity entries: we first capture what the app
// really sends, then the app learns to turn workouts from the inbox into activities.
//
// It never writes to app_state (your meals, doses and settings), so it can't disturb the app or
// race with its sync. Rows older than RETENTION_DAYS are removed whenever a new delivery arrives.
//
// Secrets (Project Settings -> Edge Functions -> Secrets):
//   HEALTH_WEBHOOK_TOKEN   a long random string you invent -- paste it into the app's
//                          "Bearer token" field
//   HEALTH_EXPORT_USER_ID  your account's user id (already set for health-export)
// In the function's settings, turn OFF "Verify JWT": the Bearer token is our own, not a
// Supabase login, so Supabase's own check would refuse every delivery.
//
// Call shape:  POST /health-webhook   Authorization: Bearer <HEALTH_WEBHOOK_TOKEN>   body: JSON

declare const Deno: any;

export const MAX_BODY_BYTES = 5_000_000;
export const RETENTION_DAYS = 30;

export interface WebhookEnv {
  token: string | null;
  userId: string | null;
  supabaseUrl: string | null;
  serviceRoleKey: string | null;
}

export function readEnv(get: (k: string) => string | undefined): WebhookEnv {
  return {
    token: get("HEALTH_WEBHOOK_TOKEN") || null,
    userId: get("HEALTH_EXPORT_USER_ID") || null,
    supabaseUrl: get("SUPABASE_URL") || null,
    serviceRoleKey: get("SUPABASE_SERVICE_ROLE_KEY") || null
  };
}

export function extractToken(req: Request): string | null {
  const m = /^Bearer\s+(.+)$/i.exec((req.headers.get("Authorization") || "").trim());
  return m ? m[1].trim() : null;
}

export function tokensMatch(a: string | null, b: string | null): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Body text -> what we store. Anything that isn't valid JSON is still kept (as text), because
 * the point of this step is to see exactly what the app sends. */
export function toPayload(text: string): unknown {
  if (!text.trim()) return { _empty: true };
  try { return JSON.parse(text); } catch { return { _raw: text }; }
}

export async function handle(req: Request, env: WebhookEnv, fetchImpl: typeof fetch = fetch, nowMs = Date.now()): Promise<Response> {
  const reply = (status: number, payload: unknown) =>
    new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });

  if (req.method !== "POST") return reply(405, { error: "Use POST" });
  if (!env.token || !env.userId || !env.supabaseUrl || !env.serviceRoleKey) return reply(500, { error: "Not fully configured yet (missing secrets)." });
  if (!tokensMatch(extractToken(req), env.token)) return reply(401, { error: "Missing or incorrect token" });

  const declared = Number(req.headers.get("Content-Length") || 0);
  if (declared > MAX_BODY_BYTES) return reply(413, { error: "Delivery too large" });
  const text = await req.text();
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > MAX_BODY_BYTES) return reply(413, { error: "Delivery too large" });

  const headers = { apikey: env.serviceRoleKey, Authorization: `Bearer ${env.serviceRoleKey}`, "Content-Type": "application/json" };
  const base = `${env.supabaseUrl}/rest/v1/health_inbox`;
  let res: Response;
  try {
    res = await fetchImpl(base, {
      method: "POST",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify({ user_id: env.userId, payload: toPayload(text), bytes })
    });
  } catch {
    return reply(502, { error: "Couldn't reach the database." });
  }
  // A failure must reach the sender (it retries), never be reported as received.
  if (!res.ok) return reply(502, { error: `Couldn't store the delivery (HTTP ${res.status})` });

  // Housekeeping only: a failure here doesn't lose the delivery we just stored.
  const cutoff = new Date(nowMs - RETENTION_DAYS * 86_400_000).toISOString();
  try {
    await fetchImpl(`${base}?user_id=eq.${encodeURIComponent(env.userId)}&received_at=lt.${encodeURIComponent(cutoff)}`, { method: "DELETE", headers });
  } catch { /* ignored on purpose */ }

  return reply(200, { ok: true, bytes });
}

if (typeof Deno !== "undefined" && Deno.serve && !(globalThis as any).__HEALTH_WEBHOOK_TEST__) {
  Deno.serve((req: Request) => handle(req, readEnv(k => Deno.env.get(k))));
}
