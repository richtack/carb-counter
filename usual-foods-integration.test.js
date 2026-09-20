"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const U = require("./usual-foods.js");

function app() {
  const map = new Map(), events = {}, timers = new Map();
  let serial = 0;
  const grid = { innerHTML: "", addEventListener: (name, fn) => events[`grid:${name}`] = fn };
  const context = { console, Date, AbortController, performance: { now: () => 1 }, navigator: {},
    NCCUsualFoods: { ...U }, NCC_CONFIG: {},
    setTimeout: (fn) => { timers.set(++serial, fn); return serial; }, clearTimeout: (id) => timers.delete(id),
    localStorage: { getItem: (k) => map.get(k) || null, setItem: (k, v) => map.set(k, v), removeItem: (k) => map.delete(k) },
    document: { visibilityState: "visible", addEventListener: (name, fn) => events[name] = fn,
      querySelector: (s) => s === "#foodGrid" ? grid : null, querySelectorAll: () => [] },
    addEventListener: (name, fn) => events[name] = fn,
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync("app.js", "utf8"), context);
  const run = (code) => vm.runInContext(code, context);
  run(`state.foods = Array.from({ length: 12 }, (_, i) => ({id: String(i), name: 'Food ' + i, serving: '1 oz', net_carbs: 2}));
    state.favorites = state.foods.map(f => f.id); toast = () => {};`);
  return { context, run, grid, events, timers };
}

test("off restores identical legacy markup, keeps all favorites and category/date selection", async () => {
  const a = app();
  a.run("renderFoodGrid()");
  const baseline = a.grid.innerHTML;
  a.context.NCCUsualFoods.loadHistory = async () => [];
  a.run("state.openCat = 'Selected'; state.date = '2026-01-01'; setUsualPreference({ enabled: true })");
  await new Promise(setImmediate);
  assert.match(a.grid.innerHTML, /Your usual foods will appear as you log meals/);
  a.run("setUsualPreference({mode:'favorites'})");
  assert.equal((a.grid.innerHTML.match(/data-food=/g) || []).length, 12);
  a.run("setUsualPreference({enabled:false})");
  assert.equal(a.grid.innerHTML, baseline);
  assert.equal(a.run("state.favorites.length"), 12);
  assert.equal(a.run("state.openCat"), "Selected");
  assert.equal(a.run("state.date"), "2026-01-01");
});

test("history failure is labeled and never substitutes favorites for usage", async () => {
  const a = app();
  a.context.NCCUsualFoods.loadHistory = async () => { throw Error("offline"); };
  a.run("usualSession().enabled = true; state.entries = [{id:'today',qty:2,net_carbs:3}]");
  await a.run("refreshUsualFoods()");
  assert.match(a.grid.innerHTML, /Most used is unavailable right now/);
  assert.match(a.grid.innerHTML, /Show Favorites/);
  assert.doesNotMatch(a.grid.innerHTML, /data-food=/);
  assert.equal(a.run("dayTotal()"), 6);
  a.run("setUsualPreference({mode:'favorites'})");
  assert.equal((a.grid.innerHTML.match(/data-food=/g) || []).length, 12);
});

test("background loading, frozen membership, catalog edits/deletes and fresh session", async () => {
  const a = app();
  let finish, calls = 0;
  a.context.NCCUsualFoods.loadHistory = () => { calls++; return new Promise((r) => finish = r); };
  a.run("usualSession().enabled = true; state.date = '2026-01-01'; state.entries = [{id:'day',qty:2,net_carbs:3}]");
  const request = a.run("refreshUsualFoods()");
  assert.equal(a.run("state.usual.status"), "loading");
  assert.equal(a.run("dayTotal()"), 6);
  const row = { id: "confirmed", food_id: "0", person: "rich", qty: 1, log_date: U.windowFor().end };
  finish([row]); await request;
  assert.equal(a.run("state.usual.ids.join(',')"), "0");
  a.run("state.entries.push({id:'new',food_id:'1',qty:5,net_carbs:2}); renderFoodGrid()");
  await a.run("refreshUsualFoods()");
  assert.equal(calls, 1);
  assert.equal(a.run("state.usual.ids.join(',')"), "0");
  a.run("state.foods[0].name = 'Changed name'; state.foods[0].serving = 'Changed serving'; renderFoodGrid()");
  assert.match(a.grid.innerHTML, /Changed name/);
  assert.match(a.grid.innerHTML, /Changed serving/);
  a.run("state.foods = state.foods.filter(f => f.id !== '0'); renderFoodGrid()");
  assert.doesNotMatch(a.grid.innerHTML, /data-food="0"/);
  const fresh = a.run("refreshUsualFoods({freshSession:true})");
  finish([{ ...row, food_id: "1" }]); await fresh;
  assert.equal(a.run("state.usual.ids.join(',')"), "1");
  assert.equal(a.run("state.entries.length"), 2);
});

