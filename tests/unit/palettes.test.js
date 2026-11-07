// Colour themes: every theme offered exists in the tokens (light and dark), and old saved themes still resolve.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { PALETTES, DEFAULT_PALETTE, paletteId } from "../../js/palettes.js";

const tokens = JSON.parse(fs.readFileSync(new URL("../../design/tokens.json", import.meta.url), "utf8"));

test("every theme in the picker has light and dark colours in the tokens, and nothing in the tokens is hidden", () => {
  assert.deepEqual(PALETTES.map(p => p.id).sort(), Object.keys(tokens.palette.set).sort());
  for (const p of Object.values(tokens.palette.set))
    for (const k of ["acc-1", "acc-2", "acc-1-dark", "acc-2-dark"]) assert.match(p[k], /^#[0-9A-F]{6}$/);
  assert.equal(DEFAULT_PALETTE, tokens.palette.default);
});

test("themes saved by older versions map to a current one; unknown or missing ids fall back to the default", () => {
  for (const old of ["tealViolet", "blueViolet", "emeraldRose", "orangePink", "cyanIndigo", "greenAmber"])
    assert.ok(PALETTES.some(p => p.id === paletteId(old)), old);
  assert.equal(paletteId("blueViolet"), "blueIndigo");
  assert.equal(paletteId("purplePink"), "purplePink");
  for (const bad of [undefined, null, "", "x\"><script>", 42]) assert.equal(paletteId(bad), DEFAULT_PALETTE);
});

import { RATIO_COLOURS, refreshRatioColours } from "../../js/palettes.js";
test("saved ratio ranges with the old preset colours move to the iOS ones; custom colours and odd data are left alone", () => {
  const s = { timeRatios: [{ color: "#1f9e93" }, { color: "#123456" }, {}], activityRatios: [{ color: "#D9534F" }] };
  assert.equal(refreshRatioColours(s), true);
  assert.deepEqual(s.timeRatios.map(r => r.color), [RATIO_COLOURS[0], "#123456", undefined]);
  assert.equal(s.activityRatios[0].color, RATIO_COLOURS[3]);
  assert.equal(refreshRatioColours(s), false);
  assert.equal(refreshRatioColours({}), false);
  assert.equal(refreshRatioColours(null), false);
});

test("2.55.0's ratio colours (too alike) move to the new distinct ones, and the six are all different", () => {
  const s = { timeRatios: [{ color: "#0C817B" }, { color: "#B25000" }, { color: "#6155F5" }, { color: "#D70015" }] };
  assert.equal(refreshRatioColours(s), true);
  assert.deepEqual(s.timeRatios.map(r => r.color), RATIO_COLOURS.slice(0, 4));
  assert.equal(new Set(RATIO_COLOURS).size, 6);
});

// 2.92.0: the vibrant themes must read by day as well as by night (the six originals show their designed colours by day,
// Francesco's choice in 2.68.8, so they are not held to this). Night colours are checked for every theme in tokens.test.js.
import { contrast } from "../../tools/contrast-colours.mjs";
test("vibrant themes: by day buttons and accent text 4.5:1, white on both dose-card colours 3:1, and two different hues", () => {
  const vibrant = PALETTES.filter(p => p.group === "vibrant");
  assert.equal(vibrant.length, 3);
  for (const { id } of vibrant) {
    const p = tokens.palette.set[id];
    assert.ok(contrast("#FFFFFF", p["acc-1"]) >= 4.5, `${id}: white on buttons`);
    assert.ok(contrast(p["acc-1"], tokens.color.light.paper) >= 4.5 && contrast(p["acc-1"], "#FFFFFF") >= 4.5, `${id}: accent text`);
    assert.ok(contrast("#FFFFFF", p["acc-2"]) >= 3, `${id}: dose card`);
    assert.notEqual(p["acc-1"], p["acc-2"]);
  }
  const pairs = PALETTES.map(p => tokens.palette.set[p.id]["acc-1"] + tokens.palette.set[p.id]["acc-2"]);
  assert.equal(new Set(pairs).size, PALETTES.length, "no two themes look the same");
  for (const old of ["orangeToPink", "redToPurple", "pinkToRed", "indigoToPurple", "cyanToIndigo"]) assert.equal(PALETTES.find(p => p.id === paletteId(old)).group, "vibrant", old);
});
