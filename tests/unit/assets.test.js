// THE ASSET RULE: every image, icon and piece of artwork lives under assets/ (assets/icons, assets/patterns).
// The main folder holds code, plus the two files that are yours (manifest.json and foods_data.js); nothing pictorial.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = new URL("../..", import.meta.url).pathname;
const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");
const IMAGE = /\.(png|jpe?g|gif|webp|avif|svg|ico|bmp)$/i;
const YOURS = new Set(["manifest.json", "foods_data.js"]);        // not part of the zip: they are your own files, in the main folder

test("no image is loose in the main folder or in js/: they all live in assets/", () => {
  for (const dir of ["", "js"]) {
    const strays = fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).filter(e => e.isFile() && IMAGE.test(e.name)).map(e => path.posix.join(dir, e.name));
    assert.deepEqual(strays, [], `images outside assets/: ${strays.join(", ")}. Put them in assets/icons or assets/patterns.`);
  }
});

test("assets/ has the icons and the pattern artwork, each icon exactly the size its name says", () => {
  const dims = f => { const b = fs.readFileSync(path.join(ROOT, f)); assert.deepEqual([...b.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${f} isn't a PNG`); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
  const expected = { "favicon-16.png": 16, "favicon-32.png": 32, "apple-touch-icon.png": 180, "icon-192.png": 192, "icon-512.png": 512 };
  for (const [name, px] of Object.entries(expected)) assert.deepEqual(dims("assets/icons/" + name), [px, px], `assets/icons/${name} should be ${px}x${px}`);
  for (const v of ["light", "dark"]) assert.ok(fs.existsSync(path.join(ROOT, `assets/patterns/pattern-abstract-${v}.svg`)), `assets/patterns/pattern-abstract-${v}.svg is missing`);
  const unexpected = fs.readdirSync(path.join(ROOT, "assets/icons")).filter(n => !(n in expected));
  assert.deepEqual(unexpected, [], "an icon file nothing knows about is in assets/icons");
});

test("every local file the app refers to exists, and every picture it refers to is under assets/", () => {
  const refs = [];                                                  // [where, path]
  for (const m of read("index.html").matchAll(/(?:href|src)="([^"#?:]+\.[a-z0-9]+)"/gi)) refs.push(["index.html", m[1]]);
  const sw = read("sw.js"), list = /PRECACHE_URLS = \[([\s\S]*?)\];/.exec(sw)[1];
  for (const m of list.matchAll(/"([^"]+)"/g)) if (m[1] !== "./") refs.push(["sw.js precache", m[1]]);
  for (const m of read("style.css").matchAll(/url\("([^"]+)"\)/g)) if (!m[1].startsWith("data:")) refs.push(["style.css", m[1]]);
  assert.ok(refs.length >= 15, `expected to find the app's file references, found ${refs.length}`);
  for (const [where, p] of refs) {
    if (YOURS.has(p)) continue;
    assert.ok(fs.existsSync(path.join(ROOT, p)), `${where} refers to ${p}, which doesn't exist`);
    if (IMAGE.test(p)) assert.ok(p.startsWith("assets/"), `${where} refers to the picture ${p}, which is outside assets/`);
  }
});

test("the service worker saves the icons from their new home, and nothing from the old root paths", () => {
  const list = /PRECACHE_URLS = \[([\s\S]*?)\];/.exec(read("sw.js"))[1];
  for (const n of ["favicon-16.png", "favicon-32.png", "icon-192.png", "apple-touch-icon.png"]) {
    assert.ok(list.includes(`"assets/icons/${n}"`), `sw.js should precache assets/icons/${n}`);
    assert.ok(!list.includes(`"${n}"`), `sw.js still precaches the old root path ${n}`);
  }
});

test("the tests' own sanity: the rule really would catch a stray image", () => {
  const stray = fs.writeFileSync(path.join(ROOT, "zz-stray-test.png"), "x");
  try { assert.throws(() => { const s = fs.readdirSync(ROOT, { withFileTypes: true }).filter(e => e.isFile() && IMAGE.test(e.name)); assert.deepEqual(s, []); }, /deepEqual|Expected/); }
  finally { fs.unlinkSync(path.join(ROOT, "zz-stray-test.png")); }
});
