// Supabase Edge Function: fetch-nightscout-glucose
//
// Proxies a single request to a user's own Nightscout instance
// (GET /api/v1/entries.json?count=1) from Deno (server-side), so the
// browser never talks to Nightscout directly. This is the whole point:
// CORS is a browser-only restriction, so it simply doesn't apply to a
// server-to-server call like this one, even when the Nightscout instance
// itself has no CORS headers configured.
//
// The caller (the app, running in the browser) sends its own Nightscout
// base URL and token in the request body — nothing is hardcoded here and
// nothing is stored server-side. Deployed with default JWT verification
// (the Supabase project's default), so only a signed-in user of this
// project can invoke it.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let body: { baseUrl?: string; token?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Request body must be JSON." }, 400);
  }

  const { baseUrl, token } = body;
  if (!baseUrl || !token) {
    return jsonResponse({ error: "Missing baseUrl or token." }, 400);
  }

  // Basic sanity check so this can't be used as an open proxy to arbitrary URLs.
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return jsonResponse({ error: "baseUrl is not a valid URL." }, 400);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return jsonResponse({ error: "baseUrl must be http(s)." }, 400);
  }

  const nsUrl = `${baseUrl.replace(/\/+$/, "")}/api/v1/entries.json?count=1&token=${encodeURIComponent(token)}`;

  try {
    const nsRes = await fetch(nsUrl, { headers: { Accept: "application/json" } });
    if (!nsRes.ok) {
      return jsonResponse(
        { error: `Nightscout responded with HTTP ${nsRes.status}`, status: nsRes.status },
        502
      );
    }
    const data = await nsRes.json();
    return jsonResponse({ entries: data });
  } catch (e) {
    return jsonResponse({ error: `Could not reach Nightscout: ${String(e)}` }, 502);
  }
});
