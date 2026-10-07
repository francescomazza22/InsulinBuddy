import test from "node:test";
import assert from "node:assert/strict";

globalThis.__NS_PROXY_TEST__ = true;                       // import without starting a server
const proxy = await import("../../supabase/functions/nightscout-proxy/index.ts");
const { handle, validateBaseUrl, blockedHostReason, hostAllowed, readEnv } = proxy;

const ENV = { allowedHosts: [], allowHttp: false, appOrigins: [] };
const TOKEN = "tok-abcdef-123456";
const good = { action: "read", baseUrl: "https://f1b1.ns.gluroo.com", token: TOKEN };

function post(body, headers = {}) {
  return new Request("https://proxy.example/functions/v1/nightscout-proxy", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
}
function spyFetch(responder) {
  const calls = [];
  const f = async (url, init) => { calls.push({ url, init }); return responder ? responder(url, init) : new Response(JSON.stringify([{ sgv: 111 }]), { status: 200 }); };
  f.calls = calls; return f;
}
const run = async (body, { env = ENV, f = spyFetch(), headers } = {}) => {
  const res = await handle(post(body, headers), env, f);
  return { res, json: res.status === 204 ? null : await res.json(), f };
};

// ---------------------------------------------------------- host safety
test("blocks IPs, localhost, internal and single-label hostnames", () => {
  for (const h of ["127.0.0.1", "10.0.0.5", "169.254.169.254", "192.168.1.1", "[::1]", "localhost", "a.localhost", "printer.local", "metadata.google.internal", "intranet", "nas.lan", "x.home.arpa"]) {
    assert.ok(blockedHostReason(h), `${h} should be blocked`);
  }
  assert.equal(blockedHostReason("f1b1.ns.gluroo.com"), null);
  assert.equal(blockedHostReason("my.nightscout.io"), null);
});

test("URL tricks that resolve to internal addresses are refused", () => {
  for (const raw of ["https://127.0.0.1", "https://2130706433", "https://0x7f000001", "https://[::1]", "https://[::ffff:127.0.0.1]",
    "https://169.254.169.254/latest/meta-data", "https://localhost", "https://user:pw@f1b1.ns.gluroo.com", "https://f1b1.ns.gluroo.com:8443", "ftp://f1b1.ns.gluroo.com", "http://f1b1.ns.gluroo.com", "javascript:alert(1)", "not a url", ""]) {
    const r = validateBaseUrl(raw, ENV);
    assert.equal(r.ok, false, `${raw} should be refused`);
  }
});

test("normal Nightscout URLs pass and are normalised", () => {
  assert.deepEqual(validateBaseUrl("https://f1b1.ns.gluroo.com/", ENV), { ok: true, base: "https://f1b1.ns.gluroo.com", host: "f1b1.ns.gluroo.com" });
  assert.equal(validateBaseUrl("https://my.site.io/nightscout///", ENV).base, "https://my.site.io/nightscout");
  assert.equal(validateBaseUrl("https://f1b1.ns.gluroo.com:443/", ENV).ok, true);
  assert.equal(validateBaseUrl("https://f1b1.ns.gluroo.com/?token=x", ENV).ok, false, "token belongs in the token field");
});

test("the allowlist is exact and wildcards only match real subdomains", () => {
  const env = { ...ENV, allowedHosts: ["*.ns.gluroo.com", "my.site.io"] };
  assert.equal(validateBaseUrl("https://f1b1.ns.gluroo.com", env).ok, true);
  assert.equal(validateBaseUrl("https://my.site.io", env).ok, true);
  for (const evil of ["https://evil.com", "https://ns.gluroo.com", "https://gluroo.com.evil.com", "https://f1b1.ns.gluroo.com.evil.com", "https://xns.gluroo.com", "https://other.site.io"]) {
    assert.equal(validateBaseUrl(evil, env).ok, false, evil);
  }
  assert.equal(hostAllowed("a.b.ns.gluroo.com", ["*.ns.gluroo.com"]), true);
  assert.equal(validateBaseUrl("https://f1b1.ns.gluroo.com:8443", env).ok, true, "explicit allowlist may use custom ports");
});

test("http is refused unless explicitly enabled", () => {
  assert.equal(validateBaseUrl("http://my.site.io", ENV).ok, false);
  assert.equal(validateBaseUrl("http://my.site.io", { ...ENV, allowHttp: true }).ok, true);
});

test("readEnv parses secrets", () => {
  const env = readEnv(k => ({ NS_ALLOWED_HOSTS: " *.A.com , b.org ", NS_ALLOW_HTTP: "1", APP_ORIGINS: "https://x.github.io" })[k]);
  assert.deepEqual(env, { allowedHosts: ["*.a.com", "b.org"], allowHttp: true, appOrigins: ["https://x.github.io"] });
  assert.deepEqual(readEnv(() => undefined), { allowedHosts: [], allowHttp: false, appOrigins: [] });
});

// ------------------------------------------------------------- actions
test("read: GET entries with a clamped count", async () => {
  const { json, f } = await run({ ...good, count: 5 });
  assert.equal(json.ok, true); assert.deepEqual(json.body, [{ sgv: 111 }]);
  assert.equal(f.calls[0].url, `https://f1b1.ns.gluroo.com/api/v1/entries.json?count=5&token=${TOKEN}`);
  assert.equal(f.calls[0].init.method, "GET");
  assert.equal(f.calls[0].init.redirect, "manual");
  for (const count of [0, -1, 1001, 1.5, "5", null]) assert.equal((await run({ ...good, count })).json.code, "BAD_REQUEST", `count ${count}`);
});

test("create / update send the treatment; update needs a valid _id", async () => {
  const t = { eventType: "Meal Bolus", carbs: 40, insulin: 4, created_at: "2026-09-28T12:00:00.000Z" };
  let r = await run({ action: "create", baseUrl: good.baseUrl, token: TOKEN, treatment: t }, { f: spyFetch(() => new Response(JSON.stringify({ _id: "new1234" }), { status: 200 })) });
  assert.equal(r.json.ok, true); assert.equal(r.json.body._id, "new1234");
  assert.equal(r.f.calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(r.f.calls[0].init.body), t);
  r = await run({ action: "update", baseUrl: good.baseUrl, token: TOKEN, treatment: { ...t, _id: "abc123XYZ" } });
  assert.equal(r.f.calls[0].init.method, "PUT");
  for (const _id of [undefined, "", "../x", "a b", "x".repeat(65), "short"]) {
    assert.equal((await run({ action: "update", baseUrl: good.baseUrl, token: TOKEN, treatment: { ...t, _id } })).json.code, "BAD_REQUEST", `_id ${_id}`);
  }
});

test("delete: id goes in the path, encoded and validated", async () => {
  const r = await run({ action: "delete", baseUrl: good.baseUrl, token: TOKEN, id: "abc123XYZ" });
  assert.equal(r.f.calls[0].url, `https://f1b1.ns.gluroo.com/api/v1/treatments/abc123XYZ?token=${TOKEN}`);
  assert.equal(r.f.calls[0].init.method, "DELETE");
  for (const id of ["../../admin", "a/b", "a?b=1", "", "x", undefined, 123]) {
    const x = await run({ action: "delete", baseUrl: good.baseUrl, token: TOKEN, id });
    assert.equal(x.json.code, "BAD_REQUEST", `id ${id}`); assert.equal(x.f.calls.length, 0);
  }
});

test("only the app's event types, objects, and reasonable sizes are accepted", async () => {
  const base = { action: "create", baseUrl: good.baseUrl, token: TOKEN };
  assert.equal((await run({ ...base, treatment: { eventType: "Site Change" } })).json.code, "BAD_REQUEST");
  assert.equal((await run({ ...base, treatment: [] })).json.code, "BAD_REQUEST");
  assert.equal((await run({ ...base, treatment: "x" })).json.code, "BAD_REQUEST");
  assert.equal((await run({ ...base, treatment: { eventType: "Note", notes: "x".repeat(9000) } })).json.code, "BAD_REQUEST");
  assert.equal((await run({ ...base })).json.code, "BAD_REQUEST");
});

test("token must be present and URL-safe (no injection into the upstream URL)", async () => {
  for (const token of [undefined, "", "abc", "a b c d e f", "x&admin=1", "tok/../x", "tok?x=1", "x".repeat(300)]) {
    const r = await run({ ...good, token });
    assert.equal(r.json.code, "BAD_REQUEST", `token ${token}`); assert.equal(r.f.calls.length, 0);
  }
});

test("bad requests never reach the network", async () => {
  for (const body of [null, [], "str", {}, { action: "nuke" }, { ...good, action: undefined }, { ...good, baseUrl: "https://127.0.0.1" }]) {
    const r = await run(body);
    assert.equal(r.json.ok, false); assert.equal(r.f.calls.length, 0);
  }
  const notJson = await handle(new Request("https://p/", { method: "POST", body: "{nope" }), ENV, spyFetch());
  assert.equal((await notJson.json()).code, "BAD_REQUEST");
  const huge = await run({ ...good, pad: "x".repeat(25000) });
  assert.equal(huge.json.code, "BAD_REQUEST");
});

// ------------------------------------------------------ upstream failures
test("upstream HTTP errors, redirects, network failures and timeouts are reported distinctly", async () => {
  let r = await run(good, { f: spyFetch(() => new Response("nope", { status: 401 })) });
  assert.deepEqual([r.json.ok, r.json.code, r.json.status], [false, "UPSTREAM_HTTP", 401]);
  r = await run(good, { f: spyFetch(() => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/" } })) });
  assert.equal(r.json.code, "UPSTREAM_HTTP"); assert.equal(r.json.status, 302);
  assert.equal(r.f.calls.length, 1, "redirect not followed");
  r = await run(good, { f: spyFetch(() => { throw new TypeError("connect ECONNREFUSED"); }) });
  assert.equal(r.json.code, "UPSTREAM_NETWORK");
  r = await run(good, { f: spyFetch(() => { const e = new Error("aborted"); e.name = "AbortError"; throw e; }) });
  assert.match(r.json.error, /too long/);
});

test("oversized upstream responses are refused", async () => {
  const big = "x".repeat(2_100_000);
  let r = await run(good, { f: spyFetch(() => new Response(big, { status: 200 })) });
  assert.equal(r.json.code, "UPSTREAM_TOO_LARGE");
  r = await run(good, { f: spyFetch(() => new Response("[]", { status: 200, headers: { "content-length": "9999999" } })) });
  assert.equal(r.json.code, "UPSTREAM_TOO_LARGE");
});

test("non-JSON upstream bodies are passed through as text", async () => {
  const r = await run(good, { f: spyFetch(() => new Response("OK", { status: 200 })) });
  assert.equal(r.json.ok, true); assert.equal(r.json.body, "OK");
});

test("the token is never echoed back in any response", async () => {
  const outs = [];
  outs.push(JSON.stringify((await run(good, { f: spyFetch(() => { throw new Error(`boom ${TOKEN}`); }) })).json));
  outs.push(JSON.stringify((await run(good, { f: spyFetch(() => new Response("x", { status: 500 })) })).json));
  outs.push(JSON.stringify((await run({ ...good, baseUrl: "https://127.0.0.1" })).json));
  assert.ok(outs.every(o => !o.includes(TOKEN)));
});

// ---------------------------------------------------------- method + CORS
test("only POST is served; OPTIONS answers the CORS preflight", async () => {
  const get = await handle(new Request("https://p/", { method: "GET" }), ENV, spyFetch());
  assert.equal(get.status, 405);
  const pre = await handle(new Request("https://p/", { method: "OPTIONS", headers: { Origin: "https://a.io" } }), ENV, spyFetch());
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get("access-control-allow-origin"), "*");
});

test("with APP_ORIGINS set, other origins are rejected and only the app origin is echoed", async () => {
  const env = { ...ENV, appOrigins: ["https://francescomazza22.github.io"] };
  const ok = await run(good, { env, headers: { Origin: "https://francescomazza22.github.io" } });
  assert.equal(ok.res.headers.get("access-control-allow-origin"), "https://francescomazza22.github.io");
  assert.equal(ok.json.ok, true);
  const evil = await run(good, { env, headers: { Origin: "https://evil.example" } });
  assert.equal(evil.res.status, 403); assert.equal(evil.json.code, "ORIGIN_NOT_ALLOWED"); assert.equal(evil.f.calls.length, 0);
});

// ------------------------------------------------------ date-bounded reads
test("read: before/after add a date filter for pagination, at most one at a time", async () => {
  let r = await run({ ...good, count: 500, before: 1735689600000 });
  assert.equal(r.json.ok, true);
  assert.ok(r.f.calls[0].url.includes("find%5Bdate%5D%5B%24lt%5D=1735689600000") || r.f.calls[0].url.includes("find[date][$lt]=1735689600000"), r.f.calls[0].url);

  r = await run({ ...good, count: 500, after: 1735689600000 });
  assert.ok(r.f.calls[0].url.includes("%24gte") || r.f.calls[0].url.includes("$gte"), r.f.calls[0].url);

  r = await run({ ...good, before: 1735689600000, after: 1735689600000 });
  assert.equal(r.json.code, "BAD_REQUEST", "can't specify both");

  for (const bad of [-1, 1.5, "123", 99999999999999]) {
    assert.equal((await run({ ...good, before: bad })).json.code, "BAD_REQUEST", `before ${bad}`);
  }
});

test("read: an ordinary count-only read has no date filter in the URL", async () => {
  const r = await run({ ...good, count: 10 });
  assert.ok(!r.f.calls[0].url.includes("find"), r.f.calls[0].url);
});
