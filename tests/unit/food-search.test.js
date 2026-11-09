import { test } from "node:test";
import assert from "node:assert/strict";
import { foodNameMatches } from "../../js/food-search.js";

test("English finds Italian names and the other way round (2.100.1)", () => {
  assert.equal(foodNameMatches("Vino Bianco e Rosso", "Wine"), true);     // his screenshot, 9 Nov
  assert.equal(foodNameMatches("Vino Bianco e Rosso", "win"), true);      // while still typing
  assert.equal(foodNameMatches("Vino Bianco e Rosso", "white wine"), true);
  assert.equal(foodNameMatches("Pane comune", "bread"), true);
  assert.equal(foodNameMatches("Bread roll", "pane"), true);
  assert.equal(foodNameMatches("Caffè latte", "coffee"), true);           // accents don't matter
  assert.equal(foodNameMatches("Caffè latte", "caffe"), true);
  assert.equal(foodNameMatches("Mozzarella di bufala", "cheese"), true);
  assert.equal(foodNameMatches("Biscotti al cioccolato", "chocolate biscuits"), true);
});

test("plain text search still works, and unrelated names don't match", () => {
  assert.equal(foodNameMatches("Pane comune", "comu"), true);
  assert.equal(foodNameMatches("Pane comune", ""), true);
  assert.equal(foodNameMatches("Pane comune", "wine"), false);
  assert.equal(foodNameMatches("Vino Bianco e Rosso", "bread"), false);
  assert.equal(foodNameMatches("Banana", "apple"), false);
  assert.equal(foodNameMatches("Tegamino di verdure", "tea"), false);
  assert.equal(foodNameMatches("Pane comune", "bread wine"), false);       // every word must match
  assert.equal(foodNameMatches(null, "x"), false);
});
