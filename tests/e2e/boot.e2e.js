// Boot behaviour: what happens in the first moments after a page opens.
import { startApp, openDevice, makeChecker, seedLocal } from "./harness.js";
import { FOODS_JS, stateBlob } from "./helpers.js";

const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const app = await startApp(DIR, null, { "foods_data.js": FOODS_JS, "manifest.json": "{}" });
// Returns how long after `window.__probe = 1` was set the page went away (reloaded), or null if it stayed put for `ms`.
async function reloadedWithin(dev, ms) {
  await dev.eval(`window.__probe = 1`);
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    await sleep(40);
    if ((await dev.eval(`window.__probe`).catch(() => "ctx-lost")) !== 1) return Date.now() - t0;
  }
  return null;
}

t.section("FIRST VISIT: the page does not reload itself when the service worker takes control");
{
  const dev = await openDevice(app, { width: 390, height: 844, inject: seedLocal(stateBlob({})), wait: 50 });
  const reloaded = await reloadedWithin(dev, 3500);
  t.check("a brand-new page stays put for 3.5 seconds (it used to reload itself after about 300ms)", reloaded === null, `reloaded after ${reloaded}ms`);
  t.check("the service worker did install and take control in that time, so offline use still works", await dev.waitFor(`!!navigator.serviceWorker.controller`, 5000).then(() => true, () => false));
  t.check("and nothing was lost: the app is up and showing its food list", (await dev.eval(`document.getElementById("cc-food-list").children.length`)) > 0);
  t.check("no JS errors", (await dev.eval("window.__errs.length")) === 0 && dev.errors.length === 0, JSON.stringify(await dev.eval("window.__errs")));

  t.section("UPDATE: a new worker taking over a page that an older one controlled still reloads it");
  await dev.go("index.html", 600);                                   // second visit: the worker already controls this page at load
  t.check("sanity: this time the page was controlled from the start", await dev.eval(`!!navigator.serviceWorker.controller`));
  await dev.eval(`window.__probe = 1`);
  await dev.eval(`navigator.serviceWorker.dispatchEvent(new Event("controllerchange"))`);   // what a newly deployed worker does when it takes over
  const t0 = Date.now(); let gone = null;
  while (Date.now() - t0 < 4000) { await sleep(50); if ((await dev.eval(`window.__probe`).catch(() => "ctx-lost")) !== 1) { gone = Date.now() - t0; break; } }
  t.check("it reloads, so the tab runs the new code instead of the old", gone !== null, "never reloaded");
  await dev.waitFor(`document.getElementById("cc-food-list").children.length > 0`, 8000);
  t.check("and comes back up working", (await dev.eval(`document.getElementById("cc-food-list").children.length`)) > 0);
  dev.close();
}

t.section("PICTURES: the page's icon links load from assets/icons, and the service worker saves them for offline use");
{
  const dev = await openDevice(app, { width: 390, height: 844, inject: seedLocal(stateBlob({})), wait: 50 });
  const links = await dev.eval(`Array.from(document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"]')).map(l => l.getAttribute("href"))`);
  t.check("all four icon links point into assets/icons", links.length === 4 && links.every(h => h.startsWith("assets/icons/")), JSON.stringify(links));
  const sizes = await dev.eval(`Promise.all(${JSON.stringify(links)}.map(src => new Promise(res => { const i = new Image(); i.onload = () => res(src.split("/").pop() + " " + i.naturalWidth + "x" + i.naturalHeight); i.onerror = () => res(src.split("/").pop() + " FAILED"); i.src = src + "?t=" + Date.now(); })))`);
  t.check("and each loads as a real image of the right size", JSON.stringify(sizes.sort()) === JSON.stringify(["apple-touch-icon.png 180x180", "favicon-16.png 16x16", "favicon-32.png 32x32", "icon-192.png 192x192"]), JSON.stringify(sizes));
  t.check("the service worker installs", await dev.waitFor(`!!navigator.serviceWorker.controller`, 6000).then(() => true, () => false));
  const saved = await dev.eval(`(async () => { const out = []; for (const k of await caches.keys()) { const c = await caches.open(k); out.push(...(await c.keys()).map(r => new URL(r.url).pathname)); } return out; })()`);
  for (const n of ["favicon-16.png", "favicon-32.png", "icon-192.png", "apple-touch-icon.png"]) t.check(`it saved assets/icons/${n} for offline use`, saved.includes("/assets/icons/" + n), JSON.stringify(saved.filter(p => p.includes("icon"))));
  t.check("and nothing is cached from the old root icon paths", !saved.some(p => /^\/(favicon|icon-|apple-touch)/.test(p)));
  t.check("no JS errors", (await dev.eval("window.__errs.length")) === 0 && dev.errors.length === 0);
  dev.close();
}

await app.close();
process.exit(t.summary() ? 0 : 1);
