import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { buildPdf, pdfSafe } from "../../js/pdf-report.js";

const latin = u => Buffer.from(u).toString("latin1");
const blocks = (n = 3) => [
  { type: "h1", text: "Insulin Buddy — Summary" }, { type: "p", text: "Period: last 14 days · average 122 mg/dL ≥ target" },
  { type: "h2", text: "Glucose" }, { type: "row", cols: ["Average glucose", "122 mg/dL"] }, { type: "row", cols: ["Time in range (70–180)", "99%"] },
  ...Array.from({ length: n }, (_, i) => ({ type: "p", text: `Line ${i} ` + "word ".repeat(80) })),
  { type: "li", text: "Pane (3×)" }
];

test("typographic characters become safe equivalents", () => {
  assert.equal(pdfSafe("a–b − ≥ → ★"), "a-b - >= -> *");
  assert.equal(pdfSafe("café · ×"), "café · ×");
  assert.equal(pdfSafe("中"), "?");
});
test("it is a well-formed PDF with a header, a trailer and one page per overflow", () => {
  const small = buildPdf(blocks(1), { title: "T" }), big = buildPdf(blocks(60), { title: "T" });
  assert.match(latin(small.slice(0, 8)), /^%PDF-1\.4/); assert.match(latin(small.slice(-6)), /%%EOF\n/);
  const pages = s => (latin(s).match(/\/Type \/Page /g) || []).length;
  assert.equal(pages(small), 1); assert.ok(pages(big) > 1, String(pages(big)));
});
test("qpdf and pdftotext accept it and the words are in it", { skip: !process.env.PATH.split(":").some(p => { try { execFileSync("sh", ["-c", "command -v qpdf && command -v pdftotext"], { stdio: "pipe" }); return true; } catch { return false; } }) }, () => {
  const dir = mkdtempSync(join(tmpdir(), "pdf-")), f = join(dir, "r.pdf");
  writeFileSync(f, buildPdf(blocks(40), { title: "Check" }));
  execFileSync("qpdf", ["--check", f], { stdio: "pipe" });
  const txt = execFileSync("pdftotext", ["-layout", f, "-"]).toString();
  assert.match(txt, /Insulin Buddy - Summary/); assert.match(txt, /Average glucose\s+122 mg\/dL/); assert.match(txt, /Time in range \(70-180\)\s+99%/); assert.match(txt, /Line 39/);
});
test("a chart image is embedded", () => {
  // a tiny valid 1x1 JPEG
  const jpeg = Uint8Array.from(Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=", "base64"));
  const pdf = buildPdf([{ type: "p", text: "Chart" }, { type: "img", jpeg, w: 200, h: 100 }], { title: "I" });
  assert.match(latin(pdf), /\/Subtype \/Image/); assert.match(latin(pdf), /\/Im1 Do/);
});
