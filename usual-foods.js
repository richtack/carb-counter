/* Local preferences and read-only usage ranking; independent of the selected day. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.NCCUsualFoods = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const compare = (a, b) => String(a).localeCompare(String(b), "en");
  const byName = (a, b) => compare(a.name, b.name) || compare(a.id, b.id);
  const preferenceKey = (person) => `ncc_usual_foods:${person}`;

  function readPreferences(storage, person) {
    try {
      const value = JSON.parse(storage.getItem(preferenceKey(person))) || {};
      return { enabled: value.enabled === true, mode: value.mode === "favorites" ? "favorites" : "most" };
    } catch (_) { return { enabled: false, mode: "most" }; }
  }

  function writePreferences(storage, person, value) {
    try {
      storage.setItem(preferenceKey(person), JSON.stringify({ enabled: value.enabled, mode: value.mode }));
      return true;
    } catch (_) { return false; }
  }

  function windowFor(today = new Date()) {
    const format = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    start.setDate(start.getDate() - 29); // Calendar arithmetic also works across DST.
    return { start: format(start), end: format(today) };
  }

  function rank(foods, entries, person, window = windowFor()) {
    const available = new Map(foods.map((f) => [f.id, f]));
    const usage = new Map();
    for (const entry of entries) {
      if (entry.person !== person || !entry.id || entry._pending || entry.deleted || entry.deleted_at ||
          !entry.food_id || !available.has(entry.food_id) || !(Number(entry.qty) > 0) ||
          !entry.log_date || entry.log_date < window.start || entry.log_date > window.end) continue;
      const item = usage.get(entry.food_id) || { food: available.get(entry.food_id), uses: 0, recent: "" };
      item.uses++;
      if (entry.log_date > item.recent) item.recent = entry.log_date;
      usage.set(entry.food_id, item);
    }
    return [...usage.values()]
      .sort((a, b) => b.uses - a.uses || compare(b.recent, a.recent) || byName(a.food, b.food))
      .slice(0, 9).map((item) => item.food).sort(byName).map((food) => food.id);
  }

  async function loadHistory(db, person, window, { signal, pageSize = 500 } = {}) {
    const rows = [], seen = new Set();
    let expected;
    do {
      let query = db.from("entries").select("id,food_id,qty,log_date,person", { count: "exact" })
        .eq("person", person).gte("log_date", window.start).lte("log_date", window.end)
        .order("id").range(rows.length, rows.length + pageSize - 1);
      if (signal) query = query.abortSignal(signal);
      const { data, error, count } = await query;
      if (error) throw error;
      // Count verification prevents a server row cap or partial response being treated as complete.
      if (!Array.isArray(data) || !Number.isInteger(count) || count < 0 ||
          (expected !== undefined && count !== expected)) throw new Error("Usage history changed or is incomplete");
      expected = count;
      for (const row of data) {
        if (!row.id || seen.has(row.id) || row.person !== person) throw new Error("Invalid usage page");
        seen.add(row.id);
        rows.push(row);
      }
      if (rows.length > expected || (!data.length && rows.length < expected)) throw new Error("Incomplete usage history");
    } while (rows.length < expected);
    return rows;
  }

  return { byName, readPreferences, writePreferences, windowFor, rank, loadHistory };
});
