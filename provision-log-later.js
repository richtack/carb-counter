"use strict";

// Generates two independent per-person bearer credentials and the SQL that
// stores only their SHA-256 verifiers. Nothing is written to disk.
const crypto = require("node:crypto");

const owner = String(process.argv[2] || "").trim().toLowerCase();
const requestedScope = String(process.argv[3] || "both").trim().toLowerCase();
if (!/^[a-z][a-z0-9_-]{0,49}$/.test(owner)) {
  console.error("Usage: node provision-log-later.js rich [both|capture|manage]");
  process.exitCode = 1;
  return;
}
if (!["both", "capture", "manage"].includes(requestedScope)) {
  console.error("Scope must be both, capture, or manage.");
  process.exitCode = 1;
  return;
}

const token = () => "ncc_ll_" + crypto.randomBytes(32).toString("base64url");
const hash = (value) => crypto.createHash("sha256").update(value, "utf8").digest("hex");
const capture = requestedScope === "manage" ? null : token();
const manage = requestedScope === "capture" ? null : token();
const quote = (value) => "'" + value.replace(/'/g, "''") + "'";

console.log(`\nLOG LATER CREDENTIALS FOR ${owner.toUpperCase()}\n`);
if (capture) {
  console.log("Siri capture key (put only in that person's Shortcut):");
  console.log(capture);
}
if (manage) {
  console.log("\nApp management key (enter once in that person's Carb Counter):");
  console.log(manage);
}
console.log("\nRun this SQL in Supabase SQL Editor:\n");
const rows = [];
if (capture) rows.push(`  (${quote(owner)}, 'capture', 'Siri Log food later', '${hash(capture)}')`);
if (manage) rows.push(`  (${quote(owner)}, 'manage', 'Carb Counter web app', '${hash(manage)}')`);
console.log(`insert into public.log_later_credentials (owner, scope, label, token_hash) values\n${rows.join(",\n")};`);
console.log("\nSave both keys temporarily in a password manager until setup is verified.");
console.log("This command does not save them to the project or to a file.\n");
