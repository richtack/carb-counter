"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function app() {
  const meals = [], entries = [], messages = [];
  let nextId = 0, loseResponse = false, mealsUnavailable = false;
  class Query {
    constructor(table) { this.table = table; this.filters = []; this.action = "read"; }
    select() { return this; }
    eq(key, value) { this.filters.push((row) => row[key] === value); return this; }
    in(key, values) { this.filters.push((row) => values.includes(row[key])); return this; }
    order(key) { this.sortKey = key; return this; }
    insert(value) { this.action = "insert"; this.value = value; return this; }
    update(value) { this.action = "update"; this.value = value; return this; }
    delete() { this.action = "delete"; return this; }
    upsert(value) { this.action = "upsert"; this.value = value; return this; }
    single() { this.one = true; return this; }
    async then(resolve) {
      if (this.table === "saved_meals" && mealsUnavailable) return resolve({ error: Error("missing table") });
      const table = this.table === "saved_meals" ? meals : entries;
      let rows = table.filter((row) => this.filters.every((filter) => filter(row)));
      if (this.action === "insert") {
        const values = Array.isArray(this.value) ? this.value : [this.value];
        rows = values.map((value) => ({ id: String(++nextId), ...value }));
        table.push(...rows);
      } else if (this.action === "update") rows.forEach((row) => Object.assign(row, this.value));
      else if (this.action === "delete") rows.forEach((row) => table.splice(table.indexOf(row), 1));
      else if (this.action === "upsert") {
        rows = this.value.map((value) => {
          const existing = table.find((row) => row.id === value.id);
          if (existing) return existing;
          const row = { ...value, created_at: new Date().toISOString() };
          table.push(row); return row;
        });
        if (loseResponse) return resolve({ error: Error("response lost") });
      }
      if (this.sortKey) rows.sort((a, b) => String(a[this.sortKey]).localeCompare(String(b[this.sortKey])));
      resolve({ data: this.one ? rows[0] || null : rows, error: null });
    }
  }
  const context = { console, Date, navigator: {},
    localStorage: { getItem: () => null },
    NCCLogLater: { uuid: () => `00000000-0000-4000-8000-${String(++nextId).padStart(12, "0")}` },
    document: { querySelector: () => null, addEventListener() {} },
  };
  context.window = context;
  context.database = { from: (table) => new Query(table) };
  context.notify = (message) => messages.push(message);
  vm.createContext(context);
  const run = (code) => vm.runInContext(code, context);
  run(fs.readFileSync("app.js", "utf8"));
  run(`db = database; toast = notify; renderMealCards = () => {}; renderMeals = () => {};
    renderEntries = () => {}; renderProgress = () => {}; closeModal = () => {};
    state.date = '2026-09-30'; state.person = 'rich'; state.calReady = true;
    state.foods = [
      {id:'egg',name:'Egg',net_carbs:1,calories:70},
      {id:'toast',name:'Toast',net_carbs:4,calories:null}
    ];`);
  return { run, meals, entries, messages,
    setLoseResponse(value) { loseResponse = value; },
    setMealsUnavailable(value) { mealsUnavailable = value; } };
}

test("meal templates are person filtered, editable, and keep historical entries separate", async () => {
  const a = app();
  await a.run("loadMeals()");
  assert.equal(a.run("state.mealsReady"), true);
  assert.equal(await a.run("saveMeal('Breakfast', [{food_id:'egg',qty:2},{food_id:'toast',qty:1}], null)"), true);
  assert.equal(a.meals.length, 1);
  assert.equal(a.meals[0].person, "rich");
  a.run("state.person = 'gen'");
  await a.run("loadMeals()");
  assert.equal(a.run("state.meals.length"), 0);
  a.run("state.person = 'rich'");
  await a.run("loadMeals()");
  assert.equal(a.run("state.meals.length"), 1);
  assert.equal(await a.run("saveMeal('Morning', [{food_id:'egg',qty:1}], state.meals[0])"), true);
  assert.equal(a.meals[0].name, "Morning");
  assert.equal(a.entries.length, 0);
  await a.run("deleteMeal(state.meals[0])");
  assert.equal(a.meals.length, 0);
});

test("meal validation rejects missing, repeated, and invalid portions; totals retain unknown calories", () => {
  const a = app();
  assert.equal(a.run("validMealRows([{food_id:'egg',qty:2},{food_id:'toast',qty:1}])"), true);
  assert.equal(a.run("validMealRows([{food_id:'egg',qty:1},{food_id:'egg',qty:1}])"), false);
  assert.equal(a.run("validMealRows([{food_id:'missing',qty:1}])"), false);
  assert.equal(a.run("validMealRows([{food_id:'egg',qty:0}])"), false);
  assert.equal(a.run("mealTotals([{food_id:'egg',qty:2},{food_id:'toast',qty:1}]).carbs"), 6);
  assert.equal(a.run("mealTotals([{food_id:'egg',qty:2},{food_id:'toast',qty:1}]).unknown"), 1);
});

test("meal logging snapshots current foods and a lost response can be retried without duplicates", async () => {
  const a = app();
  a.run("let prepared = mealEntryRows([{food_id:'egg',qty:2},{food_id:'toast',qty:1}], state.date, state.person)");
  assert.equal(a.run("prepared[0].net_carbs"), 1);
  assert.equal(a.run("prepared[1].calories"), null);
  a.setLoseResponse(true);
  assert.equal(await a.run("saveMealEntries(prepared)"), true); // Read-back finds committed rows.
  assert.equal(a.entries.length, 2);
  assert.equal(a.run("state.entries.length"), 2);
  assert.equal(await a.run("saveMealEntries(prepared)"), true);
  assert.equal(a.entries.length, 2);
  assert.equal(a.run("state.entries.length"), 2);
  a.run("state.foods[0].net_carbs = 3");
  assert.equal(a.entries[0].net_carbs, 1); // Editing a food cannot rewrite the log.
  assert.equal(a.run("mealEntryRows([{food_id:'egg',qty:2}], state.date, state.person)[0].net_carbs"), 3);
});

test("missing meals table leaves existing logging usable", async () => {
  const a = app();
  a.setMealsUnavailable(true);
  await a.run("loadMeals()");
  assert.equal(a.run("state.mealsReady"), false);
  assert.equal(a.run("state.foods.length"), 2);
});
