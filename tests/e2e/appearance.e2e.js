// The Background > Pattern option (doodles), end to end.
import { startApp, openDevice, makeChecker, seedLocal } from "./harness.js";
import { FOODS_JS, localState, stateBlob } from "./helpers.js";

const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const app = await startApp(DIR, null, { "foods_data.js": FOODS_JS, "manifest.json": "{}" });
const noErrors = async (dev, label) => t.check(`${label}: no JS errors`, (await dev.eval("window.__errs.length")) === 0 && dev.errors.length === 0, JSON.stringify(await dev.eval("window.__errs")));
const bodyBg = (dev, prop = "backgroundImage") => dev.eval(`getComputedStyle(document.body)[${JSON.stringify(prop)}]`);
const attr = dev => dev.eval(`document.documentElement.getAttribute("data-bg-pattern")`);
const tile = async dev => parseFloat(await bodyBg(dev, "backgroundSize"));
const openBackgroundSettings = async dev => {
  await dev.tab("settings"); await sleep(250);
  await dev.eval(`document.querySelector('#settings-segmented [data-seg="general"]').click()`); await sleep(300);
};

async function fresh(name, extra = {}) {
  t.section(name);
  // Seed only when storage is empty. (seedLocal on its own rewrites the starting state on EVERY page load, which would wipe
  // out whatever was saved before a reload and make a persistence test impossible.)
  const seedOnce = `if (!localStorage.getItem("insulinBuddy.v2")) { ${seedLocal(stateBlob({}))} }`;
  const dev = await openDevice(app, { width: 390, height: 844, inject: seedOnce, wait: 1500, ...extra });
  await dev.waitFor(`document.getElementById("cc-food-list").children.length > 0`);
  return dev;
}

{
  const dev = await fresh("DEFAULT: no pattern, so nothing changes for anyone who doesn't choose it");
  t.check("the pattern is off", (await attr(dev)) === "none");
  t.check("the page has a plain background (no image)", (await bodyBg(dev)) === "none");
  await openBackgroundSettings(dev);
  t.check("Settings offers three choices: Plain, Doodles and Abstract", JSON.stringify(await dev.eval(`Array.from(document.querySelectorAll("#bg-pattern-grid .pattern-card")).map(c => c.textContent.trim())`)) === JSON.stringify(["Plain", "Doodles", "Abstract"]));
  t.check("Plain is the selected one", await dev.eval(`document.querySelector('#bg-pattern-grid [data-pattern="none"]').classList.contains("is-selected") && document.querySelector('#bg-pattern-grid [data-pattern="none"]').getAttribute("aria-pressed") === "true"`));
  t.check("the Doodles card previews the pattern", (await dev.eval(`getComputedStyle(document.querySelector(".pattern-card__preview--doodles")).backgroundImage`)).startsWith('url("data:image/svg+xml,'));
  await noErrors(dev, "default");
  dev.close();
}

{
  const dev = await fresh("CHOOSING IT: applies at once, is remembered, and survives a reload");
  await openBackgroundSettings(dev);
  await dev.click('#bg-pattern-grid [data-pattern="doodles"]'); await sleep(250);
  t.check("the pattern switches on", (await attr(dev)) === "doodles");
  t.check("the page now has the doodle drawing behind it", (await bodyBg(dev)).startsWith('url("data:image/svg+xml,'), (await bodyBg(dev)).slice(0, 60));
  t.check("the Doodles card is now the selected one, and Plain isn't", await dev.eval(`document.querySelector('#bg-pattern-grid [data-pattern="doodles"]').classList.contains("is-selected") && !document.querySelector('#bg-pattern-grid [data-pattern="none"]').classList.contains("is-selected")`));
  t.check("it is saved in your settings (so it syncs between your devices)", (await localState(dev)).settings.backgroundPattern === "doodles");
  await dev.go("index.html", 900); await dev.waitFor(`document.getElementById("cc-food-list").children.length > 0`);
  t.check("after a reload it is still on", (await attr(dev)) === "doodles" && (await bodyBg(dev)).startsWith('url("data:image/svg+xml,'));
  await openBackgroundSettings(dev);
  t.check("and Settings still shows Doodles selected", await dev.eval(`document.querySelector('#bg-pattern-grid [data-pattern="doodles"]').classList.contains("is-selected")`));
  await dev.click('#bg-pattern-grid [data-pattern="none"]'); await sleep(250);
  t.check("choosing Plain removes it again", (await attr(dev)) === "none" && (await bodyBg(dev)) === "none" && (await localState(dev)).settings.backgroundPattern === "none");
  await noErrors(dev, "choosing");
  dev.close();
}

