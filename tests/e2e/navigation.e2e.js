// Three tabs (Calculator, Insights, Settings): the Library is a picker in the Calculator and a panel in Settings.
import { startApp, openDevice, makeChecker, seedLocal } from "./harness.js";
import { FOODS_JS, stateBlob } from "./helpers.js";

const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const app = await startApp(DIR, null, { "foods_data.js": FOODS_JS, "manifest.json": "{}" });
const F = (id, name, over = {}) => ({ id, name, category: "grains", carbs: 40, kcal: 200, protein: null, fat: null, salt: null, gi: 50, notes: "", favorite: false, usageCount: 0, ...over });
const library = [F("a", "Alpha rice", { favorite: true, usageCount: 1 }), F("b", "Beta bread", { usageCount: 9 }), F("c", "Gamma pasta", { category: "other" }), F("d", "Delta apple", { category: "fruits", favorite: true })];
const seed = seedLocal(stateBlob({ library, schemaVersion: 2 }));
const text = (dev, sel) => dev.eval(`Array.from(document.querySelectorAll(${JSON.stringify(sel)})).map(e => e.textContent.replace(/\\s+/g, " ").trim())`);
const shown = dev => dev.eval(`(Array.from(document.querySelectorAll("section.view")).find(v => !v.hidden) || {}).id`);
const noErrors = async (dev, label) => t.check(`${label}: no JS errors`, (await dev.eval("window.__errs.length")) === 0 && dev.errors.length === 0, JSON.stringify(await dev.eval("window.__errs")));

for (const [name, w, h, mobile] of [["phone", 390, 844, true], ["tablet", 820, 1000, true], ["desktop", 1291, 800, false]]) {
  t.section(`${name}: three tabs and the Library inside Settings`);
  const dev = await openDevice(app, { width: w, height: h, mobile, inject: seed, wait: 1200 });
  await dev.waitFor(`document.getElementById("cc-food-list").children.length > 0`);
  const labels = await text(dev, ".tabbar .tab > span:not(.tab__dot)");
  t.check("the tabs are Calculator, Insights, Settings", JSON.stringify(labels) === JSON.stringify(["Calculator", "Insights", "Settings"]), JSON.stringify(labels));
  t.check("there is no Library view any more", (await dev.eval(`!document.getElementById("view-library")`)));
  await dev.tab("history");
  t.check("Insights has Meals, Trends and Glucose", JSON.stringify(await text(dev, "#history-segmented .segmented__btn")) === JSON.stringify(["Meals", "Trends", "Glucose"]));
  t.check("and a heading that says so", (await text(dev, "#view-history .page-head h1"))[0] === "Insights");
  await dev.tab("library");
  t.check("Settings opens on the Library panel", (await shown(dev)) === "view-settings" && await dev.eval(`!document.getElementById("panel-library").hidden && document.getElementById("panel-ratios").hidden`));
  t.check("it lists the foods", (await dev.eval(`document.getElementById("lib-foods-list").children.length`)) === 4);
  const cols = await dev.eval(`getComputedStyle(document.getElementById("panel-library")).columnCount`);
  t.check("as one wide column even on a desktop", cols === "auto" || cols === "1", cols);
  t.check("no sideways scroll", await dev.eval(`document.documentElement.scrollWidth <= innerWidth + 1`));
  await noErrors(dev, name);
  dev.close();
}

t.section("Browse: pick a food from the Library without leaving the Calculator");
{
  const dev = await openDevice(app, { width: 390, height: 844, mobile: true, inject: seedLocal(stateBlob({ library, schemaVersion: 2 })), wait: 1200 });
  await dev.waitFor(`document.getElementById("cc-food-list").children.length > 0`);
  await dev.click("#cc-browse-btn"); await sleep(300);
  const favs = (await text(dev, ".browse-item__name")).map(n => n.replace("★", "").trim());
  t.check("the sheet opens on Favourites when there are some", JSON.stringify(favs) === JSON.stringify(["Alpha rice", "Delta apple"]), JSON.stringify(favs));
  await dev.click('#browse-tabs [data-tab="used"]'); await sleep(150);
  const used = (await text(dev, ".browse-item__name")).map(n => n.replace("★", "").trim());
  t.check("Most used ranks by how often", used[0] === "Beta bread" && used[1] === "Alpha rice", JSON.stringify(used));
  await dev.click('#browse-tabs [data-tab="all"]'); await sleep(150);
  t.check("All lists every food", (await text(dev, ".browse-item__name")).length >= 4);
  await dev.eval(`(() => { const i = document.getElementById("browse-search"); i.value = "gam"; i.dispatchEvent(new Event("input", { bubbles: true })); })()`); await sleep(150);
  const found = await text(dev, ".browse-item__name");
  t.check("searching narrows it, whichever tab is open", found.length === 1 && /Gamma pasta/.test(found[0]), JSON.stringify(found));
  await dev.click(".browse-item"); await sleep(400);
  t.check("choosing a food closes the sheet", await dev.eval(`!document.querySelector(".browse-sheet")`));
  t.check("and selects it in the Calculator", (await dev.eval(`document.getElementById("cc-search").value`)) === "Gamma pasta");
  t.check("with the amount box ready", await dev.eval(`!document.getElementById("cc-grams").disabled && document.activeElement === document.getElementById("cc-grams")`));
  await dev.eval(`(() => { const g = document.getElementById("cc-grams"); g.value = "100"; g.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await dev.click("#cc-add-btn"); await sleep(250);
  t.check("it joins the meal with the right carbs", (await text(dev, "#cc-carbs-pill"))[0].startsWith("40"), JSON.stringify(await text(dev, "#cc-carbs-pill")));
  await dev.click("#cc-browse-btn"); await sleep(250);
  await dev.click("#browse-manage"); await sleep(400);
  t.check("Manage your library jumps to Settings > Library", (await shown(dev)) === "view-settings" && await dev.eval(`!document.getElementById("panel-library").hidden`));
  await noErrors(dev, "browse");
  dev.close();
}

t.section("an old saved place on the Library tab falls back to the Calculator");
{
  const inj = seed + `localStorage.setItem("insulinBuddy.place", ${JSON.stringify(JSON.stringify({ view: "library", scroll: {}, at: Date.now() }))});`;
  const dev = await openDevice(app, { width: 390, height: 844, mobile: true, inject: inj, wait: 1200 });
  t.check("calculator", (await shown(dev)) === "view-calculator", await shown(dev));
  dev.close();
}
process.exit(t.summary() ? 0 : 1);
