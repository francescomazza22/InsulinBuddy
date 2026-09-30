// Passphrase-based encryption: PBKDF2 (derive a key from a passphrase + salt) then
// AES-GCM (encrypt/decrypt with that key). Used for the local passphrase lock, and
// for encrypting the copy of the data that goes to Supabase when a passphrase is set.
//
// This is real encryption via the Web Crypto API, not a cosmetic login screen. There
// is no backdoor: forgetting the passphrase makes the encrypted copy unrecoverable
// by design, on this static site.

export function randomBytes(n) {
  const arr = new Uint8Array(n);
  crypto.getRandomValues(arr);
  return arr;
}
export function toB64(bytes) {
  let binary = "";
  bytes.forEach(b => { binary += String.fromCharCode(b); });
  return btoa(binary);
}
export function fromB64(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function deriveKey(passphrase, saltBytes) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: saltBytes, iterations: 150000, hash: "SHA-256" },
    keyMaterial, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
  );
}

export async function encryptString(key, plaintext) {
  const iv = randomBytes(12);
  const enc = new TextEncoder();
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plaintext));
  return { iv: toB64(iv), data: toB64(new Uint8Array(ciphertext)) };
}

export async function decryptString(key, payload) {
  const iv = fromB64(payload.iv);
  const data = fromB64(payload.data);
  const buf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
  return new TextDecoder().decode(buf);
}

/** True if `x` has the {iv, data} shape encryptString produces -- used to tell an
 * encrypted cloud payload apart from a plain (unencrypted) state object. */
export function isEncryptedPayload(x) {
  return !!x && typeof x === "object" && !Array.isArray(x) && typeof x.iv === "string" && typeof x.data === "string";
}
