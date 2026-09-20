"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const LL = require("./log-later.js");

const id1 = "11111111-1111-4111-8111-111111111111";
const id2 = "22222222-2222-4222-8222-222222222222";
const id3 = "33333333-3333-4333-8333-333333333333";

assert.equal(LL.validateNote("   ").error, "empty");
assert.equal(LL.validateNote("x".repeat(501)).error, "too_long");
assert.equal(LL.validateNote("  <img src=x onerror=alert(1)>  ").note, "<img src=x onerror=alert(1)>");
assert.equal(LL.validDate("2024-02-29"), true);
assert.equal(LL.validDate("2025-02-29"), false);
assert.equal(LL.validUuid(id1), true);
assert.equal(LL.validUuid("not-an-id"), false);

const local = new Date(2026, 8, 19, 14, 7, 8, 0);
const capture = LL.capturePayload("Lunch salad", "2026-09-18", id1, local);
assert.equal(capture.note, "Lunch salad");
assert.equal(capture.log_date, "2026-09-18");
assert.equal(capture.local_time, "14:07:08");
assert.ok(!Number.isNaN(Date.parse(capture.captured_at)));
assert.match(capture.timezone, /(?:[A-Za-z_]+\/[A-Za-z_]+ )?\([+-]\d{2}:\d{2}\)|^[+-]\d{2}:\d{2}$/);

const statuses = LL.pendingStatus("18", 1, 3);
assert.equal(statuses.day, "18 g logged · 1 meal pending");
assert.equal(statuses.all, "3 items need logging");
assert.equal(statuses.incomplete, true);
assert.equal(LL.pendingForDate([
  { status: "pending", log_date: "2026-09-18" },
  { status: "resolved", log_date: "2026-09-18" },
  { status: "pending", log_date: "2026-09-19" },
], "2026-09-18").length, 1);

const memory = new Map();
LL.setManageKey("rich", "secret-rich", { setItem: (k, v) => memory.set(k, v), removeItem: (k) => memory.delete(k) });
assert.equal(LL.getManageKey("rich", { getItem: (k) => memory.get(k) }), "secret-rich");
assert.equal(LL.getManageKey("gen", { getItem: (k) => memory.get(k) }), "");