{
  const dev = await fresh("DARK MODE: a light-ink drawing on the dark background, and a colour choice still works with it", {});
  await openBackgroundSettings(dev);
  await dev.click('#bg-pattern-grid [data-pattern="doodles"]'); await sleep(200);
  const light = await bodyBg(dev);
  await dev.eval(`document.documentElement.setAttribute("data-theme", "dark")`); await sleep(150);
  const dark = await bodyBg(dev);
  t.check("dark mode switches to the dark version of the drawing", dark !== light && dark.startsWith('url("data:image/svg+xml,') && dark.includes("%23ECEAE3") && light.includes("%231B2A3A"), `${light.slice(-30)} / ${dark.slice(-30)}`);
  await dev.eval(`document.documentElement.setAttribute("data-theme", "light")`); await sleep(150);
  await dev.click('#bg-swatch-grid [data-color="#E1EDF7"]'); await sleep(250);
  t.check("picking a background color keeps the pattern on top of it", (await attr(dev)) === "doodles" && (await bodyBg(dev)).startsWith('url("data:image/svg+xml,') && (await bodyBg(dev, "backgroundColor")) === "rgb(225, 237, 247)", await bodyBg(dev, "backgroundColor"));
  await dev.click('#bg-pattern-grid [data-pattern="none"]'); await sleep(200);
  t.check("turning the pattern off leaves the color you picked", (await bodyBg(dev, "backgroundColor")) === "rgb(225, 237, 247)" && (await bodyBg(dev)) === "none");
  await noErrors(dev, "dark");
  dev.close();
}

{
  const dev = await fresh("SIZES: Small by default (a fine texture, like a wallpaper), with Medium and Large, all sharp vectors that grow only gently with the screen");
  await dev.eval(`document.documentElement.setAttribute("data-bg-pattern", "doodles")`);
  const measure = async () => { const out = {}; for (const [name, w, h] of [["phone", 390, 844], ["ipad", 820, 1180], ["laptop", 1440, 900], ["huge", 3000, 1600]]) { await dev.resize(w, h); await sleep(250); out[name] = await tile(dev); } return out; };
  const near = (a, b) => Math.abs(a - b) < 1;
  t.check("the default size is Small", (await attr(dev)) === "doodles" && (await dev.eval(`document.documentElement.getAttribute("data-bg-pattern-size")`)) === "small");
  const small = await measure();
  t.check("SMALL: 150px on a phone (it used to be 320: that was too big)", small.phone === 150, JSON.stringify(small));
  t.check("SMALL: only 163px on an iPad and 188px on a laptop, so it doesn't balloon on a big screen", near(small.ipad, 162.8) && near(small.laptop, 187.6), JSON.stringify(small));
  t.check("SMALL: never more than 200px, even on a huge monitor", small.huge === 200, JSON.stringify(small));
  await dev.eval(`document.documentElement.setAttribute("data-bg-pattern-size", "medium")`);
  const medium = await measure();
  t.check("MEDIUM: about 221px on a phone, 256px on an iPad, capped at 300px", near(medium.phone, 221.2) && near(medium.ipad, 255.6) && medium.laptop === 300 && medium.huge === 300, JSON.stringify(medium));
  await dev.eval(`document.documentElement.setAttribute("data-bg-pattern-size", "large")`);
  const large = await measure();
  t.check("LARGE: the original look, 320px on a phone up to 520px", large.phone === 320 && near(large.ipad, 374.8) && near(large.laptop, 461.6) && large.huge === 520, JSON.stringify(large));
  t.check("every size only ever gets bigger as the screen does", [small, medium, large].every(m => m.phone <= m.ipad && m.ipad <= m.laptop && m.laptop <= m.huge));
  t.check("and each size is clearly bigger than the one before it, on every screen", ["phone", "ipad", "laptop", "huge"].every(k => small[k] < medium[k] && medium[k] < large[k]));
  t.check("the drawing is a vector (SVG), so it is crisp at any pixel density", (await bodyBg(dev)).includes("image/svg+xml"));
  await noErrors(dev, "sizes");
  dev.close();
}

