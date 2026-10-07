// End-to-end test harness. Zero dependencies: Node's http server, plus the
// Chrome DevTools Protocol over Node's built-in WebSocket.
//
//   const be  = createBackend();               // fake cloud + fake Nightscout, shared by devices
//   const app = await startApp(dir, be);        // serves the app + the backend on one origin
//   const dev = await openDevice(app, { ... }); // one headless Chrome "device"
//
// CHROME_PATH selects the browser (default: a Playwright chromium, then common names).

import { spawn, execSync } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json" };

export function findChrome() {
  const candidates = [process.env.CHROME_PATH, "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].filter(Boolean);
  const hit = candidates.find(p => fs.existsSync(p));
  if (!hit) throw new Error("No Chrome found. Set CHROME_PATH to a Chrome/Chromium binary.");
  return hit;
}

// -------------------------------------------------------------- fake backend
export function createBackend() {
  let clock = Date.now();
  const stamp = () => { clock = Math.max(clock + 1, Date.now()); return new Date(clock).toISOString().replace("Z", "000+00:00"); }; // Postgres-style, always increasing
  const be = {
    row: null,                       // { user_id, data, updated_at } -- the app_state table (one row per user)
    glucose: [],                     // the glucose_readings table -- many rows: { user_id, at, mgdl, direction }
    ns: { treatments: [], entries: [], nextId: 1 },
    mode: { db: "ok", ns: "ok", nsNoUpdate: false, nsNoDelete: false },
    log: [],                         // every call, for assertions
    stamp
  };
  be.reset = () => { be.row = null; be.glucose = []; be.ns = { treatments: [], entries: [], nextId: 1 }; be.mode = { db: "ok", ns: "ok", nsNoUpdate: false, nsNoDelete: false }; be.log = []; };

  function db(q) {
    be.log.push({ kind: "db", table: q.table, op: q.op, cols: q.returning || q.cols });
    if (be.mode.db === "offline") return { error: "network down" };
    const project = (row, cols) => {
      if (!row) return null;
      const c = String(cols || "*").split(",").map(s => s.trim());
      if (c.includes("*")) return { ...row };
      const out = {}; c.forEach(k => { out[k] = row[k]; }); return out;
    };

    if (q.table === "glucose_readings") {
      if (q.op === "select") {
        let rows = be.glucose.filter(r => Object.entries(q.filters || {}).every(([k, v]) => r[k] === v));
        if (q.gte) rows = rows.filter(r => r[q.gte.col] >= q.gte.val);
        if (q.countExact && q.headOnly) return { data: null, count: rows.length }; // matches real Supabase: head:true returns no rows, just the count
        if (q.orderBy) { const { col, ascending } = q.orderBy; rows = rows.slice().sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (ascending ? 1 : -1)); }
        // Real Supabase/PostgREST enforces a project-level max-rows cap that a client .limit()
        // can request FEWER rows than but never override -- getting more than the cap in one
        // response requires .range()-based pagination instead. Simulate that hard cap here so
        // a query that assumes a big .limit() alone is enough fails the same way it would
        // against a real project, instead of only surfacing once it's already shipped.
        const SERVER_MAX_ROWS = 1000;
        if (q.rangeFrom != null) {
          const sliceLen = Math.min((q.rangeTo - q.rangeFrom) + 1, SERVER_MAX_ROWS);
          rows = rows.slice(q.rangeFrom, q.rangeFrom + sliceLen);
        } else {
          rows = rows.slice(0, Math.min(q.limitN ?? SERVER_MAX_ROWS, SERVER_MAX_ROWS));
        }
        rows = rows.map(r => project(r, q.cols));
        return { data: q.wantSingle ? (rows[0] || null) : rows };
      }
      if (q.op === "upsert") {
        if (be.mode.db === "failwrite") return { error: "write rejected" };
        for (const row of Array.isArray(q.payload) ? q.payload : [q.payload]) {
          const i = be.glucose.findIndex(r => r.user_id === row.user_id && r.at === row.at);
          if (i >= 0) be.glucose[i] = { ...be.glucose[i], ...row }; else be.glucose.push({ ...row });
        }
        return { data: null };
      }
      return { error: "unsupported" };
    }

    if (q.op === "select") return { data: project(be.row, q.cols) };
    if (q.op === "upsert") {
      if (be.mode.db === "failwrite") return { error: "write rejected" };
      be.row = { ...q.payload, updated_at: stamp() }; // preserve every field the app sends (e.g. `lock`), not just data
      return { data: q.returning ? project(be.row, q.returning) : null };
    }
    return { error: "unsupported" };
  }

  function nsProxy(body) {
    be.log.push({ kind: "ns", action: body.action, treatment: body.treatment, id: body.id });
    const m = be.mode.ns;
    if (m === "notDeployed") return { error: { message: "Requested function was not found", context: { status: 404 } } };
    if (m === "networkDown") return { data: { ok: false, code: "UPSTREAM_NETWORK", error: "Couldn't reach Nightscout" } };
    if (m === "upstream500") return { data: { ok: false, code: "UPSTREAM_HTTP", status: 500, error: "Nightscout responded with HTTP 500" } };
    if (m === "hostBlocked") return { data: { ok: false, code: "HOST_NOT_ALLOWED", error: "That host isn't on this project's allowlist (NS_ALLOWED_HOSTS)" } };
    const ns = be.ns;
    switch (body.action) {
      case "read": {
        let rows = ns.entries.filter(e => typeof e.date === "number");
        if (body.before !== undefined) rows = rows.filter(e => e.date < body.before);
        if (body.after !== undefined) rows = rows.filter(e => e.date >= body.after);
        rows = rows.slice().sort((a, b) => b.date - a.date).slice(0, body.count || 1); // Nightscout returns newest-first
        return { data: { ok: true, status: 200, body: rows } };
      }
      case "create": { const id = `srv${String(ns.nextId++).padStart(6, "0")}`; ns.treatments.push({ ...body.treatment, _id: id }); return { data: { ok: true, status: 200, body: { ...body.treatment, _id: id } } }; }
      case "update": {
        if (be.mode.nsNoUpdate) return { data: { ok: false, code: "UPSTREAM_HTTP", status: 405, error: "Nightscout responded with HTTP 405" } };
        const i = ns.treatments.findIndex(t => t._id === body.treatment._id);
        if (i < 0) return { data: { ok: false, code: "UPSTREAM_HTTP", status: 404, error: "Nightscout responded with HTTP 404" } };
        ns.treatments[i] = { ...body.treatment }; return { data: { ok: true, status: 200, body: ns.treatments[i] } };
      }
      case "delete": {
        if (be.mode.nsNoDelete) return { data: { ok: false, code: "UPSTREAM_HTTP", status: 405, error: "Nightscout responded with HTTP 405" } };
        const i = ns.treatments.findIndex(t => t._id === body.id);
        if (i < 0) return { data: { ok: false, code: "UPSTREAM_HTTP", status: 404, error: "Nightscout responded with HTTP 404" } };
        ns.treatments.splice(i, 1); return { data: { ok: true, status: 200, body: {} } };
      }
      default: return { data: { ok: false, code: "BAD_REQUEST", error: "unknown action" } };
    }
  }

  be.handle = (req, res) => {
    const url = new URL(req.url, "http://x");
    if (!url.pathname.startsWith("/__be/")) return false;
    let raw = "";
    req.on("data", c => { raw += c; });
    req.on("end", () => {
      let body = {}; try { body = raw ? JSON.parse(raw) : {}; } catch { /* ignore */ }
      let out = {};
      const r = url.pathname.slice(6);
      if (r === "row") out = db(body);
      else if (r === "fn/nightscout-proxy") out = nsProxy(body);
      else if (r.startsWith("fn/")) out = { error: { message: "Requested function was not found", context: { status: 404 } } };
      else if (r === "control") { Object.assign(be.mode, body.mode || {}); if (body.entries) be.ns.entries = body.entries; out = { ok: true }; }
      else if (r === "dump") out = { row: be.row, ns: be.ns, log: be.log };
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify(out));
    });
    return true;
  };
  return be;
}

