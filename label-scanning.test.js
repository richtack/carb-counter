"use strict";

const assert = require("node:assert/strict");
const label = require("./label-scanning.js");

const simple = label.parseNutritionLabel(`
Nutrition Facts
8 servings per container
Serving size 2/3 cup (55g)
Amount per serving
Calories 230
% Daily Value*
Total Fat 8g 10%
Total Carbohydrate 37g 13%
Dietary Fiber 4g 14%
Total Sugars 12g
Includes 10g Added Sugars 20%
Sugar Alcohol 3g
Protein 3g
`);
assert.equal(simple.fields.serving.value, "2/3 cup (55g)");
assert.equal(simple.fields.calories.value, 230);
assert.equal(simple.fields.totalCarbs.value, 37);
assert.equal(simple.fields.fiber.value, 4);
assert.equal(simple.fields.sugarAlcohols.value, 3);
assert.deepEqual(label.calculateNet(37, 4, 3), { value: 30, error: null });

const splitLines = label.parseNutritionLabel(`
NUTRITION FACTS
Serving Size
1 bar (40 g)
Calories
0
Total Carbohydrate
12 g 4%
Dietary Fiber
5 g 18%
Sugar Alcohols
2.5 g
`);
assert.equal(splitLines.fields.serving.value, "1 bar (40 g)");
assert.equal(splitLines.fields.calories.value, 0, "an explicit zero must remain zero");
assert.equal(splitLines.fields.sugarAlcohols.value, 2.5);

const percentagesOnly = label.parseNutritionLabel(`
Nutrition Facts
Serving Size 1 cup (240 mL)
Total Carbohydrate 9%
Dietary Fiber 14%
Total Sugars 7g
Includes 4g Added Sugars 8%
`);
assert.equal(percentagesOnly.fields.totalCarbs.value, null, "daily value must not become grams");
assert.equal(percentagesOnly.fields.fiber.value, null, "daily value must not become grams");
assert.equal(percentagesOnly.fields.sugarAlcohols.value, null, "total/added sugars are not sugar alcohols");
assert.equal(percentagesOnly.fields.calories.value, null, "missing calories remain unknown");

const inequality = label.parseNutritionLabel(`
Nutrition Facts
Serving Size 1 slice (28g)
Calories 45
Total Carbohydrate 9g 3%
Dietary Fiber less than 1 g 3%
Sugar Alcohols <1g
`);
assert.equal(inequality.fields.fiber.status, "less_than");
assert.equal(inequality.fields.fiber.value, null);
assert.equal(inequality.fields.sugarAlcohols.status, "less_than");

const multiColumn = label.parseNutritionLabel(`
Nutrition Facts
Serving Size 1 packet (30g)
Per serving  As prepared
Calories 100 180
Total Carbohydrate 12g 20g
Dietary Fiber 2g 3g
Sugar Alcohol 0g 0g
`);
assert.equal(multiColumn.basisAmbiguous, true);
assert.equal(multiColumn.fields.calories.value, null);
assert.equal(multiColumn.fields.totalCarbs.value, null);
assert.equal(multiColumn.fields.totalCarbs.status, "ambiguous");

const nonUS = label.parseNutritionLabel(`
Nutrition Information
Per 100 g
Energy 400 kJ
Carbohydrate 12 g
Fiber 3 g
`);
assert.equal(nonUS.unsupported, true);
assert.equal(nonUS.fields.totalCarbs.value, null);
assert.equal(nonUS.fields.fiber.value, null);

assert.deepEqual(label.calculateNet("", 0, 0), { value: null, error: "incomplete" });
assert.deepEqual(label.calculateNet(5, 4, 2), { value: null, error: "deductions_exceed_total" });
assert.deepEqual(label.calculateNet(5, -1, 0), { value: null, error: "invalid" });

const launch = label.parseLaunchHash("#label=Nutrition%20Facts%0ACalories%20120&draft=20260919-101112-123");
assert.equal(launch.text, "Nutrition Facts\nCalories 120");
assert.equal(launch.draftId, "20260919-101112-123");
assert.deepEqual(label.parseLaunchHash("#label=%E0%A4%A&draft=test"), { error: "malformed" });
assert.deepEqual(label.parseLaunchHash("#label=&draft=test"), { error: "empty" });
assert.deepEqual(label.parseLaunchHash("#label=abc&draft=bad%20id"), { error: "invalid_draft" });
assert.deepEqual(label.parseLaunchHash("#label=abc&label=def&draft=test"), { error: "malformed" });
assert.deepEqual(label.parseLaunchHash(`#label=${"a".repeat(label.MAX_SOURCE_LENGTH + 1)}&draft=test`), { error: "too_long" });
assert.equal(label.parseLaunchHash("#voice=hello&draft=test"), null);

(async () => {
  const first = await label.foodId("draft-123");
  assert.equal(await label.foodId("draft-123"), first);
  assert.notEqual(await label.foodId("draft-124"), first);
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  console.log("label-scanning tests passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
