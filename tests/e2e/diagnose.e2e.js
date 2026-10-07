// The file-check page (diagnose.html), in a real browser, against sites built to look like each way a deployment can go.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startApp, openDevice, makeChecker } from "./harness.js";
import { FOODS_JS } from "./helpers.js";

const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker();
const sleep = ms => new Promise(r => setTimeout(r, ms));
// The page (rightly) treats a food list under 500 bytes as an empty placeholder, and the standard test list is smaller than that.
const FOODS = FOODS_JS + "\n// " + "padding so this counts as a real food list. ".repeat(20);
const NEW_MANIFEST = JSON.stringify({ name: "Insulin Buddy", icons: [{ src: "assets/icons/icon-192.png" }, { src: "assets/icons/icon-512.png" }] });
const OLD_MANIFEST = JSON.stringify({ name: "Insulin Buddy", icons: [{ src: "icon-192.png" }, { src: "icon-512.png" }] });

/** A copy of the site as it would sit on the server (just the deployed files), then `mutate(dir)` to break or change it. */
function site(mutate = () => {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ib-site-"));
  for (const f of ["index.html", "app.js", "style.css", "sw.js", "diagnose.html"]) fs.copyFileSync(path.join(DIR, f), path.join(dir, f));
  fs.cpSync(path.join(DIR, "js"), path.join(dir, "js"), { recursive: true });
  fs.cpSync(path.join(DIR, "assets"), path.join(dir, "assets"), { recursive: true });
  mutate(dir);
  return dir;
}
async function check(name, dir, manifest, fn) {
  t.section(name);
  const app = await startApp(dir, null, { "foods_data.js": FOODS, "manifest.json": manifest });
  const dev = await openDevice(app, { width: 420, height: 900, mobile: false, path: "diagnose.html", wait: 500 });
  await dev.waitFor(`document.getElementById("verdict").dataset.state !== "wait"`, 20000);
  await sleep(300);
  const view = {
    state: await dev.eval(`document.getElementById("verdict").dataset.state`),
    todo: await dev.eval(`Array.from(document.querySelectorAll("#todo li")).map(l => l.textContent.replace(/\\s+/g, " ").trim())`),
    rows: await dev.eval(`Array.from(document.querySelectorAll("#files tr")).map(r => r.textContent.replace(/\\s+/g, " ").trim())`),
    headline: await dev.text("#vt")
  };
  await fn(view);
  dev.close(); await app.close(); fs.rmSync(dir, { recursive: true, force: true });
}
const has = (list, re) => list.some(x => re.test(x));

await check("A CORRECT DEPLOYMENT: green, with the pictures in assets/ and manifest.json pointing at them", site(), NEW_MANIFEST, v => {
  t.check("the verdict is green", v.state === "ok", `${v.state}: ${v.headline} | ${v.todo.join(" | ")}`);
  t.check("every icon and both patterns are listed as found", ["favicon-16", "favicon-32", "icon-192", "icon-512", "apple-touch-icon"].every(n => has(v.rows, new RegExp(`assets/icons/${n}.png.*present`))) && has(v.rows, /assets\/patterns\/pattern-abstract-light.svg.*correct/) && has(v.rows, /assets\/patterns\/pattern-abstract-dark.svg.*correct/), JSON.stringify(v.rows.filter(r => r.includes("assets"))));
  t.check("manifest.json's icons are checked and found", has(v.rows, /manifest.json icons.*all 2 found/), JSON.stringify(v.rows.filter(r => r.includes("manifest"))));
  t.check("there is nothing to fix", !has(v.todo, /manifest|old copy|missing/i), v.todo.join(" | "));
});

await check("YOUR manifest.json STILL POINTS AT THE OLD ICON PATHS (and the icons have moved): amber, with the exact fix", site(), OLD_MANIFEST, v => {
  t.check("amber, not red: only the Home Screen icon is affected", v.state === "warn", `${v.state}: ${v.headline}`);
  t.check("it names the bad path", has(v.todo, /manifest\.json.*points to icon-192\.png/), v.todo.join(" | "));
  t.check("and says exactly what to change it to", has(v.todo, /change icon-192\.png to assets\/icons\/icon-192\.png/) && has(v.todo, /change icon-512\.png to assets\/icons\/icon-512\.png/), v.todo.join(" | "));
});

await check("OLD COPIES LEFT IN THE MAIN FOLDER (manifest still using them, which works): still green, with a tidy-up note", site(d => { for (const n of ["favicon-16.png", "icon-192.png", "icon-512.png"]) fs.copyFileSync(path.join(d, "assets/icons", n), path.join(d, n)); }), OLD_MANIFEST, v => {
  t.check("the verdict stays green: leftovers are harmless", v.state === "ok", `${v.state}: ${v.headline}`);
  t.check("but it notes the old copies and where they now live", has(v.todo, /old copy of icon-192\.png is still in the main folder.*assets\/icons\/icon-192\.png/) && has(v.todo, /old copy of favicon-16\.png/), v.todo.join(" | "));
  t.check("and says when they can be deleted", has(v.todo, /delete the old one once manifest\.json points at the new location/), v.todo.join(" | "));
});

await check("AN ICON IS MISSING: amber (the app runs fine without it), saying which folder it belongs in", site(d => fs.rmSync(path.join(d, "assets/icons/icon-512.png"))), NEW_MANIFEST, v => {
  t.check("amber, not red", v.state === "warn", `${v.state}: ${v.headline}`);
  t.check("it names the missing file and its folder", has(v.todo, /assets\/icons\/icon-512\.png is missing/) && has(v.todo, /into the "assets\/icons" folder/), v.todo.join(" | "));
});

await check("A PATTERN FILE IS MISSING: amber, not red", site(d => fs.rmSync(path.join(d, "assets/patterns/pattern-abstract-dark.svg"))), NEW_MANIFEST, v => {
  t.check("amber, not red", v.state === "warn", `${v.state}: ${v.headline}`);
  t.check("it says which file and folder", has(v.todo, /assets\/patterns\/pattern-abstract-dark\.svg is missing/) && has(v.todo, /"assets\/patterns" folder/), v.todo.join(" | "));
});

await check("A STAMPED SVG: provenance metadata inside the artwork does not make a correct file look wrong", site(d => {
  const p = path.join(d, "assets/patterns/pattern-abstract-light.svg"); const s = fs.readFileSync(p, "utf8");
  fs.writeFileSync(p, s.replace(/^<svg ([^>]*)>/, '<svg $1 xmlns:c2pa="http://c2pa.org/manifest"><metadata><c2pa:manifest>AAAWgmp1bWIAAAAeanVtZGMycGEAEQAQgAAAqgA4m3ED</c2pa:manifest></metadata>'));
}), NEW_MANIFEST, v => {
  t.check("still green", v.state === "ok", `${v.state}: ${v.headline} | ${v.todo.join(" | ")}`);
  t.check("and that file is listed as correct", has(v.rows, /pattern-abstract-light\.svg.*correct/), JSON.stringify(v.rows.filter(r => r.includes("light"))));
});

await check("A REAL EDIT TO THE ARTWORK IS STILL NOTICED", site(d => { const p = path.join(d, "assets/patterns/pattern-abstract-dark.svg"); fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace('opacity="0.18"', 'opacity="0.6"')); }), NEW_MANIFEST, v => {
  t.check("amber, and says the file differs", v.state === "warn" && has(v.rows, /pattern-abstract-dark\.svg.*differs from/), `${v.state} ${JSON.stringify(v.rows.filter(r => r.includes("dark")))}`);
});

await check("A MISSING CODE FILE IS STILL A REAL PROBLEM: red (the softer treatment is only for pictures)", site(d => fs.rmSync(path.join(d, "style.css"))), NEW_MANIFEST, v => {
  t.check("red", v.state === "bad", `${v.state}: ${v.headline}`);
  t.check("it says style.css is missing", has(v.todo, /style\.css is missing/), v.todo.join(" | "));
});

process.exit(t.summary() ? 0 : 1);
