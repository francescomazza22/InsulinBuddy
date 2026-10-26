import test from "node:test";
import assert from "node:assert/strict";

globalThis.__HEALTH_WEBHOOK_TEST__ = true;
const { handle, readEnv, toPayload, MAX_BODY_BYTES, RETENTION_DAYS } = await import("../../supabase/functions/health-webhook/index.ts");

const ENV = { token: "hook-secret-123", userId: "user-abc", supabaseUrl: "https://proj.supabase.co", serviceRoleKey: "srk" };
const NOW = Date.UTC(2026, 9, 26, 9, 0, 0);

function post(body, auth = "Bearer hook-secret-123", extra = {}) {
  const headers = { "Content-Type": "application/json", ...extra };
  if (auth) headers.Authorization = auth;
  return new Request("https://x/health-webhook", { method: "POST", headers, body });
}
function recorder(insertStatus = 201) {
  const calls = [];
  const f = async (url, init) => { calls.push({ url, init }); return new Response(null, { status: init.method === "POST" ? insertStatus : 204 }); };
  return { f, calls };
}

test("readEnv reads the webhook token and reuses the export user id", () => {
  const env = readEnv(k => ({ HEALTH_WEBHOOK_TOKEN: "t", HEALTH_EXPORT_USER_ID: "u", SUPABASE_URL: "s", SUPABASE_SERVICE_ROLE_KEY: "k" })[k]);
  assert.deepEqual(env, { token: "t", userId: "u", supabaseUrl: "s", serviceRoleKey: "k" });
});

test("refuses a wrong, missing or non-Bearer token and stores nothing", async () => {
  for (const auth of ["Bearer nope", null, "hook-secret-123"]) {
    const { f, calls } = recorder();
    const res = await handle(post("{}", auth), ENV, f, NOW);
    assert.equal(res.status, 401);
    assert.equal(calls.length, 0);
  }
});

test("only POST is accepted; missing secrets give a clear 500", async () => {
  const { f } = recorder();
  assert.equal((await handle(new Request("https://x/health-webhook"), ENV, f, NOW)).status, 405);
  assert.equal((await handle(post("{}"), { ...ENV, token: null }, f, NOW)).status, 500);
});

test("stores the delivery untouched for the configured user, then removes rows older than the retention", async () => {
  const body = JSON.stringify({ workouts: [{ type: "Cycling", duration: 1800 }] });
  const { f, calls } = recorder();
  const res = await handle(post(body), ENV, f, NOW);
  assert.equal(res.status, 200);
  assert.equal(calls[0].url, "https://proj.supabase.co/rest/v1/health_inbox");
  assert.equal(calls[0].init.method, "POST");
  const row = JSON.parse(calls[0].init.body);
  assert.equal(row.user_id, "user-abc");
  assert.deepEqual(row.payload, JSON.parse(body));
  assert.equal(row.bytes, body.length);
  assert.equal(calls[1].init.method, "DELETE");
  const cutoff = new Date(NOW - RETENTION_DAYS * 86_400_000).toISOString();
  assert.ok(calls[1].url.includes("user_id=eq.user-abc"));
  assert.ok(decodeURIComponent(calls[1].url).includes(`received_at=lt.${cutoff}`));
});

test("a failed database write is reported to the sender (so it retries), never as received", async () => {
  const { f, calls } = recorder(500);
  const res = await handle(post("{}"), ENV, f, NOW);
  assert.equal(res.status, 502);
  assert.equal(calls.length, 1); // no clean-up after a failed store
  const down = async () => { throw new Error("network down with secret details"); };
  const res2 = await handle(post("{}"), ENV, down, NOW);
  assert.equal(res2.status, 502);
  assert.ok(!(await res2.text()).includes("secret"));
});

test("a failed clean-up doesn't fail a delivery that was stored", async () => {
  let n = 0;
  const f = async () => { if (n++ === 0) return new Response(null, { status: 201 }); throw new Error("x"); };
  assert.equal((await handle(post("{}"), ENV, f, NOW)).status, 200);
});

test("oversized deliveries are refused", async () => {
  const { f, calls } = recorder();
  const res = await handle(post("{}", undefined, { "Content-Length": String(MAX_BODY_BYTES + 1) }), ENV, f, NOW);
  assert.equal(res.status, 413);
  const big = "x".repeat(MAX_BODY_BYTES + 1);
  assert.equal((await handle(post(big), ENV, f, NOW)).status, 413);
  assert.equal(calls.length, 0);
});

test("non-JSON and empty bodies are still kept, so we can see what was sent", () => {
  assert.deepEqual(toPayload("ping"), { _raw: "ping" });
  assert.deepEqual(toPayload("  "), { _empty: true });
  assert.deepEqual(toPayload('{"a":1}'), { a: 1 });
});
