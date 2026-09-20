"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const U = require("./usual-foods.js");
const window = { start: "2026-08-21", end: "2026-09-19" };
const foods = Array.from({ length: 12 }, (_, i) => ({ id: String(i), name: `Food ${String(i).padStart(2, "0")}` }));
let seq = 0;
const entry = (food_id, extra = {}) => ({ id: `e${seq++}`, food_id, person: "rich", log_date: window.end, qty: 1, ...extra });

test("30 local calendar dates across month, year and DST boundaries", () => {
  assert.deepEqual(U.windowFor(new Date(2026, 8, 19, 23, 59)), window);
  assert.deepEqual(U.windowFor(new Date(2026, 0, 5)), { start: "2025-12-07", end: "2026-01-05" });
  assert.deepEqual(U.windowFor(new Date(2026, 2, 15)), { start: "2026-02-14", end: "2026-03-15" });
});

test("confirmed occasions, stable IDs, boundaries and person isolation", () => {
  const logs = [entry("0", { log_date: window.start, name: "Renamed" }), entry("1", { qty: 20 }), entry("0", { qty: .25 }),
    entry("2", { person: "gen" }), entry("2", { qty: 0 }), entry("2", { qty: -1 }),
    entry("2", { log_date: "2026-08-20" }), entry("2", { log_date: "2026-09-20" }),
    entry("2", { _pending: true }), entry("2", { deleted_at: "2026-09-19" }), entry("2", { id: null }),
    entry(null), entry("missing")];
  assert.deepEqual(U.rank(foods, logs, "rich", window), ["0", "1"]);
  assert.deepEqual(U.rank(foods, logs, "gen", window), ["2"]);
  assert.deepEqual(U.rank([], logs, "rich", window), []);
  assert.deepEqual(U.rank(foods, [], "rich", window), []);
});

test("frequency chooses nine; recency, name and ID break ties; display is alphabetical", () => {
  const logs = foods.map((f) => entry(f.id, { log_date: window.start }));
  logs.push(entry("11"), entry("10"));
  assert.deepEqual(U.rank(foods, logs, "rich", window), ["0", "1", "2", "3", "4", "5", "6", "10", "11"]);
  logs.find((e) => e.food_id === "9").log_date = window.end;
  assert.deepEqual(U.rank(foods, logs, "rich", window), ["0", "1", "2", "3", "4", "5", "9", "10", "11"]);
  const tiedFoods = [...foods].reverse().map((f) => ({ ...f, name: "Same" }));
  assert.deepEqual(U.rank(tiedFoods, foods.map((f) => entry(f.id)), "rich", window),
    ["0", "1", "10", "11", "2", "3", "4", "5", "6"]);
});

function pagedDB(rows, { cap = 3, failPage, partial = false, changed = false, duplicate = false } = {}) {
  let pages = 0;
  return { get pages() { return pages; }, from(table) {
    assert.equal(table, "entries");
    const filters = [];
    const q = {
      select(_columns, options) { assert.equal(options.count, "exact"); return q; },
      eq(k, v) { filters.push((r) => r[k] === v); return q; },
      gte(k, v) { filters.push((r) => r[k] >= v); return q; },
      lte(k, v) { filters.push((r) => r[k] <= v); return q; },
      order(k) { assert.equal(k, "id"); return q; },
      async range(start, end) {
        pages++;
        if (pages === failPage) return { error: new Error("offline") };
        const matches = rows.filter((r) => filters.every((f) => f(r))).sort((a, b) => a.id.localeCompare(b.id));
        const data = partial && pages > 1 ? [] : matches.slice(duplicate ? 0 : start, Math.min(end + 1, start + cap));
        return { data, count: matches.length + (changed && pages > 1 ? 1 : 0) };
      },
    };
    return q;
  } };
}

test("complete results beyond requested page size and a smaller server cap", async () => {
  const rows = Array.from({ length: 1203 }, (_, i) => entry(String(i % 12)));
  rows.push(entry("0", { person: "gen" }), entry("1", { log_date: "2026-08-20" }));
  const db = pagedDB(rows, { cap: 100 });
  const result = await U.loadHistory(db, "rich", window);
  assert.equal(result.length, 1203);
  assert.equal(db.pages, 13);
  assert.equal(new Set(result.map((r) => r.id)).size, 1203);
  assert.deepEqual(await U.loadHistory(pagedDB([]), "rich", window), []);
});

test("failed, incomplete, changing and duplicate pages cannot become rankings", async () => {
  const rows = Array.from({ length: 10 }, () => entry("0"));
  for (const options of [{ failPage: 2 }, { partial: true }, { changed: true }, { duplicate: true }]) {
    await assert.rejects(U.loadHistory(pagedDB(rows, options), "rich", window));
  }
});

test("preferences start off, preserve each person's mode, and tolerate unavailable storage", () => {
  const map = new Map();
  const storage = { getItem: (k) => map.get(k), setItem: (k, v) => map.set(k, v) };
  assert.deepEqual(U.readPreferences(storage, "rich"), { enabled: false, mode: "most" });
  U.writePreferences(storage, "rich", { enabled: true, mode: "favorites" });
  assert.deepEqual(U.readPreferences(storage, "gen"), { enabled: false, mode: "most" });
  assert.deepEqual(U.readPreferences(storage, "rich"), { enabled: true, mode: "favorites" });
  const broken = { getItem() { throw Error(); }, setItem() { throw Error(); } };
  assert.deepEqual(U.readPreferences(broken, "rich"), { enabled: false, mode: "most" });
  assert.equal(U.writePreferences(broken, "rich", {}), false);
});
