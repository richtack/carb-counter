"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function app({ entries = [], statuses = [] } = {}) {
  const nodes = new Map(), messages = [], downloads = [], calls = [];
  const tables = { entries, day_log_status: statuses };
  const faults = { read: false, write: false, throwWrite: false, delay: null };
  class Query {
    constructor(table) { this.table = table; this.filters = []; this.orders = []; }
    select() { return this; }
    eq(k, v) { this.filters.push([k, v]); return this; }
    order(k) { this.orders.push(k); return this; }
    range(a, b) { this.start = a; this.end = b; return this; }
    maybeSingle() { this.one = true; return this; }
    single() { this.one = true; return this; }
    upsert(value, options) { this.value = value; this.conflict = options.onConflict; return this; }
    async then(resolve, reject) {
      try {
        calls.push(this);
        const fail = this.value ? faults.write : faults.read;
        const snapshot = tables[this.table].filter((r) => this.filters.every(([k, v]) => r[k] === v)).map((r) => ({ ...r }));
        if (faults.delay) await faults.delay(this);
        if (this.value && faults.throwWrite) throw new Error("Network unavailable");
        if (fail) return resolve({ error: new Error("Unavailable") });
        let rows = snapshot;
        if (this.value) {
          assert.equal(this.conflict, "person,log_date");
          let row = tables[this.table].find((r) => r.person === this.value.person && r.log_date === this.value.log_date);
          if (row) Object.assign(row, this.value);
          else { row = { ...this.value }; tables[this.table].push(row); }
          rows = [row];
        }
        rows.sort((a, b) => {
          for (const key of this.orders) { const n = String(a[key]).localeCompare(String(b[key])); if (n) return n; }
          return 0;
        });
        // Deliberately lower than the client's requested page size.
        if (this.start !== undefined) rows = rows.slice(this.start, Math.min(this.end + 1, this.start + 2));
        resolve({ data: this.one ? rows[0] || null : rows, error: null });
      } catch (error) { reject(error); }
    }
  }
  function node(selector) {
    if (!nodes.has(selector)) nodes.set(selector, { textContent: "", innerHTML: "", style: {}, attrs: {},
      classList: { toggle() {}, add() {}, remove() {} }, setAttribute(k, v) { this.attrs[k] = v; } });
    return nodes.get(selector);
  }
  const context = { console, Date, setTimeout, clearTimeout, navigator: {},
    localStorage: { getItem: () => null }, document: { querySelector: node, addEventListener() {} },
    database: { from: (table) => new Query(table) }, notify: (message) => messages.push(message),
    download: (...args) => downloads.push(args) };
  context.window = context;
  vm.createContext(context);
  const run = (code) => vm.runInContext(code, context);
  run(fs.readFileSync("app.js", "utf8"));
  run("db = database; toast = notify; downloadFile = download; renderMiniTally = () => {}; state.date = '2026-01-02'");
  return { run, node, tables, faults, messages, downloads, calls };
}

test("flag survives reload, can be removed, preserves nutrition and is isolated by person/date", async () => {
  const a = app();
  a.run("state.entries = [{qty:2,net_carbs:3,calories:100}]; state.trackCalories = true");
  await a.run("loadDayStatus()");
  await a.run("toggleDayIncomplete()");
  assert.equal(a.tables.day_log_status[0].incomplete, true);
  assert.equal(a.node("#dayIncompleteBtn").attrs["aria-pressed"], "true");
  assert.equal(a.run("dayTotal()"), 6);
  assert.equal(a.run("dayCalories().total"), 200);
  assert.match(a.node("#calLine").innerHTML, /incomplete/);
  a.run("state.dayStatus = null");
  await a.run("loadDayStatus()");
  assert.equal(a.run("dayIsIncomplete()"), true);
  a.run("state.person = 'gen'");
  await a.run("loadDayStatus()");
  assert.equal(a.run("dayIsIncomplete()"), false);
  a.run("state.person = 'rich'; state.date = '2026-01-03'");
  await a.run("loadDayStatus()");
  assert.equal(a.run("dayIsIncomplete()"), false);
  a.run("state.date = '2026-01-02'");
  await a.run("loadDayStatus();");
  await a.run("toggleDayIncomplete()");
  assert.equal(a.tables.day_log_status.length, 1);
  assert.equal(a.tables.day_log_status[0].incomplete, false);
});

