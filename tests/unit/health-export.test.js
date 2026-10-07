import test from "node:test";
import assert from "node:assert/strict";

globalThis.__HEALTH_EXPORT_TEST__ = true;
const mod = await import("../../supabase/functions/health-export/index.ts");
const { handle, extractToken, tokensMatch, parseSince, flattenHistoryEntries, readEnv } = mod;

const ENV = { token: "secret-token-123", userId: "user-abc", supabaseUrl: "https://proj.supabase.co", serviceRoleKey: "service-role-key", appOrigins: [] };
const NOW = Date.UTC(2026, 9, 1, 12, 0, 0);
const hoursAgo = h => NOW - h * 3_600_000;

function meal(ts, over = {}) {
  return { ts, mealDose: 0, correctionDose: 0, totalCarbs: 0, items: [{ name: "Pasta" }], ...over };
}

// ----------------------------------------------------------------- tokensMatch
test("tokensMatch: equal strings match, everything else doesn't", () => {
  assert.equal(tokensMatch("abc123", "abc123"), true);
  assert.equal(tokensMatch("abc123", "abc124"), false);
  assert.equal(tokensMatch("abc", "abcd"), false);
  assert.equal(tokensMatch(null, "abc"), false);
  assert.equal(tokensMatch("abc", null), false);
  assert.equal(tokensMatch(null, null), false);
  assert.equal(tokensMatch("", ""), false); // empty token should never "match" an empty requirement
});

// ----------------------------------------------------------------- extractToken
test("extractToken: reads from the Authorization header or a ?token= param", () => {
  const withHeader = new Request("https://x/health-export", { headers: { Authorization: "Bearer abc123" } });
  assert.equal(extractToken(withHeader, new URL(withHeader.url)), "abc123");
  const withQuery = new Request("https://x/health-export?token=xyz789");
  assert.equal(extractToken(withQuery, new URL(withQuery.url)), "xyz789");
  const withNeither = new Request("https://x/health-export");
  assert.equal(extractToken(withNeither, new URL(withNeither.url)), null);
  const malformed = new Request("https://x/health-export", { headers: { Authorization: "abc123" } }); // missing "Bearer "
  assert.equal(extractToken(malformed, new URL(malformed.url)), null);
});

// ----------------------------------------------------------------- parseSince
test("parseSince: defaults to the last 24 hours when omitted", () => {
  const r = parseSince(null, NOW);
  assert.equal(r.ok, true);
  assert.equal(r.sinceMs, hoursAgo(24));
});
test("parseSince: accepts a valid ISO date", () => {
  const r = parseSince("2026-09-28T00:00:00Z", NOW);
  assert.equal(r.ok, true);
  assert.equal(r.sinceMs, Date.parse("2026-09-28T00:00:00Z"));
});
test("parseSince: rejects garbage and future dates", () => {
  assert.equal(parseSince("not-a-date", NOW).ok, false);
  assert.equal(parseSince("2099-01-01T00:00:00Z", NOW).ok, false);
});
test("parseSince: caps the lookback at 30 days even if an older date is requested", () => {
  const tooOld = new Date(NOW - 90 * 86_400_000).toISOString();
  const r = parseSince(tooOld, NOW);
  assert.equal(r.ok, true);
  assert.equal(r.sinceMs, NOW - 30 * 86_400_000);
});

// ----------------------------------------------------------------- flattenHistoryEntries
test("flattenHistoryEntries: a normal meal becomes carbs + meal insulin + correction, each labeled with the food", () => {
  const out = flattenHistoryEntries([meal(hoursAgo(1), { mealDose: 4, correctionDose: 0.5, totalCarbs: 60 })], hoursAgo(24));
  assert.equal(out.length, 3);
  assert.deepEqual(out.map(e => e.type).sort(), ["carbs", "correctionInsulin", "mealInsulin"]);
  assert.ok(out.every(e => e.label === "Pasta"));
  assert.equal(out.find(e => e.type === "carbs").value, 60);
  assert.equal(out.find(e => e.type === "mealInsulin").value, 4);
  assert.equal(out.find(e => e.type === "correctionInsulin").value, 0.5);
});