// Runs in the PAGE: a stand-in for supabase-js that talks to the fake backend.
export function fakeSupabaseSource({ userId = "user-1", email = "test@example.com", signedIn = true, delayMs = 0 } = {}) {
  return `
    (function () {
      const post = async (p, b) => {
        ${delayMs ? `await new Promise(r => setTimeout(r, ${delayMs})); // artificial delay: widens race windows for tests that need two async operations to genuinely overlap` : ""}
        const r = await fetch("/__be/" + p, { method: "POST", body: JSON.stringify(b) }); return r.json();
      };
      const user = { id: ${JSON.stringify(userId)}, email: ${JSON.stringify(email)} };
      window.__signedIn = ${signedIn};
      window.supabase = { createClient: () => ({
        auth: {
          getSession: async () => ({ data: { session: window.__signedIn ? { user } : null } }),
          onAuthStateChange: cb => { window.__authCb = cb; setTimeout(() => cb(window.__signedIn ? "SIGNED_IN" : "SIGNED_OUT", window.__signedIn ? { user } : null), 0); return { data: { subscription: { unsubscribe() {} } } }; },
          signInWithPassword: async () => ({ error: null }), signUp: async () => ({ error: null }),
          signOut: async () => { window.__signedIn = false; if (window.__authCb) await window.__authCb("SIGNED_OUT", null); return { error: null }; },
          // Test hooks: real supabase-js would parse the emailed link's URL fragment itself and
          // fire PASSWORD_RECOVERY on its own; here a test triggers that directly via __authCb.
          resetPasswordForEmail: async (email, opts) => { window.__resetCalls = window.__resetCalls || []; window.__resetCalls.push({ email, redirectTo: opts && opts.redirectTo }); return { data: {}, error: null }; },
          updateUser: async fields => { window.__updateUserCalls = window.__updateUserCalls || []; window.__updateUserCalls.push(fields); window.__signedIn = true; return { data: { user }, error: null }; }
        },
        from: table => {
          const q = { table, op: "select", cols: "*", filters: {}, payload: null, returning: null };
          const run = async () => { const j = await post("row", q); return { data: j.data === undefined ? null : j.data, count: j.count, error: j.error ? { message: j.error } : null }; };
          const b = {
            select(cols, opts) { if (q.op === "upsert") q.returning = cols || "*"; else { q.cols = cols || "*"; if (opts && opts.count === "exact") q.countExact = true; if (opts && opts.head) q.headOnly = true; } return b; },
            eq(k, v) { q.filters[k] = v; return b; },
            gte(k, v) { q.gte = { col: k, val: v }; return b; },
            order(col, opts) { q.orderBy = { col, ascending: !(opts && opts.ascending === false) }; return b; },
            limit(n) { q.limitN = n; return b; },
            range(from, to) { q.rangeFrom = from; q.rangeTo = to; return b; },
            upsert(payload) { q.op = "upsert"; q.payload = payload; return b; },
            maybeSingle() { q.wantSingle = true; return run(); },
            single() { q.wantSingle = true; return run(); },
            then(res, rej) { return run().then(res, rej); }
          };
          return b;
        },
        functions: { invoke: async (name, opts) => { const j = await post("fn/" + name, (opts && opts.body) || {}); return { data: j.data === undefined ? null : j.data, error: j.error || null }; } }
      }) };
    })();
  `;
}

// ------------------------------------------------------------------- server
export async function startApp(appDir, backend = null, virtualFiles = {}) {
  const server = http.createServer((req, res) => {
    if (backend && backend.handle(req, res)) return;
    const url = new URL(req.url, "http://x");
    const rel = decodeURIComponent(url.pathname).replace(/^\//, "");
    if (Object.prototype.hasOwnProperty.call(virtualFiles, rel)) {          // served from memory (e.g. a stub foods_data.js)
      res.writeHead(200, { "Content-Type": MIME[path.extname(rel)] || "text/plain", "Cache-Control": "no-store" });
      res.end(virtualFiles[rel]); return;
    }
    let file = path.join(appDir, decodeURIComponent(url.pathname));
    if (url.pathname.endsWith("/")) file = path.join(file, "index.html");
    if (!file.startsWith(path.resolve(appDir)) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end("not found"); return; }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  return { url: `http://localhost:${port}/`, port, backend, close: () => new Promise(r => server.close(r)) };
}

