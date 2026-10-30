import test from "node:test";
import assert from "node:assert/strict";
import { basalBaseline, basalStartDose, basalVsUsual, basalDoseCheck, BASAL_MAX_UNITS } from "../../js/history.js";
import { normalizeState } from "../../js/state.js";

test("usual doses: numbers above 0 kept to two decimals; anything else is 'not set'", () => {
  assert.deepEqual(basalBaseline({ am: 10, pm: "12,5" }), { am: 10, pm: 12.5 });
  assert.deepEqual(basalBaseline({ am: 0, pm: -2 }), { am: null, pm: null });
  assert.deepEqual(basalBaseline({ am: BASAL_MAX_UNITS + 1, pm: "abc" }), { am: null, pm: null });
  assert.deepEqual(basalBaseline(null), { am: null, pm: null });
  assert.deepEqual(basalBaseline({ am: 10.256 }), { am: 10.26, pm: null });
});

test("the sheet starts from the usual dose, else the last one in that slot", () => {
  const last = { units: 9, ts: 1 };
  assert.deepEqual(basalStartDose({ am: 10, pm: null }, last, "am"), { units: 10, from: "usual" });
  assert.deepEqual(basalStartDose({ am: 10, pm: null }, last, "pm"), { units: 9, from: "last" });
  assert.equal(basalStartDose({ am: null }, null, "pm"), null);
});

test("how a typed dose compares with the usual one", () => {
  assert.deepEqual(basalVsUsual(12, 10), { diff: 2, text: "2u more than your usual 10u." });
  assert.deepEqual(basalVsUsual(8.5, 10), { diff: -1.5, text: "1.5u less than your usual 10u." });
  assert.deepEqual(basalVsUsual(10, 10), { diff: 0, text: "Your usual dose." });
  assert.equal(basalVsUsual(10, null), null);
  assert.equal(basalVsUsual(NaN, 10), null);
});

test("the big-jump check uses the usual dose when there is one", () => {
  assert.equal(basalDoseCheck(20, { units: 20, ts: 1 }, 10).level, "confirm");
  assert.match(basalDoseCheck(20, { units: 20, ts: 1 }, 10).message, /usual dose here is 10u/);
  assert.equal(basalDoseCheck(20, { units: 10, ts: 1 }, 20).level, "ok", "the usual dose wins over an odd last one");
  assert.equal(basalDoseCheck(20, { units: 10, ts: 1 }).level, "confirm", "without a usual dose: as before");
  assert.equal(basalDoseCheck(0, null, 10).level, "block");
});

test("saved settings keep both usual doses when one side is missing", () => {
  const defaults = () => ({ settings: { basalBaseline: { am: null, pm: null }, insulinModel: {}, carbAbsorptionMinutes: {}, basalActivity: {} }, library: [], recipes: [], history: [] });
  const st = normalizeState({ settings: { basalBaseline: { am: 10 } } }, defaults);
  assert.deepEqual(st.settings.basalBaseline, { am: 10, pm: null });
  assert.deepEqual(normalizeState({ settings: {} }, defaults).settings.basalBaseline, { am: null, pm: null });
});
