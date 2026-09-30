import { escapeHtml, escapeAttr, round1, formatQty, dayKeyFromTs, timeAgo, makeId, redact } from "./js/util.js";
import { convertGlucose, roundDose as roundDoseWith, activeAt, compoundGiInfo, computeDose, giBand, niceScale, buildTrendBuckets, summarizeTrends, mealTypeBreakdown, absorptionMinutesForEntry as absorptionForEntry, iobFraction, cobGrams, glucoseTrendArrow, glucoseRangeClass, glucoseRangeLabel } from "./js/calc.js";
import { SCHEMA_VERSION, normalizeState as normalizeStateWith, makeFingerprint, stampChanges, mergeStates, statesEquivalent, prepareRestoredState, unexplainedEmptying } from "./js/state.js";
import { NightscoutClient, NsOutbox, nsToken, nsBaseUrl, nsConfigured, treatmentsForEntry } from "./js/nightscout.js";
import { createDiag, hookGlobalErrors } from "./js/diag.js";
import { randomBytes, toB64, fromB64, deriveKey, encryptString, decryptString, isEncryptedPayload } from "./js/crypto.js";
import { LocalBackups, shouldAutoSnapshot } from "./js/backup.js";
import { groupByDay, takeEntries, matchesQuery, recentDistinctMeals, mealLabel, PAGE_SIZE } from "./js/history.js";
import { createDialogs } from "./js/dialogs.js";


  const STORAGE_KEY = "insulinBuddy.v2";

  // ================= Cloud sync (optional) =================
  // Fill these in after creating a free Supabase project (see README.md).
  // Left as placeholders, the app works exactly as before: local-only,
  // stored in this browser. The anon key is meant to be public — it's
  // useless without the Row Level Security policies set up in the SQL
  // script, which restrict every row to its owning user.
  const SUPABASE_URL = "https://igfunxofpkenyrzlcyyv.supabase.co";
  const SUPABASE_ANON_KEY = "sb_publishable_bi30N-e36pzW0qhEl_AXtA_SRARSbY4";

  const cloudConfigured = SUPABASE_URL !== "YOUR_SUPABASE_URL" && SUPABASE_ANON_KEY !== "YOUR_SUPABASE_ANON_KEY";
  const supabaseClient = (cloudConfigured && window.supabase)
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;
  let currentUser = null; // { id, email } once signed in; null in local-only mode
  let cloudLoadStatus = { ok: true, message: "", at: null };
  // Auditable record of the most recent real Nightscout read/write attempt --
  // updated every time one actually happens (not just on manual test), so
  // the System Status panel always reflects genuine, current behavior.
  // via: "proxy" | "direct" | null (null = never attempted yet)
  let nightscoutReadStatus = { ok: null, via: null, at: null, message: "" };
  let nightscoutWriteStatus = { ok: null, via: null, at: null, message: "" };
  let lastKnownCloudHistoryCount = null; // baseline for the data-loss guard in saveStateCloud()
  let lastKnownCloudHistoryIds = null;   // ...and exactly WHICH meals the cloud had, so a deliberate delete can be told from an accident
  let cloudSaveBlocked = null; // { fromCount, toCount } when the guard below trips, else null
  const PENDING_SYNC_KEY = "insulinBuddy.pendingSync";
  let cloudSyncPending = localStorage.getItem(PENDING_SYNC_KEY) === "1";

  const CATEGORIES = [
    { id: "fruits", label: "Fruits" },
    { id: "vegetables", label: "Vegetables" },
    { id: "grains", label: "Grains" },
    { id: "protein", label: "Protein" },
    { id: "dairy", label: "Dairy" },
    { id: "beverages", label: "Beverages" },
    { id: "snacks", label: "Snacks" },
    { id: "other", label: "Other" }
  ];

  const PALETTES = [
    { id: "tealViolet", name: "Teal & Violet", dots: ["#1F9E93", "#8B5CF6", "#38BDF8"] },
    { id: "blueViolet", name: "Blue & Purple", dots: ["#3B82F6", "#8B5CF6", "#6366F1"] },
    { id: "emeraldRose", name: "Emerald & Rose", dots: ["#10B981", "#F43F5E", "#34D399"] },
    { id: "orangePink", name: "Orange & Pink", dots: ["#F97316", "#EC4899", "#F59E0B"] },
    { id: "cyanIndigo", name: "Cyan & Indigo", dots: ["#22B8CE", "#6366F1", "#3B82F6"] },
    { id: "greenAmber", name: "Green & Amber", dots: ["#22C55E", "#F59E0B", "#84CC16"] }
  ];

  const MEAL_TYPES = {
    breakfast: { label: "Breakfast", color: "#E8935D", icon: iconCoffee() },
    lunch:     { label: "Lunch",     color: "#D6A419", icon: iconSun() },
    dinner:    { label: "Dinner",    color: "#6B5FD0", icon: iconMoon() },
    snack:     { label: "Snack",     color: "#4C9A6A", icon: iconApple() },
    correction: { label: "Correction", color: "#C0392B", icon: iconPulse() }
  };

  function iconPulse() { return '<svg viewBox="0 0 24 24" fill="none"><path d="M3 12h4l2-7 4 14 2-7h6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'; }

  function iconSun() { return '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="1.8"/><path d="M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>'; }
  function iconMoon() { return '<svg viewBox="0 0 24 24" fill="none"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'; }
  function iconCoffee() { return '<svg viewBox="0 0 24 24" fill="none"><path d="M4 8h13v6a4 4 0 01-4 4H8a4 4 0 01-4-4V8z" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M17 9.5h1.5a2.2 2.2 0 010 4.4H17" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M8.5 1.5c-.8.8-.8 1.2 0 2s.8 1.2 0 2M12.5 1.5c-.8.8-.8 1.2 0 2s.8 1.2 0 2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>'; }
  function iconApple() { return '<svg viewBox="0 0 24 24" fill="none"><path d="M12 8.5c-3.5-2.5-8 0-8 5S7.5 21 10 20c1-.4 1-.4 2 0 2.5 1 6-2.5 6-6.5s-4.5-7.5-6-5z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M12 8.5c0-1.5.5-3 2-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>'; }

  const DEFAULT_TIME_RATIOS = [
    { id: "tr-morning", name: "Morning", start: "05:30", end: "11:00", ratio: 10, color: "#1F9E93" },
    { id: "tr-lunch",   name: "Lunch",   start: "11:00", end: "15:00", ratio: 8,  color: "#D6A419" },
    { id: "tr-evening", name: "Evening", start: "15:00", end: "23:30", ratio: 15, color: "#6366F1" },
    { id: "tr-night",   name: "Night",   start: "23:30", end: "05:30", ratio: 12, color: "#D9534F" }
  ];
  const DEFAULT_ACTIVITY_RATIOS = [
    { id: "ar-sport", name: "Sport", ratio: 18, color: "#8B5CF6" }
  ];

  function defaultState() {
    return {
      settings: {
        isf: 50,
        target: 100,
        units: "mgdl",
        rounding: "0.5",
        maxDose: 15,
        timeRatios: structuredClone(DEFAULT_TIME_RATIOS),
        activityRatios: structuredClone(DEFAULT_ACTIVITY_RATIOS),
        palette: "blueViolet",
        darkMode: false,
        darkModeAuto: false,
        insulinModel: { preset: "rapid", peakMinutes: 75, diaMinutes: 360 },
        carbAbsorptionMinutes: { high: 120, medium: 180, low: 240, unknown: 180 },
        iobAwareCorrection: false,
        nightscoutUrl: "",
        nsFormat: "combined",   // "combined" (one Meal Bolus) or "split" (carbs and insulin separately)
        nsSyncEdits: true,       // also update / delete in Nightscout when a meal is edited / deleted
        customBackground: null
      },
      library: structuredClone(typeof SEED_FOODS !== "undefined" ? SEED_FOODS : []),
      recipes: structuredClone(typeof SEED_RECIPES !== "undefined" ? SEED_RECIPES : []),
      history: []
    };
  }


  // ---- thin wrappers: the maths lives in js/calc.js, these bind it to live state ----
  function roundDose(value) { return roundDoseWith(value, state.settings.rounding); }
  function calcActiveInsulinAndCarbs(atTime) { return activeAt(state.history, state.settings, atTime); }
  function normalizeState(parsed) { return normalizeStateWith(parsed, defaultState); }
  function absorptionMinutesForEntry(entry) { return absorptionForEntry(entry, state.settings.carbAbsorptionMinutes); }

  // ================= Optional passphrase lock (client-side encryption) =================
  // This is genuinely real encryption (PBKDF2 + AES-GCM via the Web Crypto API), not a
  // cosmetic login screen — it's meant to protect what's sitting in this browser's
  // localStorage, e.g. on a shared device. It is NOT server-side auth: there's no
  // account, nothing syncs, and forgetting the passphrase means the data is
  // unrecoverable by design (there's no backdoor to build on a static site).
  const LOCK_KEY = "insulinBuddy.lock";
  let encryptionKey = null; // the derived CryptoKey, kept in memory only while unlocked this session

  function getLockConfig() {
    try { return JSON.parse(localStorage.getItem(LOCK_KEY) || "null"); } catch { return null; }
  }
  function isLockEnabled() { return !!getLockConfig(); }

  async function setPassphrase(passphrase) {
    const salt = randomBytes(16);
    const key = await deriveKey(passphrase, salt);
    const verifier = await encryptString(key, "insulin-buddy-unlock-check");
    localStorage.setItem(LOCK_KEY, JSON.stringify({ salt: toB64(salt), verifier }));
    encryptionKey = key;
    await saveState(); // re-save current data encrypted immediately
  }
  async function tryUnlock(passphrase) {
    const cfg = getLockConfig();
    if (!cfg) return true;
    try {
      const salt = fromB64(cfg.salt);
      const key = await deriveKey(passphrase, salt);
      const check = await decryptString(key, cfg.verifier);
      if (check !== "insulin-buddy-unlock-check") return false;
      encryptionKey = key;
      return true;
    } catch {
      return false;
    }
  }
  async function removePassphrase() {
    await saveStateRaw(state, null); // force a plaintext local write while we still have the key
    localStorage.removeItem(LOCK_KEY);
    encryptionKey = null;
    if (currentUser) await saveStateCloud(); // push the plaintext copy + lock:null immediately, don't wait
  }

  let localWasLegacy = false; // true when the saved copy predates the versioned schema (or doesn't exist)
  function loadStatePlain() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) { localWasLegacy = true; return normalizeState({}); }
      const parsed = JSON.parse(raw);
      localWasLegacy = parsed.schemaVersion !== SCHEMA_VERSION;
      return normalizeState(parsed);
    } catch (e) {
      console.error("Could not read saved data, starting fresh.", e);
      diag.log("error", "storage", "Could not read saved data, starting fresh: " + (e && e.message));
      localWasLegacy = true;
      return normalizeState({});
    }
  }
  async function loadStateEncrypted(key) {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) { localWasLegacy = true; return normalizeState({}); }
    const payload = JSON.parse(raw);
    const json = await decryptString(key, payload);
    const parsed = JSON.parse(json);
    localWasLegacy = parsed.schemaVersion !== SCHEMA_VERSION;
    return normalizeState(parsed);
  }

  /** The local baseline, whichever form it's actually in. A device can have plaintext local
   * storage from before it ever knew about a passphrase (e.g. it used cloud sync, then later
   * adopted a passphrase set on another device) -- so even with a key in hand, fall back to a
   * plain read if what's stored isn't actually encrypted. */
  async function loadLocalState() {
    if (!encryptionKey) return loadStatePlain();
    try { return await loadStateEncrypted(encryptionKey); }
    catch (e) { return loadStatePlain(); }
  }

  let state; // populated by boot() below, once (and if) the lock screen is cleared

  // ================= Services: dialogs, diagnostics, local backups, Nightscout =================
  const dialogs = createDialogs(document);
  const diagSecrets = () => { try { return [nightscoutToken()]; } catch { return []; } };
  const diag = createDiag({ storage: localStorage, secrets: diagSecrets });
  hookGlobalErrors(window, diag);

  // Rolling local snapshots: a safety net under sync/merge, import and delete-all.
  const backups = new LocalBackups();
  const LAST_SNAPSHOT_KEY = "insulinBuddy.lastSnapshot";
  async function snapshotNow(reason, stateOverride) {
    try {
      const st = stateOverride || state;
      if (!backups.available() || !st) return;
      const json = JSON.stringify(st);            // captured synchronously, before any caller mutates state
      let payload = json, encrypted = false;
      if (encryptionKey) { payload = JSON.stringify(await encryptString(encryptionKey, json)); encrypted = true; }
      await backups.snapshot(payload, { reason, meals: st.history.length, foods: st.library.length, encrypted });
      localStorage.setItem(LAST_SNAPSHOT_KEY, String(Date.now()));
      diag.log("info", "backup", `Snapshot saved (${reason}): ${st.history.length} meals`);
    } catch (e) { diag.log("warn", "backup", "Snapshot failed: " + ((e && e.message) || e)); }
  }
  function maybeAutoSnapshot() {
    const last = Number(localStorage.getItem(LAST_SNAPSHOT_KEY)) || 0;
    if (shouldAutoSnapshot(last, Date.now())) { localStorage.setItem(LAST_SNAPSHOT_KEY, String(Date.now())); snapshotNow("auto"); }
  }

  // Nightscout: one client (proxy first, direct fallback) + a persistent outbox.
  const nsClient = new NightscoutClient({
    invoke: (name, body) => (supabaseClient && currentUser)
      ? supabaseClient.functions.invoke(name, { body })
      : Promise.reject(new Error("not signed in")),
    diag,
    onStatus: (kind, ok, via, message) => recordNightscoutStatus(kind, ok, via, message)
  });
  const nsOutbox = new NsOutbox({
    storage: localStorage, client: nsClient, diag,
    getConfig: () => nsCfg(),
    onEntryPatch: (entryId, patch) => {
      const entry = state.history.find(h => h.id === entryId);
      if (!entry) return;
      Object.assign(entry, patch);
      saveState();
    },
    onChange: () => refreshNsUi()
  });

  // ================= Cloud sync functions =================

  async function signUp(email, password) {
    if (!supabaseClient) throw new Error("Cloud sync isn't set up yet.");
    const { error } = await supabaseClient.auth.signUp({ email, password });
    if (error) throw error;
  }
  async function signIn(email, password) {
    if (!supabaseClient) throw new Error("Cloud sync isn't set up yet.");
    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }
  async function signOut() {
    if (!supabaseClient) return;
    await supabaseClient.auth.signOut();
  }

  async function loadStateCloud() {
    const { data, error } = await supabaseClient
      .from("app_state").select("data, updated_at, lock").eq("user_id", currentUser.id).maybeSingle();
    if (error) {
      console.error("Cloud load failed:", error);
      diag.log("error", "sync", "Cloud load failed: " + (error.message || error));
      return { ok: false }; // couldn't reach the cloud -- NOT the same as "no data exists yet"
    }
    if (!data) return { ok: true, state: null }; // first sign-in, no row yet -- safe to initialize
    let raw = data.data;
    if (isEncryptedPayload(raw)) {
      // The account is passphrase-protected. By the time we get here boot()'s sign-in
      // flow should already have made sure encryptionKey is set (adopting this device
      // to the account's lock config and prompting to unlock first) -- but if it isn't,
      // fail gracefully rather than trying to treat ciphertext as a state object.
      if (!encryptionKey) { diag.log("warn", "sync", "Cloud data is encrypted but this device hasn't unlocked yet"); return { ok: false }; }
      try { raw = JSON.parse(await decryptString(encryptionKey, raw)); }
      catch (e) { diag.log("error", "sync", "Couldn't decrypt cloud data: " + ((e && e.message) || e)); return { ok: false }; }
    }
    return { ok: true, state: normalizeState(raw), updatedAt: data.updated_at };
  }

  /** Cheap check, alongside the updated_at check: does this account require a passphrase
   * on this device? Only the salt + a verifier travel here -- never the passphrase itself. */
  async function checkCloudLockConfig() {
    if (!supabaseClient || !currentUser) return { ok: false, lock: null };
    try {
      const { data, error } = await supabaseClient.from("app_state").select("lock").eq("user_id", currentUser.id).maybeSingle();
      if (error) return { ok: false, lock: null };
      return { ok: true, lock: (data && data.lock) || null };
    } catch (e) { return { ok: false, lock: null }; }
  }
  let cloudSaveTimer = null;
  async function saveStateCloud(force) {
    if (!supabaseClient || !currentUser) return;

    // Data-loss guard: never silently push a history that's collapsed to zero
    // compared to the last count we confirmed was really in the cloud.
    // An empty history is only allowed through if every meal the cloud had was
    // deliberately deleted (each leaves a deletion marker). Anything else that
    // empties the history is a bug, not a decision, so it must not reach the cloud.
    if (!force && state.history.length === 0 && lastKnownCloudHistoryIds && lastKnownCloudHistoryIds.size > 0) {
      const unexplained = unexplainedEmptying(state, lastKnownCloudHistoryIds);
      if (unexplained.length > 0) {
        cloudSaveBlocked = { fromCount: lastKnownCloudHistoryIds.size, toCount: 0 };
        console.error(`Cloud save blocked: history would drop from ${lastKnownCloudHistoryIds.size} to 0.`);
        diag.log("error", "sync", `Cloud save blocked: history would drop from ${lastKnownCloudHistoryIds.size} to 0 with ${unexplained.length} meals not deliberately deleted`);
        markPending();
        renderStatusPanel();
        return;
      }
    }

    clearTimeout(cloudSaveTimer);
    await new Promise(resolve => {
      cloudSaveTimer = setTimeout(async () => {
        try {
          // Merge first: if another device wrote since we last synced, fold its
          // changes in BEFORE uploading, so nothing it saved can be overwritten.
          await pullAndMerge("before save");
          // When a passphrase is set, upload the encrypted blob, not the raw data -- and carry
          // the (non-secret) lock config along so any other device signing into this account
          // knows a passphrase is required, without either of them ever transmitting it.
          const payloadData = encryptionKey ? await encryptString(encryptionKey, JSON.stringify(state)) : state;
          const { data: up, error } = await supabaseClient.from("app_state")
            .upsert({ user_id: currentUser.id, data: payloadData, lock: getLockConfig(), updated_at: new Date().toISOString() })
            .select("updated_at").maybeSingle();
          if (error) throw error;
          lastKnownCloudUpdatedAt = up ? up.updated_at : null;   // unknown => next save re-checks (safe)
          cloudSaveBlocked = null;
          lastKnownCloudHistoryCount = state.history.length;
          lastKnownCloudHistoryIds = new Set(state.history.map(h => h.id));
          markSynced();
        } catch (e) {
          console.error("Cloud save failed (offline?) -- will retry once back online:", e);
          diag.log("warn", "sync", "Cloud save failed, will retry: " + ((e && e.message) || e));
          markPending();
        }
        resolve();
      }, 500);
    });
  }
  // Escape hatch for the rare genuine case (someone really did delete all their
  // history) — bypasses the guard above exactly once, on explicit request.
  // ---- multi-device merge (see js/state.js for the rules) ----
  let lastKnownCloudUpdatedAt = null; // the cloud row's updated_at as of our last sync
  let stateFp = null;                 // fingerprint of the last saved state, to spot what changed
  let lastPullAt = 0;

  // Cheap check first (just updated_at); only download + merge when someone else wrote.
  async function pullAndMerge(reason) {
    if (!supabaseClient || !currentUser) return false;
    const head = await supabaseClient.from("app_state").select("updated_at").eq("user_id", currentUser.id).maybeSingle();
    if (head.error) throw head.error;
    if (!head.data) return false;
    lastPullAt = Date.now();
    if (head.data.updated_at === lastKnownCloudUpdatedAt) return false;
    const full = await loadStateCloud();
    if (!full.ok) throw new Error("Couldn't download the cloud copy");
    if (!full.state) return false;
    lastKnownCloudUpdatedAt = full.updatedAt;
    return applyRemoteState(full.state, reason);
  }

  function applyRemoteState(remote, reason) {
    const merged = mergeStates(state, remote, defaultState);
    if (statesEquivalent(merged, state)) return false;
    snapshotNow("before-merge");
    state.settings = merged.settings;
    state.settingsUpdatedAt = merged.settingsUpdatedAt;
    state.library = merged.library;
    state.recipes = merged.recipes;
    state.history = merged.history;
    state.deleted = merged.deleted;
    stateFp = makeFingerprint(state);            // merged data is already known: don't re-stamp it
    saveStateRaw(state, encryptionKey).catch(e => console.error("Local save after merge failed:", e));
    diag.log("info", "sync", `Merged changes from another device (${reason}); ${state.history.length} meals`);
    renderAfterSync();
    return true;
  }

  // Refresh what's on screen after a background merge WITHOUT resetting the
  // meal being built in the Calculator (renderEverything() would).
  function renderAfterSync() {
    document.documentElement.setAttribute("data-palette", state.settings.palette);
    applyTheme();
    renderFoodPickList(); renderMealItems(); recompute(); renderActivePanel();
    renderLibrary(); renderHistory();
    if (!el("view-settings").hidden) renderSettings();
  }

  async function forceSyncNow() {
    cloudSaveBlocked = null;
    await saveStateCloud(true);
    renderStatusPanel();
  }
  function markPending() {
    cloudSyncPending = true;
    localStorage.setItem(PENDING_SYNC_KEY, "1");
    renderSyncStatus();
  }
  function markSynced() {
    cloudSyncPending = false;
    localStorage.removeItem(PENDING_SYNC_KEY);
    renderSyncStatus();
  }
  function renderSyncStatus() {
    const el2 = document.getElementById("sync-status");
    if (!el2) return;
    el2.textContent = cloudSyncPending
      ? "Offline — changes are saved on this device and will sync once you're back online."
      : "All changes saved to your account.";
    el2.style.color = cloudSyncPending ? "var(--amber)" : "var(--ink-soft)";
  }

  // Retry a failed sync as soon as connectivity returns, or when the app
  // becomes visible again (covers phones where the 'online' event can be
  // unreliable, e.g. coming back from a lift or a tunnel).
  async function attemptReconnectSync() {
    if (!supabaseClient) return;
    if (currentUser) {
      try {
        if (cloudSyncPending) await saveStateCloud();                       // merges, then uploads
        else if (Date.now() - lastPullAt > 15000) await pullAndMerge("returned to app");
      } catch (e) { diag.log("warn", "sync", "Background sync failed: " + ((e && e.message) || e)); }
      flushNightscoutQueue();
      return;
    }
    // We're in local-fallback mode (e.g. the app booted while fully offline).
    // See if a session is reachable now; if so, our local copy is what should be
    // merged with the cloud and pushed up.
    try {
      const { data: { session } } = await supabaseClient.auth.getSession();
      if (session && session.user) {
        currentUser = session.user;
        await saveStateCloud();
        renderEverything();
      }
    } catch (e) {
      // still offline -- nothing to do, we'll try again on the next trigger
    }
  }
  window.addEventListener("online", attemptReconnectSync);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) attemptReconnectSync(); });

  async function saveStateRaw(s, key) {
    if (key) {
      const payload = await encryptString(key, JSON.stringify(s));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    }
  }
  async function saveState() {
    if (!stateFp) { stateFp = makeFingerprint(state); diag.log("warn", "state", "saveState ran before the change baseline existed"); }
    stateFp = stampChanges(state, stateFp);   // notice what changed since the last save
    await saveStateRaw(state, encryptionKey);
    maybeAutoSnapshot();
    if (currentUser) await saveStateCloud();
  }

  // ---------- draft (in-progress calculator entry, not persisted) ----------
  let draft = {
    items: [],          // { refType, refId, name, grams, carbs, kcal }
    correctionOn: false,
    noInsulinOn: false, // "Treating a Low" — logs carbs with zero insulin regardless of ratio/correction
    glucose: "",
    glucoseUnit: null,  // "mgdl" | "mmol" — which unit the glucose reading is entered in; null = follow Settings
    manualRatioId: null // overrides time-of-day auto ratio; can be a timeRatio or activityRatio id
  };

  // ================= Navigation =================
  const tabs = document.querySelectorAll(".tab");
  const views = document.querySelectorAll("[data-view]");

  // Measures the real rendered tabbar height (which already accounts for the
  // device's own safe-area inset) so the sticky log bar can sit precisely
  // above it, rather than guessing a fixed pixel value that would be wrong
  // on some devices.
  function syncTabbarHeightVar() {
    const tabbar = document.querySelector(".tabbar");
    if (tabbar) document.documentElement.style.setProperty("--tabbar-height", tabbar.offsetHeight + "px");
    const logBar = document.getElementById("cc-sticky-log-bar");
    if (logBar) document.documentElement.style.setProperty("--sticky-log-bar-height", logBar.offsetHeight + "px");
  }

  function showView(name) {
    if (!state) return; // still waiting on the cloud auth check (see boot()); nothing to show yet
    views.forEach(v => { v.hidden = v.id !== `view-${name}`; });
    tabs.forEach(t => {
      if (t.dataset.target === name) t.setAttribute("aria-current", "page");
      else t.removeAttribute("aria-current");
    });
    el("cc-sticky-log-bar").hidden = name !== "calculator";
    if (name === "calculator") renderActivePanel();
    if (name === "library") renderLibrary();
    if (name === "history") { historyLimit = PAGE_SIZE; renderHistory(); }
    if (name === "settings") renderSettings();
  }
  tabs.forEach(t => t.addEventListener("click", () => showView(t.dataset.target)));

  // ================= Time helpers =================
  function toMinutes(hhmm) {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
  }
  function inRange(minutes, start, end) {
    const s = toMinutes(start), e = toMinutes(end);
    if (s === e) return true;
    if (s < e) return minutes >= s && minutes < e;
    return minutes >= s || minutes < e; // wraps past midnight
  }
  function currentTimeRatio(atDate) {
    const d = atDate || new Date();
    const minutes = d.getHours() * 60 + d.getMinutes();
    const list = state.settings.timeRatios;
    return list.find(r => inRange(minutes, r.start, r.end)) || list[0] || null;
  }
  function unitLabel(unit) { return (unit || state.settings.units) === "mmol" ? "mmol/L" : "mg/dL"; }

  function activeRatioEntry() {
    if (draft.manualRatioId) {
      const t = state.settings.timeRatios.find(r => r.id === draft.manualRatioId);
      if (t) return t;
      const a = state.settings.activityRatios.find(r => r.id === draft.manualRatioId);
      if (a) return a;
    }
    return currentTimeRatio();
  }

  // ================= Calculator =================
  const el = id => document.getElementById(id);
  const carbsPill = el("cc-carbs-pill");
  const doseNumber = el("cc-dose-number");
  const correctionToggle = el("cc-correction-toggle");
  const correctionRow = el("cc-correction-row");
  const glucoseInput = el("cc-glucose");
  const glucoseUnitLabel = el("cc-glucose-unit");
  const ratioPill = el("cc-ratio-pill");
  const ratioValueLabel = el("cc-ratio-value");
  const ratioPicker = el("cc-ratio-picker");
  const mealItemsBox = el("cc-meal-items");
  const searchInput = el("cc-search");
  const gramsInput = el("cc-grams");
  const addBtn = el("cc-add-btn");
  const foodListBox = el("cc-food-list");
  const logBtn = el("cc-log-btn");
  const resetBtn = el("cc-reset-btn");
  const clearAllBtn = el("cc-clear-all-btn");

  let selectedPickId = null; // id of highlighted item in the pick list (format "food:ID" or "recipe:ID")


  function recipeTotals(recipe) {
    let carbs = 0, kcal = 0;
    recipe.items.forEach(it => {
      let cp100 = it.carbsPer100g, kp100 = it.kcalPer100g;
      if (cp100 == null) {
        // older recipes saved before ingredients snapshotted their rates — fall back to a live lookup
        const food = state.library.find(f => f.id === it.foodId);
        cp100 = food ? food.carbs : 0;
        kp100 = food ? food.kcal : null;
      }
      carbs += (cp100 || 0) * it.grams / 100;
      kcal += (kp100 || 0) * it.grams / 100;
    });
    const totalCarbs = Math.round(carbs * 10) / 10;
    const totalKcal = Math.round(kcal);
    const fw = recipe.finalWeight;
    return {
      totalCarbs, totalKcal,
      carbsPer100g: fw ? Math.round((totalCarbs / fw) * 1000) / 10 : null,
      kcalPer100g: fw ? Math.round((totalKcal / fw) * 1000) / 10 : null
    };
  }

  function pickableItems() {
    const foods = state.library.map(f => ({
      id: "food:" + f.id, refType: "food", refId: f.id, name: f.name,
      carbsPer100g: f.carbs, kcalPer100g: f.kcal, notes: f.notes, gi: f.gi || null,
      usageCount: f.usageCount || 0, favorite: f.favorite,
      unitBased: !!f.unitBased, unitLabel: f.unitLabel || null, gramsPerUnit: f.gramsPerUnit || null
    }));
    const recipes = state.recipes.filter(r => r.finalWeight > 0).map(r => {
      const t = recipeTotals(r);
      return {
        id: "recipe:" + r.id, refType: "recipe", refId: r.id, name: r.name,
        carbsPer100g: t.carbsPer100g, kcalPer100g: t.kcalPer100g, notes: r.notes,
        usageCount: r.usageCount || 0, favorite: r.favorite,
        unitBased: false, unitLabel: null, gramsPerUnit: null
      };
    });
    return [...recipes, ...foods];
  }

  function renderFoodPickList() {
    const q = searchInput.value.trim().toLowerCase();
    let items = pickableItems();
    if (q) items = items.filter(i => i.name.toLowerCase().includes(q));
    items.sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0) || a.name.localeCompare(b.name));
    items = items.slice(0, 40);

    foodListBox.innerHTML = "";
    items.forEach(item => {
      const row = document.createElement("div");
      row.className = "food-pick-item" + (selectedPickId === item.id ? " is-selected" : "");
      row.dataset.id = item.id;
      const unitSuffix = item.unitBased ? `/ ${escapeHtml(item.unitLabel)} (${item.gramsPerUnit}g)` : "/ 100g";
      const meta = `<span class="c-carbs">${item.carbsPer100g ?? "?"}g carbs</span>${item.kcalPer100g ? ` · <span class="c-kcal">~${item.kcalPer100g} kcal</span> ${unitSuffix}` : ` ${unitSuffix}`}`;
      row.innerHTML = `
        <div class="food-pick-item__main">
          <p class="food-pick-item__name">${escapeHtml(item.name)}</p>
          <p class="food-pick-item__meta">${meta}</p>
          ${item.notes ? `<p class="food-pick-item__note">${escapeHtml(item.notes)}</p>` : ""}
        </div>
        ${item.refType === "recipe" ? '<span class="food-pick-item__badge">Recipe</span>' : (item.usageCount ? `<span class="food-pick-item__badge">${item.usageCount}×</span>` : "")}
      `;
      foodListBox.appendChild(row);
    });
  }

  foodListBox.addEventListener("click", e => {
    const row = e.target.closest(".food-pick-item");
    if (!row) return;
    selectedPickId = row.dataset.id;
    const items = pickableItems();
    const item = items.find(i => i.id === selectedPickId);
    if (!item) return;
    searchInput.value = item.name;
    renderFoodPickList();
    gramsInput.disabled = false;
    gramsInput.placeholder = item.unitBased ? "Qty" : "Grams";
    gramsInput.step = item.unitBased ? "0.5" : "1";
    gramsInput.focus();
  });

  const searchClearBtn = el("cc-search-clear");
  searchInput.addEventListener("input", () => {
    selectedPickId = null;
    gramsInput.placeholder = "Grams";
    gramsInput.step = "1";
    searchClearBtn.hidden = searchInput.value.length === 0;
    renderFoodPickList();
  });
  searchClearBtn.addEventListener("click", () => {
    searchInput.value = "";
    searchInput.dispatchEvent(new Event("input", { bubbles: true }));
    searchInput.focus();
  });

  function addSelectedToMeal() {
    if (!selectedPickId) return;
    const [type, id] = selectedPickId.split(":");
    const items = pickableItems();
    const item = items.find(i => i.id === selectedPickId);
    if (!item || item.carbsPer100g == null) return;
    const entered = parseFloat(gramsInput.value);
    if (!entered || entered <= 0) { gramsInput.focus(); return; }

    let grams, quantity = null, unitLabel = null;
    if (item.unitBased) {
      quantity = entered;
      unitLabel = item.unitLabel;
      grams = quantity * item.gramsPerUnit;
    } else {
      grams = entered;
    }

    draft.items.push({
      refType: type, refId: id, name: item.name, grams, quantity, unitLabel,
      gramsPerUnit: item.unitBased ? item.gramsPerUnit : null,
      carbsPer100g: item.carbsPer100g, kcalPer100g: item.kcalPer100g, gi: item.gi || null,
      carbs: Math.round(item.carbsPer100g * grams) / 100,
      kcal: item.kcalPer100g ? Math.round(item.kcalPer100g * grams) / 100 : null
    });
    selectedPickId = null;
    searchInput.value = "";
    searchClearBtn.hidden = true;
    gramsInput.value = "";
    gramsInput.disabled = false;
    gramsInput.placeholder = "Grams";
    gramsInput.step = "1";
    renderFoodPickList();
    renderMealItems();
    recompute();
    saveDraftLocal();
  }

  addBtn.addEventListener("click", addSelectedToMeal);
  gramsInput.addEventListener("keydown", e => { if (e.key === "Enter") addSelectedToMeal(); });

  function renderMealItems() {
    el("cc-current-meal-header").hidden = draft.items.length === 0;
    mealItemsBox.innerHTML = "";
    draft.items.forEach((item, idx) => {
      const row = document.createElement("div");
      row.className = "meal-item";
      row.dataset.idx = idx;
      const isUnit = item.quantity != null && item.unitLabel;
      const qtyDisplay = isUnit ? formatQty(item.quantity) : item.grams;
      const suffix = isUnit ? " " + escapeHtml(item.unitLabel) + (item.quantity === 1 ? "" : "s") : "g";
      row.innerHTML = `
        <button class="meal-item__edit-reveal" type="button" aria-label="Edit">
          <svg viewBox="0 0 24 24" fill="none"><path d="M4 20l4-1 11-11-3-3L5 16z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>
          Edit
        </button>
        <div class="meal-item__content">
          <div class="meal-item__main">
            <p class="meal-item__name">${escapeHtml(item.name)}</p>
            <p class="meal-item__meta">
              <input type="number" class="meal-item__grams-input" min="0" step="${isUnit ? "0.5" : "1"}" value="${qtyDisplay}" data-idx="${idx}" aria-label="${isUnit ? "Quantity" : "Grams"}">${suffix}${item.kcal ? " · ~<span class=\"meal-item__kcal\">" + Math.round(item.kcal) + "</span> kcal" : ""}
            </p>
          </div>
          <div class="meal-item__carbs">${round1(item.carbs)}g</div>
          <button class="meal-item__remove" data-idx="${idx}" aria-label="Remove">
            <svg viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          </button>
        </div>
      `;
      mealItemsBox.appendChild(row);
    });
  }

  mealItemsBox.addEventListener("click", e => {
    const removeBtn = e.target.closest(".meal-item__remove");
    if (removeBtn) {
      draft.items.splice(parseInt(removeBtn.dataset.idx, 10), 1);
      renderMealItems();
      recompute();
      saveDraftLocal();
      return;
    }
    const editBtn = e.target.closest(".meal-item__edit-reveal");
    if (editBtn) {
      const row = editBtn.closest(".meal-item");
      const content = row.querySelector(".meal-item__content");
      content.style.transform = "translateX(0)";
      row.classList.remove("is-swiped");
      const gramsInput = row.querySelector(".meal-item__grams-input");
      gramsInput.classList.add("is-editing");
      gramsInput.focus();
      gramsInput.select();
    }
  });

  mealItemsBox.addEventListener("focusout", e => {
    if (!e.target.classList.contains("meal-item__grams-input")) return;
    e.target.classList.remove("is-editing");
  });

  mealItemsBox.addEventListener("input", e => {
    if (!e.target.classList.contains("meal-item__grams-input")) return;
    const idx = parseInt(e.target.dataset.idx, 10);
    const item = draft.items[idx];
    if (!item) return;
    const entered = parseFloat(e.target.value) || 0;
    let grams;
    if (item.quantity != null && item.gramsPerUnit) {
      item.quantity = entered;
      grams = entered * item.gramsPerUnit;
    } else {
      grams = entered;
    }
    item.grams = grams;
    item.carbs = item.carbsPer100g != null ? Math.round(item.carbsPer100g * grams) / 100 : item.carbs;
    item.kcal = item.kcalPer100g ? Math.round(item.kcalPer100g * grams) / 100 : item.kcal;
    const row = e.target.closest(".meal-item");
    row.querySelector(".meal-item__carbs").textContent = round1(item.carbs) + "g";
    const kcalEl = row.querySelector(".meal-item__kcal");
    if (kcalEl && item.kcal) kcalEl.textContent = Math.round(item.kcal);
    recompute();
    saveDraftLocal();
  });

  // ---- Swipe-to-reveal (pointer events unify touch + mouse) ----
  const SWIPE_REVEAL_PX = 72;
  let swipe = null;
  mealItemsBox.addEventListener("pointerdown", e => {
    const content = e.target.closest(".meal-item__content");
    if (!content || e.target.closest(".meal-item__remove") || e.target.closest(".meal-item__grams-input")) return;
    swipe = { content, row: content.closest(".meal-item"), startX: e.clientX, dx: 0, pointerId: e.pointerId };
    content.style.transition = "none";
    try { content.setPointerCapture(e.pointerId); } catch (err) { /* not supported everywhere, harmless to skip */ }
  });
  mealItemsBox.addEventListener("pointermove", e => {
    if (!swipe || e.pointerId !== swipe.pointerId) return;
    const alreadyOpen = swipe.row.classList.contains("is-swiped");
    const base = alreadyOpen ? -SWIPE_REVEAL_PX : 0;
    swipe.dx = Math.max(-SWIPE_REVEAL_PX, Math.min(0, base + (e.clientX - swipe.startX)));
    swipe.content.style.transform = `translateX(${swipe.dx}px)`;
  });
  function endSwipe(e) {
    if (!swipe || (e && e.pointerId !== swipe.pointerId)) return;
    swipe.content.style.transition = "";
    const open = swipe.dx < -SWIPE_REVEAL_PX / 2;
    swipe.content.style.transform = open ? `translateX(-${SWIPE_REVEAL_PX}px)` : "translateX(0)";
    swipe.row.classList.toggle("is-swiped", open);
    swipe = null;
  }
  mealItemsBox.addEventListener("pointerup", endSwipe);
  mealItemsBox.addEventListener("pointercancel", endSwipe);


  function totalCarbs() { return draft.items.reduce((s, i) => s + i.carbs, 0); }

  // ================= Active Insulin & Carbs (IOB / COB) =================
  // IOB: the "scalable exponential" insulin activity model used by Loop,
  // AndroidAPS, and OpenAPS (originally by Dragan Maksimovic, refined by
  // Pete Schwamb) -- not a bespoke curve. Given a dose's peak activity time
  // (peakMinutes) and total duration of insulin action (diaMinutes), this
  // returns the fraction of that dose still active `minutesAgo` minutes
  // after it was given. tau/a/S are derived (not tuned by hand) so the
  // curve is analytically exactly 1 (100%) at t=0 and exactly 0 at t=DIA,
  // with a smooth single peak in between.

  // COB: a deliberately simple linear decay -- carbs remaining fall at a
  // constant rate from 100% of the meal's carbs at t=0 to 0% at the meal's
  // own absorption time. This trades physiological precision (real
  // absorption is closer to a bell curve) for a curve anyone can audit by
  // hand, which is what was asked for here.

  // Which absorption time applies to a given logged meal, based on its
  // snapshotted compound GI -- reusing the exact same high/medium/low bands
  // (>=70 / 56-69 / <=55) as the compound-GI indicator shown elsewhere in
  // the app, so a meal that reads "high GI" there uses the "high" time here
  // too. Meals with no GI data at all fall back to the "unknown" default.

  // Sums IOB across every logged dose in the last DIA minutes, and COB
  // across every logged meal still within its own absorption window
  // (stacking: overlapping doses/meals just add together, no interaction
  // terms). Also reports the estimated time each will reach zero, computed
  // directly from the model rather than searched for, since each curve is
  // constructed to hit exactly zero at its own dose/meal's cutoff time --
  // the total therefore reaches zero exactly when the last-contributing
  // dose/meal does.

  function formatDuration(ms) {
    const totalMin = Math.max(0, Math.round(ms / 60000));
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    if (h === 0) return `${m}m`;
    if (m === 0) return `${h}h`;
    return `${h}h${m}`;
  }

  // Same as buildActiveSeries, but a real historical view: from midnight
  // today to now, showing what actually happened rather than a forward
  // projection. No "no further doses" caveat needed here -- it's history.
  function buildTodaySeries() {
    const now = Date.now();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const startTime = startOfDay.getTime();
    const stepMs = 10 * 60000; // 10-minute resolution is plenty over a full day
    const points = [];
    for (let t = startTime; t <= now; t += stepMs) {
      const r = calcActiveInsulinAndCarbs(t);
      points.push({ t, iob: r.iob, cob: r.cob });
    }
    return { points, startTime, endTime: now, now };
  }

  // Builds a (time, iob, cob) series for the detail graph: 30 minutes of
  // recent context, then projected forward (assuming no further doses/meals)
  // until whichever of IOB/COB clears last.
  function buildActiveSeries() {
    const now = Date.now();
    const info = calcActiveInsulinAndCarbs(now);
    const startTime = now - 30 * 60000;
    const endTime = Math.max(info.iobClearAt || now, info.cobClearAt || now, now + 30 * 60000);
    const stepMs = 5 * 60000;
    const points = [];
    for (let t = startTime; t <= endTime; t += stepMs) {
      const r = calcActiveInsulinAndCarbs(t);
      points.push({ t, iob: r.iob, cob: r.cob });
    }
    return { points, startTime, endTime, now, info };
  }

  function renderActiveGraphSVG(series) {
    const { points, startTime, endTime, now } = series;
    const W = 320, H = 165, padL = 26, padR = 30, padT = 10, padB = 22;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const maxIob = Math.max(0.5, ...points.map(p => p.iob));
    const maxCob = Math.max(5, ...points.map(p => p.cob));
    const xFor = t => padL + ((t - startTime) / (endTime - startTime)) * plotW;
    const yForIob = v => padT + plotH - (v / maxIob) * plotH;
    const yForCob = v => padT + plotH - (v / maxCob) * plotH;

    const iobPath = points.map((p, i) => `${i === 0 ? "M" : "L"}${xFor(p.t).toFixed(1)},${yForIob(p.iob).toFixed(1)}`).join(" ");
    const cobPath = points.map((p, i) => `${i === 0 ? "M" : "L"}${xFor(p.t).toFixed(1)},${yForCob(p.cob).toFixed(1)}`).join(" ");
    const nowX = xFor(now).toFixed(1);
    const showStartLabel = (parseFloat(nowX) - padL) > 34;
    const nowIsAtEnd = (endTime - now) < ((endTime - startTime) * 0.02); // e.g. the Today tab, where "now" IS the right edge

    const fmtTime = t => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

    // Three horizontal reference lines (0%, 50%, 100% of plot height). Since
    // both curves are scaled to their own max, the same height fractions map
    // to meaningful values on both axes at once -- just different numbers.
    const fracs = [0, 0.5, 1];
    const gridlines = fracs.map(f => {
      const y = padT + plotH * (1 - f);
      const iobVal = (maxIob * f).toFixed(maxIob < 2 ? 2 : 1);
      const cobVal = Math.round(maxCob * f);
      return `
        <line x1="${padL}" y1="${y.toFixed(1)}" x2="${padL + plotW}" y2="${y.toFixed(1)}" stroke="var(--line)" stroke-width="1" ${f === 0 ? "" : 'stroke-dasharray="2,3"'}/>
        <text x="${padL - 4}" y="${(y + 3).toFixed(1)}" font-size="8" fill="#3B82F6" text-anchor="end">${iobVal}</text>
        <text x="${padL + plotW + 4}" y="${(y + 3).toFixed(1)}" font-size="8" fill="#D97706" text-anchor="start">${cobVal}</text>
      `;
    }).join("");

    // Small hourly tick marks along the X-axis for a sense of time scale,
    // in addition to the start/now/end text labels.
    const hourMs = 60 * 60000;
    const firstTick = Math.ceil(startTime / hourMs) * hourMs;
    let xTicks = "";
    for (let t = firstTick; t < endTime; t += hourMs) {
      const x = xFor(t).toFixed(1);
      xTicks += `<line x1="${x}" y1="${padT + plotH}" x2="${x}" y2="${padT + plotH + 3}" stroke="var(--ink-soft)" stroke-width="1"/>`;
    }

    return `
      <svg viewBox="0 0 ${W} ${H}" style="width:100%; height:auto; display:block;">
        ${gridlines}
        ${nowIsAtEnd ? "" : `<line x1="${nowX}" y1="${padT}" x2="${nowX}" y2="${padT + plotH}" stroke="var(--ink-soft)" stroke-width="1" stroke-dasharray="3,3" opacity="0.6"/>`}
        <path d="${cobPath}" fill="none" stroke="#D97706" stroke-width="2" stroke-linejoin="round"/>
        <path d="${iobPath}" fill="none" stroke="#3B82F6" stroke-width="2" stroke-linejoin="round"/>
        ${xTicks}
        ${nowIsAtEnd
          ? `<text x="${padL}" y="${H - 4}" font-size="9" fill="var(--ink-soft)">${fmtTime(startTime)}</text>`
          : (showStartLabel ? `<text x="${padL}" y="${H - 4}" font-size="9" fill="var(--ink-soft)">${fmtTime(startTime)}</text>` : "")}
        ${nowIsAtEnd ? "" : `<text x="${nowX}" y="${H - 4}" font-size="9" fill="var(--ink-soft)" text-anchor="${showStartLabel ? "middle" : "start"}">now</text>`}
        <text x="${padL + plotW}" y="${H - 4}" font-size="9" fill="var(--ink-soft)" text-anchor="end">${nowIsAtEnd ? "now" : fmtTime(endTime)}</text>
      </svg>
    `;
  }

  function renderGlucoseGraphSVG(entries) {
    const points = entries
      .filter(e => typeof e.sgv === "number")
      .map(e => ({ t: e.date, sgv: e.sgv }))
      .sort((a, b) => a.t - b.t);
    if (points.length === 0) return null;

    const W = 320, H = 165, padL = 30, padR = 10, padT = 10, padB = 22;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const startTime = points[0].t, endTime = points[points.length - 1].t;
    const span = Math.max(1, endTime - startTime);
    const maxVal = Math.max(220, ...points.map(p => p.sgv));
    const unit = state.settings.units;
    const toDisplay = v => unit === "mmol" ? convertGlucose(v, "mgdl", "mmol") : v;
    const fmtVal = v => unit === "mmol" ? round1(toDisplay(v)) : Math.round(toDisplay(v));

    const xFor = t => padL + ((t - startTime) / span) * plotW;
    const yFor = v => padT + plotH - (v / maxVal) * plotH;

    const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${xFor(p.t).toFixed(1)},${yFor(p.sgv).toFixed(1)}`).join(" ");
    const lowY = yFor(70).toFixed(1), highY = yFor(180).toFixed(1);

    const fmtTime = t => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const hourMs = 60 * 60000;
    // Pick a labeling interval so ticks and their text always line up -- previously the two
    // edge labels showed the raw fetch start/end time while the tick marks sat on round hours,
    // so the labels never landed under any tick.
    const spanHours = span / hourMs;
    const niceHours = [1, 2, 3, 4, 6, 8, 12].find(h => spanHours / h <= 6) || 12;
    const tickMs = niceHours * hourMs;
    const firstTick = Math.ceil(startTime / tickMs) * tickMs;
    // Every label sits directly under its own tick (same x for both) -- guaranteed aligned,
    // rather than the old approach of separately placing the two edge labels at the raw
    // fetch start/end time, which rarely lined up with the hourly tick marks at all.
    let xTicks = "", xLabels = "";
    for (let t = firstTick; t <= endTime; t += tickMs) {
      const x = xFor(t).toFixed(1);
      xTicks += `<line x1="${x}" y1="${padT + plotH}" x2="${x}" y2="${padT + plotH + 3}" stroke="var(--ink-soft)" stroke-width="1"/>`;
      const anchor = parseFloat(x) < padL + 14 ? "start" : parseFloat(x) > padL + plotW - 14 ? "end" : "middle";
      xLabels += `<text x="${x}" y="${H - 4}" font-size="9" fill="var(--ink-soft)" text-anchor="${anchor}">${fmtTime(t)}</text>`;
    }

    return `
      <svg viewBox="0 0 ${W} ${H}" style="width:100%; height:auto; display:block;">
        <rect x="${padL}" y="${highY}" width="${plotW}" height="${(parseFloat(lowY) - parseFloat(highY)).toFixed(1)}" fill="#22C55E" opacity="0.08"/>
        <line x1="${padL}" y1="${lowY}" x2="${padL + plotW}" y2="${lowY}" stroke="#EF4444" stroke-width="1" stroke-dasharray="2,3" opacity="0.6"/>
        <line x1="${padL}" y1="${highY}" x2="${padL + plotW}" y2="${highY}" stroke="#F59E0B" stroke-width="1" stroke-dasharray="2,3" opacity="0.6"/>
        <text x="${padL - 4}" y="${(parseFloat(lowY) + 3).toFixed(1)}" font-size="8" fill="#EF4444" text-anchor="end">${fmtVal(70)}</text>
        <text x="${padL - 4}" y="${(parseFloat(highY) + 3).toFixed(1)}" font-size="8" fill="#F59E0B" text-anchor="end">${fmtVal(180)}</text>
        <path d="${path}" fill="none" stroke="#3B82F6" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
        <line x1="${padL}" y1="${padT + plotH}" x2="${padL + plotW}" y2="${padT + plotH}" stroke="var(--line)" stroke-width="1"/>
        ${xTicks}
        ${xLabels}
      </svg>
    `;
  }


  const AIOG_TABS = [
    { key: "now", label: "Now" },
    { key: "today", label: "Today" },
    { key: "glucose", label: "Glucose" }
  ];

  function openActiveDetailSheet(initialTab) {
    const backdrop = document.createElement("div");
    backdrop.className = "sheet-backdrop";
    const tabs = nightscoutConfigured() ? AIOG_TABS : AIOG_TABS.filter(t => t.key !== "glucose");
    const startTab = tabs.some(t => t.key === initialTab) ? initialTab : "now";
    backdrop.innerHTML = `
      <div class="sheet">
        <div class="sheet-head">
          <h2>Active Insulin &amp; Carbs</h2>
          <button class="sheet-close" id="aiog-close" type="button" aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
          </button>
        </div>
        <div class="graph-tabs" id="aiog-tabs">
          ${tabs.map(t => `<button class="graph-tab${t.key === startTab ? " is-active" : ""}" data-tab="${t.key}" type="button">${t.label}</button>`).join("")}
        </div>
        <div id="aiog-content"></div>
      </div>
    `;
    document.body.appendChild(backdrop);
    backdrop.addEventListener("click", e => {
      if (e.target === backdrop || e.target.closest("#aiog-close")) closeSheet(backdrop);
    });
    backdrop.querySelectorAll(".graph-tab").forEach(btn => {
      btn.addEventListener("click", () => {
        backdrop.querySelectorAll(".graph-tab").forEach(b => b.classList.remove("is-active"));
        btn.classList.add("is-active");
        renderAiogTab(backdrop, btn.dataset.tab);
      });
    });
    renderAiogTab(backdrop, startTab);
  }

  function aiogLegendHtml() {
    return `
      <div style="display:flex; gap:16px; justify-content:center; margin-top:8px;">
        <span style="display:flex; align-items:center; gap:6px; font-size:0.8rem; color:var(--ink-soft);"><span style="width:10px; height:10px; border-radius:50%; background:#3B82F6; display:inline-block;"></span>Insulin (u)</span>
        <span style="display:flex; align-items:center; gap:6px; font-size:0.8rem; color:var(--ink-soft);"><span style="width:10px; height:10px; border-radius:50%; background:#D97706; display:inline-block;"></span>Carbs (g)</span>
      </div>
    `;
  }

  const GLUCOSE_WINDOWS_HOURS = [3, 6, 12, 24];
  let glucoseWindowHours = 6; // remembered for as long as the app stays open, not persisted

  // A FreeStyle-Libre-style colored banner: big number, trend arrow, how old the reading is.
  function renderGlucoseBannerHtml(entry) {
    if (!entry || typeof entry.sgv !== "number") {
      return `<div class="glucose-banner glucose-banner--unknown"><div class="glucose-banner__label">NO RECENT GLUCOSE</div></div>`;
    }
    const unit = state.settings.units;
    const value = unit === "mmol" ? round1(convertGlucose(entry.sgv, "mgdl", "mmol")) : Math.round(entry.sgv);
    const rangeClass = glucoseRangeClass(entry.sgv);
    const arrow = glucoseTrendArrow(entry.direction);
    const ageMin = Math.round((Date.now() - entry.date) / 60000);
    const ageText = ageMin <= 0 ? "Just now" : ageMin === 1 ? "1 minute ago" : ageMin < 60 ? `${ageMin} minutes ago` : "Over an hour ago";
    return `
      <div class="glucose-banner glucose-banner--${rangeClass}">
        <div class="glucose-banner__label">${escapeHtml(glucoseRangeLabel(rangeClass))}</div>
        <div class="glucose-banner__value">${value}${arrow ? ` <span class="glucose-banner__arrow">${arrow}</span>` : ""}</div>
        <div class="glucose-banner__meta">${unit === "mmol" ? "mmol/L" : "mg/dL"} &middot; ${ageText}</div>
      </div>
    `;
  }

  async function renderAiogTab(backdrop, tab) {
    const content = backdrop.querySelector("#aiog-content");
    if (tab === "now") {
      const series = buildActiveSeries();
      content.innerHTML = `
        <p class="panel-card__hint">Projected forward from now assuming no further food or insulin — a real dose or meal will change this.</p>
        ${renderActiveGraphSVG(series)}
        ${aiogLegendHtml()}
      `;
    } else if (tab === "today") {
      const series = buildTodaySeries();
      content.innerHTML = `
        <p class="panel-card__hint">What actually happened today, from midnight to now.</p>
        ${renderActiveGraphSVG(series)}
        ${aiogLegendHtml()}
      `;
    } else if (tab === "glucose") {
      content.innerHTML = `<p class="panel-card__hint">Loading recent glucose…</p>`;
      const count = glucoseWindowHours * 12; // ~5-minute CGM interval
      const result = await fetchGlucoseHistory(count);
      if (!content.isConnected) return; // sheet was closed while this was loading
      const picker = `
        <div class="glucose-range-picker">
          ${GLUCOSE_WINDOWS_HOURS.map(h => `<button type="button" class="glucose-range-btn${h === glucoseWindowHours ? " is-active" : ""}" data-hours="${h}">${h}h</button>`).join("")}
        </div>
      `;
      if (!result.ok) {
        content.innerHTML = `${picker}<p class="panel-card__hint" style="color:#B91C1C;">Couldn't load glucose: ${escapeHtml(result.reason)}</p>`;
      } else {
        const entries = result.entries.filter(e => typeof e.sgv === "number").sort((a, b) => a.date - b.date);
        const latest = entries[entries.length - 1];
        const svg = renderGlucoseGraphSVG(result.entries);
        content.innerHTML = `
          ${renderGlucoseBannerHtml(latest)}
          ${picker}
          ${svg ? svg : `<p class="panel-card__hint">No recent glucose data found.</p>`}
          ${svg ? `<p class="panel-card__hint" style="margin-top:10px;">Dashed lines mark the standard 70&ndash;180 range.</p>` : ""}
        `;
      }
      content.querySelectorAll(".glucose-range-btn").forEach(btn => {
        btn.addEventListener("click", () => {
          glucoseWindowHours = Number(btn.dataset.hours);
          renderAiogTab(backdrop, "glucose");
        });
      });
    }
  }
  el("active-panel").addEventListener("click", () => openActiveDetailSheet("now"));
  el("cc-live-glucose").addEventListener("click", () => openActiveDetailSheet("glucose"));

  function renderActivePanel() {
    const panel = el("active-panel");
    const { iob, cob, iobClearAt, cobClearAt } = calcActiveInsulinAndCarbs();
    if (iob <= 0 && cob <= 0) { panel.hidden = true; return; }
    panel.hidden = false;
    el("active-iob-value").textContent = `≈${iob.toFixed(1)} u`;
    el("active-cob-value").textContent = `≈${cob} g`;
    const now = Date.now();
    const clearParts = [];
    if (iobClearAt) clearParts.push(`Insulin clears in ~${formatDuration(iobClearAt - now)}`);
    if (cobClearAt) clearParts.push(`${iobClearAt ? "c" : "C"}arbs clear in ~${formatDuration(cobClearAt - now)}`);
    el("active-clear-text").textContent = clearParts.join(" · ");
  }

  function recompute() {
    const carbs = totalCarbs();
    carbsPill.textContent = `${round1(carbs)}g Carbs`;

    const ratioEntry = activeRatioEntry();
    ratioValueLabel.textContent = ratioEntry ? `1:${ratioEntry.ratio}` : "—";

    const mealPart = ratioEntry && ratioEntry.ratio > 0 ? carbs / ratioEntry.ratio : 0;

    let correctionPart = 0;
    let iobSubtracted = 0;
    let rawCorrectionPart = 0;
    if (draft.correctionOn) {
      const bg = parseFloat(glucoseInput.value);
      if (!isNaN(bg) && bg > 0 && state.settings.isf > 0) {
        const bgInSettingsUnit = convertGlucose(bg, draft.glucoseUnit, state.settings.units);
        rawCorrectionPart = Math.max(0, (bgInSettingsUnit - state.settings.target) / state.settings.isf);
        if (state.settings.iobAwareCorrection) {
          const currentIob = calcActiveInsulinAndCarbs().iob;
          iobSubtracted = Math.min(rawCorrectionPart, currentIob);
        }
        correctionPart = rawCorrectionPart - iobSubtracted;
      }
    }
    const iobNote = el("cc-iob-adjust-note");
    if (iobSubtracted > 0.05) {
      iobNote.textContent = `Correction: ${round1(rawCorrectionPart)}u − ${round1(iobSubtracted)}u IOB = ${round1(correctionPart)}u`;
      iobNote.hidden = false;
    } else {
      iobNote.hidden = true;
    }

    // Round each part first, then add the already-rounded numbers -- rounding the raw (unrounded)
    // sum instead can disagree with what the meal and correction pills actually show (e.g. a
    // 3.15u meal shown as "3u" plus a 0.7u correction shown as "0.5u" should total 3.5u, not the
    // 4u you'd get by rounding 3.85 on its own).
    let loggedMealDose = roundDose(mealPart);
    let loggedCorrectionDose = roundDose(correctionPart);
    let finalDose = Math.max(0, loggedMealDose + loggedCorrectionDose);
    if (state.settings.maxDose > 0 && finalDose > state.settings.maxDose) finalDose = state.settings.maxDose;
    if (draft.noInsulinOn) {
      finalDose = 0;
      loggedMealDose = 0;
      loggedCorrectionDose = 0;
    }
    doseNumber.textContent = finalDose.toFixed(1);

    const hasSomethingToLog = draft.noInsulinOn ? carbs > 0 : (carbs > 0 || correctionPart > 0);
    logBtn.disabled = !hasSomethingToLog;
    logBtn.classList.toggle("btn--pulse", hasSomethingToLog);
    clearAllBtn.hidden = !hasSomethingToLog;

    const glIndicator = el("cc-gl-indicator");
    const giInfo = compoundGiInfo(draft.items);
    if (giInfo) {
      const band = giInfo.value >= 70 ? "high" : giInfo.value >= 56 ? "medium" : "low";
      glIndicator.textContent = `GI ${giInfo.value}${giInfo.partial ? "*" : ""}`;
      glIndicator.className = `gl-indicator gl-indicator--${band}`;
      glIndicator.title = giInfo.partial ? "Compound GI, carb-weighted across this meal's items — not all items have a GI value, so this is a partial estimate" : "Compound GI for this meal, weighted by each item's carb contribution";
      glIndicator.hidden = false;
    } else {
      glIndicator.hidden = true;
    }

    draft._computed = { carbs, mealDose: loggedMealDose, correctionDose: loggedCorrectionDose, finalDose, ratioEntry };
  }

  correctionToggle.addEventListener("click", () => {
    draft.correctionOn = !draft.correctionOn;
    correctionToggle.classList.toggle("is-active", draft.correctionOn);
    correctionRow.hidden = !draft.correctionOn;
    el("cc-fetch-glucose").hidden = !(draft.correctionOn && nightscoutConfigured());
    el("cc-fetch-glucose-status").hidden = true;
    if (draft.correctionOn && draft.noInsulinOn) {
      draft.noInsulinOn = false;
      el("cc-no-insulin-toggle").classList.remove("is-active");
      el("cc-no-insulin-note").hidden = true;
    }
    if (!draft.glucoseUnit) draft.glucoseUnit = state.settings.units;
    glucoseUnitLabel.textContent = unitLabel(draft.glucoseUnit);
    if (draft.correctionOn) glucoseInput.focus();
    recompute();
    saveDraftLocal();
  });

  el("cc-no-insulin-toggle").addEventListener("click", () => {
    draft.noInsulinOn = !draft.noInsulinOn;
    el("cc-no-insulin-toggle").classList.toggle("is-active", draft.noInsulinOn);
    el("cc-no-insulin-note").hidden = !draft.noInsulinOn;
    if (draft.noInsulinOn && draft.correctionOn) {
      draft.correctionOn = false;
      correctionToggle.classList.remove("is-active");
      correctionRow.hidden = true;
    }
    recompute();
    saveDraftLocal();
  });
  glucoseInput.addEventListener("input", () => { recompute(); saveDraftLocal(); });
  glucoseUnitLabel.addEventListener("click", () => {
    const newUnit = draft.glucoseUnit === "mmol" ? "mgdl" : "mmol";
    const current = parseFloat(glucoseInput.value);
    if (!isNaN(current)) {
      const converted = convertGlucose(current, draft.glucoseUnit, newUnit);
      glucoseInput.value = newUnit === "mmol" ? round1(converted) : Math.round(converted);
    }
    draft.glucoseUnit = newUnit;
    glucoseUnitLabel.textContent = unitLabel(newUnit);
    recompute();
    saveDraftLocal();
  });

  function renderRatioPicker() {
    const rows = [
      ...state.settings.timeRatios.map(r => ({ ...r, kind: "time" })),
      ...state.settings.activityRatios.map(r => ({ ...r, kind: "activity" }))
    ];
    ratioPicker.innerHTML = rows.map(r => `
      <button class="ratio-picker__item" data-id="${r.id}" type="button">
        <span class="ratio-picker__name"><span class="ratio-picker__dot" style="background:${r.color}"></span>${escapeHtml(r.name)}${r.kind === "time" ? ` <span style="color:var(--ink-soft);font-weight:400;">${r.start}–${r.end}</span>` : ""}</span>
        <span class="ratio-picker__value">1:${r.ratio}</span>
      </button>
    `).join("") + `
      <button class="ratio-picker__item" data-id="__auto__" type="button">
        <span class="ratio-picker__name">Use automatic (time-of-day)</span>
        <span class="ratio-picker__value"></span>
      </button>
    `;
  }

  ratioPill.addEventListener("click", e => {
    e.stopPropagation();
    if (ratioPicker.hidden) { renderRatioPicker(); ratioPicker.hidden = false; }
    else ratioPicker.hidden = true;
  });
  ratioPicker.addEventListener("click", e => {
    e.stopPropagation();
    const btn = e.target.closest(".ratio-picker__item");
    if (!btn) return;
    draft.manualRatioId = btn.dataset.id === "__auto__" ? null : btn.dataset.id;
    ratioPicker.hidden = true;
    recompute();
    saveDraftLocal();
  });
  document.addEventListener("click", () => { ratioPicker.hidden = true; });
  document.addEventListener("keydown", e => { if (e.key === "Escape") ratioPicker.hidden = true; });

  // Persist the in-progress (not-yet-logged) meal to localStorage as it's built,
  // so it survives the browser/app reloading the page after being backgrounded —
  // which mobile browsers commonly do under memory pressure when you switch apps.
  const DRAFT_KEY = "insulinBuddy.draft";
  function saveDraftLocal() {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({
        items: draft.items,
        correctionOn: draft.correctionOn,
        noInsulinOn: draft.noInsulinOn,
        glucose: glucoseInput.value || "",
        glucoseUnit: draft.glucoseUnit,
        manualRatioId: draft.manualRatioId
      }));
    } catch (e) { /* storage unavailable — non-fatal, draft just won't survive a reload */ }
  }
  function loadDraftLocal() {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function clearDraftLocal() { localStorage.removeItem(DRAFT_KEY); }

  function restoreDraftIfAny() {
    const saved = loadDraftLocal();
    if (!saved || !Array.isArray(saved.items) || saved.items.length === 0) return;
    draft.items = saved.items;
    draft.manualRatioId = saved.manualRatioId || null;
    draft.glucoseUnit = saved.glucoseUnit || state.settings.units;
    if (saved.glucose) glucoseInput.value = saved.glucose;
    if (saved.correctionOn) {
      draft.correctionOn = true;
      correctionToggle.classList.add("is-active");
      correctionRow.hidden = false;
      glucoseUnitLabel.textContent = unitLabel(draft.glucoseUnit);
    }
    if (saved.noInsulinOn) {
      draft.noInsulinOn = true;
      el("cc-no-insulin-toggle").classList.add("is-active");
      el("cc-no-insulin-note").hidden = false;
    }
    renderMealItems();
    recompute();
  }

  // Belt-and-suspenders for iOS: per-action saves above should already cover
  // this, but mobile Safari/home-screen web apps can discard the page the
  // moment it's backgrounded, so we also save right at the actual signals
  // for "about to be hidden or unloaded" — and re-check on the way back in,
  // in case the page was resumed from the back/forward cache rather than
  // re-run from scratch (which would otherwise skip the normal boot restore).
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) saveDraftLocal();
  });
  window.addEventListener("pagehide", () => { saveDraftLocal(); });
  window.addEventListener("pageshow", e => { if (e.persisted) restoreDraftIfAny(); });

  function resetDraft() {
    draft = { items: [], correctionOn: false, noInsulinOn: false, glucose: "", glucoseUnit: null, manualRatioId: null };
    searchInput.value = ""; searchClearBtn.hidden = true; gramsInput.value = ""; gramsInput.disabled = false;
    glucoseInput.value = "";
    correctionToggle.classList.remove("is-active");
    correctionRow.hidden = true;
    el("cc-no-insulin-toggle").classList.remove("is-active");
    el("cc-no-insulin-note").hidden = true;
    ratioPicker.hidden = true;
    selectedPickId = null;
    clearDraftLocal();
    renderFoodPickList();
    renderMealItems();
    recompute();
  }
  resetBtn.addEventListener("click", resetDraft);
  clearAllBtn.addEventListener("click", resetDraft);

  // Meal type is detected automatically from time of day — no prompt needed
  function autoMealType(date) {
    const h = date.getHours() + date.getMinutes() / 60;
    if (h >= 5 && h < 10.5) return "breakfast";
    if (h >= 10.5 && h < 14.5) return "lunch";
    if (h >= 14.5 && h < 18) return "snack";
    if (h >= 18 && h < 22.5) return "dinner";
    return "snack";
  }

  logBtn.addEventListener("click", () => {
    const hasCorrection = draft._computed && draft._computed.correctionDose > 0;
    if (totalCarbs() <= 0 && !hasCorrection) return;
    logMeal(totalCarbs() > 0 ? autoMealType(new Date()) : "correction");
  });

  // ---- Bottom-sheet helpers: lock background scroll on mobile while a sheet is open ----
  let openSheetCount = 0;
  function openSheet(backdrop) {
    document.body.appendChild(backdrop);
    openSheetCount++;
    document.body.classList.add("sheet-open");
  }
  function closeSheet(backdrop) {
    backdrop.remove();
    openSheetCount = Math.max(0, openSheetCount - 1);
    if (openSheetCount === 0) document.body.classList.remove("sheet-open");
  }

  function logMeal(mealType) {
    const ratioEntry = draft._computed.ratioEntry;
    const now = new Date();
    const periodEntry = currentTimeRatio(now);
    const glucoseRaw = draft.correctionOn ? parseFloat(glucoseInput.value) : NaN;
    const glucoseVal = !isNaN(glucoseRaw) ? round1(convertGlucose(glucoseRaw, draft.glucoseUnit || state.settings.units, state.settings.units)) : null;
    const entry = {
      id: "h-" + Date.now(),
      ts: now.getTime(),
      mealType,
      periodName: periodEntry ? periodEntry.name.toLowerCase() : "",
      items: draft.items.map(i => ({
        refType: i.refType, refId: i.refId, name: i.name, grams: i.grams,
        quantity: i.quantity ?? null, unitLabel: i.unitLabel ?? null, gramsPerUnit: i.gramsPerUnit ?? null,
        gi: i.gi ?? null,
        carbsPer100g: i.carbsPer100g, kcalPer100g: i.kcalPer100g,
        carbs: i.carbs, kcal: i.kcal
      })),
      totalCarbs: round1(totalCarbs()),
      totalKcal: Math.round(draft.items.reduce((s, i) => s + (i.kcal || 0), 0)),
      glycemicLoad: compoundGiInfo(draft.items),
      mealDose: draft._computed.mealDose,
      correctionDose: draft._computed.correctionDose,
      noInsulin: draft.noInsulinOn,
      glucose: glucoseVal,
      ratioLabel: ratioEntry ? ratioEntry.name : "",
      ratioValue: ratioEntry ? ratioEntry.ratio : null
    };
    state.history.unshift(entry);
    draft.items.forEach(i => {
      if (i.refType === "food") {
        const f = state.library.find(x => x.id === i.refId);
        if (f) f.usageCount = (f.usageCount || 0) + 1;
      } else {
        const r = state.recipes.find(x => x.id === i.refId);
        if (r) r.usageCount = (r.usageCount || 0) + 1;
      }
    });
    saveState();
    syncEntryToNightscout(entry);
    resetDraft();
    renderActivePanel();
  }

  // ================= Nightscout sync =================
  // Sends the carbs + total insulin (and glucose, if a correction was used) for
  // each logged meal to your own Nightscout site, as a standard "Meal Bolus"
  // treatment — the same format apps like Loop and xDrip already use, so it
  // shows up in Nightscout's normal treatment views/reports.




  function nightscoutToken() { return nsToken(state.settings.nightscoutUrl); }
  function nightscoutBaseUrl() { return nsBaseUrl(state.settings.nightscoutUrl); }
  function nightscoutConfigured() { return nsConfigured(state.settings.nightscoutUrl); }
  function nsCfg() { return nightscoutConfigured() ? { baseUrl: nightscoutBaseUrl(), token: nightscoutToken() } : null; }
  const nsFormat = () => (state.settings.nsFormat === "split" ? "split" : "combined");

  // Human wording for a Nightscout failure.
  function friendlyNsError(err) {
    if (!err) return "Something went wrong talking to Nightscout.";
    if (err.kind === "http") {
      return (err.status === 401 || err.status === 403)
        ? `Nightscout rejected the token (HTTP ${err.status}) — check it in Settings.`
        : `Nightscout responded with an error (HTTP ${err.status}).`;
    }
    if (err.kind === "proxy") return err.message;
    if (err.kind === "config") return "Nightscout isn't set up yet.";
    return /not signed in/.test(err.message || "")
      ? "Couldn't reach Nightscout directly (likely CORS) — sign in to Cloud Sync in Settings to fetch through Supabase instead."
      : "Couldn't reach Nightscout — this usually means CORS is blocking it, and the Supabase proxy isn't available either. You can still enter your glucose manually.";
  }

  // Recent glucose history for the trend graph.
  async function fetchGlucoseHistory(count) {
    const cfg = nsCfg();
    if (!cfg) return { ok: false, reason: "Nightscout isn't set up yet." };
    try { const r = await nsClient.read(cfg, count); return { ok: true, entries: r.entries }; }
    catch (e) { return { ok: false, reason: friendlyNsError(e) }; }
  }

  // ---- live glucose pill on the dose card ----
  const LIVE_GLUCOSE_CACHE_KEY = "insulinBuddy.liveGlucose";
  const LIVE_GLUCOSE_STALE_MS = 15 * 60 * 1000;
  let liveGlucose = null; // { mgdl, direction, at } -- cached across reloads so the pill isn't blank while the first fetch is in flight
  try { liveGlucose = JSON.parse(localStorage.getItem(LIVE_GLUCOSE_CACHE_KEY)); } catch (e) { liveGlucose = null; }

  async function refreshLiveGlucose() {
    if (!nightscoutConfigured()) return;
    try {
      const r = await nsClient.read(nsCfg(), 1);
      const entry = Array.isArray(r.entries) ? r.entries[0] : null;
      if (entry && typeof entry.sgv === "number") {
        liveGlucose = { mgdl: entry.sgv, direction: entry.direction || null, at: entry.date || Date.now() };
        localStorage.setItem(LIVE_GLUCOSE_CACHE_KEY, JSON.stringify(liveGlucose));
      }
    } catch (e) {
      // a background poll failing isn't worth interrupting anyone for -- just keep showing the last known reading
    }
    renderLiveGlucosePill();
  }

  function renderLiveGlucosePill() {
    const pill = el("cc-live-glucose");
    if (!pill) return;
    if (!nightscoutConfigured() || !liveGlucose || typeof liveGlucose.mgdl !== "number") { pill.hidden = true; return; }
    const stale = Date.now() - liveGlucose.at > LIVE_GLUCOSE_STALE_MS;
    const value = round1(convertGlucose(liveGlucose.mgdl, "mgdl", state.settings.units));
    const arrow = glucoseTrendArrow(liveGlucose.direction);
    const rangeClass = glucoseRangeClass(liveGlucose.mgdl); // "low" | "high" | "in-range" | null
    const classes = ["glucose-pill"];
    if (rangeClass === "low" || rangeClass === "high") classes.push(`glucose-pill--${rangeClass}`);
    if (stale) classes.push("glucose-pill--stale");
    pill.className = classes.join(" ");
    pill.textContent = arrow ? `${value} ${arrow}` : `${value}`;
    pill.title = stale
      ? "Last reading is more than 15 minutes old"
      : "Latest glucose from Nightscout — always double-check before dosing";
    pill.hidden = false;
  }

  async function fetchCurrentGlucoseFromNightscout() {
    const statusEl = el("cc-fetch-glucose-status");
    statusEl.hidden = false;
    statusEl.className = "correction-row__fetch-status";
    statusEl.textContent = "Fetching…";
    const cfg = nsCfg();
    if (!cfg) { statusEl.textContent = "Nightscout isn't set up yet."; statusEl.classList.add("correction-row__fetch-status--error"); return; }
    try {
      const r = await nsClient.read(cfg, 1);
      applyFetchedGlucoseEntries(r.entries, statusEl);
    } catch (e) {
      statusEl.textContent = friendlyNsError(e);
      statusEl.classList.add("correction-row__fetch-status--error");
    }
  }

  // ---- delivery: everything goes through the outbox so it survives being offline ----
  function syncEntryToNightscout(entry) {
    if (!nightscoutConfigured()) return;
    nsOutbox.enqueueCreate(entry, { format: nsFormat(), units: state.settings.units });
    flushNightscoutQueue();
  }
  // Edits/deletes only follow a meal that has actually been (or is about to be) sent.
  function queueNsUpdate(entry) {
    if (!nightscoutConfigured() || state.settings.nsSyncEdits === false) return;
    if (!entry.ns && !nsOutbox.pendingFor(entry.id)) return;
    nsOutbox.enqueueUpdate(entry, { format: nsFormat(), units: state.settings.units });
    flushNightscoutQueue();
  }
  function queueNsDelete(entry) {
    if (!nightscoutConfigured() || state.settings.nsSyncEdits === false) return;
    nsOutbox.enqueueDelete(entry.id, entry.ns && entry.ns.ids);
    flushNightscoutQueue();
  }
  // Undo of a delete: cancel the pending removal, or re-send if it already went out.
  function undoNsDelete(entry) {
    if (!nightscoutConfigured()) return;
    if (nsOutbox.cancelDelete(entry.id)) return;
    if (entry.ns && entry.ns.ids && Object.values(entry.ns.ids).some(Boolean)) { delete entry.ns; syncEntryToNightscout(entry); }
  }
  // immediate = the user (or the network coming back) asked for a retry, so skip the back-off wait.
  async function flushNightscoutQueue(immediate) {
    const r = immediate === true ? await nsOutbox.retryAll() : await nsOutbox.flush();
    refreshNsUi();
    return r;
  }
  function refreshNsUi() {
    try {
      if (!state) return;
      if (!el("view-settings").hidden) { renderNightscoutSection(); if (!el("panel-data").hidden) renderStatusPanel(); }
      if (!el("view-history").hidden) renderHistoryBadges();
    } catch (e) { /* UI not ready yet */ }
  }

  async function testNightscoutConnection() {
    const cfg = nsCfg();
    if (!cfg) { renderNsStatus("Enter a URL and token first.", true); return; }
    renderNsStatus("Testing…");
    let read, write, cleaned = false;
    try { const r = await nsClient.read(cfg, 1); read = { ok: true, via: r.via }; }
    catch (e) { read = { ok: false, msg: friendlyNsError(e) }; }
    try {
      const w = await nsClient.create(cfg, { eventType: "Note", notes: "Insulin Buddy — connection test (safe to delete)", created_at: new Date().toISOString(), enteredBy: "Insulin Buddy" });
      write = { ok: true, via: w.via, id: w.id };
      if (w.id) { try { await nsClient.remove(cfg, w.id); cleaned = true; } catch (e) { /* not all servers allow deletes */ } }
    } catch (e) { write = { ok: false, msg: friendlyNsError(e) }; }

    const how = v => (v === "proxy" ? "via the Supabase proxy" : "directly");
    if (read.ok && write.ok) {
      const note = cleaned ? " The test note was created and removed again."
        : write.id ? ` A test note was created (record ${write.id}) — feel free to delete it.` : " A test note was created — feel free to delete it.";
      renderNsStatus(`Read works ${how(read.via)} and write works ${how(write.via)}.${note}`);
    } else if (read.ok || write.ok) {
      renderNsStatus(`Read: ${read.ok ? "working " + how(read.via) : "failed — " + read.msg}. Write: ${write.ok ? "working " + how(write.via) : "failed — " + write.msg}.`, true);
    } else {
      renderNsStatus(`Nothing is reaching Nightscout right now. Read: ${read.msg} Write: ${write.msg}`, true);
    }
    if (read.ok) refreshLiveGlucose();
  }

  function applyFetchedGlucoseEntries(data, statusEl) {
    if (!Array.isArray(data) || data.length === 0 || typeof data[0].sgv !== "number") {
      statusEl.textContent = "Reached Nightscout, but it didn't return a recent glucose reading.";
      statusEl.classList.add("correction-row__fetch-status--error");
      return;
    }
    const latest = data[0];
    const ageMin = Math.round((Date.now() - latest.date) / 60000);
    const ageText = ageMin <= 0 ? "just now" : ageMin === 1 ? "1 minute ago" : `${ageMin} minutes ago`;
    const converted = round1(convertGlucose(latest.sgv, "mgdl", draft.glucoseUnit || state.settings.units));
    glucoseInput.value = converted;
    glucoseInput.dispatchEvent(new Event("input", { bubbles: true }));
    if (ageMin > 15) {
      statusEl.textContent = `Loaded, but this reading is from ${ageText} — that's fairly stale. Worth double-checking before dosing.`;
      statusEl.classList.add("correction-row__fetch-status--error");
    } else {
      statusEl.textContent = `Loaded from ${ageText}. Double-check it looks right before dosing.`;
    }
  }

  // Tries the Supabase Edge Function proxy, which makes the Nightscout
  // request server-side (Deno), sidestepping browser CORS entirely. Requires
  // the user to be signed in to Cloud Sync, since the function verifies a
  // Supabase session by default.

  // Fetches recent glucose history (proxy first, falling back to direct) for
  // the trend graph -- same priority as the single-reading fetch elsewhere.

  function recordNightscoutStatus(kind, ok, via, message) {
    const rec = { ok, via, at: Date.now(), message };
    if (kind === "read") nightscoutReadStatus = rec;
    else nightscoutWriteStatus = rec;
    // Keep the System Status panel live if it's currently on screen.
    if (!el("view-settings").hidden && !el("panel-data").hidden) renderStatusPanel();
  }

  el("cc-fetch-glucose").addEventListener("click", fetchCurrentGlucoseFromNightscout);



  function renderNsStatus(message, isError) {
    const box = el("ns-status");
    if (!box) return;
    box.textContent = message;
    box.style.color = isError ? "var(--brick)" : "";
  }



  // Nightscout's POST response normally echoes back the created document(s),
  // including the _id it assigned -- surfacing that here lets you search for
  // this exact record in the raw treatments.json data to confirm it actually
  // persisted, not just that the request returned success.




  window.addEventListener("online", () => { flushNightscoutQueue(true); refreshLiveGlucose(); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { flushNightscoutQueue(true); refreshLiveGlucose(); } });


  // ================= Undo toast =================
  let undoTimer = null;
  let undoAction = null;
  function showUndoToast(message, onUndo) {
    clearTimeout(undoTimer);
    undoAction = onUndo;
    const toast = el("undo-toast");
    el("undo-toast-message").textContent = message;
    toast.hidden = false;
    undoTimer = setTimeout(() => { toast.hidden = true; undoAction = null; }, 5000);
  }
  el("undo-toast-btn").addEventListener("click", () => {
    if (undoAction) undoAction();
    el("undo-toast").hidden = true;
    clearTimeout(undoTimer);
    undoAction = null;
  });

  // ================= Library =================
  let libSeg = "foods"; // 'foods' | 'recipes'
  const libSegmented = el("lib-segmented");
  const libFoodsList = el("lib-foods-list");
  const libRecipesList = el("lib-recipes-list");
  const libEmpty = el("lib-empty");
  const libSearch = el("lib-search");
  const libFilterBtn = el("lib-filter-btn");
  const libFilterPanel = el("lib-filter-panel");
  const libFavOnly = el("lib-fav-only");
  const libCatFilter = el("lib-cat-filter");
  const libSort = el("lib-sort");
  const libAddBtn = el("lib-add-btn");

  CATEGORIES.forEach(c => {
    const opt = document.createElement("option");
    opt.value = c.id; opt.textContent = c.label;
    libCatFilter.appendChild(opt);
  });

  libSegmented.addEventListener("click", e => {
    const btn = e.target.closest(".segmented__btn");
    if (!btn) return;
    libSeg = btn.dataset.seg;
    libSegmented.querySelectorAll(".segmented__btn").forEach(b => b.classList.toggle("is-active", b === btn));
    libSearch.placeholder = libSeg === "foods" ? "Search foods…" : "Search recipes…";
    renderLibrary();
  });

  libFilterBtn.addEventListener("click", () => {
    libFilterPanel.hidden = !libFilterPanel.hidden;
    libFilterBtn.classList.toggle("is-active", !libFilterPanel.hidden);
  });
  [libSearch, libFavOnly, libCatFilter, libSort].forEach(elx => elx.addEventListener("input", renderLibrary));

  function categoryBadge(cat) {
    const c = CATEGORIES.find(x => x.id === cat) || CATEGORIES[CATEGORIES.length - 1];
    return `<span class="lib-item__badge cat-${c.id}">${c.label}</span>`;
  }

  function renderLibrary() {
    libFoodsList.hidden = libSeg !== "foods";
    libRecipesList.hidden = libSeg !== "recipes";
    libAddBtn.setAttribute("aria-label", libSeg === "foods" ? "Add food" : "Add recipe");

    if (libSeg === "foods") renderFoodsLibrary(); else renderRecipesLibrary();
  }

  function renderFoodsLibrary() {
    const q = libSearch.value.trim().toLowerCase();
    let items = state.library.slice();
    if (q) items = items.filter(f => f.name.toLowerCase().includes(q));
    if (libFavOnly.checked) items = items.filter(f => f.favorite);
    if (libCatFilter.value) items = items.filter(f => f.category === libCatFilter.value);
    const sort = libSort.value;
    items.sort((a, b) => {
      if (sort === "usage") return (b.usageCount || 0) - (a.usageCount || 0);
      if (sort === "carbs") return (b.carbs || 0) - (a.carbs || 0);
      return a.name.localeCompare(b.name);
    });

    libFoodsList.innerHTML = "";
    libEmpty.hidden = items.length > 0;
    items.forEach(f => {
      const row = document.createElement("div");
      row.className = "lib-item";
      row.innerHTML = `
        <button class="lib-item__star${f.favorite ? " is-fav" : ""}" data-id="${f.id}" aria-label="Toggle favorite">
          <svg viewBox="0 0 24 24" fill="${f.favorite ? "currentColor" : "none"}"><path d="M12 3.5l2.6 5.6 6 .7-4.4 4.2 1.1 6-5.3-3-5.3 3 1.1-6-4.4-4.2 6-.7z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>
        </button>
        <div class="lib-item__main">
          <p class="lib-item__name">${escapeHtml(f.name)}</p>
          <div class="lib-item__badges">
            ${categoryBadge(f.category)}
            ${f.gi != null ? `<span class="lib-item__badge cat-other">GI ${f.gi}</span>` : ""}
          </div>
          <p class="lib-item__meta"><span class="c-carbs">${f.carbs}g carbs</span>${f.kcal ? ` · <span class="c-kcal">~${f.kcal} kcal</span>` : ""} <span class="lib-item__usage">· ${f.usageCount || 0}×</span></p>
          ${f.unitBased ? `<p class="lib-item__note">1 ${escapeHtml(f.unitLabel)} = ${f.gramsPerUnit}g → ${round1(f.carbs * f.gramsPerUnit / 100)}g carbs</p>` : ""}
          ${f.notes ? `<p class="lib-item__note">${escapeHtml(f.notes)}</p>` : ""}
        </div>
        <div class="lib-item__actions">
          <button data-act="edit" data-id="${f.id}" aria-label="Edit"><svg viewBox="0 0 24 24" fill="none"><path d="M4 20l4-1 11-11-3-3L5 16z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg></button>
          <button data-act="copy" data-id="${f.id}" aria-label="Duplicate"><svg viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M5 15V6a2 2 0 012-2h9" stroke="currentColor" stroke-width="1.6"/></svg></button>
          <button class="danger" data-act="delete" data-id="${f.id}" aria-label="Delete"><svg viewBox="0 0 24 24" fill="none"><path d="M5 7h14M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m-9 0l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        </div>
      `;
      libFoodsList.appendChild(row);
    });
  }

  libFoodsList.addEventListener("click", e => {
    const starBtn = e.target.closest(".lib-item__star");
    if (starBtn) {
      const f = state.library.find(x => x.id === starBtn.dataset.id);
      if (f) { f.favorite = !f.favorite; saveState(); renderFoodsLibrary(); }
      return;
    }
    const actBtn = e.target.closest("[data-act]");
    if (!actBtn) return;
    const id = actBtn.dataset.id;
    const f = state.library.find(x => x.id === id);
    if (!f) return;
    if (actBtn.dataset.act === "edit") openFoodSheet(f);
    if (actBtn.dataset.act === "copy") {
      const copy = { ...f, id: "food-" + Date.now(), name: f.name + " (copy)", usageCount: 0 };
      state.library.unshift(copy);
      saveState(); renderFoodsLibrary();
    }
    if (actBtn.dataset.act === "delete") {
      const idx = state.library.findIndex(x => x.id === id);
      const [removed] = state.library.splice(idx, 1);
      saveState(); renderFoodsLibrary();
      showUndoToast(`Deleted "${removed.name}"`, () => {
        state.library.splice(idx, 0, removed);
        saveState(); renderFoodsLibrary();
      });
    }
  });

  // Newest first. version-badge-text/version-summary-text in the Settings
  // card are always drawn from CHANGELOG[0], so the two can never drift.
  const CHANGELOG = [
    {
      version: "2.0.0",
      summary: "Multi-device sync no longer loses data; Nightscout sync now follows edits and deletes; big safety net added underneath everything.",
      changes: [
        "Fixed: using the app on two devices could silently overwrite meals logged on the other one — changes from both devices are now merged instead",
        "Fixed: deleting a meal could come back if another device synced afterwards — deletes now stick",
        "Editing or deleting a logged meal now updates or removes it in Nightscout too (previously only the first write ever reached Nightscout); this can be turned off in Settings",
        "Nightscout can now send each meal as one combined entry or as separate carb/insulin entries — your choice in Settings",
        "The Nightscout connection now goes through a rewritten, hardened proxy (no more open-URL risk) — old direct-URL fallback still works if you're briefly offline",
        "Fixed a security issue where a food's saved name/unit could run code on the History screen",
        "History now loads instantly regardless of how many meals you have (older meals load with a \"Show older\" button), and can be searched",
        "Added a Nightscout sync status badge on each meal in History — tap it to see details or retry a failed one",
        "Fixed: editing a \"treating a low\" entry could accidentally add back an insulin dose",
        "Fixed: correction-only entries (no food) couldn't be saved from the edit sheet",
        "Fixed: editing a meal's items didn't recompute how quickly its carbs are absorbed, leaving Active Insulin & Carbs slightly stale afterwards",
        "This device now automatically keeps its last 10 backups (Settings → Data), so a bad sync or accidental import/delete can be undone",
        "Added a Diagnostics report (Settings → Data) — a copyable, redacted summary to help track down sync or Nightscout problems",
        "Alerts and confirmations now use the app's own style instead of the browser's plain pop-ups",
        "Added offline caching (a service worker) that updates itself automatically on each new deploy, so you are never stuck on stale code",
        "Internal: rebuilt on a tested module architecture (over 140 automated tests covering the sync/merge logic, Nightscout delivery, and the security proxy)"
      ]
    },
    {
      version: "1.12.1",
      summary: "The food list now uses the full window height on tablets and computers.",
      changes: [
        "On wider screens the Add Food list grows to fill the window instead of stopping at a fixed height, so you see many more foods at once",
        "Phones are unchanged, and the list never gets shorter than before on small windows"
      ]
    },
    {
      version: "1.12.0",
      summary: "Trends overhaul: real axes and averages, tap any day for exact numbers, meal vs correction insulin, and a per-meal breakdown.",
      changes: [
        "Charts now have proper axes, a dashed average line, weekend shading and weekday labels, with today highlighted",
        "Tap any day to see its exact carbs and insulin -- the same day lights up in both charts so you can compare them",
        "Insulin bars now split meal insulin from correction insulin, with the correction share shown underneath",
        "New insight cards: carbs per unit, corrections, and lows treated",
        "New 'By meal' card comparing average carbs, dose and g-per-unit for breakfast, lunch, dinner and snacks",
        "Averages now use complete days only (today is left out until it's over) so a half-finished day no longer drags them down",
        "Fixed day buckets breaking across clock changes, which would have blanked days in the charts after 25 October"
      ]
    },
    {
      version: "1.11.1",
      summary: "Actually fixed the Active Insulin & Carbs panel's spacing this time -- the chevron was leaving ~100px of dead space after it.",
      changes: [
        "The stat content and the chevron are now properly balanced across the full row, instead of clustering left with a large empty gap afterward",
        "The chevron sits at the true trailing edge of the panel, matching standard disclosure-indicator placement"
      ]
    },
    {
      version: "1.11.0",
      summary: "The Active Insulin & Carbs graph now has three tabs: the forward projection, today's real history, and (with Nightscout) an actual glucose trend.",
      changes: [
        "Added tabs to the graph: \"Now\" (the existing forward projection), \"Today\" (what actually happened from midnight to now), and \"Glucose\" (a real CGM trend from Nightscout, when configured)",
        "The Glucose tab shows the last ~6 hours with the standard 70\u2013180 range shaded, using the same Supabase proxy as the rest of Nightscout sync",
        "Fixed a label overlap on the Today tab, where \"now\" and the end-of-graph time always coincide"
      ]
    },
    {
      version: "1.10.3",
      summary: "Test Connection now shows Nightscout's actual response (including the created-document id), to diagnose writes that report success but don't persist.",
      changes: [
        "The write proxy now forwards Nightscout's real response body instead of a plain yes/no",
        "Test Connection and every real sync now report the id Nightscout assigned the new record, or a clear note when one wasn't returned",
        "This surfaces cases where a write reports success but nothing actually lands in the treatments collection"
      ]
    },
    {
      version: "1.10.2",
      summary: "System Status now shows Nightscout read and write separately, and Test Connection reports the real, complete picture.",
      changes: [
        "Split \"Nightscout Sync\" into separate, auditable Read and Write rows, showing which path (Supabase proxy or direct) actually succeeded and when",
        "Both rows reflect real usage automatically -- every actual fetch or sync updates them, not just a manual test",
        "Test Connection now actually exercises the Supabase proxy for both read and write, instead of only ever testing the direct path -- so it no longer says \"could not reach\" when sync is genuinely working via the proxy"
      ]
    },
    {
      version: "1.10.1",
      summary: "Nightscout sync (carbs and insulin) now also routes through the Supabase proxy, fixing the CORS block that stopped writes before.",
      changes: [
        "New Supabase Edge Function (write-nightscout-treatment) posts meal/correction data to Nightscout server-side",
        "Meal sync and the queued-retry sync both now try this proxy first when signed in, falling back to a direct request otherwise",
        "Test Connection now clarifies that a direct CORS failure doesn't mean sync itself is broken, since the proxy covers it"
      ]
    },
    {
      version: "1.10.0",
      summary: "Nightscout glucose fetch now routes through a Supabase proxy first, sidestepping the CORS block entirely when you're signed in.",
      changes: [
        "New Supabase Edge Function (fetch-nightscout-glucose) makes the Nightscout request server-side, where browser CORS restrictions don't apply",
        "Fetch from Nightscout now tries this proxy first when signed in to Cloud Sync, falling back to a direct request otherwise",
        "Clear messaging when the proxy isn't available because you're not signed in"
      ]
    },
    {
      version: "1.9.2",
      summary: "Fixed an oversized logged-time field and a wasted line taken up by the reset icon.",
      changes: [
        "The logged-time field in Edit Meal now sizes to its content instead of stretching full width",
        "Moved the reset (trash) icon up next to the carbs pill, so it no longer forces the dose card's pills onto an extra line by itself"
      ]
    },
    {
      version: "1.9.1",
      summary: "Edit a meal's logged time (with Active Insulin & Carbs updating to match), and a more compact dose card.",
      changes: [
        "Edit Meal now includes the logged time — changing it correctly re-sorts History and recalculates Active Insulin & Carbs",
        "Reduced the size of the dose card at the top of the Calculator — smaller text, tighter spacing, pills now fit on one line"
      ]
    },
    {
      version: "1.9.0",
      summary: "Log carbs with no insulin when treating a low, and optionally pull your glucose straight from Nightscout.",
      changes: [
        "New \"Treating a Low\" toggle — logs your food and carbs as usual but always records zero insulin, regardless of your ratio",
        "Carbs logged this way still count toward Carbs on Board; insulin correctly stays at zero on the Active Insulin & Carbs panel",
        "New \"Fetch from Nightscout\" option in the Correction row, pulling your latest CGM reading (shows its age, and flags it if it's more than 15 minutes stale)"
      ]
    },
    {
      version: "1.8.3",
      summary: "The Active Insulin & Carbs graph now shows real axis values, and corrections can optionally account for IOB.",
      changes: [
        "The graph now shows actual insulin (units) and carb (grams) values on its axes, color-matched to each line, plus hourly time ticks",
        "New optional setting (off by default): subtract active insulin from a correction dose, the same way pump bolus calculators do — your meal dose is never affected",
        "When active, the Calculator shows the exact breakdown (e.g. \"Correction: 4u − 3.6u IOB = 0.4u\") rather than hiding the adjustment"
      ]
    },
    {
      version: "1.8.2",
      summary: "The Active Insulin & Carbs panel is now tappable for a graph, and more compact.",
      changes: [
        "Tap the Active Insulin & Carbs panel to see a graph of insulin and carbs projected forward until both clear",
        "Made the panel itself noticeably smaller",
        "Moved its Insulin & Carb Timing settings into the Insulin Ratios tab, alongside your other dosing settings"
      ]
    },
    {
      version: "1.8.1",
      summary: "You can now log a correction on its own, with no food required.",
      changes: [
        "The Log button now works for a correction-only entry (no food added)",
        "Correction-only entries get their own label and icon in History, instead of being mislabeled by time of day",
        "Active Insulin & Carbs correctly counts a correction-only dose as IOB"
      ]
    },
    {
      version: "1.8.0",
      summary: "New: an Active Insulin & Carbs panel on the Calculator, estimating what's still on board.",
      changes: [
        "Added an Active Insulin & Carbs panel showing estimated IOB and COB, with time until each clears",
        "Uses the same exponential insulin model as Loop/AndroidAPS/OpenAPS, with editable peak time and duration (presets for NovoRapid/Humalog and Fiasp/Lyumjev)",
        "Carb absorption time now editable per GI band in Settings",
        "Display only — these estimates never feed into your suggested dose"
      ]
    },
    {
      version: "1.7.0",
      summary: "Ratio editing on logged meals, clearer meal icons, and a quicker way to clear search.",
      changes: [
        "Edit a previously logged meal's insulin ratio, not just its items",
        "Breakfast, Lunch, and Dinner now each have a distinct, clearer icon",
        "Added a quick clear (×) button to the food search field"
      ]
    },
    {
      version: "1.6.0",
      summary: "A cloud sync bug that could lose history has been fixed, with a permanent safeguard added.",
      changes: [
        "Fixed a bug where a failed cloud sync could overwrite real data with an empty state",
        "Added a general safeguard that blocks any future sync from silently erasing existing history",
        "Added a System Status panel showing cloud sync, Nightscout, and offline status at a glance"
      ]
    },
    {
      version: "1.5.0",
      summary: "Personalize your background, and let the app follow your device's appearance automatically.",
      changes: [
        "Added custom background colors, independent of your color theme",
        'Added "Match System Appearance" to follow your device\'s light/dark setting automatically'
      ]
    },
    {
      version: "1.4.0",
      summary: "A visual refresh across Settings for better consistency and readability.",
      changes: [
        "Insulin ratio rows are now color-coded to match the 24h timeline",
        "Distinct icons and colors for Account, Nightscout, and Privacy sections",
        "Reduced clutter and tightened spacing throughout Settings and the Food Library"
      ]
    },
    {
      version: "1.3.0",
      summary: "Faster logging with a sticky Log button, and a more compact calculator.",
      changes: [
        "The Log Meal button now stays fixed at the bottom of the screen",
        "Reduced font sizes and spacing across the calculator for more content per screen"
      ]
    },
    {
      version: "1.2.0",
      summary: "Glycemic index tracking, so you can see how a meal might affect your blood sugar.",
      changes: [
        "Added glycemic index (GI) to many common foods",
        "Meals now show a carb-weighted compound GI, not just total carbs"
      ]
    },
    {
      version: "1.1.0",
      summary: "Unit-based foods, trends, and Nightscout integration.",
      changes: [
        'Foods can now be logged by quantity (e.g. "1 slice") instead of just grams',
        "Added a Trends view with daily carb and dose charts",
        "Added automatic Nightscout sync for logged meals"
      ]
    },
    {
      version: "1.0.0",
      summary: "The original rebuild — a dependency-free, static version of the Base44 app.",
      changes: [
        "Full rebuild of the original insulin dose calculator as a static web app",
        "Runs entirely in your browser — nothing is sent anywhere unless you set up sync"
      ]
    }
  ];

  function renderVersionCard() {
    const latest = CHANGELOG[0];
    el("version-badge-text").innerHTML = `v${latest.version} <svg viewBox="0 0 24 24" fill="none" width="14" height="14"><path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    el("version-summary-text").textContent = `${latest.summary} Tap to see what's changed.`;
  }
  el("btn-open-changelog").addEventListener("click", openChangelogSheet);
  renderVersionCard();

  function openChangelogSheet() {
    const backdrop = document.createElement("div");
    backdrop.className = "sheet-backdrop";
    backdrop.innerHTML = `
      <div class="sheet">
        <div class="sheet-head">
          <h2>What's changed</h2>
          <button class="sheet-close" id="cl-close" type="button" aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
          </button>
        </div>
        ${CHANGELOG.map((entry, i) => `
          <div class="changelog-entry">
            <div class="changelog-entry__head">
              <span class="changelog-entry__version">v${entry.version}</span>
              ${i === 0 ? '<span class="changelog-entry__current">Current</span>' : ""}
            </div>
            <ul class="changelog-entry__list">
              ${entry.changes.map(c => `<li>${escapeHtml(c)}</li>`).join("")}
            </ul>
          </div>
        `).join("")}
      </div>
    `;
    document.body.appendChild(backdrop);
    backdrop.addEventListener("click", e => {
      if (e.target === backdrop || e.target.closest("#cl-close")) closeSheet(backdrop);
    });
  }

  function openFoodSheet(food) {
    const isEdit = !!food;
    const f = food || { name: "", category: "other", carbs: "", kcal: "", fat: "", protein: "", salt: "", notes: "", favorite: false, unitBased: false, unitLabel: "", gramsPerUnit: "" };
    const backdrop = document.createElement("div");
    backdrop.className = "sheet-backdrop";
    backdrop.innerHTML = `
      <div class="sheet">
        <div class="sheet-head">
          <h2>${isEdit ? "Edit Food" : "Add New Food"}</h2>
          <button class="sheet-close" id="fs-close" type="button" aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
          </button>
        </div>
        <div class="field">
          <label>Food Name</label>
          <input type="text" id="fs-name" value="${escapeAttr(f.name)}" placeholder="e.g., Brown Rice" autocomplete="off" autocorrect="off">
        </div>

        <div class="field-inline-row">
          <label>Carbs per 100g</label>
          <input type="number" id="fs-carbs" value="${f.carbs ?? ""}" step="0.1" placeholder="e.g., 28">
        </div>
        <div class="field-inline-row">
          <label>Calories per 100g <span class="field__optional">(optional)</span></label>
          <input type="number" id="fs-kcal" value="${f.kcal ?? ""}" step="1" placeholder="e.g., 150">
        </div>
        <div class="field-inline-row">
          <label>Fat per 100g <span class="field__optional">(optional)</span></label>
          <input type="number" id="fs-fat" value="${f.fat ?? ""}" step="0.1" placeholder="e.g., 5">
        </div>
        <div class="field-inline-row">
          <label>Protein per 100g <span class="field__optional">(optional)</span></label>
          <input type="number" id="fs-protein" value="${f.protein ?? ""}" step="0.1" placeholder="e.g., 8">
        </div>
        <div class="field-inline-row">
          <label>Salt per 100g <span class="field__optional">(optional)</span></label>
          <input type="number" id="fs-salt" value="${f.salt ?? ""}" step="0.1" placeholder="e.g., 0.5">
        </div>
        <div class="field-inline-row">
          <label>Glycemic Index <span class="field__optional">(optional)</span></label>
          <input type="number" id="fs-gi" value="${f.gi ?? ""}" step="1" min="0" max="110" placeholder="e.g., 55">
        </div>

        <div class="checkbox-row" style="margin-top:18px;">
          <label><input type="checkbox" id="fs-unit-based" ${f.unitBased ? "checked" : ""}> Log this by quantity, not weight</label>
        </div>
        <p class="panel-card__hint" style="margin:-10px 0 14px;">e.g., "1 sandwich" instead of grams. The nutrition above still applies per 100g — we just need to know how much one whole item weighs.</p>
        <div class="unit-fields" id="fs-unit-fields" ${f.unitBased ? "" : "hidden"}>
          <div class="field-grid" style="margin-bottom:16px;">
            <div class="field" style="margin-bottom:0;"><label>Unit name</label><input type="text" id="fs-unit-label" value="${escapeAttr(f.unitLabel || "")}" placeholder="e.g., sandwich"></div>
            <div class="field" style="margin-bottom:0;"><label>Weight per unit (g)</label><input type="number" id="fs-grams-per-unit" value="${f.gramsPerUnit ?? ""}" step="1" placeholder="e.g., 220"></div>
          </div>
        </div>

        <div class="field">
          <label>Category</label>
          <select id="fs-cat">
            ${CATEGORIES.map(c => `<option value="${c.id}" ${c.id === f.category ? "selected" : ""}>${c.label}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label>Notes <span class="field__optional">(optional)</span></label>
          <textarea id="fs-notes" rows="2" placeholder="e.g., High fiber, good for breakfast&hellip;">${escapeHtml(f.notes || "")}</textarea>
        </div>
        <div class="checkbox-row"><label><input type="checkbox" id="fs-fav" ${f.favorite ? "checked" : ""}> Favorite</label></div>
        <div class="sheet-actions">
          <button class="btn btn--secondary" id="fs-cancel" type="button">Cancel</button>
          <button class="btn btn--primary" id="fs-save" type="button">${isEdit ? "Save Changes" : "Add Food"}</button>
        </div>
      </div>
    `;
    openSheet(backdrop);
    backdrop.querySelector("#fs-unit-based").addEventListener("change", e => {
      backdrop.querySelector("#fs-unit-fields").hidden = !e.target.checked;
    });
    backdrop.addEventListener("click", e => { if (e.target === backdrop || e.target.id === "fs-cancel" || e.target.closest("#fs-close")) closeSheet(backdrop); });
    backdrop.querySelector("#fs-save").addEventListener("click", () => {
      const name = backdrop.querySelector("#fs-name").value.trim();
      const carbs = parseFloat(backdrop.querySelector("#fs-carbs").value);
      if (!name || isNaN(carbs)) { alert("Please enter at least a name and carbs per 100g."); return; }
      const unitBased = backdrop.querySelector("#fs-unit-based").checked;
      const unitLabel = backdrop.querySelector("#fs-unit-label").value.trim();
      const gramsPerUnit = parseFloat(backdrop.querySelector("#fs-grams-per-unit").value);
      if (unitBased && (!unitLabel || !gramsPerUnit || gramsPerUnit <= 0)) {
        alert("For a quantity-based food, please give it a unit name and a weight per unit greater than 0.");
        return;
      }
      const payload = {
        name,
        category: backdrop.querySelector("#fs-cat").value,
        carbs,
        kcal: parseFloat(backdrop.querySelector("#fs-kcal").value) || null,
        fat: parseFloat(backdrop.querySelector("#fs-fat").value) || null,
        protein: parseFloat(backdrop.querySelector("#fs-protein").value) || null,
        salt: parseFloat(backdrop.querySelector("#fs-salt").value) || null,
        gi: parseFloat(backdrop.querySelector("#fs-gi").value) || null,
        notes: backdrop.querySelector("#fs-notes").value.trim(),
        favorite: backdrop.querySelector("#fs-fav").checked,
        unitBased,
        unitLabel: unitBased ? unitLabel : null,
        gramsPerUnit: unitBased ? gramsPerUnit : null
      };
      if (isEdit) Object.assign(f, payload);
      else state.library.unshift({ id: "food-" + Date.now(), usageCount: 0, ...payload });
      saveState();
      renderFoodsLibrary();
      closeSheet(backdrop);
    });
  }


  function renderRecipesLibrary() {
    const q = libSearch.value.trim().toLowerCase();
    let items = state.recipes.slice();
    if (q) items = items.filter(r => r.name.toLowerCase().includes(q));
    if (libFavOnly.checked) items = items.filter(r => r.favorite);
    libRecipesList.innerHTML = "";
    libEmpty.hidden = items.length > 0;
    items.forEach(r => {
      const t = recipeTotals(r);
      const row = document.createElement("div");
      row.className = "lib-item";
      const perG = t.carbsPer100g != null
        ? `<span class="c-carbs">${t.carbsPer100g}g carbs</span>${t.kcalPer100g ? ` · <span class="c-kcal">~${t.kcalPer100g} kcal</span>` : ""}`
        : `<span style="color:var(--brick);">Set a final weight to use this in the Calculator</span>`;
      row.innerHTML = `
        <button class="lib-item__star${r.favorite ? " is-fav" : ""}" data-id="${r.id}" aria-label="Toggle favorite">
          <svg viewBox="0 0 24 24" fill="${r.favorite ? "currentColor" : "none"}"><path d="M12 3.5l2.6 5.6 6 .7-4.4 4.2 1.1 6-5.3-3-5.3 3 1.1-6-4.4-4.2 6-.7z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>
        </button>
        <div class="lib-item__main">
          <p class="lib-item__name">${escapeHtml(r.name)}</p>
          <div class="lib-item__badges">${categoryBadge(r.category || "other")}</div>
          <p class="lib-item__meta">${perG} <span class="lib-item__usage">· ${r.usageCount || 0}×</span></p>
          <p class="lib-item__note">${r.items.map(it => {
            const name = it.name || (state.library.find(x => x.id === it.foodId) || {}).name;
            return name ? `${name} (${it.grams}g)` : "";
          }).filter(Boolean).join(", ")}${r.finalWeight ? ` — final weight ${r.finalWeight}g` : ""}</p>
        </div>
        <div class="lib-item__actions">
          <button data-act="edit" data-id="${r.id}" aria-label="Edit"><svg viewBox="0 0 24 24" fill="none"><path d="M4 20l4-1 11-11-3-3L5 16z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg></button>
          <button class="danger" data-act="delete" data-id="${r.id}" aria-label="Delete"><svg viewBox="0 0 24 24" fill="none"><path d="M5 7h14M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m-9 0l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        </div>
      `;
      libRecipesList.appendChild(row);
    });
  }

  libRecipesList.addEventListener("click", e => {
    const starBtn = e.target.closest(".lib-item__star");
    if (starBtn) {
      const r = state.recipes.find(x => x.id === starBtn.dataset.id);
      if (r) { r.favorite = !r.favorite; saveState(); renderRecipesLibrary(); }
      return;
    }
    const actBtn = e.target.closest("[data-act]");
    if (!actBtn) return;
    const r = state.recipes.find(x => x.id === actBtn.dataset.id);
    if (!r) return;
    if (actBtn.dataset.act === "edit") openRecipeSheet(r);
    if (actBtn.dataset.act === "delete") {
      const idx = state.recipes.findIndex(x => x.id === r.id);
      const [removed] = state.recipes.splice(idx, 1);
      saveState(); renderRecipesLibrary();
      showUndoToast(`Deleted "${removed.name}"`, () => {
        state.recipes.splice(idx, 0, removed);
        saveState(); renderRecipesLibrary();
      });
    }
  });

  function openRecipeSheet(recipe) {
    const isEdit = !!recipe;
    const r = recipe || { name: "", category: "other", notes: "", favorite: false, items: [], rawWeight: null, finalWeight: "" };
    let items = r.items.length ? r.items.map(it => ({ ...it })) : [];
    let ingredientSelection = null; // { foodId, name }

    const backdrop = document.createElement("div");
    backdrop.className = "sheet-backdrop";
    backdrop.innerHTML = `
      <div class="sheet">
        <div class="sheet-head sheet-head--recipe">
          <button class="sheet-back" id="rs-back" type="button" aria-label="Back">
            <svg viewBox="0 0 24 24" fill="none"><path d="M15 5l-7 7 7 7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <span class="sheet-head__icon">
            <svg viewBox="0 0 24 24" fill="none"><path d="M6 10.5c0-2.5 2.5-5 6-5s6 2.5 6 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M4.5 10.5h15L18 20a1.5 1.5 0 01-1.5 1.3h-9A1.5 1.5 0 016 20l-1.5-9.5z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
          </span>
          <h2>${isEdit ? "Edit Recipe" : "Create Recipe"}</h2>
          <button class="sheet-close" id="rs-close" type="button" aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
          </button>
        </div>

        <div class="field-grid">
          <div class="field"><label>Recipe Name</label><input type="text" id="rs-name" value="${escapeAttr(r.name)}" placeholder="e.g., Chocolate Cake" autocomplete="off" autocorrect="off"></div>
          <div class="field"><label>Category</label>
            <select id="rs-cat">${CATEGORIES.map(c => `<option value="${c.id}" ${c.id === r.category ? "selected" : ""}>${c.label}</option>`).join("")}</select>
          </div>
        </div>

        <label class="block-label">Ingredients</label>
        <div class="ingredient-box">
          <div class="ingredient-search-wrap">
            <input type="text" id="rs-ing-search" placeholder="Search ingredients&hellip;" autocomplete="off">
            <div class="ingredient-dropdown" id="rs-ing-dropdown" hidden></div>
          </div>
          <div class="ingredient-add-row">
            <input type="number" id="rs-ing-weight" placeholder="Grams" min="0">
            <button type="button" id="rs-ing-add" aria-label="Add ingredient">
              <svg viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
            </button>
          </div>
          <div id="rs-ing-list" class="ingredient-list"></div>
        </div>

        <div class="field-grid" style="margin-top:16px;">
          <div class="field"><label>Raw Weight (g)</label><input type="number" id="rs-raw-weight" min="0" value="${r.rawWeight ?? ""}" placeholder="Optional"></div>
          <div class="field"><label>Final Weight (g) *</label><input type="number" id="rs-final-weight" min="0" value="${r.finalWeight ?? ""}" placeholder="e.g., 800"></div>
        </div>

        <div class="field">
          <label>Notes <span class="field__optional">(Optional)</span></label>
          <textarea id="rs-notes" rows="2" placeholder="Cooking instructions, tips, etc&hellip;">${escapeHtml(r.notes || "")}</textarea>
        </div>
        <div class="checkbox-row"><label><input type="checkbox" id="rs-fav" ${r.favorite ? "checked" : ""}> Favorite</label></div>

        <div class="sheet-actions">
          <button class="btn btn--secondary" id="rs-cancel" type="button">Cancel</button>
          <button class="btn btn--primary" id="rs-save" type="button">${isEdit ? "Save Changes" : "Save Recipe"}</button>
        </div>
      </div>
    `;
    openSheet(backdrop);

    function renderIngredientList() {
      const box = backdrop.querySelector("#rs-ing-list");
      if (items.length === 0) { box.innerHTML = ""; return; }
      box.innerHTML = items.map((it, idx) => {
        const name = it.name || (state.library.find(x => x.id === it.foodId) || {}).name || "(missing food)";
        return `
          <div class="ingredient-row">
            <span class="ingredient-row__name">${escapeHtml(name)}</span>
            <span class="ingredient-row__grams">${it.grams}g</span>
            <button type="button" data-idx="${idx}" aria-label="Remove ingredient">
              <svg viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
            </button>
          </div>
        `;
      }).join("");
    }
    renderIngredientList();

    function renderDropdown() {
      const dd = backdrop.querySelector("#rs-ing-dropdown");
      const q = backdrop.querySelector("#rs-ing-search").value.trim().toLowerCase();
      if (!q) { dd.hidden = true; dd.innerHTML = ""; return; }
      const matches = state.library.filter(f => f.name.toLowerCase().includes(q)).slice(0, 8);
      if (matches.length === 0) { dd.hidden = true; dd.innerHTML = ""; return; }
      dd.innerHTML = matches.map(f => `<button type="button" class="ingredient-dropdown__item" data-id="${f.id}">${escapeHtml(f.name)} <span>${f.carbs}g carbs/100g</span></button>`).join("");
      dd.hidden = false;
    }

    backdrop.querySelector("#rs-ing-search").addEventListener("input", () => { ingredientSelection = null; renderDropdown(); });
    backdrop.querySelector("#rs-ing-dropdown").addEventListener("click", e => {
      const btn = e.target.closest(".ingredient-dropdown__item");
      if (!btn) return;
      const f = state.library.find(x => x.id === btn.dataset.id);
      if (!f) return;
      ingredientSelection = { foodId: f.id, name: f.name };
      backdrop.querySelector("#rs-ing-search").value = f.name;
      backdrop.querySelector("#rs-ing-dropdown").hidden = true;
      backdrop.querySelector("#rs-ing-weight").focus();
    });

    function addIngredient() {
      const weight = parseFloat(backdrop.querySelector("#rs-ing-weight").value);
      if (!ingredientSelection) { backdrop.querySelector("#rs-ing-search").focus(); return; }
      if (!weight || weight <= 0) { backdrop.querySelector("#rs-ing-weight").focus(); return; }
      const food = state.library.find(f => f.id === ingredientSelection.foodId);
      items.push({
        foodId: ingredientSelection.foodId, name: ingredientSelection.name, grams: weight,
        carbsPer100g: food ? food.carbs : 0, kcalPer100g: food ? food.kcal : null
      });
      ingredientSelection = null;
      backdrop.querySelector("#rs-ing-search").value = "";
      backdrop.querySelector("#rs-ing-weight").value = "";
      renderIngredientList();
    }
    backdrop.querySelector("#rs-ing-add").addEventListener("click", addIngredient);
    backdrop.querySelector("#rs-ing-weight").addEventListener("keydown", e => { if (e.key === "Enter") addIngredient(); });
    backdrop.querySelector("#rs-ing-list").addEventListener("click", e => {
      const btn = e.target.closest("button[data-idx]");
      if (!btn) return;
      items.splice(parseInt(btn.dataset.idx, 10), 1);
      renderIngredientList();
    });

    backdrop.addEventListener("click", e => {
      if (e.target === backdrop || e.target.id === "rs-cancel" || e.target.closest("#rs-close") || e.target.closest("#rs-back")) closeSheet(backdrop);
    });
    backdrop.querySelector("#rs-save").addEventListener("click", () => {
      const name = backdrop.querySelector("#rs-name").value.trim();
      const finalWeight = parseFloat(backdrop.querySelector("#rs-final-weight").value);
      if (!name) { alert("Give the recipe a name."); return; }
      if (items.length === 0) { alert("Add at least one ingredient."); return; }
      if (!finalWeight || finalWeight <= 0) { alert("Final Weight is required — it's the total weight of the finished dish, used to work out carbs per 100g."); return; }
      const payload = {
        name,
        category: backdrop.querySelector("#rs-cat").value,
        notes: backdrop.querySelector("#rs-notes").value.trim(),
        favorite: backdrop.querySelector("#rs-fav").checked,
        items,
        rawWeight: parseFloat(backdrop.querySelector("#rs-raw-weight").value) || null,
        finalWeight
      };
      if (isEdit) Object.assign(r, payload);
      else state.recipes.unshift({ id: "recipe-" + Date.now(), usageCount: 0, ...payload });
      saveState();
      renderRecipesLibrary();
      closeSheet(backdrop);
    });
  }

  libAddBtn.addEventListener("click", () => { if (libSeg === "foods") openFoodSheet(null); else openRecipeSheet(null); });

  // ================= History =================
  const historyGroups = el("history-groups");
  const historyEmpty = el("history-empty");
  const histCountPill = el("hist-count-pill");
  const historySearch = el("history-search");
  const historyMore = el("history-more");
  const historyNoMatch = el("history-nomatch");
  let historyLimit = PAGE_SIZE;   // how many meals the Log shows before "Show older"

  function formatDateHeader(ts) {
    return new Date(ts).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }).toUpperCase();
  }
  function formatTime(ts) {
    return new Date(ts).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  function dateKey(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  }

  let expandedHistoryId = null;

  function renderHistory(opts = {}) {
    histCountPill.textContent = `${state.history.length} meal${state.history.length === 1 ? "" : "s"}`;
    historyEmpty.hidden = state.history.length > 0;
    historyGroups.innerHTML = "";
    if (state.history.length === 0) {
      historyMore.hidden = true; historyNoMatch.hidden = true;
      if (!opts.skipTrends) renderTrends(trendsRange);
      return;
    }

    // Search, then page: only the newest days are drawn until "Show older" is tapped,
    // so the list stays fast however long the history gets.
    const query = historySearch.value.trim();
    const filtered = query ? state.history.filter(e => matchesQuery(e, query, ts => formatDateHeader(ts))) : state.history;
    if (query) histCountPill.textContent = `${filtered.length} of ${state.history.length}`;
    historyNoMatch.hidden = filtered.length > 0;
    const { visible, hidden } = takeEntries(filtered, historyLimit);
    const groups = groupByDay(visible);
    historyMore.hidden = hidden === 0;
    historyMore.textContent = `Show older meals (${hidden} more)`;

    groups.forEach(group => {
      const groupEl = document.createElement("div");
      groupEl.className = "history-group";
      const header = document.createElement("p");
      header.className = "history-group__date";
      header.textContent = formatDateHeader(group.ts);
      groupEl.appendChild(header);

      group.entries.forEach(entry => {
        const meal = MEAL_TYPES[entry.mealType] || MEAL_TYPES.snack;
        const row = document.createElement("div");
        row.className = "history-entry";
        row.style.borderLeftColor = meal.color;
        row.dataset.id = entry.id;
        const doseText = entry.correctionDose > 0 ? `${entry.mealDose}+${entry.correctionDose}u` : `${entry.mealDose}u`;
        const dosePillHtml = entry.noInsulin
          ? `<span class="dose-pill dose-pill--warn"><svg viewBox="0 0 24 24" fill="none"><path d="M12 19V5M12 19l-5-5M12 19l5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>No Insulin</span>`
          : `<span class="dose-pill"><svg viewBox="0 0 24 24" fill="none"><path d="M12 2C12 2 5 10.5 5 15.5C5 19.6 8.13 22 12 22C15.87 22 19 19.6 19 15.5C19 10.5 12 2 12 2Z" stroke="currentColor" stroke-width="2"/></svg>${doseText}</span>`;
        row.innerHTML = `
          <div class="history-entry__icon" style="background:${meal.color}">${meal.icon}</div>
          <div class="history-entry__main">
            <p class="history-entry__title">${meal.label} <span class="muted">· ${formatTime(entry.ts)} · ${escapeHtml(entry.periodName || "")}</span>${nsBadgeHtml(entry)}</p>
            <p class="history-entry__foods">${entry.items.length ? entry.items.map(i => escapeHtml(i.name)).join(", ") : "No food — correction only"}</p>
            <div class="history-entry__detail" hidden>
              ${entry.items.map(i => {
                const isUnit = i.quantity != null && i.unitLabel;
                const qtyLabel = isUnit ? `${formatQty(i.quantity)} ${escapeHtml(i.unitLabel)}${i.quantity === 1 ? "" : "s"}` : (i.grams ? escapeHtml(i.grams) + "g" : "");
                return `<div class="history-entry__item"><span class="history-entry__item-name">${escapeHtml(i.name)}</span><span class="history-entry__item-qty">${qtyLabel}</span><span class="history-entry__item-carbs">${round1(i.carbs)}g</span></div>`;
              }).join("")}
              <div class="history-entry__row-actions">
                <button data-use="${entry.id}" type="button">Use Again</button>
                <button data-edit="${entry.id}" type="button">Edit</button>
                <button class="danger" data-del="${entry.id}" type="button">Delete</button>
              </div>
            </div>
          </div>
          <div class="history-entry__stats">
            <span class="stat-kcal">${entry.totalKcal || 0} kcal</span>
            <span class="stat-grams">${entry.totalCarbs}g</span>
            ${entry.glycemicLoad ? `<span class="gl-indicator gl-indicator--${entry.glycemicLoad.value >= 70 ? "high" : entry.glycemicLoad.value >= 56 ? "medium" : "low"} gl-indicator--compact">GI ${entry.glycemicLoad.value}${entry.glycemicLoad.partial ? "*" : ""}</span>` : ""}
            ${dosePillHtml}
          </div>
        `;
        groupEl.appendChild(row);
      });
      historyGroups.appendChild(groupEl);
    });
    if (!opts.skipTrends) renderTrends(trendsRange);
  }

  // ---- Trends ----
  let historySeg = "log"; // 'log' | 'trends'
  let trendsRange = 14;
  const historySegmented = el("history-segmented");
  const historyLogPanel = el("history-log-panel");
  const historyTrendsPanel = el("history-trends-panel");
  const trendsRangeSegmented = el("trends-range-segmented");

  historySegmented.addEventListener("click", e => {
    const btn = e.target.closest(".segmented__btn");
    if (!btn) return;
    historySeg = btn.dataset.seg;
    historySegmented.querySelectorAll(".segmented__btn").forEach(b => b.classList.toggle("is-active", b === btn));
    historyLogPanel.hidden = historySeg !== "log";
    historyTrendsPanel.hidden = historySeg !== "trends";
    if (historySeg === "trends") renderTrends(trendsRange);
  });
  trendsRangeSegmented.addEventListener("click", e => {
    const btn = e.target.closest(".segmented__btn");
    if (!btn) return;
    trendsRange = parseInt(btn.dataset.range, 10);
    trendsRangeSegmented.querySelectorAll(".segmented__btn").forEach(b => b.classList.toggle("is-active", b === btn));
    renderTrends(trendsRange);
  });


  // "Nice" axis scale: picks a round step (1/2/5 x 10^k) so the gridlines land
  // on readable numbers, and rounds the max up to the next step.

  function trendGeometry(n, maxVal, containerWidth) {
    const W = Math.max(containerWidth || 320, 220), H = 172;
    const padL = 30, padR = 6, padT = 10, padB = 30;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const slotW = plotW / n;
    const barW = Math.min(26, Math.max(3, slotW * 0.68));
    const { max, step } = niceScale(maxVal, 3);
    return {
      W, H, padL, padR, padT, padB, plotW, plotH, n, slotW, barW, max, step,
      yFor: v => padT + plotH - (v / max) * plotH,
      xSlot: i => padL + i * slotW,
      xBar: i => padL + i * slotW + (slotW - barW) / 2
    };
  }

  // Everything that isn't a bar: weekend shading, gridlines + value labels,
  // the dashed average line, and the date / weekday labels.
  function trendFrameSvg(g, buckets, avgValue, avgText) {
    const fmtAxis = v => Number.isInteger(v) ? String(v) : v.toFixed(1);
    let weekend = "", grid = "", labels = "";
    const labelStep = g.n <= 14 ? 1 : 5; // anchored on today so it's always labeled
    buckets.forEach((b, i) => {
      const d = new Date(b.key);
      const dow = d.getDay();
      if (dow === 0 || dow === 6) {
        weekend += `<rect class="trend-chart__weekend" x="${g.xSlot(i).toFixed(1)}" y="${g.padT}" width="${g.slotW.toFixed(1)}" height="${g.plotH}"></rect>`;
      }
      if ((g.n - 1 - i) % labelStep === 0) {
        const isToday = i === g.n - 1;
        const cx = (g.xSlot(i) + g.slotW / 2).toFixed(1);
        const todayCls = isToday ? " trend-chart__axis-label--today" : "";
        labels += `<text class="trend-chart__axis-label${todayCls}" x="${cx}" y="${g.H - 17}" text-anchor="middle">${d.getDate()}</text>`;
        if (g.n <= 14) {
          labels += `<text class="trend-chart__axis-label trend-chart__axis-label--dow${todayCls}" x="${cx}" y="${g.H - 6}" text-anchor="middle">${d.toLocaleDateString(undefined, { weekday: "narrow" })}</text>`;
        }
      }
    });
    const ticks = Math.round(g.max / g.step);
    for (let k = 0; k <= ticks; k++) {
      const v = k * g.step, y = g.yFor(v);
      grid += `<line class="trend-chart__grid${k === 0 ? " is-base" : ""}" x1="${g.padL}" y1="${y.toFixed(1)}" x2="${g.W - g.padR}" y2="${y.toFixed(1)}"></line>`;
      grid += `<text class="trend-chart__axis-label" x="${g.padL - 5}" y="${(y + 3).toFixed(1)}" text-anchor="end">${fmtAxis(v)}</text>`;
    }
    let avg = "";
    if (avgValue > 0) {
      const y = g.yFor(avgValue);
      avg = `<line class="trend-chart__avg" x1="${g.padL}" y1="${y.toFixed(1)}" x2="${g.W - g.padR}" y2="${y.toFixed(1)}"></line>` +
            `<text class="trend-chart__avg-label" x="${g.W - g.padR - 2}" y="${(y - 4).toFixed(1)}">${avgText}</text>`;
    }
    return { under: weekend + grid, over: avg + labels };
  }

  // Invisible full-height column per day, so a tap anywhere in the column
  // selects that day (much easier than hitting a thin bar on a phone).
  function trendHitAreas(g) {
    let out = "";
    for (let i = 0; i < g.n; i++) {
      out += `<rect class="trend-chart__hit" data-idx="${i}" x="${g.xSlot(i).toFixed(1)}" y="${g.padT}" width="${g.slotW.toFixed(1)}" height="${g.plotH}"></rect>`;
    }
    return out;
  }

  function buildCarbsChartSvg(buckets, avg, width) {
    const g = trendGeometry(buckets.length, Math.max(...buckets.map(b => b.carbs)), width);
    const frame = trendFrameSvg(g, buckets, avg, `avg ${Math.round(avg)}g`);
    const base = g.padT + g.plotH;
    const bars = buckets.map((b, i) => {
      const has = b.carbs > 0;
      const h = has ? Math.max(2, (b.carbs / g.max) * g.plotH) : 1;
      const cls = `trend-chart__bar${has ? "" : " trend-chart__bar--empty"}${i === g.n - 1 ? " trend-chart__bar--today" : ""}`;
      return `<rect class="${cls}" data-idx="${i}" x="${g.xBar(i).toFixed(1)}" y="${(base - h).toFixed(1)}" width="${g.barW.toFixed(1)}" height="${h.toFixed(1)}" rx="2"></rect>`;
    }).join("");
    return `<svg class="trend-chart" viewBox="0 0 ${g.W} ${g.H}" style="width:100%;height:${g.H}px;display:block;">${frame.under}${bars}${frame.over}${trendHitAreas(g)}</svg>`;
  }

  // Stacked: meal insulin on the bottom, correction insulin on top.
  function buildDoseChartSvg(buckets, avg, width) {
    const g = trendGeometry(buckets.length, Math.max(...buckets.map(b => b.dose)), width);
    const frame = trendFrameSvg(g, buckets, avg, `avg ${round1(avg)}u`);
    const base = g.padT + g.plotH;
    const bars = buckets.map((b, i) => {
      const todayCls = i === g.n - 1 ? " trend-chart__bar--today" : "";
      if (b.dose <= 0) {
        return `<rect class="trend-chart__bar trend-chart__bar--empty${todayCls}" data-idx="${i}" x="${g.xBar(i).toFixed(1)}" y="${(base - 1).toFixed(1)}" width="${g.barW.toFixed(1)}" height="1" rx="2"></rect>`;
      }
      const hMeal = b.meal > 0 ? Math.max(2, (b.meal / g.max) * g.plotH) : 0;
      const hCorr = b.corr > 0 ? Math.max(2, (b.corr / g.max) * g.plotH) : 0;
      let out = "";
      if (hMeal > 0) {
        out += `<rect class="trend-chart__bar${todayCls}" data-idx="${i}" x="${g.xBar(i).toFixed(1)}" y="${(base - hMeal).toFixed(1)}" width="${g.barW.toFixed(1)}" height="${hMeal.toFixed(1)}" rx="${hCorr > 0 ? 0 : 2}"></rect>`;
      }
      if (hCorr > 0) {
        out += `<rect class="trend-chart__bar trend-chart__bar--corr${todayCls}" data-idx="${i}" x="${g.xBar(i).toFixed(1)}" y="${(base - hMeal - hCorr).toFixed(1)}" width="${g.barW.toFixed(1)}" height="${hCorr.toFixed(1)}" rx="2"></rect>`;
      }
      return out;
    }).join("");
    return `<svg class="trend-chart" viewBox="0 0 ${g.W} ${g.H}" style="width:100%;height:${g.H}px;display:block;">${frame.under}${bars}${frame.over}${trendHitAreas(g)}</svg>`;
  }

  // Tapping a day highlights it in BOTH charts and shows its exact numbers,
  // so carbs and insulin for the same day can be compared at a glance.
  const trendChartCtx = {};   // container id -> { defaultText, describe(idx) }
  let trendSelectedIdx = null;
  function setTrendSelection(idx) {
    trendSelectedIdx = idx;
    Object.keys(trendChartCtx).forEach(id => {
      const box = el(id);
      const svg = box && box.querySelector("svg");
      const readout = box && box.querySelector(".trend-readout");
      if (!svg || !readout) return;
      box.querySelectorAll(".is-selected").forEach(n => n.classList.remove("is-selected"));
      if (idx == null) {
        svg.classList.remove("has-selection");
        readout.textContent = trendChartCtx[id].defaultText;
        return;
      }
      svg.classList.add("has-selection");
      box.querySelectorAll(`.trend-chart__bar[data-idx="${idx}"]`).forEach(n => n.classList.add("is-selected"));
      readout.textContent = trendChartCtx[id].describe(idx);
    });
  }
  ["trend-chart-carbs", "trend-chart-dose"].forEach(id => {
    const box = el(id);
    if (!box) return;
    box.addEventListener("click", e => {
      const hit = e.target.closest("[data-idx]");
      if (!hit) return;
      const idx = parseInt(hit.dataset.idx, 10);
      setTrendSelection(idx === trendSelectedIdx ? null : idx);
    });
  });

  function renderTrendMealBreakdown(entries) {
    const box = el("trend-meal-breakdown");
    if (!box) return;
    const rows = ["breakfast", "lunch", "dinner", "snack"].map(type => {
      const list = entries.filter(e => e.mealType === type && !e.noInsulin && (e.totalCarbs || 0) > 0);
      if (!list.length) return null;
      const carbs = list.reduce((s, e) => s + (e.totalCarbs || 0), 0);
      const dose = list.reduce((s, e) => s + (e.mealDose || 0) + (e.correctionDose || 0), 0);
      const dosed = list.filter(e => (e.mealDose || 0) > 0);
      const gCarbs = dosed.reduce((s, e) => s + (e.totalCarbs || 0), 0);
      const gUnits = dosed.reduce((s, e) => s + (e.mealDose || 0), 0);
      return { type, count: list.length, avgCarbs: carbs / list.length, avgDose: dose / list.length, gPerU: gUnits > 0 ? gCarbs / gUnits : null };
    }).filter(Boolean);
    if (!rows.length) {
      box.innerHTML = `<p class="panel-card__hint">No regular meals logged in this period.</p>`;
      return;
    }
    const maxCarbs = Math.max(...rows.map(r => r.avgCarbs));
    box.innerHTML = `<p class="panel-card__hint">Average per meal over this period.</p>` + rows.map(r => {
      const m = MEAL_TYPES[r.type];
      const pct = Math.max(4, Math.round((r.avgCarbs / maxCarbs) * 100));
      return `
        <div class="meal-break-row">
          <div class="meal-break-row__head">
            <span class="meal-break-row__dot" style="background:${m.color};"></span>
            <span class="meal-break-row__name">${m.label}</span>
            <span class="meal-break-row__count">${r.count} meal${r.count === 1 ? "" : "s"}</span>
            <span class="meal-break-row__vals">${Math.round(r.avgCarbs)} g</span>
          </div>
          <div class="meal-break-row__track"><span class="meal-break-row__fill" style="width:${pct}%;background:${m.color};"></span></div>
          <div class="meal-break-row__sub">${round1(r.avgDose)} u avg dose${r.gPerU ? ` &middot; ${round1(r.gPerU)} g per unit` : ""}</div>
        </div>`;
    }).join("");
  }

  // ---- Nightscout sync badge shown on each logged meal ----
  function nsBadgeHtml(entry) {
    if (!nightscoutConfigured()) return "";
    const pending = nsOutbox.pendingFor(entry.id);
    let cls, label, title;
    if (pending) { cls = "pending"; label = "NS ↻"; title = pending.lastError ? `Waiting to sync — ${pending.lastError}` : "Waiting to sync to Nightscout"; }
    else if (entry.ns && entry.ns.status === "failed") { cls = "failed"; label = "NS !"; title = `Couldn't sync: ${entry.ns.error || "unknown error"}. Tap to retry.`; }
    else if (entry.ns && entry.ns.status === "synced") { cls = entry.ns.warn ? "warn" : "ok"; label = "NS ✓"; title = entry.ns.warn || "Synced to Nightscout"; }
    else return "";
    return `<button type="button" class="ns-badge ns-badge--${cls}" data-nsbadge="${escapeAttr(entry.id)}" title="${escapeAttr(title)}">${label}</button>`;
  }
  function renderHistoryBadges() {
    historyGroups.querySelectorAll(".history-entry").forEach(row => {
      const entry = state.history.find(h => h.id === row.dataset.id);
      const title = row.querySelector(".history-entry__title");
      if (!entry || !title) return;
      const old = title.querySelector(".ns-badge");
      if (old) old.remove();
      const html = nsBadgeHtml(entry);
      if (html) title.insertAdjacentHTML("beforeend", html);
    });
  }
  async function onNsBadgeClick(entry) {
    const pending = nsOutbox.pendingFor(entry.id);
    if (!pending && entry.ns && entry.ns.status === "failed") {
      const retry = await dialogs.confirm(`This meal couldn't be sent to Nightscout:\n${entry.ns.error || "unknown error"}\n\nTry again?`, { title: "Nightscout sync", confirmText: "Retry" });
      if (!retry) return;
      const hasIds = entry.ns.ids && Object.values(entry.ns.ids).some(Boolean);
      if (hasIds) nsOutbox.enqueueUpdate(entry, { format: nsFormat(), units: state.settings.units });
      else nsOutbox.enqueueCreate(entry, { format: nsFormat(), units: state.settings.units });
      flushNightscoutQueue(true);
      return;
    }
    if (pending) { await dialogs.alert(pending.lastError ? `Still waiting to sync.\nLast problem: ${pending.lastError}` : "Waiting to sync to Nightscout.", { title: "Nightscout sync" }); return; }
    await dialogs.alert(entry.ns && entry.ns.warn ? entry.ns.warn : "This meal is in Nightscout.", { title: "Nightscout sync" });
  }
  historySearch.addEventListener("input", () => { historyLimit = PAGE_SIZE; renderHistory({ skipTrends: true }); });
  historyMore.addEventListener("click", () => { historyLimit += PAGE_SIZE; renderHistory({ skipTrends: true }); });

  function renderTrends(days) {
    const chartCarbsBox = el("trend-chart-carbs");
    const chartDoseBox = el("trend-chart-dose");
    const statsBox = el("trend-stats");
    const emptyBox = el("trends-empty");
    if (!chartCarbsBox) return; // view not in the DOM yet on first boot
    const cards = ["trend-card-carbs", "trend-card-dose", "trend-card-meals"].map(id => el(id));
    const captionBox = el("trend-caption");

    // Day buckets, oldest first. Built with setDate() rather than "now minus
    // N x 24h" so they stay on true local midnights across clock changes.
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const buckets = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      d.setHours(0, 0, 0, 0);
      buckets.push({ key: d.getTime(), carbs: 0, meal: 0, corr: 0, dose: 0, entries: 0 });
    }
    const byKey = new Map(buckets.map(b => [b.key, b]));
    const inRange = [];
    state.history.forEach(entry => {
      const b = byKey.get(dayKeyFromTs(entry.ts));
      if (!b) return;
      inRange.push(entry);
      b.entries += 1;
      b.carbs += entry.totalCarbs || 0;
      b.meal += entry.mealDose || 0;
      b.corr += entry.correctionDose || 0;
    });
    buckets.forEach(b => { b.dose = b.meal + b.corr; });

    trendSelectedIdx = null;
    if (inRange.length === 0) {
      emptyBox.hidden = false;
      cards.forEach(c => { if (c) c.hidden = true; });
      statsBox.innerHTML = "";
      if (captionBox) captionBox.textContent = "";
      chartCarbsBox.innerHTML = "";
      chartDoseBox.innerHTML = "";
      Object.keys(trendChartCtx).forEach(k => delete trendChartCtx[k]);
      return;
    }
    emptyBox.hidden = true;
    cards.forEach(c => { if (c) c.hidden = false; });

    // Averages use complete days with logs: today is still in progress, so
    // it would drag the average down until the day is over. (If today is the
    // only day with data, use it so the numbers aren't blank.)
    const todayKey = buckets[buckets.length - 1].key;
    let avgBuckets = buckets.filter(b => b.entries > 0 && b.key !== todayKey);
    const usingToday = avgBuckets.length === 0;
    if (usingToday) avgBuckets = buckets.filter(b => b.entries > 0);
    const avgCarbs = avgBuckets.reduce((s, b) => s + b.carbs, 0) / avgBuckets.length;
    const avgDose = avgBuckets.reduce((s, b) => s + b.dose, 0) / avgBuckets.length;

    const regularMeals = inRange.filter(e => e.mealType !== "correction" && !e.noInsulin).length;
    const corrections = inRange.filter(e => (e.correctionDose || 0) > 0).length;
    const lows = inRange.filter(e => e.noInsulin).length;
    const dosed = inRange.filter(e => !e.noInsulin && (e.mealDose || 0) > 0 && (e.totalCarbs || 0) > 0);
    const gUnits = dosed.reduce((s, e) => s + e.mealDose, 0);
    const gPerU = gUnits > 0 ? round1(dosed.reduce((s, e) => s + e.totalCarbs, 0) / gUnits) : null;

    const card = (value, unit, label, warn) =>
      `<div class="trend-stat-card${warn ? " trend-stat-card--warn" : ""}"><div class="trend-stat-card__value">${value}${unit ? `<span class="trend-stat-card__unit">${unit}</span>` : ""}</div><div class="trend-stat-card__label">${label}</div></div>`;
    statsBox.innerHTML =
      card(regularMeals, "", "Meals logged") +
      card(round1(avgCarbs), "g", "Avg carbs / day") +
      card(round1(avgDose), "u", "Avg dose / day") +
      card(gPerU == null ? "&mdash;" : gPerU, gPerU == null ? "" : "g/u", "Carbs per unit") +
      card(corrections, "", "Corrections") +
      card(lows, "", "Lows treated", lows > 0);

    const fmtShort = ts => new Date(ts).toLocaleDateString(undefined, { day: "numeric", month: "short" });
    if (captionBox) {
      captionBox.textContent = `${fmtShort(buckets[0].key)} \u2013 ${fmtShort(todayKey)} \u00b7 ` +
        (usingToday ? "averages include today so far" : `averages use ${avgBuckets.length} full day${avgBuckets.length === 1 ? "" : "s"} with logs`);
    }

    const fmtDay = ts => new Date(ts).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
    const width = chartCarbsBox.clientWidth || 320;

    trendChartCtx["trend-chart-carbs"] = {
      defaultText: `Avg ${Math.round(avgCarbs)} g / day \u00b7 tap a day for details`,
      describe: i => {
        const b = buckets[i];
        if (b.entries === 0) return `${fmtDay(b.key)} \u00b7 nothing logged`;
        return `${fmtDay(b.key)} \u00b7 ${b.carbs > 0 ? Math.round(b.carbs) + " g carbs" : "no carbs"} \u00b7 ${b.entries} entr${b.entries === 1 ? "y" : "ies"}`;
      }
    };
    trendChartCtx["trend-chart-dose"] = {
      defaultText: `Avg ${round1(avgDose)} u / day \u00b7 tap a day for details`,
      describe: i => {
        const b = buckets[i];
        if (b.entries === 0) return `${fmtDay(b.key)} \u00b7 nothing logged`;
        if (b.dose <= 0) return `${fmtDay(b.key)} \u00b7 no insulin logged`;
        return `${fmtDay(b.key)} \u00b7 ${round1(b.dose)} u ` + (b.corr > 0 ? `(meal ${round1(b.meal)} + correction ${round1(b.corr)})` : "(all meal insulin)");
      }
    };

    const totalMealIns = inRange.reduce((s, e) => s + (e.mealDose || 0), 0);
    const totalCorrIns = inRange.reduce((s, e) => s + (e.correctionDose || 0), 0);
    const totalIns = totalMealIns + totalCorrIns;
    const corrPct = totalIns > 0 ? Math.round((totalCorrIns / totalIns) * 100) : 0;

    chartCarbsBox.innerHTML =
      `<p class="trend-readout">${trendChartCtx["trend-chart-carbs"].defaultText}</p>` +
      buildCarbsChartSvg(buckets, avgCarbs, width);
    chartDoseBox.innerHTML =
      `<p class="trend-readout">${trendChartCtx["trend-chart-dose"].defaultText}</p>` +
      buildDoseChartSvg(buckets, avgDose, width) +
      `<div class="trend-legend"><span><span class="trend-legend__dot" style="background:var(--acc-1);"></span>Meal insulin</span><span><span class="trend-legend__dot" style="background:#C0392B;"></span>Correction</span></div>` +
      (totalIns > 0 ? `<p class="trend-caption trend-caption--tight">Corrections were ${corrPct}% of logged insulin (${round1(totalCorrIns)} of ${round1(totalIns)} u).</p>` : "");

    renderTrendMealBreakdown(inRange);
  }

  let trendResizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(trendResizeTimer);
    trendResizeTimer = setTimeout(() => { if (!historyTrendsPanel.hidden) renderTrends(trendsRange); }, 150);
  });

  historyGroups.addEventListener("click", e => {
    const badgeBtn = e.target.closest("[data-nsbadge]");
    if (badgeBtn) {
      const entry = state.history.find(h => h.id === badgeBtn.dataset.nsbadge);
      if (entry) onNsBadgeClick(entry);
      return;
    }
    const delBtn = e.target.closest("[data-del]");
    if (delBtn) {
      const idx = state.history.findIndex(h => h.id === delBtn.dataset.del);
      const [removed] = state.history.splice(idx, 1);
      saveState();
      queueNsDelete(removed);
      renderHistory();
      renderActivePanel();
      showUndoToast("Meal deleted", () => {
        state.history.splice(idx, 0, removed);
        saveState();
        undoNsDelete(removed);
        renderHistory();
        renderActivePanel();
      });
      return;
    }
    const useBtn = e.target.closest("[data-use]");
    if (useBtn) {
      const entry = state.history.find(h => h.id === useBtn.dataset.use);
      if (entry) useMealAgain(entry);
      return;
    }
    const editBtn = e.target.closest("[data-edit]");
    if (editBtn) {
      const entry = state.history.find(h => h.id === editBtn.dataset.edit);
      if (entry) openEditMealSheet(entry);
      return;
    }
    const row = e.target.closest(".history-entry");
    if (!row) return;
    const detail = row.querySelector(".history-entry__detail");
    const summary = row.querySelector(".history-entry__foods");
    detail.hidden = !detail.hidden;
    summary.hidden = !detail.hidden;
  });

  function useMealAgain(entry) {
    if (draft.items.length > 0 && !confirm("This replaces what's currently in the Calculator. Continue?")) return;
    draft = {
      items: entry.items.map(i => ({
        refType: i.refType, refId: i.refId, name: i.name, grams: i.grams,
        quantity: i.quantity ?? null, unitLabel: i.unitLabel ?? null, gramsPerUnit: i.gramsPerUnit ?? null,
        carbsPer100g: i.carbsPer100g, kcalPer100g: i.kcalPer100g, gi: i.gi ?? null, carbs: i.carbs, kcal: i.kcal
      })),
      correctionOn: false, noInsulinOn: false, glucose: "", glucoseUnit: null, manualRatioId: null
    };
    searchInput.value = ""; searchClearBtn.hidden = true; gramsInput.value = ""; gramsInput.disabled = false;
    glucoseInput.value = ""; correctionToggle.classList.remove("is-active"); correctionRow.hidden = true;
    ratioPicker.hidden = true; selectedPickId = null;
    renderFoodPickList(); renderMealItems(); recompute();
    showView("calculator");
  }

  function toDatetimeLocalValue(ts) {
    const d = new Date(ts);
    const pad = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function openEditMealSheet(entry) {
    let items = entry.items.map(i => ({ ...i }));
    let mealType = entry.mealType;
    let glucose = entry.glucose;
    const allRatios = [
      ...state.settings.timeRatios.map(r => ({ ...r, kind: "time" })),
      ...state.settings.activityRatios.map(r => ({ ...r, kind: "activity" }))
    ];
    const matchedRatio = allRatios.find(r => r.name === entry.ratioLabel);
    let selectedRatioValue = entry.ratioValue;
    let selectedRatioLabel = entry.ratioLabel;

    const backdrop = document.createElement("div");
    backdrop.className = "sheet-backdrop";
    backdrop.innerHTML = `
      <div class="sheet">
        <div class="sheet-head">
          <h2>Edit Meal</h2>
          <button class="sheet-close" id="em-close" type="button" aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
          </button>
        </div>
        <label class="block-label">Meal type</label>
        <div class="field-grid" id="em-meal-types" style="margin-bottom:18px;">
          ${Object.entries(MEAL_TYPES).map(([key, m]) => `
            <button class="btn btn--secondary" data-meal="${key}" type="button" style="display:flex;align-items:center;gap:8px;justify-content:center;${key === mealType ? `border-color:${m.color};color:${m.color};background:${m.color}1a;` : ""}">
              <span style="color:${m.color};width:18px;height:18px;">${m.icon}</span>${m.label}
            </button>
          `).join("")}
        </div>
        <div class="field">
          <label for="em-logged-time">Logged time</label>
          <input type="datetime-local" id="em-logged-time" value="${toDatetimeLocalValue(entry.ts)}" style="padding:12px 14px; border:1.5px solid var(--line); border-radius:var(--radius-s); font-size:16px; background:var(--surface); color:var(--ink); font-family:var(--font-ui);">
          <p class="panel-card__hint" style="margin-top:6px;">Changing this updates Active Insulin &amp; Carbs and Trends to match.</p>
        </div>
        <label class="block-label">Insulin ratio</label>
        <select id="em-ratio" style="width:100%; padding:12px 14px; border:1.5px solid var(--line); border-radius:var(--radius-s); font-size:0.96rem; margin-bottom:18px; background:var(--surface); color:var(--ink);">
          ${!matchedRatio ? `<option value="__original__" selected>Original: ${escapeHtml(entry.ratioLabel || "—")} (1:${entry.ratioValue})</option>` : ""}
          ${allRatios.map(r => `<option value="${r.id}" ${matchedRatio && matchedRatio.id === r.id ? "selected" : ""}>${escapeHtml(r.name)} (1:${r.ratio})</option>`).join("")}
        </select>
        <label class="block-label">Items</label>
        <div id="em-items" class="ingredient-list" style="margin-bottom:16px;"></div>
        ${entry.glucose != null ? `
          <div class="field">
            <label>Current glucose at the time</label>
            <div class="field__row"><input type="number" id="em-glucose" value="${entry.glucose}" step="0.1"><span>${unitLabel()}</span></div>
          </div>
        ` : ""}
        <p class="disclaimer" id="em-preview" style="margin-bottom:16px;"></p>
        <div class="sheet-actions">
          <button class="btn btn--secondary" id="em-cancel" type="button">Cancel</button>
          <button class="btn btn--primary" id="em-save" type="button">Save Changes</button>
        </div>
      </div>
    `;
    openSheet(backdrop);

    function renderItems() {
      backdrop.querySelector("#em-items").innerHTML = items.map((it, idx) => {
        const isUnit = it.quantity != null && it.unitLabel;
        const val = isUnit ? formatQty(it.quantity) : it.grams;
        const suffix = isUnit ? escapeHtml(it.unitLabel) + (it.quantity === 1 ? "" : "s") : "g";
        return `
        <div class="ingredient-row">
          <span class="ingredient-row__name">${escapeHtml(it.name)}</span>
          <input type="number" min="0" step="${isUnit ? "0.5" : "1"}" value="${val}" data-idx="${idx}" class="em-grams-input" style="width:70px;padding:6px 8px;text-align:right;">
          <span style="width:34px;font-size:0.8rem;color:var(--ink-soft);">${suffix}</span>
          <button type="button" data-idx="${idx}" class="em-remove" aria-label="Remove item">
            <svg viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
          </button>
        </div>
      `;
      }).join("");
      updatePreview();
    }

    function updatePreview() {
      const totalCarbs = round1(items.reduce((s, i) => s + i.carbs, 0));
      let correctionDose = 0;
      const glucoseInputEl = backdrop.querySelector("#em-glucose");
      if (glucoseInputEl) {
        const g = parseFloat(glucoseInputEl.value);
        if (!isNaN(g) && g > 0) correctionDose = Math.max(0, (g - state.settings.target) / state.settings.isf);
      }
      const mealDose = selectedRatioValue ? totalCarbs / selectedRatioValue : 0;
      // Round each part first, then add -- matches computeDose()/recompute(), so this preview
      // can't show a total that disagrees with what logging or the main calculator would show.
      let total = roundDose(mealDose) + roundDose(correctionDose);
      if (state.settings.maxDose > 0 && total > state.settings.maxDose) total = state.settings.maxDose;
      backdrop.querySelector("#em-preview").textContent =
        `New total: ${round1(totalCarbs)}g carbs → ${total.toFixed(1)} units` +
        (selectedRatioValue ? ` (using ${selectedRatioLabel ? escapeHtml(selectedRatioLabel) + " " : ""}1:${selectedRatioValue})` : "");
    }

    backdrop.querySelector("#em-meal-types").addEventListener("click", e => {
      const btn = e.target.closest("[data-meal]");
      if (!btn) return;
      mealType = btn.dataset.meal;
      backdrop.querySelectorAll("#em-meal-types button").forEach(b => { b.style.borderColor = ""; b.style.color = ""; b.style.background = ""; });
      const m = MEAL_TYPES[mealType];
      btn.style.borderColor = m.color; btn.style.color = m.color; btn.style.background = m.color + "1a";
    });
    backdrop.querySelector("#em-items").addEventListener("input", e => {
      if (!e.target.classList.contains("em-grams-input")) return;
      const idx = parseInt(e.target.dataset.idx, 10);
      const entered = parseFloat(e.target.value) || 0;
      const it = items[idx];
      let grams;
      if (it.quantity != null && it.gramsPerUnit) {
        it.quantity = entered;
        grams = entered * it.gramsPerUnit;
      } else {
        grams = entered;
      }
      it.grams = grams;
      it.carbs = it.carbsPer100g != null ? Math.round(it.carbsPer100g * grams) / 100 : it.carbs;
      it.kcal = it.kcalPer100g ? Math.round(it.kcalPer100g * grams) / 100 : it.kcal;
      updatePreview();
    });
    backdrop.querySelector("#em-items").addEventListener("click", e => {
      const btn = e.target.closest(".em-remove");
      if (!btn) return;
      items.splice(parseInt(btn.dataset.idx, 10), 1);
      renderItems();
    });
    const glucoseEl = backdrop.querySelector("#em-glucose");
    if (glucoseEl) glucoseEl.addEventListener("input", updatePreview);
    backdrop.querySelector("#em-ratio").addEventListener("change", e => {
      const chosen = allRatios.find(r => r.id === e.target.value);
      if (chosen) { selectedRatioValue = chosen.ratio; selectedRatioLabel = chosen.name; }
      else { selectedRatioValue = entry.ratioValue; selectedRatioLabel = entry.ratioLabel; } // "__original__"
      updatePreview();
    });

    renderItems();
    backdrop.addEventListener("click", e => { if (e.target === backdrop || e.target.id === "em-cancel" || e.target.closest("#em-close")) closeSheet(backdrop); });
    backdrop.querySelector("#em-save").addEventListener("click", () => {
      if (items.length === 0 && entry.mealType !== "correction") { dialogs.alert("A meal needs at least one item — delete it instead if you want it gone."); return; }
      const totalCarbs = round1(items.reduce((s, i) => s + i.carbs, 0));
      const totalKcal = Math.round(items.reduce((s, i) => s + (i.kcal || 0), 0));
      // "Treating a low" entries never carry insulin, however they're edited.
      const mealDose = entry.noInsulin ? 0 : (selectedRatioValue ? roundDose(totalCarbs / selectedRatioValue) : entry.mealDose);
      // Keep the logged correction unless a glucose reading is re-entered below.
      let correctionDose = entry.noInsulin ? 0 : (entry.correctionDose || 0);
      const glucoseInputEl2 = backdrop.querySelector("#em-glucose");
      let newGlucose = entry.glucose;
      if (glucoseInputEl2) {
        newGlucose = parseFloat(glucoseInputEl2.value) || null;
        if (!entry.noInsulin) correctionDose = newGlucose ? roundDose(Math.max(0, (newGlucose - state.settings.target) / state.settings.isf)) : 0;
      }
      entry.mealType = mealType;
      entry.items = items;
      entry.totalCarbs = totalCarbs;
      entry.totalKcal = totalKcal;
      entry.mealDose = mealDose;
      entry.correctionDose = correctionDose;
      entry.glucose = newGlucose;
      entry.ratioValue = selectedRatioValue;
      entry.ratioLabel = selectedRatioLabel;
      entry.glycemicLoad = compoundGiInfo(items);   // was left stale, which skewed carb absorption after an edit
      const timeInputEl = backdrop.querySelector("#em-logged-time");
      if (timeInputEl && timeInputEl.value) {
        const newTs = new Date(timeInputEl.value).getTime();
        if (!isNaN(newTs)) {
          entry.ts = newTs;
          state.history.sort((a, b) => b.ts - a.ts);
        }
      }
      saveState();
      queueNsUpdate(entry);
      renderHistory();
      renderActivePanel();
      closeSheet(backdrop);
    });
  }

  // ================= Settings =================
  let settingsSeg = "ratios";
  const settingsSegmented = el("settings-segmented");
  const panelRatios = el("panel-ratios");
  const panelData = el("panel-data");
  const panelGeneral = el("panel-general");

  settingsSegmented.addEventListener("click", e => {
    const btn = e.target.closest(".segmented__btn");
    if (!btn) return;
    settingsSeg = btn.dataset.seg;
    settingsSegmented.querySelectorAll(".segmented__btn").forEach(b => b.classList.toggle("is-active", b === btn));
    panelRatios.hidden = settingsSeg !== "ratios";
    panelData.hidden = settingsSeg !== "data";
    panelGeneral.hidden = settingsSeg !== "general";
  });

  function renderSettings() {
    panelRatios.hidden = settingsSeg !== "ratios";
    panelData.hidden = settingsSeg !== "data";
    panelGeneral.hidden = settingsSeg !== "general";
    renderTimeline();
    renderTimeRatioList();
    renderActivityRatioList();
    fillCorrectionForm();
    el("export-count-label").textContent = `${state.library.length} foods · ${state.recipes.length} recipes`;
    renderPaletteGrid();
    renderBackgroundSection();
    renderStatusPanel();
    renderInsulinCarbSettings();
    el("dark-mode-toggle").checked = state.settings.darkMode;
    el("dark-mode-toggle").disabled = state.settings.darkModeAuto;
    el("dark-mode-auto-toggle").checked = state.settings.darkModeAuto;
    renderAccountSection();
    renderNightscoutSection();
    renderBackupsSection();
    renderDiagSection();

    renderPrivacySection();
  }

  const BG_PRESETS = ["#F5F3EE", "#E1EDF7", "#EDE5F5", "#E5EFE7", "#F7E8E6", "#E7E9EC"];


  function statusRow(label, dotClass, detail) {
    return `<div class="status-row"><span class="status-dot status-dot--${dotClass}"></span><div><p class="status-row__title">${label}</p><p class="status-row__detail">${detail}</p></div></div>`;
  }

  // ---- Automatic local backups ----
  async function renderBackupsSection() {
    const box = el("backups-list");
    if (!box) return;
    if (!backups.available()) { box.innerHTML = '<p class="panel-card__hint">Local backups aren\'t available in this browser.</p>'; return; }
    let list = [];
    try { list = await backups.list(); } catch (e) { box.innerHTML = '<p class="panel-card__hint">Couldn\'t read the backup store.</p>'; return; }
    if (list.length === 0) { box.innerHTML = '<p class="panel-card__hint">No snapshots yet. One is taken automatically as you use the app.</p>'; return; }
    const reasonText = { auto: "Automatic", manual: "Manual", "before-merge": "Before a sync merge", "before-sign-in-merge": "Before signing in", "before-restore": "Before a restore", "before-import": "Before an import", "before-delete": "Before delete-all" };
    box.innerHTML = list.map(b => `
      <div class="backup-row">
        <div class="backup-row__main">
          <p class="backup-row__title">${escapeHtml(new Date(b.ts).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }))} · ${escapeHtml(reasonText[b.reason] || b.reason)}</p>
          <p class="backup-row__sub">${b.meals} meals · ${b.foods} foods${b.encrypted ? " · encrypted" : ""}</p>
        </div>
        <button type="button" data-restore="${b.ts}">Restore</button>
      </div>`).join("");
  }
  el("backups-list").addEventListener("click", e => {
    const btn = e.target.closest("[data-restore]");
    if (btn) restoreSnapshot(Number(btn.dataset.restore));
  });
  el("btn-backup-now").addEventListener("click", async () => {
    await snapshotNow("manual");
    renderBackupsSection();
    dialogs.alert("Snapshot saved on this device.", { title: "Backed up" });
  });
  async function restoreSnapshot(ts) {
    const snap = await backups.get(ts);
    if (!snap) { await dialogs.alert("That snapshot is no longer available."); return; }
    const when = new Date(ts).toLocaleString();
    const ok = await dialogs.confirm(`Go back to how everything was on ${when}?\n\nMeals, foods and settings added or changed since then will be undone (a snapshot of the current state is taken first, so you can undo this).`, { title: "Restore backup", confirmText: "Restore", danger: true });
    if (!ok) return;
    let json = snap.data;
    try {
      if (snap.encrypted) {
        if (!encryptionKey) { await dialogs.alert("That snapshot is encrypted with your passphrase, which isn't unlocked right now.", { title: "Can't restore" }); return; }
        json = await decryptString(encryptionKey, JSON.parse(snap.data));
      }
      const parsed = JSON.parse(json);
      await snapshotNow("before-restore");
      state = prepareRestoredState(parsed, state, defaultState);
      stateFp = makeFingerprint(state);
      await saveStateRaw(state, encryptionKey);
      if (currentUser) await saveStateCloud(true);
      diag.log("info", "backup", `Restored snapshot from ${when}: ${state.history.length} meals`);
      renderEverything();
      await dialogs.alert(`Restored: ${state.history.length} meals, ${state.library.length} foods.`, { title: "Backup restored" });
    } catch (e) {
      diag.log("error", "backup", "Restore failed: " + ((e && e.message) || e));
      await dialogs.alert("That snapshot couldn't be read, so nothing was changed.", { title: "Restore failed" });
    }
  }

  // ---- Diagnostics ----
  function diagContext() {
    let nsHost = "not set up";
    try { if (nightscoutConfigured()) nsHost = new URL(nightscoutBaseUrl()).host; } catch (e) { nsHost = "invalid URL"; }
    const sw = "serviceWorker" in navigator ? (navigator.serviceWorker.controller ? "controlled" : "not controlling") : "unsupported";
    return {
      version: CHANGELOG[0].version,
      "schema": SCHEMA_VERSION,
      "user agent": navigator.userAgent,
      "online": navigator.onLine,
      "installed app": (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true,
      "time zone offset (min)": new Date().getTimezoneOffset(),
      "cloud": currentUser ? "signed in" : (supabaseClient ? "signed out" : "not configured"),
      "cloud sync pending": cloudSyncPending,
      "cloud row updated_at": lastKnownCloudUpdatedAt || "unknown",
      "meals / foods / recipes": `${state.history.length} / ${state.library.length} / ${state.recipes.length}`,
      "nightscout host": nsHost,
      "nightscout format": nsFormat(),
      "nightscout read": nightscoutReadStatus.at ? `${nightscoutReadStatus.ok ? "ok" : "failed"} via ${nightscoutReadStatus.via} - ${nightscoutReadStatus.message}` : "not checked",
      "nightscout write": nightscoutWriteStatus.at ? `${nightscoutWriteStatus.ok ? "ok" : "failed"} via ${nightscoutWriteStatus.via} - ${nightscoutWriteStatus.message}` : "not checked",
      "outbox jobs": nsOutbox.count(),
      "outbox last error": nsOutbox.lastError() || "none",
      "service worker": sw
    };
  }
  function renderDiagSection() {
    const n = diag.count(), errs = diag.errorCount();
    el("diag-summary").textContent = n === 0 ? "Nothing logged yet." : `${n} recent events recorded${errs ? `, ${errs} of them errors` : ""}. The report never includes your meals, glucose or tokens.`;
  }
  async function copyText(text) {
    try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); return true; } } catch (e) { /* fall through */ }
    try {
      const ta = document.createElement("textarea");
      ta.value = text; ta.setAttribute("readonly", ""); ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;";
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch (e) { return false; }
  }
  el("btn-diag-copy").addEventListener("click", async () => {
    const ok = await copyText(diag.report(diagContext()));
    dialogs.alert(ok ? "Copied. Paste it into a message to share it." : "Couldn't copy automatically on this device.", { title: ok ? "Report copied" : "Copy failed" });
  });
  el("btn-diag-clear").addEventListener("click", async () => {
    if (await dialogs.confirm("Clear the diagnostics log?", { confirmText: "Clear" })) { diag.clear(); renderDiagSection(); }
  });

  async function renderStatusPanel() {
    const rows = [];

    // Cloud sync
    if (!supabaseClient) {
      rows.push(statusRow("Cloud Sync", "off", "Not set up — everything stays only on this device."));
    } else if (!currentUser) {
      rows.push(statusRow("Cloud Sync", "off", "Not signed in — everything stays only on this device."));
    } else if (cloudSaveBlocked) {
      rows.push(`<div class="status-row"><span class="status-dot status-dot--error"></span><div><p class="status-row__title">Cloud Sync</p><p class="status-row__detail">Paused — your history would have dropped from ${cloudSaveBlocked.fromCount} to ${cloudSaveBlocked.toCount} entries, which looks like a bug rather than something you did on purpose. Nothing has been synced to protect your data. If you genuinely meant to clear your history, you can override this below.</p><button class="dashed-btn" id="btn-force-sync" type="button" style="margin-top:8px;">Sync anyway</button></div></div>`);
    } else if (!cloudLoadStatus.ok) {
      rows.push(statusRow("Cloud Sync", "error", cloudLoadStatus.message));
    } else if (cloudSyncPending) {
      rows.push(statusRow("Cloud Sync", "warn", `Offline — changes saved on this device, will sync automatically.`));
    } else {
      rows.push(statusRow("Cloud Sync", "ok", `Signed in as ${escapeHtml(currentUser.email || "")}${cloudLoadStatus.at ? " · checked " + timeAgo(cloudLoadStatus.at) : ""}<br>Account ID: ${escapeHtml(currentUser.id || "unknown")}<br>${state.history.length} meal${state.history.length === 1 ? "" : "s"} loaded · ${state.library.length} food${state.library.length === 1 ? "" : "s"} in library`));
    }

    // Nightscout -- read and write tracked separately, reflecting the most
    // recent REAL attempt (not just a manual test), including which path
    // (Supabase proxy vs. direct) actually worked.
    if (!nightscoutConfigured()) {
      rows.push(statusRow("Nightscout Read", "off", "Not set up."));
      rows.push(statusRow("Nightscout Write", "off", "Not set up."));
    } else {
      if (!nightscoutReadStatus.at) {
        rows.push(statusRow("Nightscout Read", "off", `Not checked yet — use "Fetch from Nightscout" on the Calculator, or Test Connection below.`));
      } else if (nightscoutReadStatus.ok) {
        const via = nightscoutReadStatus.via === "proxy" ? "via Supabase proxy" : "via direct request";
        rows.push(statusRow("Nightscout Read", "ok", `Working ${via} · checked ${timeAgo(nightscoutReadStatus.at)}`));
      } else {
        rows.push(statusRow("Nightscout Read", "error", `${escapeHtml(nightscoutReadStatus.message)} · checked ${timeAgo(nightscoutReadStatus.at)}`));
      }

      const queueLen = nsOutbox.count();
      if (!nightscoutWriteStatus.at) {
        rows.push(statusRow("Nightscout Write", "off", "Not checked yet — log a meal, or use Test Connection below."));
      } else if (queueLen > 0) {
        rows.push(statusRow("Nightscout Write", "warn", `${queueLen} entr${queueLen === 1 ? "y" : "ies"} waiting to sync · last attempt ${timeAgo(nightscoutWriteStatus.at)}: ${escapeHtml(nightscoutWriteStatus.message)}`));
      } else if (nightscoutWriteStatus.ok) {
        const via = nightscoutWriteStatus.via === "proxy" ? "via Supabase proxy" : "via direct request";
        rows.push(statusRow("Nightscout Write", "ok", `Working ${via} · last synced ${timeAgo(nightscoutWriteStatus.at)}`));
      } else {
        rows.push(statusRow("Nightscout Write", "error", `${escapeHtml(nightscoutWriteStatus.message)} · checked ${timeAgo(nightscoutWriteStatus.at)}`));
      }
    }

    // Offline app cache (service worker)
    if (!("serviceWorker" in navigator)) {
      rows.push(statusRow("Offline Access", "off", "Not supported in this browser."));
    } else {
      const reg = await navigator.serviceWorker.getRegistration().catch(() => null);
      if (reg && reg.active) rows.push(statusRow("Offline Access", "ok", "Active — the app can open without a connection."));
      else rows.push(statusRow("Offline Access", "warn", "Not active yet — open the app once more with a connection to enable it."));
    }

    el("status-panel-list").innerHTML = rows.join("");
    const forceBtn = document.getElementById("btn-force-sync");
    if (forceBtn) forceBtn.addEventListener("click", forceSyncNow);
  }
  el("btn-status-refresh").addEventListener("click", () => renderStatusPanel());

  const INSULIN_PRESETS = {
    rapid: { peakMinutes: 75, diaMinutes: 360 },
    fiasp: { peakMinutes: 55, diaMinutes: 360 }
  };
  function clampNum(n, min, max) { return Math.min(max, Math.max(min, n)); }

  function renderInsulinCarbSettings() {
    const im = state.settings.insulinModel;
    const ca = state.settings.carbAbsorptionMinutes;
    document.querySelectorAll("#insulin-preset-buttons .insulin-preset-btn").forEach(btn => {
      btn.classList.toggle("is-active", btn.dataset.preset === im.preset);
    });
    el("insulin-peak-input").value = im.peakMinutes;
    el("insulin-dia-input").value = im.diaMinutes;
    el("carb-abs-high").value = ca.high;
    el("carb-abs-medium").value = ca.medium;
    el("carb-abs-low").value = ca.low;
    el("carb-abs-unknown").value = ca.unknown;
    el("iob-aware-correction-toggle").checked = state.settings.iobAwareCorrection;
  }

  el("iob-aware-correction-toggle").addEventListener("change", e => {
    state.settings.iobAwareCorrection = e.target.checked;
    saveState();
    recompute();
  });

  el("insulin-preset-buttons").addEventListener("click", e => {
    const btn = e.target.closest(".insulin-preset-btn");
    if (!btn) return;
    const preset = btn.dataset.preset;
    state.settings.insulinModel.preset = preset;
    if (INSULIN_PRESETS[preset]) Object.assign(state.settings.insulinModel, INSULIN_PRESETS[preset]);
    saveState();
    renderInsulinCarbSettings();
    renderActivePanel();
  });

  function handleInsulinFieldEdit() {
    const dia = clampNum(parseInt(el("insulin-dia-input").value, 10) || 360, 180, 600);
    const peakRaw = clampNum(parseInt(el("insulin-peak-input").value, 10) || 75, 20, 120);
    // tau's denominator is (1 - 2*peak/dia); peak must stay well below half of
    // DIA or the exponential curve becomes numerically unstable. Clamping here
    // rather than just validating keeps the field always usable.
    const peak = Math.min(peakRaw, Math.floor(dia / 2) - 10);
    state.settings.insulinModel = { preset: "custom", peakMinutes: peak, diaMinutes: dia };
    saveState();
    renderInsulinCarbSettings();
    renderActivePanel();
  }
  el("insulin-peak-input").addEventListener("change", handleInsulinFieldEdit);
  el("insulin-dia-input").addEventListener("change", handleInsulinFieldEdit);

  function handleCarbAbsEdit() {
    state.settings.carbAbsorptionMinutes = {
      high: clampNum(parseInt(el("carb-abs-high").value, 10) || 120, 30, 360),
      medium: clampNum(parseInt(el("carb-abs-medium").value, 10) || 180, 30, 360),
      low: clampNum(parseInt(el("carb-abs-low").value, 10) || 240, 30, 480),
      unknown: clampNum(parseInt(el("carb-abs-unknown").value, 10) || 180, 30, 480)
    };
    saveState();
    renderInsulinCarbSettings();
    renderActivePanel();
  }
  ["carb-abs-high", "carb-abs-medium", "carb-abs-low", "carb-abs-unknown"].forEach(id => {
    el(id).addEventListener("change", handleCarbAbsEdit);
  });

  function renderBackgroundSection() {
    const grid = el("bg-swatch-grid");
    const resetBtn = el("btn-bg-reset");
    const darkNote = el("bg-dark-mode-note");
    const active = state.settings.customBackground;
    darkNote.hidden = !isDarkModeActive();
    grid.style.opacity = isDarkModeActive() ? "0.5" : "1";
    grid.innerHTML = BG_PRESETS.map(color => `
      <button class="bg-swatch${color === active ? " is-active" : ""}" type="button" data-color="${color}" style="background:${color};" aria-label="Background color ${color}">
        ${color === active ? '<svg viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' : ""}
      </button>
    `).join("");
    resetBtn.hidden = !active;
  }
  el("bg-swatch-grid").addEventListener("click", e => {
    const btn = e.target.closest(".bg-swatch");
    if (!btn) return;
    state.settings.customBackground = btn.dataset.color;
    applyCustomBackground();
    saveState();
    renderBackgroundSection();
  });
  el("btn-bg-reset").addEventListener("click", () => {
    state.settings.customBackground = null;
    applyCustomBackground();
    saveState();
    renderBackgroundSection();
  });

  function renderNightscoutSection() {
    const urlInput = el("ns-url");
    if (document.activeElement !== urlInput) urlInput.value = state.settings.nightscoutUrl || "";
    el("ns-format").value = nsFormat();
    el("ns-sync-edits").checked = state.settings.nsSyncEdits !== false;
    const queueLen = nsOutbox.count();
    if (!state.settings.nightscoutUrl) {
      renderNsStatus("Paste your Nightscout URL above (including its ?token=...) to enable automatic sync.");
    } else if (!nightscoutConfigured()) {
      renderNsStatus("That URL doesn't have a ?token=... on it — copy the full link from Nightscout, token included.", true);
    } else if (queueLen > 0) {
      renderNsStatus(`${queueLen} entr${queueLen === 1 ? "y" : "ies"} waiting to sync.`, true);
    } else {
      renderNsStatus("Connected — meals will sync automatically when logged.");
    }
  }

  function renderAccountSection() {
    const box = el("account-section");
    if (!supabaseClient) {
      box.innerHTML = `<p class="panel-card__hint" style="margin-top:-4px;">Cloud sync isn't set up yet. See the README for a step-by-step Supabase guide — until then, everything stays in this browser.</p>`;
      return;
    }
    if (currentUser) {
      box.innerHTML = `
        <p class="panel-card__hint" style="margin-top:-4px;">Signed in as <strong>${escapeHtml(currentUser.email)}</strong>.</p>
        <p class="panel-card__hint" id="sync-status" style="margin-top:-8px;"></p>
        <button class="dashed-btn" id="btn-sign-out" type="button" style="color:var(--brick); border-color:var(--brick-soft);">Sign out</button>
      `;
      el("btn-sign-out").addEventListener("click", async () => { await signOut(); });
      renderSyncStatus();
    } else {
      box.innerHTML = `
        <p class="panel-card__hint" style="margin-top:-4px;">Sign in to sync your library, ratios, and history to your account instead of just this device.</p>
        <form id="acct-signin-form">
          <div class="field"><label>Email</label><input type="email" id="acct-email" autocomplete="email" required></div>
          <div class="field"><label>Password</label><input type="password" id="acct-password" autocomplete="current-password" required></div>
          <p class="lock-screen__error" id="acct-error" hidden></p>
          <button type="button" id="btn-forgot-password" class="link-btn">Forgot password?</button>
          <div class="sheet-actions">
            <button class="btn btn--secondary" id="btn-sign-up" type="button">Create account</button>
            <button class="btn btn--primary" id="btn-sign-in" type="submit">Sign in</button>
          </div>
        </form>
      `;
      const emailEl = el("acct-email"), passEl = el("acct-password"), errEl = el("acct-error");
      const showErr = msg => { errEl.textContent = msg; errEl.hidden = false; };
      el("acct-signin-form").addEventListener("submit", async e => {
        e.preventDefault();
        errEl.hidden = true;
        try { await signIn(emailEl.value.trim(), passEl.value); }
        catch (err) { showErr(err.message || "Couldn't sign in."); }
      });
      el("btn-forgot-password").addEventListener("click", async () => {
        errEl.hidden = true;
        let email = emailEl.value.trim();
        if (!email) { email = (await dialogs.prompt("Enter the email for your account:", { title: "Reset password", type: "email" }) || "").trim(); }
        if (!email) return;
        try {
          const { error } = await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo: window.location.href.split("#")[0].split("?")[0] });
          if (error) throw error;
          await dialogs.alert(`If an account exists for ${email}, a reset link has been sent. Open it on this device to choose a new password.`, { title: "Check your email" });
        } catch (e) { showErr(e.message || "Couldn't send the reset email."); }
      });
      el("btn-sign-up").addEventListener("click", async () => {
        errEl.hidden = true;
        try {
          await signUp(emailEl.value.trim(), passEl.value);
          await dialogs.alert("Account created. Check your email to confirm it, then sign in.");
        } catch (e) { showErr(e.message || "Couldn't create an account."); }
      });
    }
  }

  function renderPrivacySection() {
    const box = el("privacy-lock-section");
    const cloudNote = currentUser ? " and what's synced to the cloud" : "";
    if (isLockEnabled()) {
      box.innerHTML = `
        <p class="panel-card__hint" style="margin-top:-4px;">This device is locked with a passphrase. Your data${cloudNote} is encrypted at rest — forgetting it means it can't be recovered.</p>
        <button class="dashed-btn" id="btn-change-pass" type="button" style="margin-bottom:8px;">Change passphrase</button>
        <button class="dashed-btn" id="btn-remove-pass" type="button" style="color:var(--brick); border-color:var(--brick-soft);">Remove passphrase</button>
      `;
      el("btn-change-pass").addEventListener("click", onChangePassphrase);
      el("btn-remove-pass").addEventListener("click", onRemovePassphrase);
    } else {
      box.innerHTML = `
        <p class="panel-card__hint" style="margin-top:-4px;">Encrypt your library, ratios, and history${cloudNote} with a passphrase. It never leaves your browser — there's no account for it and no way to recover a forgotten passphrase.</p>
        <button class="dashed-btn" id="btn-set-pass" type="button">Set a passphrase</button>
      `;
      el("btn-set-pass").addEventListener("click", onSetPassphrase);
    }
  }

  async function onSetPassphrase() {
    const p1 = await dialogs.prompt("Choose a passphrase:", { title: "Set a passphrase", type: "password" });
    if (!p1) return;
    const p2 = await dialogs.prompt("Enter it again to confirm:", { title: "Confirm passphrase", type: "password" });
    if (p1 !== p2) { await dialogs.alert("Those didn't match — nothing was changed."); return; }
    await setPassphrase(p1);
    renderPrivacySection();
    await dialogs.alert(currentUser ? "Your data is now encrypted, on this device and in the cloud." : "Your data is now encrypted on this device.");
  }
  async function onChangePassphrase() {
    const current = await dialogs.prompt("Enter your current passphrase:", { title: "Change passphrase", type: "password" });
    if (!current) return;
    const ok = await tryUnlock(current);
    if (!ok) { await dialogs.alert("That passphrase doesn't match."); return; }
    const p1 = await dialogs.prompt("Choose a new passphrase:", { title: "Change passphrase", type: "password" });
    if (!p1) return;
    const p2 = await dialogs.prompt("Enter it again to confirm:", { title: "Confirm passphrase", type: "password" });
    if (p1 !== p2) { await dialogs.alert("Those didn't match — nothing was changed."); return; }
    await setPassphrase(p1);
    await dialogs.alert("Passphrase updated.");
  }
  async function onRemovePassphrase() {
    const current = await dialogs.prompt("Enter your current passphrase to remove it:", { title: "Remove passphrase", type: "password" });
    if (!current) return;
    const ok = await tryUnlock(current);
    if (!ok) { await dialogs.alert("That passphrase doesn't match."); return; }
    await removePassphrase();
    renderPrivacySection();
    await dialogs.alert(currentUser ? "Passphrase removed. Your data is stored unencrypted again, on this device and in the cloud." : "Passphrase removed. Your data is stored unencrypted on this device again.");
  }

  function renderTimeline() {
    const bar = el("timeline-bar");
    bar.innerHTML = "";
    // build 24h segments, splitting any range that wraps midnight into two
    const segs = [];
    state.settings.timeRatios.forEach(r => {
      const s = toMinutes(r.start), e = toMinutes(r.end);
      if (s < e) segs.push({ start: s, end: e, r });
      else { segs.push({ start: s, end: 1440, r }); segs.push({ start: 0, end: e, r }); }
    });
    segs.sort((a, b) => a.start - b.start);
    segs.forEach(seg => {
      const width = ((seg.end - seg.start) / 1440) * 100;
      if (width <= 0) return;
      const div = document.createElement("div");
      div.className = "timeline__seg";
      div.style.width = width + "%";
      div.style.background = seg.r.color;
      div.textContent = width > 10 ? `${seg.r.name} · 1:${seg.r.ratio}` : "";
      bar.appendChild(div);
    });

    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const marker = document.createElement("div");
    marker.className = "timeline__now";
    marker.style.left = ((nowMinutes / 1440) * 100) + "%";
    marker.title = "Now";
    bar.appendChild(marker);
  }

  function renderTimeRatioList() {
    const box = el("time-ratio-list");
    box.innerHTML = "";
    state.settings.timeRatios.forEach(r => {
      const row = document.createElement("div");
      row.className = "ratio-row";
      row.style.borderLeft = `4px solid ${r.color}`;
      row.style.background = `${r.color}12`;
      row.innerHTML = `
        <div class="ratio-row__top" data-toggle="${r.id}" style="cursor:pointer;">
          <span>
            <span class="ratio-row__name">${escapeHtml(r.name)}</span>
            <span class="ratio-row__time">${r.start} – ${r.end}</span>
          </span>
          <span class="ratio-row__value">1:${r.ratio}</span>
          <button class="ratio-row__del" data-del="${r.id}" aria-label="Delete" style="margin-left:4px;">
            <svg viewBox="0 0 24 24" fill="none"><path d="M5 7h14M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m-9 0l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>
        <div class="ratio-row__edit" id="edit-${r.id}" hidden>
          <input type="time" value="${r.start}" data-field="start" data-id="${r.id}">
          <span>to</span>
          <input type="time" value="${r.end}" data-field="end" data-id="${r.id}">
          <span class="ratio-x">1 unit per <input type="number" min="1" value="${r.ratio}" data-field="ratio" data-id="${r.id}"> g</span>
        </div>
      `;
      box.appendChild(row);
    });
  }

  el("time-ratio-list").addEventListener("click", e => {
    const del = e.target.closest("[data-del]");
    if (del) {
      if (state.settings.timeRatios.length <= 1) { alert("You need at least one time range."); return; }
      state.settings.timeRatios = state.settings.timeRatios.filter(r => r.id !== del.dataset.del);
      saveState(); renderTimeline(); renderTimeRatioList();
      return;
    }
    const toggle = e.target.closest("[data-toggle]");
    if (toggle) {
      const box = el("edit-" + toggle.dataset.toggle);
      box.hidden = !box.hidden;
    }
  });
  el("time-ratio-list").addEventListener("change", e => {
    const field = e.target.dataset.field;
    if (!field) return;
    const r = state.settings.timeRatios.find(x => x.id === e.target.dataset.id);
    if (!r) return;
    if (field === "ratio") r.ratio = parseFloat(e.target.value) || r.ratio;
    else r[field] = e.target.value;
    saveState();
    renderTimeline();
    renderTimeRatioList();
  });

  const RANGE_COLORS = ["#1F9E93", "#D6A419", "#6366F1", "#D9534F", "#EC4899", "#22B8CE"];
  el("add-time-range-btn").addEventListener("click", () => {
    const id = "tr-" + Date.now();
    state.settings.timeRatios.push({ id, name: "New range", start: "12:00", end: "14:00", ratio: 10, color: RANGE_COLORS[state.settings.timeRatios.length % RANGE_COLORS.length] });
    saveState(); renderTimeline(); renderTimeRatioList();
  });

  function renderActivityRatioList() {
    const box = el("activity-ratio-list");
    box.innerHTML = "";
    state.settings.activityRatios.forEach(r => {
      const row = document.createElement("div");
      row.className = "ratio-row";
      row.style.borderLeft = `4px solid ${r.color}`;
      row.style.background = `${r.color}12`;
      row.innerHTML = `
        <div class="ratio-row__top">
          <span class="ratio-row__name" style="flex:1;">${escapeHtml(r.name)}</span>
          <span class="ratio-x">1 unit per <input type="number" min="1" value="${r.ratio}" data-field="ratio" data-id="${r.id}" style="width:52px;padding:6px;text-align:center;"> g</span>
          <button class="ratio-row__del" data-del="${r.id}" aria-label="Delete">
            <svg viewBox="0 0 24 24" fill="none"><path d="M5 7h14M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m-9 0l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>
      `;
      box.appendChild(row);
    });
  }
  el("activity-ratio-list").addEventListener("click", e => {
    const del = e.target.closest("[data-del]");
    if (!del) return;
    state.settings.activityRatios = state.settings.activityRatios.filter(r => r.id !== del.dataset.del);
    saveState(); renderActivityRatioList();
  });
  el("activity-ratio-list").addEventListener("change", e => {
    if (e.target.dataset.field !== "ratio") return;
    const r = state.settings.activityRatios.find(x => x.id === e.target.dataset.id);
    if (r) { r.ratio = parseFloat(e.target.value) || r.ratio; saveState(); }
  });
  el("add-activity-btn").addEventListener("click", () => {
    const name = prompt("Activity name (e.g. Sport, Stress):");
    if (!name) return;
    state.settings.activityRatios.push({ id: "ar-" + Date.now(), name, ratio: 15, color: RANGE_COLORS[state.settings.activityRatios.length % RANGE_COLORS.length] });
    saveState(); renderActivityRatioList();
  });

  function fillCorrectionForm() {
    el("set-isf").value = state.settings.isf;
    el("set-target").value = state.settings.target;
    el("set-units").value = state.settings.units;
    el("set-rounding").value = state.settings.rounding;
    el("set-max").value = state.settings.maxDose;
    const u = unitLabel();
    el("isf-unit-label").textContent = u;
    el("target-unit-label").textContent = u;
  }
  el("btn-save-settings").addEventListener("click", () => {
    state.settings.isf = parseFloat(el("set-isf").value) || state.settings.isf;
    state.settings.target = parseFloat(el("set-target").value) || 0;
    state.settings.units = el("set-units").value;
    state.settings.rounding = el("set-rounding").value;
    state.settings.maxDose = parseFloat(el("set-max").value) || 0;
    saveState();
    fillCorrectionForm();
    const conf = el("save-confirm");
    conf.hidden = false;
    setTimeout(() => { conf.hidden = true; }, 1500);
    recompute();
  });

  // ---- Data tab: export/import ----
  function toCsv(rows, headers) {
    const esc = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [headers.map(esc).join(",")];
    rows.forEach(r => lines.push(headers.map(h => esc(r[h])).join(",")));
    return lines.join("\n");
  }
  function downloadText(filename, text, mime) {
    const blob = new Blob([text], { type: mime || "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

  el("btn-export-library").addEventListener("click", () => {
    const foodHeaders = ["fat_per_100g", "usage_count", "is_favorite", "notes", "calories_per_100g", "salt_per_100g", "name", "carbs_per_100g", "category", "protein_per_100g", "unit_based", "unit_label", "grams_per_unit", "glycemic_index", "id"];
    const foodRows = state.library.map(f => ({
      fat_per_100g: f.fat, usage_count: f.usageCount || 0, is_favorite: !!f.favorite,
      notes: f.notes, calories_per_100g: f.kcal, salt_per_100g: f.salt, name: f.name,
      carbs_per_100g: f.carbs, category: f.category, protein_per_100g: f.protein,
      unit_based: !!f.unitBased, unit_label: f.unitLabel || "", grams_per_unit: f.gramsPerUnit || "",
      glycemic_index: f.gi || "", id: f.id
    }));
    downloadText("Food_export.csv", toCsv(foodRows, foodHeaders), "text/csv");

    if (state.recipes.length) {
      const recipeHeaders = ["raw_weight", "total_carbs", "usage_count", "final_weight", "notes", "total_calories", "calories_per_100g", "name", "ingredients", "carbs_per_100g", "category", "id"];
      const recipeRows = state.recipes.map(r => {
        const t = recipeTotals(r);
        const ingredients = r.items.map(it => {
          const cp100 = it.carbsPer100g ?? 0, kp100 = it.kcalPer100g ?? null;
          return {
            food_name: it.name || "", weight_grams: it.grams,
            carbs: Math.round(cp100 * it.grams) / 100,
            calories_per_100g: kp100, carbs_per_100g: cp100,
            calories: kp100 ? Math.round(kp100 * it.grams) / 100 : null,
            food_id: it.foodId
          };
        });
        return {
          raw_weight: r.rawWeight ?? "", total_carbs: t.totalCarbs, usage_count: r.usageCount || 0,
          final_weight: r.finalWeight ?? "", notes: r.notes, total_calories: t.totalKcal,
          calories_per_100g: t.kcalPer100g ?? "",
          name: r.name, ingredients: JSON.stringify(ingredients),
          carbs_per_100g: t.carbsPer100g ?? "",
          category: r.category || "other",
          id: r.id
        };
      });
      setTimeout(() => downloadText("Recipe_export.csv", toCsv(recipeRows, recipeHeaders), "text/csv"), 300);
    }
  });

  el("btn-import-library").addEventListener("click", () => el("import-file-input").click());
  el("import-file-input").addEventListener("change", e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        let imported = [];
        if (file.name.endsWith(".json")) {
          const data = JSON.parse(reader.result);
          imported = Array.isArray(data) ? data : (data.foods || []);
        } else {
          imported = parseCsv(reader.result).map(r => ({
            name: r.name, category: r.category || "other",
            carbs: parseFloat(r.carbs_per_100g) || 0, kcal: parseFloat(r.calories_per_100g) || null,
            protein: parseFloat(r.protein_per_100g) || null, fat: parseFloat(r.fat_per_100g) || null,
            salt: parseFloat(r.salt_per_100g) || null, notes: r.notes || "",
            favorite: r.is_favorite === "true", usageCount: parseInt(r.usage_count, 10) || 0,
            unitBased: r.unit_based === "true", unitLabel: r.unit_label || null,
            gramsPerUnit: parseFloat(r.grams_per_unit) || null,
            gi: parseFloat(r.glycemic_index) || null
          }));
        }
        let added = 0, updated = 0;
        imported.forEach(item => {
          if (!item.name) return;
          const existing = state.library.find(f => f.name.toLowerCase() === item.name.toLowerCase());
          if (existing) { Object.assign(existing, item, { id: existing.id }); updated++; }
          else { state.library.push({ id: "food-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6), usageCount: 0, ...item }); added++; }
        });
        saveState();
        renderLibrary();
        renderSettings();
        alert(`Import complete: ${added} added, ${updated} updated.`);
      } catch (err) {
        console.error(err);
        alert("Could not read that file. Make sure it's a CSV or JSON export.");
      }
      e.target.value = "";
    };
    reader.readAsText(file);
  });

  function parseCsv(text) {
    const lines = text.split(/\r?\n/).filter(l => l.trim().length);
    if (lines.length < 2) return [];
    const headers = splitCsvLine(lines[0]);
    return lines.slice(1).map(line => {
      const cells = splitCsvLine(line);
      const obj = {};
      headers.forEach((h, i) => { obj[h] = cells[i]; });
      return obj;
    });
  }
  function splitCsvLine(line) {
    const out = [];
    let cur = "", inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQuotes) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') { inQuotes = false; }
        else cur += c;
      } else {
        if (c === '"') inQuotes = true;
        else if (c === ",") { out.push(cur); cur = ""; }
        else cur += c;
      }
    }
    out.push(cur);
    return out;
  }

  el("btn-export-all").addEventListener("click", () => {
    downloadText(`insulin-buddy-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(state, null, 2), "application/json");
  });

  el("btn-import-all").addEventListener("click", () => el("import-all-file-input").click());
  el("import-all-file-input").addEventListener("change", e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        let foodsAdded = 0, foodsUpdated = 0, recipesAdded = 0, recipesUpdated = 0, historyAdded = 0;

        (data.library || []).forEach(item => {
          if (!item.name) return;
          const existing = state.library.find(f => f.name.toLowerCase() === item.name.toLowerCase());
          if (existing) { Object.assign(existing, item, { id: existing.id }); foodsUpdated++; }
          else { state.library.push({ ...item, id: item.id || ("food-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6)) }); foodsAdded++; }
        });
        (data.recipes || []).forEach(item => {
          if (!item.name) return;
          const existing = state.recipes.find(r => r.name.toLowerCase() === item.name.toLowerCase());
          if (existing) { Object.assign(existing, item, { id: existing.id }); recipesUpdated++; }
          else { state.recipes.push({ ...item, id: item.id || ("recipe-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6)) }); recipesAdded++; }
        });
        (data.history || []).forEach(entry => {
          if (!state.history.find(h => h.id === entry.id)) { state.history.push(entry); historyAdded++; }
        });
        state.history.sort((a, b) => b.ts - a.ts);

        saveState();
        renderLibrary(); renderHistory(); renderSettings();
        alert(`Import complete.\nFoods: ${foodsAdded} added, ${foodsUpdated} updated.\nRecipes: ${recipesAdded} added, ${recipesUpdated} updated.\nHistory: ${historyAdded} added.\n\nSettings were left untouched.`);
      } catch (err) {
        console.error(err);
        alert("Could not read that file. Make sure it's a JSON backup exported from this app.");
      }
      e.target.value = "";
    };
    reader.readAsText(file);
  });

  // ---- General tab ----
  function renderPaletteGrid() {
    const grid = el("palette-grid");
    grid.innerHTML = PALETTES.map(p => `
      <button class="palette-card${state.settings.palette === p.id ? " is-selected" : ""}" data-id="${p.id}" type="button">
        ${state.settings.palette === p.id ? `<span class="palette-card__check"><svg viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>` : ""}
        <span class="palette-card__dots">${p.dots.map(c => `<span style="background:${c}"></span>`).join("")}</span>
        <span class="palette-card__name">${p.name}</span>
      </button>
    `).join("");
  }
  el("palette-grid").addEventListener("click", e => {
    const card = e.target.closest(".palette-card");
    if (!card) return;
    state.settings.palette = card.dataset.id;
    document.documentElement.setAttribute("data-palette", card.dataset.id);
    saveState();
    renderPaletteGrid();
  });

  el("dark-mode-toggle").addEventListener("change", e => {
    state.settings.darkMode = e.target.checked;
    applyTheme();
    renderBackgroundSection();
    saveState();
  });
  el("dark-mode-auto-toggle").addEventListener("change", e => {
    state.settings.darkModeAuto = e.target.checked;
    el("dark-mode-toggle").disabled = state.settings.darkModeAuto;
    applyTheme();
    renderBackgroundSection();
    saveState();
  });
  if (window.matchMedia) {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      if (state.settings.darkModeAuto) { applyTheme(); renderBackgroundSection(); }
    });
  }

  el("ns-url").addEventListener("input", e => {
    state.settings.nightscoutUrl = e.target.value.trim();
    saveState();
    renderNightscoutSection();
    // The cached reading belongs to whatever server was configured before -- once the
    // URL changes it may be stale or from a different site entirely, so drop it rather
    // than show a number that looks live but isn't.
    liveGlucose = null;
    localStorage.removeItem(LIVE_GLUCOSE_CACHE_KEY);
    renderLiveGlucosePill();
  });
  el("ns-format").addEventListener("change", e => { state.settings.nsFormat = e.target.value === "split" ? "split" : "combined"; saveState(); });
  el("ns-sync-edits").addEventListener("change", e => { state.settings.nsSyncEdits = e.target.checked; saveState(); });
  el("btn-ns-test").addEventListener("click", () => { testNightscoutConnection(); });
  el("btn-ns-refresh").addEventListener("click", async () => {
    renderNsStatus("Checking…");
    await flushNightscoutQueue(true);
    await refreshLiveGlucose();
    renderNightscoutSection();
  });

  el("btn-refresh-app").addEventListener("click", () => location.reload());

  el("btn-delete-all").addEventListener("click", async () => {
    if (!confirm("This deletes ALL data — settings, library, recipes and history — permanently. This can't be undone. Continue?")) return;
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(LOCK_KEY);
    encryptionKey = null;
    if (supabaseClient && currentUser) {
      await supabaseClient.from("app_state").delete().eq("user_id", currentUser.id);
      await signOut();
    }
    try { await backups.clear(); } catch (e) { /* none */ }
    nsOutbox.jobs = []; nsOutbox._save();
    [PENDING_SYNC_KEY, LAST_SNAPSHOT_KEY, "insulinBuddy.diag", "insulinBuddy.nsQueue", LIVE_GLUCOSE_CACHE_KEY].forEach(k => localStorage.removeItem(k));
    liveGlucose = null;
    diag.clear();
    cloudSyncPending = false; lastKnownCloudUpdatedAt = null; lastKnownCloudHistoryCount = null; lastKnownCloudHistoryIds = null;
    state = normalizeState({});
    stateFp = makeFingerprint(state);
    renderEverything();
    alert("All data has been deleted.");
  });

  // ================= Init =================
  // One-time patch: adds Glycemic Index values to existing library foods that
  // match by name, for anyone whose library was already saved before this
  // feature existed (seed data in foods_data.js only ever populates a BRAND
  // NEW install — it can't retroactively update a library that's already
  // sitting in someone's browser). Only ever sets the gi field, never touches
  // anything else, and never overwrites a gi value someone's already set.
  const GI_SEED_MAP = {
    "Mela": 36, "Riso Integrale": 68, "Pane Integrale": 74, "Orange": 43, "Piselli (frozen)": 51,
    "Polenta": 68, "Fagioli": 24, "Riso Nero": 42, "Pasta di semola": 53, "Ananas": 59, "Mango": 51,
    "Lenticchie bollite": 32, "Fragole": 40, "Riso Cotto": 73, "Ceci cotti": 28, "Uva": 59,
    "Apple Juice": 41, "Riso": 73, "Patate gialle": 78, "Pane comune": 75, "Pane in cassetta": 75,
    "Ciliegie": 22, "Pasta all'uovo": 49, "Patate dolci": 63, "Latte semiskimmed": 32, "Parsnip": 52,
    "Zucchero": 65, "Additional sugar": 65, "Gnocchi di patate": 68, "Miele": 61, "Banana": 51,
    "Tortilla": 52, "Pesca": 42, "Oat": 55, "Lenticchie cotte": 32, "Lenticchie secche": 32,
    "Piadina": 67, "Pear": 38, "Berries": 40, "Quinoa": 53, "Cuscus crudo": 65,
    "Fette Biscottate (each)": 70, "Marmellata": 49, "Dried apricot": 30, "Ceci secchi": 28,
    "Fagioli secchi": 24, "Croissant (Gails)": 67,
    "Special K": 69, "Wrap": 52, "Gelato": 57, "Hummus": 6, "Peanut Butter": 14,
    "Corn on Cobs": 52, "Butternut squash": 51, "Avocado": 15, "Dry roasted peanuts": 14,
    "Croutons": 70, "Cracker misura": 65, "Pangrattato": 70, "Barley (orzo) secco": 28, "Yogurt": 35
  };
  function applyGiSeedPatch() {
    let changed = false;
    state.library.forEach(f => {
      if (f.gi == null && GI_SEED_MAP[f.name] != null) {
        f.gi = GI_SEED_MAP[f.name];
        changed = true;
      }
    });
    if (changed) saveState();
  }

  function isDarkModeActive() {
    if (state.settings.darkModeAuto) {
      return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    }
    return state.settings.darkMode;
  }
  function applyTheme() {
    document.documentElement.setAttribute("data-theme", isDarkModeActive() ? "dark" : "light");
    applyCustomBackground();
  }
  function applyCustomBackground() {
    if (state.settings.customBackground && !isDarkModeActive()) {
      document.documentElement.style.setProperty("--app-bg", state.settings.customBackground);
    } else {
      document.documentElement.style.removeProperty("--app-bg");
    }
  }

  async function finishInit() {
    document.documentElement.setAttribute("data-palette", state.settings.palette);
    applyTheme();
    if (!stateFp) stateFp = makeFingerprint(state);
    applyGiSeedPatch();
    renderFoodPickList();
    renderMealItems();
    recompute();
    restoreDraftIfAny();
    renderActivePanel();
    showView("calculator");
    syncTabbarHeightVar();
    window.addEventListener("resize", syncTabbarHeightVar);

    // Keep the auto-selected ratio (and the settings timeline's "now" marker) accurate
    // as real time passes, not just at page load.
    nsOutbox.migrateLegacy();
    flushNightscoutQueue();
    renderLiveGlucosePill();   // show the cached reading immediately, don't wait on the network
    refreshLiveGlucose();
    diag.log("info", "boot", `App started (v${CHANGELOG[0].version}); ${state.history.length} meals; cloud ${currentUser ? "signed in" : "off"}`);
    let tick = 0;
    setInterval(() => {
      if (!draft.manualRatioId) recompute();
      if (!el("view-settings").hidden && !panelRatios.hidden) renderTimeline();
      if (!el("view-calculator").hidden) renderActivePanel();
      if (currentUser && !cloudSyncPending && !document.hidden && ++tick % 4 === 0) pullAndMerge("periodic").catch(() => {});
      flushNightscoutQueue();
      refreshLiveGlucose();
    }, 30000);
  }

  function renderEverything() {
    document.documentElement.setAttribute("data-palette", state.settings.palette);
    applyTheme();
    applyGiSeedPatch();
    draft = { items: [], correctionOn: false, noInsulinOn: false, glucose: "", glucoseUnit: null, manualRatioId: null };
    renderFoodPickList(); renderMealItems(); recompute();
    restoreDraftIfAny();
    renderActivePanel();
    renderLibrary(); renderHistory(); renderSettings();
  }

  // Shown whenever a passphrase is required before proceeding -- local-only mode, or
  // cloud sign-in on a device that either already knows about the account's passphrase
  // or has just learned about it (see checkCloudLockConfig / the sign-in flow below).
  // Resolves once successfully unlocked; never resolves if the user just sits there.
  function showLockScreen() {
    return new Promise(resolve => {
      const overlay = el("lock-screen");
      const input = el("lock-passphrase");
      const errorEl = el("lock-error");
      const form = el("lock-form");
      overlay.hidden = false;
      input.focus();
      const onSubmit = async e => {
        e.preventDefault();
        errorEl.hidden = true;
        const ok = await tryUnlock(input.value);
        if (!ok) { errorEl.hidden = false; input.value = ""; input.focus(); return; }
        overlay.hidden = true;
        input.value = "";
        form.removeEventListener("submit", onSubmit);
        resolve();
      };
      form.addEventListener("submit", onSubmit);
    });
  }

  async function boot() {
    if (supabaseClient) {
      const loading = el("loading-screen");
      loading.hidden = false;
      let resolved = false;
      supabaseClient.auth.onAuthStateChange(async (_event, session) => {
        if (_event === "PASSWORD_RECOVERY") {
          // They've just clicked the emailed reset link -- this session is real but its only
          // purpose right now is letting them choose a new password before anything else happens.
          const p1 = await dialogs.prompt("Choose a new password for your account:", { title: "Set a new password", type: "password" });
          if (p1) {
            const p2 = await dialogs.prompt("Enter it again to confirm:", { title: "Confirm new password", type: "password" });
            if (p1 !== p2) await dialogs.alert("Those didn't match — nothing was changed. Use the emailed link again to retry.");
            else {
              const { error } = await supabaseClient.auth.updateUser({ password: p1 });
              if (error) await dialogs.alert("Couldn't update your password: " + (error.message || error));
              else await dialogs.alert("Password updated. You're signed in.");
            }
          }
          // Either way, fall through to the normal sign-in flow below with this same session.
        }
        if (session && session.user) {
          currentUser = session.user;

          // Does this ACCOUNT require a passphrase? Prefer the cloud's record of it (the
          // cross-device source of truth) over whatever this device happens to know locally.
          const lockCheck = await checkCloudLockConfig();
          const requiredLock = (lockCheck.ok && lockCheck.lock) || getLockConfig();
          if (requiredLock && !encryptionKey) {
            const localCfg = getLockConfig();
            if (!localCfg || localCfg.salt !== requiredLock.salt) {
              // Either this device has never seen a passphrase before, or another device set
              // a different one since -- either way, adopt the account's config so this
              // device can be unlocked with the same passphrase (never the passphrase itself,
              // just the salt and a verifier that proves a guess right or wrong).
              localStorage.setItem(LOCK_KEY, JSON.stringify(requiredLock));
            }
            await showLockScreen();
          }

          const local = await loadLocalState();
          const localLegacy = localWasLegacy;
          const result = await loadStateCloud();
          if (!result.ok) {
            // Couldn't reach the cloud right now (network hiccup, etc.) -- NOT the
            // same as "no data exists yet". Use what's saved on this device and
            // leave the cloud row completely untouched.
            cloudLoadStatus = { ok: false, message: "Couldn't load your data from the cloud — showing what's saved on this device instead.", at: Date.now() };
            state = local;
          } else if (result.state) {
            cloudLoadStatus = { ok: true, message: "", at: Date.now() };
            lastKnownCloudUpdatedAt = result.updatedAt;
            lastKnownCloudHistoryCount = result.state.history.length;
            lastKnownCloudHistoryIds = new Set(result.state.history.map(h => h.id));
            if (localLegacy && !cloudSyncPending) {
              // First run after upgrading (or a brand-new device): the old local copy
              // has no change markers, so the cloud copy is authoritative -- exactly
              // what happened before merging existed.
              state = result.state;
            } else {
              // Merge this device's edits (including any made offline) with the cloud's.
              snapshotNow("before-sign-in-merge", local);
              state = mergeStates(local, result.state, defaultState);
              if (!statesEquivalent(state, result.state)) { stateFp = makeFingerprint(state); await saveStateCloud(); }
            }
          } else {
            // Genuinely no cloud row yet for this account: keep whatever is on this
            // device (don't discard it) and create the row from it.
            cloudLoadStatus = { ok: true, message: "", at: Date.now() };
            state = local;
            lastKnownCloudHistoryCount = 0;
            lastKnownCloudHistoryIds = new Set();
            stateFp = makeFingerprint(state);
            await saveStateCloud();
          }
          stateFp = makeFingerprint(state);
          // Keep a local copy of what we just loaded/merged, so the app still shows
          // your data if it's next opened offline (and the copy is marked as current-schema).
          if (result.ok) await saveStateRaw(state, encryptionKey).catch(e => diag.log("warn", "storage", "Local save after sign-in failed: " + ((e && e.message) || e)));
        } else {
          currentUser = null;
          state = loadStatePlain();
        }
        if (!resolved) { resolved = true; loading.hidden = true; await finishInit(); }
        else renderEverything();
      });
      // Safety net: if Supabase never responds (e.g. offline, or misconfigured),
      // fall back to local-only rather than leaving the app stuck loading.
      setTimeout(async () => {
        if (resolved) return;
        resolved = true;
        loading.hidden = true;
        state = loadStatePlain();
        stateFp = makeFingerprint(state);
        await finishInit();
      }, 4000);
      return;
    }

    if (!isLockEnabled()) {
      state = loadStatePlain();
      await finishInit();
      return;
    }
    await showLockScreen();
    state = await loadStateEncrypted(encryptionKey);
    await finishInit();
  }

  boot();
