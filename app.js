// Insulin Buddy: start-up only. Everything else lives in js/ --
//   js/*.js           pure, unit-tested logic (dose maths, merge rules, history, glucose stats, Nightscout)
//   js/services/      the app's data and the outside world: local store, lock, cloud sync, Nightscout, glucose
//   js/ui/            shared screen pieces: element lookup, dialogs, sheets, toast, charts, icons
//   js/views/         one module per screen or sheet, each with an init function for its event wiring
// Modules only declare things when they load; all wiring happens in the init calls below, once every module has
// loaded, so the order modules happen to load in can never matter.
import { VERSION } from "./js/changelog.js";
import { KEYS } from "./js/keys.js";
import { adoptSignedInData, attemptReconnectSync, cloudSyncPending, currentUser, fetchAccountRow, handlePasswordRecovery, pullAndMerge, setCurrentUser, supabaseClient } from "./js/services/cloud.js";
import { diag, initDiagnostics } from "./js/services/diagnostics.js";
import { refreshLiveGlucose } from "./js/services/glucose-data.js";
import { encryptionKey, getLockConfig, initLock, isLockEnabled, unlockForAccount } from "./js/services/lock.js";
import { flushNightscoutQueue, initNightscoutSync, nsOutbox } from "./js/services/nightscout-sync.js";
import { adoptState, applyGiSeedPatch, loadLocalStateUnlocking, markStateBaseline, state, stateFp } from "./js/services/store.js";
import { el } from "./js/ui/dom.js";
import { initToast } from "./js/ui/toast.js";
import { initActiveInsulin, renderActivePanel } from "./js/views/active-insulin.js";
import { initBasal } from "./js/views/basal.js";
import { draft, initCalculator, recompute, renderFoodPickList, renderLiveGlucosePill, renderMealItems, renderRecentMeals, restoreDraftIfAny, saveDraftLocal } from "./js/views/calculator.js";
import { initGlucoseGuide } from "./js/views/glucose-guide.js";
import { initGlucose } from "./js/views/glucose.js";
import { initHistoryLog } from "./js/views/history-log.js";
import { initLibrary } from "./js/views/library.js";
import { initReport } from "./js/views/report.js";
import { initSettingsData } from "./js/views/settings-data.js";
import { initSettingsGeneral } from "./js/views/settings-general.js";
import { initSettings, panelRatios, renderTimeline } from "./js/views/settings.js";
import { applyTheme, initShell, renderEverything, showView, syncTabbarHeightVar } from "./js/views/shell.js";
import { initTrends } from "./js/views/trends.js";

// ================= App lifecycle =================
// The one place that reacts to the app coming back (network returns, or it's shown again) and to it going away.
//  * Back: retry a failed cloud sync and pull other devices' changes, resend the Nightscout queue straight away
//    (skipping its back-off wait), and refresh the live glucose. Phones don't always fire `online` (coming out of
//    a lift or a tunnel), so becoming visible again counts too.
//  * Away: save the in-progress meal. Per-action saves should already cover it, but iOS can discard a backgrounded
//    home-screen app at once, so it's saved at the actual "about to be hidden or unloaded" signals as well -- and
//    restored on `pageshow` in case the page came back from the back/forward cache rather than re-running boot.
function onAppResumed() {
  if (!state) return;   // still on the lock or loading screen
  attemptReconnectSync();
  flushNightscoutQueue(true);
  refreshLiveGlucose();
}
function initLifecycle() {
  window.addEventListener("online", onAppResumed);
  document.addEventListener("visibilitychange", () => { if (document.hidden) saveDraftLocal(); else onAppResumed(); });
  window.addEventListener("pagehide", saveDraftLocal);
  window.addEventListener("pageshow", e => { if (e.persisted) restoreDraftIfAny(); });
}

// Every 30 seconds: keep the auto-selected ratio, the settings timeline's "now" marker and the Active Insulin panel
// true to the clock, pull other devices' changes every 2 minutes, and keep Nightscout and the live glucose current.
function startClock() {
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

// The data is loaded (and unlocked): draw everything for the first time and start the background work.
async function finishInit() {
  document.documentElement.setAttribute("data-palette", state.settings.palette);
  applyTheme();
  if (!stateFp) markStateBaseline();
  applyGiSeedPatch();
  renderFoodPickList();
  renderMealItems();
  recompute();
  restoreDraftIfAny();
  renderActivePanel();
  renderRecentMeals();
  showView("calculator");
  syncTabbarHeightVar();

  nsOutbox.migrateLegacy(KEYS.nsQueueLegacy);
  flushNightscoutQueue();
  renderLiveGlucosePill();   // show the cached reading immediately, don't wait on the network
  refreshLiveGlucose();
  diag.log("info", "boot", `App started (v${VERSION}); ${state.history.length} meals; cloud ${currentUser ? "signed in" : "off"}`);
  startClock();
}

async function boot() {
  if (!supabaseClient) {                       // cloud sync not set up: this device's copy is all there is
    adoptState(await loadLocalStateUnlocking());
    await finishInit();
    return;
  }
  const loading = el("loading-screen");
  loading.hidden = false;
  let resolved = false;
  let awaitingPassphrase = false;   // the passphrase screen is up: waiting on a person, not a hang
  let lockAttempted = false;        // guards against onAuthStateChange firing more than once before the first attempt finishes (see below)
  const onWaiting = waiting => { awaitingPassphrase = waiting; };
  supabaseClient.auth.onAuthStateChange(async (event, session) => {
    if (event === "PASSWORD_RECOVERY") await handlePasswordRecovery();   // then carry on signing in with this same session
    if (session && session.user) {
      setCurrentUser(session.user);
      // Does this ACCOUNT require a passphrase? Prefer the cloud's record of it (the cross-device source of
      // truth) over whatever this device happens to know locally.
      const accountRow = await fetchAccountRow();
      const requiredLock = (!accountRow.error && accountRow.data && accountRow.data.lock) || getLockConfig();
      // Supabase can legitimately fire onAuthStateChange more than once during a normal sign-in (an initial
      // session restore followed by a SIGNED_IN event, for instance). Without this guard, a second firing while
      // the first lock/Face ID attempt is still pending would trigger a second, overlapping prompt. Once truly
      // unlocked, encryptionKey being set is what keeps later firings from re-prompting.
      if (requiredLock && !encryptionKey && !lockAttempted) {
        lockAttempted = true;
        await unlockForAccount(requiredLock, onWaiting);
      }
      await adoptSignedInData(accountRow);
    } else {
      setCurrentUser(null);
      onWaiting(isLockEnabled() && !encryptionKey);
      adoptState(await loadLocalStateUnlocking());
      onWaiting(false);
    }
    if (!resolved) { resolved = true; loading.hidden = true; await finishInit(); }
    else renderEverything();
  });
  // Safety net: if Supabase never responds (e.g. offline, or misconfigured), fall back to local-only rather than
  // leaving the app stuck loading. Not while the passphrase screen is waiting for someone to type: that isn't a hang.
  setTimeout(async () => {
    if (resolved || awaitingPassphrase) return;
    resolved = true;
    loading.hidden = true;
    adoptState(await loadLocalStateUnlocking());
    await finishInit();
  }, 4000);
}

// Diagnostics first, so anything that goes wrong while wiring up is logged.
initDiagnostics();
initNightscoutSync();
initLock();
initShell();
initToast();
initCalculator();
initActiveInsulin();
initGlucoseGuide();
initBasal();
initLibrary();
initHistoryLog();
initTrends();
initGlucose();
initReport();
initSettings();
initSettingsData();
initSettingsGeneral();
initLifecycle();
boot();