// ------------------------------------------------------------------- device
let debugPort = 9300 + Math.floor(Math.random() * 400);
const httpGet = url => new Promise((resolve, reject) => { http.get(url, res => { let d = ""; res.on("data", c => { d += c; }); res.on("end", () => resolve(d)); }).on("error", reject); });
const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * One headless Chrome. Options: width/height/mobile/dark/tz, `inject` (JS run
 * before the app boots -- seed localStorage, install the fake Supabase, ...),
 * `path` (page to open), `profile` (reuse a user-data-dir to keep storage).
 */
// Ask Chrome to shut itself down properly via its browser-level DevTools endpoint, then wait for the
// process to really exit (capped, so a hung Chrome can't hang a test run). This is the orderly shutdown
// that flushes localStorage to disk; a signal -- and certainly SIGKILL -- is not guaranteed to.
async function shutDownGracefully(port, proc, maxMs) {
  try {
    const { webSocketDebuggerUrl } = JSON.parse(await httpGet(`http://localhost:${port}/json/version`));
    const bws = new WebSocket(webSocketDebuggerUrl);
    await new Promise((res, rej) => { bws.onopen = res; bws.onerror = rej; });
    bws.send(JSON.stringify({ id: 1, method: "Browser.close" }));
  } catch { /* couldn't reach it -- the caller falls back to killing it */ }
  await new Promise(done => {
    if (proc.exitCode !== null || proc.signalCode !== null) return done();
    const timer = setTimeout(done, maxMs);
    proc.once("exit", () => { clearTimeout(timer); done(); });
  });
}