test("failed reads are labeled and retryable; failed writes preserve the saved flag", async () => {
  const a = app();
  a.faults.read = true;
  await a.run("loadDayStatus()");
  assert.match(a.node("#dayIncompleteBtn").textContent, /Retry/);
  a.faults.read = false;
  await a.run("toggleDayIncomplete()"); // Retry the read, without writing a flag.
  assert.equal(a.tables.day_log_status.length, 0);
  a.faults.write = true;
  await a.run("toggleDayIncomplete()");
  assert.equal(a.run("dayIsIncomplete()"), false);
  assert.match(a.messages.at(-1), /Couldn’t save/);
  a.faults.write = false;
  await a.run("toggleDayIncomplete()");
  a.faults.throwWrite = true;
  await a.run("toggleDayIncomplete()");
  assert.equal(a.run("dayIsIncomplete()"), true);
  assert.equal(a.node("#dayIncompleteBtn").disabled, false);
});

test("late day reads cannot replace the selected day", async () => {
  const a = app({ statuses: [{person:"rich",log_date:"2026-01-02",incomplete:true}] });
  let finish;
  a.faults.delay = (q) => q.filters.some(([k,v]) => k === "log_date" && v === "2026-01-02")
    ? new Promise((r) => finish = r) : Promise.resolve();
  const first = a.run("loadDayStatus()");
  await new Promise(setImmediate);
  a.run("state.date = '2026-01-03'");
  await a.run("loadDayStatus()");
  finish(); await first;
  assert.equal(a.run("currentDayStatus().date"), "2026-01-03");
  assert.equal(a.run("dayIsIncomplete()"), false);
});

test("saving targets the original date, ignores double taps and refreshes after navigation", async () => {
  const a = app();
  await a.run("loadDayStatus()");
  let finish;
  a.faults.delay = (q) => q.value ? new Promise((r) => finish = r) : Promise.resolve();
  const save = a.run("toggleDayIncomplete()");
  await new Promise(setImmediate);
  await a.run("toggleDayIncomplete()");
  a.run("state.date = '2026-01-03'");
  await a.run("loadDayStatus()");
  finish(); await save;
  assert.equal(a.tables.day_log_status.length, 1);
  assert.equal(a.tables.day_log_status[0].log_date, "2026-01-02");
  assert.equal(a.run("currentDayStatus().date"), "2026-01-03");
  assert.equal(a.run("dayIsIncomplete()"), false);
});

test("future days cannot be flagged; adding food does not silently clear a flag", async () => {
  const a = app();
  a.run("state.date = '2999-01-01'");
  await a.run("loadDayStatus()");
  await a.run("toggleDayIncomplete()");
  assert.equal(a.tables.day_log_status.length, 0);
  assert.equal(a.node("#dayIncompleteBtn").disabled, true);
  a.run("state.date = '2026-01-02'");
  await a.run("loadDayStatus()"); await a.run("toggleDayIncomplete()");
  a.run("state.entries.push({qty:1,net_carbs:8}); renderProgress()");
  assert.equal(a.run("dayIsIncomplete()"), true);
});

test("CSV includes all pages, person-specific flags, blank-nutrition empty days and calories", async () => {
  const entries = Array.from({length:5}, (_, i) => ({person:"rich",id:String(i),log_date:"2026-01-02",created_at:String(i),name:"Food",net_carbs:3,qty:2,calories:50}));
  entries.push({ ...entries[0], person:"gen", name:"Other person" });
  entries.push({ ...entries[0], id:"unflagged", log_date:"2026-01-03" });
  const statuses = [
    {person:"rich",log_date:"2026-01-02",incomplete:true},
    {person:"rich",log_date:"2026-01-01",incomplete:true},
    {person:"rich",log_date:"2026-01-04",incomplete:true},
    {person:"gen",log_date:"2026-01-03",incomplete:true},
  ];
  const a = app({ entries, statuses });
  a.run("state.trackCalories = true");
  await a.run("exportLog()");
  const csv = a.downloads[0][1];
  assert.equal(csv.split("\r\n").length, 9);
  assert.match(csv, /calories_total,day_log_incomplete,row_type/);
  assert.match(csv, /2026-01-01,,,,,,true,day_status/);
  assert.match(csv, /2026-01-02,Food,3,2,6,100,true,food/);
  assert.match(csv, /2026-01-03,Food,3,2,6,100,false,food/);
  assert.doesNotMatch(csv, /Other person/);
  assert.ok(a.calls.every((q) => q.filters.some(([k,v]) => k === "person" && v === "rich")));
});

test("CSV never downloads partial results when day flags cannot be read", async () => {
  const a = app();
  a.faults.read = true;
  await a.run("exportLog()");
  assert.equal(a.downloads.length, 0);
  assert.match(a.messages.at(-1), /Couldn’t export/);
});
