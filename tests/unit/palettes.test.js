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