export async function openDevice(app, { width = 390, height = 900, mobile = true, dark = false, tz = null, inject = "", path: pagePath = "index.html", profile = null, wait = 1200 } = {}) {
  const port = debugPort++;
  const userDir = profile || `/tmp/ib-chrome-${Date.now()}-${port}`;
  const proc = spawn(findChrome(), ["--headless=new", "--no-sandbox", "--disable-gpu", `--remote-debugging-port=${port}`, `--user-data-dir=${userDir}`, `--window-size=${width},${height}`, "--host-resolver-rules=MAP cdn.jsdelivr.net 127.0.0.1"], { stdio: "ignore" });
  let targets;
  for (let i = 0; i < 40; i++) { try { targets = JSON.parse(await httpGet(`http://localhost:${port}/json`)); break; } catch { await sleep(150); } }
  const page = targets.find(t => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => { ws.onopen = r; });
  let id = 0; const pending = new Map(); const listeners = [];
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } else if (m.method) listeners.forEach(l => l(m)); };
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send("Page.enable"); await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
  if (tz) await send("Emulation.setTimezoneOverride", { timezoneId: tz });

  const errors = [];
  listeners.push(m => { if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); });
  const base = `
    window.__errs = [];
    addEventListener("error", e => window.__errs.push(e.message));
    addEventListener("unhandledrejection", e => window.__errs.push("rejection: " + ((e.reason && e.reason.message) || e.reason)));
    addEventListener("securitypolicyviolation", e => window.__errs.push("CSP: " + e.violatedDirective + " " + e.blockedURI));
  `;
  await send("Page.addScriptToEvaluateOnNewDocument", { source: base + inject });

  const dev = {
    port, cdp: { send }, errors, profile: userDir,
    async eval(expr) {
      const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || JSON.stringify(r.result.exceptionDetails));
      return r.result.result.value;
    },
    async go(p = pagePath, ms = wait) {
      await send("Page.navigate", { url: app.url + p }); await sleep(ms);
      // The fixed sleep alone isn't enough when the machine is busy: a test could start poking a page that
      // hasn't finished loading and crash on a null element. waitFor retries through mid-navigation errors.
      await dev.waitFor(`document.readyState === "complete"`, 10000).catch(() => { /* let the test fail with its own message */ });
      if (dark) await dev.eval(`document.documentElement.setAttribute("data-theme","dark")`); },
    sleep,
    async waitFor(fnExpr, timeout = 6000, step = 60) {
      const t0 = Date.now();
      while (Date.now() - t0 < timeout) { try { if (await dev.eval(fnExpr)) return true; } catch { /* page navigating */ } await sleep(step); }
      throw new Error("waitFor timed out: " + fnExpr);
    },
    click: sel => dev.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) throw new Error("no element: ${sel.replace(/"/g, "'")}"); e.click(); return true; })()`),
    text: sel => dev.eval(`(document.querySelector(${JSON.stringify(sel)}) || {}).textContent || ""`),
    // Switches tab and confirms the view really opened. The app ignores a tab click until its startup has
    // finished, so on a busy machine a single click can land too early and be silently dropped; the old version
    // never noticed and later steps then failed on elements that had never rendered. Retries are capped, so a
    // tab that legitimately can't open (e.g. behind the lock screen) costs a couple of seconds, not a hang.
    async tab(name) {
      for (let i = 0; i < 25; i++) {
        try { await dev.click(`[data-target="${name}"]`); } catch { /* tab bar not rendered yet */ }
        await sleep(i === 0 ? 120 : 100);
        if (await dev.eval(`(() => { const v = document.getElementById("view-${name}"); return !!v && !v.hidden; })()`).catch(() => false)) return;
      }
    },
    async shot(file) { const s = await send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(file, Buffer.from(s.result.data, "base64")); },
    async resize(w, h, m = mobile) { await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: m }); await sleep(250); },
    async offline(on) { await send("Network.enable"); await send("Network.emulateNetworkConditions", { offline: on, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }); },
    // Returns a promise, but it only actually waits for devices that reuse a profile dir; for everything
    // else it finishes synchronously, so callers that don't await it are unaffected.
    async close() {
      try { ws.close(); } catch { /* */ }
      // This instance's processes, found by their unique profile dir. The leading [u] stops the pattern
      // matching the shell that runs this very command.
      let pids = [];
      try { pids = execSync(`pgrep -f ${JSON.stringify("[u]ser-data-dir=" + userDir)}`).toString().split("\n").map(Number).filter(Boolean); } catch { /* none */ }
      // A test reusing this profile dir needs its localStorage on disk. Killing Chrome outright doesn't give it
      // the chance to flush (the next phase then opened an EMPTY profile -- Face ID enrollment "never happened"),
      // so shut it down properly first.
      if (profile) await shutDownGracefully(port, proc, 8000);
      // Chrome's zygote/crashpad/renderer children aren't in proc's own process group here, so killing just proc
      // leaves them running. Kill by exact PID, never by directory: a test may reopen the SAME profile
      // immediately, and matching on the directory would take that new instance down too.
      for (const pid of pids) { try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ } }
      try { proc.kill("SIGKILL"); } catch { /* */ }
      // Temporary profiles were never deleted, and a single test run leaves ~100 behind. They piled up past
      // a thousand and filled the disk to 86%, which made later runs slow and flaky. Profiles a test supplied
      // itself are the test's to manage.
      if (!profile) { try { fs.rmSync(userDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }); } catch { /* best effort */ } }
    }
  };
  await dev.go(pagePath, wait);
  return dev;
}

