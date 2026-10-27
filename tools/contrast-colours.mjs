// Readable versions of the theme colours (2.68.7). Pure colour maths, used by tools/make-tokens.mjs, so every theme in light
// and dark mode gets colours that meet WCAG AA by construction, whatever its base colours are. Only the lightness changes
// (in OKLCH), so each theme keeps its hue; chroma is reduced only when a shade would fall outside sRGB.

const toLin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const fromLin = c => { const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; return Math.round(Math.max(0, Math.min(1, v)) * 255); };
export const hexToRgb = h => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
export const rgbToHex = ([r, g, b]) => "#" + [r, g, b].map(v => v.toString(16).padStart(2, "0")).join("").toUpperCase();
export function luminance(hex) { const [r, g, b] = hexToRgb(hex).map(toLin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; }
export function contrast(a, b) { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
/** `top` at opacity `alpha` over `bottom` (both hex). */
export function over(top, alpha, bottom) { const t = hexToRgb(top), b = hexToRgb(bottom); return rgbToHex(t.map((v, i) => Math.round(v * alpha + b[i] * (1 - alpha)))); }

function toOklch(hex) {
  const [r, g, b] = hexToRgb(hex).map(toLin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
  return { L, C: Math.hypot(A, B), H: Math.atan2(B, A) };
}
function fromOklch({ L, C, H }) {
  const A = C * Math.cos(H), B = C * Math.sin(H);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3, m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3, s = (L - 0.0894841775 * A - 1.2914855480 * B) ** 3;
  const lin = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s];
  return { inGamut: lin.every(v => v >= -1e-4 && v <= 1 + 1e-4), hex: rgbToHex(lin.map(fromLin)) };
}
/** The same hue at lightness L, pulling chroma in only as far as needed to stay inside sRGB. */
function atLightness(base, L) {
  let C = base.C;
  for (let k = 0; k < 60; k++) { const o = fromOklch({ L, C, H: base.H }); if (o.inGamut) return o.hex; C *= 0.94; }
  return fromOklch({ L, C: 0, H: base.H }).hex;
}
/**
 * The colour closest to `hex` (only lightness changed) for which `ok(candidate)` holds, moving darker (`dir` -1) or lighter
 * (`dir` 1). Returns `hex` itself when it already passes.
 */
export function adjust(hex, ok, dir) {
  if (ok(hex)) return hex.toUpperCase();
  const base = toOklch(hex);
  for (let L = base.L; L >= 0 && L <= 1; L += 0.005 * dir) { const c = atLightness(base, L); if (ok(c)) return c; }
  return dir < 0 ? "#000000" : "#FFFFFF";
}

const WHITE = "#FFFFFF";
/**
 * For one theme in one mode:
 *  text  the accent as TEXT on the page and cards (>= 4.5:1 against every background in `pages`)
 *  fill  the accent as a FILLED control with white text on it (>= 4.5:1 for the white text)
 *  card1, card2  the dose card's two gradient colours: white text >= `cardRatio` even under the card's top sheen
 */
export function readableAccents({ a1, a2, pages, mode, sheen = 0.1, cardRatio = 4.6 }) {
  const textOk = c => pages.every(p => contrast(c, p) >= 4.6);
  const text = adjust(a1, textOk, mode === "dark" ? 1 : -1);
  const fillOk = c => contrast(WHITE, c) >= 4.6;
  const fill = adjust(a1, fillOk, -1);
  const cardOk = c => contrast(WHITE, c) >= cardRatio && contrast(WHITE, over(WHITE, sheen, c)) >= cardRatio;
  return { text, fill, card1: adjust(a1, cardOk, -1), card2: adjust(a2, cardOk, -1) };
}
