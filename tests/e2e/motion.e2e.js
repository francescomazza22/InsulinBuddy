// Motion and effects: every animation and transition in the app actually plays, plays for as long as intended, and
// stops. Nothing keeps animating at rest (that keeps the screen compositing and drains the battery), and with
// "Reduce motion" turned on in the phone's settings nothing moves.
import { startApp, openDevice, makeChecker, seedLocal } from "./harness.js";
import { FOODS_JS, stateBlob, meal } from "./helpers.js";

const DIR = new URL("../..", import.meta.url).pathname;
const t = makeChecker();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const app = await startApp(DIR, null, { "foods_data.js": FOODS_JS, "manifest.json": "{}" });
const now = Date.now();
const hist = [];
for (let d = 0; d < 8; d++) hist.push(meal(`m${d}`, now - d * 86400000 - 3600000, { totalCarbs: 40 + d * 5, mealDose: 4 }));
const seed = () => seedLocal(stateBlob({ history: hist }));

// Every animation/transition on the page, described: what it is, its timing, and whether it is still running.
const ANIMS = `document.getAnimations().map(a => { const e = a.effect, tm = e && e.getComputedTiming ? e.getComputedTiming() : {}, tg = e && e.target;
  return { name: a.animationName || a.transitionProperty || "js", kind: a.constructor.name, state: a.playState, iterations: tm.iterations, duration: tm.duration,
    progress: tm.progress, target: tg ? (tg.id || String(tg.className && tg.className.baseVal != null ? tg.className.baseVal : tg.className)).slice(0, 40) : "" }; })`;
const anims = dev => dev.eval(ANIMS);
// Records every animation and transition the moment it starts, so short ones (0.2 s) can't finish unseen between checks.
const RECORDER = `window.__motion = []; const __rec = kind => e => { const t = e.target, cls = t && t.getAttribute ? (t.getAttribute("class") || "") : ""; window.__motion.push({ kind, name: e.animationName || e.propertyName, target: ((t && t.id) || cls).slice(0, 40), at: Math.round(performance.now()) }); };
  document.addEventListener("animationstart", __rec("animation"), true); document.addEventListener("transitionrun", __rec("transition"), true);`;
const started = (dev, since = 0) => dev.eval(`window.__motion.filter(m => m.at >= ${since})`);
const clock = dev => dev.eval("Math.round(performance.now())");
const running = async dev => (await anims(dev)).filter(a => a.state === "running");

// ------------------------------------------------------------------ normal motion
const dev = await openDevice(app, { width: 390, height: 844, mobile: true, inject: `${RECORDER} if (!localStorage.getItem("insulinBuddy.v2")) { ${seed()} }`, wait: 250 });

t.section("MOTION: the opening screen");
const bootSeen = (await started(dev)).filter(m => /boot/.test(m.name));
const bootCss = await dev.eval(`(() => { const p = document.querySelector(".boot__pulse"), r = document.querySelector(".boot__ring"), cs = e => e ? { name: getComputedStyle(e).animationName, count: getComputedStyle(e).animationIterationCount, dur: getComputedStyle(e).animationDuration } : null; return { pulse: cs(p), ring: cs(r), loadingHidden: document.getElementById("loading-screen").hidden }; })()`);
t.check("the heartbeat line on the opening screen is set to animate", bootCss.pulse && bootCss.pulse.name === "boot-spark", JSON.stringify(bootCss));
t.check("it plays a fixed number of times, not forever", bootCss.pulse && bootCss.pulse.count !== "infinite" && (!bootCss.ring || bootCss.ring.count !== "infinite"), JSON.stringify(bootCss));
t.check("and it really starts while the opening screen is up", bootSeen.length > 0 || bootCss.loadingHidden, JSON.stringify({ bootSeen, bootCss }));
await dev.waitFor(`document.getElementById("loading-screen").hidden`, 15000).catch(() => {});
t.check("the opening screen goes away once the app is ready", await dev.eval(`document.getElementById("loading-screen").hidden`));
await sleep(7500);
t.check("after start-up nothing is left animating", (await running(dev)).length === 0, JSON.stringify(await running(dev)));

t.section("MOTION: the Log button pulse");
await dev.tab("calculator"); await sleep(200);
let mark = await clock(dev);
await dev.eval(`(() => { document.querySelector(".food-pick-item").click(); const g = document.getElementById("cc-grams"); g.value = "60"; g.dispatchEvent(new Event("input", { bubbles: true })); document.getElementById("cc-add-btn").click(); })()`);
await sleep(300);
const pulse = (await anims(dev)).find(a => a.name === "log-btn-pulse");
t.check("with something to log, the Log button pulses", !!pulse && pulse.state === "running" && pulse.target === "cc-log-btn" && await dev.eval(`document.getElementById("cc-log-btn").classList.contains("btn--pulse")`), JSON.stringify(pulse));
t.check("the pulse is 2.2 s and repeats 4 times, then stops", pulse && pulse.duration === 2200 && pulse.iterations === 4, JSON.stringify(pulse));
await sleep(9200);
t.check("about 9 s later the pulse has finished and nothing is animating", !(await anims(dev)).some(a => a.name === "log-btn-pulse" && a.state === "running") && (await running(dev)).length === 0, JSON.stringify(await running(dev)));

