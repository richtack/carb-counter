"use strict";
// Only served by preview-usual-foods.js, never included in deployment packaging.
(() => {
  const params = new URLSearchParams(location.search);
  const fixture = params.get("fixture") || "nine";
  const person = params.get("person") === "gen" ? "gen" : "rich";
  const date = new Date();
  const today = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const names = ["Almonds", "Avocado", "Broccoli", "Cheddar", "Chicken", "Eggs", "Greek yogurt", "Olives", "Salmon", "Tofu", "Walnuts", "Zucchini"];
  const foods = names.map((name, i) => ({ id: `food-${String(i).padStart(2, "0")}`, name,
    serving: ["1 oz", "½ medium", "1 cup"][i % 3], net_carbs: [2.5, 1, 3][i % 3], calories: 100,
    category: i < 6 ? "Meals" : "Snacks", favorite: true }));
  if (fixture === "long") {
    foods[0].name = "Almond butter with roasted crunchy pieces, unsweetened";
    foods[1].name = "Avocado with extra virgin olive oil and cracked black pepper";
    foods[1].serving = "½ medium avocado (approximately 75 grams)";
    foods[2].name = "BroccoliSupercalifragilisticexpialidocious";
  }
  const entries = [];
  const n = fixture === "six" ? 6 : fixture === "empty" ? 0 : 9;
  for (let i = 0; i < n; i++) for (let j = 0; j < 2; j++) entries.push({
    id: `entry-${i}-${j}`, food_id: foods[i].id, name: foods[i].name, qty: 1, net_carbs: foods[i].net_carbs,
    person, log_date: today, created_at: new Date().toISOString(), calories: 100,
  });
  const tables = { foods, entries, settings: ["rich", "gen"].map((p) => ({
    person: p, daily_target: 30, category_order: ["Meals", "Snacks"],
    favorites: foods.slice(0, fixture === "six" ? 6 : 12).map((f) => f.id), track_calories: false,
  })) };
  let sequence = 0;
  class Query {
    constructor(table) { this.table = table; this.filters = []; this.action = "read"; }
    select(_columns, options) { this.withCount = options?.count === "exact"; return this; }
    eq(k, v) { this.filters.push((row) => row[k] === v); return this; }
    gte(k, v) { this.filters.push((row) => row[k] >= v); return this; }
    lte(k, v) { this.filters.push((row) => row[k] <= v); return this; }
    order(k) { this.sortKey = k; return this; }
    range(from, to) { this.offset = from; this.end = to; return this; }
    abortSignal(signal) { this.signal = signal; return this; }
    insert(value) { this.action = "insert"; this.value = value; return this; }
    upsert(value) { return this.insert(value); }
    update(value) { this.action = "update"; this.value = value; return this; }
    delete() { this.action = "delete"; return this; }
    single() { this.one = true; return this; }
    maybeSingle() { this.one = true; return this; }
    async then(resolve, reject) {
      try {
        if (this.withCount && fixture === "slow" && this.offset === 0) await new Promise((r) => setTimeout(r, 5000));
        if (this.signal?.aborted || (this.withCount && fixture === "failure")) return resolve({ data: null, error: new Error("Fixture history unavailable") });
        let rows = (tables[this.table] || []).filter((row) => this.filters.every((f) => f(row)));
        if (this.action === "insert") {
          rows = (Array.isArray(this.value) ? this.value : [this.value]).map((row) => ({ id: `saved-${++sequence}`, created_at: new Date().toISOString(), ...row }));
          tables[this.table].push(...rows);
        } else if (this.action === "update") rows.forEach((row) => Object.assign(row, this.value));
        else if (this.action === "delete") tables[this.table] = tables[this.table].filter((row) => !rows.includes(row));
        if (this.sortKey) rows.sort((a, b) => String(a[this.sortKey]).localeCompare(String(b[this.sortKey])));
        const count = rows.length;
        // Deliberately impose a tiny cap to exercise complete pagination in the real app.
        if (this.offset !== undefined) rows = rows.slice(this.offset, Math.min(this.end + 1, this.offset + 4));
        resolve({ data: structuredClone(this.one ? rows[0] || null : rows), count, error: null });
      } catch (error) { if (reject) reject(error); else throw error; }
    }
  }
  window.supabase = { createClient: () => ({ from: (table) => new Query(table) }) };
  document.addEventListener("DOMContentLoaded", () => {
    if (params.get("text") === "200") document.documentElement.style.fontSize = "200%";
    const label = document.createElement("div");
    label.textContent = "Fixture preview · fictional foods · changes reset on reload";
    label.style.cssText = "text-align:center;font-size:12px;padding:6px;color:#fbbf24";
    document.querySelector(".topbar").before(label);
  });
})();
