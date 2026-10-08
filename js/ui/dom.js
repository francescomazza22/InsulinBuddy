// The two things every screen needs: element lookup and the app's own dialogs (alert / confirm / prompt that match
// the app, work in the installed app and never echo a password -- see js/dialogs.js).
import { createDialogs } from "../dialogs.js";

/** document.getElementById. A function declaration, so it's usable from any module however they load. */
export function el(id) { return document.getElementById(id); }

export const dialogs = createDialogs(document);
