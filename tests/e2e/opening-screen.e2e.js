// The opening screen already matches the night or day and the chosen light/dark look when it is first painted (before app.js runs),
// and it never animates forever.
import { startApp, openDevice, makeChecker } from "./harness.js";
import { FOODS_JS } from "./helpers.js";

const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker();
const app = await startApp(DIR, null, { "foods_data.js": FOODS_JS, "manifest.json": "{}" });
// What the page looks like at the moment it has been read but app.js has not yet run; the hour is faked so night and day can both be tried.
const probe = (hint, hour, scheme) => `${scheme ? `{ const real = window.matchMedia.bind(window); window.matchMedia = q => /prefers-color-scheme: dark/.test(q) ? { matches: ${scheme === "dark"}, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} } : real(q); }` : ""}
  ${hint ? `localStorage.setItem("insulinBuddy.theme", "${hint}");` : `localStorage.removeItem("insulinBuddy.theme");`}
  ${hour != null ? `(() => { const R = Date; const fake = new R(2026, 9, 18, ${hour}, 30).getTime(), off = fake - R.now(); Date = class extends R { constructor(...a) { if (a.length) super(...a); else super(R.now() + off); } static now() { return R.now() + off; } }; })();` : ""}
  document.addEventListener("readystatechange", () => { if (document.readyState === "interactive" && !window.__early) { const r = document.documentElement, l = document.getElementById("loading-screen"), cs = getComputedStyle(l);
    window.__early = { theme: r.getAttribute("data-theme"), tod: r.getAttribute("data-tod"), greeting: document.getElementById("boot-greeting").textContent, shown: !l.hidden, bg: cs.backgroundImage, meta: document.querySelector('meta[name="theme-color"]').content }; } });`;
const open = async (hint, hour, scheme) => {
  const dev = await openDevice(app, { width: 390, height: 844, mobile: true, wait: 10, inject: probe(hint, hour, scheme) });
  await dev.waitFor(`!!window.__early`, 8000);
  return dev;
};

t.section("DARK LOOK AT NIGHT, from the first paint");
{
  const dev = await open("dark", 23);
  const e = await dev.eval(`window.__early`);
  t.check("dark theme is chosen before app.js has run", e.theme === "dark", JSON.stringify(e));
  t.check("it is night, with a matching greeting", e.tod === "night" && e.greeting === "Good evening", JSON.stringify(e));
  t.check("the opening screen is showing, with a sky gradient (not a flat white page)", e.shown && /gradient/.test(e.bg), e.bg);
  t.check("the browser bar colour is dark too", e.meta === "#14181D", e.meta);
  dev.close();
}
t.section("LIGHT LOOK IN THE MORNING");
{
  const dev = await open("light", 9);
  const e = await dev.eval(`window.__early`);
  t.check("light theme, morning, good morning", e.theme === "light" && e.tod === "morning" && e.greeting === "Good morning", JSON.stringify(e));
  t.check("light bar colour", e.meta === "#F5F3EE");
  dev.close();
}
t.section("AUTO FOLLOWS THE PHONE; NO HINT YET USES THE PHONE TOO");
{
  const a = await open("auto", 21, "dark");
  t.check("auto + phone in dark: dark", (await a.eval(`window.__early.theme`)) === "dark");
  a.close();
  const b = await open(null, 21, "dark");
  t.check("first ever start with a dark phone: dark", (await b.eval(`window.__early.theme`)) === "dark");
  b.close();
  const c = await open(null, 13, "light");
  t.check("first start with a light phone by day: light, day, good afternoon", (await c.eval(`window.__early.theme`)) === "light" && (await c.eval(`window.__early.tod`)) === "day" && (await c.eval(`window.__early.greeting`)) === "Good afternoon");
  c.close();
}
t.section("THE SETTING IS REMEMBERED FOR NEXT TIME");
{
  const dev = await openDevice(app, { width: 390, height: 844, mobile: true, wait: 1800 });
  await dev.eval(`(() => { const s = JSON.parse(localStorage.getItem("insulinBuddy.v2") || "null"); })()`);
  t.check("after the app has started, a hint is stored", ["dark", "light", "auto"].includes(await dev.eval(`localStorage.getItem("insulinBuddy.theme")`)), await dev.eval(`localStorage.getItem("insulinBuddy.theme")`));
  t.check("nothing on the opening screen animates forever", await dev.eval(`[...document.querySelectorAll("#loading-screen *")].every(el => !getComputedStyle(el).animationIterationCount.split(",").includes("infinite"))`));
  t.check("no JS errors", (await dev.eval("window.__errs.length")) === 0 && dev.errors.length === 0);
  dev.close();
}
await app.close();
process.exit(t.summary() ? 0 : 1);
