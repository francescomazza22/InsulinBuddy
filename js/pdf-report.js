// Saves the doctor report as a real PDF, with no library and no print dialog. window.print() does nothing in an iPhone home-screen app,
// so the report is turned into a small PDF here: text as text (searchable, sharp at any zoom), charts as images.
// The writer is pure (Node-testable); only the DOM walking and the chart rasterising need a browser.

const A4 = { w: 595.28, h: 841.89 }, MARGIN = 42;
const SIZES = { h1: 18, h2: 14, h3: 11.5, p: 9.5, li: 9.5, row: 9.5 };

/** Text the PDF's built-in Helvetica can show (Latin-1); common typographic characters become plain equivalents. */
export function pdfSafe(text) {
  const map = { "–": "-", "—": "-", "−": "-", "‒": "-", "‘": "'", "’": "'", "“": '"', "”": '"', "•": "-", "→": "->", "≥": ">=", "≤": "<=", "…": "...", " ": " ", " ": " ", " ": " ", "★": "*" };
  return String(text == null ? "" : text).replace(/[^\x00-\xff]/g, c => map[c] ?? "?").replace(/[\x00-\x08\x0b-\x1f]/g, " ");
}
const esc = s => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

// Helvetica widths per 1000 em for the characters that matter; everything else uses an average. Close enough to wrap lines well.
const NARROW = "iljtfI.,:;'!|()[]/ ", WIDE = "mwMW@%";
function approxWidth(text, size, bold) {
  let w = 0;
  for (const ch of text) w += NARROW.includes(ch) ? 0.28 : WIDE.includes(ch) ? 0.86 : /[A-Z0-9]/.test(ch) ? 0.64 : 0.52;
  return w * size * (bold ? 1.06 : 1);
}

function wrap(text, width, size, bold, measure) {
  const out = [];
  for (const para of pdfSafe(text).split("\n")) {
    const words = para.split(/\s+/).filter(Boolean);
    let line = "";
    for (const w of words) {
      const t = line ? line + " " + w : w;
      if (measure(t, size, bold) <= width || !line) line = t; else { out.push(line); line = w; }
    }
    out.push(line);
  }
  return out;
}

/**
 * blocks: { type: "h1"|"h2"|"h3"|"p"|"li", text } | { type: "row", cols: [text], bold? } | { type: "img", jpeg: Uint8Array, w, h } | { type: "space", h }
 * Returns the PDF as a Uint8Array. `measure(text, size, bold)` can be supplied by the browser for exact wrapping.
 */