{
  const dev = await fresh("THE SIZE CHOICE: appears with the pattern, applies at once, is remembered, and bad saved values fall back safely");
  await openBackgroundSettings(dev);
  t.check("no size choice while the background is Plain (there is nothing to size)", await dev.eval(`document.getElementById("bg-pattern-size").hidden`));
  await dev.click('#bg-pattern-grid [data-pattern="doodles"]'); await sleep(250);
  t.check("choosing Doodles reveals Small / Medium / Large", !(await dev.eval(`document.getElementById("bg-pattern-size").hidden`)) && JSON.stringify(await dev.eval(`Array.from(document.querySelectorAll("#bg-pattern-size [data-size]")).map(b => b.textContent.trim())`)) === JSON.stringify(["Small", "Medium", "Large"]));
  t.check("Small is the one selected", await dev.eval(`document.querySelector('#bg-pattern-size [data-size="small"]').classList.contains("is-active") && document.querySelector('#bg-pattern-size [data-size="small"]').getAttribute("aria-pressed") === "true"`));
  t.check("on a phone the tile starts at 150px", (await tile(dev)) === 150);
  await dev.click('#bg-pattern-size [data-size="large"]'); await sleep(250);
  t.check("choosing Large applies at once (320px) and marks Large selected", (await tile(dev)) === 320 && (await dev.eval(`document.querySelector('#bg-pattern-size [data-size="large"]').classList.contains("is-active")`)) && !(await dev.eval(`document.querySelector('#bg-pattern-size [data-size="small"]').classList.contains("is-active")`)));
  t.check("the Doodles preview card changes size with it", parseFloat(await dev.eval(`getComputedStyle(document.querySelector(".pattern-card__preview--doodles")).backgroundSize`)) === 320);
  t.check("it is saved in your settings", (await localState(dev)).settings.backgroundPatternSize === "large");
  await dev.go("index.html", 900); await dev.waitFor(`document.getElementById("cc-food-list").children.length > 0`);
  t.check("after a reload it is still Large", (await tile(dev)) === 320);
  await dev.click('#bg-pattern-size [data-size="medium"]').catch(() => {});
  await openBackgroundSettings(dev); await dev.click('#bg-pattern-size [data-size="medium"]'); await sleep(250);
  t.check("Medium works too (221px)", Math.abs((await tile(dev)) - 221.2) < 1);
  await dev.click('#bg-pattern-grid [data-pattern="none"]'); await sleep(250);
  t.check("going back to Plain hides the size choice again, but remembers it", await dev.eval(`document.getElementById("bg-pattern-size").hidden`) && (await localState(dev)).settings.backgroundPatternSize === "medium");
  await noErrors(dev, "size choice");
  dev.close();

  const bad = await openDevice(app, { width: 390, height: 844, inject: `if (!localStorage.getItem("insulinBuddy.v2")) { ${seedLocal(stateBlob({ settings: { backgroundPattern: "doodles", backgroundPatternSize: "gigantic" } }))} }`, wait: 1500 });
  await bad.waitFor(`document.getElementById("cc-food-list").children.length > 0`);
  t.check("a damaged or unknown saved size falls back to Small instead of breaking the pattern", (await bad.eval(`document.documentElement.getAttribute("data-bg-pattern-size")`)) === "small" && (await tile(bad)) === 150);
  await noErrors(bad, "bad value");
  bad.close();
}

