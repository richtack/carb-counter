"use strict";
// Safe local preview. Never reads config.js or connects to a real database.
// node preview-usual-foods.js [port]; ?fixture=six|empty|failure|slow|long&text=200&person=gen
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const allowed = new Set(["index.html", "styles.css", "app.js", "usual-foods.js", "voice-logging.js",
  "label-scanning.js", "log-later.js", "manifest.webmanifest", "service-worker.js", "preview-fixtures.js",
  "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png", "icons/apple-touch-icon.png"]);
const types = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".png": "image/png", ".webmanifest": "application/manifest+json" };
const server = http.createServer((req, res) => {
  const name = new URL(req.url, "http://localhost").pathname.slice(1) || "index.html";
  res.setHeader("Cache-Control", "no-store");
  // Keep fixture tests offline even if someone pastes a real management key into Settings.
  res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; worker-src 'self'");
  if (name === "config.js") {
    res.writeHead(200, { "Content-Type": "text/javascript" });
    return res.end(`window.NCC_CONFIG = { SUPABASE_URL: location.origin, SUPABASE_ANON_KEY: "fixture-only", PERSON: new URLSearchParams(location.search).get("person") === "gen" ? "gen" : "rich", DISPLAY_NAME: "Fixture preview" };`);
  }
  if (name === "service-worker.js") {
    res.writeHead(200, { "Content-Type": "text/javascript" });
    // Preview stays fresh while editing. Production uses the real versioned service worker.
    return res.end(`self.addEventListener('install', () => self.skipWaiting()); self.addEventListener('activate', e => e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('ncc-')).map(k => caches.delete(k)))).then(() => self.clients.claim())));`);
  }
  if (!allowed.has(name)) { res.writeHead(404).end("Not a preview asset"); return; }
  let data = fs.readFileSync(path.join(__dirname, name));
  if (name === "index.html") data = data.toString().replace(/<script src="https:\/\/cdn[^\"]+"><\/script>/, '<script src="preview-fixtures.js"></script>');
  res.writeHead(200, { "Content-Type": types[path.extname(name)] || "text/plain" });
  res.end(data);
});
server.listen(Number(process.argv[2]) || 8879, "0.0.0.0", () => console.log(`Fixture preview: http://localhost:${server.address().port} (all writes in memory)`));
