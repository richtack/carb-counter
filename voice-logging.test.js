"use strict";

const assert = require("node:assert/strict");
const voice = require("./voice-logging.js");

const foods = [
  { id: "egg", name: "Eggs", serving: "2 large eggs", net_carbs: 1, calories: 140 },
  { id: "yogurt", name: "Greek Yogurt", serving: "1 cup", net_carbs: 8, calories: null },
  { id: "bread", name: "Keto Bread", serving: "2 slices", net_carbs: 2, calories: 80 },
];

const meal = voice.parseTranscript(
  "I had two eggs, half a serving of my yogurt, and one slice of keto bread.",
  foods
);
assert.equal(meal.items.length, 3);
assert.deepEqual(meal.items.map((item) => item.status), ["matched", "matched", "matched"]);
assert.deepEqual(meal.items.map((item) => item.foodId), ["egg", "yogurt", "bread"]);
assert.deepEqual(meal.items.map((item) => item.qty), [1, 0.5, 0.5]);

assert.equal(voice.resolveQuantity("one and a half servings of yogurt", "1 cup").qty, 1.5);
assert.ok(Math.abs(voice.resolveQuantity("100 grams yogurt", "4 ounces").qty - 0.881849) < 0.00001);
assert.equal(voice.resolveQuantity("two eggs", "1 cup").qty, null);

const ambiguous = voice.parseTranscript("half a serving of yogurt", [
  ...foods,
  { id: "vanilla-yogurt", name: "Vanilla Yogurt", serving: "1 cup", net_carbs: 9 },
]);
assert.equal(ambiguous.items[0].status, "ambiguous");
assert.equal(ambiguous.items[0].foodId, null);

const unknown = voice.parseTranscript("one moon pie", foods);
assert.equal(unknown.items[0].status, "unmatched");
assert.equal(unknown.items[0].foodId, null);

const conjunction = voice.parseTranscript("two servings of half and half and one serving of keto bread", [
  ...foods,
  { id: "cream", name: "Half and Half", serving: "2 tbsp", net_carbs: 1 },
]);
assert.equal(conjunction.items.length, 2);
assert.deepEqual(conjunction.items.map((item) => item.foodId), ["cream", "bread"]);
assert.deepEqual(conjunction.items.map((item) => item.qty), [2, 1]);

const sentencePauses = voice.parseTranscript(
  "Two eggs. Half a serving of yogurt! One slice of keto bread?",
  foods
);
assert.equal(sentencePauses.items.length, 3);
assert.deepEqual(sentencePauses.items.map((item) => item.foodId), ["egg", "yogurt", "bread"]);

const spokenConnectors = voice.parseTranscript(
  "Two eggs plus half a serving of yogurt also one slice of keto bread",
  foods
);
assert.equal(spokenConnectors.items.length, 3);
assert.deepEqual(spokenConnectors.items.map((item) => item.foodId), ["egg", "yogurt", "bread"]);

const noPunctuation = voice.parseTranscript(
  "Two eggs half a serving of yogurt one slice of keto bread",
  foods
);
assert.equal(noPunctuation.items.length, 3);
assert.deepEqual(noPunctuation.items.map((item) => item.foodId), ["egg", "yogurt", "bread"]);
assert.deepEqual(noPunctuation.items.map((item) => item.qty), [1, 0.5, 0.5]);

const decimalPortion = voice.parseTranscript("0.5 serving yogurt 1 serving keto bread", foods);
assert.equal(decimalPortion.items.length, 2);
assert.deepEqual(decimalPortion.items.map((item) => item.qty), [0.5, 1]);

(async () => {
  const first = await voice.entryId("rich", "draft-123", 0);
  assert.equal(await voice.entryId("rich", "draft-123", 0), first);
  assert.notEqual(await voice.entryId("rich", "draft-123", 1), first);
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  console.log("voice-logging tests passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
