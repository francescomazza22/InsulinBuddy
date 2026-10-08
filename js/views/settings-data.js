// Settings > Data: System Status, Account & Sync, Nightscout, import / export, local backups and diagnostics.
import { VERSION } from "../changelog.js";
import { defaultState } from "../constants.js";
import { decryptString } from "../crypto.js";
import { recipeTotals } from "../foods.js";
import { cloudLoadStatus, cloudSaveBlocked, cloudSyncPending, currentUser, forceSyncNow, lastKnownCloudUpdatedAt, renderSyncStatus, saveStateCloud, signIn, signOut, signUp, supabaseClient } from "../services/cloud.js";
import { diag } from "../services/diagnostics.js";
import { backfillGlucoseHistory, clearLiveGlucose, refreshLiveGlucose } from "../services/glucose-data.js";
import { encryptionKey } from "../services/lock.js";
import { flushNightscoutQueue, friendlyNsError, nightscoutBaseUrl, nightscoutConfigured, nightscoutReadStatus, nightscoutWriteStatus, nsCfg, nsClient, nsFormat, nsOutbox } from "../services/nightscout-sync.js";
import { adoptState, backups, saveState, saveStateRaw, snapshotNow, state } from "../services/store.js";
import { SCHEMA_VERSION, prepareRestoredState } from "../state.js";
import { dialogs, el } from "../ui/dom.js";
import { escapeHtml, makeId, timeAgo } from "../util.js";
import { renderLiveGlucosePill, renderRecentMeals } from "./calculator.js";
import { renderHistory } from "./history-log.js";
import { renderLibrary } from "./library.js";
import { renderSettings, statusRow } from "./settings.js";
import { renderEverything } from "./shell.js";

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



function renderNsStatus(message, isError) {
  const box = el("ns-status");
  if (!box) return;
  box.textContent = message;
  box.style.color = isError ? "var(--brick)" : "";
}

// ---- Automatic local backups ----
export async function renderBackupsSection() {
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
    adoptState(prepareRestoredState(parsed, state, defaultState));
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
    version: VERSION,
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
    "glucose readings stored": glucoseRows,
    "service worker": sw
  };
}
export function renderDiagSection() {
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

export async function renderStatusPanel() {
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

export function renderNightscoutSection() {
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

export function renderAccountSection() {
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

/** Event wiring. Called once by app.js, after every module has loaded. */
export function initSettingsData() {
  el("backups-list").addEventListener("click", e => {
    const btn = e.target.closest("[data-restore]");
    if (btn) restoreSnapshot(Number(btn.dataset.restore));
  });
  el("btn-backup-now").addEventListener("click", async () => {
    await snapshotNow("manual");
    renderBackupsSection();
    dialogs.alert("Snapshot saved on this device.", { title: "Backed up" });
  });
  el("btn-diag-copy").addEventListener("click", async () => {
    const ok = await copyText(diag.report(await diagContext()));
    dialogs.alert(ok ? "Copied. Paste it into a message to share it." : "Couldn't copy automatically on this device.", { title: ok ? "Report copied" : "Copy failed" });
  });
  el("btn-diag-clear").addEventListener("click", async () => {
    if (await dialogs.confirm("Clear the diagnostics log?", { confirmText: "Clear" })) { diag.clear(); renderDiagSection(); }
  });
  el("btn-status-refresh").addEventListener("click", () => renderStatusPanel());

  el("btn-ns-backfill").addEventListener("click", async () => {
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
        const t = recipeTotals(r, state.library);
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
        snapshotNow("before-import");   // captured before anything below changes (see snapshotNow)
        let added = 0, updated = 0;
        imported.forEach(item => {
          if (!item.name) return;
          const existing = state.library.find(f => f.name.toLowerCase() === item.name.toLowerCase());
          if (existing) { Object.assign(existing, item, { id: existing.id }); updated++; }
          else { state.library.push({ id: makeId("food"), usageCount: 0, ...item }); added++; }
        });
        saveState();
        renderLibrary();
        renderSettings();
        dialogs.alert(`${added} added, ${updated} updated.`, { title: "Import complete" });
      } catch (err) {
        console.error(err);
        dialogs.alert("Could not read that file. Make sure it's a CSV or JSON export.", { title: "Import failed" });
      }
      e.target.value = "";
    };
    reader.readAsText(file);
  });

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
        snapshotNow("before-import");
        let foodsAdded = 0, foodsUpdated = 0, recipesAdded = 0, recipesUpdated = 0, historyAdded = 0;

        (data.library || []).forEach(item => {
          if (!item.name) return;
          const existing = state.library.find(f => f.name.toLowerCase() === item.name.toLowerCase());
          if (existing) { Object.assign(existing, item, { id: existing.id }); foodsUpdated++; }
          else { state.library.push({ ...item, id: item.id || makeId("food") }); foodsAdded++; }
        });
        (data.recipes || []).forEach(item => {
          if (!item.name) return;
          const existing = state.recipes.find(r => r.name.toLowerCase() === item.name.toLowerCase());
          if (existing) { Object.assign(existing, item, { id: existing.id }); recipesUpdated++; }
          else { state.recipes.push({ ...item, id: item.id || makeId("recipe") }); recipesAdded++; }
        });
        (data.history || []).forEach(entry => {
          if (!state.history.find(h => h.id === entry.id)) { state.history.push(entry); historyAdded++; }
        });
        state.history.sort((a, b) => b.ts - a.ts);

        saveState();
        renderLibrary(); renderHistory(); renderSettings(); renderRecentMeals();
        dialogs.alert(`Foods: ${foodsAdded} added, ${foodsUpdated} updated.\nRecipes: ${recipesAdded} added, ${recipesUpdated} updated.\nHistory: ${historyAdded} added.\n\nSettings were left untouched.`, { title: "Import complete" });
      } catch (err) {
        console.error(err);
        dialogs.alert("Could not read that file. Make sure it's a JSON backup exported from this app.", { title: "Import failed" });
      }
      e.target.value = "";
    };
    reader.readAsText(file);
  });

  el("ns-url").addEventListener("input", e => {
    state.settings.nightscoutUrl = e.target.value.trim();
    saveState();
    renderNightscoutSection();
    // The cached reading belongs to whatever server was configured before -- once the
    // URL changes it may be stale or from a different site entirely, so drop it rather
    // than show a number that looks live but isn't.
    clearLiveGlucose();
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
}
