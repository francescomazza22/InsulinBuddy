import test from "node:test";
import assert from "node:assert/strict";
import { slotUsage, sortBySlotUsage } from "../../js/history.js";
import { ratioMatch } from "../../js/core/time.js";

const BR = [
  { id: "am", name: "Morning", start: "06:00", end: "11:00" },
  { id: "day", name: "Rest of day", start: "11:00", end: "06:00" },
  { id: "sun", name: "Sunday brunch", start: "09:00", end: "13:00", days: [0] }
];
// 2026-10-26 is a Monday, 2026-10-25 a Sunday.
const at = (y, mo, d, h, m = 0) => new Date(y, mo - 1, d, h, m).getTime();
const meal = (ts, ...ids) => ({ id: "h" + ts, ts, mealType: "lunch", items: ids.map(id => ({ refType: id.startsWith("r") ? "recipe" : "food", refId: id, name: id, grams: 50 })) });
const H = [
  meal(at(2026, 10, 26, 7, 30), "oats", "milk"),
  meal(at(2026, 10, 27, 8, 0), "oats", "banana"),
  meal(at(2026, 10, 28, 10, 59), "oats", "oats"),        // twice in one meal counts once
  meal(at(2026, 10, 26, 13, 0), "pasta", "r1"),
  meal(at(2026, 10, 27, 20, 0), "pasta"),
  meal(at(2026, 10, 27, 5, 59), "milk"),                  // 05:59 is still "Rest of day"
  meal(at(2026, 10, 25, 10, 0), "pancakes"),              // Sunday 10:00: the Sunday range wins
  { id: "b1", ts: at(2026, 10, 26, 7, 0), entryType: "basal", basalDose: 14, items: [] },
  { id: "c1", ts: at(2026, 10, 26, 9, 0), mealType: "correction", items: [] }
];

test("slot usage: counts meals in the slot, by the ranges as set now", () => {
  const am = slotUsage(H, BR, BR[0], ratioMatch);
  assert.deepEqual(Object.fromEntries(am), { "food:oats": 3, "food:milk": 1, "food:banana": 1 });
  const day = slotUsage(H, BR, BR[1], ratioMatch);
  assert.deepEqual(Object.fromEntries(day), { "food:pasta": 2, "recipe:r1": 1, "food:milk": 1 });
  assert.deepEqual(Object.fromEntries(slotUsage(H, BR, BR[2], ratioMatch)), { "food:pancakes": 1 }, "a day-limited range gets its own meals");
  assert.equal(slotUsage(H, BR, null, ratioMatch).size, 0);
  assert.equal(slotUsage([], BR, BR[0], ratioMatch).size, 0);
});

test("slot order: slot uses first, then overall uses, then A to Z", () => {
  const items = [
    { id: "food:pasta", name: "Pasta", usageCount: 40 },
    { id: "food:oats", name: "Oats", usageCount: 3 },
    { id: "food:milk", name: "Milk", usageCount: 2 },
    { id: "food:banana", name: "Banana", usageCount: 1 },
    { id: "food:apple", name: "Apple", usageCount: 0 },
    { id: "food:kiwi", name: "Kiwi", usageCount: 0 }
  ];
  const am = slotUsage(H, BR, BR[0], ratioMatch);
  assert.deepEqual(sortBySlotUsage(items, am).map(i => i.name), ["Oats", "Milk", "Banana", "Pasta", "Apple", "Kiwi"],
    "oats (3 mornings) first; milk and banana tie at 1 and go by overall use; pasta, never a morning food, after them despite 40 uses");
  const day = slotUsage(H, BR, BR[1], ratioMatch);
  assert.deepEqual(sortBySlotUsage(items, day).map(i => i.name).slice(0, 2), ["Pasta", "Milk"]);
  assert.deepEqual(sortBySlotUsage(items, new Map()).map(i => i.name), ["Pasta", "Oats", "Milk", "Banana", "Apple", "Kiwi"], "no history in the slot: overall use, as before");
  assert.equal(items[0].name, "Pasta", "the input list is not reordered in place");
});
