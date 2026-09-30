// Caches the app shell so the PWA opens instantly and works offline.
// (Logging/saving still needs a connection — that talks to Supabase.)
const CACHE = "ncc-v37-saved-meals";
const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./voice-logging.js",
  "./label-scanning.js",
  "./log-later.js",
  "./usual-foods.js",
  "./config.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // Never cache Supabase API calls — always go to the network.
  if (url.hostname.endsWith("supabase.co")) return;
  if (e.request.method !== "GET") return;

  // App shell + same-origin assets: cache-first, fall back to network.
  e.respondWith(
    caches.match(e.request).then((hit) =>
      hit ||
      fetch(e.request).then((res) => {
        const copy = res.clone();
        if (res.ok && url.origin === self.location.origin) {
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      }).catch(() => hit)
    )
  );
});
