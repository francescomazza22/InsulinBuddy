// Two-step sign-in (TOTP authenticator codes) and "sign out other devices": the pure rules, no Supabase or DOM.
// The database enforces the same rule (supabase/mfa.sql): once a verified factor exists, only a session that passed the code
// check (aal2) can read or write anything. The app's job is to ask for the code BEFORE it touches the cloud copy, because an
// unverified session sees no rows and must never mistake that for "no data yet".

export const TOTP_FACTOR_NAME = "Insulin Buddy";
export const TOTP_ISSUER = "Insulin Buddy";

/** True when this session must enter a code before using the cloud (password done, code not yet). */
export function stepUpNeeded(aal) {
  return !!aal && aal.currentLevel === "aal1" && aal.nextLevel === "aal2";
}

/** Digits from whatever was typed or pasted ("123 456", "123-456"). */
export function cleanTotpCode(input) {
  return String(input ?? "").replace(/\D/g, "");
}

/** A usable authenticator code: exactly six digits once spaces and dashes are removed. */
export function validTotpCode(input) {
  return /^\d{6}$/.test(cleanTotpCode(input));
}

/** Verified TOTP factors from auth.mfa.listFactors() data, oldest first. */
export function verifiedTotp(listData) {
  const list = (listData && (listData.totp || listData.all)) || [];
  return list
    .filter(f => f && f.status === "verified" && (f.factor_type === undefined || f.factor_type === "totp"))
    .sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));
}

/** Half-finished set-ups (enrolled, never verified): removed before a new enrolment so the name doesn't clash. */
export function unverifiedTotp(listData) {
  const list = (listData && listData.all) || (listData && listData.totp) || [];
  return list.filter(f => f && f.status === "unverified" && (f.factor_type === undefined || f.factor_type === "totp"));
}

/** The set-up key in groups of four, easier to read and type into an authenticator app. */
export function groupSecret(secret) {
  return String(secret || "").replace(/\s+/g, "").replace(/(.{4})(?=.)/g, "$1 ");
}

/** Plain-English text for a failed code check. */
export function codeErrorText(error) {
  const msg = String((error && (error.message || error.code)) || error || "").toLowerCase();
  if (/invalid|incorrect|expired|mismatch/.test(msg)) return "That code didn't work. Check it's the current one for Insulin Buddy and try again.";
  if (/rate|too many|429/.test(msg)) return "Too many tries. Wait a minute, then enter a fresh code.";
  if (/network|fetch|offline|failed to fetch/.test(msg)) return "Couldn't reach the server. Check your connection and try again.";
  return "Couldn't check the code: " + ((error && error.message) || String(error || "unknown error"));
}

/** Supabase returns { error } objects; make every failure a real Error with a readable message. */
function asError(e) {
  if (e instanceof Error) return e;
  return new Error((e && (e.message || e.msg || e.code)) || String(e));
}

// ---- Sequencing over a Supabase-shaped `auth` client (supabase.auth), so it can be tested with a fake ----

/** What this session needs: "ok" (no factor, or code already given), "code" (must enter one).
 *  With the session's access token the library asks the server for the account's factors, so a device that signed in
 *  before two-step sign-in was turned on (its saved copy of the account lists no factor) is still asked. Offline, it falls
 *  back to the saved copy. Never throws: if the level can't be read the database still enforces the rule, so the app
 *  carries on and simply sees nothing. */
export async function sessionLevel(auth, accessToken) {
  const read = async jwt => {
    const { data, error } = jwt ? await auth.mfa.getAuthenticatorAssuranceLevel(jwt) : await auth.mfa.getAuthenticatorAssuranceLevel();
    if (error) throw asError(error);
    return stepUpNeeded(data) ? "code" : "ok";
  };
  if (accessToken) { try { return await read(accessToken); } catch { /* offline or token expired: use the saved copy */ } }
  try { return await read(); } catch { return "ok"; }
}

/** The verified authenticator factor to challenge, or null. */
export async function primaryTotp(auth) {
  const { data, error } = await auth.mfa.listFactors();
  if (error) throw asError(error);
  return verifiedTotp(data)[0] || null;
}

/** Check a typed code against the account's authenticator. Resolves { ok:true } or { ok:false, message }. */
export async function verifyCode(auth, factorId, input) {
  if (!validTotpCode(input)) return { ok: false, message: "Enter the 6-digit code from your authenticator app." };
  try {
    const { error } = await auth.mfa.challengeAndVerify({ factorId, code: cleanTotpCode(input) });
    if (error) return { ok: false, message: codeErrorText(error) };
    return { ok: true };
  } catch (e) { return { ok: false, message: codeErrorText(e) }; }
}

/** Start setting up an authenticator: clears half-finished attempts, then enrols. Resolves { factorId, qr, secret, uri }. */
export async function startTotpSetup(auth) {
  const listed = await auth.mfa.listFactors();
  if (listed.error) throw asError(listed.error);
  if (verifiedTotp(listed.data).length) throw new Error("Two-step sign-in is already on.");
  for (const f of unverifiedTotp(listed.data)) {
    const { error } = await auth.mfa.unenroll({ factorId: f.id });
    if (error) throw asError(error);
  }
  const { data, error } = await auth.mfa.enroll({ factorType: "totp", friendlyName: TOTP_FACTOR_NAME, issuer: TOTP_ISSUER });
  if (error) throw asError(error);
  const t = (data && data.totp) || {};
  return { factorId: data.id, qr: t.qr_code || "", secret: t.secret || "", uri: t.uri || "" };
}

/** Abandon a set-up that was never verified (sheet closed). Best effort. */
export async function cancelTotpSetup(auth, factorId) {
  try { await auth.mfa.unenroll({ factorId }); } catch { /* left over: cleared by the next startTotpSetup */ }
}

/** Turn two-step sign-in off (needs a session that passed the code check). */
export async function removeTotp(auth, factorId) {
  const { error } = await auth.mfa.unenroll({ factorId });
  if (error) throw asError(error);
  // The session keeps its aal2 label until refreshed; refresh so the app and the database agree straight away.
  try { await auth.refreshSession(); } catch { /* next automatic refresh does it */ }
}

/** Sign out every other device and browser; this one stays signed in. */
export async function signOutOtherDevices(auth) {
  const { error } = await auth.signOut({ scope: "others" });
  if (error) throw asError(error);
}
