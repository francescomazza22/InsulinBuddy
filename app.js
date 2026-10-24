import { saveReportPdf } from "./js/pdf-report.js";
import { sanityPool, doseSanity } from "./js/dose-sanity.js";
import { escapeHtml, escapeAttr, round1, formatQty, dayKeyFromTs, timeAgo, makeId, redact, parseDecimalInput } from "./js/util.js";
import { convertGlucose, convertDosingSetting, roundDose as roundDoseWith, roundSignedDose as roundSignedDoseWith, activeAt, compoundGiInfo, computeDose, checkDoseConsistency, planDose, planEditDose, capDoseParts, giBand, niceScale, buildTrendBuckets, summarizeTrends, mealTypeBreakdown, absorptionMinutesForEntry as absorptionForEntry, iobFraction, cobGrams, glucoseTrendArrow, glucoseRangeClass, glucoseRangeLabel, basalByDay, summarizeBasal, ratioWasApplied, ratioByBracket, idealRatioByBracket } from "./js/calc.js";
import { SCHEMA_VERSION, normalizeState as normalizeStateWith, makeFingerprint, stampChanges, mergeStates, statesEquivalent, prepareRestoredState } from "./js/state.js";
import { NightscoutClient, NsOutbox, nsToken, nsBaseUrl, nsConfigured, treatmentsForEntry, entriesToGlucoseRows } from "./js/nightscout.js";
import { createDiag, hookGlobalErrors } from "./js/diag.js";
import { postMealCurves, outcomeByBracket, foodImpact, correctionEffectiveness, iobStacking, overnightStats, weekdayWeekend, lowTreatmentUsual, lastTimesFor, isfToMgdl } from "./js/insights.js";
import { expectedFromInsulin, EXPECTED_FLOOR, observedCarbs, cobAt, projectGlucose, learnAbsorption, gapSummary } from "./js/glucose-model.js";
import { summarizeSync } from "./js/sync-status.js";
import { SEED_RECIPES } from "./js/seed-recipes.js";
import { CHANGELOG } from "./js/changelog.js";
import { fillMissingFoodDetails, stillBlank, applyPublishedGi } from "./js/food-reference.js";
import { fieldSvg } from "./js/doodle-field.js";
import { abstractSvg } from "./js/abstract-field.js";
import { percentile, dailyPatternBuckets, daysSpanned, estimatedA1c, extendedGlucoseStats, dailyStats, glucoseSummaryStats, timeInRangeBreakdown, glucoseGuideRows, TIME_IN_RANGE_BANDS } from "./js/glucose-stats.js";
import { randomBytes, toB64, fromB64, deriveKey, encryptString, decryptString, isEncryptedPayload, exportKeyRaw, importKeyRaw } from "./js/crypto.js";
import { LocalBackups, shouldAutoSnapshot } from "./js/backup.js";
import { doseBadge, groupByDay, takeEntries, matchesQuery, recentDistinctMeals, mealLabel, dosingSummary, insulinStats, isBasalEntry, basalSlotForTime, basalSlotLabel, lastBasalDose, basalDoseCheck, makeBasalEntry, PAGE_SIZE } from "./js/history.js";
import { createDialogs } from "./js/dialogs.js";
import { installClearButtons } from "./js/clear-field.js";
import { swipeAxis, swipePos, swipeSettle, swipeVelocity } from "./js/swipe.js";
import { parsePortion, FRACTION_CHIPS, fractionLabel, slicesLabel } from "./js/portion.js";
import { toMinutes, inRange, ratioAt, ratioMatch, bracketDays, daysLabel, DAY_NAMES, autoMealType, formatDuration, clampNum } from "./js/core/time.js";
import { toCsv, parseCsv, recipeTotals as recipeTotalsWith, parseLibraryFile, mergeLibrary } from "./js/core/library.js";
import { buildMealEntry, adjustUsage } from "./js/core/meal-entry.js";
import { validateState, validateEntry, validateFood, validateRecipe, hasErrors, summarizeProblems } from "./js/core/schema.js";
import { createCloudSync, supabaseCloudTarget } from "./js/core/cloud-sync.js";
import { groupEvents, logHealth, isSyncStuck } from "./js/core/problems.js";
import { createWebPlatform, assertPlatform } from "./js/core/platform.js";
import { createStorage, localStorageBackend, runMigrations, STORAGE_MIGRATIONS } from "./js/core/storage.js";


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
  // All device storage goes through this one object (js/core/storage.js); failures are noted in the diagnostics log.
  const store = createStorage(localStorageBackend(), { onError: (op, key, err) => { try { diag.log("warn", "storage", `${op} failed for ${key}: ${err && err.message}`); } catch { /* diag not ready yet */ } } });
  // Everything device-specific (files, clipboard, scheduled notifications, Health, haptics) goes through this one object; see docs/PLATFORM.md.
  const platform = assertPlatform(window.__ibPlatform || createWebPlatform(window));
  const PENDING_SYNC_KEY = "insulinBuddy.pendingSync";
  let cloudSyncPending = store.getItem(PENDING_SYNC_KEY) === "1";

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

  // Each card shows the theme's two working colours -- colour 1 (buttons, switches, charts) and colour 2 (where the dose
  // card fades to) -- read straight from the design tokens via data-swatch, so the card can never drift from the real theme.
  const PALETTES = [
    { id: "tealViolet", name: "Teal & Violet" },
    { id: "blueViolet", name: "Blue & Purple" },
    { id: "emeraldRose", name: "Emerald & Rose" },
    { id: "orangePink", name: "Orange & Pink" },
    { id: "cyanIndigo", name: "Cyan & Indigo" },
    { id: "greenAmber", name: "Green & Amber" }
  ];

  const MEAL_TYPES = {
    breakfast: { label: "Breakfast", color: "#E8935D", icon: iconCoffee() },
    lunch:     { label: "Lunch",     color: "#D6A419", icon: iconSun() },
    dinner:    { label: "Dinner",    color: "#6B5FD0", icon: iconMoon() },
    snack:     { label: "Snack",     color: "#4C9A6A", icon: iconApple() },
    correction: { label: "Correction", color: "#C0392B", icon: iconPulse() }
  };
  const BASAL_COLOR = "#356E9C";

  function iconBasal() { return '<svg viewBox="0 0 24 24" fill="none"><path d="M9 3h6v3H9zM8 6h8v11a4 4 0 01-8 0V6zM12 21v-1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'; }
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
        showRecentMeals: true,
        backgroundPattern: "none",   // "none" or "doodles": a faint pattern drawn over the background color
        backgroundPatternSize: "small",   // "small" | "medium" | "large": how big the doodles are
        insulinModel: { preset: "rapid", peakMinutes: 75, diaMinutes: 360 },
        carbAbsorptionMinutes: { high: 120, medium: 180, low: 240, unknown: 180 },
        useLearnedAbsorption: false,   // use the times learned from my own readings instead of the fixed ones above
        learnedAbsorption: null,       // last learned snapshot: { high:{minutes,n}|null, ..., counts, at }
        iobAwareCorrection: false,
        reduceBelowTarget: false,   // when glucose is below target, take insulin off the meal dose (off = a low reading changes nothing)
        nightscoutUrl: "",
        nsFormat: "combined",   // "combined" (one Meal Bolus) or "split" (carbs and insulin separately)
        checkAfterHours: 0,      // 0 = off; else remind me to check glucose this many hours after a meal with insulin
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
  function roundSignedDose(value) { return roundSignedDoseWith(value, state.settings.rounding); }
  // The carb timers in force: the fixed ones, or (if switched on and learned) the ones learned from this person's own readings.
  function effectiveCarbAbsorption() {
    const base = state.settings.carbAbsorptionMinutes, L = state.settings.learnedAbsorption;
    if (!state.settings.useLearnedAbsorption || !L) return base;
    const out = { ...base };
    for (const k of ["high", "medium", "low", "unknown"]) if (L[k] && Number.isFinite(L[k].minutes)) out[k] = L[k].minutes;
    return out;
  }
  function calcActiveInsulinAndCarbs(atTime) { return activeAt(state.history, { ...state.settings, carbAbsorptionMinutes: effectiveCarbAbsorption() }, atTime); }
  function normalizeState(parsed) { return normalizeStateWith(parsed, defaultState); }
  function absorptionMinutesForEntry(entry) { return absorptionForEntry(entry, effectiveCarbAbsorption()); }

  // ================= Optional passphrase lock (client-side encryption) =================
  // This is genuinely real encryption (PBKDF2 + AES-GCM via the Web Crypto API), not a
  // cosmetic login screen — it's meant to protect what's sitting in this browser's
  // localStorage, e.g. on a shared device. It is NOT server-side auth: there's no
  // account, nothing syncs, and forgetting the passphrase means the data is
  // unrecoverable by design (there's no backdoor to build on a static site).
  const LOCK_KEY = "insulinBuddy.lock";
  const SESSION_KEY_STORAGE = "insulinBuddy.sessionKey"; // sessionStorage: survives a reload, cleared when the tab/app actually closes
  let encryptionKey = null; // the derived CryptoKey, kept in memory (plus sessionStorage, see above) only while unlocked

  function getLockConfig() {
    try { return JSON.parse(store.getItem(LOCK_KEY) || "null"); } catch { return null; }
  }
  function isLockEnabled() { return !!getLockConfig(); }

  async function persistSessionKey(key) {
    try { sessionStorage.setItem(SESSION_KEY_STORAGE, await exportKeyRaw(key)); }
    catch (e) { /* private browsing or similar -- non-fatal, this session just asks again next reload */ }
  }
  function clearSessionKey() {
    try { sessionStorage.removeItem(SESSION_KEY_STORAGE); } catch (e) { /* nothing to do */ }
  }
  /** True if this browsing session already had a verified passphrase entered -- restores
   * encryptionKey from sessionStorage without re-prompting. Re-verifies against the current
   * lock config's own verifier rather than trusting the stored key blindly, so a stale or
   * corrupted entry (or a passphrase changed elsewhere) safely falls through to a fresh prompt
   * instead of silently misbehaving. */
  async function tryRestoreSessionKey(lockCfg) {
    if (!lockCfg) return false;
    try {
      const raw = sessionStorage.getItem(SESSION_KEY_STORAGE);
      if (!raw) return false;
      const key = await importKeyRaw(raw);
      const check = await decryptString(key, lockCfg.verifier);
      if (check !== "insulin-buddy-unlock-check") { clearSessionKey(); return false; }
      encryptionKey = key;
      return true;
    } catch (e) { clearSessionKey(); return false; }
  }

  // ---- Face ID / Touch ID unlock (a convenience gate, not a cryptographic replacement for the
  // passphrase -- see the settings copy for the honest trade-off this makes) ----
  const FACEID_CRED_KEY = "insulinBuddy.faceIdCredentialId";
  const DURABLE_KEY_STORAGE = "insulinBuddy.durableKey"; // localStorage, not sessionStorage: survives a real close, gated by a fresh WebAuthn check each time rather than by encryption of the value itself
  // window.PublicKeyCredential existing only means the browser HAS a WebAuthn implementation --
  // Chrome exposes it unconditionally, with or without any actual Face ID/Touch ID/Windows
  // Hello hardware behind it. The real check is isUserVerifyingPlatformAuthenticatorAvailable(),
  // which is async, so it's checked once at boot and cached rather than re-checked on every
  // render (the result can't meaningfully change while the app is running).
  let faceIdHardwareAvailable = false;
  const faceIdHardwareCheck = (async () => {
    try { faceIdHardwareAvailable = !!(window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()); }
    catch (e) { faceIdHardwareAvailable = false; }
  })();
  function faceIdSupported() { return faceIdHardwareAvailable; }
  faceIdHardwareCheck.then(() => { if (state && !el("view-settings").hidden) renderPrivacySection(); });
  function isFaceIdEnabled() { return !!store.getItem(FACEID_CRED_KEY); }

  /** Registers a new platform-authenticator (Face ID / Touch ID) credential, then stashes the
   * *already-unlocked* key so a future WebAuthn success can reveal it without retyping the
   * passphrase. Must be called while already unlocked this session. */
  async function enrollFaceId() {
    if (!encryptionKey) throw new Error("Unlock with your passphrase first.");
    const cred = await navigator.credentials.create({
      publicKey: {
        challenge: randomBytes(32),
        rp: { name: "Insulin Buddy" },
        user: { id: randomBytes(16), name: "insulin-buddy", displayName: "Insulin Buddy" },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }],
        // discouraged, not preferred: this app always looks the credential up by its exact
        // stored ID (see unlockWithFaceId's allowCredentials below) rather than a discoverable/
        // usernameless lookup, so there's no reason to let iOS offer to sync this via iCloud
        // Keychain -- it's meant to be a plain, device-bound credential.
        authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "discouraged" },
        timeout: 60000
      }
    });
    store.mustSet(FACEID_CRED_KEY, toB64(new Uint8Array(cred.rawId)));
    store.mustSet(DURABLE_KEY_STORAGE, await exportKeyRaw(encryptionKey));
  }
  function disableFaceId() {
    store.removeItem(FACEID_CRED_KEY);
    store.removeItem(DURABLE_KEY_STORAGE);
  }
  /** Prompts Face ID / Touch ID; on success, reveals the stashed key and re-verifies it against
   * the account's own check value before trusting it (same defensive pattern as
   * tryRestoreSessionKey -- a stale or mismatched entry safely falls through rather than
   * misbehaving). Returns false on any failure, cancellation, or unavailability -- callers
   * always keep the plain passphrase field as a fallback, never Face-ID-only. */
  async function unlockWithFaceId(lockCfg) {
    const credId = store.getItem(FACEID_CRED_KEY);
    if (!credId || !lockCfg) return false;
    try {
      await navigator.credentials.get({
        publicKey: { challenge: randomBytes(32), allowCredentials: [{ id: fromB64(credId), type: "public-key" }], userVerification: "required", timeout: 60000 }
      });
      const raw = store.getItem(DURABLE_KEY_STORAGE);
      if (!raw) return false;
      const key = await importKeyRaw(raw);
      const check = await decryptString(key, lockCfg.verifier);
      if (check !== "insulin-buddy-unlock-check") { disableFaceId(); return false; }
      encryptionKey = key;
      await persistSessionKey(key);
      return true;
    } catch (e) {
      return false; // cancelled, no match, hardware unavailable, etc.
    }
  }

  async function setPassphrase(passphrase) {
    const salt = randomBytes(16);
    const key = await deriveKey(passphrase, salt);
    const verifier = await encryptString(key, "insulin-buddy-unlock-check");
    store.mustSet(LOCK_KEY, JSON.stringify({ salt: toB64(salt), verifier }));
    encryptionKey = key;
    disableFaceId(); // any previously-enrolled Face ID unlock was tied to the old passphrase's key
    await persistSessionKey(key);
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
      await persistSessionKey(key);
      return true;
    } catch {
      return false;
    }
  }
  async function removePassphrase() {
    await saveStateRaw(state, null); // force a plaintext local write while we still have the key
    store.removeItem(LOCK_KEY);
    encryptionKey = null;
    clearSessionKey();
    disableFaceId();
    if (currentUser) await saveStateCloud(); // push the plaintext copy + lock:null immediately, don't wait
  }

  let localWasLegacy = false; // true when the saved copy predates the versioned schema (or doesn't exist)
  function loadStatePlain() {
    try {
      const raw = store.getItem(STORAGE_KEY);
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
    const raw = store.getItem(STORAGE_KEY);
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
  installClearButtons(document);   // the X at the end of every text field while it is being edited
  const diagSecrets = () => { try { return [nightscoutToken()]; } catch { return []; } };
  const diag = createDiag({ storage: store, secrets: diagSecrets });
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
      store.setItem(LAST_SNAPSHOT_KEY, String(Date.now()));
      diag.log("info", "backup", `Snapshot saved (${reason}): ${st.history.length} meals`);
    } catch (e) { diag.log("warn", "backup", "Snapshot failed: " + ((e && e.message) || e)); }
  }
  function maybeAutoSnapshot() {
    const last = Number(store.getItem(LAST_SNAPSHOT_KEY)) || 0;
    if (shouldAutoSnapshot(last, Date.now())) { store.setItem(LAST_SNAPSHOT_KEY, String(Date.now())); snapshotNow("auto"); }
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
    storage: store, client: nsClient, diag,
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

  // `prefetched`, when given, is a { data, error } already fetched by the caller (boot() merges
  // this with its own lock-config check into one round-trip, since both need the same row) --
  // skips the query entirely rather than fetching the same row twice.
  // The cloud copy's rules (when to upload, when to pull, the data-loss guard) live in js/core/cloud-sync.js; this only plugs
  // Supabase and the screen into it.
  const cloudTarget = supabaseCloudTarget({
    getClient: () => supabaseClient, getUserId: () => currentUser.id, getKey: () => encryptionKey, getLock: () => getLockConfig(),
    isEncrypted: isEncryptedPayload, encrypt: encryptString, decrypt: decryptString, normalize: normalizeState,
    log: (level, msg) => diag.log(level, "sync", msg)
  });
  const cloud = createCloudSync({
    target: cloudTarget, getState: () => state,
    mergeRemote: (remote, reason) => applyRemoteState(remote, reason),
    onPending: () => markPending(), onSynced: () => markSynced(), onBlocked: () => renderStatusPanel(),
    log: (level, msg) => diag.log(level, "sync", msg)
  });
  const loadStateCloud = prefetched => cloud.fetch(prefetched);
  async function saveStateCloud(force) {
    if (!supabaseClient || !currentUser) return;
    await cloud.save(force);
  }
  // Escape hatch for the rare genuine case (someone really did delete all their
  // history) — bypasses the guard above exactly once, on explicit request.
  // ---- multi-device merge (see js/state.js for the rules) ----
  let stateFp = null;                 // fingerprint of the last saved state, to spot what changed

  // Cheap check first (just updated_at); only download + merge when someone else wrote.
  async function pullAndMerge(reason) {
    if (!supabaseClient || !currentUser) return false;
    return cloud.pull(reason);
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
    renderRecentMeals();
    renderLibrary(); renderHistory();
    if (!el("view-settings").hidden) renderSettings();
  }

  async function forceSyncNow() {
    cloud.unblock();
    await saveStateCloud(true);
    renderStatusPanel();
  }
  let cloudPendingSince = cloudSyncPending ? Date.now() : null;   // when uploads first started waiting (for the stuck-sync dot)
  function markPending() {
    if (!cloudSyncPending || cloudPendingSince == null) cloudPendingSince = Date.now();
    cloudSyncPending = true;
    store.mustSet(PENDING_SYNC_KEY, "1");
    renderSyncStatus();
  }
  function markSynced() {
    cloudPendingSince = null;
    cloudSyncPending = false;
    store.removeItem(PENDING_SYNC_KEY);
    renderSyncStatus();
  }
  function renderSyncStatus() {
    renderSyncChip();
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
        else if (Date.now() - cloud.lastPullAt > 15000) await pullAndMerge("returned to app");
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
      store.mustSet(STORAGE_KEY, JSON.stringify(payload));
    } else {
      store.mustSet(STORAGE_KEY, JSON.stringify(s));
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
  // Kept in step with the RESPONSIVE LAYOUT breakpoints in style.css (tests/e2e/layout.e2e.js checks they agree).
  const RAIL_QUERY = "(min-width: 700px)";
  function syncTabbarHeightVar() {
    const tabbar = document.querySelector(".tabbar");
    // From 700px the tab bar is a rail down the left edge, not a bar along the bottom, so nothing sits above it: reading
    // its height there would give the whole screen height and push the Log bar and food list off the page.
    if (tabbar) document.documentElement.style.setProperty("--tabbar-height", (window.matchMedia(RAIL_QUERY).matches ? 0 : tabbar.offsetHeight) + "px");
    const logBar = document.getElementById("cc-sticky-log-bar");
    if (logBar && logBar.offsetHeight > 0) document.documentElement.style.setProperty("--sticky-log-bar-height", logBar.offsetHeight + "px");   // 0 means it is hidden right now: keep the last real height
  }

  function showView(name) {
    if (!state) return; // still waiting on the cloud auth check (see boot()); nothing to show yet
    views.forEach(v => { v.hidden = v.id !== `view-${name}`; });
    tabs.forEach(t => {
      if (t.dataset.target === name) t.setAttribute("aria-current", "page");
      else t.removeAttribute("aria-current");
    });
    el("cc-sticky-log-bar").hidden = name !== "calculator";
    document.documentElement.setAttribute("data-view", name);   // lets the CSS lift the undo bar clear of the Log bar on the calculator
    if (name === "calculator") renderActivePanel();
    if (name === "history") { historyLimit = PAGE_SIZE; renderHistory(); }
    if (name === "settings") renderSettings();
    if (!restoringPlace) rememberPlace(name);
  }
  tabs.forEach(t => t.addEventListener("click", () => showView(t.dataset.target)));

  // ----- Reopen where you left off -----
  // The screen you were on and how far down it you were are kept on this device; the app reopens there if it was left less than
  // PLACE_TTL ago (after a longer break the first screen is the useful one). A meal in progress is kept separately (DRAFT_KEY).
  const PLACE_KEY = "insulinBuddy.place";
  const PLACE_TTL = 6 * 3600 * 1000;
  let restoringPlace = false, placeTimer = null;
  function readPlace() { try { return JSON.parse(store.getItem(PLACE_KEY)) || null; } catch { return null; } }
  function currentViewName() { const v = Array.from(views).find(x => !x.hidden); return v ? v.id.replace(/^view-/, "") : "calculator"; }
  function rememberPlace(viewName) {
    try {
      const old = readPlace(), scroll = (old && old.scroll) || {};
      const name = viewName || currentViewName();
      scroll[name] = Math.round(window.scrollY || document.documentElement.scrollTop || 0);
      store.setItem(PLACE_KEY, JSON.stringify({ view: name, scroll, at: Date.now() }));
    } catch {}
  }
  window.addEventListener("scroll", () => { clearTimeout(placeTimer); placeTimer = setTimeout(() => { if (!restoringPlace) rememberPlace(); }, 250); }, { passive: true });
  document.addEventListener("visibilitychange", () => { if (document.hidden) rememberPlace(); });
  window.addEventListener("pagehide", () => rememberPlace());
  function restorePlace() {
    const p = readPlace();
    if (!p || !p.view || !Array.from(views).some(v => v.id === "view-" + p.view) || Date.now() - (p.at || 0) > PLACE_TTL) return false;
    restoringPlace = true;
    showView(p.view);
    const y = (p.scroll && p.scroll[p.view]) || 0;
    if (y > 0) {
      const go = () => window.scrollTo(0, y);
      go(); requestAnimationFrame(() => { go(); setTimeout(() => { go(); restoringPlace = false; }, 150); });
    } else setTimeout(() => { restoringPlace = false; }, 150);
    return true;
  }

  // ================= Time helpers =================
  function currentTimeRatio(atDate) { return ratioAt(state.settings.timeRatios, atDate); }
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
  // Hooks a listener onto an element by id. A missing element (say an older index.html is still on the site) is skipped and noted in
  // the diagnostics log instead of stopping the whole app from starting.
  function bind(id, type, handler, options) {
    const node = document.getElementById(id);
    if (!node) { try { diag.log("warn", "boot", `Element #${id} not found, so its ${type} handler was skipped`); } catch (e) { /* diagnostics not ready */ } return null; }
    node.addEventListener(type, handler, options);
    return node;
  }
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


  function recipeTotals(recipe) { return recipeTotalsWith(recipe, state.library); }

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
        dishWeight: r.finalWeight, slices: r.slices > 0 ? r.slices : null,
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
      const unitSuffix = item.unitBased ? `/${escapeHtml(item.unitLabel)}` : "/100g";
      const meta = `<span class="c-carbs">${item.carbsPer100g ?? "?"}g</span>${item.kcalPer100g ? ` · <span class="c-kcal">~${item.kcalPer100g}kcal</span>` : ""} ${unitSuffix}`;
      row.innerHTML = `
        <div class="food-pick-item__main">
          <p class="food-pick-item__row">
            <span class="food-pick-item__name">${escapeHtml(item.name)}</span>
            <span class="food-pick-item__meta">${meta}</span>
          </p>
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
    selectPickItem(row.dataset.id);
  });
  // Choosing a food, from the search list or from the Browse sheet, ends in the same place: it is highlighted and the
  // amount box is ready.
  function selectPickItem(id) {
    const item = pickableItems().find(i => i.id === id);
    if (!item) return;
    selectedPickId = id;
    searchInput.value = item.name;
    el("cc-search-clear").hidden = false;
    renderFoodPickList();
    gramsInput.disabled = false;
    gramsInput.placeholder = item.unitBased ? "Qty" : item.refType === "recipe" ? "g or 1/8" : "Grams";
    batchWeightG = null;
    renderPickExtra();
    renderPortion();
    gramsInput.focus();
  }

  const searchClearBtn = el("cc-search-clear");
  searchInput.addEventListener("input", () => {
    selectedPickId = null;
    gramsInput.placeholder = "Grams";
    searchClearBtn.hidden = searchInput.value.length === 0;
    renderFoodPickList();
    renderPickExtra();
    renderPortion();
  });
  searchClearBtn.addEventListener("click", () => {
    searchInput.value = "";
    searchInput.dispatchEvent(new Event("input", { bubbles: true }));
    searchInput.focus();
  });

  // ----- Browse: the Library as a picker inside the Calculator -----
  let browseTab = null;   // remembered for the session: 'fav' | 'used' | 'recipes' | 'all'
  function openBrowseSheet() {
    const items = pickableItems();
    const hasFav = items.some(i => i.favorite), hasUsed = items.some(i => i.usageCount);
    let tab = browseTab || (hasFav ? "fav" : hasUsed ? "used" : "all");
    const backdrop = document.createElement("div");
    backdrop.className = "sheet-backdrop";
    backdrop.innerHTML = `
      <div class="sheet browse-sheet" role="dialog" aria-modal="true" aria-labelledby="browse-title">
        <div class="sheet-head">
          <h2 id="browse-title">Browse foods</h2>
          <button class="sheet-close" id="browse-close" type="button" aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
          </button>
        </div>
        <div class="segmented segmented--sub browse-tabs" id="browse-tabs">
          <button class="segmented__btn" data-tab="fav" type="button">Favourites</button>
          <button class="segmented__btn" data-tab="used" type="button">Most used</button>
          <button class="segmented__btn" data-tab="recipes" type="button">Recipes</button>
          <button class="segmented__btn" data-tab="all" type="button">All</button>
        </div>
        <input type="search" id="browse-search" class="browse-search" placeholder="Search&hellip;" autocomplete="off" autocorrect="off" aria-label="Search foods and recipes">
        <div class="browse-list" id="browse-list"></div>
        <button class="link-btn browse-manage" id="browse-manage" type="button">Manage your library in Settings</button>
      </div>`;
    openSheet(backdrop);
    const list = backdrop.querySelector("#browse-list"), search = backdrop.querySelector("#browse-search");
    const EMPTY = {
      fav: "No favourites yet. Star a food in Settings \u203A Library and it will wait for you here.",
      used: "Nothing used yet. Foods you add to meals will rank here.",
      recipes: "No recipes yet.", all: "Nothing matches that."
    };
    const catLabel = id => (CATEGORIES.find(c => c.id === id) || CATEGORIES[CATEGORIES.length - 1]).label;
    function rows() {
      const q = search.value.trim().toLowerCase();
      let r = pickableItems();
      if (q) r = r.filter(i => i.name.toLowerCase().includes(q));    // searching looks everywhere, whichever tab is open
      else if (tab === "fav") r = r.filter(i => i.favorite);
      else if (tab === "used") r = r.filter(i => i.usageCount).sort((a, b) => b.usageCount - a.usageCount);
      else if (tab === "recipes") r = r.filter(i => i.refType === "recipe");
      if (q || tab !== "used") r.sort((a, b) => a.name.localeCompare(b.name));
      return { r, q };
    }
    function paint() {
      backdrop.querySelectorAll("#browse-tabs .segmented__btn").forEach(b => { const on = b.dataset.tab === tab && !search.value.trim(); b.classList.toggle("is-active", on); b.setAttribute("aria-pressed", on ? "true" : "false"); });
      const { r, q } = rows();
      if (!r.length) { list.innerHTML = `<p class="browse-empty">${escapeHtml(q ? EMPTY.all : EMPTY[tab])}</p>`; return; }
      const MAX = 150, shown = r.slice(0, MAX);
      const food = id => state.library.find(f => f.id === id);
      list.innerHTML = shown.map(i => {
        const unit = i.unitBased ? `/${escapeHtml(i.unitLabel)}` : "/100g";
        const tag = i.refType === "recipe" ? "Recipe" : escapeHtml(catLabel((food(i.refId) || {}).category));
        return `<button type="button" class="browse-item" data-id="${escapeHtml(i.id)}">
          <span class="browse-item__main"><span class="browse-item__name">${i.favorite ? '<span class="browse-item__star" aria-label="Favourite">\u2605</span> ' : ""}${escapeHtml(i.name)}</span>
          <span class="browse-item__meta"><span class="c-carbs">${i.carbsPer100g ?? "?"}g</span> carbs ${unit} \u00B7 ${tag}</span></span>
          ${i.usageCount ? `<span class="browse-item__uses">${i.usageCount}\u00D7</span>` : ""}
        </button>`;
      }).join("") + (r.length > MAX ? `<p class="browse-empty">Showing ${MAX} of ${r.length}. Search to narrow it down.</p>` : "");
    }
    paint();
    search.addEventListener("input", paint);
    backdrop.addEventListener("click", e => {
      const tabBtn = e.target.closest("#browse-tabs .segmented__btn");
      if (tabBtn) { tab = browseTab = tabBtn.dataset.tab; search.value = ""; paint(); list.scrollTop = 0; return; }
      const item = e.target.closest(".browse-item");
      if (item) { const id = item.dataset.id; closeSheet(backdrop); selectPickItem(id); return; }
      if (e.target.closest("#browse-manage")) { closeSheet(backdrop); openSettingsPanel("library"); return; }
      if (e.target === backdrop || e.target.closest("#browse-close")) closeSheet(backdrop);
    });
  }
  bind("cc-browse-btn", "click", openBrowseSheet);

  function addSelectedToMeal() {
    if (!selectedPickId) return;
    const [type, id] = selectedPickId.split(":");
    const items = pickableItems();
    const item = items.find(i => i.id === selectedPickId);
    if (!item || item.carbsPer100g == null) return;

    let grams, quantity = null, unitLabel = null, portion = null;
    if (item.unitBased) {
      const qty = parseDecimalInput(gramsInput.value);
      if (!(qty > 0)) { portionMessage(gramsInput.value.trim() ? "Enter how many, for example 1 or 1,5." : ""); gramsInput.focus(); return; }
      quantity = qty;
      unitLabel = item.unitLabel;
      grams = quantity * item.gramsPerUnit;
    } else {
      // Grams, or for a recipe a portion of the dish ("1/8", "2 slices"), always turned into grams here.
      const p = parsePortion(gramsInput.value, portionContext(item));
      if (!p.ok) { portionMessage(p.empty ? "" : p.error); gramsInput.focus(); return; }
      grams = p.grams;
      portion = p.label;
    }

    // A recipe cooked to a different weight this time: the whole batch's carbs spread over THIS batch's weight.
    let cPer100 = item.carbsPer100g, kPer100 = item.kcalPer100g;
    if (type === "recipe" && batchWeightG > 0) {
      const rec = state.recipes.find(x => x.id === id), t = rec ? recipeTotals(rec) : null;
      if (t) { cPer100 = Math.round((t.totalCarbs / batchWeightG) * 1000) / 10; kPer100 = t.totalKcal ? Math.round((t.totalKcal / batchWeightG) * 1000) / 10 : item.kcalPer100g; }
    }
    batchWeightG = null;
    draft.items.push({
      refType: type, refId: id, name: item.name, grams, quantity, unitLabel, ...(portion ? { portion } : {}),
      gramsPerUnit: item.unitBased ? item.gramsPerUnit : null,
      carbsPer100g: cPer100, kcalPer100g: kPer100, gi: item.gi || null,
      carbs: Math.round(cPer100 * grams) / 100,
      kcal: kPer100 ? Math.round(kPer100 * grams) / 100 : null
    });
    selectedPickId = null;
    searchInput.value = "";
    searchClearBtn.hidden = true;
    gramsInput.value = "";
    gramsInput.disabled = false;
    gramsInput.placeholder = "Grams";
    renderFoodPickList();
    renderPickExtra();
    renderPortion();
    renderMealItems();
    recompute();
    saveDraftLocal();
  }

  addBtn.addEventListener("click", addSelectedToMeal);
  gramsInput.addEventListener("keydown", e => { if (e.key === "Enter") addSelectedToMeal(); });

  // Quick-carb chips (Treating a Low): one tap to log a fixed amount of fast carbs, no food
  // search needed. carbsPer100g: 100 is a deliberate trick, not an approximation -- it makes
  // "grams entered" exactly equal "carbs", so this plugs into the normal item-editing flow
  // (the grams input, recompute, etc.) with no special-casing needed anywhere else.
  bind("quick-carb-row", "click", e => {
    const chip = e.target.closest(".quick-carb-chip");
    if (!chip) return;
    const grams = parseFloat(chip.dataset.grams);
    draft.items.push({
      refType: "quick", refId: null, name: "Fast carbs", grams, quantity: null, unitLabel: null,
      gramsPerUnit: null, carbsPer100g: 100, kcalPer100g: 0, gi: null, carbs: grams, kcal: null
    });
    renderMealItems();
    recompute();
    saveDraftLocal();
  });

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
              ${item.portion ? `<span class="meal-item__portion">${escapeHtml(item.portion)}</span> · ` : ""}<input type="number" class="meal-item__grams-input" min="0" step="${isUnit ? "0.5" : "1"}" value="${qtyDisplay}" data-idx="${idx}" style="--qch:${String(qtyDisplay).length}" aria-label="${isUnit ? "Quantity" : "Grams"}">${suffix}${item.kcal ? " · ~<span class=\"meal-item__kcal\">" + Math.round(item.kcal) + "</span> kcal" : ""}
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
      gramsInput.focus();   // caret after the number, nothing pre-selected
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
    e.target.style.setProperty("--qch", String(e.target.value || "0").length);
    const entered = parseFloat(e.target.value) || 0;
    let grams;
    if (item.quantity != null && item.gramsPerUnit) {
      item.quantity = entered;
      grams = entered * item.gramsPerUnit;
    } else {
      grams = entered;
    }
    item.grams = grams;
    if (item.portion) { delete item.portion; const pl = e.target.closest(".meal-item").querySelector(".meal-item__portion"); if (pl) { pl.nextSibling && pl.nextSibling.nodeType === 3 && (pl.nextSibling.textContent = ""); pl.remove(); } }   // changed by hand: no longer "1/8"
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
  // `obs` (optional, from observedCarbs) makes the carbs line follow what the glucose readings show from now on.
  function buildActiveSeries(obs) {
    const now = Date.now();
    const info = calcActiveInsulinAndCarbs(now);
    const startTime = now - 30 * 60000;
    const useObs = !!(obs && obs.observed);
    const cobClear = useObs ? (obs.cob > 0.5 ? now + obs.finishMin * 60000 : 0) : (info.cobClearAt || now);
    const endTime = Math.max(info.iobClearAt || now, cobClear || now, now + 30 * 60000);
    const stepMs = 5 * 60000;
    const points = [];
    for (let t = startTime; t <= endTime; t += stepMs) {
      const r = calcActiveInsulinAndCarbs(t);
      // Right of "now" the carbs follow the readings; left of it the fixed timers. Joined as they are the line would jump at "now"
      // by the difference between the two, so the past half-hour is eased towards the adjusted value (a drawing aid, not a record).
      const eased = useObs && t < now ? Math.max(0, Math.round(r.cob + (obs.cob - info.cob) * ((t - startTime) / (now - startTime)))) : r.cob;
      points.push({ t, iob: r.iob, cob: useObs && t >= now ? Math.round(cobAt(obs, (t - now) / 60000)) : eased });
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

  // A "daily pattern" band chart: every day in the selected range folded into one 24h view,
  // showing the median (bold line) and the 25-75 / 10-90 percentile spread (shaded bands) at
  // each time of day -- the shape of a typical day, not just one line through raw points.
  const MIN_PATTERN_DAYS = 5; // matches the convention CGM reports use (needs a real spread of days to mean anything)

  // ---- Daily Pattern band presets: which percentiles to shade. All of these are already
  // computed by dailyPatternBuckets (p5/p10/p25/p50/p75/p90/p95), so switching presets never
  // needs a re-fetch -- just a re-render with different keys. ----
  const GLUCOSE_BAND_PRESETS = {
    narrow: { label: "25–75 / 10–90", outer: ["p10", "p90"], inner: ["p25", "p75"] },
    wide: { label: "5–95 / 25–75", outer: ["p5", "p95"], inner: ["p25", "p75"] },
    median: { label: "Median only", outer: null, inner: null }
  };
  let glucoseView = "pattern"; // 'pattern' | 'tir' | 'stats'
  let glucoseBandPreset = "narrow";

  // A clinic-visit summary: glucose stats + dosing patterns over the same period as the
  // Glucose tab currently showing, laid out for printing (or Save as PDF via the browser's
  // own print sheet) rather than a new PDF-generation dependency. Reuses the same stats
  // functions already built and tested for the Daily Pattern / Time in Range views, plus
  // buildTrendBuckets/summarizeTrends/mealTypeBreakdown, which existed but were never wired
  // into anything until now.
  async function renderClinicReport(days) {
    const overlay = el("report-overlay");
    const content = el("report-content");
    overlay.hidden = false;
    content.innerHTML = `<p class="panel-card__hint">Preparing report…</p>`;

    const unit = state.settings.units;
    const fmtG = v => unit === "mmol" ? round1(convertGlucose(v, "mgdl", "mmol")) : Math.round(v);
    const unitLabel = unit === "mmol" ? "mmol/L" : "mg/dL";
    const periodStart = new Date(Date.now() - days * 86400_000);
    const fmtDate = d => d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

    let glucoseHtml = `<p class="panel-card__hint">Sign in to Cloud Sync and set up Nightscout to include glucose stats in this report.</p>`;
    let reportReadings = null;
    if (supabaseClient && currentUser && nightscoutConfigured()) {
      const result = await fetchStoredGlucoseReadings(days);
      if (result.ok) reportReadings = result.readings;
      if (result.ok && result.readings.length > 0 && daysSpanned(result.readings) >= MIN_PATTERN_DAYS) {
        const stats = glucoseSummaryStats(result.readings);
        const tir = timeInRangeBreakdown(result.readings);
        const buckets = dailyPatternBuckets(result.readings, 30);
        const svg = renderDailyPatternSVG(buckets, GLUCOSE_BAND_PRESETS.narrow);
        glucoseHtml = `
          <div class="report-stat-grid">
            <div class="report-stat-grid__cell"><div class="report-stat-grid__value">${fmtG(stats.avgMgdl)}</div><div class="report-stat-grid__label">Avg glucose (${unitLabel})</div></div>
            <div class="report-stat-grid__cell"><div class="report-stat-grid__value">${stats.gmi.toFixed(1)}%</div><div class="report-stat-grid__label">Est. A1c (GMI)</div></div>
            <div class="report-stat-grid__cell"><div class="report-stat-grid__value">${Math.round(stats.timeInRangePct)}%</div><div class="report-stat-grid__label">Time in range</div></div>
          </div>
          ${(() => { const x = extendedGlucoseStats(result.readings); return `<table class="report-table" style="margin-top:14px;"><tbody>
            <tr><td>eA1c (ADAG)</td><td>${x.eA1c.toFixed(1)}%</td></tr>
            <tr><td>Standard deviation</td><td>${unit === "mmol" ? round1(convertGlucose(x.sdMgdl, "mgdl", "mmol")) : Math.round(x.sdMgdl)} ${unitLabel}</td></tr>
            <tr><td>Variability (CV, steady is 36% or lower)</td><td>${round1(x.cvPct)}%</td></tr>
            <tr><td>Time in tight range (70\u2013140 mg/dL)</td><td>${round1(x.pct.tight)}%</td></tr>
            <tr><td>Low glucose events (under 70, 15 min or more)</td><td>${x.lowEvents.count}${x.lowEvents.count ? `, average ${Math.round(x.lowEvents.avgMinutes)} min` : ""}</td></tr>
            <tr><td>Very low events (under 54)</td><td>${x.veryLowEvents.count}</td></tr>
            <tr><td>Sensor active</td><td>${Math.round(x.sensorActivePct)}%</td></tr>
          </tbody></table>`; })()}
          <table class="report-table" style="margin-top:14px;">
            <thead><tr><th>Range</th><th>Band (${unitLabel})</th><th>% of readings</th></tr></thead>
            <tbody>${tir.map(b => `<tr><td>${b.label}</td><td>${b.key === "veryHigh" ? "&gt; " + fmtG(b.low - 1) : b.key === "veryLow" ? "&lt; " + fmtG(b.high + 1) : `${fmtG(b.low)}\u2013${fmtG(b.high)}`}</td><td>${Math.round(b.pct)}%</td></tr>`).join("")}</tbody>
          </table>
          <div style="margin-top:14px;">${svg}</div>
          <p class="panel-card__hint">Based on ${stats.count.toLocaleString()} readings over ${daysSpanned(result.readings)} days.</p>
        `;
      } else {
        glucoseHtml = `<p class="panel-card__hint">Not enough stored glucose history yet for this period (needs at least ${MIN_PATTERN_DAYS} days).</p>`;
      }
    }

    const { buckets, inRange, todayKey } = buildTrendBuckets(state.history, days);
    const trend = summarizeTrends(buckets, inRange, todayKey);
    const byType = mealTypeBreakdown(inRange);
    const dosingHtml = `
      <div class="report-stat-grid">
        <div class="report-stat-grid__cell"><div class="report-stat-grid__value">${inRange.length}</div><div class="report-stat-grid__label">Entries logged</div></div>
        <div class="report-stat-grid__cell"><div class="report-stat-grid__value">${round1(trend.avgCarbs)}g</div><div class="report-stat-grid__label">Avg daily carbs</div></div>
        <div class="report-stat-grid__cell"><div class="report-stat-grid__value">${round1(trend.avgDose)}u</div><div class="report-stat-grid__label">Avg daily insulin</div></div>
      </div>
      <table class="report-table" style="margin-top:14px;">
        <thead><tr><th>Type</th><th>Count</th><th>Avg carbs</th><th>Avg dose</th></tr></thead>
        <tbody>
          ${byType.map(t => `<tr><td style="text-transform:capitalize;">${t.type}</td><td>${t.count}</td><td>${round1(t.avgCarbs)}g</td><td>${round1(t.avgDose)}u</td></tr>`).join("")}
          <tr><td>Corrections</td><td>${trend.corrections}</td><td colspan="2"></td></tr>
          <tr><td>Treated lows</td><td>${trend.lows}</td><td colspan="2"></td></tr>
        </tbody>
      </table>
    `;

    // Patterns: what the new Trends insights say, for the same period, so they can be talked through at the appointment.
    let patternsHtml = "";
    {
      const gl = v => (v == null || !Number.isFinite(v) ? "\u2014" : unit === "mmol" ? String(round1(convertGlucose(v, "mgdl", "mmol"))) : String(Math.round(v)));
      const ratios = ratioByBracket(inRange, state.settings), ideal = idealRatioByBracket(inRange, state.settings, 3);
      const idealBy = new Map(ideal.rows.map(r => [r.label, r]));
      const ratioRows = ratios.rows.filter(r => r.count > 0).map(r => { const i = idealBy.get(r.label); return `<tr><td>${escapeHtml(r.label)}</td><td>${r.count}</td><td>1:${round1(r.avg)}</td><td>${i && i.count ? "1:" + round1(i.ideal) : "\u2014"}</td><td>${r.current ? "1:" + round1(r.current) : "\u2014"}</td></tr>`; }).join("");
      if (ratioRows) patternsHtml += `<h3>Insulin-to-carb ratios</h3><table class="report-table"><thead><tr><th>Bracket</th><th>Meals</th><th>Used (avg)</th><th>Ideal*</th><th>Set now</th></tr></thead><tbody>${ratioRows}</tbody></table><p class="panel-card__hint">*Ideal counts carbs eaten to treat a low within 3 h after an injection.</p>`;
      if (reportReadings && reportReadings.length) {
        const out = outcomeByBracket(inRange, reportReadings, { afterHours: 3 });
        if (out.total) patternsHtml += `<h3>Glucose 3 hours after meals</h3><table class="report-table"><thead><tr><th>Bracket</th><th>Meals</th><th>Low</th><th>In range</th><th>High</th><th>Avg start \u2192 3 h</th></tr></thead><tbody>${[...out.rows, ...(out.rows.length > 1 ? [out.all] : [])].map(r => `<tr><td>${escapeHtml(r.label)}</td><td>${r.n}</td><td>${Math.round((r.low / r.n) * 100)}%</td><td>${Math.round((r.inRange / r.n) * 100)}%</td><td>${Math.round((r.high / r.n) * 100)}%</td><td>${gl(r.avgStart)} \u2192 ${gl(r.avgEnd)}</td></tr>`).join("")}</tbody></table>`;
        const ov = overnightStats(inRange, reportReadings);
        if (ov.n) patternsHtml += `<h3>Overnight (00:00\u201306:00, quiet nights)</h3><p>${ov.n} nights \u00b7 average drift ${ov.avgDrift >= 0 ? "+" : "\u2212"}${gl(Math.abs(ov.avgDrift))} ${unitLabel} \u00b7 ${ov.lowNights} with a low.</p>`;
        const cor = correctionEffectiveness(inRange, reportReadings, {});
        if (cor.n) patternsHtml += `<h3>Corrections</h3><p>${cor.n} isolated correction${cor.n === 1 ? "" : "s"}: glucose fell a median of ${gl(cor.medianPerUnit)} ${unitLabel} per unit by 3 hours (correction factor set to ${gl(isfToMgdl(state.settings.isf, state.settings.units))}).</p>`;
        const fd = foodImpact(inRange, reportReadings, { minMeals: 2 });
        if (fd.biggestRise.length) patternsHtml += `<h3>Foods with the biggest rise</h3><p>${fd.biggestRise.slice(0, 3).map(r => `${escapeHtml(r.name)} (+${gl(r.avgRise)} ${unitLabel}, ${r.n} meals)`).join("; ")}.</p>`;
      }
    }

    content.innerHTML = `
      <div class="report-content__header">
        <h1>Insulin Buddy — Summary Report</h1>
        <p>Period: ${fmtDate(periodStart)} \u2013 ${fmtDate(new Date())} (${days} days)</p>
        <p>Generated ${fmtDate(new Date())}</p>
      </div>
      <div class="report-section"><h2>Glucose</h2>${glucoseHtml}</div>
      <div class="report-section"><h2>Meals &amp; Dosing</h2>${dosingHtml}</div>
      ${patternsHtml ? `<div class="report-section"><h2>Patterns</h2>${patternsHtml}</div>` : ""}
      <p class="report-footer">Generated by Insulin Buddy. Informational only — not a substitute for professional medical advice. Estimated A1c (GMI) is not a lab result.</p>
    `;
  }


  // ---- Statistics view: the figures a FreeStyle Libre (AGP) report and Gluroo show, in one place ----
  const fmtDur = m => m >= 60 ? `${Math.floor(m / 60)} h ${Math.round(m % 60)} min` : `${Math.round(m)} min`;
  function statRow(label, value, hint) {
    return `<div class="stat-row"><div class="stat-row__label">${label}${hint ? `<span class="stat-row__hint">${hint}</span>` : ""}</div><div class="stat-row__value">${value}</div></div>`;
  }
  function sparklineSvg(points, unit) {
    const W = 288, H = 44, top = 300, bottom = 40, y = v => H - ((Math.max(bottom, Math.min(top, v)) - bottom) / (top - bottom)) * H;
    const x = m => (m / 1440) * W;
    const band = `<rect x="0" y="${y(180).toFixed(1)}" width="${W}" height="${(y(70) - y(180)).toFixed(1)}" class="spark__band"/>`;
    const path = points.length > 1 ? points.map((p, i) => `${i ? "L" : "M"}${x(p.minute).toFixed(1)} ${y(p.mgdl).toFixed(1)}`).join("") : "";
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Glucose through the day">${band}<path d="${path}" class="spark__line" fill="none"/></svg>`;
  }
  function renderStatsView(box, readings, days) {
    const unit = state.settings.units, u = unit === "mmol" ? "mmol/L" : "mg/dL";
    const g = v => v == null ? "\u2014" : `${unit === "mmol" ? round1(convertGlucose(v, "mgdl", "mmol")) : Math.round(v)} ${u}`;
    const pc = v => `${Math.round(v * 10) / 10}%`;
    const s = extendedGlucoseStats(readings);
    const ins = insulinStats(state.history, Date.now() - days * 86400_000);
    let html = "";
    if (!s.count) {
      html += `<div class="empty-state"><p>No glucose readings in these ${days} days.</p><p class="empty-state__sub">Connect Nightscout / Gluroo in Settings, or import history, and the glucose figures fill in here. Insulin and food figures are below.</p></div>`;
    } else {
      html += `<div class="panel-card"><h2 class="panel-card__title">Glucose</h2>
        ${statRow("Average glucose", g(s.avgMgdl))}
        ${statRow("Estimated A1c (GMI)", `${s.gmi.toFixed(1)}%`, "from your sensor average")}
        ${statRow("eA1c", `${s.eA1c.toFixed(1)}%`, "the older ADAG estimate Gluroo shows")}
        ${statRow("Median", g(s.medianMgdl))}
        ${statRow("Standard deviation", `${unit === "mmol" ? round1(convertGlucose(s.sdMgdl, "mgdl", "mmol")) : Math.round(s.sdMgdl)} ${u}`)}
        ${statRow("Variability (CV)", `<span class="${s.cvOnTarget ? "stat--ok" : "stat--warn"}">${pc(s.cvPct)}</span>`, "steady is 36% or lower")}
        ${statRow("Lowest / highest", `${g(s.minMgdl)} / ${g(s.maxMgdl)}`)}
        ${statRow("Average daily range", g(s.meanDailyRangeMgdl), "highest minus lowest, each day")}
        ${statRow("Time in tight range", pc(s.pct.tight), `70\u2013140 mg/dL`)}
        ${statRow("Time in range", pc(s.pct.target), `70\u2013180 mg/dL`)}
        ${statRow("Sensor active", pc(s.sensorActivePct), `${Math.round(s.readingsPerDay)} readings a day, every ${s.intervalMin} min`)}
        ${s.enough ? "" : `<p class="panel-card__hint">There is less than 70% sensor data over a good span of days, so treat these figures as a rough guide.</p>`}
      </div>
      <div class="panel-card">${renderTimeInRangeHtml(readings, unit)}</div>
      <div class="panel-card"><h2 class="panel-card__title">Low and high events</h2>
        ${statRow("Low glucose events", `${s.lowEvents.count}`, `under ${unit === "mmol" ? "3.9" : "70"}, 15 minutes or more`)}
        ${s.lowEvents.count ? statRow("Average low lasted", fmtDur(s.lowEvents.avgMinutes), `longest ${fmtDur(s.lowEvents.longestMinutes)}`) : ""}
        ${statRow("Very low events", `${s.veryLowEvents.count}`, `under ${unit === "mmol" ? "3.0" : "54"}`)}
        ${statRow("Time below range", pc(s.pct.belowRange))}
        ${statRow("Very high events", `${s.veryHighEvents.count}`, `over ${unit === "mmol" ? "13.9" : "250"}`)}
        ${statRow("Time above range", pc(s.pct.aboveRange))}
      </div>`;
    }
    if (ins.tdd > 0 || ins.lowsTreated) {
      html += `<div class="panel-card"><h2 class="panel-card__title">Insulin and food</h2>
        ${statRow("Total daily insulin", `${round1(ins.tdd)} u`, ins.basalPct == null ? "bolus only: log basal to include it" : "basal plus bolus")}
        ${ins.basalPct == null ? "" : statRow("Basal / bolus", `${Math.round(ins.basalPct)}% / ${Math.round(ins.bolusPct)}%`, `${round1(ins.avgDailyBasal)} u and ${round1(ins.avgDailyBolus)} u a day`)}
        ${statRow("Meals a day", `${round1(ins.mealsPerDay)}`)}
        ${ins.avgMealBolus == null ? "" : statRow("Average meal bolus", `${round1(ins.avgMealBolus)} u`)}
        ${ins.avgMealCarbs == null ? "" : statRow("Average carbs a meal", `${Math.round(ins.avgMealCarbs)} g`)}
        ${ins.effectiveCarbRatio == null ? "" : statRow("Carbs per unit used", `${round1(ins.effectiveCarbRatio)} g`, "meals only, across the period")}
        ${statRow("Corrections", `${ins.correctionCount}${ins.reductionCount ? ` up, ${ins.reductionCount} down` : ""}`, ins.correctionSharePct == null ? "" : `${Math.round(ins.correctionSharePct)}% of bolus insulin`)}
        ${ins.largestDose == null ? "" : statRow("Largest dose", `${round1(ins.largestDose)} u`)}
        ${statRow("Lows treated", `${ins.lowsTreated}`, ins.avgLowCarbs == null ? "" : `about ${Math.round(ins.avgLowCarbs)} g each`)}
      </div>`;
    }
    if (s.count) {
      const rows = dailyStats(readings).slice(-Math.min(days, 14)).reverse();
      html += `<div class="panel-card"><h2 class="panel-card__title">Daily graphs</h2><p class="panel-card__hint" style="margin-top:-4px;">The most recent ${rows.length} days. The shaded strip is 70\u2013180 mg/dL.</p>
        ${rows.map(d => `<div class="day-row"><div class="day-row__head"><strong>${new Date(d.day + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}</strong><span>avg ${g(d.avgMgdl)} \u00b7 ${Math.round(d.targetPct)}% in range${d.lowPct >= 1 ? ` \u00b7 ${Math.round(d.lowPct)}% low` : ""}</span></div>${sparklineSvg(d.points, unit)}</div>`).join("")}
      </div>`;
    }
    html += `<p class="panel-card__hint">Based on ${s.count ? s.count.toLocaleString() + " readings over " + s.days + " days" : "your logged insulin and food"}. Estimated A1c is informational only \u2014 not a lab result. Ranges follow the international consensus (the ones FreeStyle Libre and Gluroo reports use).</p>
      <button class="dashed-btn" id="btn-clinic-report" type="button" style="margin-top:4px;">Generate clinic report</button>`;
    box.innerHTML = html;
    bind("btn-clinic-report", "click", () => openClinicReport(days));
  }

  async function renderGlucoseTab(days) {
    const box = el("glucose-tab-content");
    box.innerHTML = `<p class="panel-card__hint">Loading…</p>`;
    const result = await fetchStoredGlucoseReadings(days);
    if (!box.isConnected) return; // left the tab while this was loading
    if (!result.ok && result.signIn) { box.innerHTML = `<div class="empty-state"><p>No glucose history yet</p><p class="empty-state__sub">${escapeHtml(result.reason)} Your readings then build up here.</p></div>`; return; }
    if (!result.ok) { box.innerHTML = `<p class="panel-card__hint" style="color:#B91C1C;">${escapeHtml(result.reason)}</p>`; return; }

    const readings = result.readings;
    const spanDays = daysSpanned(readings);
    if (glucoseView === "stats") { renderStatsView(box, readings, days); return; }
    if (readings.length === 0 || spanDays < MIN_PATTERN_DAYS) {
      box.innerHTML = `
        <div class="empty-state">
          <p>Not enough data yet for a daily pattern.</p>
          <p class="empty-state__sub">This needs at least ${MIN_PATTERN_DAYS} days of glucose history — you have ${spanDays}. It'll fill in automatically as you use the app, or use "Import history from Nightscout" in Settings → Nightscout Sync to backfill it right away.</p>
        </div>
        <button class="dashed-btn" id="btn-clinic-report" type="button">Generate clinic report</button>
      `;
      bind("btn-clinic-report", "click", () => openClinicReport(days));
      return;
    }

    const stats = glucoseSummaryStats(readings);
    const unit = state.settings.units;
    const fmtG = v => unit === "mmol" ? round1(convertGlucose(v, "mgdl", "mmol")) : Math.round(v);
    const statCard = (value, unitLabel, label, warn) => `
      <div class="trend-stat-card${warn ? " trend-stat-card--warn" : ""}">
        <div class="trend-stat-card__value">${value}<span class="trend-stat-card__unit">${unitLabel}</span></div>
        <div class="trend-stat-card__label">${label}</div>
      </div>
    `;
    const statsHtml = `
      <div class="trend-stats glucose-stats">
        ${statCard(fmtG(stats.avgMgdl), unit === "mmol" ? "mmol/L" : "mg/dL", "Average glucose")}
        ${statCard(stats.gmi.toFixed(1), "%", "Est. A1c (GMI)")}
        ${statCard(Math.round(stats.timeInRangePct), "%", "Time in range (70–180)")}
        ${statCard(Math.round(stats.timeLowPct + stats.timeHighPct), "%", "Time low or high", stats.timeLowPct + stats.timeHighPct > 30)}
      </div>
    `;
    const footerHtml = `
      <p class="panel-card__hint">Based on ${stats.count.toLocaleString()} readings over ${spanDays} days. Estimated A1c (GMI) is informational only — not a lab result.</p>
      <button class="dashed-btn" id="btn-clinic-report" type="button" style="margin-top:4px;">Generate clinic report</button>
    `;
    const wireReportButton = () => bind("btn-clinic-report", "click", () => openClinicReport(days));

    if (glucoseView === "tir") {
      box.innerHTML = `${statsHtml}<div class="panel-card">${renderTimeInRangeHtml(readings, unit)}</div>${footerHtml}`;
      wireReportButton();
      return;
    }

    const preset = GLUCOSE_BAND_PRESETS[glucoseBandPreset];
    const buckets = dailyPatternBuckets(readings, 30);
    const svg = renderDailyPatternSVG(buckets, preset);
    const bandPicker = `
      <div class="band-preset-row">
        <span class="band-preset-row__label">Bands:</span>
        <select id="band-preset-select">
          ${Object.entries(GLUCOSE_BAND_PRESETS).map(([key, p]) => `<option value="${escapeAttr(key)}"${key === glucoseBandPreset ? " selected" : ""}>${p.label}</option>`).join("")}
        </select>
      </div>
    `;
    box.innerHTML = `
      ${statsHtml}
      <div class="panel-card">
        <h2 class="panel-card__title">Daily pattern</h2>
        <p class="panel-card__hint" style="margin-top:-4px;">Every day over the last ${days} days folded into one.</p>
        ${bandPicker}
        ${svg}
        ${renderGlucoseLegend(preset)}
      </div>
      ${footerHtml}
    `;
    wireReportButton();
    bind("band-preset-select", "change", e => {
      glucoseBandPreset = e.target.value;
      renderGlucoseTab(days); // re-render only -- readings are already cached, so this is instant
    });
  }

  // A print-optimized summary for a doctor visit: glucose control + what was actually logged,
  // over the same period/data already on screen. Delivered via the browser's own print-to-PDF
  // (Share Sheet -> Save PDF on iOS) rather than a bundled PDF library -- this app has no build
  // step or dependencies today, and print-to-PDF needs neither.
  async function openClinicReport(days) {
    const overlay = el("clinic-report-overlay");
    const content = el("clinic-report-content");
    content.innerHTML = `<p class="panel-card__hint">Preparing report…</p>`;
    overlay.hidden = false;

    const result = await fetchStoredGlucoseReadings(days); // already cached from the tab itself -- instant
    const unit = state.settings.units;
    const fmtG = v => unit === "mmol" ? round1(convertGlucose(v, "mgdl", "mmol")) : Math.round(v);
    const unitLbl = unit === "mmol" ? "mmol/L" : "mg/dL";
    const sinceMs = Date.now() - days * 86400_000;
    const dosing = dosingSummary(state.history, sinceMs);
    const periodLabel = `${new Date(sinceMs).toLocaleDateString()} – ${new Date().toLocaleDateString()}`;

    let glucoseSectionHtml;
    if (result.ok && result.readings.length > 0 && daysSpanned(result.readings) >= MIN_PATTERN_DAYS) {
      const stats = glucoseSummaryStats(result.readings);
      const tir = timeInRangeBreakdown(result.readings);
      const buckets = dailyPatternBuckets(result.readings, 30);
      const svg = renderDailyPatternSVG(buckets, GLUCOSE_BAND_PRESETS.narrow);
      glucoseSectionHtml = `
        <h2>Glucose</h2>
        <table class="clinic-report__table">
          <tr><td>Average glucose</td><td>${fmtG(stats.avgMgdl)} ${unitLbl}</td></tr>
          <tr><td>Estimated A1c (GMI)</td><td>${stats.gmi.toFixed(1)}%</td></tr>
          <tr><td>Time in range (70–180 mg/dL)</td><td>${Math.round(stats.timeInRangePct)}%</td></tr>
          <tr><td>Readings analyzed</td><td>${stats.count.toLocaleString()}</td></tr>
        </table>
        <h3>Time in Range breakdown</h3>
        <table class="clinic-report__table">
          ${tir.map(b => `<tr><td>${escapeHtml(b.label)} (${b.key === "veryHigh" ? ">250" : b.key === "veryLow" ? "<54" : b.low + "–" + b.high} mg/dL)</td><td>${Math.round(b.pct)}%</td></tr>`).join("")}
        </table>
        <h3>Daily pattern</h3>
        ${svg}
      `;
    } else {
      glucoseSectionHtml = `<h2>Glucose</h2><p>No glucose history available for this period.</p>`;
    }

    content.innerHTML = `
      <div class="clinic-report">
        <h1>Insulin Buddy — Glucose &amp; Dosing Summary</h1>
        <p class="clinic-report__meta">Period: last ${days} days (${periodLabel}) · Generated ${new Date().toLocaleString()}</p>
        ${glucoseSectionHtml}
        <h2>Dosing &amp; Food</h2>
        <table class="clinic-report__table">
          <tr><td>Meals logged</td><td>${dosing.mealsLogged} over ${dosing.days} day${dosing.days === 1 ? "" : "s"}</td></tr>
          <tr><td>Average daily carbs${dosing.eatingOutCount ? "*" : ""}</td><td>${round1(dosing.avgDailyCarbs)} g</td></tr>
          <tr><td>Average daily insulin</td><td>${round1(dosing.avgDailyInsulin)} u</td></tr>
          <tr><td>Lows treated</td><td>${dosing.lowsTreated}</td></tr>
          <tr><td>Correction-only entries</td><td>${dosing.correctionsOnly}</td></tr>
          ${dosing.eatingOutCount ? `<tr><td>Eating out (carbs not tracked)</td><td>${dosing.eatingOutCount}</td></tr>` : ""}
          ${dosing.basalDoses ? `
            <tr><td>Basal doses logged</td><td>${dosing.basalDoses}</td></tr>
            <tr><td>Average daily basal</td><td>${round1(dosing.avgDailyBasal)} u</td></tr>
            <tr><td>Average total daily insulin (basal + bolus)</td><td>${round1(dosing.avgDailyTotalInsulin)} u</td></tr>` : ""}
        </table>
        ${dosing.eatingOutCount ? `<p class="clinic-report__disclaimer" style="margin-top:4px;border-top:none;padding-top:0;">*Excludes ${dosing.eatingOutCount} meal${dosing.eatingOutCount === 1 ? "" : "s"} eaten out without a carb count.</p>` : ""}
        ${dosing.topFoods.length ? `
          <h3>Most frequently logged</h3>
          <ul>${dosing.topFoods.map(f => `<li>${escapeHtml(f.name)} (${f.count}×)</li>`).join("")}</ul>
        ` : ""}
        <p class="clinic-report__disclaimer">Generated from self-reported data logged in Insulin Buddy. Informational only — not a substitute for clinical judgment.</p>
      </div>
    `;
  }
  bind("clinic-report-close", "click", () => { el("clinic-report-overlay").hidden = true; });
  bind("clinic-report-print", "click", () => window.print());

  function renderGlucoseLegend(preset) {
    const items = [`<span class="glucose-legend__item"><span class="glucose-legend__swatch glucose-legend__swatch--line"></span>Median</span>`];
    if (preset.inner) items.push(`<span class="glucose-legend__item"><span class="glucose-legend__swatch glucose-legend__swatch--inner"></span>${preset.inner[0].slice(1)}–${preset.inner[1].slice(1)}th percentile</span>`);
    if (preset.outer) items.push(`<span class="glucose-legend__item"><span class="glucose-legend__swatch glucose-legend__swatch--outer"></span>${preset.outer[0].slice(1)}–${preset.outer[1].slice(1)}th percentile</span>`);
    items.push(`<span class="glucose-legend__item"><span class="glucose-legend__swatch glucose-legend__swatch--threshold"></span>70–180 range</span>`);
    return `<div class="glucose-legend">${items.join("")}</div>`;
  }

  // The same Time-in-Range breakdown screenshot you shared -- horizontal bars, high to low,
  // using the standard ADA/ATTD consensus bands (the same ones Dexcom Clarity and LibreLink use).
  function renderTimeInRangeHtml(readings, unit) {
    const breakdown = timeInRangeBreakdown(readings);
    const colors = { veryHigh: "#D97706", high: "#FBBF24", target: "#22C55E", low: "#FCA5A5", veryLow: "#DC2626" };
    const fmtB = v => unit === "mmol" ? round1(convertGlucose(v, "mgdl", "mmol")) : Math.round(v);
    const rangeLabel = b => {
      if (b.key === "veryHigh") return `&gt; ${fmtB(b.low - 1)}`;
      if (b.key === "veryLow") return `&lt; ${fmtB(b.high + 1)}`;
      return `${fmtB(b.low)}&ndash;${fmtB(b.high)}`;
    };
    const rows = breakdown.map(b => `
      <div class="tir-row">
        <div class="tir-row__range">${rangeLabel(b)}</div>
        <div class="tir-row__track"><div class="tir-row__fill" style="width:${Math.max(b.pct, b.pct > 0 ? 2 : 0)}%; background:${colors[b.key]};"></div></div>
        <div class="tir-row__pct">${Math.round(b.pct)}%</div>
      </div>
    `).join("");
    return `
      <h2 class="panel-card__title">Time in Range</h2>
      <p class="panel-card__hint" style="margin-top:-4px;">${unit === "mmol" ? "mmol/L" : "mg/dL"}</p>
      <div class="tir-bars">${rows}</div>
      <p class="panel-card__hint" style="margin-top:10px;">Target range: ${fmtB(70)}&ndash;${fmtB(180)} ${unit === "mmol" ? "mmol/L" : "mg/dL"}</p>
    `;
  }

  // A shared y-axis range for the glucose charts: scaling from 0 (as both charts used to)
  // wastes the bottom ~30-40% of the chart on a 0-70 band real glucose is essentially never
  // in, which visually compresses genuine variation in the 70-180 range most readings actually
  // occupy. This scales tightly around the actual data instead (with the 70-180 band always
  // guaranteed visible, never cropped out, plus a little breathing room), the same way
  // LibreLink/Dexcom-style charts do.
  function glucoseAxisRange(values) {
    const finite = (values || []).filter(v => typeof v === "number" && Number.isFinite(v));
    const dataMin = finite.length ? Math.min(70, ...finite) : 70;
    const dataMax = finite.length ? Math.max(180, ...finite) : 180;
    const pad = Math.max(10, (dataMax - dataMin) * 0.12);
    return { min: Math.max(0, Math.floor((dataMin - pad) / 10) * 10), max: Math.ceil((dataMax + pad) / 10) * 10 };
  }

  function renderDailyPatternSVG(buckets, preset) {
    if (buckets.length === 0) return null;
    const sorted = buckets.slice().sort((a, b) => a.minute - b.minute);
    const W = 340, H = 220, padL = 32, padR = 10, padT = 10, padB = 26;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const unit = state.settings.units;
    const toDisplay = v => unit === "mmol" ? convertGlucose(v, "mgdl", "mmol") : v;
    const fmtVal = v => unit === "mmol" ? round1(toDisplay(v)) : Math.round(toDisplay(v));
    // Always scale against p5/p95 (the widest band ever computed), regardless of which preset
    // is showing -- so switching presets never rescales the y-axis and makes the chart feel
    // like it's jumping around.
    const { min: axisMin, max: axisMax } = glucoseAxisRange(sorted.flatMap(b => [b.p5, b.p95]));

    const xFor = min => padL + (min / 1440) * plotW;
    const yFor = v => padT + plotH - ((v - axisMin) / (axisMax - axisMin)) * plotH;
    const band = (hi, lo) => {
      const top = sorted.map(b => `${xFor(b.minute).toFixed(1)},${yFor(b[hi]).toFixed(1)}`).join(" L");
      const bottom = sorted.slice().reverse().map(b => `${xFor(b.minute).toFixed(1)},${yFor(b[lo]).toFixed(1)}`).join(" L");
      return `M${top} L${bottom} Z`;
    };
    const line = key => sorted.map((b, i) => `${i === 0 ? "M" : "L"}${xFor(b.minute).toFixed(1)},${yFor(b[key]).toFixed(1)}`).join(" ");
    const lowY = yFor(70).toFixed(1), highY = yFor(180).toFixed(1);

    const fmtHour = h => h === 0 || h === 24 ? "12 AM" : h === 12 ? "12 PM" : h < 12 ? `${h} AM` : `${h - 12} PM`;
    let xTicks = "", xLabels = "";
    for (let h = 0; h <= 24; h += 3) {
      const x = xFor(h * 60).toFixed(1);
      xTicks += `<line x1="${x}" y1="${padT + plotH}" x2="${x}" y2="${padT + plotH + 3}" stroke="var(--ink-soft)" stroke-width="1"/>`;
      const anchor = h === 0 ? "start" : h === 24 ? "end" : "middle";
      xLabels += `<text x="${x}" y="${H - 6}" font-size="9" fill="var(--ink-soft)" text-anchor="${anchor}">${fmtHour(h)}</text>`;
    }

    return `
      <svg viewBox="0 0 ${W} ${H}" style="width:100%; height:auto; display:block;">
        <rect x="${padL}" y="${highY}" width="${plotW}" height="${(parseFloat(lowY) - parseFloat(highY)).toFixed(1)}" fill="#22C55E" opacity="0.07"/>
        <line x1="${padL}" y1="${lowY}" x2="${padL + plotW}" y2="${lowY}" stroke="#EF4444" stroke-width="1" stroke-dasharray="2,3" opacity="0.6"/>
        <line x1="${padL}" y1="${highY}" x2="${padL + plotW}" y2="${highY}" stroke="#F59E0B" stroke-width="1" stroke-dasharray="2,3" opacity="0.6"/>
        <text x="${padL - 4}" y="${(parseFloat(lowY) + 3).toFixed(1)}" font-size="8" fill="#EF4444" text-anchor="end">${fmtVal(70)}</text>
        <text x="${padL - 4}" y="${(parseFloat(highY) + 3).toFixed(1)}" font-size="8" fill="#F59E0B" text-anchor="end">${fmtVal(180)}</text>
        ${preset.outer ? `<path d="${band(preset.outer[1], preset.outer[0])}" fill="#3B82F6" opacity="0.14"/>` : ""}
        ${preset.inner ? `<path d="${band(preset.inner[1], preset.inner[0])}" fill="#3B82F6" opacity="0.28"/>` : ""}
        <path d="${line("p50")}" fill="none" stroke="#2563EB" stroke-width="2.25" stroke-linejoin="round" stroke-linecap="round"/>
        <line x1="${padL}" y1="${padT + plotH}" x2="${padL + plotW}" y2="${padT + plotH}" stroke="var(--line)" stroke-width="1"/>
        ${xTicks}
        ${xLabels}
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
    const { min: axisMin, max: axisMax } = glucoseAxisRange(points.map(p => p.sgv));
    const unit = state.settings.units;
    const toDisplay = v => unit === "mmol" ? convertGlucose(v, "mgdl", "mmol") : v;
    const fmtVal = v => unit === "mmol" ? round1(toDisplay(v)) : Math.round(toDisplay(v));

    const xFor = t => padL + ((t - startTime) / span) * plotW;
    const yFor = v => padT + plotH - ((v - axisMin) / (axisMax - axisMin)) * plotH;

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
          ${tabs.map(t => `<button class="graph-tab${t.key === startTab ? " is-active" : ""}" data-tab="${escapeAttr(t.key)}" type="button">${t.label}</button>`).join("")}
        </div>
        <div id="aiog-content"></div>
      </div>
    `;
    openSheet(backdrop);   // not appendChild: every sheet goes through openSheet so the page behind is pinned and the count is right
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
    renderAiogTab(backdrop, startTab, { fresh: true });
  }

  // ---- Basal insulin (History tab) ----
  // Records a long-acting dose. It deliberately never suggests one: it logs what was taken, nothing more.
  // Entries live in the normal history (so sync, undo, backup and Nightscout just work) but are kept out of
  // active insulin, corrections, trends and meal stats -- see isBasalEntry in js/history.js.
  function buildBasalRow(entry) {
    const row = document.createElement("div");
    row.className = "history-entry history-entry--basal";
    row.dataset.id = entry.id;
    const slotLabel = basalSlotLabel(entry.basalSlot);
    const units = Math.round((entry.basalDose || 0) * 100) / 100;
    row.innerHTML = `
      <div class="history-entry__icon" style="background:${BASAL_COLOR}">${iconBasal()}</div>
      <div class="history-entry__main">
        <p class="history-entry__title"><span class="history-entry__name">Basal</span> <span class="muted">${formatTime(entry.ts)}${slotLabel ? ` · ${slotLabel}` : ""}</span>${nsBadgeHtml(entry)}</p>
        <p class="history-entry__foods">Long-acting insulin</p>
        <div class="history-entry__detail" hidden>
          <div class="history-entry__row-actions">
            <button data-edit="${escapeAttr(entry.id)}" type="button">Edit</button>
            <button class="danger" data-del="${escapeAttr(entry.id)}" type="button">Delete</button>
          </div>
        </div>
      </div>
      <div class="history-entry__stats">
        <span class="dose-pill dose-pill--basal"><svg viewBox="0 0 24 24" fill="none"><path d="M12 2C12 2 5 10.5 5 15.5C5 19.6 8.13 22 12 22C15.87 22 19 19.6 19 15.5C19 10.5 12 2 12 2Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>${units}u</span>
      </div>
    `;
    return row;
  }

  function openBasalSheet(existing = null) {
    const editing = !!existing;
    const trigger = el("btn-log-basal");
    const startTs = editing ? existing.ts : Date.now();
    let slot = editing ? (existing.basalSlot || basalSlotForTime(startTs)) : basalSlotForTime(startTs);
    let slotChosenByHand = false;   // until the person taps Morning/Evening, the time of day decides the slot (editing included: moving a dose from 18:52 to 06:52 makes it a morning dose)
    let prefilled = null;             // what we put in the dose field ourselves, so we never overwrite typing
    let busy = false;
    const others = () => state.history.filter(e => e !== existing);   // an edit shouldn't compare against itself
    const fieldStyle = "padding:12px 14px; border:1.5px solid var(--line); border-radius:var(--radius-s); font-size:16px; background:var(--surface); color:var(--ink); font-family:var(--font-ui);";
    const when = ts => `${new Date(ts).toLocaleDateString(undefined, { weekday: "short" })} ${formatTime(ts)}`;

    const backdrop = document.createElement("div");
    backdrop.className = "sheet-backdrop";
    backdrop.innerHTML = `
      <div class="sheet basal-sheet" role="dialog" aria-modal="true" aria-labelledby="basal-title">
        <div class="sheet-head">
          <h2 id="basal-title">${editing ? "Edit basal dose" : "Log basal insulin"}</h2>
          <button class="sheet-close" id="basal-close" type="button" aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
          </button>
        </div>
        <div class="field-grid basal-slots" role="group" aria-label="Which dose">
          <button class="btn btn--secondary" data-slot="am" type="button">Morning</button>
          <button class="btn btn--secondary" data-slot="pm" type="button">Evening</button>
        </div>
        <div class="field">
          <label for="basal-units">Dose</label>
          <div class="basal-dose-row">
            <button class="basal-step" data-step="-1" type="button" aria-label="One unit less">&minus;</button>
            <div class="field__row"><input type="number" id="basal-units" inputmode="decimal" step="any" min="0" placeholder="0" value="${editing ? existing.basalDose : ""}"><span>units</span></div>
            <button class="basal-step" data-step="1" type="button" aria-label="One unit more">+</button>
          </div>
          <p class="basal-hint" id="basal-hint"></p>
          <p class="basal-error" id="basal-error" role="alert" hidden></p>
        </div>
        <div class="field">
          <label for="basal-time">Taken at</label>
          <input type="datetime-local" id="basal-time" value="${toDatetimeLocalValue(startTs)}" style="${fieldStyle}">
        </div>
        <p class="basal-note">Logged only. Insulin Buddy never suggests a basal dose, and it isn't counted in active insulin.</p>
        <div class="sheet-actions">
          <button class="btn btn--secondary" id="basal-cancel" type="button">Cancel</button>
          <button class="btn btn--primary" id="basal-save" type="button">${editing ? "Save Changes" : "Log dose"}</button>
        </div>
      </div>
    `;
    const $ = sel => backdrop.querySelector(sel);
    const unitsInput = $("#basal-units"), timeInput = $("#basal-time"), hintEl = $("#basal-hint"), errEl = $("#basal-error"), saveBtn = $("#basal-save");

    // Sized to what is typed (digits are all the same width here), so "14 units" reads as one centred group. When the
    // field stretched to fill the box it pushed "units" to the far edge. A half-typed "14." reads as empty to a number
    // field, so that case keeps a sensible width rather than collapsing.
    const fitDose = () => {
      const len = unitsInput.value ? unitsInput.value.length : (unitsInput.validity && unitsInput.validity.badInput ? 4 : 1);
      unitsInput.style.width = Math.max(2, len + 0.5) + "ch";
    };
    const refreshSlot = () => {
      backdrop.querySelectorAll("[data-slot]").forEach(b => {
        const on = b.dataset.slot === slot;
        b.classList.toggle("is-active", on);
        b.setAttribute("aria-pressed", String(on));
      });
      const last = lastBasalDose(others(), slot);
      const name = basalSlotLabel(slot).toLowerCase();
      hintEl.textContent = last ? `Last ${name} dose: ${last.units}u · ${when(last.ts)}. Change it if today's differs.` : `No ${name} dose logged yet.`;
      // Start from the last dose in this slot, but only ever replace a value we put there ourselves.
      const untouched = unitsInput.value === "" || unitsInput.value === String(prefilled);
      if (!editing && untouched) {
        if (last) { unitsInput.value = last.units; prefilled = last.units; }
        else { unitsInput.value = ""; prefilled = null; }
      }
      fitDose();
    };

    const close = () => {
      document.removeEventListener("keydown", onKey);
      closeSheet(backdrop);
      if (!editing && trigger && trigger.isConnected) trigger.focus({ preventScroll: true });
    };
    // Escape closes the sheet, unless a confirm dialog is open on top of it (that one handles its own Escape).
    const onKey = e => { if (e.key === "Escape" && !document.querySelector(".dialog-backdrop")) close(); };

    const save = async () => {
      if (busy) return;
      busy = true; saveBtn.disabled = true;
      try {
        errEl.hidden = true;
        const fail = msg => { errEl.textContent = msg; errEl.hidden = false; };
        const units = parseFloat(unitsInput.value);
        const ts = new Date(timeInput.value).getTime();
        if (isNaN(ts)) return fail("Choose when you took it.");
        if (ts > Date.now() + 5 * 60000) return fail("That time is in the future.");
        // A morning-looking time labelled Evening (or the reverse) is the easy slip that puts a dose in the wrong bar of the chart.
        const looksLike = basalSlotForTime(ts);
        if (looksLike !== slot && !(await dialogs.confirm(`${formatTime(ts)} looks like a ${basalSlotLabel(looksLike).toLowerCase()} dose, but it is set to ${basalSlotLabel(slot)}. Save it as ${basalSlotLabel(slot)} anyway?`, { title: "Check the time of day", confirmText: `Save as ${basalSlotLabel(slot)}` }))) return;
        const check = basalDoseCheck(units, lastBasalDose(others(), slot));
        if (check.level === "block") return fail(check.message);
        if (check.level === "confirm" && !(await dialogs.confirm(`${check.message} Log it anyway?`, { title: "Check this dose", confirmText: "Log it", danger: true }))) return;

        const dose = Math.round(units * 100) / 100;
        if (editing) {
          existing.basalDose = dose; existing.basalSlot = slot; existing.periodName = slot === "am" ? "morning" : "evening"; existing.ts = ts;
          state.history.sort((a, b) => b.ts - a.ts);
          saveState(); queueNsUpdate(existing); renderHistory();
          close();
        } else {
          const entry = makeBasalEntry({ units: dose, ts, slot });
          state.history.unshift(entry);
          state.history.sort((a, b) => b.ts - a.ts);
          saveState(); syncEntryToNightscout(entry); renderHistory();
          close();
          showUndoToast(`Basal ${entry.basalDose}u logged`, () => {
            const i = state.history.findIndex(h => h.id === entry.id);
            if (i >= 0) state.history.splice(i, 1);
            saveState(); queueNsDelete(entry); renderHistory();
          });
        }
      } finally { busy = false; saveBtn.disabled = false; }
    };

    backdrop.addEventListener("click", e => {
      if (e.target === backdrop || e.target.closest("#basal-close") || e.target.closest("#basal-cancel")) return close();
      const slotBtn = e.target.closest("[data-slot]");
      if (slotBtn) { slot = slotBtn.dataset.slot; slotChosenByHand = true; return refreshSlot(); }
      const stepBtn = e.target.closest("[data-step]");
      if (stepBtn) {
        const next = Math.max(0, Math.round(((parseFloat(unitsInput.value) || 0) + Number(stepBtn.dataset.step)) * 100) / 100);
        unitsInput.value = next; prefilled = null;   // a hand-set value is the person's, not a prefill
        fitDose();
      }
    });
    unitsInput.addEventListener("input", () => { errEl.hidden = true; fitDose(); });
    // The field is now only as wide as its digits, so the space around it is part of the box and should still focus it.
    $(".basal-dose-row .field__row").addEventListener("click", e => { if (e.target !== unitsInput) unitsInput.focus(); });
    const followTime = () => {
      const t = new Date(timeInput.value).getTime();
      if (!slotChosenByHand && !isNaN(t)) { slot = basalSlotForTime(t); refreshSlot(); }
    };
    timeInput.addEventListener("change", followTime);
    timeInput.addEventListener("input", followTime);
    saveBtn.addEventListener("click", save);
    document.addEventListener("keydown", onKey);

    refreshSlot();
    openSheet(backdrop);
    unitsInput.focus({ preventScroll: true });   // caret after the prefilled dose, nothing pre-selected; the X or backspace clears it
    try { const n = unitsInput.value.length; unitsInput.setSelectionRange(n, n); } catch { /* number inputs have no selection API */ }
  }

  // Quick-reference panel: mg/dL and mmol/L side by side, 40-400 in steps of 10. Split into two halves
  // shown next to each other (rather than one long list) so the whole range fits on a phone screen at a
  // glance with no scrolling. Rows are tinted by the same bands the Time in Range chart uses.
  function openGlucoseGuide() {
    const trigger = el("btn-glucose-guide");
    const rows = glucoseGuideRows(40, 400, 10);
    const half = Math.ceil(rows.length / 2);
    const tableHtml = list => `
      <table class="glucose-guide__table" aria-label="Conversion table, ${list[0].mgdl} to ${list[list.length - 1].mgdl} mg/dL">
        <thead><tr><th scope="col">mg/dL</th><th scope="col">mmol/L</th></tr></thead>
        <tbody>${list.map(r => `<tr class="glucose-guide__row glucose-guide__row--${r.band}"><td>${r.mgdl}</td><td>${r.mmol.toFixed(1)}</td></tr>`).join("")}</tbody>
      </table>`;
    // Legend ranges are stated in mg/dL (the bands' native unit); the table itself gives every mmol/L equivalent.
    const legend = [
      ["veryLow", "Very low", "<54"], ["low", "Low", "54–69"], ["target", "Target", "70–180"],
      ["high", "High", "181–250"], ["veryHigh", "Very high", ">250"]
    ];
    const backdrop = document.createElement("div");
    backdrop.className = "sheet-backdrop";
    backdrop.innerHTML = `
      <div class="sheet glucose-guide" role="dialog" aria-modal="true" aria-labelledby="glucose-guide-title">
        <div class="sheet-head">
          <h2 id="glucose-guide-title">Glucose guide</h2>
          <button class="sheet-close" id="glucose-guide-close" type="button" aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
          </button>
        </div>
        <div class="glucose-guide__tables">${tableHtml(rows.slice(0, half))}${tableHtml(rows.slice(half))}</div>
        <ul class="glucose-guide__legend">
          ${legend.map(([key, name, range]) => `<li class="glucose-guide__row--${key}"><i class="glucose-guide__swatch"></i>${name} <b>${range}</b></li>`).join("")}
        </ul>
        <p class="glucose-guide__foot">mmol/L = mg/dL &divide; 18. Colours match the Time in Range chart.</p>
      </div>
    `;
    const close = () => {
      document.removeEventListener("keydown", onKey);
      closeSheet(backdrop);
      if (trigger && trigger.isConnected) trigger.focus({ preventScroll: true });
    };
    const onKey = e => { if (e.key === "Escape") close(); };
    backdrop.addEventListener("click", e => { if (e.target === backdrop || e.target.closest("#glucose-guide-close")) close(); });
    document.addEventListener("keydown", onKey);
    openSheet(backdrop);
    backdrop.querySelector("#glucose-guide-close").focus({ preventScroll: true });
  }
  bind("btn-glucose-guide", "click", openGlucoseGuide);
  bind("btn-log-basal", "click", () => openBasalSheet());

  // ---- Glucose model views (js/glucose-model.js): what the readings say vs what the logged insulin alone would do ----
  function nsToReadings(entries) {
    return (entries || []).filter(e => typeof e.sgv === "number" && Number.isFinite(e.date)).map(e => ({ at: e.date, mgdl: e.sgv })).sort((a, b) => a.at - b.at);
  }
  function modelEntries() { return state.history.filter(e => !isBasalEntry(e)); }
  function modelParams() {
    return { isfMgdl: isfToMgdl(state.settings.isf, state.settings.units), peak: state.settings.insulinModel.peakMinutes, dia: state.settings.insulinModel.diaMinutes };
  }
  function modelSettings() { return { ...modelParams(), absMinutes: absorptionMinutesForEntry, fallbackRatio: 10 }; }
  const glucoseDisp = v => state.settings.units === "mmol" ? round1(convertGlucose(v, "mgdl", "mmol")) : Math.round(v);
  const mgUnitText = () => state.settings.units === "mmol" ? "mmol/L" : "mg/dL";
  const clockTime = t => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  /** A small multi-line glucose chart. lines: [{ pts:[{t,v}], stroke, dash?, width? }], nowT: optional vertical marker. Values in mg/dL. */
  function renderGlucoseLinesSVG(lines, nowT, markers) {
    const all = lines.flatMap(l => l.pts);
    if (all.length < 2) return "";
    const W = 320, H = 165, padL = 30, padR = 10, padT = 10, padB = 22;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const t0 = Math.min(...all.map(p => p.t)), t1 = Math.max(...all.map(p => p.t));
    const span = Math.max(1, t1 - t0);
    const { min: axisMin, max: axisMax } = glucoseAxisRange(all.map(p => p.v));
    const xFor = t => padL + ((t - t0) / span) * plotW;
    const yFor = v => padT + plotH - ((v - axisMin) / (axisMax - axisMin)) * plotH;
    const lowY = yFor(70).toFixed(1), highY = yFor(180).toFixed(1);
    const tickMin = [15, 30, 60, 120, 180, 240].find(m => span / (m * 60000) <= 6) || 240;
    const tickMs = tickMin * 60000;
    let ticks = "", lastX = -99;
    for (let t = Math.ceil(t0 / tickMs) * tickMs; t <= t1; t += tickMs) {
      const x = xFor(t).toFixed(1);
      if (x - lastX < 40) continue;   // never let two time labels run into each other
      lastX = Number(x);
      const anchor = x < padL + 14 ? "start" : x > padL + plotW - 14 ? "end" : "middle";
      ticks += `<line x1="${x}" y1="${padT + plotH}" x2="${x}" y2="${padT + plotH + 3}" stroke="var(--ink-soft)" stroke-width="1"/><text x="${x}" y="${H - 4}" font-size="9" fill="var(--ink-soft)" text-anchor="${anchor}">${clockTime(t)}</text>`;
    }
    const paths = lines.map(l => `<path d="${l.pts.map((p, i) => `${i ? "L" : "M"}${xFor(p.t).toFixed(1)},${yFor(p.v).toFixed(1)}`).join(" ")}" fill="none" stroke="${l.stroke}" stroke-width="${l.width || 2}"${l.dash ? ` stroke-dasharray="${l.dash}"` : ""} stroke-linejoin="round" stroke-linecap="round"/>`).join("");
    const nowLine = nowT && nowT > t0 && nowT < t1 ? `<line x1="${xFor(nowT).toFixed(1)}" y1="${padT}" x2="${xFor(nowT).toFixed(1)}" y2="${padT + plotH}" stroke="var(--ink-soft)" stroke-width="1" stroke-dasharray="1,3"/>` : "";
    return `
      <svg viewBox="0 0 ${W} ${H}" style="width:100%; height:auto; display:block;" role="img">
        <rect x="${padL}" y="${highY}" width="${plotW}" height="${(parseFloat(lowY) - parseFloat(highY)).toFixed(1)}" fill="#22C55E" opacity="0.08"/>
        <line x1="${padL}" y1="${lowY}" x2="${padL + plotW}" y2="${lowY}" stroke="#EF4444" stroke-width="1" stroke-dasharray="2,3" opacity="0.6"/>
        <line x1="${padL}" y1="${highY}" x2="${padL + plotW}" y2="${highY}" stroke="#F59E0B" stroke-width="1" stroke-dasharray="2,3" opacity="0.6"/>
        <text x="${padL - 4}" y="${(parseFloat(lowY) + 3).toFixed(1)}" font-size="8" fill="#EF4444" text-anchor="end">${glucoseDisp(70)}</text>
        <text x="${padL - 4}" y="${(parseFloat(highY) + 3).toFixed(1)}" font-size="8" fill="#F59E0B" text-anchor="end">${glucoseDisp(180)}</text>
        ${nowLine}${paths}${(markers || []).filter(m => m.t >= t0 && m.t <= t1).map(m => `<path d="M${xFor(m.t).toFixed(1)},${padT + plotH - 1} l-4,-8 h8 z" fill="#0D9488"><title>${m.label}</title></path>`).join("")}
        <line x1="${padL}" y1="${padT + plotH}" x2="${padL + plotW}" y2="${padT + plotH}" stroke="var(--line)" stroke-width="1"/>
        ${ticks}
      </svg>`;
  }
  const keyDot = (color, dashed, text) => `<span style="display:flex; align-items:center; gap:6px; font-size:0.8rem; color:var(--ink-soft);"><span style="width:16px; height:0; border-top:2px ${dashed ? "dashed" : "solid"} ${color}; display:inline-block;"></span>${text}</span>`;

  function basalLine(b) {
    const un = v => round1(v);
    if (b.status === "none") return "No basal doses are logged, so basal is assumed to cover what your liver releases.";
    if (b.status === "missing") return `<b>No basal dose logged in the last ${b.last ? Math.round((Date.now() - b.last.ts) / 3600000) + " h" : "while"}</b>, so this assumes it was taken as usual. If it was missed, expect glucose to sit above the dashed line.`;
    if (b.status === "adjusted") return `Your logged basal differs from your usual by <b>${b.extraUnits > 0 ? "+" : ""}${un(b.extraUnits)} u</b>, and that is included in the dashed line.`;
    return "Your logged basal is your usual dose, so it holds glucose steady and does not move the dashed line.";
  }

  /** Glucose tab: your readings next to where the logged insulin alone would have taken you from your last meal or dose. */
  function renderExpectedVsObservedHtml(readings) {
    const params = modelParams();
    if (!(params.isfMgdl > 0)) return `${secHead("Observed vs expected", "expected")}<p class="panel-card__hint">Set your correction factor in Settings to see this.</p>`;
    const exp = expectedFromInsulin(modelEntries(), readings, { ...params, now: Date.now(), basalEntries: state.history.filter(isBasalEntry) });
    if (!exp) return `${secHead("Observed vs expected", "expected")}<p class="panel-card__hint">No recent meal or insulin dose with a glucose reading beside it, so there is nothing to compare yet.</p>`;
    const pts = exp.points.filter(p => Number.isFinite(p.actual) && Number.isFinite(p.expected));
    const chart = renderGlucoseLinesSVG([
      { pts: pts.map(p => ({ t: p.t, v: p.expected })), stroke: "#6B7280", dash: "5,4", width: 1.8 },
      { pts: pts.map(p => ({ t: p.t, v: p.actual })), stroke: "#3B82F6" }
    ], null, exp.basal.markers.map(d => ({ t: d.ts, label: `Basal ${round1(d.units)} u` })));
    const gap = exp.now.gap, g = gapSummary(gap), u = mgUnitText(), amt = glucoseDisp(Math.abs(gap));
    const msg = g.kind === "above" ? `Your glucose is about <b>${amt} ${u} above</b> where the insulin alone would have it. The likely reason is carbs still absorbing — but food you didn't log, stress, illness or a sensor error would look the same.`
      : g.kind === "below" ? `Your glucose is about <b>${amt} ${u} below</b> where the insulin alone would have it — the carbs were absorbed faster than the insulin needed, or something else (activity, a stronger correction factor than the one in Settings) is lowering it.`
      : `Your glucose is <b>tracking</b> where the insulin alone would have it (within ${glucoseDisp(15)} ${u}).`;
    return `
      ${secHead("Observed vs expected", "expected", 18)}
      <p class="panel-card__hint">From ${clockTime(exp.anchor.t)} (your reading then: ${glucoseDisp(exp.anchor.mgdl)} ${u}), what your logged meal and correction insulin alone would do, using your Settings. ${basalLine(exp.basal)}</p>
      ${chart}
      <div style="display:flex; gap:16px; justify-content:center; flex-wrap:wrap; margin-top:8px;">${keyDot("#3B82F6", false, "Your readings")}${keyDot("#6B7280", true, "Expected from insulin alone")}${exp.basal.markers.length ? `<span style="display:flex; align-items:center; gap:6px; font-size:0.8rem; color:var(--ink-soft);"><span style="color:#0D9488;">&#9650;</span>Basal dose</span>` : ""}</div>
      ${exp.capped ? `<p class="panel-card__hint" style="margin-top:8px;">The dashed line stops at ${glucoseDisp(EXPECTED_FLOOR)} ${u}: that is only what the insulin would do with nothing else going on, and real glucose does not keep falling. Your liver, basal insulin and food all push back.</p>` : ""}
      <p class="panel-card__hint" style="margin-top:12px;">${msg}</p>`;
  }

  /** Now tab, once readings are in: the carbs line adjusted to the readings, plus the projected glucose. */
  function renderNowWithReadings(readings) {
    const now = Date.now();
    const entries = modelEntries(), ms = modelSettings();
    const ok = ms.isfMgdl > 0 && readings.length > 0;
    const obs = ok ? observedCarbs(entries, readings, ms, now) : null;
    const u = mgUnitText();
    let adjust = "";
    if (obs && obs.observed) adjust = `<p class="panel-card__hint">The carbs line follows your glucose readings: about <b>${Math.round(obs.cob)} g</b> still to absorb (the fixed timers alone would say ${Math.round(obs.modelCob)} g).</p>`;
    else if (obs && obs.cob > 0) adjust = `<p class="panel-card__hint">Not enough readings since your last meal to adjust the carbs line, so it uses your ${state.settings.useLearnedAbsorption && state.settings.learnedAbsorption ? "learned" : "fixed"} absorption times.</p>`;
    let proj = "";
    const p = ok ? projectGlucose(entries, readings, ms, now) : null;
    if (p) {
      const recent = readings.filter(r => r.at >= p.start.t - 90 * 60000 && r.at <= p.start.t);
      const chart = renderGlucoseLinesSVG([
        { pts: recent.map(r => ({ t: r.at, v: r.mgdl })), stroke: "#3B82F6" },
        { pts: p.points.map(q => ({ t: q.t, v: q.mgdl })), stroke: "#8B5CF6", dash: "5,4" }
      ], now);
      const dips = p.low.mgdl < 70 ? `<p class="panel-card__hint" style="color:#B91C1C;">This projection dips below ${glucoseDisp(70)} ${u}. It is an estimate only.</p>` : "";
      proj = `
        ${secHead("Projected glucose", "projection", 18)}
        <p class="panel-card__hint">A projection from your last reading (${glucoseDisp(p.start.mgdl)} ${u}, ${clockTime(p.start.t)}), <b>assuming no further food or insulin</b>. It is not a measurement and not dosing advice; it ignores basal insulin, exercise, illness and sensor error.</p>
        ${chart}
        <div style="display:flex; gap:16px; justify-content:center; margin-top:8px;">${keyDot("#3B82F6", false, "Your readings")}${keyDot("#8B5CF6", true, "Projection")}</div>
        <p class="panel-card__hint" style="margin-top:12px;">Settles around <b>${glucoseDisp(p.end.mgdl)} ${u}</b> by ${clockTime(p.end.t)}; highest about ${glucoseDisp(p.high.mgdl)}, lowest about ${glucoseDisp(p.low.mgdl)}.</p>${dips}`;
    } else if (ok) proj = `${secHead("Projected glucose", "projection", 18)}<p class="panel-card__hint">No glucose reading in the last 15 minutes, so there is no projection.</p>`;
    else proj = `${secHead("Projected glucose", "projection", 18)}<p class="panel-card__hint">${ms.isfMgdl > 0 ? "No glucose readings found." : "Set your correction factor in Settings to see a projection."}</p>`;
    return `
      ${secHead("Active insulin & carbs", "iobcob")}
      <p class="panel-card__hint">Projected forward from now assuming no further food or insulin — a real dose or meal will change this.</p>
      ${renderActiveGraphSVG(buildActiveSeries(obs))}
      ${aiogLegendHtml()}
      ${adjust}
      ${proj}`;
  }

  /** Learns how long carbs really take (per GI group) from past meals and stores the result; used when "Use my learned times" is on. */
  async function refreshLearnedAbsorption() {
    let readings = null, reason = "";
    if (supabaseClient && currentUser && nightscoutConfigured()) {
      const r = await fetchStoredGlucoseReadings(60);
      if (r.ok && r.readings.length) readings = r.readings; else if (!r.ok) reason = r.reason;
    }
    if (!readings) {
      const r = await fetchGlucoseHistory(80);
      if (r.ok) readings = nsToReadings(r.entries); else reason = r.reason;
    }
    if (!readings || !readings.length) return { ok: false, reason: reason || "No glucose readings found." };
    const params = modelParams();
    if (!(params.isfMgdl > 0)) return { ok: false, reason: "Set your correction factor first." };
    const res = learnAbsorption(modelEntries(), readings, { ...params, now: Date.now() });
    state.settings.learnedAbsorption = { ...res, at: Date.now() };
    saveState();
    renderInsulinCarbSettings();
    renderActivePanel();
    return { ok: true };
  }

  // ---- "i" explainers: a small button beside each graph's heading that opens a plain-English account of how it is worked out ----
  function infoText(key) {
    const im = state.settings.insulinModel, ca = effectiveCarbAbsorption(), u = glucoseUnitLabel_();
    const learned = state.settings.useLearnedAbsorption && state.settings.learnedAbsorption ? "your learned times" : "your timers in Settings";
    const isf = state.settings.isf;
    const T = {
      iobcob: `<p><b>Insulin (blue).</b> Every dose you logged in the last ${Math.round(im.diaMinutes / 60)} hours is counted. A dose doesn't vanish at once: it works along a curve that peaks about ${im.peakMinutes} minutes after the injection and is spent after ${im.diaMinutes} minutes (Settings &gt; Insulin). Adding up what is left of each dose gives the line.</p>
        <p><b>Carbs (orange).</b> Each meal's carbs are counted down over how long that kind of food takes to absorb, from ${learned}: high GI ${ca.high} min, medium ${ca.medium}, low ${ca.low}, unknown ${ca.unknown}.</p>
        <p>If your glucose readings are available, the carbs line is <b>adjusted to them</b>: the rise in your glucose since the meal, less the rise that insulin alone would allow, is the part the carbs must be responsible for. A faster rise means the carbs are being absorbed faster, so the line drops sooner (never later than 1.5&times; the usual time). With no readings it uses the plain timer.</p>
        <p>Everything to the right of "now" assumes you log nothing more.</p>`,
      projection: `<p>This is a <b>projection, not a measurement and not advice</b>. It starts from your latest reading and draws two things that are already in motion:</p>
        <p>&bull; <b>Falls</b> as the insulin still on board finishes working: each dose &times; your correction factor (${isf} ${u} per unit) &times; the share of it still to act.</p>
        <p>&bull; <b>Rises</b> as the carbs still on board are absorbed: grams left &times; (correction factor &divide; the carb ratio you used for that meal) &mdash; the carbs line from above, converted to glucose.</p>
        <p>It assumes no further food, insulin, exercise or illness, ignores basal insulin, and can be thrown off by sensor error. It is hidden when your last reading is over 15 minutes old.</p>`,
      expected: `<p>From your last meal or dose that has a glucose reading beside it, the dashed line shows where glucose would go if <b>only the logged insulin acted</b>: that starting reading minus the insulin's effect so far (each dose &times; ${isf} ${u} per unit &times; the share already acted).</p>
        <p>The blue line is your real readings. The <b>gap</b> between them is what the insulin doesn't explain &mdash; usually carbs still being absorbed (or absorbed faster or slower than the dose assumed), but also unlogged food, stress, illness, activity or sensor error.</p>
        <p>A gap within 15 ${u} is called "tracking".</p>
        <p><b>Basal:</b> taken as usual, basal is assumed to cancel what your liver releases, so it leaves the line alone &mdash; that is why the dashed line looks like glucose falling with nothing to hold it up. Only a basal dose that differs from your usual (the median of your last logged doses in that slot, at least 3 needed) changes the line, spread evenly over 12 or 24 hours. A teal triangle marks each basal dose logged in the window. The dashed line stops at ${glucoseDisp(EXPECTED_FLOOR)} ${u}. Exercise is not modelled.</p>`,
      today: `<p>The same insulin and carb curves as the Now tab, replayed for each moment since midnight using what you logged. Nothing here is predicted &mdash; it shows how much was active at each time. Carb times come from ${learned}.</p>`,
      glucose: `<p>Your real glucose readings from Nightscout for the chosen window. The green band is the standard 70&ndash;180 mg/dL range; dashed lines mark its edges.</p>`
    };
    return T[key] || "";
  }
  const glucoseUnitLabel_ = () => state.settings.units === "mmol" ? "mmol/L" : "mg/dL";
  function secHead(title, key, top = 0) {
    return `<div class="aiog-head" style="margin-top:${top}px;"><h3 class="aiog-h">${title}</h3><button type="button" class="info-btn" aria-expanded="false" aria-label="How is ${escapeAttr(title)} worked out?">i</button></div><div class="info-panel" hidden>${infoText(key)}</div>`;
  }
  document.addEventListener("click", e => {
    const btn = e.target.closest && e.target.closest(".info-btn");
    if (!btn) return;
    const panel = btn.parentElement.nextElementSibling;
    if (!panel || !panel.classList.contains("info-panel")) return;
    panel.hidden = !panel.hidden;
    btn.setAttribute("aria-expanded", String(!panel.hidden));
  });

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

  async function renderAiogTab(backdrop, tab, { fresh = false } = {}) {   // fresh: the sheet was just opened, so always catch up on new readings (a tiny request)
    const content = backdrop.querySelector("#aiog-content");
    content.dataset.tab = tab;
    if (tab === "now") {
      const plain = () => `
        ${secHead("Active insulin & carbs", "iobcob")}
        <p class="panel-card__hint">Projected forward from now assuming no further food or insulin — a real dose or meal will change this.</p>
        ${renderActiveGraphSVG(buildActiveSeries())}
        ${aiogLegendHtml()}
      `;
      if (!nightscoutConfigured()) { content.innerHTML = plain(); return; }
      const L = state.settings.learnedAbsorption;
      if (state.settings.useLearnedAbsorption && (!L || Date.now() - L.at > 86400_000)) refreshLearnedAbsorption().catch(() => {});
      // Paint at once from the saved readings; only redraw when the refresh brings something new (and never while an explanation is open).
      const cached = glucoseEntriesWithin(8);
      const live = () => content.isConnected && content.dataset.tab === "now";
      const repaint = () => { if (live() && !content.querySelector(".info-panel:not([hidden])")) content.innerHTML = renderNowWithReadings(nsToReadings(glucoseEntriesWithin(8))); };
      if (cached.length) content.innerHTML = renderNowWithReadings(nsToReadings(cached));
      else { content.innerHTML = plain(); content.insertAdjacentHTML("beforeend", `<p class="panel-card__hint" id="aiog-live-note" style="margin-top:12px;">Checking your glucose readings…</p>`); }
      const unsub = onGlucoseUpdate(() => { if (!live()) { unsub(); return; } repaint(); });
      const r = await refreshGlucoseStore({ maxAgeMs: fresh ? 0 : 15000 });
      if (!live()) { unsub(); return; }
      if (!r.ok && !cached.length) { const n = el("aiog-live-note"); if (n) n.textContent = `Couldn't load glucose to adjust this: ${r.reason}`; }
    } else if (tab === "today") {
      const series = buildTodaySeries();
      content.innerHTML = `
        ${secHead("Today so far", "today")}
        <p class="panel-card__hint">What actually happened today, from midnight to now.</p>
        ${renderActiveGraphSVG(series)}
        ${aiogLegendHtml()}
      `;
    } else if (tab === "glucose") {
      const live = () => content.isConnected && content.dataset.tab === "glucose";
      const picker = `
        <div class="glucose-range-picker">
          ${GLUCOSE_WINDOWS_HOURS.map(h => `<button type="button" class="glucose-range-btn${h === glucoseWindowHours ? " is-active" : ""}" data-hours="${h}">${h}h</button>`).join("")}
        </div>
      `;
      const paint = (note = "") => {
        const list = glucoseEntriesWithin(glucoseWindowHours);
        const entries = list.slice().sort((a, b) => a.date - b.date);
        const latest = entries[entries.length - 1];
        const svg = renderGlucoseGraphSVG(list);
        content.innerHTML = `
          ${renderGlucoseBannerHtml(latest)}
          ${picker}
          ${note}
          ${secHead("Your glucose", "glucose")}
          ${svg ? svg : `<p class="panel-card__hint">No recent glucose data found.</p>`}
          ${svg ? `<p class="panel-card__hint" style="margin-top:10px;">Dashed lines mark the standard 70&ndash;180 range.</p>` : ""}
          ${renderExpectedVsObservedHtml(nsToReadings(list))}
        `;
        bindPicker();
      };
      const bindPicker = () => content.querySelectorAll(".glucose-range-btn").forEach(btn => {
        btn.addEventListener("click", () => { glucoseWindowHours = Number(btn.dataset.hours); renderAiogTab(backdrop, "glucose"); });
      });
      const hadCache = glucoseEntriesWithin(glucoseWindowHours).length > 0;
      if (hadCache) paint(); else content.innerHTML = `<p class="panel-card__hint">Loading recent glucose…</p>`;
      const unsub = onGlucoseUpdate(() => { if (!live()) { unsub(); return; } if (!content.querySelector(".info-panel:not([hidden])")) paint(); });
      const r = await refreshGlucoseStore({ maxAgeMs: fresh ? 0 : 15000 });
      if (!live()) { unsub(); return; }
      if (!r.ok) {
        if (hadCache) paint(`<p class="panel-card__hint" style="color:#B45309;">Showing saved readings &mdash; couldn't reach Nightscout (${escapeHtml(r.reason)}).</p>`);
        else { content.innerHTML = `${picker}<p class="panel-card__hint" style="color:#B91C1C;">Couldn't load glucose: ${escapeHtml(r.reason)}</p>`; bindPicker(); }
      } else if (!hadCache) paint();
    }
  }
  bind("active-panel", "click", () => openActiveDetailSheet("now"));
  bind("cc-live-glucose", "click", () => openActiveDetailSheet("glucose"));

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

  // A typed dose that can't be read as a number (letters, "1.2.3") is never half-understood, and must never leave the Log button
  // greyed out for no visible reason: say so. (A lone "." or "," is just someone part-way through typing, so it isn't flagged.)
  function showDoseEntryProblem(inputId, messageId, active) {
    const text = el(inputId).value.trim();
    const unreadable = active && text !== "" && isNaN(parseDecimalInput(text)) && !/^[.,]$/.test(text);
    el(messageId).hidden = !unreadable;
    el(inputId).setAttribute("aria-invalid", unreadable ? "true" : "false");
  }

  function recompute() {
    // Eating Out: carbs aren't being tracked for this entry at all, so the carbs pill and the
    // ratio-based formula are both bypassed in favor of the insulin dose entered directly.
    const carbs = draft.eatingOutOn ? 0 : totalCarbs();
    carbsPill.textContent = draft.eatingOutOn ? "Carbs not logged" : `${round1(carbs)}g Carbs`;

    const ratioEntry = activeRatioEntry();
    ratioValueLabel.textContent = ratioEntry ? `1:${ratioEntry.ratio}` : "—";

    // All the dose maths lives in planDose (js/calc.js); this screen only gathers what was typed and shows the result.
    const typedMeal = draft.eatingOutOn ? parseDecimalInput(el("cc-eating-out-dose").value) : NaN;
    const correctionMode = draft.correctionOn ? (draft.correctionManual ? "manual" : "auto") : "off";
    showDoseEntryProblem("cc-eating-out-dose", "cc-eating-out-error", draft.eatingOutOn);
    showDoseEntryProblem("cc-correction-manual-input", "cc-correction-manual-error", draft.correctionOn && draft.correctionManual);
    const plan = planDose({
      carbs, ratio: ratioEntry ? ratioEntry.ratio : 0,
      mealUnits: draft.eatingOutOn ? (!isNaN(typedMeal) && typedMeal > 0 ? typedMeal : 0) : null,
      correction: correctionMode, glucose: glucoseInput.value, glucoseUnit: draft.glucoseUnit,
      correctionUnits: parseDecimalInput(el("cc-correction-manual-input").value) * (draft.correctionSign === -1 ? -1 : 1),   // typed as a size; Add or Subtract gives it its sign
      iob: correctionMode === "auto" && state.settings.iobAwareCorrection ? calcActiveInsulinAndCarbs().iob : 0,
      noInsulin: draft.noInsulinOn, settings: state.settings
    });
    const { mealPart, correctionPart, iobSubtracted } = plan;
    const rawCorrectionPart = plan.rawCorrection;
    // Show the working, so a correction can be checked at a glance against the Settings it came from.
    const workingEl = el("cc-correction-working");
    if (workingEl) {
      const bgNow = parseFloat(glucoseInput.value);
      if (draft.correctionOn && !draft.correctionManual && !isNaN(bgNow) && bgNow > 0 && state.settings.isf > 0) {
        const inUnit = convertGlucose(bgNow, draft.glucoseUnit, state.settings.units);
        const uLabel = unitLabel(state.settings.units);
        workingEl.textContent = rawCorrectionPart > 0
          ? `(${round1(inUnit)} \u2212 ${state.settings.target} target) \u00f7 ${state.settings.isf} ${uLabel} per unit = ${round1(rawCorrectionPart)}u, rounded to ${roundDose(correctionPart)}u`
          : rawCorrectionPart < 0
            ? `Low: (${round1(inUnit)} \u2212 ${state.settings.target} target) \u00f7 ${state.settings.isf} ${uLabel} per unit = ${round1(rawCorrectionPart)}u, so ${Math.abs(plan.correctionDose)}u is taken off the meal dose${plan.reductionLimited ? " (all of it: a dose can't go below zero)" : ""}`
            : inUnit < state.settings.target
              ? `${round1(inUnit)} is below your ${state.settings.target} ${uLabel} target, so no correction. Turn on "Lower the dose when glucose is below target" in Settings > Dosing to take insulin off the meal instead`
              : `${round1(inUnit)} is at or below your ${state.settings.target} ${uLabel} target, so no correction`;
        workingEl.hidden = false;
      } else workingEl.hidden = true;
    }
    const iobNote = el("cc-iob-adjust-note");
    if (iobSubtracted > 0.05) {
      iobNote.textContent = `Correction: ${round1(rawCorrectionPart)}u − ${round1(iobSubtracted)}u IOB = ${round1(correctionPart)}u`;
      iobNote.hidden = false;
    } else {
      iobNote.hidden = true;
    }

    // The cap reduces the parts that get saved, not just the number shown, and a typed dose is never altered (see planDose).
    const { mealDose: loggedMealDose, correctionDose: loggedCorrectionDose, finalDose } = plan;
    doseNumber.textContent = finalDose.toFixed(1);
    // When a correction is part of the dose, show the two parts that make it up, so the sum can be checked at a glance.
    const breakdownEl = el("cc-dose-breakdown");
    const showBreakdown = !draft.noInsulinOn && loggedCorrectionDose !== 0 && (loggedMealDose > 0 || loggedCorrectionDose < 0);
    breakdownEl.hidden = !showBreakdown;
    if (showBreakdown) {
      breakdownEl.textContent = loggedCorrectionDose > 0
        ? `Meal ${loggedMealDose} u + correction ${loggedCorrectionDose} u`
        : `Meal ${loggedMealDose} u \u2212 ${Math.abs(loggedCorrectionDose)} u taken off`;
    }
    // Keep the Add / Subtract switch showing what the draft says (a reset or a restored draft changes it from elsewhere).
    el("cc-correction-sign").querySelectorAll(".correction-sign__btn").forEach(b => {
      const on = (draft.correctionSign === -1) === (b.dataset.sign === "-1");
      b.classList.toggle("is-active", on); b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    // A quiet second opinion against your own recent doses; it never blocks and costs nothing until the dose changes.
    const nudgeEl = el("cc-dose-nudge");
    const sane = (!draft.noInsulinOn && finalDose >= 1) ? doseSanity(getSanityPool(), { carbs, mealDose: loggedMealDose, finalDose }) : null;
    nudgeEl.hidden = !sane; if (sane) nudgeEl.textContent = sane.text;
    const capNote = el("cc-cap-note");
    const showCapNote = !draft.noInsulinOn && (plan.capped || plan.overMax);
    capNote.hidden = !showCapNote;
    if (showCapNote) {
      capNote.textContent = plan.capped
        ? `Capped at your ${state.settings.maxDose} u maximum. The calculation came to ${plan.requested} u.`
        : `${finalDose} u is above your ${state.settings.maxDose} u maximum dose. You typed it, so it hasn't been changed. Check it is right.`;
    }

    const hasSomethingToLog = plan.hasDose;
    logBtn.disabled = !hasSomethingToLog;
    // When Log is off, say why, in words, so a greyed-out button is never a mystery.
    const whyEl = el("cc-log-why");
    let why = "";
    if (!hasSomethingToLog) {
      if (draft.correctionOn && draft.correctionManual) {
        const raw = el("cc-correction-manual-input").value.trim();
        if (raw === "") why = "Type the correction dose in the box above.";
        else if (isNaN(parseDecimalInput(raw))) why = "";
        else why = `The dose read as ${raw}, and 0 units has nothing to log.`;
      } else if (draft.correctionOn && glucoseInput.value.trim() !== "") {
        why = `No correction is needed at ${glucoseInput.value.trim()} ${unitLabel(draft.glucoseUnit || state.settings.units)}, so there is nothing to log. Use "Enter dose manually" to give a dose anyway.`;
      }
    }
    whyEl.textContent = why; whyEl.hidden = !why;
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

    draft._computed = { carbs, mealDose: loggedMealDose, correctionDose: loggedCorrectionDose, finalDose, ratioEntry, requested: plan.requested, capped: plan.capped };
  }

  // The history boiled down once and reused until it changes (length or newest/oldest entry), so keystrokes never rescan it.
  let sanityCache = { key: "", pool: [] };
  function getSanityPool() {
    const h = state.history, key = `${h.length}|${h[0] && h[0].id}|${h[h.length - 1] && h[h.length - 1].id}|${new Date().toDateString()}`;
    if (sanityCache.key !== key) sanityCache = { key, pool: sanityPool(h, Date.now()) };
    return sanityCache.pool;
  }

  // Manual correction mode: lets a dose be entered directly, skipping the glucose/ISF formula
  // for cases where the automatic calculation isn't what's wanted right now (illness, exercise,
  // a clinician's instruction for the day, etc.). Starts fresh in automatic mode every time
  // correction is turned on for a new meal -- deliberately not sticky across meals, since a
  // silent manual override carrying into an unrelated future dose would be an easy way to end
  // up giving an unintended dose.
  function setCorrectionManualMode(manual) {
    draft.correctionManual = manual;
    el("cc-correction-auto-wrap").hidden = manual;
    el("cc-correction-manual-wrap").hidden = !manual;
    if (manual) { el("cc-correction-manual-input").focus(); }
    else { if (!draft.glucoseUnit) draft.glucoseUnit = state.settings.units; glucoseUnitLabel.textContent = unitLabel(draft.glucoseUnit); glucoseInput.focus(); }
    recompute();
    saveDraftLocal();
  }
  bind("cc-correction-manual-link", "click", () => setCorrectionManualMode(true));
  bind("cc-correction-auto-link", "click", () => setCorrectionManualMode(false));
  bind("cc-correction-manual-input", "input", () => { recompute(); saveDraftLocal(); });
  el("cc-correction-sign").addEventListener("click", e => {
    const b = e.target.closest(".correction-sign__btn");
    if (!b) return;
    draft.correctionSign = b.dataset.sign === "-1" ? -1 : 1;
    recompute(); saveDraftLocal();
  });

  correctionToggle.addEventListener("click", () => {
    draft.correctionOn = !draft.correctionOn;
    correctionToggle.classList.toggle("is-active", draft.correctionOn);
    correctionRow.hidden = !draft.correctionOn;
    draft.correctionManual = false;
    draft.correctionSign = 1;   // a subtraction never carries over into the next correction
    el("cc-correction-auto-wrap").hidden = false;
    el("cc-correction-manual-wrap").hidden = true;
    el("cc-correction-manual-input").value = "";
    el("cc-fetch-glucose").hidden = !(draft.correctionOn && nightscoutConfigured());
    el("cc-fetch-glucose-status").hidden = true;
    if (draft.correctionOn && draft.noInsulinOn) {
      draft.noInsulinOn = false;
      el("cc-no-insulin-toggle").classList.remove("is-active");
      el("cc-no-insulin-note").hidden = true;
      el("quick-carb-row").hidden = true;
    }
    if (!draft.glucoseUnit) draft.glucoseUnit = state.settings.units;
    glucoseUnitLabel.textContent = unitLabel(draft.glucoseUnit);
    if (draft.correctionOn) glucoseInput.focus();
    recompute();
    saveDraftLocal();
  });

  bind("cc-no-insulin-toggle", "click", () => {
    draft.noInsulinOn = !draft.noInsulinOn;
    el("cc-no-insulin-toggle").classList.toggle("is-active", draft.noInsulinOn);
    el("cc-no-insulin-note").hidden = !draft.noInsulinOn;
    el("quick-carb-row").hidden = !draft.noInsulinOn;
    renderQuickUsual();
    if (draft.noInsulinOn && draft.correctionOn) {
      draft.correctionOn = false;
      correctionToggle.classList.remove("is-active");
      correctionRow.hidden = true;
    }
    if (draft.noInsulinOn && draft.eatingOutOn) setEatingOutMode(false);
    recompute();
    saveDraftLocal();
  });

  // Eating Out: the opposite of Treating a Low -- insulin is known exactly (already decided or
  // already taken) but carbs aren't worth estimating precisely, so skip food entry entirely and
  // log just the insulin dose. Mutually exclusive with Treating a Low (can't simultaneously be
  // "no insulin" and "insulin only"); independent of Correction, which can still stack on top.
  function setEatingOutMode(on) {
    draft.eatingOutOn = on;
    el("cc-eating-out-toggle").classList.toggle("is-active", on);
    el("cc-eating-out-note").hidden = !on;
    el("cc-eating-out-row").hidden = !on;
    el("cc-food-section").hidden = on;
    if (on) el("cc-eating-out-dose").focus();
  }
  bind("cc-eating-out-toggle", "click", () => {
    setEatingOutMode(!draft.eatingOutOn);
    if (draft.eatingOutOn && draft.noInsulinOn) {
      draft.noInsulinOn = false;
      el("cc-no-insulin-toggle").classList.remove("is-active");
      el("cc-no-insulin-note").hidden = true;
      el("quick-carb-row").hidden = true;
    }
    recompute();
    saveDraftLocal();
  });
  bind("cc-eating-out-dose", "input", () => { recompute(); saveDraftLocal(); });
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
    // Only today's ranges: one limited to other days of the week (a Sunday-only range on a Monday) is left out to keep the
    // list short. A range picked by hand stays listed so it can still be seen and changed.
    const today = new Date().getDay();
    const rows = [
      ...state.settings.timeRatios.filter(r => { const d = bracketDays(r); return !d.length || d.includes(today) || r.id === draft.manualRatioId; }).map(r => ({ ...r, kind: "time" })),
      ...state.settings.activityRatios.map(r => ({ ...r, kind: "activity" }))
    ];
    ratioPicker.innerHTML = rows.map(r => `
      <button class="ratio-picker__item" data-id="${escapeAttr(r.id)}" type="button">
        <span class="ratio-picker__name"><span class="ratio-picker__dot" style="background:${escapeAttr(r.color)}"></span><span class="ratio-picker__label">${escapeHtml(r.name)}</span>${r.kind === "time" ? (() => { const meta = daysLabel(r) ? `${daysLabel(r)} · ${r.start}–${r.end}` : `${r.start}–${r.end}`; return `<span class="ratio-picker__meta" title="${escapeAttr(meta)}">${escapeHtml(meta)}</span>`; })() : ""}</span>
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
      store.setItem(DRAFT_KEY, JSON.stringify({
        items: draft.items,
        correctionOn: draft.correctionOn,
        correctionManual: draft.correctionManual,
        correctionManualValue: el("cc-correction-manual-input").value || "",
        correctionSign: draft.correctionSign === -1 ? -1 : 1,
        noInsulinOn: draft.noInsulinOn,
        eatingOutOn: draft.eatingOutOn,
        eatingOutValue: el("cc-eating-out-dose").value || "",
        glucose: glucoseInput.value || "",
        glucoseUnit: draft.glucoseUnit,
        manualRatioId: draft.manualRatioId
      }));
    } catch (e) { /* storage unavailable — non-fatal, draft just won't survive a reload */ }
  }
  function loadDraftLocal() {
    try {
      const raw = store.getItem(DRAFT_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function clearDraftLocal() { store.removeItem(DRAFT_KEY); }

  function restoreDraftIfAny() {
    const saved = loadDraftLocal();
    // Eating Out drafts have no items at all (that's the point), so they'd never pass an
    // items-only guard here -- the eatingOutOn flag is itself evidence of a real in-progress
    // entry worth restoring (a typed insulin dose), same as a non-empty item list is otherwise.
    // A correction typed with no foods at all (a manual dose, or a glucose reading) is just as real an in-progress entry as an
    // Eating Out dose, and was being thrown away on reload because it has no items.
    const hasTypedCorrection = !!saved && !!saved.correctionOn && !!(saved.correctionManualValue || saved.glucose);
    if (!saved || (!Array.isArray(saved.items) || saved.items.length === 0) && !saved.eatingOutOn && !hasTypedCorrection) return;
    draft.items = saved.items || [];
    draft.manualRatioId = saved.manualRatioId || null;
    draft.glucoseUnit = saved.glucoseUnit || state.settings.units;
    if (saved.glucose) glucoseInput.value = saved.glucose;
    if (saved.correctionOn) {
      draft.correctionOn = true;
      correctionToggle.classList.add("is-active");
      correctionRow.hidden = false;
      glucoseUnitLabel.textContent = unitLabel(draft.glucoseUnit);
      if (saved.correctionManual) {
        draft.correctionManual = true;
        el("cc-correction-auto-wrap").hidden = true;
        el("cc-correction-manual-wrap").hidden = false;
        if (saved.correctionManualValue) el("cc-correction-manual-input").value = saved.correctionManualValue;
        draft.correctionSign = saved.correctionSign === -1 ? -1 : 1;
      }
    }
    if (saved.noInsulinOn) {
      draft.noInsulinOn = true;
      el("cc-no-insulin-toggle").classList.add("is-active");
      el("cc-no-insulin-note").hidden = false;
      el("quick-carb-row").hidden = false;
    }
    if (saved.eatingOutOn) {
      draft.eatingOutOn = true;
      el("cc-eating-out-toggle").classList.add("is-active");
      el("cc-eating-out-note").hidden = false;
      el("cc-eating-out-row").hidden = false;
      el("cc-food-section").hidden = true;
      if (saved.eatingOutValue) el("cc-eating-out-dose").value = saved.eatingOutValue;
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
    draft = { items: [], correctionOn: false, correctionManual: false, noInsulinOn: false, eatingOutOn: false, glucose: "", glucoseUnit: null, manualRatioId: null };
    searchInput.value = ""; searchClearBtn.hidden = true; gramsInput.value = ""; gramsInput.disabled = false;
    glucoseInput.value = "";
    correctionToggle.classList.remove("is-active");
    correctionRow.hidden = true;
    el("cc-no-insulin-toggle").classList.remove("is-active");
    el("cc-no-insulin-note").hidden = true;
    el("quick-carb-row").hidden = true;
    el("cc-eating-out-toggle").classList.remove("is-active");
    el("cc-eating-out-note").hidden = true;
    el("cc-eating-out-row").hidden = true;
    el("cc-eating-out-dose").value = "";
    el("cc-food-section").hidden = false;
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
  logBtn.addEventListener("click", () => {
    const hasCorrection = draft._computed && draft._computed.correctionDose > 0;
    const hasEatingOutDose = draft.eatingOutOn && draft._computed && draft._computed.mealDose > 0;
    if (totalCarbs() <= 0 && !hasCorrection && !hasEatingOutDose) return;
    logMeal(totalCarbs() > 0 || hasEatingOutDose ? autoMealType(new Date()) : "correction");
  });

  // ---- Bottom-sheet helpers: lock background scroll on mobile while a sheet is open ----
  let openSheetCount = 0;
  // On iPhone the on-screen keyboard does NOT shrink the page: the layout stays full-height and the keyboard just
  // sits on top of its bottom edge. A sheet anchored to the bottom of the page therefore ends up underneath it,
  // with the field being typed into half hidden. The "visual viewport" is the part you can actually see, so while
  // any sheet is open its position and height are mirrored into CSS variables (--vv-top / --vv-height) that the
  // sheet's backdrop uses to sit exactly in the visible area, above the keyboard; `kb-open` is set while the
  // keyboard is up so the sheet can drop its non-essential parts. The field being typed into is scrolled into view.
  let stopTrackingViewport = null;
  function trackVisualViewport() {
    const vv = window.visualViewport;
    if (!vv) return null;                                   // an older browser: sheets just behave as they always did
    const root = document.documentElement;
    const clear = () => { root.style.removeProperty("--vv-top"); root.style.removeProperty("--vv-height"); root.classList.remove("kb-open"); };
    const sync = () => {
      if (vv.scale > 1.01) { clear(); return; }             // pinch-zoomed: the visible area says nothing about a keyboard
      root.style.setProperty("--vv-top", vv.offsetTop + "px");
      root.style.setProperty("--vv-height", vv.height + "px");
      root.classList.toggle("kb-open", window.innerHeight - vv.height > 120);
    };
    const onFocusIn = e => {
      const t = e.target;
      if (!t || !t.closest || !t.closest(".sheet") || !/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      // After the keyboard has finished sliding up, centre the field in the SHEET. scrollIntoView would also be
      // free to scroll the page behind it, which is exactly what must not move.
      const sheet = t.closest(".sheet");
      setTimeout(() => {
        const sr = sheet.getBoundingClientRect(), tr = t.getBoundingClientRect();
        const delta = (tr.top + tr.height / 2) - (sr.top + sr.height / 2);
        try { sheet.scrollBy({ top: delta, behavior: "smooth" }); } catch { sheet.scrollTop += delta; }
      }, 350);
    };
    vv.addEventListener("resize", sync); vv.addEventListener("scroll", sync);
    document.addEventListener("focusin", onFocusIn);
    sync();
    return () => { vv.removeEventListener("resize", sync); vv.removeEventListener("scroll", sync); document.removeEventListener("focusin", onFocusIn); clear(); };
  }
  // While a sheet is open the page behind must not move. `overflow: hidden` on the body alone isn't enough on iPhone
  // Safari (the page can still be dragged, and the keyboard can nudge it), so the body is instead pinned in place with
  // position: fixed -- shifted up by however far the page was scrolled so nothing visibly jumps -- and the scroll
  // position is put back exactly on close. Touches on the dimmed area outside the sheet are swallowed.
  let lockedScrollY = 0, pagePinned = false;
  function openSheet(backdrop) {
    document.body.appendChild(backdrop);
    openSheetCount++;
    if (openSheetCount === 1) {
      lockedScrollY = window.scrollY || document.documentElement.scrollTop || 0;
      document.body.style.top = `-${lockedScrollY}px`;
      document.body.classList.add("sheet-open");
      pagePinned = true;
      if (!stopTrackingViewport) stopTrackingViewport = trackVisualViewport();
    }
    guardSheetTouch(backdrop, ".sheet");
  }
  // Stops the page behind from moving or rubber-banding while a sheet is open. Touches outside the sheet are swallowed;
  // inside it, a drag is only allowed to scroll the sheet when the sheet has somewhere to scroll. A short sheet (like
  // Log basal) has nothing to scroll, and without this iPhone Safari bounced the whole page and let the background
  // drift behind it; at the very top or bottom of a long sheet the same overscroll is cancelled rather than chained.
  function guardSheetTouch(backdrop, sheetSelector) {
    let startY = 0;
    backdrop.addEventListener("touchstart", e => { startY = e.touches[0].clientY; }, { passive: true });
    backdrop.addEventListener("touchmove", e => {
      const sheet = e.target.closest(sheetSelector);
      if (!sheet) { e.preventDefault(); return; }
      if (e.target.closest('input[type="range"]')) return;
      // the nearest scrollable ancestor of the touch (inside the sheet) decides
      let node = e.target, scroller = null;
      while (node && node !== backdrop) {
        if (node.nodeType === 1 && node.scrollHeight > node.clientHeight + 1) {
          const oy = getComputedStyle(node).overflowY;
          if (oy === "auto" || oy === "scroll") { scroller = node; break; }
        }
        node = node.parentNode;
      }
      if (!scroller) { e.preventDefault(); return; }
      const dy = e.touches[0].clientY - startY;
      const atTop = scroller.scrollTop <= 0, atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1;
      if ((atTop && dy > 0) || (atBottom && dy < 0)) e.preventDefault();
    }, { passive: false });
  }
  function closeSheet(backdrop) {
    if (!backdrop.isConnected) return;                      // already closed: don't count it twice
    backdrop.remove();
    openSheetCount = Math.max(0, openSheetCount - 1);
    if (openSheetCount === 0) {
      document.body.classList.remove("sheet-open");
      document.body.style.top = "";
      // Only put the page back if we were the ones who pinned it. Restoring a scroll position that was never
      // saved would fling the page to wherever it happened to be last time (usually the very top).
      if (pagePinned) { window.scrollTo(0, lockedScrollY); pagePinned = false; }
      if (stopTrackingViewport) { stopTrackingViewport(); stopTrackingViewport = null; }
    }
  }

  // Snapshot / restore of the half-built meal, so "log" and "replace" can be undone without losing what was typed.
  function snapshotDraft() { saveDraftLocal(); try { return store.getItem(DRAFT_KEY); } catch (e) { return null; } }
  function draftIsEmpty() { return !draft.items.length && !draft.correctionOn && !draft.eatingOutOn && !draft.noInsulinOn; }
  function restoreDraftSnapshot(raw) {
    if (!raw || !draftIsEmpty()) return false;   // never mix a snapshot into something new the person has started since
    try { store.setItem(DRAFT_KEY, raw); } catch (e) { return false; }
    restoreDraftIfAny();
    showView("calculator");
    return true;
  }

  function logMeal(mealType) {
    recompute();   // never log from a stale calculation: work the dose out again from what is on screen right now
    const doseProblem = checkDoseConsistency({ ...draft._computed, shownText: doseNumber.textContent, noInsulin: draft.noInsulinOn });
    if (doseProblem) {
      diag.log("error", "dose", `Refused to log: ${doseProblem}`);
      dialogs.alert(`Nothing was logged. ${doseProblem} Please check the numbers and try again.`, { title: "Dose check failed" });
      return;
    }
    const ratioEntry = draft._computed.ratioEntry;
    const now = new Date();
    const periodEntry = currentTimeRatio(now);
    // Never save a glucose reading for a manual correction, even if one is still sitting in the
    // (now hidden) field from before switching modes -- it wasn't what the logged dose came from.
    const glucoseRaw = (draft.correctionOn && !draft.correctionManual) ? parseFloat(glucoseInput.value) : NaN;
    const glucoseVal = !isNaN(glucoseRaw) ? round1(convertGlucose(glucoseRaw, draft.glucoseUnit || state.settings.units, state.settings.units)) : null;
    const entry = buildMealEntry({
      now, mealType, periodEntry, ratioEntry, items: draft.items, eatingOut: draft.eatingOutOn, noInsulin: draft.noInsulinOn,
      computed: draft._computed, glucoseVal
    });
    state.history.unshift(entry);
    if (!draft.eatingOutOn) adjustUsage(state.library, state.recipes, draft.items, +1);
    saveState();
    syncEntryToNightscout(entry);
    setReminderFor(entry);
    const draftBefore = snapshotDraft();
    const usedItems = draft.eatingOutOn ? [] : draft.items.map(i => ({ refType: i.refType, refId: i.refId }));
    resetDraft();
    renderActivePanel();
    renderRecentMeals();
    const units = Math.round(((entry.mealDose || 0) + (entry.correctionDose || 0)) * 100) / 100;
    showUndoToast(entry.noInsulin || units <= 0 ? "Logged" : `Logged ${units} u`, () => {
      const i = state.history.findIndex(h => h.id === entry.id);
      if (i < 0) return;
      state.history.splice(i, 1);
      adjustUsage(state.library, state.recipes, usedItems, -1);
      saveState();
      queueNsDelete(entry);
      try { const r = readReminder(); if (r && r.mealTs === entry.ts) { store.removeItem(REMINDER_KEY); platform.notifications.cancel(`reminder-${r.mealTs}`); renderReminder(); } } catch (e) { /* no reminder to clear */ }
      renderHistory(); renderActivePanel(); renderRecentMeals();
      restoreDraftSnapshot(draftBefore);
    });
  }


  // ================= Features built on your own history (2.17) =================
  const cachedReadings = () => { let best = []; for (const v of glucoseReadingsCache.values()) if (v.readings.length > best.length) best = v.readings; return best; };
  const fmtGluShort = v => (v == null || !Number.isFinite(v) ? "—" : state.settings.units === "mmol" ? String(round1(convertGlucose(v, "mgdl", "mmol"))) : String(Math.round(v)));
  const gluUnitShort = () => (state.settings.units === "mmol" ? "mmol/L" : "mg/dL");
  let batchWeightG = null; // cooked weight of THIS batch, for a recipe being added (null = use the recipe's saved weight)

  // ----- Portions of a recipe (1/8, 2 slices) -----
  // The dish's weight is this batch's weight when one is entered, else the recipe's saved cooked weight.
  function portionContext(item) {
    if (!item || item.refType !== "recipe") return { dishWeight: null, slices: null };
    return { dishWeight: batchWeightG > 0 ? batchWeightG : item.dishWeight, slices: item.slices };
  }
  function portionMessage(text, isError = true) {
    const box = el("cc-portion"), note = el("cc-portion-note");
    note.textContent = text || "";
    note.classList.toggle("is-error", !!text && isError);
    box.hidden = !text && !box.querySelector(".portion__chip");
  }
  // Under the Grams box: for a recipe, one-tap portions and what the typed amount works out to.
  function renderPortion() {
    const box = el("cc-portion"), chips = el("cc-portion-chips");
    const item = selectedPickId ? pickableItems().find(i => i.id === selectedPickId) : null;
    if (!item || item.refType !== "recipe") { chips.innerHTML = ""; portionMessage(""); box.hidden = true; return; }
    const ctx = portionContext(item);
    const typed = gramsInput.value.trim();
    const slice = item.slices ? [1, 2].filter(n => n <= item.slices).map(n => ({ text: slicesLabel(n), title: `${slicesLabel(n)} of ${item.slices}` })) : [];
    const options = [...FRACTION_CHIPS.map(([n, d]) => ({ text: fractionLabel(n, d), title: `${fractionLabel(n, d)} of the dish` })), ...slice];
    chips.innerHTML = options.map(o => `<button type="button" class="portion__chip${o.text === typed ? " is-active" : ""}" data-portion="${escapeAttr(o.text)}" title="${escapeAttr(o.title)}" aria-pressed="${o.text === typed}">${escapeHtml(o.text)}</button>`).join("");
    box.hidden = false;
    const p = parsePortion(typed, ctx);
    if (p.empty) { portionMessage(`Grams, or a portion of the whole dish (${Math.round(ctx.dishWeight)} g)${item.slices ? `, ${item.slices} slices` : ""}.`, false); return; }
    if (!p.ok) { portionMessage(p.error); return; }
    const carbs = Math.round(item.carbsPer100g * (ctx.dishWeight === item.dishWeight ? 1 : item.dishWeight / ctx.dishWeight) * p.grams) / 100;
    portionMessage(p.kind === "grams" ? `${p.grams} g · ${round1(carbs)} g carbs` : `${p.label} of the dish (${Math.round(ctx.dishWeight)} g) = ${p.grams} g · ${round1(carbs)} g carbs`, false);
  }
  el("cc-portion-chips").addEventListener("click", e => {
    const b = e.target.closest("[data-portion]");
    if (!b) return;
    gramsInput.value = b.dataset.portion;
    renderPortion();
  });
  gramsInput.addEventListener("input", () => { if (selectedPickId) renderPortion(); else portionMessage(""); });

  // Under the food list: for the food you just picked, the last few times you had it, and (for a recipe) a batch weight.
  function renderPickExtra() {
    const box = el("cc-pick-extra");
    if (!box) return;
    const item = selectedPickId ? pickableItems().find(i => i.id === selectedPickId) : null;
    if (!item) { box.hidden = true; box.innerHTML = ""; return; }
    let html = "";
    if (item.refType === "recipe") {
      const r = state.recipes.find(x => x.id === item.refId), t = r ? recipeTotals(r) : null;
      if (r && t) {
        const per = batchWeightG > 0 ? Math.round((t.totalCarbs / batchWeightG) * 1000) / 10 : t.carbsPer100g;
        html += `<div class="pick-extra__batch"><label for="cc-batch-weight">This batch's cooked weight</label>
          <div class="field__row"><input type="text" id="cc-batch-weight" inputmode="decimal" autocomplete="off" placeholder="${r.finalWeight}" value="${batchWeightG || ""}"><span class="field__unit">g</span></div>
          <p class="pick-extra__note">${t.totalCarbs} g carbs in the whole batch → <b>${per} g per 100 g</b>${batchWeightG > 0 ? ` (recipe default ${t.carbsPer100g})` : ""}. Leave empty to use the saved weight of ${r.finalWeight} g.</p></div>`;
      }
    }
    const last = lastTimesFor(state.history, cachedReadings(), { refId: item.refId, name: item.name }, 3);
    if (last.length) {
      const when = ts => new Date(ts).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
      const amount = l => (l.quantity != null && l.unitLabel ? `${formatQty(l.quantity)} ${l.unitLabel}${l.quantity === 1 ? "" : "s"}` : l.grams != null ? `${l.portion ? escapeHtml(l.portion) + " · " : ""}${Math.round(l.grams)} g` : "");
      html += `<div class="pick-extra__last"><div class="pick-extra__title">Last time you had this</div>` + last.map(l => `<div class="pick-extra__row"><span>${when(l.ts)} · ${amount(l)}${l.alone ? "" : " (with other foods)"}</span><span>${l.noInsulin ? "no insulin" : round1(l.dose) + " u"}${l.after3h != null ? ` · 3 h later ${fmtGluShort(l.after3h)}` : ""}</span></div>`).join("") + `</div>`;
    }
    box.innerHTML = html;
    box.hidden = !html;
  }
  document.addEventListener("input", e => {
    if (!e.target || e.target.id !== "cc-batch-weight") return;
    const v = parseDecimalInput(e.target.value);
    batchWeightG = v > 0 ? v : null;
    renderPortion();
    const note = el("cc-pick-extra").querySelector(".pick-extra__note");
    const item = pickableItems().find(i => i.id === selectedPickId), r = item && state.recipes.find(x => x.id === item.refId);
    if (note && r) { const t = recipeTotals(r); const per = batchWeightG ? Math.round((t.totalCarbs / batchWeightG) * 1000) / 10 : t.carbsPer100g; note.innerHTML = `${t.totalCarbs} g carbs in the whole batch → <b>${per} g per 100 g</b>${batchWeightG ? ` (recipe default ${t.carbsPer100g})` : ""}. Leave empty to use the saved weight of ${r.finalWeight} g.`; }
  });

  // Treating a low: your own usual amount, from your own past low treatments.
  function renderQuickUsual() {
    const note = el("quick-carb-usual");
    if (!note) return;
    const u = lowTreatmentUsual(state.history);
    if (!u.n || u.medianCarbs == null) { note.hidden = true; return; }
    note.textContent = `Your usual: about ${round1(u.medianCarbs)} g (the middle of your last ${u.n} low treatment${u.n === 1 ? "" : "s"}, ${round1(u.minCarbs)}–${round1(u.maxCarbs)} g). Follow your own care plan.`;
    note.hidden = false;
  }
  function renderLowHint() {
    const hint = el("cc-low-hint");
    if (!hint) return;
    const fresh = liveGlucose && typeof liveGlucose.mgdl === "number" && Date.now() - liveGlucose.at <= LIVE_GLUCOSE_STALE_MS;
    if (!nightscoutConfigured() || !fresh || liveGlucose.mgdl >= 70) { hint.hidden = true; return; }
    const u = lowTreatmentUsual(state.history);
    hint.innerHTML = `<b>Low (${fmtGluShort(liveGlucose.mgdl)} ${gluUnitShort()}).</b> ${u.n ? `You usually treat with about ${round1(u.medianCarbs)} g of fast carbs — tap “Treating a low” for quick add.` : "Tap “Treating a low” to log fast carbs."}`;
    hint.hidden = false;
  }

  // After-meal glucose check: a note on the calculator, plus a calendar event (with an alert) you can add in one tap.
  const REMINDER_KEY = "insulinBuddy.checkReminder";
  const readReminder = () => { try { return JSON.parse(store.getItem(REMINDER_KEY)); } catch { return null; } };
  function setReminderFor(entry) {
    const hrs = Number(state.settings.checkAfterHours) || 0;
    if (!hrs || entry.noInsulin || (Number(entry.mealDose) || 0) + (Number(entry.correctionDose) || 0) <= 0) return;
    try { store.setItem(REMINDER_KEY, JSON.stringify({ due: entry.ts + hrs * 3600000, mealTs: entry.ts, hours: hrs, label: entry.mealType || "meal" })); } catch { /* no storage: no reminder */ }
    // Where the platform can fire a notification with the app closed (a native build), schedule one; on the web this is a no-op and the calendar file is the route.
    try { platform.notifications.schedule({ id: `reminder-${entry.ts}`, at: entry.ts + hrs * 3600000, title: "Check your glucose", body: `${hrs} h after your ${entry.mealType || "meal"}` }); } catch { /* never blocks logging */ }
    renderReminder();
  }
  function renderReminder() {
    const box = el("cc-reminder");
    if (!box) return;
    const r = readReminder();
    if (!r || !(Number(state.settings.checkAfterHours) > 0) || Date.now() > r.due + 6 * 3600000) { box.hidden = true; if (r && Date.now() > r.due + 6 * 3600000) { try { store.removeItem(REMINDER_KEY); } catch { /* */ } } return; }
    const due = new Date(r.due), time = due.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const mins = Math.round((r.due - Date.now()) / 60000);
    const isDue = mins <= 0;
    box.className = "reminder-card" + (isDue ? " reminder-card--due" : "");
    box.innerHTML = `<div class="reminder-card__text"><b>${isDue ? "Time to check your glucose" : "Check your glucose at " + time}</b><span>${isDue ? `${r.hours} h since your ${escapeHtml(r.label)}.` : `in ${mins >= 60 ? Math.floor(mins / 60) + " h " + (mins % 60) + " min" : mins + " min"} — ${r.hours} h after your ${escapeHtml(r.label)}.`}</span></div>
      <div class="reminder-card__btns">${isDue ? "" : `<button type="button" class="reminder-btn" id="reminder-ics">Add to calendar</button>`}<button type="button" class="reminder-btn" id="reminder-done">${isDue ? "Done" : "Dismiss"}</button></div>`;
    box.hidden = false;
  }
  function reminderIcs(r) {
    const z = d => new Date(d).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Insulin Buddy//EN", "BEGIN:VEVENT", `UID:ib-${r.mealTs}@insulinbuddy`, `DTSTAMP:${z(Date.now())}`, `DTSTART:${z(r.due)}`, `DTEND:${z(r.due + 15 * 60000)}`,
      "SUMMARY:Check glucose (Insulin Buddy)", `DESCRIPTION:${r.hours} h after your ${r.label}.`, "BEGIN:VALARM", "TRIGGER:PT0S", "ACTION:DISPLAY", "DESCRIPTION:Check glucose", "END:VALARM", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
  }
  document.addEventListener("click", e => {
    if (e.target.closest && e.target.closest("#reminder-done")) { const r0 = readReminder(); try { store.removeItem(REMINDER_KEY); } catch { /* */ } if (r0) platform.notifications.cancel(`reminder-${r0.mealTs}`); renderReminder(); return; }
    if (e.target.closest && e.target.closest("#reminder-ics")) { const r = readReminder(); if (r) downloadText("check-glucose.ics", reminderIcs(r), "text/calendar"); }
  });
  setInterval(() => { if (!document.hidden) renderReminder(); }, 30000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) renderReminder(); });

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
  // ---- our own glucose history, backed by Supabase when signed in ----
  // Persist whatever Nightscout hands back, so graphs and future stats read from data we
  // control instead of re-fetching (and re-trusting) Nightscout every single time.
  async function saveGlucoseReadings(entries) {
    if (!supabaseClient || !currentUser) return { ok: true, saved: 0 }; // this table only exists for signed-in accounts
    const rows = entriesToGlucoseRows(entries, currentUser.id);
    if (rows.length === 0) return { ok: true, saved: 0 };
    try {
      const { error } = await supabaseClient.from("glucose_readings").upsert(rows, { onConflict: "user_id,at" });
      if (error) { diag.log("warn", "glucose-db", "Couldn't save glucose readings: " + (error.message || error)); return { ok: false, saved: 0, error: error.message || String(error) }; }
      glucoseReadingsCache.clear(); // new data invalidates every cached window
      return { ok: true, saved: rows.length };
    } catch (e) {
      const msg = (e && e.message) || String(e);
      diag.log("warn", "glucose-db", "Couldn't save glucose readings: " + msg);
      return { ok: false, saved: 0, error: msg };
    }
  }
  async function getLatestStoredGlucoseAt() {
    try {
      const { data, error } = await supabaseClient.from("glucose_readings").select("at").eq("user_id", currentUser.id).order("at", { ascending: false }).limit(1).maybeSingle();
      return error || !data ? null : data.at;
    } catch (e) { return null; }
  }
  async function getOldestStoredGlucoseAt() {
    try {
      const { data, error } = await supabaseClient.from("glucose_readings").select("at").eq("user_id", currentUser.id).order("at", { ascending: true }).limit(1).maybeSingle();
      return error || !data ? null : data.at;
    } catch (e) { return null; }
  }

  /** Pages backward through Nightscout history from `before`, saving as it goes, until either
   * `cutoffMs` is reached, history is exhausted, or the safety cap kicks in. Shared by the
   * backfill button (always runs) and ensureGlucoseCoverage (only runs when actually needed). */
  async function pageBackwardImporting(cfg, cutoffMs) {
    let before = Date.now() + 60_000;
    let fetched = 0, saved = 0, saveFailures = 0, lastSaveError = null;
    for (let i = 0; i < 200; i++) { // safety cap -- 200 batches of 1000 is 200k readings, far beyond any realistic need
      let r;
      try { r = await nsClient.read(cfg, 1000, { before }); }
      catch (e) { return { fetched, saved, reason: friendlyNsError(e) }; }
      if (!r.entries.length) break; // Nightscout has nothing older than `before` -- history exhausted
      fetched += r.entries.length;
      const result = await saveGlucoseReadings(r.entries);
      if (result.ok) saved += result.saved;
      else {
        saveFailures++;
        lastSaveError = result.error;
        // A couple of failures could be transient; a run of them means something is
        // fundamentally broken (the table doesn't exist, a bad RLS policy, etc.) -- stop
        // rather than "successfully" fetching thousands more readings we can't actually store.
        if (saveFailures >= 3) return { fetched, saved, reason: `Couldn't save to the database: ${lastSaveError}` };
      }
      const dates = r.entries.map(e => e.date).filter(d => typeof d === "number");
      const oldest = dates.length ? Math.min(...dates) : null;
      if (oldest == null || oldest >= before) break; // no progress -- stop rather than loop forever
      before = oldest;
      if (before <= cutoffMs || r.entries.length < 1000) break;
    }
    return { fetched, saved, reason: saveFailures > 0 ? `${saveFailures} batch(es) failed to save: ${lastSaveError}` : undefined };
  }

  /** Makes sure our database has at least `hours` worth of recent history for this account,
   * doing as little work as possible: a cheap "catch up since our latest point" when we
   * already have enough depth, or a full paginated pull when we don't (e.g. right after
   * signing in, before any backfill). Silent/best-effort -- callers read the DB afterward
   * regardless of whether this fully succeeded. */
  async function ensureGlucoseCoverage(hours) {
    if (!supabaseClient || !currentUser || !nightscoutConfigured()) return;
    const cfg = nsCfg();
    const sinceMs = Date.now() - hours * 3600_000;
    try {
      const [latestAt, oldestAt] = await Promise.all([getLatestStoredGlucoseAt(), getOldestStoredGlucoseAt()]);
      if (oldestAt && new Date(oldestAt).getTime() <= sinceMs) {
        // Already covered -- just catch up anything newer than our latest stored point.
        const r = latestAt
          ? await nsClient.read(cfg, 1000, { after: new Date(latestAt).getTime() + 1000 })
          : await nsClient.read(cfg, Math.min(hours * 12, 1000));
        if (r.entries.length) await saveGlucoseReadings(r.entries);
        return;
      }
    } catch (e) { /* fall through to a full paginated pull below */ }
    await pageBackwardImporting(cfg, sinceMs);
  }

  /** hours: how far back the caller wants to show. When signed in, this reads from our own
   * database (fast, robust, works even if Nightscout is briefly down) after ensuring that
   * database actually covers the requested window. In local-only mode (no cloud sign-in --
   * there's nowhere to store a history) it falls back to asking Nightscout directly, same as
   * before this existed. */
  /** Always fetches this window fresh, directly from Nightscout, rather than asking "do we
   * already have enough stored?" -- that coverage question is exactly what could let a stale,
   * sparse database win over what Nightscout actually has right now. This viewer only ever
   * shows up to 24 hours, which Nightscout returns in a single request anyway, so there's no
   * real pagination/speed reason to prefer the database here the way the much bigger History
   * tab needs to. Still saves what it gets (fire-and-forget) so the database that DOES benefit
   * from density -- the History tab -- keeps accumulating real readings over time. */
  async function fetchGlucoseHistory(hours) {
    if (!nightscoutConfigured()) return { ok: false, reason: "Nightscout isn't set up yet." };
    if (hours <= 24) {
      // Up to a day comes from the shared store: instant when it is fresh, one quiet refresh when it isn't, and the saved readings
      // (flagged stale) when Nightscout can't be reached.
      const r = await refreshGlucoseStore({ maxAgeMs: 45000 });
      const entries = glucoseEntriesWithin(hours);
      if (!r.ok && !entries.length) return { ok: false, reason: r.reason };
      return { ok: true, entries, stale: !r.ok, reason: r.reason };
    }
    try {
      const r = await nsClient.read(nsCfg(), Math.min(hours * 12 + 12, 1000)); // +12 is a small safety margin, not load-bearing -- 24h at a 5-min interval is ~288, nowhere near Nightscout's own 1000 cap
      if (r.entries.length) saveGlucoseReadings(r.entries);
      return { ok: true, entries: r.entries };
    } catch (e) { return { ok: false, reason: friendlyNsError(e) }; }
  }

  /** Explicit, always-runs pull of as much history as Nightscout will give (the Settings
   * button) -- as opposed to ensureGlucoseCoverage, which skips the work when we already
   * have enough. Reports how much it actually imported. */
  async function backfillGlucoseHistory(days = 90) {
    if (!supabaseClient || !currentUser) return { ok: false, reason: "Sign in to Cloud Sync first." };
    if (!nightscoutConfigured()) return { ok: false, reason: "Set up Nightscout first." };
    const { fetched, saved, reason } = await pageBackwardImporting(nsCfg(), Date.now() - days * 86400_000);
    if (reason) return { ok: saved > 0, imported: saved, fetched, reason };
    return { ok: true, imported: saved, fetched };
  }

  /** Readings for the History > Glucose tab: ensures coverage, then reads the window straight
   * from our database as { at (ms), mgdl } pairs -- the shape js/glucose-stats.js expects. */
  // In-memory only (never persisted): avoids re-fetching + re-paginating the same window
  // repeatedly when switching between tabs/views/band presets within one visit. Cleared
  // whenever a fresh reading is saved, so it can never show stale data as if it were current.
  const glucoseReadingsCache = new Map(); // days -> { readings, at }
  const GLUCOSE_CACHE_TTL_MS = 60_000;

  async function fetchStoredGlucoseReadings(days) {
    if (!supabaseClient || !currentUser) return { ok: false, signIn: true, reason: "Sign in to Cloud Sync to build up glucose history." };
    if (!nightscoutConfigured()) return { ok: false, reason: "Set up Nightscout Sync first." };
    const cached = glucoseReadingsCache.get(days);
    if (cached && Date.now() - cached.at < GLUCOSE_CACHE_TTL_MS) return { ok: true, readings: cached.readings };
    await ensureGlucoseCoverage(days * 24);
    try {
      const sinceISO = new Date(Date.now() - days * 86400_000).toISOString();
      // A Supabase project enforces its own server-side max-rows cap (Project Settings > API >
      // "Max Rows", 1000 by default) that a client .limit() can request FEWER rows than but
      // never override -- a single large .limit() silently gets clamped back down. The only
      // way to actually get more than that cap is genuine pagination: fetch bounded pages with
      // .range(). 90 days at a 5-minute CGM interval is ~26,000 readings, so a large window
      // can mean dozens of pages -- fetch them all CONCURRENTLY (we know the page boundaries
      // upfront from the count) rather than one at a time, which is the main thing that made
      // opening a 30/90-day view feel slow.
      // The cap is only a runaway guard. It used to be 30,000, which silently cut a 90-day window short for anyone whose
      // sensor/app records a reading every 2-3 minutes (about 50,000 readings in 90 days): the oldest 30,000 were kept
      // and the newest ones dropped, so "90 days" showed roughly 51.
      const PAGE = 1000, HARD_CAP = 400000, PARALLEL = 8;
      const { count, error: countErr } = await supabaseClient.from("glucose_readings").select("at", { count: "exact", head: true }).eq("user_id", currentUser.id).gte("at", sinceISO);
      if (countErr) throw countErr;
      const total = Math.min(count || 0, HARD_CAP);
      const pageCount = Math.max(1, Math.ceil(total / PAGE)) || 1;
      // Pages are fetched a few at a time (all at once is dozens of simultaneous requests for a long window).
      const fetchPage = i => supabaseClient.from("glucose_readings").select("at, mgdl").eq("user_id", currentUser.id).gte("at", sinceISO).order("at").range(i * PAGE, i * PAGE + PAGE - 1);
      const pages = [];
      const pageTotal = total === 0 ? 0 : pageCount;
      for (let start = 0; start < pageTotal; start += PARALLEL) {
        pages.push(...await Promise.all(Array.from({ length: Math.min(PARALLEL, pageTotal - start) }, (_, k) => fetchPage(start + k))));
      }
      const firstError = pages.find(p => p.error);
      if (firstError) throw firstError.error;
      const readings = pages.flatMap(p => p.data || []).map(row => ({ at: new Date(row.at).getTime(), mgdl: row.mgdl }));
      // Don't cache an empty result: it's most often a transient state (a write just failed, or
      // coverage hasn't caught up yet) rather than a durable "there's truly nothing here" fact,
      // and caching it would block the self-healing retry-on-reopen behavior from ever helping.
      if (readings.length > 0) glucoseReadingsCache.set(days, { readings, at: Date.now() });
      return { ok: true, readings };
    } catch (e) { return { ok: false, reason: "Couldn't load your glucose history." }; }
  }

  // ---- live glucose pill on the dose card ----
  const LIVE_GLUCOSE_CACHE_KEY = "insulinBuddy.liveGlucose";
  const LIVE_GLUCOSE_STALE_MS = 15 * 60 * 1000;
  let liveGlucose = null; // { mgdl, direction, at } -- cached across reloads so the pill isn't blank while the first fetch is in flight
  try { liveGlucose = JSON.parse(store.getItem(LIVE_GLUCOSE_CACHE_KEY)); } catch (e) { liveGlucose = null; }

  // ---- the shared glucose store ----
  // ONE place every screen reads recent glucose from (the last 24 hours of Nightscout readings), kept on the device so it is there the
  // instant a screen opens, topped up quietly in the background with only the newest readings. Screens paint from it straight away and
  // redraw only if a refresh actually brought something new. If Nightscout can't be reached the saved readings stay on show.
  const GLUCOSE_STORE_KEY = "insulinBuddy.glucoseRecent2";
  const GLUCOSE_STORE_SPAN_MS = 26 * 3600_000;
  const GLUCOSE_FULL_REFRESH_MS = 20 * 60_000;   // every so often re-read the whole day, to catch gaps and edited readings
  const glucoseStore = { entries: [], at: 0, fullAt: 0, inflight: null, listeners: new Set() };   // entries newest-first: { sgv, date, direction }
  try {
    const saved = JSON.parse(store.getItem(GLUCOSE_STORE_KEY) || "null");
    if (saved && Array.isArray(saved.entries)) { glucoseStore.entries = saved.entries.filter(e => e && typeof e.sgv === "number" && Number.isFinite(e.date)); glucoseStore.at = saved.at || 0; glucoseStore.fullAt = saved.fullAt || 0; }
  } catch (e) { /* no saved readings -- the first refresh fills it */ }
  function glucoseEntriesWithin(hours) {
    const from = Date.now() - hours * 3600_000;
    return glucoseStore.entries.filter(e => e.date >= from);
  }
  function persistGlucoseStore() {
    try { store.setItem(GLUCOSE_STORE_KEY, JSON.stringify({ entries: glucoseStore.entries, at: glucoseStore.at, fullAt: glucoseStore.fullAt })); } catch (e) { /* storage full or blocked: still works in memory */ }
  }
  function resetGlucoseStore() {
    glucoseStore.entries = []; glucoseStore.at = 0; glucoseStore.fullAt = 0;
    try { store.removeItem(GLUCOSE_STORE_KEY); } catch (e) { /* nothing to do */ }
  }
  function onGlucoseUpdate(fn) { glucoseStore.listeners.add(fn); return () => glucoseStore.listeners.delete(fn); }
  /** Tops the store up. Returns { ok, changed, reason }. Calls made while one is already running share its result. */
  function refreshGlucoseStore({ force = false, maxAgeMs = 20000 } = {}) {
    if (!nightscoutConfigured()) return Promise.resolve({ ok: false, changed: false, reason: "Nightscout isn't set up yet." });
    if (glucoseStore.inflight) return glucoseStore.inflight;
    if (!force && glucoseStore.entries.length && Date.now() - glucoseStore.at < maxAgeMs) return Promise.resolve({ ok: true, changed: false });
    glucoseStore.inflight = (async () => {
      try {
        const latest = glucoseStore.entries[0];
        const full = !latest || Date.now() - glucoseStore.fullAt > GLUCOSE_FULL_REFRESH_MS || Date.now() - latest.date > 6 * 3600_000;
        // A full read must reach back the whole span. Some sensors report every minute or two, and one request holds at most 1000
        // readings (about 17 hours at one a minute), so keep paging backwards until the span is covered (up to 4 pages).
        let got = [];
        if (full) {
          const since = Date.now() - GLUCOSE_STORE_SPAN_MS;
          let before;
          for (let page = 0; page < 4; page++) {
            const rr = await nsClient.read(nsCfg(), 1000, before ? { before } : {});
            const batch = (Array.isArray(rr.entries) ? rr.entries : []).filter(e => e && Number.isFinite(e.date));
            got = got.concat(batch);
            if (batch.length < 1000) break;
            const oldest = Math.min(...batch.map(e => e.date));
            if (oldest <= since) break;
            before = oldest;
          }
        } else got = (await nsClient.read(nsCfg(), 1000, { after: latest.date + 1 })).entries || [];
        const incoming = (Array.isArray(got) ? got : []).filter(e => e && typeof e.sgv === "number" && Number.isFinite(e.date));
        const before = glucoseStore.entries.length ? `${glucoseStore.entries[0].date}:${glucoseStore.entries.length}` : "";
        const byDate = new Map(glucoseStore.entries.map(e => [e.date, e]));
        for (const e of incoming) byDate.set(e.date, { sgv: e.sgv, date: e.date, direction: e.direction || null });
        const from = Date.now() - GLUCOSE_STORE_SPAN_MS;
        glucoseStore.entries = [...byDate.values()].filter(e => e.date >= from).sort((a, b) => b.date - a.date);
        glucoseStore.at = Date.now();
        if (full) glucoseStore.fullAt = glucoseStore.at;
        const top = glucoseStore.entries[0];
        if (top) {
          liveGlucose = { mgdl: top.sgv, direction: top.direction || null, at: top.date };
          try { store.setItem(LIVE_GLUCOSE_CACHE_KEY, JSON.stringify(liveGlucose)); } catch (e) { /* ignore */ }
        }
        if (incoming.length) saveGlucoseReadings(incoming); // fire-and-forget: the database that History reads keeps accumulating
        persistGlucoseStore();
        const changed = before !== (glucoseStore.entries.length ? `${glucoseStore.entries[0].date}:${glucoseStore.entries.length}` : "");
        if (changed) for (const fn of [...glucoseStore.listeners]) { try { fn(); } catch (e) { /* a listener must never break the refresh */ } }
        return { ok: true, changed };
      } catch (e) {
        return { ok: false, changed: false, reason: friendlyNsError(e) };   // keep showing what we have
      } finally { glucoseStore.inflight = null; }
    })();
    return glucoseStore.inflight;
  }

  async function refreshLiveGlucose(force = false) {
    if (!nightscoutConfigured()) return;
    await refreshGlucoseStore({ force, maxAgeMs: 55000 });   // a sensor reports every 1 to 5 minutes, so asking more often than once a minute only wakes the radio   // a failed background poll just leaves the last known reading showing
    renderLiveGlucosePill();
  }

  function renderLiveGlucosePill() {
    const pill = el("cc-live-glucose");
    if (!pill) return;
    renderLowHint();
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
      saveGlucoseReadings(r.entries);
    } catch (e) {
      statusEl.textContent = friendlyNsError(e);
      statusEl.classList.add("correction-row__fetch-status--error");
    }
  }

  // ---- delivery: everything goes through an outbox so it survives being offline ----
  // Each place a logged entry is sent to is one SyncTarget behind an Outbox (js/core/outbox.js). Today that is Nightscout only;
  // a second destination is one more item in this list, and the four functions below need no change.
  const entryTargets = [{
    name: "nightscout", outbox: nsOutbox,
    enabled: () => nightscoutConfigured(),
    followsEdits: () => state.settings.nsSyncEdits !== false,
    opts: () => ({ format: nsFormat(), units: state.settings.units }),
    statusOf: entry => entry.ns,
    flush: () => flushNightscoutQueue()
  }];
  function syncEntryToNightscout(entry) {
    for (const t of entryTargets) {
      if (!t.enabled()) continue;
      t.outbox.enqueueCreate(entry, t.opts());
      t.flush();
    }
  }
  // Edits/deletes only follow a meal that has actually been (or is about to be) sent.
  function queueNsUpdate(entry) {
    for (const t of entryTargets) {
      if (!t.enabled() || !t.followsEdits()) continue;
      if (!t.statusOf(entry) && !t.outbox.pendingFor(entry.id)) continue;
      t.outbox.enqueueUpdate(entry, t.opts());
      t.flush();
    }
  }
  function queueNsDelete(entry) {
    for (const t of entryTargets) {
      if (!t.enabled() || !t.followsEdits()) continue;
      const st = t.statusOf(entry);
      t.outbox.enqueueDelete(entry.id, st && st.ids);
      t.flush();
    }
  }
  // Undo of a delete: cancel the pending removal, or re-send if it already went out.
  function undoNsDelete(entry) {
    for (const t of entryTargets) {
      if (!t.enabled()) continue;
      if (t.outbox.cancelDelete(entry.id)) continue;
      const st = t.statusOf(entry);
      if (st && st.ids && Object.values(st.ids).some(Boolean)) { delete entry[t.outbox.target.statusKey]; t.outbox.enqueueCreate(entry, t.opts()); t.flush(); }
    }
  }
  // ---- the sync indicator: one small chip that always says whether what you did is saved and sent ----
  function currentSyncSummary() {
    const jobs = (nsOutbox && nsOutbox.jobs) || [];
    return summarizeSync({
      online: navigator.onLine !== false,
      cloud: { configured: !!supabaseClient, signedIn: !!currentUser, blocked: !!cloud.blocked, loadOk: cloudLoadStatus.ok, loadMessage: cloudLoadStatus.message, pending: cloudSyncPending, checkedAt: cloudLoadStatus.at },
      ns: { configured: nightscoutConfigured(), queued: jobs.length, lastError: nsOutbox ? nsOutbox.lastError() : null, oldestAt: jobs.length ? Math.min(...jobs.map(j => j.createdAt || Date.now())) : null, writeOk: nightscoutWriteStatus.ok, writeAt: nightscoutWriteStatus.at }
    });
  }
  function renderSyncChip() {
    try {
      const chip = el("sync-chip");
      if (!chip || !state) return;
      const sum = currentSyncSummary();
      chip.className = `sync-chip sync-chip--${sum.level}`;
      el("sync-chip-text").textContent = sum.short;
      chip.setAttribute("aria-label", `${sum.title}. Tap for details.`);
      chip.hidden = false;
      const body = document.getElementById("sync-sheet-body");
      if (body) body.innerHTML = syncSheetBodyHtml(sum);
      updateSettingsDot(sum);
    } catch (e) { /* not ready yet */ }
  }
  // A red dot on the Settings tab when sending is genuinely stuck (a real problem, or waiting a long time while online).
  let syncStuckNow = false;
  function updateSettingsDot(sum) {
    const jobs = (nsOutbox && nsOutbox.jobs) || [];
    const waiting = [...jobs.map(j => j.createdAt || Date.now()), ...(cloudSyncPending && currentUser && cloudPendingSince != null ? [cloudPendingSince] : [])];
    syncStuckNow = isSyncStuck({ level: sum.level, online: navigator.onLine !== false, oldestWaitingAt: waiting.length ? Math.min(...waiting) : null });
    document.querySelectorAll('.tab[data-target="settings"]').forEach(tab => {
      let dot = tab.querySelector(".tab__dot");
      if (!dot) { dot = document.createElement("span"); dot.className = "tab__dot"; dot.setAttribute("aria-hidden", "true"); tab.appendChild(dot); }
      dot.hidden = !syncStuckNow;
      tab.setAttribute("aria-label", syncStuckNow ? "Settings. Sync needs attention." : "Settings");
    });
  }
  setInterval(() => { try { if (state && !document.hidden) renderSyncChip(); } catch (e) { /* not ready */ } }, 60000);   // a long wait turns the dot on by itself
  function syncSheetBodyHtml(sum) {
    const dot = { ok: "ok", pending: "warn", problem: "error", off: "off" };
    return `<p class="panel-card__hint" style="margin-top:0;"><b>${escapeHtml(sum.title)}.</b></p>` +
      sum.rows.map(r => statusRow(escapeHtml(r.name), dot[r.level] || "off", escapeHtml(r.text))).join("") +
      (sum.level === "pending" || sum.level === "problem" ? `<button class="btn btn--primary" id="sync-retry" type="button" style="margin-top:12px; width:100%;">Try again now</button>` : "");
  }
  function openSyncSheet() {
    const backdrop = document.createElement("div");
    backdrop.className = "sheet-backdrop";
    backdrop.innerHTML = `
      <div class="sheet">
        <div class="sheet-head">
          <h2>Sync</h2>
          <button class="sheet-close" id="sync-close" type="button" aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
          </button>
        </div>
        <div id="sync-sheet-body">${syncSheetBodyHtml(currentSyncSummary())}</div>
        <p class="panel-card__hint" style="margin-top:12px;">Everything you log is saved on this device first, then sent on. More detail is in Settings &gt; Data &gt; Status.</p>
      </div>`;
    openSheet(backdrop);
    backdrop.addEventListener("click", async e => {
      if (e.target === backdrop || e.target.closest("#sync-close")) return closeSheet(backdrop);
      const retry = e.target.closest("#sync-retry");
      if (retry) {
        retry.disabled = true; retry.textContent = "Trying…";
        try { await attemptReconnectSync(); await flushNightscoutQueue(true); } catch (err) { /* the summary below says what is still wrong */ }
        renderSyncChip();
      }
    });
  }
  bind("sync-chip", "click", openSyncSheet);
  window.addEventListener("online", renderSyncChip);
  window.addEventListener("offline", renderSyncChip);

  // immediate = the user (or the network coming back) asked for a retry, so skip the back-off wait.
  async function flushNightscoutQueue(immediate) {
    const r = immediate === true ? await nsOutbox.retryAll() : await nsOutbox.flush();
    refreshNsUi();
    return r;
  }
  function refreshNsUi() {
    renderSyncChip();
    try {
      if (!state) return;
      if (!el("view-settings").hidden) { renderNightscoutSection(); if (!el("panel-sync").hidden) renderStatusPanel(); }
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
    renderSyncChip();
    // Keep the System Status panel live if it's currently on screen.
    if (!el("view-settings").hidden && !el("panel-sync").hidden) renderStatusPanel();
  }

  bind("cc-fetch-glucose", "click", fetchCurrentGlucoseFromNightscout);



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




  window.addEventListener("online", () => { flushNightscoutQueue(true); refreshLiveGlucose(true); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { flushNightscoutQueue(true); refreshLiveGlucose(true); } });


  // ================= Undo toast =================
  let undoTimer = null;
  let undoAction = null;
  // Stays up 8 seconds (long enough to notice and reach for), shows how long is left, and holds still while a finger or the pointer is on it.
  let undoRemaining = 0, undoStartedAt = 0;
  function hideUndoToast() { clearTimeout(undoTimer); el("undo-toast").hidden = true; undoAction = null; }
  function startUndoTimer(ms) {
    clearTimeout(undoTimer);
    undoStartedAt = Date.now(); undoRemaining = ms;
    undoTimer = setTimeout(hideUndoToast, ms);
    el("undo-toast").classList.remove("is-paused");
  }
  function showUndoToast(message, onUndo, { ms = 8000 } = {}) {
    undoAction = onUndo;
    const toast = el("undo-toast");
    el("undo-toast-message").textContent = message;
    toast.style.setProperty("--toast-ms", ms + "ms");
    toast.hidden = false;
    toast.classList.remove("is-running"); void toast.offsetWidth; toast.classList.add("is-running");   // restart the countdown bar
    startUndoTimer(ms);
  }
  bind("undo-toast", "pointerenter", () => {
    if (!undoAction) return;
    clearTimeout(undoTimer); undoRemaining -= Date.now() - undoStartedAt; el("undo-toast").classList.add("is-paused");
  });
  bind("undo-toast", "pointerleave", () => { if (undoAction && !el("undo-toast").hidden) startUndoTimer(Math.max(1500, undoRemaining)); });
  bind("undo-toast-btn", "click", () => {
    const fn = undoAction;
    hideUndoToast();
    if (fn) fn();
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
        <button class="lib-item__star${f.favorite ? " is-fav" : ""}" data-id="${escapeAttr(f.id)}" aria-label="Toggle favorite">
          <svg viewBox="0 0 24 24" fill="${f.favorite ? "currentColor" : "none"}"><path d="M12 3.5l2.6 5.6 6 .7-4.4 4.2 1.1 6-5.3-3-5.3 3 1.1-6-4.4-4.2 6-.7z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>
        </button>
        <div class="lib-item__main">
          <p class="lib-item__name">${escapeHtml(f.name)}</p>
          <div class="lib-item__badges">
            ${categoryBadge(f.category)}
            ${f.gi != null ? `<span class="lib-item__badge cat-other"${(f.estimated || []).includes("gi") ? ` title="Filled from a typical value"` : ""}>GI ${(f.estimated || []).includes("gi") ? "~" : ""}${f.gi}</span>` : ""}
          </div>
          <p class="lib-item__meta"><span class="c-carbs">${f.carbs}g carbs</span>${f.kcal ? ` · <span class="c-kcal">~${f.kcal} kcal</span>` : ""}</p>
          ${f.unitBased ? `<p class="lib-item__note">1 ${escapeHtml(f.unitLabel)} = ${f.gramsPerUnit}g → ${round1(f.carbs * f.gramsPerUnit / 100)}g carbs</p>` : ""}
          ${f.notes ? `<p class="lib-item__note">${escapeHtml(f.notes)}</p>` : ""}
        </div>
        <span class="lib-item__usage" title="Times used" aria-label="Used ${f.usageCount || 0} times"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12a8 8 0 0114-5.3M20 12a8 8 0 01-14 5.3M18 3v4h-4M6 21v-4h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>${f.usageCount || 0}</span>
        <div class="lib-item__actions">
          <button data-act="edit" data-id="${escapeAttr(f.id)}" aria-label="Edit"><svg viewBox="0 0 24 24" fill="none"><path d="M4 20l4-1 11-11-3-3L5 16z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg></button>
          <button data-act="copy" data-id="${escapeAttr(f.id)}" aria-label="Duplicate"><svg viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M5 15V6a2 2 0 012-2h9" stroke="currentColor" stroke-width="1.6"/></svg></button>
          <button class="danger" data-act="delete" data-id="${escapeAttr(f.id)}" aria-label="Delete"><svg viewBox="0 0 24 24" fill="none"><path d="M5 7h14M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m-9 0l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
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


  function renderVersionCard() {
    const latest = CHANGELOG[0];
    el("version-badge-text").innerHTML = `v${latest.version} <svg viewBox="0 0 24 24" fill="none" width="14" height="14"><path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    el("version-summary-text").textContent = `${latest.summary} Tap to see what's changed.`;
  }
  bind("btn-open-changelog", "click", openChangelogSheet);
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
    openSheet(backdrop);   // not appendChild: see openActiveDetailSheet
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
          <input type="text" inputmode="decimal" autocomplete="off" spellcheck="false" id="fs-carbs" value="${f.carbs ?? ""}" placeholder="e.g., 28">
        </div>
        <div class="field-inline-row">
          <label>Calories per 100g <span class="field__optional">(optional)</span></label>
          <input type="text" inputmode="decimal" autocomplete="off" spellcheck="false" id="fs-kcal" value="${f.kcal ?? ""}" placeholder="e.g., 150">
        </div>
        <div class="field-inline-row">
          <label>Fat per 100g <span class="field__optional">(optional)</span></label>
          <input type="text" inputmode="decimal" autocomplete="off" spellcheck="false" id="fs-fat" value="${f.fat ?? ""}" placeholder="e.g., 5">
        </div>
        <div class="field-inline-row">
          <label>Protein per 100g <span class="field__optional">(optional)</span></label>
          <input type="text" inputmode="decimal" autocomplete="off" spellcheck="false" id="fs-protein" value="${f.protein ?? ""}" placeholder="e.g., 8">
        </div>
        <div class="field-inline-row">
          <label>Salt per 100g <span class="field__optional">(optional)</span></label>
          <input type="text" inputmode="decimal" autocomplete="off" spellcheck="false" id="fs-salt" value="${f.salt ?? ""}" placeholder="e.g., 0.5">
        </div>
        <div class="field-inline-row">
          <label>Glycemic Index <span class="field__optional">(optional)</span></label>
          <input type="text" inputmode="decimal" autocomplete="off" spellcheck="false" id="fs-gi" value="${f.gi ?? ""}" placeholder="e.g., 55">
        </div>
        ${Array.isArray(f.estimated) && f.estimated.length ? `<p class="panel-card__hint" style="margin:-4px 0 12px;">Filled from typical values: ${f.estimated.map(k => ({ gi: "GI", fat: "fat", protein: "protein", salt: "salt", kcal: "calories" }[k] || k)).join(", ")}. Change any you know better.</p>` : ""}

        <div class="checkbox-row" style="margin-top:18px;">
          <label><input type="checkbox" id="fs-unit-based" ${f.unitBased ? "checked" : ""}> Log this by quantity, not weight</label>
        </div>
        <p class="panel-card__hint" style="margin:-10px 0 14px;">e.g., "1 sandwich" instead of grams. The nutrition above still applies per 100g — we just need to know how much one whole item weighs.</p>
        <div class="unit-fields" id="fs-unit-fields" ${f.unitBased ? "" : "hidden"}>
          <div class="field-grid" style="margin-bottom:16px;">
            <div class="field" style="margin-bottom:0;"><label>Unit name</label><input type="text" id="fs-unit-label" value="${escapeAttr(f.unitLabel || "")}" placeholder="e.g., sandwich"></div>
            <div class="field" style="margin-bottom:0;"><label>Weight per unit (g)</label><input type="text" inputmode="decimal" autocomplete="off" spellcheck="false" id="fs-grams-per-unit" value="${f.gramsPerUnit ?? ""}" placeholder="e.g., 50"></div>
          </div>
        </div>

        <div class="field">
          <label>Category</label>
          <select id="fs-cat">
            ${CATEGORIES.map(c => `<option value="${escapeAttr(c.id)}" ${c.id === f.category ? "selected" : ""}>${c.label}</option>`).join("")}
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
      // Every amount is read with the decimal-comma parser: "12,5" is 12.5, never 125.
      const num = id => { const t = backdrop.querySelector(id).value.trim(); return t === "" ? null : parseDecimalInput(t); };
      const carbs = num("#fs-carbs");
      if (!name || carbs == null || isNaN(carbs)) { dialogs.alert("Please enter at least a name and carbs per 100g (for example 28 or 12,5)."); return; }
      const optional = { kcal: num("#fs-kcal"), fat: num("#fs-fat"), protein: num("#fs-protein"), salt: num("#fs-salt"), gi: num("#fs-gi") };
      const unreadable = Object.entries(optional).filter(([, v]) => v != null && isNaN(v)).map(([k]) => ({ kcal: "Calories", fat: "Fat", protein: "Protein", salt: "Salt", gi: "GI" })[k]);
      if (unreadable.length) { dialogs.alert(`${unreadable.join(", ")}: that isn't a number I can read. Try something like 1.5 or 1,5, or leave it empty.`); return; }
      const unitBased = backdrop.querySelector("#fs-unit-based").checked;
      const unitLabel = backdrop.querySelector("#fs-unit-label").value.trim();
      const gramsPerUnit = num("#fs-grams-per-unit");
      if (unitBased && (!unitLabel || !gramsPerUnit || gramsPerUnit <= 0)) {
        dialogs.alert("For a quantity-based food, please give it a unit name and a weight per unit greater than 0.");
        return;
      }
      const payload = {
        name,
        category: backdrop.querySelector("#fs-cat").value,
        carbs,
        kcal: optional.kcal || null,
        fat: optional.fat || null,
        protein: optional.protein || null,
        salt: optional.salt || null,
        gi: optional.gi || null,
        notes: backdrop.querySelector("#fs-notes").value.trim(),
        favorite: backdrop.querySelector("#fs-fav").checked,
        unitBased,
        unitLabel: unitBased ? unitLabel : null,
        gramsPerUnit: unitBased ? gramsPerUnit : null
      };
      if (isEdit) {
        // a value you changed is yours now, no longer an estimate
        if (Array.isArray(f.estimated)) { const keep = f.estimated.filter(k => payload[k] === f[k]); if (keep.length) payload.estimated = keep; else delete f.estimated; }
        Object.assign(f, payload);
      } else state.library.unshift({ id: "food-" + Date.now(), usageCount: 0, ...payload });
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
        <button class="lib-item__star${r.favorite ? " is-fav" : ""}" data-id="${escapeAttr(r.id)}" aria-label="Toggle favorite">
          <svg viewBox="0 0 24 24" fill="${r.favorite ? "currentColor" : "none"}"><path d="M12 3.5l2.6 5.6 6 .7-4.4 4.2 1.1 6-5.3-3-5.3 3 1.1-6-4.4-4.2 6-.7z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>
        </button>
        <div class="lib-item__main">
          <p class="lib-item__name">${escapeHtml(r.name)}</p>
          <div class="lib-item__badges">${categoryBadge(r.category || "other")}</div>
          <p class="lib-item__meta">${perG}</p>
          <p class="lib-item__note">${r.items.map(it => {
            const name = it.name || (state.library.find(x => x.id === it.foodId) || {}).name;
            return name ? `${escapeHtml(name)} (${escapeHtml(it.grams)}g)` : "";
          }).filter(Boolean).join(", ")}${r.finalWeight ? ` — final weight ${r.finalWeight}g` : ""}</p>
        </div>
        <span class="lib-item__usage" title="Times used" aria-label="Used ${r.usageCount || 0} times"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12a8 8 0 0114-5.3M20 12a8 8 0 01-14 5.3M18 3v4h-4M6 21v-4h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>${r.usageCount || 0}</span>
        <div class="lib-item__actions">
          <button data-act="edit" data-id="${escapeAttr(r.id)}" aria-label="Edit"><svg viewBox="0 0 24 24" fill="none"><path d="M4 20l4-1 11-11-3-3L5 16z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg></button>
          <button class="danger" data-act="delete" data-id="${escapeAttr(r.id)}" aria-label="Delete"><svg viewBox="0 0 24 24" fill="none"><path d="M5 7h14M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m-9 0l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
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
            <select id="rs-cat">${CATEGORIES.map(c => `<option value="${escapeAttr(c.id)}" ${c.id === r.category ? "selected" : ""}>${c.label}</option>`).join("")}</select>
          </div>
        </div>

        <label class="block-label">Ingredients</label>
        <div class="ingredient-box">
          <div class="ingredient-search-wrap">
            <input type="text" id="rs-ing-search" placeholder="Search ingredients&hellip;" autocomplete="off">
            <div class="ingredient-dropdown" id="rs-ing-dropdown" hidden></div>
          </div>
          <div class="ingredient-add-row">
            <input type="text" inputmode="decimal" autocomplete="off" spellcheck="false" id="rs-ing-weight" placeholder="Grams" aria-label="Grams">
            <button type="button" id="rs-ing-add" aria-label="Add ingredient">
              <svg viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
            </button>
          </div>
          <p class="ingredient-hint" id="rs-ing-hint" role="status" hidden></p>
          <div id="rs-ing-list" class="ingredient-list"></div>
          <div id="rs-total" class="ingredient-total" hidden></div>
        </div>

        <div class="field-grid" style="margin-top:16px;">
          <div class="field"><label>Raw Weight (g)</label><input type="text" inputmode="decimal" autocomplete="off" spellcheck="false" id="rs-raw-weight" value="${r.rawWeight ?? ""}" placeholder="Optional"></div>
          <div class="field"><label>Final Weight (g) *</label><input type="text" inputmode="decimal" autocomplete="off" spellcheck="false" id="rs-final-weight" value="${r.finalWeight ?? ""}" placeholder="e.g., 800"></div>
        </div>

        <div class="field">
          <label for="rs-slices">Slices <span class="field__optional">(Optional)</span></label>
          <input type="text" inputmode="numeric" autocomplete="off" id="rs-slices" value="${r.slices > 0 ? escapeAttr(r.slices) : ""}" placeholder="e.g., 12">
          <p class="panel-card__hint" style="margin-top:6px;">How many slices the whole dish is cut into. On the Calculator you can then add "1 slice" or "2 slices" instead of grams.</p>
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

    // The listed ingredients are the check on the weights typed below: their sum is the raw weight, and the finished
    // dish can only be lighter than that (water cooks off) unless something unlisted went in.
    function renderTotal() {
      const box = backdrop.querySelector("#rs-total");
      const total = Math.round(items.reduce((a, i) => a + (i.grams > 0 ? i.grams : 0), 0) * 10) / 10;
      if (!total) { box.hidden = true; box.innerHTML = ""; return; }
      const raw = parseDecimalInput(backdrop.querySelector("#rs-raw-weight").value);
      const fin = parseDecimalInput(backdrop.querySelector("#rs-final-weight").value);
      const notes = [];
      if (raw > 0 && Math.abs(raw - total) > Math.max(1, total * 0.01)) notes.push(`Raw weight says ${raw} g but the ingredients add up to ${total} g`);
      if (fin > 0 && fin > total * 1.02) notes.push(`Final weight is more than the ingredients weigh. Is something missing from the list?`);
      box.hidden = false;
      box.classList.toggle("is-warn", notes.length > 0);
      box.innerHTML = `<div class="ingredient-total__row"><span>Ingredients total</span><strong>${total} g</strong></div>` +
        notes.map(n => `<p class="ingredient-total__note">${escapeHtml(n)}</p>`).join("") +
        (raw > 0 && Math.abs(raw - total) > Math.max(1, total * 0.01) ? `<button type="button" class="ingredient-total__fix" data-fix="raw">Set raw weight to ${total} g</button>` : "");
    }
    backdrop.querySelector("#rs-total").addEventListener("click", e => {
      if (!e.target.closest('[data-fix="raw"]')) return;
      const total = Math.round(items.reduce((a, i) => a + (i.grams > 0 ? i.grams : 0), 0) * 10) / 10;
      backdrop.querySelector("#rs-raw-weight").value = total; renderTotal();
    });
    backdrop.querySelector("#rs-raw-weight").addEventListener("input", renderTotal);
    backdrop.querySelector("#rs-final-weight").addEventListener("input", renderTotal);

    function renderIngredientList() {
      renderTotal();
      const box = backdrop.querySelector("#rs-ing-list");
      if (items.length === 0) { box.innerHTML = ""; return; }
      box.innerHTML = items.map((it, idx) => {
        const name = it.name || (state.library.find(x => x.id === it.foodId) || {}).name || "(missing food)";
        return `
          <div class="ingredient-row">
            <span class="ingredient-row__name">${escapeHtml(name)}</span>
            <span class="ingredient-row__grams"><input type="text" inputmode="decimal" autocomplete="off" spellcheck="false" class="ingredient-row__input" data-gidx="${idx}" value="${escapeAttr(it.grams)}" aria-label="Grams of ${escapeAttr(name)}">g</span>
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
      dd.innerHTML = matches.map(f => `<button type="button" class="ingredient-dropdown__item" data-id="${escapeAttr(f.id)}">${escapeHtml(f.name)} <span>${f.carbs}g carbs/100g</span></button>`).join("");
      dd.hidden = false;
    }

    const hint = msg => { const h = backdrop.querySelector("#rs-ing-hint"); h.textContent = msg || ""; h.hidden = !msg; };
    const closeDropdown = () => { const dd = backdrop.querySelector("#rs-ing-dropdown"); dd.hidden = true; dd.innerHTML = ""; };
    function pickFood(f) {
      ingredientSelection = { foodId: f.id, name: f.name };
      backdrop.querySelector("#rs-ing-search").value = f.name;
      closeDropdown(); hint("");
    }
    // A typed name counts without tapping the suggestion: an exact name (any case), or the only food that matches.
    function resolveTypedFood() {
      if (ingredientSelection) return state.library.find(f => f.id === ingredientSelection.foodId) || null;
      const q = backdrop.querySelector("#rs-ing-search").value.trim().toLowerCase();
      if (!q) return null;
      const exact = state.library.filter(f => f.name.toLowerCase() === q);
      if (exact.length === 1) return exact[0];
      const partial = state.library.filter(f => f.name.toLowerCase().includes(q));
      return partial.length === 1 ? partial[0] : null;
    }
    backdrop.querySelector("#rs-ing-search").addEventListener("input", () => { ingredientSelection = null; hint(""); renderDropdown(); });
    backdrop.querySelector("#rs-ing-search").addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); const f = resolveTypedFood() || state.library.find(x => x.name.toLowerCase().includes(e.target.value.trim().toLowerCase()) && e.target.value.trim()); if (f) { pickFood(f); backdrop.querySelector("#rs-ing-weight").focus(); } }
      if (e.key === "Escape") closeDropdown();
    });
    // Leaving the search box closes the suggestions (a tap on a suggestion still lands: it keeps the focus, see below).
    backdrop.querySelector("#rs-ing-search").addEventListener("blur", () => setTimeout(closeDropdown, 0));
    ["pointerdown", "mousedown"].forEach(t => backdrop.querySelector("#rs-ing-dropdown").addEventListener(t, e => e.preventDefault()));
    backdrop.querySelector("#rs-ing-dropdown").addEventListener("click", e => {
      const btn = e.target.closest(".ingredient-dropdown__item");
      if (!btn) return;
      const f = state.library.find(x => x.id === btn.dataset.id);
      if (!f) return;
      pickFood(f);
      backdrop.querySelector("#rs-ing-weight").focus();
    });

    function addIngredient() {
      const weight = parseDecimalInput(backdrop.querySelector("#rs-ing-weight").value);
      const typed = backdrop.querySelector("#rs-ing-search").value.trim();
      const picked = resolveTypedFood();
      if (!picked) {
        hint(typed ? `No single food called "${typed}" in your library: pick one from the list.` : "Search for an ingredient first.");
        if (typed) renderDropdown();
        backdrop.querySelector("#rs-ing-search").focus(); return;
      }
      pickFood(picked);
      if (!(weight > 0)) { hint("Enter the grams for this ingredient (for example 87 or 87,5)."); backdrop.querySelector("#rs-ing-weight").focus(); return; }
      const food = state.library.find(f => f.id === ingredientSelection.foodId);
      items.push({
        foodId: ingredientSelection.foodId, name: ingredientSelection.name, grams: weight,
        carbsPer100g: food ? food.carbs : 0, kcalPer100g: food ? food.kcal : null
      });
      ingredientSelection = null;
      backdrop.querySelector("#rs-ing-search").value = "";
      backdrop.querySelector("#rs-ing-weight").value = "";
      hint("");
      renderIngredientList();
      backdrop.querySelector("#rs-ing-search").focus({ preventScroll: true });   // ready for the next ingredient
    }
    backdrop.querySelector("#rs-ing-add").addEventListener("click", addIngredient);
    backdrop.querySelector("#rs-ing-weight").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); addIngredient(); } });
    // Tweak an amount in place: no need to remove and re-add the ingredient.
    backdrop.querySelector("#rs-ing-list").addEventListener("input", e => {
      const inp = e.target.closest("input[data-gidx]");
      if (!inp) return;
      const g = parseDecimalInput(inp.value);   // "87,5" is 87.5, never 875
      if (items[+inp.dataset.gidx]) items[+inp.dataset.gidx].grams = g > 0 ? g : 0;
      inp.classList.toggle("is-invalid", inp.value.trim() !== "" && !(g >= 0));
      renderTotal();
    });
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
      const finalWeight = parseDecimalInput(backdrop.querySelector("#rs-final-weight").value);
      const rawText = backdrop.querySelector("#rs-raw-weight").value.trim();
      const rawWeight = rawText ? parseDecimalInput(rawText) : null;
      if (!name) { dialogs.alert("Give the recipe a name."); return; }
      if (items.length === 0) { dialogs.alert("Add at least one ingredient."); return; }
      if (items.some(i => !(i.grams > 0))) { dialogs.alert("Every ingredient needs an amount in grams (or remove it)."); return; }
      const slicesText = backdrop.querySelector("#rs-slices").value.trim();
      const slices = slicesText ? parseDecimalInput(slicesText) : null;
      if (slicesText && !(Number.isInteger(slices) && slices >= 1 && slices <= 200)) { dialogs.alert("Slices should be a whole number, like 8 or 12 — or leave it empty."); return; }
      if (rawText && !(rawWeight > 0)) { dialogs.alert("Raw Weight isn't a number I can read. Try something like 653 or 653,5, or leave it empty."); return; }
      if (!finalWeight || finalWeight <= 0) { dialogs.alert("Final Weight is required — it's the total weight of the finished dish, used to work out carbs per 100g."); return; }
      const payload = {
        name,
        category: backdrop.querySelector("#rs-cat").value,
        notes: backdrop.querySelector("#rs-notes").value.trim(),
        favorite: backdrop.querySelector("#rs-fav").checked,
        items,
        rawWeight: rawWeight || null,
        slices: slices || null,
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

  // ---- hs a History row left to reveal Edit and Delete ----
  // The buttons ride along on the right edge of the row itself, so they are never drawn behind it. They reuse the same
  // data-edit / data-del handlers as the buttons in the expanded row. Only touch listeners, no timers: nothing runs while idle.
  const HS_W = 144;
  function wrapSwipe(row, id) {
    const wrap = document.createElement("div");
    wrap.className = "hs-row"; wrap.dataset.id = id;
    const actions = document.createElement("div");
    actions.className = "hs-actions";
    actions.innerHTML = `<button type="button" class="hs-actions__edit" data-edit="${escapeAttr(id)}">Edit</button><button type="button" class="hs-actions__del" data-del="${escapeAttr(id)}">Delete</button>`;
    row.appendChild(actions);
    wrap.appendChild(row);
    return wrap;
  }
  let hs = null, hsLastAt = 0;
  const hsRowOf = e => e.target.closest && e.target.closest(".hs-row");
  function hsSet(wrap, open) {
    const r = wrap.querySelector(".history-entry");
    wrap.classList.toggle("is-open", open);
    r.style.transition = ""; r.style.transform = open ? `translateX(-${HS_W}px)` : "";
  }
  function hsCloseOthers(except) { historyGroups.querySelectorAll(".hs-row.is-open").forEach(w => { if (w !== except) hsSet(w, false); }); }
  // Swipe a row left to reveal Edit / Delete. The rules (direction, rubber band, flick or distance) live in js/swipe.js.
  historyGroups.addEventListener("touchstart", e => {
    const wrap = hsRowOf(e);
    if (!wrap || e.touches.length !== 1 || e.target.closest(".hs-actions")) { hs = null; return; }
    hsCloseOthers(wrap);
    const t = e.touches[0];
    hs = { wrap, row: wrap.querySelector(".history-entry"), x: t.clientX, y: t.clientY, base: wrap.classList.contains("is-open") ? -HS_W : 0, pos: 0, mode: null, x0: 0, samples: [] };
  }, { passive: true });
  historyGroups.addEventListener("touchmove", e => {
    if (!hs) return;
    if (e.touches.length !== 1) { hsSet(hs.wrap, hs.base !== 0); hs = null; return; }   // a second finger: put the row back
    const t = e.touches[0];
    if (!hs.mode) {
      const axis = swipeAxis(t.clientX - hs.x, t.clientY - hs.y);
      if (!axis) return;
      if (axis === "v") { hs = null; return; }         // a normal scroll: leave it alone
      hs.mode = "h"; hs.x0 = t.clientX;                // follow the finger from here, so the row doesn't jump
      hs.row.style.transition = "none";
    }
    e.preventDefault();
    const now = e.timeStamp || performance.now();
    hs.samples.push({ x: t.clientX, t: now }); if (hs.samples.length > 8) hs.samples.shift();
    hs.pos = swipePos(hs.base, t.clientX - hs.x0, HS_W);
    hs.row.style.transform = `translateX(${hs.pos}px)`;
  }, { passive: false });
  const hsEnd = e => {
    if (!hs) return;
    if (hs.mode === "h") {
      hsLastAt = Date.now();
      const v = swipeVelocity(hs.samples, (e && e.timeStamp) || performance.now());
      hsSet(hs.wrap, swipeSettle({ pos: hs.pos, velocity: v, width: HS_W }));
    }
    hs = null;
  };
  historyGroups.addEventListener("touchend", hsEnd);
  historyGroups.addEventListener("touchcancel", () => { if (hs && hs.mode === "h") hsSet(hs.wrap, hs.base !== 0); hs = null; });
  // The tap the browser sends at the end of a swipe is ignored (it would expand the row); a tap on an opened row closes it.
  // Edit and Delete always work, even straight after the swipe that revealed them.
  historyGroups.addEventListener("click", e => {
    const wrap = hsRowOf(e);
    if (e.target.closest(".hs-actions")) return;
    if (Date.now() - hsLastAt < 300) { e.stopPropagation(); return; }
    if (wrap && wrap.classList.contains("is-open")) { e.stopPropagation(); hsSet(wrap, false); }
  }, true);

  function renderHistory(opts = {}) {
    const mealCount = state.history.filter(e => !isBasalEntry(e)).length;   // a basal dose isn't a meal
    histCountPill.textContent = `${mealCount} meal${mealCount === 1 ? "" : "s"}`;
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
    if (query) histCountPill.textContent = `${filtered.filter(e => !isBasalEntry(e)).length} of ${mealCount}`;
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
        if (isBasalEntry(entry)) { groupEl.appendChild(wrapSwipe(buildBasalRow(entry), entry.id)); return; }
        const meal = MEAL_TYPES[entry.mealType] || MEAL_TYPES.snack;
        const row = document.createElement("div");
        row.className = "history-entry";
        row.style.borderLeftColor = meal.color;
        row.dataset.id = entry.id;
        const badge = doseBadge(entry);
        const DROP = `<svg viewBox="0 0 24 24" fill="none"><path d="M12 2C12 2 5 10.5 5 15.5C5 19.6 8.13 22 12 22C15.87 22 19 19.6 19 15.5C19 10.5 12 2 12 2Z" stroke="currentColor" stroke-width="2"/></svg>`;
        const PULSE = `<svg viewBox="0 0 24 24" fill="none"><path d="M3 12h4l2.5-6 4 12 2.5-6H21" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
        const DOWN = `<svg viewBox="0 0 24 24" fill="none"><path d="M12 19V5M12 19l-5-5M12 19l5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
        const dosePillHtml = `<span class="dose-badge dose-badge--${badge.kind}"><span class="dose-pill${badge.kind === "low" ? " dose-pill--warn" : badge.kind === "correction" ? " dose-pill--corr" : ""}">${badge.kind === "low" ? DOWN : badge.kind === "correction" ? PULSE : DROP}${escapeHtml(badge.main)}</span>${badge.sub ? `<span class="dose-badge__sub">${escapeHtml(badge.sub)}</span>` : ""}</span>`;
        row.innerHTML = `
          <div class="history-entry__icon" style="background:${meal.color}">${meal.icon}</div>
          <div class="history-entry__main">
            <p class="history-entry__title"><span class="history-entry__name">${meal.label}</span> <span class="muted">${formatTime(entry.ts)}${ratioWasApplied(entry) ? `${entry.periodName ? ` · ${escapeHtml(entry.periodName)}` : ""} · 1:${round1(entry.ratioValue)}` : ""}</span>${nsBadgeHtml(entry)}</p>
            <p class="history-entry__foods"><span class="history-entry__food-names">${entry.items.length ? entry.items.map(i => escapeHtml(i.name)).join(", ") : (entry.carbsUnknown ? "Eating out — carbs not logged" : "No food — correction only")}</span>${entry.glycemicLoad ? `<span class="gl-indicator gl-indicator--${entry.glycemicLoad.value >= 70 ? "high" : entry.glycemicLoad.value >= 56 ? "medium" : "low"} gl-indicator--compact">GI ${entry.glycemicLoad.value}${entry.glycemicLoad.partial ? "*" : ""}</span>` : ""}</p>
            <div class="history-entry__detail" hidden>
              ${entry.items.map(i => {
                const isUnit = i.quantity != null && i.unitLabel;
                const qtyLabel = isUnit ? `${formatQty(i.quantity)} ${escapeHtml(i.unitLabel)}${i.quantity === 1 ? "" : "s"}` : (i.grams ? escapeHtml(i.grams) + "g" : "");
                return `<div class="history-entry__item"><span class="history-entry__item-name">${escapeHtml(i.name)}</span><span class="history-entry__item-qty">${qtyLabel}</span><span class="history-entry__item-carbs">${round1(i.carbs)}g</span></div>`;
              }).join("")}
              ${ratioWasApplied(entry) ? `<p class="history-entry__ratio">Ratio used: ${escapeHtml(entry.ratioLabel || "")} 1:${round1(entry.ratioValue)}</p>` : ""}
              ${entry.cappedFrom ? `<p class="history-entry__cap">Capped at your maximum dose (calculated ${entry.cappedFrom}u)</p>` : ""}
              <div class="history-entry__row-actions">
                <button data-use="${escapeAttr(entry.id)}" type="button">Use Again</button>
                <button data-edit="${escapeAttr(entry.id)}" type="button">Edit</button>
                <button class="danger" data-del="${escapeAttr(entry.id)}" type="button">Delete</button>
              </div>
            </div>
          </div>
          <div class="history-entry__stats">
            ${dosePillHtml}
            ${entry.carbsUnknown ? `<span class="stat-line"><span class="stat-grams">Carbs not logged</span></span>` : `<span class="stat-line"><span class="stat-grams">${entry.totalCarbs}g</span><span class="stat-kcal">${entry.totalKcal || 0} kcal</span></span>`}
          </div>
        `;
        groupEl.appendChild(wrapSwipe(row, entry.id));
      });
      historyGroups.appendChild(groupEl);
    });
    if (!opts.skipTrends) renderTrends(trendsRange);
  }

  // ---- Trends ----
  let historySeg = "log"; // 'log' | 'trends' | 'glucose'
  let trendsRange = 14;
  let glucoseRange = 14;
  const historySegmented = el("history-segmented");
  const historyLogPanel = el("history-log-panel");
  const historyTrendsPanel = el("history-trends-panel");
  const historyGlucosePanel = el("history-glucose-panel");
  const trendsRangeSegmented = el("trends-range-segmented");
  const glucoseRangeSegmented = el("glucose-range-segmented");

  historySegmented.addEventListener("click", e => {
    const btn = e.target.closest(".segmented__btn");
    if (!btn) return;
    historySeg = btn.dataset.seg;
    historySegmented.querySelectorAll(".segmented__btn").forEach(b => b.classList.toggle("is-active", b === btn));
    historyLogPanel.hidden = historySeg !== "log";
    historyTrendsPanel.hidden = historySeg !== "trends";
    historyGlucosePanel.hidden = historySeg !== "glucose";
    if (historySeg === "trends") renderTrends(trendsRange);
    if (historySeg === "glucose") renderGlucoseTab(glucoseRange);
  });
  glucoseRangeSegmented.addEventListener("click", e => {
    const btn = e.target.closest(".segmented__btn");
    if (!btn) return;
    glucoseRange = parseInt(btn.dataset.range, 10);
    glucoseRangeSegmented.querySelectorAll(".segmented__btn").forEach(b => b.classList.toggle("is-active", b === btn));
    renderGlucoseTab(glucoseRange);
  });
  bind("btn-generate-report", "click", () => renderClinicReport(glucoseRange));
  bind("btn-report-close", "click", () => { el("report-overlay").hidden = true; });
  bind("btn-report-print", "click", () => window.print());
  // Saving: a real PDF made in the app (printing does nothing in a home-screen app), shared to Files/Mail or downloaded.
  async function savePdfFrom(btnId, contentId, days) {
    const btn = el(btnId), label = btn.textContent;
    btn.disabled = true; btn.textContent = "Making PDF\u2026";
    try {
      const stamp = new Date().toISOString().slice(0, 10);
      const how = await saveReportPdf(el(contentId), { title: `Insulin Buddy report, last ${days} days`, fileName: `insulin-buddy-report-${stamp}.pdf` });
      if (how === "downloaded") dialogs.alert("The PDF was saved to your downloads.", { title: "Report saved" });
    } catch (e) {
      diag.log("error", "report", `PDF failed: ${e && e.message}`);
      dialogs.alert(`The PDF could not be made (${(e && e.message) || "unknown error"}). You can still use Print.`, { title: "Could not save" });
    } finally { btn.disabled = false; btn.textContent = label; }
  }
  bind("btn-report-save", "click", () => savePdfFrom("btn-report-save", "report-content", glucoseRange));
  bind("clinic-report-save", "click", () => savePdfFrom("clinic-report-save", "clinic-report-content", glucoseRange));

  const glucoseViewSegmented = el("glucose-view-segmented");
  glucoseViewSegmented.addEventListener("click", e => {
    const btn = e.target.closest(".segmented__btn");
    if (!btn) return;
    glucoseView = btn.dataset.glview;
    glucoseViewSegmented.querySelectorAll(".segmented__btn").forEach(b => b.classList.toggle("is-active", b === btn));
    renderGlucoseTab(glucoseRange); // readings are cached -- this re-render is instant, no re-fetch
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

  // Stacked: carbs eaten as meals on the bottom, carbs eaten to treat a low (no insulin) on top.
  function buildCarbsChartSvg(buckets, avg, width) {
    const g = trendGeometry(buckets.length, Math.max(...buckets.map(b => b.carbs)), width);
    const frame = trendFrameSvg(g, buckets, avg, `avg ${Math.round(avg)}g`);
    const base = g.padT + g.plotH;
    const bars = buckets.map((b, i) => {
      const todayCls = i === g.n - 1 ? " trend-chart__bar--today" : "";
      if (!(b.carbs > 0)) {
        return `<rect class="trend-chart__bar trend-chart__bar--empty${todayCls}" data-idx="${i}" x="${g.xBar(i).toFixed(1)}" y="${(base - 1).toFixed(1)}" width="${g.barW.toFixed(1)}" height="1" rx="2"></rect>`;
      }
      const hMeal = b.mealCarbs > 0 ? Math.max(2, (b.mealCarbs / g.max) * g.plotH) : 0;
      const hLow = b.lowCarbs > 0 ? Math.max(2, (b.lowCarbs / g.max) * g.plotH) : 0;
      let out = "";
      if (hMeal > 0) out += `<rect class="trend-chart__bar${todayCls}" data-idx="${i}" x="${g.xBar(i).toFixed(1)}" y="${(base - hMeal).toFixed(1)}" width="${g.barW.toFixed(1)}" height="${hMeal.toFixed(1)}" rx="${hLow > 0 ? 0 : 2}"></rect>`;
      if (hLow > 0) out += `<rect class="trend-chart__bar trend-chart__bar--low${todayCls}" data-idx="${i}" x="${g.xBar(i).toFixed(1)}" y="${(base - hMeal - hLow).toFixed(1)}" width="${g.barW.toFixed(1)}" height="${hLow.toFixed(1)}" rx="2"></rect>`;
      return out;
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

  // Basal insulin per day. Stacked like the dose chart: the morning dose on the bottom (light blue) and the evening dose
  // on top (dark blue), so with variable doses you can see which of the two is moving, not just the daily total.
  function buildBasalChartSvg(buckets, avg, width) {
    const g = trendGeometry(buckets.length, Math.max(1, ...buckets.map(b => b.basal)), width);
    const frame = trendFrameSvg(g, buckets, avg, `avg ${round1(avg)}u`);
    const base = g.padT + g.plotH;
    const bars = buckets.map((b, i) => {
      const todayCls = i === g.n - 1 ? " trend-chart__bar--today" : "";
      const x = g.xBar(i).toFixed(1), w = g.barW.toFixed(1);
      if (b.basal <= 0) return `<rect class="trend-chart__bar trend-chart__bar--empty${todayCls}" data-idx="${i}" x="${x}" y="${(base - 1).toFixed(1)}" width="${w}" height="1" rx="2"></rect>`;
      const hAm = b.bAm > 0 ? Math.max(2, (b.bAm / g.max) * g.plotH) : 0;
      const hPm = b.bPm > 0 ? Math.max(2, (b.bPm / g.max) * g.plotH) : 0;
      let out = "";
      if (hAm > 0) out += `<rect class="trend-chart__bar trend-chart__bar--basal-am${todayCls}" data-idx="${i}" x="${x}" y="${(base - hAm).toFixed(1)}" width="${w}" height="${hAm.toFixed(1)}" rx="${hPm > 0 ? 0 : 2}"></rect>`;
      if (hPm > 0) out += `<rect class="trend-chart__bar trend-chart__bar--basal-pm${todayCls}" data-idx="${i}" x="${x}" y="${(base - hAm - hPm).toFixed(1)}" width="${w}" height="${hPm.toFixed(1)}" rx="2"></rect>`;
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
  ["trend-chart-carbs", "trend-chart-dose", "trend-chart-basal"].forEach(id => {
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

  // The "Daily basal insulin" card. Shown only when a basal dose was logged in the period; it joins the tap-a-day
  // selection shared by the other charts (see setTrendSelection) while it is showing.
  function renderBasalTrend(buckets, sum, fallbackWidth) {
    const card = el("trend-card-basal"), box = el("trend-chart-basal"), panel = el("history-trends-panel");
    if (!card || !box) return;
    delete trendChartCtx["trend-chart-basal"];
    card.hidden = !sum.hasData;
    if (panel) panel.classList.toggle("has-basal", sum.hasData);
    if (!sum.hasData) { box.innerHTML = ""; return; }
    const fmtDay = ts => new Date(ts).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
    trendChartCtx["trend-chart-basal"] = {
      defaultText: `Avg ${round1(sum.avg)} u / day \u00b7 tap a day for details`,
      describe: i => {
        const b = buckets[i];
        if (b.basal <= 0) return `${fmtDay(b.key)} \u00b7 no basal logged`;
        const parts = [];
        if (b.bAm > 0) parts.push(`morning ${round1(b.bAm)}`);
        if (b.bPm > 0) parts.push(`evening ${round1(b.bPm)}`);
        return `${fmtDay(b.key)} \u00b7 ${round1(b.basal)} u basal (${parts.join(" + ")})`;
      }
    };
    const averages = [];
    if (sum.avgAm > 0) averages.push(`Morning avg ${round1(sum.avgAm)} u`);
    if (sum.avgPm > 0) averages.push(`Evening avg ${round1(sum.avgPm)} u`);
    box.innerHTML =
      `<p class="trend-readout">${trendChartCtx["trend-chart-basal"].defaultText}</p>` +
      buildBasalChartSvg(buckets, sum.avg, box.clientWidth || fallbackWidth) +
      `<div class="trend-legend"><span><span class="trend-legend__dot" style="background:#8DB9DE;"></span>Morning</span><span><span class="trend-legend__dot" style="background:#356E9C;"></span>Evening</span></div>` +
      (averages.length ? `<p class="trend-caption trend-caption--tight">${averages.join(" \u00b7 ")}</p>` : "");
  }

  function renderTrends(days) {
    const chartCarbsBox = el("trend-chart-carbs");
    const chartDoseBox = el("trend-chart-dose");
    const statsBox = el("trend-stats");
    const emptyBox = el("trends-empty");
    if (!chartCarbsBox) return; // view not in the DOM yet on first boot
    const cards = ["trend-card-carbs", "trend-card-dose", "trend-card-meals"].map(id => el(id));
    const ratioCard = el("trend-card-ratios");
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
      buckets.push({ key: d.getTime(), carbs: 0, mealCarbs: 0, lowCarbs: 0, meal: 0, corr: 0, dose: 0, entries: 0 });
    }
    const byKey = new Map(buckets.map(b => [b.key, b]));
    const inRange = [];
    state.history.forEach(entry => {
      if (isBasalEntry(entry)) return;   // not a meal or a bolus (same rule as buildTrendBuckets)
      const b = byKey.get(dayKeyFromTs(entry.ts));
      if (!b) return;
      inRange.push(entry);
      b.entries += 1;
      b.carbs += entry.totalCarbs || 0;
      if (entry.noInsulin) b.lowCarbs += entry.totalCarbs || 0; else b.mealCarbs += entry.totalCarbs || 0;
      const c = entry.correctionDose || 0;
      b.meal += (entry.mealDose || 0) + Math.min(0, c);   // a reduction is meal insulin not taken
      b.corr += Math.max(0, c);
    });
    buckets.forEach(b => { b.dose = b.meal + b.corr; });
    // Basal (long-acting) insulin per day, over these same day buckets.
    const bucketKeys = buckets.map(b => b.key);
    const basalMap = basalByDay(state.history, bucketKeys);
    buckets.forEach(b => { const x = basalMap.get(b.key); b.bAm = x.am; b.bPm = x.pm; b.basal = x.total; b.bCount = x.count; });
    const basalSummary = summarizeBasal(basalMap, bucketKeys, buckets[buckets.length - 1].key);

    trendSelectedIdx = null;
    if (inRange.length === 0) {
      cards.forEach(c => { if (c) c.hidden = true; });
      statsBox.innerHTML = "";
      if (captionBox) captionBox.textContent = "";
      chartCarbsBox.innerHTML = "";
      chartDoseBox.innerHTML = "";
      Object.keys(trendChartCtx).forEach(k => delete trendChartCtx[k]);
      // No meals in this period, but basal doses are still worth charting, so only call it empty if there's neither.
      emptyBox.hidden = basalSummary.hasData;
      renderBasalTrend(buckets, basalSummary, 320);
      if (ratioCard) ratioCard.hidden = true;
      if (el("trend-card-ideal")) el("trend-card-ideal").hidden = true;
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
        const split = b.lowCarbs > 0 ? ` (meals ${Math.round(b.mealCarbs)} + low treatment ${Math.round(b.lowCarbs)})` : "";
        return `${fmtDay(b.key)} \u00b7 ${b.carbs > 0 ? Math.round(b.carbs) + " g carbs" + split : "no carbs"} \u00b7 ${b.entries} entr${b.entries === 1 ? "y" : "ies"}`;
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

    const totalCarbsAll = buckets.reduce((s, b) => s + b.carbs, 0), totalLowCarbs = buckets.reduce((s, b) => s + b.lowCarbs, 0);
    const totalMealIns = inRange.reduce((s, e) => s + (e.mealDose || 0) + Math.min(0, e.correctionDose || 0), 0);
    const totalCorrIns = inRange.reduce((s, e) => s + Math.max(0, e.correctionDose || 0), 0);
    const totalIns = totalMealIns + totalCorrIns;
    const corrPct = totalIns > 0 ? Math.round((totalCorrIns / totalIns) * 100) : 0;

    chartCarbsBox.innerHTML =
      `<p class="trend-readout">${trendChartCtx["trend-chart-carbs"].defaultText}</p>` +
      buildCarbsChartSvg(buckets, avgCarbs, width) +
      `<div class="trend-legend"><span><span class="trend-legend__dot" style="background:var(--acc-1);"></span>Meals</span><span><span class="trend-legend__dot" style="background:#E0A100;"></span>Low treatment</span></div>` +
      (totalCarbsAll > 0 ? `<p class="trend-caption trend-caption--tight">${totalLowCarbs > 0 ? `${Math.round(totalLowCarbs)} g of the ${Math.round(totalCarbsAll)} g logged (${Math.round(totalLowCarbs / totalCarbsAll * 100)}%) was eaten to treat lows.` : "No carbs were eaten to treat lows in this period."}</p>` : "");
    chartDoseBox.innerHTML =
      `<p class="trend-readout">${trendChartCtx["trend-chart-dose"].defaultText}</p>` +
      buildDoseChartSvg(buckets, avgDose, width) +
      `<div class="trend-legend"><span><span class="trend-legend__dot" style="background:var(--acc-1);"></span>Meal insulin</span><span><span class="trend-legend__dot" style="background:#C0392B;"></span>Correction</span></div>` +
      (totalIns > 0 ? `<p class="trend-caption trend-caption--tight">Corrections were ${corrPct}% of logged insulin (${round1(totalCorrIns)} of ${round1(totalIns)} u).</p>` : "");

    renderBasalTrend(buckets, basalSummary, width);
    renderTrendMealBreakdown(inRange);
    renderRatioTrend(inRange);
    renderIdealRatioTrend(inRange);
    renderInsights(inRange, days);
  }

  // "Average ratio by time of day": for each of your brackets, the insulin-to-carb ratio actually used in this period.
  function renderRatioTrend(inRange) {
    const card = el("trend-card-ratios"), box = el("trend-ratios");
    if (!card || !box) return;
    const res = ratioByBracket(inRange, state.settings);
    card.hidden = res.total === 0;
    if (res.total === 0) { box.innerHTML = ""; return; }
    const fmt = n => String(round1(n));
    const scale = Math.max(1, ...res.rows.map(r => Math.max(r.max || 0, r.current || 0))) * 1.08;
    box.innerHTML = res.rows.map(r => {
      const pct = v => Math.max(0, Math.min(100, (v / scale) * 100));
      const hours = r.start ? `${escapeHtml(r.start)}\u2013${escapeHtml(r.end)}${daysLabel(r) ? " \u00b7 " + escapeHtml(daysLabel(r)) : ""}` : (r.kind === "activity" ? "activity" : "");
      const colour = r.color && /^#[0-9a-fA-F]{3,8}$/.test(r.color) ? r.color : "var(--acc-1)";
      const used = r.count > 0
        ? `<span class="rtrend__value">1:${fmt(r.avg)}</span><span class="rtrend__n">${r.count} meal${r.count === 1 ? "" : "s"}${r.min !== r.max ? ` \u00b7 range 1:${fmt(r.min)}\u20131:${fmt(r.max)}` : ""}</span>`
        : `<span class="rtrend__value rtrend__value--none">\u2014</span><span class="rtrend__n">no meals</span>`;
      return `<div class="rtrend">
        <div class="rtrend__head"><span class="rtrend__name">${escapeHtml(r.label)}</span><span class="rtrend__hours">${hours}</span></div>
        <div class="rtrend__track" role="img" aria-label="${escapeAttr(r.label)}: ${r.count > 0 ? "average 1:" + fmt(r.avg) : "no meals"}${r.current ? ", currently set to 1:" + fmt(r.current) : ""}">
          ${r.count > 0 ? `<div class="rtrend__bar" style="width:${pct(r.avg)}%;background:${colour};"></div>` : ""}
          ${r.current ? `<div class="rtrend__mark" style="left:${pct(r.current)}%;" title="Currently set to 1:${fmt(r.current)}"></div>` : ""}
        </div>
        <div class="rtrend__figures">${used}</div>
      </div>`;
    }).join("") +
      `<p class="trend-caption trend-caption--tight">Bars show the average grams of carbs per unit of insulin used in each bracket; the tick marks what that bracket is set to now.` +
      (res.unrecorded > 0 ? ` ${res.unrecorded} older meal${res.unrecorded === 1 ? " has" : "s have"} no ratio saved, so ${res.unrecorded === 1 ? "isn't" : "aren't"} counted.` : "") + `</p>`;
  }


  // "Ideal ratio by time of day": the ratio that would have matched each meal if the carbs eaten to treat a low shortly
  // afterwards had been counted into it. The look-back window is the person's choice (2, 3 or 4 hours; 3 by default).
  const IDEAL_WINDOWS = [2, 3, 4], IDEAL_WINDOW_KEY = "insulinBuddy.idealWindowHours";
  let idealWindowHours = 3;
  try { const v = Number(store.getItem(IDEAL_WINDOW_KEY)); if (IDEAL_WINDOWS.includes(v)) idealWindowHours = v; } catch (e) { /* storage unavailable: keep the default */ }
  let lastIdealEntries = [];
  const idealPicker = el("trend-ideal-window");
  if (idealPicker) idealPicker.addEventListener("click", ev => {
    const b = ev.target.closest("[data-hours]"); if (!b) return;
    idealWindowHours = Number(b.dataset.hours);
    try { store.setItem(IDEAL_WINDOW_KEY, String(idealWindowHours)); } catch (e) { /* not essential */ }
    renderIdealRatioTrend(lastIdealEntries);
  });

  function renderIdealRatioTrend(inRange) {
    lastIdealEntries = inRange;
    const card = el("trend-card-ideal"), box = el("trend-ideal");
    if (!card || !box) return;
    const res = idealRatioByBracket(inRange, state.settings, idealWindowHours);
    card.hidden = res.total === 0;
    if (idealPicker) idealPicker.querySelectorAll("[data-hours]").forEach(b => { const on = Number(b.dataset.hours) === idealWindowHours; b.classList.toggle("is-active", on); b.setAttribute("aria-pressed", String(on)); });
    if (res.total === 0) { box.innerHTML = ""; return; }
    const fmt = n => String(round1(n));
    const scale = Math.max(1, ...res.rows.map(r => Math.max(r.used || 0, r.ideal || 0, r.current || 0))) * 1.08;
    const pct = v => Math.max(0, Math.min(100, (v / scale) * 100));
    box.innerHTML = res.rows.map(r => {
      const hours = r.start ? `${escapeHtml(r.start)}\u2013${escapeHtml(r.end)}${daysLabel(r) ? " \u00b7 " + escapeHtml(daysLabel(r)) : ""}` : (r.kind === "activity" ? "activity" : "");
      const colour = r.color && /^#[0-9a-fA-F]{3,8}$/.test(r.color) ? r.color : "var(--acc-1)";
      const figures = r.count === 0
        ? `<span class="rtrend__value rtrend__value--none">\u2014</span><span class="rtrend__n">no meals</span>`
        : `<span class="rtrend__value">1:${fmt(r.ideal)}</span><span class="rtrend__n">${r.affected > 0 ? `was 1:${fmt(r.used)} \u00b7 ${r.affected} of ${r.count} meal${r.count === 1 ? "" : "s"} followed by a low` : `same as used \u00b7 no lows after ${r.count === 1 ? "this meal" : "these " + r.count + " meals"}`}</span>`;
      return `<div class="rtrend">
        <div class="rtrend__head"><span class="rtrend__name">${escapeHtml(r.label)}</span><span class="rtrend__hours">${hours}</span></div>
        <div class="rtrend__track rtrend__track--double" role="img" aria-label="${escapeAttr(r.label)}: ${r.count > 0 ? "ideal 1:" + fmt(r.ideal) + ", used 1:" + fmt(r.used) : "no meals"}">
          ${r.count > 0 ? `<div class="rtrend__bar rtrend__bar--used" style="width:${pct(r.used)}%;background:${colour};"></div><div class="rtrend__bar rtrend__bar--ideal" style="width:${pct(r.ideal)}%;background:${colour};"></div>` : ""}
          ${r.current ? `<div class="rtrend__mark" style="left:${pct(r.current)}%;" title="Currently set to 1:${fmt(r.current)}"></div>` : ""}
        </div>
        <div class="rtrend__figures">${figures}</div>
      </div>`;
    }).join("") +
      `<div class="trend-legend"><span><span class="trend-legend__dot" style="background:var(--ink-soft);opacity:.45;"></span>Used</span><span><span class="trend-legend__dot" style="background:var(--ink-soft);"></span>Ideal</span><span><span class="trend-legend__tick"></span>Set now</span></div>` +
      `<p class="trend-caption trend-caption--tight">${res.lowsCounted > 0 ? `${res.lowsCounted} low${res.lowsCounted === 1 ? "" : "s"} treated within ${res.windowHours} h of an injection (${round1(res.rescueCarbs)} g) counted into the meal before ${res.lowsCounted === 1 ? "it" : "them"}.` : `No lows were treated within ${res.windowHours} h of an injection in this period, so the ideal ratio equals the ratio used.`}` +
      (res.lowsUnattached > 0 ? ` ${res.lowsUnattached} other low${res.lowsUnattached === 1 ? "" : "s"} had no ratio-dosed meal in the window, so ${res.lowsUnattached === 1 ? "isn't" : "aren't"} counted.` : "") +
      ` A longer ratio number means less insulin per gram of carbs. This is a pattern to talk through with your care team, not a dosing instruction.</p>`;
  }


  // ---- Glucose insights (Trends): patterns from stored CGM readings around the logged meals ----
  // All of these read the same data the Glucose tab does (stored Nightscout readings) and never change anything.
  let insightsToken = 0;
  let insightsCurveGroup = "All meals";
  let lastInsights = null; // { entries, readings, days } so a bracket button can redraw without refetching
  const fmtGlu = v => v == null || !Number.isFinite(v) ? "—" : (state.settings.units === "mmol" ? String(round1(convertGlucose(v, "mgdl", "mmol"))) : String(Math.round(v)));
  const gluUnit = () => (state.settings.units === "mmol" ? "mmol/L" : "mg/dL");
  const pctTxt = v => (v == null ? "—" : Math.round(v) + "%");
  const insCard = (title, hint, body) => `<div class="panel-card ins-card"><h2 class="panel-card__title">${title}</h2>${hint ? `<p class="trend-caption trend-caption--tight" style="margin-top:-4px;">${hint}</p>` : ""}${body}</div>`;

  async function renderInsights(inRange, days) {
    const box = el("trend-insights");
    if (!box) return;
    const token = ++insightsToken;
    if (!inRange.length) { box.innerHTML = ""; return; }
    box.innerHTML = `<h3 class="ins-heading">Glucose insights</h3><p class="trend-caption">Loading your glucose readings…</p>`;
    const result = await fetchStoredGlucoseReadings(days);
    if (token !== insightsToken) return; // a newer render took over
    if (!result.ok || !result.readings.length) {
      box.innerHTML = `<h3 class="ins-heading">Glucose insights</h3><p class="trend-caption">${escapeHtml(result.reason || "No stored glucose readings for this period yet.")} These cards compare your meals with what your glucose did afterwards.</p>`;
      return;
    }
    lastInsights = { entries: inRange, readings: result.readings, days };
    drawInsights();
  }

  function insCurveSvg(group, hours) {
    const W = Math.max(280, Math.min(640, (el("trend-insights").clientWidth || 340) - 8)), H = 190, L = 34, R = 8, T = 8, B = 22;
    const pts = group.points.filter(p => p.p50 != null);
    if (pts.length < 2) return `<p class="trend-caption">Not enough readings after these meals yet.</p>`;
    const vals = pts.flatMap(p => [p.p25, p.p50, p.p75]).filter(v => v != null).concat([70, 180]);
    const lo = Math.floor((Math.min(...vals) - 5) / 10) * 10, hi = Math.ceil((Math.max(...vals) + 5) / 10) * 10;
    const x = m => L + (m / (hours * 60)) * (W - L - R), y = v => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
    const band = pts.filter(p => p.p25 != null && p.p75 != null);
    const area = band.length > 1 ? `<path d="M${band.map(p => `${x(p.minute).toFixed(1)},${y(p.p75).toFixed(1)}`).join(" L")} L${band.slice().reverse().map(p => `${x(p.minute).toFixed(1)},${y(p.p25).toFixed(1)}`).join(" L")} Z" fill="var(--acc-1)" opacity="0.18"/>` : "";
    const line = `<path d="M${pts.map(p => `${x(p.minute).toFixed(1)},${y(p.p50).toFixed(1)}`).join(" L")}" fill="none" stroke="var(--acc-1)" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>`;
    const target = `<rect x="${L}" y="${y(180).toFixed(1)}" width="${W - L - R}" height="${(y(70) - y(180)).toFixed(1)}" fill="#2E9E6B" opacity="0.10"/>`;
    const xt = []; for (let h = 0; h <= hours; h++) xt.push(`<text x="${x(h * 60).toFixed(1)}" y="${H - 6}" text-anchor="middle" font-size="10" fill="var(--ink-soft)">${h}h</text>`);
    const yt = [lo, Math.round((lo + hi) / 2 / 10) * 10, hi].map(v => `<text x="${L - 4}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end" font-size="10" fill="var(--ink-soft)">${fmtGlu(v)}</text><line x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="var(--line, rgba(128,128,128,.25))" stroke-width="0.6"/>`);
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Typical glucose after a meal, ${escapeAttr(group.label)}">${target}${yt.join("")}${area}${line}${xt.join("")}</svg>`;
  }

  function drawInsights() {
    const box = el("trend-insights");
    if (!box || !lastInsights) return;
    const { entries, readings } = lastInsights;
    const cards = [];

    // 1. Glucose after meals
    const cur = postMealCurves(entries, readings, { hours: 4, stepMin: 15 });
    if (cur.groups.length) {
      if (!cur.groups.some(g => g.label === insightsCurveGroup)) insightsCurveGroup = "All meals";
      const g = cur.groups.find(x => x.label === insightsCurveGroup);
      const btns = cur.groups.map(x => `<button type="button" class="glucose-range-btn${x.label === insightsCurveGroup ? " is-active" : ""}" data-insgroup="${escapeAttr(x.label)}">${escapeHtml(x.label)} <small>${x.count}</small></button>`).join("");
      cards.push(insCard("Glucose after meals", "The typical curve for the 4 hours after an injection: the line is the median, the shaded band the middle half of meals, the green strip your target range.",
        `<div class="ideal-window ins-groups">${btns}</div>${insCurveSvg(g, cur.hours)}<p class="trend-caption trend-caption--tight">${g.count} meal${g.count === 1 ? "" : "s"}${g.enough ? "" : " — too few to trust the shape yet"}. Starting reading: ${fmtGlu(g.points[0].p50)} ${gluUnit()}; highest typical reading ${fmtGlu(Math.max(...g.points.map(p => p.p50 || 0)))} ${gluUnit()}.</p>`));
    }

    // 2. Outcome by bracket
    const out = outcomeByBracket(entries, readings, { afterHours: 3 });
    if (out.total) {
      const row = r => `<div class="ins-row"><div class="ins-row__head"><span class="rtrend__name">${escapeHtml(r.label)}</span><span class="rtrend__n">${r.n} meal${r.n === 1 ? "" : "s"} · avg ${fmtGlu(r.avgStart)} → ${fmtGlu(r.avgEnd)}</span></div>
        <div class="ins-bar" role="img" aria-label="${escapeAttr(r.label)}: ${r.low} low, ${r.inRange} in range, ${r.high} high"><span class="ins-bar__low" style="width:${(r.low / r.n) * 100}%"></span><span class="ins-bar__in" style="width:${(r.inRange / r.n) * 100}%"></span><span class="ins-bar__high" style="width:${(r.high / r.n) * 100}%"></span></div>
        <div class="rtrend__n">${pctTxt((r.low / r.n) * 100)} low · ${pctTxt((r.inRange / r.n) * 100)} in range · ${pctTxt((r.high / r.n) * 100)} high${r.anyLow ? ` · ${r.anyLow} dipped below 70 at some point` : ""}</div></div>`;
      cards.push(insCard("Where glucose is 3 hours after a meal", "Per ratio bracket: how many meals ended low (under 70 mg/dL), in range, or high (over 180).",
        out.rows.map(row).join("") + (out.rows.length > 1 ? row(out.all) : "") + `<div class="trend-legend"><span><span class="trend-legend__dot" style="background:#D9534F;"></span>Low</span><span><span class="trend-legend__dot" style="background:#2E9E6B;"></span>In range</span><span><span class="trend-legend__dot" style="background:#E0A100;"></span>High</span></div>`));
    }

    // 3. Foods to watch
    const foods = foodImpact(entries, readings, { minMeals: 2 });
    if (foods.rows.length) {
      const li = r => `<li><span class="ins-li__name">${escapeHtml(r.name)}</span><span class="ins-li__val">+${fmtGlu(r.avgRise)} ${gluUnit()}</span><span class="rtrend__n">${r.n} meals · peak ${fmtGlu(r.avgPeak)}${r.lowPct ? ` · low after ${pctTxt(r.lowPct)}` : ""}</span></li>`;
      cards.push(insCard("Foods to watch", "Average rise (highest reading in the 3 hours minus the starting reading) for foods that made up most of a meal's carbs. Needs at least 2 such meals.",
        `<ol class="ins-list">${foods.biggestRise.map(li).join("")}</ol>` + (foods.mostLows.length ? `<p class="trend-caption trend-caption--tight"><b>Lows afterwards:</b> ${foods.mostLows.map(r => `${escapeHtml(r.name)} (${pctTxt(r.lowPct)} of ${r.n})`).join(", ")}.</p>` : "")));
    }

    // 4. Correction effectiveness
    const isf = isfToMgdl(state.settings.isf, state.settings.units);
    const cor = correctionEffectiveness(entries, readings, { isfMgdl: isf });
    if (cor.n) {
      const eff = cor.medianPerUnit;
      cards.push(insCard("How well corrections work", "Corrections given on their own, with no food or other insulin within the following 4 hours: how far glucose fell per unit by 3 hours later.",
        `<div class="ins-big"><span class="ins-big__num">${fmtGlu(eff)}</span><span class="ins-big__unit">${gluUnit()} per unit (median of ${cor.n})</span></div>
         <p class="trend-caption trend-caption--tight">Your correction factor is set to ${fmtGlu(isf)} ${gluUnit()} per unit${isf && eff != null ? `, so corrections have been ${eff > isf * 1.15 ? "stronger" : eff < isf * 0.85 ? "weaker" : "close to"} than set${eff > isf * 1.15 || eff < isf * 0.85 ? ` (${Math.round((eff / isf) * 100)}% of it)` : ""}` : ""}.</p>
         <ul class="ins-list ins-list--plain">${cor.events.slice(0, 5).map(ev => `<li><span class="ins-li__name">${new Date(ev.ts).toLocaleDateString(undefined, { day: "numeric", month: "short" })} · ${round1(ev.units)} u</span><span class="ins-li__val">${fmtGlu(ev.start)} → ${fmtGlu(ev.end)}</span></li>`).join("")}</ul>`));
    }

    // 5. Stacking
    const stk = iobStacking(entries, readings);
    if (stk.stacked.n && stk.clean.n) {
      const col = (t, s) => `<div class="ins-col"><div class="ins-col__title">${t}</div><div class="ins-col__num">${fmtGlu(s.avgEnd)}</div><div class="rtrend__n">avg at 3 h · ${s.n} meals</div><div class="rtrend__n">${pctTxt(s.lowPct)} dipped low · ${pctTxt(s.highPct)} high</div></div>`;
      cards.push(insCard("Meals taken with insulin still active", `Meals eaten within ${stk.windowHours} hours of an earlier dose, compared with meals taken with no recent insulin.`,
        `<div class="ins-cols">${col("Insulin still active", stk.stacked)}${col("No recent insulin", stk.clean)}</div><p class="trend-caption trend-caption--tight">Stacked meals had on average ${round1(stk.stacked.avgPriorUnits)} u from earlier doses still working.</p>`));
    }

    // 6. Overnight
    const ov = overnightStats(entries, readings);
    if (ov.n) {
      const sign = v => (v > 0 ? "+" : v < 0 ? "−" : "") + fmtGlu(Math.abs(v));
      cards.push(insCard("Overnight (00:00–06:00)", "Quiet nights only: no food or mealtime insulin in the 3 hours before midnight or during the night.",
        `<div class="ins-cols"><div class="ins-col"><div class="ins-col__title">Average drift</div><div class="ins-col__num">${sign(ov.avgDrift)}</div><div class="rtrend__n">${gluUnit()} by 06:00 · ${ov.n} nights</div></div><div class="ins-col"><div class="ins-col__title">Nights with a low</div><div class="ins-col__num">${ov.lowNights}</div><div class="rtrend__n">of ${ov.n}</div></div></div>` +
        (ov.byBasal.length > 1 ? `<ul class="ins-list ins-list--plain">${ov.byBasal.map(b => `<li><span class="ins-li__name">Basal ${round1(b.dose)} u</span><span class="ins-li__val">${sign(b.avgDrift)} ${gluUnit()}</span><span class="rtrend__n">${b.n} nights${b.lows ? ` · ${b.lows} with a low` : ""}</span></li>`).join("")}</ul>` : `<p class="trend-caption trend-caption--tight">Log basal doses in more than one amount to compare how the night went for each.</p>`)));
    }

    // 7. Weekday vs weekend, and activity
    const wk = weekdayWeekend(entries, readings, state.settings);
    if (wk.weekday.days && wk.weekend.days) {
      const col = (t, s) => `<div class="ins-col"><div class="ins-col__title">${t}</div><div class="ins-col__num">${s.carbsPerDay == null ? "—" : Math.round(s.carbsPerDay)} g</div><div class="rtrend__n">carbs a day · ${s.days} day${s.days === 1 ? "" : "s"}</div><div class="rtrend__n">${s.insulinPerDay == null ? "—" : round1(s.insulinPerDay)} u a day · ${s.mealsPerDay == null ? "—" : round1(s.mealsPerDay)} meals</div><div class="rtrend__n">${s.avgRatio ? "avg ratio 1:" + round1(s.avgRatio) : ""}</div><div class="rtrend__n">${s.n3h ? "3 h after: avg " + fmtGlu(s.avg3h) + ", " + pctTxt(s.lowPct) + " low, " + pctTxt(s.highPct) + " high" : "no glucose data"}</div></div>`;
      cards.push(insCard("Weekdays vs weekends", "", `<div class="ins-cols">${col("Weekdays", wk.weekday)}${col("Weekends", wk.weekend)}</div>`));
    }
    if (wk.activity.length && wk.everyday.n) {
      const ar = r => `<li><span class="ins-li__name">${escapeHtml(r.label)}</span><span class="ins-li__val">1:${round1(r.avgRatio)}</span><span class="rtrend__n">${r.n} meals${r.n3h ? ` · 3 h after avg ${fmtGlu(r.avg3h)}, ${pctTxt(r.lowPct)} low` : ""}</span></li>`;
      cards.push(insCard("Activity ratios vs everyday", "How meals logged with an activity ratio compare with ones at your everyday time-of-day ratios.",
        `<ul class="ins-list ins-list--plain"><li><span class="ins-li__name">Everyday</span><span class="ins-li__val">1:${round1(wk.everyday.avgRatio)}</span><span class="rtrend__n">${wk.everyday.n} meals${wk.everyday.n3h ? ` · 3 h after avg ${fmtGlu(wk.everyday.avg3h)}, ${pctTxt(wk.everyday.lowPct)} low` : ""}</span></li>${wk.activity.map(ar).join("")}</ul>`));
    }

    box.innerHTML = `<h3 class="ins-heading">Glucose insights</h3>` + (cards.length ? cards.join("") + `<p class="trend-caption">These describe what happened after past meals and doses. They are patterns to talk through with your care team, not dosing instructions.</p>` : `<p class="trend-caption">Not enough overlap between logged meals and glucose readings in this period yet. Insights need readings around each meal (the Nightscout history that Insulin Buddy stores).</p>`);
  }
  document.addEventListener("click", e => {
    const b = e.target.closest && e.target.closest("[data-insgroup]");
    if (!b) return;
    insightsCurveGroup = b.dataset.insgroup;
    drawInsights();
  });

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
      renderRecentMeals();
      showUndoToast(isBasalEntry(removed) ? "Basal dose deleted" : "Meal deleted", () => {
        state.history.splice(idx, 0, removed);
        saveState();
        undoNsDelete(removed);
        renderHistory();
        renderActivePanel();
        renderRecentMeals();
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
      if (entry) (isBasalEntry(entry) ? openBasalSheet : openEditMealSheet)(entry);
      return;
    }
    const row = e.target.closest(".history-entry");
    if (!row) return;
    const detail = row.querySelector(".history-entry__detail");
    const summary = row.querySelector(".history-entry__foods");
    detail.hidden = !detail.hidden;
    summary.hidden = !detail.hidden;
  });

  // Recently logged meals: one-tap re-add for the repeats that make up most real usage
  // (the same handful of breakfasts/snacks over and over) -- reuses useMealAgain below,
  // the same path History's own "repeat this meal" button already takes.
  function renderRecentMeals() {
    const meals = state.settings.showRecentMeals === false ? [] : recentDistinctMeals(state.history, 6);
    el("recent-meals-header").hidden = meals.length === 0;
    el("recent-meals-row").hidden = meals.length === 0;
    el("recent-meals-row").innerHTML = meals.map(entry => `
      <button class="recent-meal-chip" data-id="${escapeAttr(entry.id)}" type="button">
        <span class="recent-meal-chip__name">${escapeHtml(mealLabel(entry))}</span>
        <span class="recent-meal-chip__meta">${round1(entry.totalCarbs)}g carbs</span>
      </button>
    `).join("");
  }
  bind("recent-meals-row", "click", e => {
    const chip = e.target.closest(".recent-meal-chip");
    if (!chip) return;
    const entry = state.history.find(h => h.id === chip.dataset.id);
    if (entry) useMealAgain(entry);
  });

  function useMealAgain(entry) {
    if (isBasalEntry(entry)) return;   // a basal dose isn't a meal; nothing to put back in the calculator
    // Not a question: do it, and offer Undo (the previous calculator contents come straight back).
    const hadWork = !draftIsEmpty();
    const previous = hadWork ? snapshotDraft() : null;
    draft = {
      items: entry.items.map(i => ({
        refType: i.refType, refId: i.refId, name: i.name, grams: i.grams,
        quantity: i.quantity ?? null, unitLabel: i.unitLabel ?? null, gramsPerUnit: i.gramsPerUnit ?? null,
        carbsPer100g: i.carbsPer100g, kcalPer100g: i.kcalPer100g, gi: i.gi ?? null, carbs: i.carbs, kcal: i.kcal
      })),
      correctionOn: false, correctionManual: false, noInsulinOn: false, eatingOutOn: false, glucose: "", glucoseUnit: null, manualRatioId: null
    };
    searchInput.value = ""; searchClearBtn.hidden = true; gramsInput.value = ""; gramsInput.disabled = false;
    glucoseInput.value = ""; correctionToggle.classList.remove("is-active"); correctionRow.hidden = true;
    // These two weren't being reset here before (a pre-existing gap, not new): switching to a
    // past meal while Treating a Low was active left its pill looking on even though the fresh
    // draft had already turned it off underneath.
    el("cc-no-insulin-toggle").classList.remove("is-active"); el("cc-no-insulin-note").hidden = true; el("quick-carb-row").hidden = true;
    el("cc-eating-out-toggle").classList.remove("is-active"); el("cc-eating-out-note").hidden = true;
    el("cc-eating-out-row").hidden = true; el("cc-eating-out-dose").value = ""; el("cc-food-section").hidden = false;
    ratioPicker.hidden = true; selectedPickId = null;
    renderFoodPickList(); renderMealItems(); recompute();
    showView("calculator");
    if (previous) showUndoToast("Calculator replaced", () => { resetDraft(); restoreDraftSnapshot(previous); });
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
    // What the entry IS: a meal that was injected for, a correction on its own, or carbs taken to treat a low (no insulin).
    // The person can change it after the fact (a "meal" that was really a treated low, say) without deleting and re-entering.
    // An Eating Out entry is insulin taken for food whose carbs were never counted: it keeps its own kind, so editing it
    // never runs the "needs at least one item" check or recalculates the dose from its 0 g of carbs.
    const wasEatOut = !!entry.carbsUnknown;
    let kind = entry.noInsulin ? "low" : entry.mealType === "correction" ? "correction" : wasEatOut ? "eatout" : "meal";
    let lastMealType = entry.mealType === "correction" ? "snack" : entry.mealType;
    const entryTotalDose = Math.max(0, (Number(entry.mealDose) || 0) + (Number(entry.correctionDose) || 0));

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
        <label class="block-label">This entry is</label>
        <div class="segmented" id="em-kind" role="group" aria-label="What this entry is">
          <button type="button" class="segmented__btn" data-kind="meal">Meal dose</button>
          <button type="button" class="segmented__btn" data-kind="correction">Correction</button>
          <button type="button" class="segmented__btn" data-kind="low">Treated low</button>
          ${wasEatOut ? `<button type="button" class="segmented__btn" data-kind="eatout">Eating out</button>` : ""}
        </div>
        <p class="panel-card__hint" id="em-kind-hint" style="margin-top:-6px;margin-bottom:14px;"></p>
        <div class="field">
          <label for="em-logged-time">Logged time</label>
          <input type="datetime-local" id="em-logged-time" value="${toDatetimeLocalValue(entry.ts)}" style="padding:12px 14px; border:1.5px solid var(--line); border-radius:var(--radius-s); font-size:16px; background:var(--surface); color:var(--ink); font-family:var(--font-ui);">
          <p class="panel-card__hint" style="margin-top:6px;">Changing this updates Active Insulin &amp; Carbs and Trends to match.</p>
        </div>
        <div class="field" id="em-eatout-field" hidden>
          <label for="em-eatout-dose">Insulin taken</label>
          <div class="field__row"><input type="text" id="em-eatout-dose" inputmode="decimal" autocomplete="off" value="${round1(Number(entry.mealDose) || 0)}"><span class="field__unit">units</span></div>
        </div>
        <div class="field" id="em-corr-field" hidden>
          <label for="em-corr-dose">Correction dose</label>
          <div class="field__row"><input type="number" id="em-corr-dose" min="0" step="0.5" inputmode="decimal" value="${round1(entry.mealType === "correction" ? (Number(entry.correctionDose) || 0) : entryTotalDose)}"><span class="field__unit">units</span></div>
        </div>
        <div id="em-meal-part">
        <label class="block-label">Meal type</label>
        <div class="field-grid" id="em-meal-types" style="margin-bottom:18px;">
          ${Object.entries(MEAL_TYPES).map(([key, m]) => `
            <button class="btn btn--secondary" data-meal="${escapeAttr(key)}" type="button" style="display:flex;align-items:center;gap:8px;justify-content:center;${key === mealType ? `border-color:${m.color};color:${m.color};background:${m.color}1a;` : ""}">
              <span style="color:${m.color};width:18px;height:18px;">${m.icon}</span>${m.label}
            </button>
          `).join("")}
        </div>
        <label class="block-label" id="em-ratio-label">Insulin ratio</label>
        <select id="em-ratio" style="width:100%; padding:12px 14px; border:1.5px solid var(--line); border-radius:var(--radius-s); font-size:0.96rem; margin-bottom:18px; background:var(--surface); color:var(--ink);">
          ${!matchedRatio ? `<option value="__original__" selected>Original: ${escapeHtml(entry.ratioLabel || "—")} (1:${entry.ratioValue})</option>` : ""}
          ${allRatios.map(r => `<option value="${escapeAttr(r.id)}" ${matchedRatio && matchedRatio.id === r.id ? "selected" : ""}>${escapeHtml(r.name)} (1:${r.ratio})</option>`).join("")}
        </select>
        <div id="em-items-part">
        <label class="block-label">Items</label>
        <div id="em-items" class="ingredient-list" style="margin-bottom:16px;"></div>
        </div>
        </div>
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

    // ONE calculation for both the preview and the save, so the preview can never promise a dose that saving then
    // stores differently. (It used to cap the number it showed but save the uncapped parts: preview 15.0u, stored
    // 19.5u -- and re-saving an already-capped meal would have quietly put the 19.5u back.)
    // Eating Out: the units typed here, through the same dose plan (no ratio, so the typed meal units are used as they are).
    function eatOutUnits() { const v = parseDecimalInput(backdrop.querySelector("#em-eatout-dose").value); return isNaN(v) ? NaN : v; }
    function eatOutParts() {
      const glucoseEl = backdrop.querySelector("#em-glucose");
      const plan = planEditDose({ entry: { ...entry, noInsulin: false, mealDose: Math.max(0, eatOutUnits() || 0) }, totalCarbs: 0, ratio: 0, glucoseText: glucoseEl ? glucoseEl.value : null, settings: state.settings });
      return { meal: plan.mealDose, correction: plan.correctionDose, total: plan.finalDose, requested: plan.requested, capped: plan.capped, overMax: plan.overMax };
    }
    function editDoseParts(totalCarbs) {
      const glucoseEl = backdrop.querySelector("#em-glucose");
      const plan = planEditDose({ entry: { ...entry, noInsulin: kind === "low" }, totalCarbs, ratio: selectedRatioValue, glucoseText: glucoseEl ? glucoseEl.value : null, settings: state.settings });
      return { meal: plan.mealDose, correction: plan.correctionDose, total: plan.finalDose, requested: plan.requested, capped: plan.capped, overMax: plan.overMax };
    }

    const KIND_HINTS = {
      meal: "Insulin for the food below, worked out from the ratio.",
      correction: "Insulin on its own to bring glucose down, with no food. Any food on the entry is removed.",
      low: "Carbs eaten to treat a low. They are logged, but no insulin is recorded.",
      eatout: "Insulin taken for a meal eaten out. Carbs weren't counted, so the dose is kept as you entered it."
    };
    function applyKind() {
      backdrop.querySelectorAll("#em-kind [data-kind]").forEach(b => { const on = b.dataset.kind === kind; b.classList.toggle("is-active", on); b.setAttribute("aria-pressed", on); });
      backdrop.querySelector("#em-kind-hint").textContent = KIND_HINTS[kind];
      backdrop.querySelector("#em-corr-field").hidden = kind !== "correction";
      backdrop.querySelector("#em-meal-part").hidden = kind === "correction";
      backdrop.querySelector("#em-eatout-field").hidden = kind !== "eatout";
      backdrop.querySelector("#em-items-part").hidden = kind === "eatout";
      backdrop.querySelectorAll("#em-meal-types button").forEach(b => {
        const m = MEAL_TYPES[b.dataset.meal], on = b.dataset.meal === mealType;
        b.style.borderColor = on ? m.color : ""; b.style.color = on ? m.color : ""; b.style.background = on ? m.color + "1a" : "";
        b.hidden = b.dataset.meal === "correction";             // "Correction" is now picked above, not as a meal type
      });
      const ratioLabel = backdrop.querySelector("#em-ratio-label"), ratioSel = backdrop.querySelector("#em-ratio");
      if (ratioLabel) ratioLabel.hidden = kind !== "meal"; ratioSel.hidden = kind !== "meal";
      updatePreview();
    }

    function updatePreview() {
      if (kind === "eatout") {
        const u = eatOutUnits();
        if (isNaN(u)) { backdrop.querySelector("#em-preview").textContent = "That isn't a number I can read. Try something like 1.5 or 1,5"; return; }
        const parts = eatOutParts();
        const capText = parts.capped ? ` — capped at your ${state.settings.maxDose} u maximum (entered ${parts.requested} u)` : "";
        backdrop.querySelector("#em-preview").textContent = `Saved as eating out: ${parts.total.toFixed(1)} units, carbs not logged.${capText}`;
        return;
      }
      if (kind === "correction") {
        const d = parseFloat(backdrop.querySelector("#em-corr-dose").value) || 0;
        backdrop.querySelector("#em-preview").textContent = `Saved as a correction of ${round1(d)} units, no food.`;
        return;
      }
      if (kind === "low") {
        const c = round1(items.reduce((s, i) => s + i.carbs, 0));
        backdrop.querySelector("#em-preview").textContent = `Saved as treating a low: ${c}g carbs, no insulin.`;
        return;
      }
      const totalCarbs = round1(items.reduce((s, i) => s + i.carbs, 0));
      const parts = editDoseParts(totalCarbs);
      const capText = parts.capped ? ` — capped at your ${state.settings.maxDose} u maximum (calculated ${parts.requested} u)`
        : parts.overMax ? ` — above your ${state.settings.maxDose} u maximum` : "";
      backdrop.querySelector("#em-preview").textContent =
        `New total: ${round1(totalCarbs)}g carbs → ${parts.total.toFixed(1)} units` +
        (selectedRatioValue ? ` (using ${selectedRatioLabel ? escapeHtml(selectedRatioLabel) + " " : ""}1:${selectedRatioValue})` : "") + capText;
    }

    backdrop.querySelector("#em-meal-types").addEventListener("click", e => {
      const btn = e.target.closest("[data-meal]");
      if (!btn || btn.dataset.meal === "correction") return;
      mealType = lastMealType = btn.dataset.meal;
      applyKind();
    });
    backdrop.querySelector("#em-kind").addEventListener("click", e => {
      const btn = e.target.closest("[data-kind]");
      if (!btn || btn.dataset.kind === kind) return;
      kind = btn.dataset.kind;
      mealType = kind === "correction" ? "correction" : lastMealType;
      applyKind();
    });
    backdrop.querySelector("#em-corr-dose").addEventListener("input", updatePreview);
    backdrop.querySelector("#em-eatout-dose").addEventListener("input", updatePreview);
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
    applyKind();
    backdrop.addEventListener("click", e => { if (e.target === backdrop || e.target.id === "em-cancel" || e.target.closest("#em-close")) closeSheet(backdrop); });
    backdrop.querySelector("#em-save").addEventListener("click", async () => {
      if (kind === "eatout" && isNaN(eatOutUnits())) { dialogs.alert("Enter the insulin you took, in units (for example 1.5 or 1,5)."); return; }
      if (items.length === 0 && kind !== "correction" && kind !== "eatout") { dialogs.alert(kind === "low" ? "A treated low needs the food or drink you had — add an item, or delete the entry." : "A meal needs at least one item — delete it instead if you want it gone."); return; }
      let corrDose = 0;
      if (kind === "correction") {
        corrDose = parseFloat(backdrop.querySelector("#em-corr-dose").value);
        if (!(corrDose >= 0)) { dialogs.alert("Enter the correction dose in units."); return; }
        if (items.length && entry.mealType !== "correction" && !(await dialogs.confirm("Saving as a correction removes the food from this entry and keeps only the insulin.", { title: "Turn into a correction?", confirmText: "Turn into correction" }))) return;
      }
      const before = structuredClone(entry);
      const totalCarbs = round1(items.reduce((s, i) => s + i.carbs, 0));
      const totalKcal = Math.round(items.reduce((s, i) => s + (i.kcal || 0), 0));
      // The same calculation the preview just showed, so what it promised is what gets saved.
      const parts = kind === "eatout" ? eatOutParts() : editDoseParts(totalCarbs);
      const mealDose = parts.meal;
      const correctionDose = parts.correction;
      const glucoseInputEl2 = backdrop.querySelector("#em-glucose");
      let newGlucose = entry.glucose;
      if (glucoseInputEl2) newGlucose = parseFloat(glucoseInputEl2.value) || null;
      entry.mealType = mealType;
      if (kind === "correction") {
        // insulin on its own: no food, no carbs, no ratio
        entry.items = []; entry.totalCarbs = 0; entry.totalKcal = 0;
        entry.mealDose = 0; entry.correctionDose = round1(corrDose);
        delete entry.cappedFrom; delete entry.noInsulin; delete entry.carbsUnknown; delete entry.eatingOut;
        delete entry.ratioValue; delete entry.ratioLabel; delete entry.periodName; delete entry.glycemicLoad;
        entry.glucose = newGlucose;
      } else if (kind === "eatout") {
        // still Eating Out: no food list, carbs not counted, the typed insulin kept
        entry.items = []; entry.totalCarbs = 0; entry.totalKcal = 0; entry.glycemicLoad = null;
        entry.carbsUnknown = true; delete entry.noInsulin;
        entry.mealDose = mealDose; entry.correctionDose = correctionDose;
        if (parts.capped) entry.cappedFrom = parts.requested; else delete entry.cappedFrom;
        entry.glucose = newGlucose;
      } else {
        entry.items = items;
        entry.totalCarbs = totalCarbs;
        entry.totalKcal = totalKcal;
        entry.mealDose = mealDose;
        entry.correctionDose = correctionDose;
        if (kind === "low") entry.noInsulin = true; else delete entry.noInsulin;
        if (parts.capped) entry.cappedFrom = parts.requested; else delete entry.cappedFrom;
        entry.glucose = newGlucose;
        entry.ratioValue = selectedRatioValue;
        entry.ratioLabel = selectedRatioLabel;
        entry.glycemicLoad = compoundGiInfo(items);   // was left stale, which skewed carb absorption after an edit
      }
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
      renderRecentMeals();
      closeSheet(backdrop);
      showUndoToast(kind === "correction" ? "Saved as a correction" : kind === "low" ? "Saved as treating a low" : kind === "eatout" ? "Eating out updated" : "Meal updated", () => {
        for (const k of Object.keys(entry)) delete entry[k];
        Object.assign(entry, before);
        state.history.sort((a, b) => b.ts - a.ts);
        saveState(); queueNsUpdate(entry);
        renderHistory(); renderActivePanel(); renderRecentMeals();
      });
    });
  }

  // ================= Settings =================
  let settingsSeg = "ratios";
  const settingsSegmented = el("settings-segmented");
  const panelRatios = el("panel-ratios");
  const panelLibrary = el("panel-library");
  const panelSync = el("panel-sync");
  const panelData = el("panel-data");
  const panelGeneral = el("panel-general");

  settingsSegmented.addEventListener("click", e => {
    const btn = e.target.closest(".segmented__btn");
    if (!btn) return;
    settingsSeg = btn.dataset.seg;
    settingsSegmented.querySelectorAll(".segmented__btn").forEach(b => b.classList.toggle("is-active", b === btn));
    showSettingsPanel();
    if (settingsSeg === "library") renderLibrary();
    if (settingsSeg === "sync") { renderNightscoutSection(); renderStatusPanel(); }
  });
  // Other screens (the Calculator's Browse sheet) open Settings straight on a given panel.
  function openSettingsPanel(seg) {
    settingsSeg = seg;
    settingsSegmented.querySelectorAll(".segmented__btn").forEach(b => b.classList.toggle("is-active", b.dataset.seg === seg));
    showView("settings");
    if (seg === "library") renderLibrary();
  }
  function showSettingsPanel() {
    panelRatios.hidden = settingsSeg !== "ratios";
    panelLibrary.hidden = settingsSeg !== "library";
    panelSync.hidden = settingsSeg !== "sync";
    panelData.hidden = settingsSeg !== "data";
    panelGeneral.hidden = settingsSeg !== "general";
  }

  function renderSettings() {
    if (el("set-check-after")) el("set-check-after").value = String(Number(state.settings.checkAfterHours) || 0);
    showSettingsPanel();
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
    el("show-recent-meals-toggle").checked = state.settings.showRecentMeals !== false;
    el("dark-mode-auto-toggle").checked = state.settings.darkModeAuto;
    renderAccountSection();
    renderNightscoutSection();
    renderBackupsSection();
    renderDiagSection();

    renderPrivacySection();
  }

  const BG_PRESETS = ["#F4F5F7", "#E1EDF7", "#EDE5F5", "#E5EFE7", "#F7E8E6", "#E7E9EC"];


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
  bind("backups-list", "click", e => {
    const btn = e.target.closest("[data-restore]");
    if (btn) restoreSnapshot(Number(btn.dataset.restore));
  });
  bind("btn-backup-now", "click", async () => {
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
  async function diagContext() {
    let nsHost = "not set up";
    try { if (nightscoutConfigured()) nsHost = new URL(nightscoutBaseUrl()).host; } catch (e) { nsHost = "invalid URL"; }
    const sw = "serviceWorker" in navigator ? (navigator.serviceWorker.controller ? "controlled" : "not controlling") : "unsupported";
    let glucoseRows = "n/a (signed out)";
    if (supabaseClient && currentUser) {
      try {
        const { count, error } = await supabaseClient.from("glucose_readings").select("*", { count: "exact", head: true }).eq("user_id", currentUser.id);
        glucoseRows = error ? `error: ${error.message}` : String(count);
      } catch (e) { glucoseRows = `error: ${(e && e.message) || e}`; }
    }
    return {
      version: CHANGELOG[0].version,
      "schema": SCHEMA_VERSION,
      "user agent": navigator.userAgent,
      "online": navigator.onLine,
      "installed app": (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true,
      "time zone offset (min)": new Date().getTimezoneOffset(),
      "cloud": currentUser ? "signed in" : (supabaseClient ? "signed out" : "not configured"),
      "cloud sync pending": cloudSyncPending,
      "cloud row updated_at": cloud.lastUpdatedAt || "unknown",
      "meals / foods / recipes": `${state.history.length} / ${state.library.length} / ${state.recipes.length}`,
      "data check": summarizeProblems(validateState(state)),
      "nightscout host": nsHost,
      "nightscout format": nsFormat(),
      "nightscout read": nightscoutReadStatus.at ? `${nightscoutReadStatus.ok ? "ok" : "failed"} via ${nightscoutReadStatus.via} - ${nightscoutReadStatus.message}` : "not checked",
      "nightscout write": nightscoutWriteStatus.at ? `${nightscoutWriteStatus.ok ? "ok" : "failed"} via ${nightscoutWriteStatus.via} - ${nightscoutWriteStatus.message}` : "not checked",
      "outbox jobs": nsOutbox.count(),
      "outbox last error": nsOutbox.lastError() || "none",
      "glucose readings stored": glucoseRows,
      "service worker": sw
    };
  }
  function renderDiagSection() {
    const n = diag.count(), errs = diag.errorCount();
    const stuck = syncStuckNow ? `Sync needs attention: ${currentSyncSummary().rows.filter(r => r.level === "problem" || r.level === "pending").map(r => r.text).join(" ")} ` : "";
    el("diag-summary").textContent = stuck + (n === 0 ? "Nothing logged yet." : `${n} recent events recorded${errs ? `, ${errs} of them errors` : ""}. The report never includes your meals, glucose or tokens.`);
  }
  function copyText(text) { return platform.clipboard.copy(text); }
  // A readable view of the log: newest first, repeats folded together, errors and warnings picked out.
  function openLogSheet() {
    const backdrop = document.createElement("div");
    backdrop.className = "sheet-backdrop";
    const draw = errorsOnly => {
      const entries = diag.entries(), health = logHealth(entries);
      const rows = groupEvents(entries, { errorsOnly });
      backdrop.innerHTML = `
        <div class="sheet">
          <div class="sheet-head">
            <h2>Event log</h2>
            <button class="sheet-close" id="lg-close" type="button" aria-label="Close"><svg viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
          </div>
          <p class="panel-card__hint">${health.errors} error${health.errors === 1 ? "" : "s"}, ${health.warnings} warning${health.warnings === 1 ? "" : "s"} recorded. Your meals, glucose and tokens are never logged.</p>
          <label class="log-filter"><input type="checkbox" id="lg-errors" ${errorsOnly ? "checked" : ""}> Problems only</label>
          ${rows.length ? rows.map(r => `
            <div class="log-row log-row--${escapeAttr(r.level)}">
              <div class="log-row__head"><span class="log-row__area">${escapeHtml(r.areaName)}</span>${r.count > 1 ? `<span class="log-row__count">×${r.count}</span>` : ""}<span class="log-row__ago">${escapeHtml(r.ago)}</span></div>
              <div class="log-row__msg">${escapeHtml(r.msg)}</div>
            </div>`).join("") : `<p class="panel-card__hint">${errorsOnly ? "No problems recorded." : "Nothing logged yet."}</p>`}
        </div>`;
    };
    draw(false);
    openSheet(backdrop);
    backdrop.addEventListener("click", e => {
      if (e.target === backdrop || e.target.closest("#lg-close")) closeSheet(backdrop);
    });
    backdrop.addEventListener("change", e => { if (e.target.id === "lg-errors") draw(e.target.checked); });
  }
  bind("btn-diag-view", "click", openLogSheet);
  bind("btn-diag-copy", "click", async () => {
    const ok = await copyText(diag.report(await diagContext()));
    dialogs.alert(ok ? "Copied. Paste it into a message to share it." : "Couldn't copy automatically on this device.", { title: ok ? "Report copied" : "Copy failed" });
  });
  bind("btn-diag-clear", "click", async () => {
    if (await dialogs.confirm("Clear the diagnostics log?", { confirmText: "Clear" })) { diag.clear(); renderDiagSection(); }
  });

  async function renderStatusPanel() {
    const rows = [];

    // Cloud sync
    if (!supabaseClient) {
      rows.push(statusRow("Cloud Sync", "off", "Not set up — everything stays only on this device."));
    } else if (!currentUser) {
      rows.push(statusRow("Cloud Sync", "off", "Not signed in — everything stays only on this device."));
    } else if (cloud.blocked) {
      rows.push(`<div class="status-row"><span class="status-dot status-dot--error"></span><div><p class="status-row__title">Cloud Sync</p><p class="status-row__detail">Paused — your history would have dropped from ${cloud.blocked.fromCount} to ${cloud.blocked.toCount} entries, which looks like a bug rather than something you did on purpose. Nothing has been synced to protect your data. If you genuinely meant to clear your history, you can override this below.</p><button class="dashed-btn" id="btn-force-sync" type="button" style="margin-top:8px;">Sync anyway</button></div></div>`);
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
  bind("btn-status-refresh", "click", () => renderStatusPanel());

  const INSULIN_PRESETS = {
    rapid: { peakMinutes: 75, diaMinutes: 360 },
    fiasp: { peakMinutes: 55, diaMinutes: 360 }
  };

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
    el("reduce-below-target-toggle").checked = !!state.settings.reduceBelowTarget;
    el("use-learned-abs-toggle").checked = !!state.settings.useLearnedAbsorption;
    const L = state.settings.learnedAbsorption;
    const names = { high: "High GI", medium: "Medium GI", low: "Low GI", unknown: "No GI data" };
    el("learned-abs-result").innerHTML = !L ? "Nothing learned yet." :
      Object.keys(names).map(k => L[k] ? `${names[k]}: <b>${L[k].minutes} min</b> (from ${L[k].n} meals)` : `${names[k]}: not enough yet (${(L.counts && L.counts[k]) || 0} of 3 meals)`).join("<br>") +
      `<br><span style="opacity:.8">Learned ${new Date(L.at).toLocaleDateString()}</span>`;
  }
  bind("use-learned-abs-toggle", "change", e => {
    state.settings.useLearnedAbsorption = e.target.checked;
    saveState();
    renderActivePanel();
    if (e.target.checked && !state.settings.learnedAbsorption) el("btn-learn-abs").click();
  });
  bind("btn-learn-abs", "click", async () => {
    const btn = el("btn-learn-abs"), label = btn.textContent;
    btn.disabled = true; btn.textContent = "Reading your history…";
    const r = await refreshLearnedAbsorption().catch(e => ({ ok: false, reason: String(e && e.message || e) }));
    btn.disabled = false; btn.textContent = label;
    if (!r.ok) el("learned-abs-result").textContent = `Couldn't learn: ${r.reason}`;
  });

  bind("iob-aware-correction-toggle", "change", e => {
    state.settings.iobAwareCorrection = e.target.checked;
    saveState();
    recompute();
  });
  bind("reduce-below-target-toggle", "change", e => {
    state.settings.reduceBelowTarget = e.target.checked;
    saveState();
    recompute();
  });

  bind("insulin-preset-buttons", "click", e => {
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
  bind("insulin-peak-input", "change", handleInsulinFieldEdit);
  bind("insulin-dia-input", "change", handleInsulinFieldEdit);

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
    // The first circle is the theme's own background (no custom colour), so one circle is always ticked and there is no
    // separate "Reset" button to find.
    const TICK = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 13l4 4L19 7" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    grid.innerHTML = `<button class="bg-swatch bg-swatch--default${!active ? " is-active" : ""}" type="button" data-color="" aria-pressed="${!active}" aria-label="Theme default background" title="Theme default">${!active ? TICK : ""}</button>` +
      BG_PRESETS.map(color => `
      <button class="bg-swatch${color === active ? " is-active" : ""}" type="button" data-color="${escapeAttr(color)}" style="background:${color};" aria-pressed="${color === active}" aria-label="Background color ${color}">
        ${color === active ? TICK : ""}
      </button>
    `).join("");
    resetBtn.hidden = true;
    const pattern = backgroundPatternOf(state.settings);
    el("bg-pattern-grid").innerHTML = [["none", "Plain"], ["doodles", "Doodles"], ["abstract", "Abstract"]].map(([id, label]) => `
      <button class="pattern-card${pattern === id ? " is-selected" : ""}" type="button" data-pattern="${escapeAttr(id)}" aria-pressed="${pattern === id}">
        <span class="pattern-card__preview${id === "none" ? "" : ` pattern-card__preview--${id}`}"></span>
        <span class="pattern-card__name">${label}</span>
      </button>
    `).join("");
    // The size choice only makes sense (and only shows) once there is a pattern to size.
    const size = ["small", "medium", "large"].includes(state.settings.backgroundPatternSize) ? state.settings.backgroundPatternSize : "small";
    const sizeBox = el("bg-pattern-size");
    sizeBox.hidden = pattern === "none";
    sizeBox.querySelectorAll("[data-size]").forEach(b => {
      const on = b.dataset.size === size;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-pressed", String(on));
    });
  }
  bind("bg-pattern-size", "click", e => {
    const btn = e.target.closest("[data-size]");
    if (!btn) return;
    state.settings.backgroundPatternSize = btn.dataset.size;
    applyBackgroundPattern();
    saveState();
    renderBackgroundSection();
  });
  bind("bg-pattern-grid", "click", e => {
    const btn = e.target.closest(".pattern-card");
    if (!btn) return;
    state.settings.backgroundPattern = backgroundPatternOf({ backgroundPattern: btn.dataset.pattern });
    applyBackgroundPattern();
    saveState();
    renderBackgroundSection();
  });
  bind("bg-swatch-grid", "click", e => {
    const btn = e.target.closest(".bg-swatch");
    if (!btn) return;
    state.settings.customBackground = btn.dataset.color || null;   // the first circle ("") is the theme default
    applyCustomBackground();
    saveState();
    renderBackgroundSection();
  });
  bind("btn-bg-reset", "click", () => {
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
    el("btn-ns-backfill").hidden = !(currentUser && nightscoutConfigured());
  }

  bind("btn-ns-backfill", "click", async () => {
    const statusEl = el("ns-backfill-status");
    statusEl.hidden = false;
    statusEl.textContent = "Importing… this can take a little while for a lot of history.";
    el("btn-ns-backfill").disabled = true;
    const r = await backfillGlucoseHistory();
    el("btn-ns-backfill").disabled = false;
    if (r.ok && !r.reason) statusEl.textContent = `Saved ${r.imported} reading${r.imported === 1 ? "" : "s"} to the database.`;
    else if (r.ok) statusEl.textContent = `Saved ${r.imported} of ${r.fetched} fetched from Nightscout (stopped early: ${r.reason}).`;
    else statusEl.textContent = `Fetched ${r.fetched || 0} from Nightscout, but couldn't save them: ${r.reason}`;
  });

  function renderAccountSection() {
    const box = el("account-section");
    if (!supabaseClient && cloudConfigured) {
      // Sync IS configured, but the sync library didn't load (offline, blocked, or a damaged cache). Say so, and offer a retry.
      box.innerHTML = `<p class="panel-card__hint" style="margin-top:-4px;">Cloud sync is set up, but its component didn't load, so you're working offline for now. Your data is safe in this browser and will sync once it loads. <button type="button" class="dashed-btn" id="btn-reload-sync" style="margin-top:8px;">Reload and try again</button></p>`;
      const b = box.querySelector("#btn-reload-sync"); if (b) b.addEventListener("click", () => location.reload());
      return;
    }
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
      bind("btn-sign-out", "click", async () => { await signOut(); });
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
      bind("acct-signin-form", "submit", async e => {
        e.preventDefault();
        errEl.hidden = true;
        try { await signIn(emailEl.value.trim(), passEl.value); }
        catch (err) { showErr(err.message || "Couldn't sign in."); }
      });
      bind("btn-forgot-password", "click", async () => {
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
      bind("btn-sign-up", "click", async () => {
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
      const faceIdRow = faceIdSupported() ? `
        <div class="toggle-row">
          <span>Unlock with Face ID / Touch ID</span>
          <label class="switch">
            <input type="checkbox" id="faceid-toggle" ${isFaceIdEnabled() ? "checked" : ""}>
            <span class="switch__track"></span>
          </label>
        </div>
        <p class="panel-card__hint" style="margin-top:0;">A convenience shortcut, not a cryptographic replacement — it stores your unlocked key on this device, gated behind a fresh Face ID check each time. Your passphrase still works as a fallback, always.</p>
      ` : "";
      box.innerHTML = `
        <p class="panel-card__hint" style="margin-top:-4px;">This device is locked with a passphrase. Your data${cloudNote} is encrypted at rest — forgetting it means it can't be recovered. Once unlocked, this device stays unlocked until you lock it again or fully close the app.</p>
        ${faceIdRow}
        <button class="dashed-btn" id="btn-lock-now" type="button" style="margin-bottom:8px;">Lock now</button>
        <button class="dashed-btn" id="btn-change-pass" type="button" style="margin-bottom:8px;">Change passphrase</button>
        <button class="dashed-btn" id="btn-remove-pass" type="button" style="color:var(--brick); border-color:var(--brick-soft);">Remove passphrase</button>
      `;
      bind("btn-lock-now", "click", () => { clearSessionKey(); encryptionKey = null; location.reload(); });
      if (faceIdSupported()) {
        bind("faceid-toggle", "change", async e => {
          if (e.target.checked) {
            try { await enrollFaceId(); }
            catch (err) { e.target.checked = false; await dialogs.alert("Couldn't set up Face ID: " + ((err && err.message) || err)); }
          } else {
            disableFaceId();
          }
        });
      }
      bind("btn-change-pass", "click", onChangePassphrase);
      bind("btn-remove-pass", "click", onRemovePassphrase);
    } else {
      box.innerHTML = `
        <p class="panel-card__hint" style="margin-top:-4px;">Encrypt your library, ratios, and history${cloudNote} with a passphrase. It never leaves your browser — there's no account for it and no way to recover a forgotten passphrase.</p>
        <button class="dashed-btn" id="btn-set-pass" type="button">Set a passphrase</button>
      `;
      bind("btn-set-pass", "click", onSetPassphrase);
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
    // Brackets can overlap (a Sunday one over the everyday one), so draw what is actually in force today, in 15-minute steps.
    const today = new Date().getDay(), segs = [];
    for (let m = 0; m < 1440; m += 15) {
      const r = ratioMatch(state.settings.timeRatios, m, today);
      if (!r) continue;
      const last = segs[segs.length - 1];
      if (last && last.r === r && last.end === m) last.end = m + 15; else segs.push({ start: m, end: m + 15, r });
    }
    // Full "Morning · 1:10" only where it fits; a narrow slice shows just its ratio, a sliver shows nothing (the rows below name every range).
    const barPx = bar.clientWidth || 320, fits = (text, px) => text.length * 6.6 + 12 <= px;
    segs.forEach(seg => {
      const width = ((seg.end - seg.start) / 1440) * 100;
      if (width <= 0) return;
      const div = document.createElement("div");
      div.className = "timeline__seg";
      div.style.width = width + "%";
      div.style.background = seg.r.color;
      const px = width / 100 * barPx, full = `${seg.r.name} · 1:${seg.r.ratio}`, short = `1:${seg.r.ratio}`;
      div.textContent = fits(full, px) ? full : fits(short, px) ? short : "";
      div.title = full;
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

  // Renaming a range or activity: meals are tied to a range by its name, so past meals follow the new name and the
  // insights keep them together. Names stay unique (the reports group by name); a blank or taken name is refused.
  function renameRatio(list, r, raw) {
    const name = String(raw || "").trim().slice(0, 40), old = r.name;
    if (!name || name === old) return false;
    const taken = [...state.settings.timeRatios, ...state.settings.activityRatios].some(x => x !== r && x.name === name);
    if (taken) { dialogs.alert(`There is already a range called "${name}". Pick a different name.`); return false; }
    r.name = name;
    const stillUsed = [...state.settings.timeRatios, ...state.settings.activityRatios].some(x => x !== r && x.name === old);
    if (!stillUsed) state.history.forEach(e => { if (e && e.ratioLabel === old) e.ratioLabel = name; });
    return true;
  }

  function renderTimeRatioList() {
    const box = el("time-ratio-list");
    box.innerHTML = "";
    state.settings.timeRatios.forEach(r => {
      const row = document.createElement("div");
      row.className = "ratio-row";
      row.style.borderLeft = `4px solid ${escapeAttr(r.color)}`;
      row.style.background = `${escapeAttr(r.color)}12`;
      row.innerHTML = `
        <div class="ratio-row__top" data-toggle="${escapeAttr(r.id)}" style="cursor:pointer;">
          <span>
            <span class="ratio-row__name">${escapeHtml(r.name)}</span>
            <span class="ratio-row__time">${r.start} – ${r.end}${daysLabel(r) ? ` · ${daysLabel(r)}` : ""}</span>
          </span>
          <span class="ratio-row__value">1:${r.ratio}</span>
          <button class="ratio-row__del" data-del="${escapeAttr(r.id)}" aria-label="Delete" style="margin-left:4px;">
            <svg viewBox="0 0 24 24" fill="none"><path d="M5 7h14M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m-9 0l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>
        <div class="ratio-row__edit" id="edit-${r.id}" hidden>
          <label class="ratio-name"><span>Name</span><input type="text" value="${escapeAttr(r.name)}" maxlength="40" data-field="name" data-id="${escapeAttr(r.id)}" autocomplete="off"></label>
          <input type="time" value="${r.start}" data-field="start" data-id="${escapeAttr(r.id)}">
          <span>to</span>
          <input type="time" value="${r.end}" data-field="end" data-id="${escapeAttr(r.id)}">
          <span class="ratio-x">1 unit per <input type="number" min="1" value="${r.ratio}" data-field="ratio" data-id="${escapeAttr(r.id)}"> g</span>
          <div class="day-chips" role="group" aria-label="Days this range applies">
            <span class="day-chips__label">Days</span>
            ${[1, 2, 3, 4, 5, 6, 0].map(d => `<button type="button" class="day-chip${bracketDays(r).length === 0 || bracketDays(r).includes(d) ? " is-on" : ""}" data-day="${d}" data-id="${escapeAttr(r.id)}" aria-pressed="${bracketDays(r).length === 0 || bracketDays(r).includes(d)}">${DAY_NAMES[d]}</button>`).join("")}
          </div>
          <p class="day-chips__hint">${bracketDays(r).length ? "Only on the days lit. Where it overlaps an every-day range, this one is used on those days." : "All days lit means every day. Untick days to make this a special range, for example Sunday only."}</p>
        </div>
      `;
      box.appendChild(row);
    });
  }

  bind("time-ratio-list", "click", e => {
    const chip = e.target.closest("[data-day]");
    if (chip) {
      const r = state.settings.timeRatios.find(x => x.id === chip.dataset.id);
      if (!r) return;
      const d = +chip.dataset.day;
      const cur = bracketDays(r).length ? bracketDays(r) : [0, 1, 2, 3, 4, 5, 6];
      const next = cur.includes(d) ? cur.filter(x => x !== d) : [...cur, d];
      if (!next.length) return;                       // at least one day must stay
      if (next.length === 7) delete r.days; else r.days = next.sort((a, b) => a - b);
      const open = !el("edit-" + r.id).hidden;
      saveState(); renderTimeline(); renderTimeRatioList();
      if (open) el("edit-" + r.id).hidden = false;
      return;
    }
    const del = e.target.closest("[data-del]");
    if (del) {
      if (state.settings.timeRatios.length <= 1) { dialogs.alert("You need at least one time range."); return; }
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
  bind("time-ratio-list", "change", e => {
    const field = e.target.dataset.field;
    if (!field) return;
    const r = state.settings.timeRatios.find(x => x.id === e.target.dataset.id);
    if (!r) return;
    if (field === "ratio") r.ratio = parseFloat(e.target.value) || r.ratio;
    else if (field === "name") renameRatio(state.settings.timeRatios, r, e.target.value);
    else r[field] = e.target.value;
    saveState();
    renderTimeline();
    renderTimeRatioList();
    const ed = el("edit-" + r.id); if (ed) ed.hidden = false;
  });

  const RANGE_COLORS = ["#1F9E93", "#D6A419", "#6366F1", "#D9534F", "#EC4899", "#22B8CE"];
  bind("add-time-range-btn", "click", () => {
    const id = "tr-" + Date.now();
    let nm = "New range", k = 2;
    while (state.settings.timeRatios.some(x => x.name === nm) || state.settings.activityRatios.some(x => x.name === nm)) nm = "New range " + k++;
    state.settings.timeRatios.push({ id, name: nm, start: "12:00", end: "14:00", ratio: 10, color: RANGE_COLORS[state.settings.timeRatios.length % RANGE_COLORS.length] });
    saveState(); renderTimeline(); renderTimeRatioList();
  });

  function renderActivityRatioList() {
    const box = el("activity-ratio-list");
    box.innerHTML = "";
    state.settings.activityRatios.forEach(r => {
      const row = document.createElement("div");
      row.className = "ratio-row";
      row.style.borderLeft = `4px solid ${escapeAttr(r.color)}`;
      row.style.background = `${escapeAttr(r.color)}12`;
      row.innerHTML = `
        <div class="ratio-row__top">
          <input type="text" class="ratio-row__name-input" value="${escapeAttr(r.name)}" maxlength="40" data-field="name" data-id="${escapeAttr(r.id)}" aria-label="Activity name" autocomplete="off">
          <span class="ratio-x">1 unit per <input type="number" min="1" value="${r.ratio}" data-field="ratio" data-id="${escapeAttr(r.id)}" style="width:52px;padding:6px;text-align:center;"> g</span>
          <button class="ratio-row__del" data-del="${escapeAttr(r.id)}" aria-label="Delete">
            <svg viewBox="0 0 24 24" fill="none"><path d="M5 7h14M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m-9 0l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>
      `;
      box.appendChild(row);
    });
  }
  bind("activity-ratio-list", "click", e => {
    const del = e.target.closest("[data-del]");
    if (!del) return;
    state.settings.activityRatios = state.settings.activityRatios.filter(r => r.id !== del.dataset.del);
    saveState(); renderActivityRatioList();
  });
  bind("activity-ratio-list", "change", e => {
    const f = e.target.dataset.field;
    if (f !== "ratio" && f !== "name") return;
    const r = state.settings.activityRatios.find(x => x.id === e.target.dataset.id);
    if (!r) return;
    if (f === "name") { renameRatio(state.settings.activityRatios, r, e.target.value); saveState(); renderActivityRatioList(); return; }
    r.ratio = parseFloat(e.target.value) || r.ratio; saveState();
  });
  bind("add-activity-btn", "click", async () => {
    const name = (await dialogs.prompt("For example Sport or Stress.", { title: "Activity name", placeholder: "Activity name", confirmText: "Add" }) || "").trim();
    if (!name) return;
    state.settings.activityRatios.push({ id: "ar-" + Date.now(), name, ratio: 15, color: RANGE_COLORS[state.settings.activityRatios.length % RANGE_COLORS.length] });
    saveState(); renderActivityRatioList();
  });

  // Switching glucose units converts the target and correction factor in the boxes (and says so), so a unit switch can never leave
  // "100" meaning 100 mmol/L. Switching back before saving restores the exact numbers that were there.
  let unitSwitchOrigin = null;
  bind("set-units", "change", () => {
    const to = el("set-units").value, note = el("units-convert-note");
    if (!unitSwitchOrigin) unitSwitchOrigin = { units: state.settings.units, isf: state.settings.isf, target: state.settings.target };
    const o = unitSwitchOrigin, from = o.units === to ? null : o.units;
    const typed = id => { const v = parseDecimalInput(el(id).value); return Number.isFinite(v) ? v : null; };
    if (!from) { el("set-isf").value = o.isf; el("set-target").value = o.target; if (note) note.hidden = true; }
    else {
      const isf = typed("set-isf") ?? o.isf, target = typed("set-target") ?? o.target;
      // The boxes may already show the converted numbers if switched twice; convert from the unit the boxes were last in.
      const shownIn = el("set-units").dataset.shownIn || o.units;
      el("set-isf").value = convertDosingSetting(isf, shownIn, to);
      el("set-target").value = convertDosingSetting(target, shownIn, to);
      if (note) { note.hidden = false; note.textContent = `Switched to ${to === "mmol" ? "mmol/L" : "mg/dL"}: your target and correction factor were converted (${el("set-target").value} and ${el("set-isf").value}). Check them, then Save.`; }
    }
    el("set-units").dataset.shownIn = to;
    const u = to === "mmol" ? "mmol/L" : "mg/dL";
    el("isf-unit-label").textContent = u; el("target-unit-label").textContent = u;
  });

  function fillCorrectionForm() {
    unitSwitchOrigin = null; el("set-units").dataset.shownIn = state.settings.units;
    const note0 = el("units-convert-note"); if (note0) note0.hidden = true;
    el("set-isf").value = state.settings.isf;
    el("set-target").value = state.settings.target;
    el("set-units").value = state.settings.units;
    el("set-rounding").value = state.settings.rounding;
    el("set-max").value = state.settings.maxDose;
    const u = unitLabel();
    el("isf-unit-label").textContent = u;
    el("target-unit-label").textContent = u;
  }
  bind("btn-save-settings", "click", () => {
    { const v = parseDecimalInput(el("set-isf").value); if (Number.isFinite(v) && v > 0) state.settings.isf = v; else el("set-isf").value = state.settings.isf; }
    // A blank or unreadable target keeps the old one: saving 0 would make every reading look like a correction from zero.
    const typedTarget = parseDecimalInput(el("set-target").value);
    if (Number.isFinite(typedTarget) && typedTarget > 0) state.settings.target = typedTarget;
    else el("set-target").value = state.settings.target;
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
  function downloadText(filename, text, mime) { return platform.files.save(filename, text, mime); }

  function exportRecipesCsv() {
    if (!state.recipes.length) { dialogs.alert("You have no recipes to export yet."); return; }
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
    downloadText("Recipe_export.csv", toCsv(recipeRows, recipeHeaders), "text/csv");
  }

  bind("btn-export-library", "click", () => {
    const foodHeaders = ["fat_per_100g", "usage_count", "is_favorite", "notes", "calories_per_100g", "salt_per_100g", "name", "carbs_per_100g", "category", "protein_per_100g", "unit_based", "unit_label", "grams_per_unit", "glycemic_index", "id"];
    const foodRows = state.library.map(f => ({
      fat_per_100g: f.fat, usage_count: f.usageCount || 0, is_favorite: !!f.favorite,
      notes: f.notes, calories_per_100g: f.kcal, salt_per_100g: f.salt, name: f.name,
      carbs_per_100g: f.carbs, category: f.category, protein_per_100g: f.protein,
      unit_based: !!f.unitBased, unit_label: f.unitLabel || "", grams_per_unit: f.gramsPerUnit || "",
      glycemic_index: f.gi || "", id: f.id
    }));
    downloadText("Food_export.csv", toCsv(foodRows, foodHeaders), "text/csv");

    if (state.recipes.length) setTimeout(() => exportRecipesCsv(), 300);
  });
  bind("btn-export-recipes", "click", () => exportRecipesCsv());

  bind("btn-import-library", "click", () => el("import-file-input").click());

  // Fill blank GI / fat / protein / salt with typical values (js/food-reference.js). Only ever fills EMPTY fields; undo is offered straight after.
  bind("btn-fill-foods", "click", async () => {
    const trial = fillMissingFoodDetails(structuredClone(state.library));
    if (!trial.changes.length) { await dialogs.alert("Nothing to fill: every food I have typical values for already has them.", { title: "Fill missing details" }); return; }
    const gi = trial.changes.filter(c => c.field === "gi").length, other = trial.changes.length - gi;
    const ok = await dialogs.confirm(`This fills ${trial.changes.length} blanks across ${trial.foodsTouched} foods: ${gi} glycaemic index values and ${other} fat / protein / salt / calorie values.\n\nThey are typical values for the food, not measurements of your exact product. Filled GIs show as "GI ~55" so you can spot them, and the GI changes how fast the app counts carbs as absorbing.\n\nNothing you already entered is changed, and you can undo right after.`, { title: "Fill missing details", confirmText: "Fill them in" });
    if (!ok) return;
    const before = structuredClone(state.library);
    const done = fillMissingFoodDetails(state.library);
    saveState(); renderLibrary(); renderSettings(); renderActivePanel();
    const left = stillBlank(state.library).filter(x => x.missing.includes("gi") && (state.library.find(f => f.id === x.id).carbs || 0) >= 5).length;
    showUndoToast(`Filled ${done.changes.length} blanks${left ? ` · ${left} foods still need a GI` : ""}`, () => {
      state.library = before; saveState(); renderLibrary(); renderSettings(); renderActivePanel();
    }, { ms: 12000 });
  });

  // Imports foods and/or recipes from one file's text. A recipe CSV is recognised by its "ingredients" column
  // (it is what Export Library writes as Recipe_export.csv). Items are matched by name (case-insensitive).
  function importLibraryFile(name, text) { return mergeLibrary(state.library, state.recipes, parseLibraryFile(name, text)); }

  bind("import-file-input", "change", e => {
    const files = [...e.target.files];
    if (!files.length) return;
    // Foods first, so recipes can find their ingredients when both files are chosen together.
    files.sort((x, y) => (/recipe/i.test(x.name) ? 1 : 0) - (/recipe/i.test(y.name) ? 1 : 0));
    const read = f => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => no(r.error); r.readAsText(f); });
    (async () => {
      const total = { foodsAdded: 0, foodsUpdated: 0, recipesAdded: 0, recipesUpdated: 0 };
      const bad = [];
      for (const f of files) {
        try { const r = importLibraryFile(f.name, await read(f)); Object.keys(total).forEach(k => { total[k] += r[k]; }); }
        catch (err) { console.error(err); bad.push(f.name); }
      }
      repairQuantityFoods(); saveState(); renderLibrary(); renderSettings();
      const parts = [];
      if (total.foodsAdded || total.foodsUpdated) parts.push(`Foods: ${total.foodsAdded} added, ${total.foodsUpdated} updated`);
      if (total.recipesAdded || total.recipesUpdated) parts.push(`Recipes: ${total.recipesAdded} added, ${total.recipesUpdated} updated`);
      if (!parts.length && !bad.length) parts.push("Nothing to import in that file");
      if (bad.length) parts.push(`Could not read: ${bad.join(", ")}. Make sure it's a CSV or JSON export`);
      dialogs.alert(`Import complete. ${parts.join(". ")}.`);
      e.target.value = "";
    })();
  });

  bind("btn-export-all", "click", () => {
    downloadText(`insulin-buddy-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(state, null, 2), "application/json");
  });

  bind("btn-import-all", "click", () => el("import-all-file-input").click());
  bind("import-all-file-input", "change", e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        let foodsAdded = 0, foodsUpdated = 0, recipesAdded = 0, recipesUpdated = 0, historyAdded = 0, skipped = 0;
        // Records that would break the app (no id or time, a dose that isn't a number...) are left out and counted.
        const sound = (list, check, label) => (list || []).filter(x => { const bad = hasErrors(check(x, label)); if (bad) skipped++; return !bad; });
        data.library = sound(data.library, validateFood, "food");
        data.recipes = sound(data.recipes, validateRecipe, "recipe");
        data.history = sound(data.history, validateEntry, "entry");

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
        renderLibrary(); renderHistory(); renderSettings(); renderRecentMeals();
        dialogs.alert(`Import complete.\nFoods: ${foodsAdded} added, ${foodsUpdated} updated.\nRecipes: ${recipesAdded} added, ${recipesUpdated} updated.\nHistory: ${historyAdded} added.${skipped ? `\n\n${skipped} record${skipped === 1 ? "" : "s"} could not be read and ${skipped === 1 ? "was" : "were"} skipped.` : ""}\n\nSettings were left untouched.`);
      } catch (err) {
        console.error(err);
        dialogs.alert("Could not read that file. Make sure it's a JSON backup exported from this app.");
      }
      e.target.value = "";
    };
    reader.readAsText(file);
  });

  // ---- General tab ----
  function renderPaletteGrid() {
    const grid = el("palette-grid");
    grid.innerHTML = PALETTES.map(p => `
      <button class="palette-card${state.settings.palette === p.id ? " is-selected" : ""}" data-id="${escapeAttr(p.id)}" type="button">
        ${state.settings.palette === p.id ? `<span class="palette-card__check"><svg viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>` : ""}
        <span class="palette-card__dots" data-swatch="${escapeAttr(p.id)}"><span style="background:var(--acc-1)"></span><span style="background:var(--acc-2)"></span></span>
        <span class="palette-card__name">${p.name}</span>
      </button>
    `).join("");
  }
  bind("palette-grid", "click", e => {
    const card = e.target.closest(".palette-card");
    if (!card) return;
    state.settings.palette = card.dataset.id;
    document.documentElement.setAttribute("data-palette", card.dataset.id);
    saveState();
    renderPaletteGrid();
  });

  bind("dark-mode-toggle", "change", e => {
    state.settings.darkMode = e.target.checked;
    applyTheme();
    renderBackgroundSection();
    saveState();
  });
  bind("show-recent-meals-toggle", "change", e => {
    state.settings.showRecentMeals = e.target.checked;
    saveState();
    renderRecentMeals();
  });
  bind("dark-mode-auto-toggle", "change", e => {
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

  bind("ns-url", "input", e => {
    state.settings.nightscoutUrl = e.target.value.trim();
    saveState();
    renderNightscoutSection();
    // The cached reading belongs to whatever server was configured before -- once the
    // URL changes it may be stale or from a different site entirely, so drop it rather
    // than show a number that looks live but isn't.
    liveGlucose = null;
    store.removeItem(LIVE_GLUCOSE_CACHE_KEY);
    resetGlucoseStore();
    renderLiveGlucosePill();
  });
  bind("set-check-after", "change", e => { state.settings.checkAfterHours = Number(e.target.value) || 0; saveState(); if (!state.settings.checkAfterHours) { try { store.removeItem(REMINDER_KEY); } catch { /* */ } } renderReminder(); });
  bind("ns-format", "change", e => { state.settings.nsFormat = e.target.value === "split" ? "split" : "combined"; saveState(); });
  bind("ns-sync-edits", "change", e => { state.settings.nsSyncEdits = e.target.checked; saveState(); });
  bind("btn-ns-test", "click", () => { testNightscoutConnection(); });
  bind("btn-ns-refresh", "click", async () => {
    renderNsStatus("Checking…");
    await flushNightscoutQueue(true);
    await refreshLiveGlucose(true);
    renderNightscoutSection();
  });

  bind("btn-refresh-app", "click", () => location.reload());

  bind("btn-delete-all", "click", async () => {
    if (!(await dialogs.confirm("This deletes ALL data — settings, library, recipes and history — permanently. This can't be undone.", { title: "Delete everything?", confirmText: "Delete everything", danger: true }))) return;
    store.removeItem(STORAGE_KEY);
    store.removeItem(LOCK_KEY);
    encryptionKey = null;
    if (supabaseClient && currentUser) {
      await supabaseClient.from("app_state").delete().eq("user_id", currentUser.id);
      await signOut();
    }
    try { await backups.clear(); } catch (e) { /* none */ }
    nsOutbox.jobs = []; nsOutbox._save();
    [PENDING_SYNC_KEY, LAST_SNAPSHOT_KEY, "insulinBuddy.diag", "insulinBuddy.nsQueue", LIVE_GLUCOSE_CACHE_KEY, GLUCOSE_STORE_KEY].forEach(k => store.removeItem(k));
    liveGlucose = null;
    diag.clear();
    cloudSyncPending = false; cloud.reset();
    state = normalizeState({});
    stateFp = makeFingerprint(state);
    renderEverything();
    dialogs.alert("All data has been deleted.");
  });

  // ================= Init =================
  // One-time patch: adds Glycemic Index values to existing library foods that match by name (the published values live in
  // js/food-reference.js, the one place for food reference data). Only ever sets the gi field, never overwrites one that is set.
  // A food with a unit name and a weight per unit is logged by quantity. Older imports only understood the exact
  // text "true", so foods whose file said "True"/"TRUE"/"1" lost the flag but kept the unit and its weight.
  function repairQuantityFoods() {
    let n = 0;
    state.library.forEach(f => {
      if (!f.unitBased && f.unitLabel && Number(f.gramsPerUnit) > 0) { f.unitBased = true; n++; }
    });
    if (n) { saveState(); diag.log("info", "library", `Restored "log by quantity" on ${n} food(s) that had a unit and weight but the flag off`); }
    return n;
  }


  function seedMealRecipes() {
    const done = Array.isArray(state.settings.seededRecipes) ? state.settings.seededRecipes : [];
    const added = [];
    SEED_RECIPES.forEach(sr => {
      if (done.includes(sr.key)) return;
      if (!state.recipes.some(r => r.name.toLowerCase() === sr.name.toLowerCase())) {
        const items = sr.items.map(([name, grams, carbs, kcal]) => {
          const f = state.library.find(x => x.name.toLowerCase() === name.toLowerCase());
          return { foodId: f ? f.id : null, name, grams, carbsPer100g: carbs, kcalPer100g: kcal };
        });
        const total = items.reduce((s, i) => s + i.grams, 0);
        state.recipes.unshift({ id: "recipe-seed-" + sr.key, name: sr.name, category: sr.category, notes: sr.notes, favorite: false, usageCount: 0, rawWeight: null, finalWeight: total, items });
        added.push(sr.name);
      }
      done.push(sr.key);
    });
    if (added.length || done.length !== (state.settings.seededRecipes || []).length) {
      state.settings.seededRecipes = done;
      saveState();
      if (added.length) diag.log("info", "library", `Added ${added.length} ready-made recipe(s): ${added.join(", ")}`);
    }
    return added.length;
  }

  function applyGiSeedPatch() {
    if (applyPublishedGi(state.library)) saveState();
  }

  function isDarkModeActive() {
    if (state.settings.darkModeAuto) {
      return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    }
    return state.settings.darkMode;
  }
  function applyTheme() {
    document.documentElement.setAttribute("data-theme", isDarkModeActive() ? "dark" : "light");
    // A small hint the next start reads before anything is painted (see the first script in index.html), so the opening screen is dark at night.
    try { localStorage.setItem("insulinBuddy.theme", state.settings.darkModeAuto ? "auto" : state.settings.darkMode ? "dark" : "light"); } catch (e) { /* private mode: the phone's own setting decides */ }
    const tc = document.querySelector('meta[name="theme-color"]'); if (tc) tc.setAttribute("content", isDarkModeActive() ? "#0F1318" : "#F4F5F7");
    applyCustomBackground();
    applyBackgroundPattern();
  }
  // The patterns on offer. Anything else (a typo, a value from a newer version) means no pattern rather than a broken page.
  const BACKGROUND_PATTERNS = ["none", "doodles", "abstract"];
  function backgroundPatternOf(settings) { return BACKGROUND_PATTERNS.includes(settings.backgroundPattern) ? settings.backgroundPattern : "none"; }
  // The pattern is pure CSS keyed off this attribute (see DOODLE-PATTERN and ABSTRACT-PATTERN in style.css), so applying it is one attribute.
  function applyBackgroundPattern() {
    document.documentElement.setAttribute("data-bg-pattern", backgroundPatternOf(state.settings));
    const size = state.settings.backgroundPatternSize;
    document.documentElement.setAttribute("data-bg-pattern-size", size === "medium" || size === "large" ? size : "small");
    renderPatternField();
  }
  // Doodles and Abstract are drawn for this screen's actual size (js/doodle-field.js, js/abstract-field.js), so they never tile or
  // repeat. The layout is redone when the window's width changes or it grows taller; a phone's address bar sliding in and out
  // changes nothing.
  let fieldKey = "";
  function renderPatternField() {
    const pattern = backgroundPatternOf(state.settings);
    const hostId = pattern === "doodles" ? "bg-doodles" : pattern === "abstract" ? "bg-abstract" : null;
    for (const id of ["bg-doodles", "bg-abstract"]) { const h = document.getElementById(id); if (h && id !== hostId) h.remove(); }
    if (!hostId) { fieldKey = ""; document.documentElement.removeAttribute("data-pattern-field"); return; }
    let host = document.getElementById(hostId);
    const size = ["medium", "large"].includes(state.settings.backgroundPatternSize) ? state.settings.backgroundPatternSize : "small";
    const w = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
    const h = Math.max(window.innerHeight || 0, (window.screen && window.screen.height) || 0, 600);
    const key = `${pattern}|${size}|${w}|${h}`;
    if (host && key === fieldKey) return;
    if (!host) {
      host = document.createElement("div");
      host.id = hostId;
      host.className = "bg-field";
      host.setAttribute("aria-hidden", "true");
      document.body.prepend(host);
    }
    host.innerHTML = pattern === "doodles" ? fieldSvg(w, h, size) : abstractSvg(w, h, size);
    fieldKey = key;
    document.documentElement.setAttribute("data-pattern-field", pattern);
  }
  let fieldResizeTimer = null;
  window.addEventListener("resize", () => { clearTimeout(fieldResizeTimer); fieldResizeTimer = setTimeout(renderPatternField, 250); });
  function applyCustomBackground() {
    if (state.settings.customBackground && !isDarkModeActive()) {
      document.documentElement.style.setProperty("--app-bg", state.settings.customBackground);
    } else {
      document.documentElement.style.removeProperty("--app-bg");
    }
  }

  async function finishInit() {
    el("loading-screen").hidden = true; // the cover shown since first paint (index.html); real content is about to render
    document.documentElement.setAttribute("data-palette", state.settings.palette);
    applyTheme();
    if (!stateFp) stateFp = makeFingerprint(state);
    applyGiSeedPatch();
    repairQuantityFoods();
    seedMealRecipes();
    renderQuickUsual(); renderReminder();
    renderFoodPickList();
    renderMealItems();
    recompute();
    restoreDraftIfAny();
    renderActivePanel();
    renderRecentMeals();
    if (!restorePlace()) showView("calculator");
    syncTabbarHeightVar();
    window.addEventListener("resize", syncTabbarHeightVar);
    // The tab bar can change height without the window resizing: on the iPhone home-screen app the bottom safe area
    // (the home-indicator strip) is often applied after start-up, and fonts can load late. Measuring only at start-up
    // left the Log bar sitting over the tab bar. A ResizeObserver only fires when a size really changes, so it costs nothing at rest.
    if (typeof ResizeObserver === "function") {
      const ro = new ResizeObserver(() => syncTabbarHeightVar());
      [document.querySelector(".tabbar"), el("cc-sticky-log-bar")].forEach(n => { if (n) ro.observe(n, { box: "border-box" }); });   // border-box: the safe area changes padding, not content
    }
    window.addEventListener("pageshow", syncTabbarHeightVar);

    // Keep the auto-selected ratio (and the settings timeline's "now" marker) accurate
    // as real time passes, not just at page load.
    nsOutbox.migrateLegacy();
    flushNightscoutQueue();
    renderSyncChip();
    renderLiveGlucosePill();   // show the cached reading immediately, don't wait on the network
    refreshLiveGlucose();
    diag.log("info", "boot", `App started (v${CHANGELOG[0].version}); ${state.history.length} meals; cloud ${currentUser ? "signed in" : "off"}`);
    let tick = 0;
    const everyThirtySeconds = () => {
      if (document.hidden) return;   // nothing is showing, so nothing needs redrawing or fetching; coming back runs it straight away (below)
      if (!draft.manualRatioId) recompute();
      if (!el("view-settings").hidden && !panelRatios.hidden) renderTimeline();
      if (!el("view-calculator").hidden) renderActivePanel();
      if (currentUser && !cloudSyncPending && !document.hidden && ++tick % 4 === 0) pullAndMerge("periodic").catch(() => {});
      flushNightscoutQueue();
      refreshLiveGlucose();
      renderSyncChip();   // keeps "oldest waiting 5 min" and "checked 2 min ago" honest
    };
    setInterval(everyThirtySeconds, 30000);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) return;
      if (!draft.manualRatioId) recompute();   // the time of day may have moved into another ratio while the app was away
      if (!el("view-calculator").hidden) renderActivePanel();
      renderSyncChip();
    });
  }

  function renderEverything() {
    document.documentElement.setAttribute("data-palette", state.settings.palette);
    applyTheme();
    applyGiSeedPatch();
    seedMealRecipes();
    draft = { items: [], correctionOn: false, correctionManual: false, noInsulinOn: false, eatingOutOn: false, glucose: "", glucoseUnit: null, manualRatioId: null };
    renderFoodPickList(); renderMealItems(); recompute();
    restoreDraftIfAny();
    renderActivePanel();
    renderRecentMeals();
    renderLibrary(); renderHistory(); renderSettings();
  }

  // Shown whenever a passphrase is required before proceeding -- local-only mode, or
  // cloud sign-in on a device that either already knows about the account's passphrase
  // or has just learned about it (see the cloud row fetch in the sign-in flow below).
  // Resolves once successfully unlocked; never resolves if the user just sits there.
  async function showLockScreen() {
    await faceIdHardwareCheck; // make sure faceIdSupported() below reflects a resolved answer, not the false default
    return new Promise(resolve => {
      const overlay = el("lock-screen");
      const input = el("lock-passphrase");
      const errorEl = el("lock-error");
      const form = el("lock-form");
      const faceIdBtn = el("btn-faceid-unlock");
      overlay.hidden = false;
      const lockCfg = getLockConfig();
      const canFaceId = faceIdSupported() && isFaceIdEnabled();
      faceIdBtn.hidden = !canFaceId;
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        overlay.hidden = true;
        input.value = "";
        form.removeEventListener("submit", onSubmit);
        faceIdBtn.removeEventListener("click", onFaceIdClick);
        resolve();
      };
      const onSubmit = async e => {
        e.preventDefault();
        errorEl.hidden = true;
        const ok = await tryUnlock(input.value);
        if (!ok) { errorEl.textContent = "That passphrase doesn't match. Try again."; errorEl.hidden = false; input.value = ""; input.focus(); return; }
        finish();
      };
      const onFaceIdClick = async () => {
        errorEl.hidden = true;
        faceIdBtn.disabled = true;
        const ok = await unlockWithFaceId(lockCfg);
        faceIdBtn.disabled = false;
        if (ok) { finish(); return; }
        errorEl.textContent = "Face ID didn't work — enter your passphrase instead.";
        errorEl.hidden = false;
        input.focus();
      };
      form.addEventListener("submit", onSubmit);
      faceIdBtn.addEventListener("click", onFaceIdClick);
      if (canFaceId) onFaceIdClick(); // try right away; a decline or failure falls back to the button/passphrase field
      else input.focus();
    });
  }

  async function boot() {
    runMigrations(store, STORAGE_MIGRATIONS, (lvl, msg, e) => diag.log(lvl, "storage", `${msg}: ${e && e.message}`));
    if (supabaseClient) {
      const loading = el("loading-screen");
      loading.hidden = false;
      let resolved = false;
      let lockAttempted = false; // guards against onAuthStateChange firing more than once before the first attempt finishes (see below)
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
          // This also fetches `data`/`updated_at` in the same round-trip, reused by
          // loadStateCloud() below instead of querying the same row a second time --
          // one less network trip blocking every single boot.
          let cloudRowFetch;
          try { cloudRowFetch = await supabaseClient.from("app_state").select("data, updated_at, lock").eq("user_id", currentUser.id).maybeSingle(); }
          catch (e) { cloudRowFetch = { data: null, error: e }; }
          const requiredLock = (!cloudRowFetch.error && cloudRowFetch.data && cloudRowFetch.data.lock) || getLockConfig();
          // Supabase can legitimately fire onAuthStateChange more than once during a normal
          // sign-in (an initial session restore followed by a SIGNED_IN event, for instance).
          // Without this guard, a second firing while the first lock/Face ID attempt is still
          // pending (encryptionKey not set yet) would trigger a second, overlapping prompt --
          // exactly the "asks twice" symptom this closes off. Once truly unlocked, encryptionKey
          // being set is what keeps later firings from re-prompting; this only needs to cover
          // the brief race before that.
          if (requiredLock && !encryptionKey && !lockAttempted) {
            lockAttempted = true;
            const localCfg = getLockConfig();
            if (!localCfg || localCfg.salt !== requiredLock.salt) {
              // Either this device has never seen a passphrase before, or another device set
              // a different one since -- either way, adopt the account's config so this
              // device can be unlocked with the same passphrase (never the passphrase itself,
              // just the salt and a verifier that proves a guess right or wrong).
              store.mustSet(LOCK_KEY, JSON.stringify(requiredLock));
            }
            if (!(await tryRestoreSessionKey(requiredLock))) await showLockScreen();
          }

          const local = await loadLocalState();
          const localLegacy = localWasLegacy;
          const result = await loadStateCloud(cloudRowFetch);
          if (!result.ok) {
            // Couldn't reach the cloud right now (network hiccup, etc.) -- NOT the
            // same as "no data exists yet". Use what's saved on this device and
            // leave the cloud row completely untouched.
            cloudLoadStatus = { ok: false, message: "Couldn't load your data from the cloud — showing what's saved on this device instead.", at: Date.now() };
            state = local;
          } else if (result.state) {
            cloudLoadStatus = { ok: true, message: "", at: Date.now() };
            cloud.baseline({ updatedAt: result.updatedAt, history: result.state.history });
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
            cloud.baseline({ updatedAt: cloud.lastUpdatedAt, history: [] });
            stateFp = makeFingerprint(state);
            await saveStateCloud();
          }
          stateFp = makeFingerprint(state);
          // Keep a local copy of what we just loaded/merged, so the app still shows
          // your data if it's next opened offline (and the copy is marked as current-schema).
          // Not awaited: this is just a local offline-cache backup of what was already
          // loaded above, so it shouldn't make the first render wait on it -- the state
          // snapshot it saves is captured immediately either way, before the async work
          // inside it (encryption, if this account has a passphrase) even begins.
          if (result.ok) saveStateRaw(state, encryptionKey).catch(e => diag.log("warn", "storage", "Local save after sign-in failed: " + ((e && e.message) || e)));
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
    if (!(await tryRestoreSessionKey(getLockConfig()))) await showLockScreen();
    state = await loadStateEncrypted(encryptionKey);
    await finishInit();
  }

  boot();