test("flattenHistoryEntries: zero/absent quantities are omitted, not emitted as zero", () => {
  const out = flattenHistoryEntries([meal(hoursAgo(1), { mealDose: 0, correctionDose: 0, totalCarbs: 45 })], hoursAgo(24));
  assert.equal(out.length, 1);
  assert.equal(out[0].type, "carbs");
});

test("flattenHistoryEntries: a 'treating a low' entry gets its own label and only a carbs entry", () => {
  const out = flattenHistoryEntries([meal(hoursAgo(1), { totalCarbs: 20, items: [], noInsulin: true })], hoursAgo(24));
  assert.equal(out.length, 1);
  assert.equal(out[0].type, "carbs");
  assert.equal(out[0].label, "Treating a low");
});

test("flattenHistoryEntries: a correction-only entry (no food) is labeled 'Correction'", () => {
  const out = flattenHistoryEntries([meal(hoursAgo(1), { items: [], totalCarbs: 0, correctionDose: 2 })], hoursAgo(24));
  assert.equal(out.length, 1);
  assert.equal(out[0].type, "correctionInsulin");
  assert.equal(out[0].label, "Correction");
});

test("flattenHistoryEntries: multiple food items join into one label", () => {
  const out = flattenHistoryEntries([meal(hoursAgo(1), { totalCarbs: 50, mealDose: 3, items: [{ name: "Pasta" }, { name: "Salad" }] })], hoursAgo(24));
  assert.equal(out[0].label, "Pasta, Salad");
});

test("flattenHistoryEntries: entries older than `since` are excluded", () => {
  const out = flattenHistoryEntries([meal(hoursAgo(48), { totalCarbs: 60 }), meal(hoursAgo(1), { totalCarbs: 30 })], hoursAgo(24));
  assert.equal(out.length, 1);
  assert.equal(out[0].value, 30);
});

test("flattenHistoryEntries: results are sorted oldest-first regardless of input order", () => {
  const out = flattenHistoryEntries([meal(hoursAgo(1), { totalCarbs: 10 }), meal(hoursAgo(5), { totalCarbs: 20 }), meal(hoursAgo(3), { totalCarbs: 30 })], hoursAgo(24));
  assert.deepEqual(out.map(e => e.value), [20, 30, 10]);
});

test("flattenHistoryEntries: tolerates malformed/missing entries gracefully", () => {
  assert.deepEqual(flattenHistoryEntries([null, undefined, {}, { ts: "not-a-number", totalCarbs: 5 }], hoursAgo(24)), []);
  assert.deepEqual(flattenHistoryEntries(null, hoursAgo(24)), []);
  assert.deepEqual(flattenHistoryEntries(undefined, hoursAgo(24)), []);
});

// ----------------------------------------------------------------- readEnv
test("readEnv reads all the expected secrets", () => {
  const env = readEnv(k => ({ HEALTH_EXPORT_TOKEN: "t", HEALTH_EXPORT_USER_ID: "u", SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "srk", APP_ORIGINS: "https://a.io, https://b.io" }[k]));
  assert.deepEqual(env, { token: "t", userId: "u", supabaseUrl: "https://x.supabase.co", serviceRoleKey: "srk", appOrigins: ["https://a.io", "https://b.io"] });
  assert.deepEqual(readEnv(() => undefined), { token: null, userId: null, supabaseUrl: null, serviceRoleKey: null, appOrigins: [] });
});

// ----------------------------------------------------------------- handle() end-to-end
const fakeRow = (data) => async () => new Response(JSON.stringify([{ data }]), { status: 200 });
function req(path, headers = {}) { return new Request(`https://proxy.example/functions/v1/health-export${path}`, { headers }); }