test("late responses for another person cannot populate the active session", async () => {
  const a = app();
  let resolveRich;
  a.context.NCCUsualFoods.loadHistory = () => new Promise((r) => resolveRich = r);
  a.run("usualSession().enabled = true");
  const request = a.run("refreshUsualFoods()");
  a.run("state.person = 'gen'; usualSession()");
  resolveRich([{ id: "entry", food_id: "0", qty: 1, person: "rich", log_date: U.windowFor().end }]);
  await request;
  assert.equal(a.run("state.usual.person"), "gen");
  assert.equal(a.run("state.usual.status"), "idle");
  assert.equal(a.run("state.usual.enabled"), false);
  assert.equal(a.run("state.usual.ids.length"), 0);
});

test("only a return after 15 minutes refreshes membership, including page cache returns", () => {
  const a = app();
  let now = 0;
  a.context.Date = class extends Date { static now() { return now; } };
  a.run("let refreshes = 0; refreshUsualFoods = () => { refreshes++; }; refreshAfterReturn = () => {}; setupReturnRefresh()");
  a.context.document.visibilityState = "hidden"; a.events.visibilitychange();
  now = 899999; a.context.document.visibilityState = "visible"; a.events.visibilitychange();
  assert.equal(a.run("refreshes"), 0);
  a.events.pagehide(); now += 900000; a.events.pageshow({ persisted: true });
  a.events.visibilitychange(); // Same return must not start a second history request.
  assert.equal(a.run("refreshes"), 1);
});

test("search and A–Z exclude Usual foods", () => {
  const a = app();
  a.run("usualSession().enabled = true; state.search = 'Food'; renderFoodGrid()");
  assert.doesNotMatch(a.grid.innerHTML, /usual-foods/);
  a.run("state.search = ''; state.foodView = 'az'; renderFoodGrid()");
  assert.doesNotMatch(a.grid.innerHTML, /usual-foods/);
  assert.equal((a.grid.innerHTML.match(/data-food=/g) || []).length, 12);
});

test("shared gestures: each tap logs once, each hold opens portions with no tap in all modes", () => {
  for (const mode of ["legacy", "most", "favorites"]) {
    const a = app();
    a.run(`usualSession().enabled = ${mode !== "legacy"}; state.usual.mode = '${mode}';
      let logs = 0, portions = 0; logFood = () => logs++; openPortionSheet = () => portions++;
      confirmPulse = () => {}; wireFoodGridGestures();`);
    const button = { dataset: { food: "0" } };
    const e = { clientY: 1, target: { closest: () => button } };
    a.events["grid:pointerdown"](e); a.events["grid:pointerup"](e);
    assert.equal(a.run("logs"), 1, mode);
    a.events["grid:pointerdown"](e);
    [...a.timers.values()].forEach((fn) => fn());
    a.events["grid:pointerup"](e);
    assert.equal(a.run("portions"), 1, mode);
    assert.equal(a.run("logs"), 1, mode);
  }
});

test("logging, portions, quantity/time edits, deletion and undo work even when usage fails", async () => {
  const a = app();
  const rows = new Map();
  let sequence = 0, fail = false;
  a.context.testDB = { from(table) {
    assert.equal(table, "entries");
    return {
      insert(value) { return { select() { return { async single() {
        if (fail) return { error: Error("offline") };
        const row = { ...value, id: String(++sequence), created_at: new Date().toISOString() };
        rows.set(row.id, row); return { data: row };
      } }; } }; },
      update(value) { return { async eq(_key, id) { Object.assign(rows.get(id), value); return {}; } }; },
      delete() { return { async eq(_key, id) { rows.delete(id); return {}; } }; },
    };
  } };
  a.run(`db = testDB; renderEntries = () => {}; renderProgress = () => {}; closeModal = () => {};
    let undo; toast = (_message, _label, action) => { if (action) undo = action; };
    usualSession().enabled = true; state.usual.status = 'error';`);
  await a.run("logFood(state.foods[0], 2)");
  assert.equal(rows.size, 1, "two servings are one saved entry");
  assert.equal(a.run("dayTotal()"), 4);
  await a.run("setQty(state.entries[0], 3)");
  assert.equal(a.run("dayTotal()"), 6);
  await a.run("setEntryTime(state.entries[0], '2026-09-19T10:00:00Z', '03:00')");
  assert.equal([...rows.values()][0].logged_local_time, "03:00");
  await a.run("removeEntry(state.entries[0])");
  assert.equal(rows.size, 0);
  assert.equal(a.run("dayTotal()"), 0);
  await a.run("undo()");
  assert.equal(rows.size, 1);
  assert.equal(a.run("dayTotal()"), 6);
  fail = true;
  await a.run("logFood(state.foods[1])");
  assert.equal(a.run("state.entries.length"), 1, "failed additions are removed");
  assert.equal(a.run("state.usual.status"), "error");
  assert.equal(a.run("state.usual.ids.length"), 0);
});

test("a timed-out request leaves a usable, labeled fallback", async () => {
  const a = app();
  a.context.NCCUsualFoods.loadHistory = (_db, _person, _window, { signal }) => new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(Error("timed out")));
  });
  a.run("usualSession().enabled = true");
  const request = a.run("refreshUsualFoods()");
  [...a.timers.values()].forEach((fn) => fn());
  await request;
  assert.match(a.grid.innerHTML, /Most used is unavailable right now/);
  assert.match(a.grid.innerHTML, /Show Favorites/);
});