export function buildPdf(blocks, { title = "Report", measure = approxWidth } = {}) {
  const pages = [], images = [];
  let ops = [], y = MARGIN, pageNo = 0;
  const contentW = A4.w - MARGIN * 2;
  const newPage = () => { if (ops.length) pages.push({ ops, imgs: pageImgs }); ops = []; pageImgs = []; y = MARGIN; pageNo++; };
  let pageImgs = [];
  const need = h => { if (y + h > A4.h - MARGIN) newPage(); };
  const text = (s, x, size, bold) => { ops.push(`BT /${bold ? "F2" : "F1"} ${size} Tf ${x.toFixed(2)} ${(A4.h - y).toFixed(2)} Td (${esc(s)}) Tj ET`); };
  const rule = () => ops.push(`0.85 0.85 0.85 RG 0.5 w ${MARGIN} ${(A4.h - y).toFixed(2)} m ${(A4.w - MARGIN).toFixed(2)} ${(A4.h - y).toFixed(2)} l S`);
  newPage();
  for (const b of blocks) {
    if (b.type === "space") { y += b.h || 6; continue; }
    if (b.type === "img") {
      const w = Math.min(contentW, b.w), h = (b.h / b.w) * w;
      need(h + 6);
      images.push({ jpeg: b.jpeg, w: b.w, h: b.h });
      const id = images.length; pageImgs.push(id);
      y += h;
      ops.push(`q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${MARGIN} ${(A4.h - y).toFixed(2)} cm /Im${id} Do Q`);
      y += 8; continue;
    }
    if (b.type === "row") {
      const n = Math.max(1, b.cols.length), cw = contentW / n, size = SIZES.row, lh = size * 1.3;
      const cells = b.cols.map(c => wrap(c, cw - 8, size, !!b.bold, measure));
      const lines = Math.max(...cells.map(c => c.length));
      need(lines * lh + 5);
      const top = y;
      cells.forEach((cl, ci) => cl.forEach((ln, li) => { y = top + (li + 1) * lh; text(ln, MARGIN + ci * cw + 2, size, !!b.bold || (n === 2 && ci === 1)); }));
      y = top + lines * lh + 3; rule(); y += 2; continue;
    }
    const size = SIZES[b.type] || SIZES.p, bold = b.type === "h1" || b.type === "h2" || b.type === "h3", lh = size * 1.32;
    const indent = b.type === "li" ? 12 : 0;
    const lines = wrap((b.type === "li" ? "- " : "") + b.text, contentW - indent, size, bold, measure);
    const before = b.type === "h2" ? 10 : b.type === "h3" ? 6 : b.type === "h1" ? 0 : 0;
    need(before + Math.min(lines.length, 3) * lh + (bold ? 14 : 0));
    y += before;
    for (const ln of lines) { need(lh); y += lh; text(ln, MARGIN + indent, size, bold); }
    y += b.type === "h1" ? 6 : bold ? 3 : 4;
  }
  if (ops.length) pages.push({ ops, imgs: pageImgs });

  // ---- assemble the file ----
  const parts = [], offsets = [];
  let length = 0;
  const enc = s => { const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 255; return u; };
  const push = d => { const u = typeof d === "string" ? enc(d) : d; parts.push(u); length += u.length; };
  const objs = [];   // each: string | { head, stream }
  const add = o => { objs.push(o); return objs.length; };
  const fontReg = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const fontBold = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const imgIds = images.map(im => add({ head: `<< /Type /XObject /Subtype /Image /Width ${Math.round(im.w)} /Height ${Math.round(im.h)} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`, stream: im.jpeg }));
  const pagesId = objs.length + 1 + pages.length * 2 + 0;   // filled after pages are added
  const pageIds = [];
  for (const pg of pages) {
    const stream = enc(pg.ops.join("\n"));
    const contentId = add({ head: "<<", stream });
    const xo = pg.imgs.map(i => `/Im${i} ${imgIds[i - 1]} 0 R`).join(" ");
    pageIds.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${A4.w} ${A4.h}] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${fontReg} 0 R /F2 ${fontBold} 0 R >> /XObject << ${xo} >> >> >>`));
  }
  const pagesObj = add(`<< /Type /Pages /Kids [${pageIds.map(i => i + " 0 R").join(" ")}] /Count ${pageIds.length} >>`);
  const info = add(`<< /Title (${esc(pdfSafe(title))}) /Producer (Insulin Buddy) >>`);
  const catalog = add(`<< /Type /Catalog /Pages ${pagesObj} 0 R >>`);
  if (pagesObj !== pagesId) throw new Error("pdf: page tree numbering");
  push("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n");
  objs.forEach((o, i) => {
    offsets[i] = length;
    if (typeof o === "string") push(`${i + 1} 0 obj\n${o}\nendobj\n`);
    else { push(`${i + 1} 0 obj\n${o.head === "<<" ? `<< /Length ${o.stream.length} >>` : `${o.head} /Length ${o.stream.length} >>`}\nstream\n`); push(o.stream); push("\nendstream\nendobj\n"); }
  });
  const xref = length;
  push(`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map(o => String(o).padStart(10, "0") + " 00000 n \n").join("")}trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(length); let p = 0;
  for (const u of parts) { out.set(u, p); p += u.length; }
  return out;
}

// ---------------------------------------------------------------- browser side

