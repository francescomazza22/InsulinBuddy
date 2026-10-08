// The app's diagnostics log (js/diag.js): what went wrong with sync, Nightscout or anything else, readable from the
// phone in Settings > Data > Diagnostics, with credentials blanked out.
import { createDiag, hookGlobalErrors } from "../diag.js";
import { KEYS } from "../keys.js";

// Anything that holds a credential registers it here, so diag can blank it out of every log line and report.
const diagSecretSources = [];
export function addDiagSecret(getSecret) { diagSecretSources.push(getSecret); }
const diagSecrets = () => diagSecretSources.flatMap(get => { try { const s = get(); return s ? [s] : []; } catch { return []; } });

export const diag = createDiag({ storage: localStorage, key: KEYS.diag, secrets: diagSecrets });

/** Route uncaught errors and blocked-by-CSP events into the log. Called first, so start-up problems are caught too. */
export function initDiagnostics() {
  hookGlobalErrors(window, diag);
}