t.section("MOTION: swiping a Current meal row");
const swipeMeal = (dx) => dev.eval(`(async () => { const c = document.querySelector(".meal-item__content"), r = c.getBoundingClientRect(); const ev = (type, x) => c.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 7, pointerType: "touch", clientX: x, clientY: r.top + 20, isPrimary: true }));
  const x0 = r.left + 200; ev("pointerdown", x0); for (let i = 1; i <= 6; i++) { await new Promise(s => setTimeout(s, 25)); ev("pointermove", x0 + ${dx} * i / 6); } ev("pointerup", x0 + ${dx}); return true; })()`);
mark = await clock(dev);
await swipeMeal(-50);   // a part-way swipe: on release the row has to slide the rest of the way open
await sleep(300);
const slide = (await started(dev, mark)).find(m => m.kind === "transition" && m.name === "transform" && m.target.includes("meal-item__content"));
t.check("releasing a part-way swipe slides the row the rest of the way (a transition, not a jump)", !!slide && await dev.eval(`parseFloat(getComputedStyle(document.querySelector(".meal-item__content")).transitionDuration) > 0.1`), JSON.stringify(await started(dev, mark)));
t.check("the row settles open, showing Edit", await dev.eval(`document.querySelector(".meal-item").classList.contains("is-swiped") && /-72px/.test(document.querySelector(".meal-item__content").style.transform)`));
await swipeMeal(90); await sleep(350);
t.check("swiping back closes it again", await dev.eval(`!document.querySelector(".meal-item").classList.contains("is-swiped")`));

t.section("MOTION: the Undo bar");
await dev.click("#cc-log-btn"); await sleep(400);
await dev.tab("history"); await sleep(300);
await dev.waitFor(`document.getElementById("undo-toast").hidden`, 12000).catch(() => {});   // logging showed its own Undo bar: let it go first
mark = await clock(dev);
await dev.eval(`document.querySelector('.history-entry [data-del], [data-del]').click()`); await sleep(120);
const toastAnims = await anims(dev);
const toastIn = (await started(dev, mark)).find(m => m.name === "toast-in"), bar = toastAnims.find(a => a.name === "toast-bar");
t.check("deleting shows the Undo bar, sliding up into view", await dev.eval(`!document.getElementById("undo-toast").hidden`) && !!toastIn && (await dev.eval(`getComputedStyle(document.getElementById("undo-toast")).animationDuration`)) === "0.2s", JSON.stringify(await started(dev, mark)));
t.check("the Undo bar floats as a pill above the tab bar (its whole style was being dropped by a stray } in the stylesheet)", await dev.eval(`(() => { const e = document.getElementById("undo-toast"), cs = getComputedStyle(e), r = e.getBoundingClientRect(), tb = document.querySelector(".tabbar").getBoundingClientRect(); return cs.position === "fixed" && parseFloat(cs.borderTopLeftRadius) > 20 && r.bottom <= tb.top && Math.abs((r.left + r.right) / 2 - innerWidth / 2) < 2; })()`));
t.check("its countdown line runs for exactly the 8 s the Undo is offered", !!bar && bar.duration === 8000 && bar.state === "running", JSON.stringify(bar));
await sleep(2000);
const p1 = (await anims(dev)).find(a => a.name === "toast-bar");
t.check("the line shrinks as time passes (about a quarter gone after 2 s)", p1 && p1.progress > 0.18 && p1.progress < 0.35, JSON.stringify(p1));
await dev.eval(`document.getElementById("undo-toast").dispatchEvent(new PointerEvent("pointerenter"))`); await sleep(1200);
const p2 = (await anims(dev)).find(a => a.name === "toast-bar");
t.check("resting a finger or pointer on it pauses the countdown", p2 && p2.state === "paused" && Math.abs(p2.progress - p1.progress) < 0.1, JSON.stringify([p1 && p1.progress, p2]));
await dev.eval(`document.getElementById("undo-toast").dispatchEvent(new PointerEvent("pointerleave"))`);
await sleep(7000);
t.check("let go, it finishes and the bar goes away", await dev.eval(`document.getElementById("undo-toast").hidden`));
t.check("and the countdown animation is gone with it", !(await anims(dev)).some(a => a.name === "toast-bar" && a.state === "running"));

