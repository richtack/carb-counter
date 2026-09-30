"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function app() {
  const nodes = new Map();
  const classList = () => ({ add() {}, remove() {} });
  const node = (selector) => {
    if (!nodes.has(selector)) nodes.set(selector, {
      value: "", textContent: "", classList: classList(), tagName: "INPUT",
      focus() { this.focused = true; }, blur() { this.focused = false; },
      scrollIntoView() {},
    });
    return nodes.get(selector);
  };
  const context = { console, Date, navigator: {},
    localStorage: { getItem: () => null },
    document: { querySelector: node, querySelectorAll: () => [], addEventListener() {} },
  };
  context.window = context;
  vm.createContext(context);
  const run = (code) => vm.runInContext(code, context);
  run(fs.readFileSync("app.js", "utf8"));
  run(`state.foods = [
    {id:'1',name:'Almond butter',serving:'1 tablespoon',category:'Spreads',net_carbs:2},
    {id:'2',name:'Butter',serving:'1 tablespoon',category:'Dairy',net_carbs:0},
    {id:'3',name:'Nut butter',serving:'2 tablespoons',category:'Spreads',net_carbs:3},
    {id:'4',name:'Peanut butter',serving:'1 tablespoon',category:'Spreads',net_carbs:4},
    {id:'5',name:'Toast',serving:'with butter',category:'Bread',net_carbs:8},
    {id:'6',name:'Bread',serving:'1 slice',category:'Butter',net_carbs:10}
  ];
  let logged = [], portions = 0, days = 0, help = 0;
  logFood = (food) => logged.push(food.name);
  openPortionSheet = (food, onLogged) => { portions++; if (onLogged) onLogged(); };
  renderFoodGrid = () => {};
  confirmPulse = () => {};
  shiftDay = (delta) => { days += delta; };
  openKeyboardHelp = () => { help++; };
  `);
  const key = (target, value, options = {}) => {
    const event = { target, key: value, defaultPrevented: false, isComposing: false,
      ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
      preventDefault() { this.defaultPrevented = true; }, ...options };
    context.event = event;
    run("handleKeyboardShortcuts(event)");
    return event;
  };
  return { run, node, key };
}

test("search ranks exact names, prefixes, substrings, then serving and category matches", () => {
  const a = app();
  a.run("state.search = 'butter'");
  assert.equal(a.run("logSearchResults().map(f => f.name).join(',')"),
    "Butter,Almond butter,Nut butter,Peanut butter,Toast,Bread");
});

test("arrow selection, Enter logging, and repeat search keep focus without logging no matches", () => {
  const a = app();
  const input = a.node("#foodSearch");
  input.value = "butter";
  a.run("state.search = 'butter'; state.searchSelectionId = '2'");
  assert.equal(a.key(input, "ArrowDown").defaultPrevented, true);
  assert.equal(a.run("state.searchSelectionId"), "1");
  a.key(input, "Enter");
  assert.equal(a.run("logged.join(',')"), "Almond butter");
  assert.equal(a.run("state.search"), "");
  assert.equal(input.value, "");
  assert.equal(input.focused, true);

  input.value = "peanut";
  a.run("state.search = 'peanut'; state.searchSelectionId = '4'");
  a.key(input, "Enter");
  assert.equal(a.run("logged.join(',')"), "Almond butter,Peanut butter");

  a.run("state.search = 'missing'; state.searchSelectionId = null");
  a.key(input, "Enter");
  assert.equal(a.run("logged.length"), 2);
});

test("Shift+Enter opens portions, Escape clears then blurs, and global keys avoid forms", () => {
  const a = app();
  const input = a.node("#foodSearch");
  input.value = "butter";
  a.run("state.search = 'butter'; state.searchSelectionId = '2'");
  a.key(input, "Enter", { shiftKey: true });
  assert.equal(a.run("portions"), 1);
  assert.equal(a.run("logged.length"), 0);
  assert.equal(a.run("state.search"), "");
  input.value = "nut";
  a.run("state.search = 'nut'");
  a.key(input, "Escape");
  assert.equal(a.run("state.search"), "");
  a.key(input, "Escape");
  assert.equal(input.focused, false);

  const otherInput = { tagName: "TEXTAREA", isContentEditable: false };
  a.key(otherInput, "[");
  assert.equal(a.run("days"), 0);
  const button = { tagName: "BUTTON", isContentEditable: false, closest: () => null };
  a.key(button, "[");
  a.key(button, "]");
  a.key(button, "?");
  a.key(button, "o", { metaKey: true });
  assert.equal(a.run("days"), 0);
  assert.equal(a.run("help"), 1);
});

test("an open dialog blocks global shortcuts and handles Escape", () => {
  const a = app();
  a.run("modalOpen = true; let escapes = 0; escapeModal = () => { escapes++; }");
  const button = { tagName: "BUTTON", isContentEditable: false, closest: () => null };
  a.key(button, "[");
  a.key(button, "o");
  assert.equal(a.run("days"), 0);
  assert.equal(a.run("escapes"), 0);
  assert.equal(a.key(button, "Escape").defaultPrevented, true);
  assert.equal(a.run("escapes"), 1);
});
