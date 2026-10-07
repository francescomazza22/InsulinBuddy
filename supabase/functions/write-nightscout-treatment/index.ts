// Supabase Edge Function: write-nightscout-treatment
//
// Proxies a single POST to a user's own Nightscout instance
// (POST /api/v1/treatments) from Deno (server-side), for the same reason
// as fetch-nightscout-glucose: CORS is a browser-only restriction, so a
// server-to-server call like this one sidesteps it entirely, even when
// the Nightscout instance itself has no CORS headers configured.
//
// The caller sends its own Nightscout base URL, token, and the treatment
// payload (carbs/insulin/glucose/etc, already built by the app) in the
// request body -- nothing is hardcoded or stored server-side. Deployed
// with default JWT verification, so only a signed-in user of this
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

  let body: { baseUrl?: string; token?: string; treatment?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Request body must be JSON." }, 400);
  }

  const { baseUrl, token, treatment } = body;
  if (!baseUrl || !token || !treatment || typeof treatment !== "object") {
    return jsonResponse({ error: "Missing baseUrl, token, or treatment." }, 400);
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

  const nsUrl = `${baseUrl.replace(/\/+$/, "")}/api/v1/treatments?token=${encodeURIComponent(token)}`;

  try {
    const nsRes = await fetch(nsUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(treatment),
    });
    const rawText = await nsRes.text();
    let parsedBody: unknown = rawText;
    try { parsedBody = JSON.parse(rawText); } catch { /* leave as raw text */ }

    if (!nsRes.ok) {
      return jsonResponse(
        { error: `Nightscout responded with HTTP ${nsRes.status}`, status: nsRes.status, body: parsedBody },
        502
      );
    }
    return jsonResponse({ ok: true, status: nsRes.status, body: parsedBody });
  } catch (e) {
    return jsonResponse({ error: `Could not reach Nightscout: ${String(e)}` }, 502);
  }
});