test("handle: rejects without a valid token, accepts via header or query param", async () => {
  const fetchImpl = fakeRow({ history: [meal(hoursAgo(1), { totalCarbs: 10 })] });
  let res = await handle(req(""), ENV, fetchImpl);
  assert.equal(res.status, 401);
  res = await handle(req("", { Authorization: "Bearer wrong" }), ENV, fetchImpl);
  assert.equal(res.status, 401);
  res = await handle(req("", { Authorization: "Bearer secret-token-123" }), ENV, fetchImpl);
  assert.equal(res.status, 200);
  res = await handle(req("?token=secret-token-123"), ENV, fetchImpl);
  assert.equal(res.status, 200);
});

test("handle: returns flattened entries for a normal request", async () => {
  // Pass an explicit `since` rather than relying on the endpoint's real-wall-clock "last 24h"
  // default against a fixed test timestamp -- that combination only works until enough real
  // calendar days pass, which is exactly the bug this replacement avoids.
  const fetchImpl = fakeRow({ history: [meal(hoursAgo(1), { mealDose: 3, totalCarbs: 45 })] });
  const res = await handle(req(`?since=${encodeURIComponent(new Date(hoursAgo(2)).toISOString())}`, { Authorization: "Bearer secret-token-123" }), ENV, fetchImpl);
  const body = await res.json();
  assert.equal(body.entries.length, 2);
});

test("handle: no row yet -> empty entries, not an error", async () => {
  const fetchImpl = async () => new Response(JSON.stringify([]), { status: 200 });
  const res = await handle(req("", { Authorization: "Bearer secret-token-123" }), ENV, fetchImpl);
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).entries, []);
});

test("handle: passphrase-encrypted data is refused with a clear, actionable message", async () => {
  const fetchImpl = fakeRow({ iv: "abc", data: "ciphertext" });
  const res = await handle(req("", { Authorization: "Bearer secret-token-123" }), ENV, fetchImpl);
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /passphrase/i);
});

test("handle: rejects a bad `since` value", async () => {
  const fetchImpl = fakeRow({ history: [] });
  const res = await handle(req("?since=garbage", { Authorization: "Bearer secret-token-123" }), ENV, fetchImpl);
  assert.equal(res.status, 400);
});

test("handle: upstream failure is reported, not silently swallowed", async () => {
  const fetchImpl = async () => new Response("", { status: 500 });
  const res = await handle(req("", { Authorization: "Bearer secret-token-123" }), ENV, fetchImpl);
  assert.equal(res.status, 502);
});

test("handle: refuses to run at all if not fully configured", async () => {
  const half = { ...ENV, userId: null };
  const res = await handle(req("", { Authorization: "Bearer secret-token-123" }), half, async () => new Response("{}"));
  assert.equal(res.status, 500);
});

test("handle: only GET and OPTIONS are served", async () => {
  const post = new Request("https://x/health-export", { method: "POST" });
  assert.equal((await handle(post, ENV, fakeRow({ history: [] }))).status, 405);
  const opt = new Request("https://x/health-export", { method: "OPTIONS" });
  assert.equal((await handle(opt, ENV, fakeRow({ history: [] }))).status, 204);
});

test("handle: a thrown network error returns a clean 502, not a crash, and never echoes the token", async () => {
  const fetchImpl = async () => { throw new Error(`network down, token was ${ENV.token}`); };
  const res = await handle(req("", { Authorization: "Bearer secret-token-123" }), ENV, fetchImpl);
  assert.equal(res.status, 502);
  const text = await res.text();
  assert.ok(!text.includes(ENV.token));
});

// ----------------------------------------------------------------- basal (opt-in)
// A Shortcut written before basal existed has no branch for the new "basalInsulin" type, and could file
// it into Health as a bolus. So basal must only be sent when the caller explicitly asks for it.
const basalRow = (ts, units, slot, over = {}) => ({
  ts, entryType: "basal", mealType: "basal", basalDose: units, basalSlot: slot,
  items: [], totalCarbs: 0, mealDose: 0, correctionDose: 0, noInsulin: false, ...over
});
const SINCE = hoursAgo(48);

