// The optional passphrase lock: real encryption (PBKDF2 + AES-GCM via the Web Crypto API, js/crypto.js), not a
// cosmetic login screen. It protects what's sitting in this browser's localStorage (e.g. on a shared device) and the
// copy synced to the cloud when signed in. It is NOT server-side auth: the passphrase never leaves the browser (only
// its salt and a verifier are stored with the account), and forgetting it means the data is unrecoverable by
// design -- there's no backdoor to build on a static site. Face ID / Touch ID is an optional shortcut on top.
import { decryptString, deriveKey, encryptString, exportKeyRaw, fromB64, importKeyRaw, randomBytes, toB64 } from "../crypto.js";
import { KEYS, SESSION_KEYS } from "../keys.js";
import { el } from "../ui/dom.js";
import { renderPrivacySection } from "../views/settings-general.js";
import { currentUser, saveStateCloud } from "./cloud.js";
import { saveState, saveStateRaw, state } from "./store.js";

const LOCK_KEY = KEYS.lock;
const SESSION_KEY_STORAGE = SESSION_KEYS.sessionKey; // sessionStorage: survives a reload, cleared when the tab/app actually closes
// The text every lock config's verifier decrypts to: decrypting it is how a passphrase (or a remembered key) is
// proven right without ever storing the passphrase.
const VERIFIER_TEXT = "insulin-buddy-unlock-check";

export let encryptionKey = null; // the derived CryptoKey, kept in memory (plus sessionStorage, see above) only while unlocked

export function getLockConfig() {
  try { return JSON.parse(localStorage.getItem(LOCK_KEY) || "null"); } catch { return null; }
}
export function isLockEnabled() { return !!getLockConfig(); }

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
export async function tryRestoreSessionKey(lockCfg) {
  if (!lockCfg) return false;
  try {
    const raw = sessionStorage.getItem(SESSION_KEY_STORAGE);
    if (!raw) return false;
    const key = await importKeyRaw(raw);
    const check = await decryptString(key, lockCfg.verifier);
    if (check !== VERIFIER_TEXT) { clearSessionKey(); return false; }
    encryptionKey = key;
    return true;
  } catch (e) { clearSessionKey(); return false; }
}

// ---- Face ID / Touch ID unlock (a convenience gate, not a cryptographic replacement for the
// passphrase -- see the settings copy for the honest trade-off this makes) ----
const FACEID_CRED_KEY = KEYS.faceIdCredential;
const DURABLE_KEY_STORAGE = KEYS.durableKey; // localStorage, not sessionStorage: survives a real close, gated by a fresh WebAuthn check each time rather than by encryption of the value itself
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
export function faceIdSupported() { return faceIdHardwareAvailable; }
export function isFaceIdEnabled() { return !!localStorage.getItem(FACEID_CRED_KEY); }

/** Registers a new platform-authenticator (Face ID / Touch ID) credential, then stashes the
 * *already-unlocked* key so a future WebAuthn success can reveal it without retyping the
 * passphrase. Must be called while already unlocked this session. */
export async function enrollFaceId() {
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
  localStorage.setItem(FACEID_CRED_KEY, toB64(new Uint8Array(cred.rawId)));
  localStorage.setItem(DURABLE_KEY_STORAGE, await exportKeyRaw(encryptionKey));
}
/** Forget the unlocked key everywhere this device keeps it: memory, this session, and the Face ID stash. */
export function forgetUnlockedKey() {
  disableFaceId();
  clearSessionKey();
  encryptionKey = null;
}
/** "Lock now": drop the key for this session and start again at the passphrase screen. */
export function lockNow() {
  clearSessionKey();
  encryptionKey = null;
  location.reload();
}
export function disableFaceId() {
  localStorage.removeItem(FACEID_CRED_KEY);
  localStorage.removeItem(DURABLE_KEY_STORAGE);
}
/** Prompts Face ID / Touch ID; on success, reveals the stashed key and re-verifies it against
 * the account's own check value before trusting it (same defensive pattern as
 * tryRestoreSessionKey -- a stale or mismatched entry safely falls through rather than
 * misbehaving). Returns false on any failure, cancellation, or unavailability -- callers
 * always keep the plain passphrase field as a fallback, never Face-ID-only. */
async function unlockWithFaceId(lockCfg) {
  const credId = localStorage.getItem(FACEID_CRED_KEY);
  if (!credId || !lockCfg) return false;
  try {
    await navigator.credentials.get({
      publicKey: { challenge: randomBytes(32), allowCredentials: [{ id: fromB64(credId), type: "public-key" }], userVerification: "required", timeout: 60000 }
    });
    const raw = localStorage.getItem(DURABLE_KEY_STORAGE);
    if (!raw) return false;
    const key = await importKeyRaw(raw);
    const check = await decryptString(key, lockCfg.verifier);
    if (check !== VERIFIER_TEXT) { disableFaceId(); return false; }
    encryptionKey = key;
    await persistSessionKey(key);
    return true;
  } catch (e) {
    return false; // cancelled, no match, hardware unavailable, etc.
  }
}

export async function setPassphrase(passphrase) {
  const salt = randomBytes(16);
  const key = await deriveKey(passphrase, salt);
  const verifier = await encryptString(key, VERIFIER_TEXT);
  localStorage.setItem(LOCK_KEY, JSON.stringify({ salt: toB64(salt), verifier }));
  encryptionKey = key;
  disableFaceId(); // any previously-enrolled Face ID unlock was tied to the old passphrase's key
  await persistSessionKey(key);
  await saveState(); // re-save current data encrypted immediately
}
export async function tryUnlock(passphrase) {
  const cfg = getLockConfig();
  if (!cfg) return true;
  try {
    const salt = fromB64(cfg.salt);
    const key = await deriveKey(passphrase, salt);
    const check = await decryptString(key, cfg.verifier);
    if (check !== VERIFIER_TEXT) return false;
    encryptionKey = key;
    await persistSessionKey(key);
    return true;
  } catch {
    return false;
  }
}
/** Signing in to a passphrase-protected account: first make sure this device has the account's lock config (only
 * the salt and a verifier that proves a guess right or wrong -- never the passphrase), adopting it if this device
 * has never seen it or another device has set a new one since. Then unlock: silently if this session already
 * did, otherwise at the passphrase screen. onWaiting(true / false) brackets the time spent waiting on a person. */
export async function unlockForAccount(requiredLock, onWaiting = () => {}) {
  const localCfg = getLockConfig();
  if (!localCfg || localCfg.salt !== requiredLock.salt) localStorage.setItem(LOCK_KEY, JSON.stringify(requiredLock));
  if (await tryRestoreSessionKey(requiredLock)) return;
  onWaiting(true);
  await showLockScreen();
  onWaiting(false);
}
export async function removePassphrase() {
  await saveStateRaw(state, null); // force a plaintext local write while we still have the key
  localStorage.removeItem(LOCK_KEY);
  encryptionKey = null;
  clearSessionKey();
  disableFaceId();
  if (currentUser) await saveStateCloud(); // push the plaintext copy + lock:null immediately, don't wait
}

// The passphrase screen, shown whenever a passphrase is required before going on: start-up on a locked device, or
// signing in to a locked account (see unlockForAccount). Resolves once unlocked; never resolves if nobody types.
export async function showLockScreen() {
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

/** Once the Face ID hardware check has answered, redraw the Privacy card if it's on screen (its toggle depends on it). */
export function initLock() {
  faceIdHardwareCheck.then(() => { if (state && !el("view-settings").hidden) renderPrivacySection(); });
}
