// Supabase Edge Function: nightscout-proxy
//
// One function that lets the app talk to YOUR Nightscout server from a browser
// without hitting CORS (CORS only restricts browsers, not servers). It replaces
// the older fetch-nightscout-glucose and write-nightscout-treatment functions,
// which accepted any URL and therefore could be used as an open proxy.
//
// What is different here
//   * Only real public hostnames: IP addresses, localhost, *.local, *.internal,
//     single-label names, embedded credentials and odd ports are all refused.
//   * Optional allowlist: set the NS_ALLOWED_HOSTS secret (comma separated,
//     e.g. "*.ns.gluroo.com") and nothing else can be reached at all.
//   * Redirects are never followed; requests time out after 10 s; request and
//     response sizes are capped; only the operations the app needs exist.
//   * Expected failures come back as HTTP 200 with { ok:false, code, error } so
//     the app can tell "Nightscout said no" from "the proxy is down".
//
// Secrets (all optional):  Project Settings -> Edge Functions -> Secrets
//   NS_ALLOWED_HOSTS   e.g.  *.ns.gluroo.com,my-site.example.com
//   NS_ALLOW_HTTP      set to 1 to permit plain http:// (not recommended)
//   APP_ORIGINS        e.g.  https://francescomazza22.github.io
//
// Deploy with default JWT verification, so only signed-in users can call it.
// Single file on purpose, so it can be pasted straight into the dashboard editor.

declare const Deno: any;

const MAX_BODY_BYTES = 20_000;
const MAX_TREATMENT_BYTES = 8_192;
const MAX_RESPONSE_BYTES = 2_000_000;
const UPSTREAM_TIMEOUT_MS = 10_000;
const ACTIONS = ["read", "create", "update", "delete"];
const EVENT_TYPES = ["Meal Bolus", "Snack Bolus", "Correction Bolus", "Carb Correction", "Note", "BG Check"];

export interface ProxyEnv {
  allowedHosts: string[];
  allowHttp: boolean;
  appOrigins: string[];
}

export function readEnv(get: (k: string) => string | undefined): ProxyEnv {
  const list = (v: string | undefined) => (v || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  return { allowedHosts: list(get("NS_ALLOWED_HOSTS")), allowHttp: get("NS_ALLOW_HTTP") === "1", appOrigins: (get("APP_ORIGINS") || "").split(",").map(s => s.trim()).filter(Boolean) };
}

type Fail = { ok: false; code: string; error: string };

// Returns a reason string when the hostname must never be contacted.
export function blockedHostReason(hostname: string): string | null {
  const h = hostname.toLowerCase().replace(/\.$/, "");
  if (h.startsWith("[") || h.includes(":")) return "IP addresses aren't allowed";
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return "IP addresses aren't allowed";
  if (h === "localhost" || h.endsWith(".localhost")) return "localhost isn't allowed";
  if (!h.includes(".")) return "single-word hostnames aren't allowed";
  for (const suffix of [".local", ".internal", ".lan", ".home", ".corp", ".intranet", ".home.arpa"]) {
    if (h.endsWith(suffix)) return "internal hostnames aren't allowed";
  }
  return null;
}

export function hostAllowed(hostname: string, patterns: string[]): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, "");
  return patterns.some(p => (p.startsWith("*.") ? h.endsWith(p.slice(1)) && h.length > p.length - 1 : h === p));
}

export function validateBaseUrl(raw: unknown, env: ProxyEnv): { ok: true; base: string; host: string } | Fail {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 300) return { ok: false, code: "BAD_REQUEST", error: "baseUrl is missing or too long" };
  let u: URL;
  try { u = new URL(raw); } catch { return { ok: false, code: "BAD_REQUEST", error: "baseUrl is not a valid URL" }; }
  if (u.protocol !== "https:" && !(u.protocol === "http:" && env.allowHttp)) return { ok: false, code: "HOST_NOT_ALLOWED", error: "Only https:// Nightscout URLs are allowed" };
  if (u.username || u.password) return { ok: false, code: "HOST_NOT_ALLOWED", error: "URLs with embedded credentials aren't allowed" };
  if (u.search || u.hash) return { ok: false, code: "BAD_REQUEST", error: "baseUrl must not contain a query string or fragment" };
  const defaultPort = u.protocol === "https:" ? "443" : "80";
  if (u.port && u.port !== defaultPort && env.allowedHosts.length === 0) return { ok: false, code: "HOST_NOT_ALLOWED", error: "Custom ports need NS_ALLOWED_HOSTS to be set" };
  const host = u.hostname.toLowerCase();
  const why = blockedHostReason(host);
  if (why) return { ok: false, code: "HOST_NOT_ALLOWED", error: why };
  if (env.allowedHosts.length > 0 && !hostAllowed(host, env.allowedHosts)) return { ok: false, code: "HOST_NOT_ALLOWED", error: "That host isn't on this project's allowlist (NS_ALLOWED_HOSTS)" };
  return { ok: true, base: `${u.origin}${u.pathname.replace(/\/+$/, "")}`, host };
}

const bad = (error: string): Fail => ({ ok: false, code: "BAD_REQUEST", error });