t.section("MOTION: switches, chart bars and other transitions");
await dev.tab("settings"); await dev.click('#settings-segmented [data-seg="general"]'); await sleep(300);
const wasDark = await dev.eval(`document.documentElement.getAttribute("data-theme")`);
await dev.eval(`document.getElementById("dark-mode-toggle").click()`); await sleep(40);
const sw = (await anims(dev)).filter(a => a.kind === "CSSTransition");
t.check("flipping a switch animates its knob and colour", sw.length > 0, JSON.stringify(sw));
await sleep(400);
t.check("and the theme really changes", (await dev.eval(`document.documentElement.getAttribute("data-theme")`)) !== wasDark);
await dev.eval(`document.getElementById("dark-mode-toggle").click()`); await sleep(400);
await dev.tab("history"); await dev.click('#view-history [data-seg="trends"]'); await sleep(700);
await dev.eval(`(() => { const h = document.querySelector(".trend-chart__hit"); h && h.dispatchEvent(new MouseEvent("click", { bubbles: true })); })()`); await sleep(40);
const bars = (await anims(dev)).filter(a => a.kind === "CSSTransition" && a.name === "opacity" && a.target.includes("trend-chart__bar"));
t.check("tapping a day on a chart fades the other days' bars", bars.length > 0, JSON.stringify(bars.slice(0, 2)));
await sleep(400);
t.check("the tapped day stays fully visible and the readout describes it", await dev.eval(`(() => { const s = document.querySelector(".trend-chart__bar.is-selected"); return !!s && getComputedStyle(s).opacity === "1" && !/tap a day/.test(document.querySelector(".trend-readout").textContent); })()`));

t.section("MOTION: sheets and dialogs open and close cleanly");
await dev.tab("history"); await dev.click('#view-history [data-seg="log"]'); await sleep(300);
const y0 = await dev.eval(`(scrollTo(0, 300), scrollY)`);
await dev.eval(`document.getElementById("btn-log-basal").click()`); await sleep(300);
t.check("a sheet opens and the page behind is held still", await dev.eval(`!!document.querySelector(".sheet-backdrop") && document.body.classList.contains("sheet-open")`));
await dev.eval(`document.getElementById("basal-close").click()`); await sleep(300);
t.check("closing it removes it and puts the page back where it was", await dev.eval(`!document.querySelector(".sheet-backdrop") && !document.body.classList.contains("sheet-open")`) && Math.abs((await dev.eval("scrollY")) - y0) <= 2, String(await dev.eval("scrollY")));

t.section("EFFECTS: glass");
const glass = await dev.eval(`(() => { const f = s => { const e = document.querySelector(s); return e ? (getComputedStyle(e).backdropFilter || getComputedStyle(e).webkitBackdropFilter || "none") : "missing"; }; return { tabbar: f(".tabbar"), card: f(".panel-card") }; })()`);
t.check("the tab bar and cards get their frosted-glass blur", /blur/.test(glass.tabbar) && /blur|none/.test(glass.card), JSON.stringify(glass));

t.section("MOTION: at rest");
await sleep(1500);
t.check("with nothing happening, nothing is animating (no battery drain)", (await running(dev)).length === 0, JSON.stringify(await running(dev)));
t.check("no animation anywhere is set to repeat forever", !(await anims(dev)).some(a => a.iterations === Infinity), JSON.stringify((await anims(dev)).filter(a => a.iterations === Infinity)));
t.check("no JS errors", (await dev.eval("window.__errs.length")) === 0, JSON.stringify(await dev.eval("window.__errs")));
dev.close();

// ------------------------------------------------------------------ reduce motion
t.section("REDUCE MOTION: with the phone's 'Reduce motion' setting on, nothing moves");
const calm = await openDevice(app, { width: 390, height: 844, mobile: true, inject: `if (!localStorage.getItem("insulinBuddy.v2")) { ${seed()} }`, wait: 1500 });
await calm.cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });   // applies live, no reload needed
await sleep(200);
const slow = list => list.filter(a => a.state === "running" && (a.duration > 5 || a.iterations > 1));
t.check("the opening screen's line and ring don't animate", await calm.eval(`(() => { const p = getComputedStyle(document.querySelector(".boot__pulse")), r = getComputedStyle(document.querySelector(".boot__ring")); return p.animationName === "none" && r.animationName === "none"; })()`));
await calm.waitFor(`document.getElementById("loading-screen").hidden`, 15000).catch(() => {});
await calm.tab("calculator"); await sleep(200);
await calm.eval(`(() => { document.querySelector(".food-pick-item").click(); const g = document.getElementById("cc-grams"); g.value = "60"; g.dispatchEvent(new Event("input", { bubbles: true })); document.getElementById("cc-add-btn").click(); })()`); await sleep(200);
t.check("the Log button doesn't pulse", slow(await anims(calm)).filter(a => a.name === "log-btn-pulse").length === 0, JSON.stringify(await anims(calm)));
await calm.click("#cc-log-btn"); await sleep(300);
await calm.tab("history"); await sleep(300);
await calm.eval(`document.querySelector("[data-del]").click()`); await sleep(100);
t.check("the Undo bar appears without a countdown animation (it still disappears after 8 s)", await calm.eval(`!document.getElementById("undo-toast").hidden`) && !(await anims(calm)).some(a => a.name === "toast-bar" && a.state === "running"), JSON.stringify(await anims(calm)));
t.check("log rows don't slide", await calm.eval(`(() => { const r = document.querySelector(".hs-row .history-entry"); return !r || parseFloat(getComputedStyle(r).transitionDuration) < 0.01; })()`));
t.check("no JS errors", (await calm.eval("window.__errs.length")) === 0, JSON.stringify(await calm.eval("window.__errs")));
calm.close(); await app.close();
process.exit(t.summary() ? 0 : 1);
