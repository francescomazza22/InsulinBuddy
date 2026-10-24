// A stray "}" in a stylesheet is silently forgiven by browsers in the worst possible way: they glue it to the next rule's
// selector, which then matches nothing, so that whole rule vanishes. That is how the Undo bar lost all its styling
// (position, pill shape, slide-in) from 2.47.1 to 2.53.9. These checks walk every stylesheet's braces.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function braceProblems(css) {
  const problems = [];
  let depth = 0, line = 1;
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (c === "\n") { line++; continue; }
    if (c === "/" && css[i + 1] === "*") { const end = css.indexOf("*/", i + 2); for (let k = i; k < (end < 0 ? css.length : end); k++) if (css[k] === "\n") line++; i = end < 0 ? css.length : end + 1; continue; }
    if (c === '"' || c === "'") { let k = i + 1; while (k < css.length && css[k] !== c) { if (css[k] === "\\") k++; k++; } i = k; continue; }
    if (c === "{") depth++;
    if (c === "}") { depth--; if (depth < 0) { problems.push(`stray "}" on line ${line}`); depth = 0; } }
  }
  if (depth !== 0) problems.push(`${depth} "{" never closed`);
  return problems;
}

for (const file of ["style.css", "tokens.css"]) {
  test(`${file}: every brace is matched (no stray "}" swallowing the next rule)`, () => {
    assert.deepEqual(braceProblems(readFileSync(new URL(`../../${file}`, import.meta.url), "utf8")), []);
  });
}

test("the brace checker itself catches a stray brace and an unclosed block", () => {
  assert.deepEqual(braceProblems(".a { color: red; }\n}\n.b { color: blue; }"), ['stray "}" on line 2']);
  assert.deepEqual(braceProblems("@media (x) { .a { color: red; }"), ['1 "{" never closed']);
  assert.deepEqual(braceProblems('.a { content: "}"; } /* } */'), []);
});