// Builds the upstream request for a validated action, or a failure.
export function buildUpstream(body: any, base: string): { ok: true; url: string; init: { method: string; body?: string; headers?: Record<string, string> } } | Fail {
  const token = body.token;
  if (typeof token !== "string" || token.length < 6 || token.length > 256 || !/^[A-Za-z0-9._~-]+$/.test(token)) return bad("token is missing or malformed");
  const t = encodeURIComponent(token);
  const json = { "Content-Type": "application/json" };
  switch (body.action) {
    case "read": {
      const n = body.count === undefined ? 1 : body.count;
      if (!Number.isInteger(n) || n < 1 || n > 1000) return bad("count must be a whole number from 1 to 1000");
      // At most one of `before`/`after` (epoch ms): `before` pages backward through history
      // (backfill), `after` asks for everything newer than a known point (catching up after
      // the app was closed for a while). Neither is required for an ordinary "latest N" read.
      if (body.before !== undefined && body.after !== undefined) return bad("specify at most one of before/after");
      let find = "";
      for (const [key, op] of [["before", "$lt"], ["after", "$gte"]]) {
        const v = body[key];
        if (v === undefined) continue;
        if (!Number.isInteger(v) || v < 0 || v > 4102444800000) return bad(`${key} must be a whole-number timestamp (ms)`); // sanity bound: year 2100
        find = `&find[date][${op}]=${v}`;
      }
      return { ok: true, url: `${base}/api/v1/entries.json?count=${n}${find}&token=${t}`, init: { method: "GET" } };
    }
    case "create":
    case "update": {
      const tr = body.treatment;
      if (!tr || typeof tr !== "object" || Array.isArray(tr)) return bad("treatment must be an object");
      const text = JSON.stringify(tr);
      if (text.length > MAX_TREATMENT_BYTES) return bad("treatment is too large");
      if (typeof tr.eventType !== "string" || !EVENT_TYPES.includes(tr.eventType)) return bad("unsupported eventType");
      if (body.action === "update" && (typeof tr._id !== "string" || !/^[A-Za-z0-9_-]{6,64}$/.test(tr._id))) return bad("update needs a valid _id");
      return { ok: true, url: `${base}/api/v1/treatments?token=${t}`, init: { method: body.action === "create" ? "POST" : "PUT", headers: json, body: text } };
    }
    case "delete": {
      if (typeof body.id !== "string" || !/^[A-Za-z0-9_-]{6,64}$/.test(body.id)) return bad("id is missing or malformed");
      return { ok: true, url: `${base}/api/v1/treatments/${encodeURIComponent(body.id)}?token=${t}`, init: { method: "DELETE" } };
    }
    default:
      return bad("unknown action");
  }
}

function corsHeaders(req: Request, env: ProxyEnv): Record<string, string> {
  const origin = req.headers.get("Origin");
  const h: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin"
  };
  if (env.appOrigins.length === 0) h["Access-Control-Allow-Origin"] = "*";
  else if (origin && env.appOrigins.includes(origin)) h["Access-Control-Allow-Origin"] = origin;
  return h;
}

export async function handle(req: Request, env: ProxyEnv, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const cors = corsHeaders(req, env);
  const reply = (payload: unknown, status = 200) =>
    new Response(JSON.stringify(payload), { status, headers: { ...cors, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return reply({ ok: false, code: "BAD_REQUEST", error: "Use POST" }, 405);

  const origin = req.headers.get("Origin");
  if (env.appOrigins.length > 0 && origin && !env.appOrigins.includes(origin)) return reply({ ok: false, code: "ORIGIN_NOT_ALLOWED", error: "This origin isn't allowed" }, 403);

  let body: any;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) return reply(bad("request body is too large"));
    body = JSON.parse(text);
  } catch { return reply(bad("request body must be JSON")); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return reply(bad("request body must be a JSON object"));
  if (!ACTIONS.includes(body.action)) return reply(bad("unknown action"));

  const b = validateBaseUrl(body.baseUrl, env);
  if (!b.ok) return reply(b);
  const up = buildUpstream(body, b.base);
  if (!up.ok) return reply(up);

  const started = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const res = await fetchImpl(up.url, { ...up.init, redirect: "manual", signal: ctl.signal, headers: { Accept: "application/json", ...(up.init.headers || {}) } });
    const log = (status: number) => console.log(JSON.stringify({ action: body.action, host: b.host, status, ms: Date.now() - started }));
    if (res.status >= 300 && res.status < 400) { log(res.status); return reply({ ok: false, code: "UPSTREAM_HTTP", status: res.status, error: `Nightscout redirected the request (HTTP ${res.status}); redirects aren't followed. Check the URL.` }); }
    if (!res.ok) { log(res.status); return reply({ ok: false, code: "UPSTREAM_HTTP", status: res.status, error: `Nightscout responded with HTTP ${res.status}` }); }
    const declared = Number(res.headers.get("content-length") || 0);
    if (declared > MAX_RESPONSE_BYTES) { log(res.status); return reply({ ok: false, code: "UPSTREAM_TOO_LARGE", error: "Nightscout's response was too large" }); }
    const text = await res.text();
    if (text.length > MAX_RESPONSE_BYTES) { log(res.status); return reply({ ok: false, code: "UPSTREAM_TOO_LARGE", error: "Nightscout's response was too large" }); }
    let parsed: unknown = text;
    try { parsed = JSON.parse(text); } catch { /* keep raw text */ }
    log(res.status);
    return reply({ ok: true, status: res.status, body: parsed });
  } catch (e) {
    console.log(JSON.stringify({ action: body.action, host: b.host, error: "network", ms: Date.now() - started }));
    return reply({ ok: false, code: "UPSTREAM_NETWORK", error: (e as Error)?.name === "AbortError" ? "Nightscout took too long to respond" : "Couldn't reach Nightscout" });
  } finally {
    clearTimeout(timer);
  }
}

// Tests import this file without starting a server.
if (typeof Deno !== "undefined" && Deno.serve && !(globalThis as any).__NS_PROXY_TEST__) {
  Deno.serve((req: Request) => handle(req, readEnv(k => Deno.env.get(k))));
}