{
  const dev = await fresh("ABSTRACT: the artwork-based pattern really draws, in light and dark, and has its own three sizes");
  await openBackgroundSettings(dev);
  t.check("its card previews the artwork", /pattern-abstract-light\.svg/.test(await dev.eval(`getComputedStyle(document.querySelector(".pattern-card__preview--abstract")).backgroundImage`)));
  await dev.click('#bg-pattern-grid [data-pattern="abstract"]'); await sleep(300);
  t.check("choosing Abstract switches it on, and its card is the selected one", (await attr(dev)) === "abstract" && await dev.eval(`document.querySelector('#bg-pattern-grid [data-pattern="abstract"]').classList.contains("is-selected")`));
  t.check("the page uses the light artwork", /pattern-abstract-light\.svg/.test(await bodyBg(dev)), (await bodyBg(dev)).slice(-60));
  t.check("the size choice is available for it too, Small selected", !(await dev.eval(`document.getElementById("bg-pattern-size").hidden`)) && await dev.eval(`document.querySelector('#bg-pattern-size [data-size="small"]').classList.contains("is-active")`));

  // The check that matters most. A file with a stray tag is silently ignored by the browser and the pattern simply never
  // appears (which is exactly how the first version of this one shipped), so each file is loaded as a real image and drawn.
  const probe = url => dev.eval(`new Promise(res => {
    const img = new Image();
    img.onload = () => { const c = document.createElement("canvas"); c.width = c.height = 300; const x = c.getContext("2d"); x.drawImage(img, 0, 0, 300, 300);
      const d = x.getImageData(0, 0, 300, 300).data; let drawn = 0, maxA = 0; for (let i = 3; i < d.length; i += 4) { if (d[i] > 0) drawn++; if (d[i] > maxA) maxA = d[i]; }
      res({ size: img.naturalWidth + "x" + img.naturalHeight, drawnShare: drawn / (300 * 300), maxAlpha: maxA }); };
    img.onerror = () => res({ size: "FAILED to load as an image" });
    img.src = ${JSON.stringify(url)} + "?t=" + Date.now(); })`);
  for (const [name, maxAlpha] of [["light", 0.2], ["dark", 0.18]]) {
    const r = await probe(`assets/patterns/pattern-abstract-${name}.svg`);
    t.check(`the ${name} file loads as a real 300x300 image`, r.size === "300x300", JSON.stringify(r));
    t.check(`...and actually draws shapes (not blank): ${(r.drawnShare * 100).toFixed(0)}% of the tile is covered`, r.drawnShare > 0.25 && r.drawnShare < 0.97, JSON.stringify(r));
    t.check(`...and only faintly (no pixel stronger than ${maxAlpha * 100}%), so it can't swamp the text`, r.maxAlpha <= Math.round(255 * maxAlpha) + 2 && r.maxAlpha > 0, JSON.stringify(r));
  }
  const served = await dev.eval(`Promise.all(["light", "dark"].map(n => fetch("assets/patterns/pattern-abstract-" + n + ".svg").then(r => r.status + " " + r.headers.get("content-type"))))`);
  t.check("both files are delivered as SVG images", served.every(x => /^200 image\/svg\+xml/.test(x)), JSON.stringify(served));

  await dev.eval(`document.documentElement.setAttribute("data-theme", "dark")`); await sleep(200);
  t.check("dark mode switches to the dark artwork", /pattern-abstract-dark\.svg/.test(await bodyBg(dev)), (await bodyBg(dev)).slice(-60));
  await dev.eval(`document.documentElement.setAttribute("data-theme", "light")`); await sleep(150);

  const measure = async () => { const o = {}; for (const [name, w, h] of [["phone", 390, 844], ["ipad", 820, 1180], ["laptop", 1440, 900], ["huge", 3000, 1600]]) { await dev.resize(w, h); await sleep(250); o[name] = await tile(dev); } return o; };
  const near = (a, b) => Math.abs(a - b) < 1;
  const small = await measure();
  t.check("SMALL: 180px on a phone, 193px on an iPad, 218px on a laptop, never over 240px", small.phone === 180 && near(small.ipad, 192.8) && near(small.laptop, 217.6) && small.huge === 240, JSON.stringify(small));
  await dev.eval(`document.documentElement.setAttribute("data-bg-pattern-size", "medium")`);
  const medium = await measure();
  t.check("MEDIUM: 251px on a phone, 286px on an iPad, 335px on a laptop, never over 350px", near(medium.phone, 251.2) && near(medium.ipad, 285.6) && near(medium.laptop, 335.2) && medium.huge === 350, JSON.stringify(medium));
  await dev.eval(`document.documentElement.setAttribute("data-bg-pattern-size", "large")`);
  const large = await measure();
  t.check("LARGE: 350px on a phone, 405px on an iPad, 492px on a laptop, never over 560px", large.phone === 350 && near(large.ipad, 404.8) && near(large.laptop, 491.6) && large.huge === 560, JSON.stringify(large));
  t.check("each size is clearly bigger than the one before, on every screen", ["phone", "ipad", "laptop", "huge"].every(k => small[k] < medium[k] && medium[k] < large[k]));
  await noErrors(dev, "abstract");
  dev.close();
}

