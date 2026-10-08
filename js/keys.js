// Every browser-storage key the app uses, in one place. Delete-all walks this list, so a new key added here is
// automatically wiped by "Delete Account & All Data" -- add new keys here rather than as string literals elsewhere.

export const KEYS = Object.freeze({
  state: "insulinBuddy.v2",                       // the app data (encrypted when a passphrase is set)
  lock: "insulinBuddy.lock",                      // passphrase salt + verifier (never the passphrase)
  faceIdCredential: "insulinBuddy.faceIdCredentialId",
  durableKey: "insulinBuddy.durableKey",          // the unlocked key, stashed for Face ID unlock
  pendingSync: "insulinBuddy.pendingSync",
  lastSnapshot: "insulinBuddy.lastSnapshot",
  draft: "insulinBuddy.draft",                    // the meal being built in the Calculator
  liveGlucose: "insulinBuddy.liveGlucose",
  diag: "insulinBuddy.diag",
  nsOutbox: "insulinBuddy.nsOutbox",
  nsQueueLegacy: "insulinBuddy.nsQueue"           // pre-2.0 Nightscout queue, migrated into nsOutbox on start
});

// sessionStorage (cleared when the tab or installed app closes).
export const SESSION_KEYS = Object.freeze({
  sessionKey: "insulinBuddy.sessionKey"
});
