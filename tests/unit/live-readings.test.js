import test from "node:test";
import assert from "node:assert/strict";
import { dropShadowReadings, preferLiveReadings, preferLiveEntries, SHADOW_NEAR_MS, glucoseSummaryStats } from "../../js/glucose-stats.js";

// A synthetic trace shaped like the real Gluroo feed (28 Oct 2026): live readings with an arrow every 3 minutes, and a
// later, arrow-less copy every 5 minutes that is smoother (it misses the bottom of a dip). Values are invented.
const T0 = Date.UTC(2026, 9, 28, 6, 0, 0);
const MIN = 60_000;
const liveCurve = m => Math.round(110 - 50 * Math.exp(-(((m - 60) / 15) ** 2)));      // dips to 60 at minute 60
const shadowCurve = m => Math.round(110 - 35 * Math.exp(-(((m - 60) / 20) ** 2)));    // smoother: bottoms at 75
function mixedRows(minutes = 120) {
  const rows = [];
  for (let m = 0; m <= minutes; m += 3) rows.push({ at: T0 + m * MIN + 25_000, mgdl: liveCurve(m), direction: "Flat" });
  for (let m = 1; m <= minutes; m += 5) rows.push({ at: T0 + m * MIN + 26_000, mgdl: shadowCurve(m), direction: null });
  return rows.sort((a, b) => a.at - b.at);
}

test("mixed live + arrow-less rows: the problem the filter fixes (zig-zag, lows lifted)", () => {
  const rows = mixedRows();
  const live = rows.filter(r => r.direction);
  const lows = list => list.filter(r => r.mgdl < 70).length;
  // Unfiltered, neighbouring readings jump back and forth between the two copies.
  const jumps = list => list.slice(1).reduce((n, r, i) => n + (Math.abs(r.mgdl - list[i].mgdl) >= 8 ? 1 : 0), 0);
  assert.ok(jumps(rows) > jumps(live), "the mixed trace zig-zags more than the live one");
  // Share of time low is diluted by the arrow-less copy, which never goes low here.
  const lowPct = list => lows(list) / list.length;
  assert.ok(lowPct(rows) < lowPct(live));
  // The filter gives back exactly the live trace.
  const kept = preferLiveReadings(rows);
  assert.deepEqual(kept, live);
  assert.equal(lows(kept), lows(live));
  assert.equal(jumps(kept), jumps(live));
  assert.deepEqual(glucoseSummaryStats(kept.map(r => ({ at: r.at, mgdl: r.mgdl }))), glucoseSummaryStats(live.map(r => ({ at: r.at, mgdl: r.mgdl }))));
});

test("arrow-less readings that fill a real gap are kept", () => {
  const rows = mixedRows().filter(r => !(r.direction && r.at > T0 + 30 * MIN && r.at < T0 + 52 * MIN)); // live missing 30-52 min
  const kept = preferLiveReadings(rows);
  const filled = kept.filter(r => !r.direction);
  assert.ok(filled.length >= 3, "the gap is filled from the arrow-less copy");
  for (const r of filled) {
    const nearest = Math.min(...kept.filter(k => k.direction).map(k => Math.abs(k.at - r.at)));
    assert.ok(nearest > SHADOW_NEAR_MS, "only readings with no live one within 2.5 minutes stay");
  }
  // Outside the gap, no arrow-less reading survives.
  assert.ok(kept.every(r => r.direction || (r.at > T0 + 27 * MIN && r.at < T0 + 55 * MIN)));
});

test("boundaries: exactly nearMs counts as near; just over does not", () => {
  const live = { at: 1_000_000, direction: "Flat" };
  const near = { at: 1_000_000 + SHADOW_NEAR_MS, direction: null };
  const far = { at: 1_000_000 - SHADOW_NEAR_MS - 1, direction: null };
  assert.deepEqual(preferLiveReadings([far, live, near]), [far, live]);
});

test("all live, none live, empty and junk input", () => {
  const allLive = [{ at: 1, direction: "Flat" }, { at: 2, direction: "SingleUp" }];
  const r1 = preferLiveReadings(allLive);
  assert.deepEqual(r1, allLive);
  assert.notEqual(r1, allLive, "returns a copy");
  const noLive = [{ at: 1, direction: null }, { at: 2 }, { at: 3, direction: "NONE" }];
  assert.deepEqual(preferLiveReadings(noLive), noLive, "nothing to prefer: everything kept");
  assert.deepEqual(preferLiveReadings([]), []);
  assert.deepEqual(preferLiveReadings(null), []);
  assert.deepEqual(preferLiveReadings(undefined), []);
});

test("directions Nightscout uses for 'no trend' count as no arrow", () => {
  for (const d of ["", "  ", "NONE", "NOT COMPUTABLE", "RATE OUT OF RANGE", null, undefined, 5]) {
    const rows = [{ at: 0, direction: "Flat" }, { at: 30_000, direction: d }];
    assert.deepEqual(preferLiveReadings(rows), [rows[0]], `direction ${JSON.stringify(d)}`);
  }
});

test("order is kept, input untouched, unusable times and holes pass through", () => {
  const rows = [{ at: 300_000, direction: "Flat" }, { at: NaN, direction: null }, null, { at: 0, direction: null }, { at: 320_000, direction: null }];
  const copy = JSON.parse(JSON.stringify(rows));
  const kept = preferLiveReadings(rows);
  assert.deepEqual(kept, [rows[0], rows[1], null, rows[3]]);
  assert.deepEqual(JSON.parse(JSON.stringify(rows)), copy);
});

test("Nightscout entries use date/direction; newest-first order survives", () => {
  const entries = [
    { date: T0 + 10 * MIN, sgv: 100, direction: "Flat" },
    { date: T0 + 9 * MIN, sgv: 104, direction: undefined },
    { date: T0 + 7 * MIN, sgv: 99, direction: "Flat" },
    { date: T0 - 20 * MIN, sgv: 120 }
  ];
  assert.deepEqual(preferLiveEntries(entries), [entries[0], entries[2], entries[3]]);
});

test("custom nearMs and the generic form", () => {
  const items = [{ t: 0, live: true }, { t: 200_000, live: false }];
  assert.equal(dropShadowReadings(items, i => i.t, i => i.live).length, 2);
  assert.equal(dropShadowReadings(items, i => i.t, i => i.live, 250_000).length, 1);
});

test("large unsorted trace: same result as a brute-force check", () => {
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const rows = Array.from({ length: 3000 }, () => ({ at: Math.floor(rnd() * 86_400_000), direction: rnd() < 0.7 ? "Flat" : null }));
  const liveTimes = rows.filter(r => r.direction).map(r => r.at);
  const brute = rows.filter(r => r.direction || !liveTimes.some(t => Math.abs(t - r.at) <= SHADOW_NEAR_MS));
  assert.deepEqual(preferLiveReadings(rows), brute);
});
