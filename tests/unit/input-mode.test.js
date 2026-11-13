// 2.104.0: which layout a device gets (js/boot-head.js). Mouse only for a precise, hovering pointer with no touchscreen;
// every touchscreen (iPhone, iPad with or without a trackpad, touchscreen laptop) stays touch; a saved choice wins.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const src = fs.readFileSync(new URL("../../js/boot-head.js", import.meta.url), "utf8");
function device({ fine, hover, touchPoints, saved = null }) {
  const attrs = {};
  const root = { setAttribute: (k, v) => { attrs[k] = v; }, getAttribute: k => attrs[k] };
  const store = saved == null ? {} : { "insulinBuddy.input": saved };
  const window = {
    matchMedia: q => ({ matches: q === "(pointer: fine)" ? fine : q === "(hover: hover)" ? hover : false }),
  };
  const ctx = {
    window, navigator: { maxTouchPoints: touchPoints },
    document: { documentElement: root, querySelector: () => null },
    localStorage: { getItem: k => (k in store ? store[k] : null) },
    Date,
  };
  window.document = ctx.document;
  vm.runInNewContext(src, ctx);
  return { mode: attrs["data-input"], api: window.ibInputMode };
}

test("a PC with a mouse gets the mouse layout", () => {
  assert.equal(device({ fine: true, hover: true, touchPoints: 0 }).mode, "mouse");
});
test("iPhone and iPad get touch", () => {
  assert.equal(device({ fine: false, hover: false, touchPoints: 5 }).mode, "touch");
});
test("an iPad with a trackpad still gets touch (it has a touchscreen)", () => {
  assert.equal(device({ fine: true, hover: true, touchPoints: 5 }).mode, "touch");
});
test("a touchscreen laptop gets touch; no pointer at all gets touch", () => {
  assert.equal(device({ fine: true, hover: true, touchPoints: 10 }).mode, "touch");
  assert.equal(device({ fine: false, hover: false, touchPoints: 0 }).mode, "touch");
});
test("a saved choice wins over the automatic one, both ways", () => {
  assert.equal(device({ fine: false, hover: false, touchPoints: 5, saved: "mouse" }).mode, "mouse");
  assert.equal(device({ fine: true, hover: true, touchPoints: 0, saved: "touch" }).mode, "touch");
  assert.equal(device({ fine: true, hover: true, touchPoints: 0, saved: "nonsense" }).mode, "mouse");
});
test("ibInputMode reports the choice, what's in use and what automatic would pick", () => {
  const d = device({ fine: true, hover: true, touchPoints: 0 });
  assert.deepEqual({ ...d.api("touch") }, { pref: "touch", mode: "touch", auto: "mouse" });
  assert.deepEqual({ ...d.api("auto") }, { pref: "auto", mode: "mouse", auto: "mouse" });
});