test("basal: NOT exported by default, so an existing Shortcut can never misfile it", () => {
  const history = [basalRow(hoursAgo(2), 14, "am"), meal(hoursAgo(3), { mealDose: 4, totalCarbs: 50 })];
  const types = flattenHistoryEntries(history, SINCE).map(e => e.type);
  assert.deepEqual(types.sort(), ["carbs", "mealInsulin"]);
  assert.deepEqual(flattenHistoryEntries([basalRow(hoursAgo(2), 14, "am")], SINCE), []);
  assert.deepEqual(flattenHistoryEntries([basalRow(hoursAgo(2), 14, "am")], SINCE, { includeBasal: false }), []);
});

test("basal: exported as type basalInsulin only when asked, with a label for the slot", () => {
  const out = flattenHistoryEntries([basalRow(hoursAgo(2), 14, "am"), basalRow(hoursAgo(14), 16.5, "pm"), basalRow(hoursAgo(26), 10, undefined)], SINCE, { includeBasal: true });
  assert.deepEqual(out.map(e => [e.type, e.value, e.label]), [
    ["basalInsulin", 10, "Basal insulin"],
    ["basalInsulin", 16.5, "Basal insulin (evening)"],
    ["basalInsulin", 14, "Basal insulin (morning)"]
  ]);
});

test("basal: a basal entry never produces a carbs / mealInsulin / correctionInsulin row, even when asked for", () => {
  const out = flattenHistoryEntries([basalRow(hoursAgo(2), 14, "am", { totalCarbs: 99, mealDose: 99, correctionDose: 99 })], SINCE, { includeBasal: true });
  assert.deepEqual(out.map(e => e.type), ["basalInsulin"], "only the basal row, whatever other fields say");
});

test("basal: zero, negative or missing doses are skipped; meals are unaffected by the option", () => {
  const history = [basalRow(hoursAgo(2), 0, "am"), basalRow(hoursAgo(3), -4, "am"), basalRow(hoursAgo(4), undefined, "am")];
  assert.deepEqual(flattenHistoryEntries(history, SINCE, { includeBasal: true }), []);
  const meals = [meal(hoursAgo(3), { mealDose: 4, totalCarbs: 50, correctionDose: 1 })];
  assert.deepEqual(flattenHistoryEntries(meals, SINCE, { includeBasal: true }), flattenHistoryEntries(meals, SINCE));
});

test("basal: sorted oldest-first together with meals, and the since filter still applies", () => {
  const history = [basalRow(hoursAgo(1), 14, "am"), meal(hoursAgo(5), { mealDose: 4 }), basalRow(hoursAgo(100), 20, "pm")];
  const out = flattenHistoryEntries(history, SINCE, { includeBasal: true });
  assert.deepEqual(out.map(e => e.type), ["mealInsulin", "basalInsulin"]);
  assert.ok(out[0].at < out[1].at);
});

test("handle: ?include=basal adds basal, the plain URL doesn't, and the token is still required", async () => {
  const fetchImpl = fakeRow({ history: [basalRow(hoursAgo(2), 14, "am"), meal(hoursAgo(3), { mealDose: 4 })] });
  const auth = { Authorization: "Bearer secret-token-123" };
  const since = `since=${encodeURIComponent(new Date(hoursAgo(10)).toISOString())}`;
  const typesFor = async q => (await (await handle(req(`?${since}${q}`, auth), ENV, fetchImpl)).json()).entries.map(e => e.type);
  assert.deepEqual(await typesFor(""), ["mealInsulin"], "default: unchanged");
  assert.deepEqual(await typesFor("&include=basal"), ["mealInsulin", "basalInsulin"]);
  assert.deepEqual(await typesFor("&include=BASAL"), ["mealInsulin", "basalInsulin"], "case-insensitive");
  assert.deepEqual(await typesFor("&include=foo,basal"), ["mealInsulin", "basalInsulin"], "unknown values are ignored");
  assert.deepEqual(await typesFor("&include=foo"), ["mealInsulin"]);
  assert.equal((await handle(req(`?${since}&include=basal`), ENV, fetchImpl)).status, 401, "asking for basal doesn't bypass auth");
});
