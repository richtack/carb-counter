"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

// Load app.js without starting the browser. The small fake database exercises
// the real label save path, including a duplicate retry and a failed request.
const storage = new Map();
const context = {
  console,
  URLSearchParams,
  TextEncoder,
  crypto: globalThis.crypto,
  setTimeout: () => 0,
  clearTimeout: () => {},
  confirm: () => true,
  performance: { now: () => 1 },
  navigator: {},
  location: { hash: "", pathname: "/", search: "", protocol: "http:" },
  history: { replaceState: () => {} },
  localStorage: {
    getItem: (key) => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  },
  document: {
    addEventListener: () => {},
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ content: {} }),
  },
};
context.window = context;
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync("app.js", "utf8"), context, { filename: "app.js" });

(async () => {
  const result = await vm.runInContext(`(async () => {
    setFavorite = async () => {};
    closeModal = () => {};
    renderFoodGrid = () => {};
    renderEditor = () => {};
    toast = () => {};
    state.calReady = true;
    state.foods = [];

    const storedFoods = new Map();
    let failNext = false;
    let upserts = 0;
    let foodSelects = 0;
    let entriesCalls = 0;
    db = {
      from(table) {
        if (table === "entries") entriesCalls++;
        return {
          upsert(row) {
            upserts++;
            return {
              async select() {
                if (failNext) { failNext = false; return { data: null, error: new Error("offline") }; }
                if (storedFoods.has(row.id)) return { data: [], error: null };
                const saved = { ...row, created_at: "2026-09-19T12:00:00Z" };
                storedFoods.set(row.id, saved);
                return { data: [saved], error: null };
              },
            };
          },
          select() {
            foodSelects++;
            return { eq(_column, id) { return { async maybeSingle() {
              return { data: storedFoods.get(id) || null, error: null };
            } }; } };
          },
        };
      },
    };

    const draft = { foodId: "11111111-1111-5111-8111-111111111111", draftId: "same-draft" };
    const first = await saveLabelFood({
      name: "Test Food", serving: "1 bar", net_carbs: "3", category: "Snack",
      favorite: false, calories: "120",
    }, draft);
    const retry = await saveLabelFood({
      name: "Changed on retry", serving: "1 bar", net_carbs: "99", category: "Snack",
      favorite: false, calories: "999",
    }, draft);
    failNext = true;
    const failed = await saveLabelFood({
      name: "Failed Food", serving: "1 cup", net_carbs: "4", category: "",
      favorite: false, calories: "",
    }, { foodId: "22222222-2222-5222-8222-222222222222", draftId: "failed-draft" });

    return {
      first, retry, failed, upserts, foodSelects, entriesCalls,
      storedCount: storedFoods.size,
      appFoodCount: state.foods.length,
      savedName: storedFoods.get(draft.foodId).name,
      savedNet: storedFoods.get(draft.foodId).net_carbs,
      savedCalories: storedFoods.get(draft.foodId).calories,
      escapedSource: esc('<img src=x onerror="alert(1)">'),
    };
  })()`, context);

  assert.equal(result.first, true);
  assert.equal(result.retry, true);
  assert.equal(result.failed, false);
  assert.equal(result.upserts, 3);
  assert.equal(result.foodSelects, 1, "duplicate retry should read back the original row");
  assert.equal(result.entriesCalls, 0, "saving a scanned food must never write a meal entry");
  assert.equal(result.storedCount, 1, "a retry and a failed save must not create extra foods");
  assert.equal(result.appFoodCount, 1);
  assert.equal(result.savedName, "Test Food", "the first committed version wins on retry");
  assert.equal(result.savedNet, 3);
  assert.equal(result.savedCalories, 120);
  assert.equal(result.escapedSource, "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  console.log("label integration tests passed");
})().catch((error) => { console.error(error); process.exitCode = 1; });