// A tiny assertion helper so e2e scripts read like tests.
export function makeChecker() {
  let pass = 0, fail = 0;
  const failures = [];
  return {
    check(name, ok, extra) { (ok ? pass++ : (fail++, failures.push(name))); console.log(`  ${ok ? "PASS" : "FAIL"} ${name}${extra !== undefined && (!ok || process.env.VERBOSE) ? `  -> ${extra}` : ""}`); return !!ok; },
    section(t) { console.log(`\n=== ${t} ===`); },
    summary() { console.log(`\n${pass} passed, ${fail} failed${fail ? "  (" + failures.join("; ") + ")" : ""}`); return fail === 0; },
    get pass() { return pass; }, get fail() { return fail; }
  };
}

// Seeds localStorage with a state blob (before the app boots).
export const seedLocal = state => `localStorage.setItem("insulinBuddy.v2", ${JSON.stringify(JSON.stringify(state))});`;

// A fake platform authenticator (Face ID / Touch ID), since headless Chrome has no real
// biometric hardware. window.__webauthnShouldFail can be flipped mid-test to simulate a
// declined/failed prompt; window.__webauthnCalls records every create()/get() for assertions.
export function fakeWebAuthn() {
  return `
    window.__webauthnCalls = [];
    // Read from localStorage, not a bare variable: a full page navigation (as a real
    // close-and-reopen, or a test simulating one) wipes plain JS state, but this script
    // re-runs on every new document, so a flag set via localStorage before navigating away
    // still applies after -- letting a test toggle this across a reload, not just within one.
    Object.defineProperty(window, "__webauthnShouldFail", {
      get() { return localStorage.getItem("__webauthnShouldFail") === "1"; },
      set(v) { v ? localStorage.setItem("__webauthnShouldFail", "1") : localStorage.removeItem("__webauthnShouldFail"); }
    });
    window.PublicKeyCredential = function () {};
    window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable = async () => true;
    navigator.credentials = navigator.credentials || {};
    navigator.credentials.create = async (opts) => {
      window.__webauthnCalls.push({ op: "create", opts });
      if (window.__webauthnShouldFail) throw new Error("simulated: user declined or hardware unavailable");
      return { rawId: new Uint8Array(16).fill(7), id: "fake-cred-id" };
    };
    navigator.credentials.get = async (opts) => {
      window.__webauthnCalls.push({ op: "get", opts });
      if (window.__webauthnShouldFail) throw new Error("simulated: no match or user cancelled");
      return { id: "fake-cred-id" };
    };
  `;
}