/** Draws an inline <svg> to a JPEG, keeping the colours it shows on screen (its CSS variables and classes are resolved first). */
export async function svgToJpeg(svg, scale = 2) {
  const vb = (svg.getAttribute("viewBox") || "").split(/\s+/).map(Number);
  const r = svg.getBoundingClientRect();
  const w = vb.length === 4 && vb[2] ? vb[2] : r.width, h = vb.length === 4 && vb[3] ? vb[3] : r.height;
  if (!(w > 0 && h > 0)) return null;
  const clone = svg.cloneNode(true);
  const src = [svg, ...svg.querySelectorAll("*")], dst = [clone, ...clone.querySelectorAll("*")];
  const props = ["fill", "stroke", "stroke-width", "stroke-dasharray", "opacity", "fill-opacity", "stroke-opacity", "font-size", "font-weight", "font-family", "text-anchor"];
  src.forEach((el, i) => { const cs = getComputedStyle(el); dst[i].setAttribute("style", props.map(p => `${p}:${cs.getPropertyValue(p)}`).join(";")); });
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg"); clone.setAttribute("width", w); clone.setAttribute("height", h);
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml" }));
  try {
    const img = new Image(); img.decoding = "sync";
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error("chart could not be drawn")); img.src = url; });
    const c = document.createElement("canvas"); c.width = Math.round(w * scale); c.height = Math.round(h * scale);
    const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
    const b64 = c.toDataURL("image/jpeg", 0.92).split(",")[1], bin = atob(b64), u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return { jpeg: u, w: c.width, h: c.height };
  } finally { URL.revokeObjectURL(url); }
}

/** Reads the report on screen into blocks: headings, paragraphs, list items, table rows, stat boxes, and charts. */
export async function reportBlocks(root) {
  const blocks = [], clean = t => t.replace(/\s+/g, " ").trim();
  const walk = async node => {
    for (const el of node.children) {
      const tag = el.tagName.toLowerCase();
      if (el.hidden || getComputedStyle(el).display === "none") continue;
      if (tag === "h1" || tag === "h2" || tag === "h3") { const t = clean(el.textContent); if (t) blocks.push({ type: tag, text: t }); }
      else if (tag === "p") { const t = clean(el.textContent); if (t) blocks.push({ type: "p", text: t }); }
      else if (tag === "li") { const t = clean(el.textContent); if (t) blocks.push({ type: "li", text: t }); }
      else if (tag === "table") { for (const tr of el.querySelectorAll("tr")) { const cols = [...tr.children].map(c => clean(c.textContent)); if (cols.some(Boolean)) blocks.push({ type: "row", cols, bold: !!tr.querySelector("th") }); } blocks.push({ type: "space", h: 6 }); }
      else if (tag === "svg") { const im = await svgToJpeg(el); if (im) blocks.push({ type: "img", ...im }); }
      else if (el.classList.contains("report-stat-grid")) { blocks.push({ type: "row", cols: [...el.children].map(c => clean([...c.children].map(x => x.textContent).join(" "))), bold: true }); blocks.push({ type: "space", h: 6 }); }
      else if (el.children.length) await walk(el);
      else { const t = clean(el.textContent); if (t) blocks.push({ type: "p", text: t }); }
    }
  };
  await walk(root);
  return blocks;
}

/**
 * Runs fn with the light theme on, so charts are copied in paper colours (in dark mode their gridlines came out black and their
 * text pale on the white PDF). A cover in the current page colour hides the switch; the theme is put back even if fn fails.
 */
export async function withLightTheme(fn) {
  const html = document.documentElement;
  if (html.getAttribute("data-theme") !== "dark") return fn();
  const cover = document.createElement("div");
  cover.setAttribute("aria-hidden", "true");
  cover.style.cssText = `position:fixed;inset:0;z-index:2147483647;background:${getComputedStyle(document.body).backgroundColor || "#000"}`;
  document.body.appendChild(cover);
  html.setAttribute("data-theme", "light");
  try { return await fn(); }
  finally { html.setAttribute("data-theme", "dark"); cover.remove(); }
}

let measureCtx = null;
export const browserMeasure = (text, size, bold) => {
  if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d");
  measureCtx.font = `${bold ? "bold " : ""}${size}px Helvetica, Arial, sans-serif`;
  return measureCtx.measureText(text).width;
};

/** Makes the PDF from a report element, then shares it (Files, Mail, AirDrop on a phone) or downloads it. Returns "shared" | "downloaded". */
export async function saveReportPdf(root, { title, fileName }) {
  const blocks = await withLightTheme(() => reportBlocks(root));
  if (!blocks.length) throw new Error("The report is empty");
  const bytes = buildPdf(blocks, { title, measure: browserMeasure });
  const file = new File([bytes], fileName, { type: "application/pdf" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title }); return "shared"; }
    catch (e) { if (e && e.name === "AbortError") return "cancelled"; /* any other failure: fall through to a download */ }
  }
  const url = URL.createObjectURL(file), a = document.createElement("a");
  a.href = url; a.download = fileName; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return "downloaded";
}