{
  const dev = await fresh("SWITCHING PATTERNS: the size choice carries across, Plain hides it, and the choice is remembered");
  await openBackgroundSettings(dev);
  await dev.click('#bg-pattern-grid [data-pattern="doodles"]'); await sleep(200);
  await dev.click('#bg-pattern-size [data-size="medium"]'); await sleep(200);
  await dev.click('#bg-pattern-grid [data-pattern="abstract"]'); await sleep(250);
  t.check("switching Doodles to Abstract keeps your size choice (Medium)", (await attr(dev)) === "abstract" && (await dev.eval(`document.documentElement.getAttribute("data-bg-pattern-size")`)) === "medium" && await dev.eval(`document.querySelector('#bg-pattern-size [data-size="medium"]').classList.contains("is-active")`));
  t.check("it is saved in your settings", (await localState(dev)).settings.backgroundPattern === "abstract");
  await dev.go("index.html", 900); await dev.waitFor(`document.getElementById("cc-food-list").children.length > 0`);
  t.check("after a reload Abstract is still on, with the artwork", (await attr(dev)) === "abstract" && /pattern-abstract-light\.svg/.test(await bodyBg(dev)));
  await openBackgroundSettings(dev);
  await dev.click('#bg-pattern-grid [data-pattern="doodles"]'); await sleep(250);
  t.check("and back to Doodles gives the doodle drawing again", (await attr(dev)) === "doodles" && (await bodyBg(dev)).startsWith('url("data:image/svg+xml,'));
  await dev.click('#bg-pattern-grid [data-pattern="abstract"]'); await sleep(200); await dev.click('#bg-pattern-grid [data-pattern="none"]'); await sleep(250);
  t.check("Plain removes it and hides the size choice", (await attr(dev)) === "none" && (await bodyBg(dev)) === "none" && await dev.eval(`document.getElementById("bg-pattern-size").hidden`));
  await noErrors(dev, "switching");
  dev.close();

  const bad = await openDevice(app, { width: 390, height: 844, inject: `if (!localStorage.getItem("insulinBuddy.v2")) { ${seedLocal(stateBlob({ settings: { backgroundPattern: "memphis" } }))} }`, wait: 1500 });
  await bad.waitFor(`document.getElementById("cc-food-list").children.length > 0`);
  t.check("an unknown saved pattern name means no pattern, not a broken page", (await attr(bad)) === "none" && (await bodyBg(bad)) === "none");
  await noErrors(bad, "unknown pattern");
  bad.close();
}

{
  const dev = await fresh("ABSTRACT IS ONLY A BACKGROUND: nothing moves, and it is not printed");
  const sel = [".dose-card", ".tabbar", ".sticky-log-bar", "#cc-food-section", ".views"];
  const rects = () => dev.eval(`${JSON.stringify(sel)}.map(s => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return [s, Math.round(b.left * 10) / 10, Math.round(b.top * 10) / 10, Math.round(b.width * 10) / 10, Math.round(b.height * 10) / 10]; })`);
  const off = await rects();
  await dev.eval(`document.documentElement.setAttribute("data-bg-pattern", "abstract")`); await sleep(300);
  t.check("every main element is exactly where it was", JSON.stringify(await rects()) === JSON.stringify(off));
  t.check("the page didn't start scrolling sideways", await dev.eval(`document.documentElement.scrollWidth <= innerWidth + 1`));
  await dev.cdp.send("Emulation.setEmulatedMedia", { media: "print" }); await sleep(150);
  t.check("when printing it is gone", (await bodyBg(dev)) === "none");
  await dev.cdp.send("Emulation.setEmulatedMedia", { media: "" }); await sleep(150);
  await noErrors(dev, "abstract layout");
  dev.close();
}

{
  const dev = await fresh("IT IS ONLY A BACKGROUND: nothing on the page moves when it is turned on");
  const sel = [".dose-card", ".tabbar", ".sticky-log-bar", "#cc-food-section", ".views"];
  const rects = () => dev.eval(`${JSON.stringify(sel)}.map(s => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return [s, Math.round(b.left * 10) / 10, Math.round(b.top * 10) / 10, Math.round(b.width * 10) / 10, Math.round(b.height * 10) / 10]; })`);
  const off = await rects();
  await dev.eval(`document.documentElement.setAttribute("data-bg-pattern", "doodles")`); await sleep(250);
  t.check("every main element is exactly where it was", JSON.stringify(await rects()) === JSON.stringify(off), JSON.stringify(off));
  t.check("the page didn't start scrolling sideways", await dev.eval(`document.documentElement.scrollWidth <= innerWidth + 1`));
  await noErrors(dev, "layout");
  dev.close();
}

{
  const dev = await fresh("PRINTING: the decorative background is never printed");
  await dev.eval(`document.documentElement.setAttribute("data-bg-pattern", "doodles")`);
  t.check("on screen the pattern is there", (await bodyBg(dev)).startsWith('url("data:image/svg+xml,'));
  await dev.cdp.send("Emulation.setEmulatedMedia", { media: "print" }); await sleep(150);
  t.check("when printing (or saving a report as PDF) it is gone", (await bodyBg(dev)) === "none", (await bodyBg(dev)).slice(0, 40));
  await dev.cdp.send("Emulation.setEmulatedMedia", { media: "" }); await sleep(150);
  t.check("and it comes back on screen afterwards", (await bodyBg(dev)).startsWith('url("data:image/svg+xml,'));
  await noErrors(dev, "print");
  dev.close();
}

await app.close();
process.exit(t.summary() ? 0 : 1);