(async () => {
  let request;
  const success = await LL.request("https://example.supabase.co/", "token", { action: "list" }, async (url, options) => {
    request = { url, options };
    return { ok: true, status: 200, json: async () => ({ ok: true, items: [] }) };
  });
  assert.deepEqual(success.items, []);
  assert.equal(request.url, "https://example.supabase.co/functions/v1/log-later");
  assert.equal(request.options.headers["X-Log-Later-Token"], "token");
  assert.equal(JSON.parse(request.options.body).action, "list");

  await assert.rejects(
    LL.request("https://example.supabase.co", "bad", { action: "list" }, async () => ({
      ok: false, status: 401, json: async () => ({ ok: false, error: "invalid_credential", message: "revoked" }),
    })),
    (error) => error instanceof LL.ApiError && error.status === 401 && error.code === "invalid_credential"
  );

  // Mocked state-machine checks: owner-bound credentials, capture idempotency,
  // conflicting request IDs, version conflicts, atomic replacement, and retries.
  class MockService {
    constructor() {
      this.tokens = new Map([
        ["rich-capture", { owner: "rich", scope: "capture" }],
        ["rich-manage", { owner: "rich", scope: "manage" }],
        ["gen-manage", { owner: "gen", scope: "manage" }],
      ]);
      this.pending = new Map();
      this.entries = [];
      this.foods = new Map([["food-1", { name: "Egg", net_carbs: 0.4 }]]);
    }
    auth(token, scope) {
      const credential = this.tokens.get(token);
      if (!credential || (scope === "manage" && credential.scope !== "manage")) throw new Error("unauthorized");
      return credential;
    }
    capture(token, body) {
      const credential = this.auth(token, "capture");
      const key = credential.owner + ":" + body.request_id;
      const existing = this.pending.get(key);
      if (existing) {
        if (JSON.stringify(existing.capture) !== JSON.stringify(body)) throw new Error("request_id_conflict");
        return existing;
      }
      const item = { id: key, owner: credential.owner, version: 1, status: "pending", capture: structuredClone(body) };
      this.pending.set(key, item);
      return item;
    }
    list(token) {
      const credential = this.auth(token, "manage");
      return [...this.pending.values()].filter((item) => item.owner === credential.owner && item.status === "pending");
    }
    edit(token, id, version, note) {
      const credential = this.auth(token, "manage");
      const item = [...this.pending.values()].find((candidate) => candidate.id === id && candidate.owner === credential.owner);
      if (!item || item.status !== "pending" || item.version !== version) throw new Error("pending_conflict");
      item.capture.note = note; item.version += 1; return item;
    }
    discard(token, id, version) {
      const credential = this.auth(token, "manage");
      const item = [...this.pending.values()].find((candidate) => candidate.id === id && candidate.owner === credential.owner);
      if (!item || item.status !== "pending" || item.version !== version) throw new Error("pending_conflict");
      item.status = "discarded"; item.version += 1; return item;
    }
    resolve(token, id, version, resolutionId, items) {
      const credential = this.auth(token, "manage");
      const item = [...this.pending.values()].find((candidate) => candidate.id === id && candidate.owner === credential.owner);
      if (!item) throw new Error("not_found");
      if (item.status === "resolved") {
        if (item.resolutionId !== resolutionId) throw new Error("pending_conflict");
        return this.entries.filter((entry) => entry.pendingId === id);
      }
      if (item.status !== "pending" || item.version !== version) throw new Error("pending_conflict");
      const staged = items.map((selected, index) => {
        const food = this.foods.get(selected.food_id);
        if (!food) throw new Error("food_not_found");
        return { ...food, qty: selected.qty, pendingId: id, index };
      });
      this.entries.push(...staged); // commit only after every item validates
      item.status = "resolved"; item.version += 1; item.resolutionId = resolutionId;
      return staged;
    }
  }

  const service = new MockService();
  const rich = service.capture("rich-capture", capture);
  assert.equal(service.capture("rich-capture", capture), rich);
  assert.equal(service.list("rich-manage").length, 1);
  assert.equal(service.list("gen-manage").length, 0);
  assert.throws(() => service.capture("rich-capture", { ...capture, note: "different" }), /request_id_conflict/);
  assert.throws(() => service.resolve("gen-manage", rich.id, 1, id2, [{ food_id: "food-1", qty: 1 }]), /not_found/);
  assert.throws(() => service.resolve("rich-manage", rich.id, 1, id2, [{ food_id: "missing", qty: 1 }]), /food_not_found/);
  assert.equal(service.entries.length, 0);
  assert.equal(rich.status, "pending");
  assert.equal(service.resolve("rich-manage", rich.id, 1, id2, [{ food_id: "food-1", qty: 2 }]).length, 1);
  assert.equal(service.resolve("rich-manage", rich.id, 1, id2, [{ food_id: "food-1", qty: 2 }]).length, 1);
  assert.equal(service.entries.length, 1);
  assert.throws(() => service.resolve("rich-manage", rich.id, 2, id1, [{ food_id: "food-1", qty: 2 }]), /pending_conflict/);
  const editable = service.capture("rich-capture", { ...capture, request_id: id3, note: "editable" });
  assert.throws(() => service.edit("rich-manage", editable.id, 99, "changed"), /pending_conflict/);
  assert.equal(service.edit("rich-manage", editable.id, 1, "changed").capture.note, "changed");
  assert.throws(() => service.discard("gen-manage", editable.id, 2), /pending_conflict/);
  assert.equal(service.discard("rich-manage", editable.id, 2).status, "discarded");
  assert.equal(service.entries.length, 1);

  const root = __dirname;
  const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const migration = fs.readFileSync(path.join(root, "log-later-migration.sql"), "utf8");
  const edge = fs.readFileSync(path.join(root, "supabase/functions/log-later/index.ts"), "utf8");
  const deploy = fs.readFileSync(path.join(root, "prepare-deploy.js"), "utf8");

  assert.match(html, /<script src="voice-logging\.js"><\/script>[\s\S]*<script src="label-scanning\.js"><\/script>[\s\S]*<script src="log-later\.js"><\/script>/);
  assert.match(app, /esc\(pending\.note\)/); // note rendering stays text-only
  assert.match(app, /await Promise\.all\(\[loadEntries\(\), loadPendingItems/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on table public\.pending_food_items from anon, authenticated/);
  assert.match(migration, /grant select, insert, update on table public\.pending_food_items to service_role/);
  assert.match(migration, /where status = 'pending';/);
  assert.match(migration, /for update;/); // serializes competing resolutions
  assert.match(migration, /entries_pending_item_index_unique/); // database duplicate barrier
  assert.ok(migration.indexOf("insert into public.entries") < migration.indexOf("set status = 'resolved'"));
  assert.match(edge, /data\.scope !== "manage"/);
  assert.match(edge, /MAX_BODY_BYTES = 16_384/);
  assert.match(edge, /p_owner: credential\.owner/); // never trusts caller-supplied person
  assert.match(deploy, /"log-later\.js"/);

  console.log("log-later tests passed (contract + mocked backend + integration assertions)");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
