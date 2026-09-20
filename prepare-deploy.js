"use strict";

// Builds a small Netlify Drop folder containing only files the app needs.
// This keeps planning notes, tests, SQL, and other development files private.
const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const output = path.join(root, "netlify-publish");
const files = [
  "index.html",
  "styles.css",
  "app.js",
  "voice-logging.js",
  "label-scanning.js",
  "log-later.js",
  "config.js",
  "manifest.webmanifest",
  "service-worker.js",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "icons/apple-touch-icon.png",
];

fs.rmSync(output, { recursive: true, force: true });
for (const relative of files) {
  const source = path.join(root, relative);
  const destination = path.join(output, relative);
  if (!fs.existsSync(source)) throw new Error(`Missing required deploy file: ${relative}`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

console.log(`Netlify folder ready: ${output}`);
console.log(`Included ${files.length} runtime files; development notes and tests were excluded.`);
