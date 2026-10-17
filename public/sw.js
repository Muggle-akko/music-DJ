const CACHE_NAME = "awudio-workspace-v42";
const COVER_CACHE_NAME = "awudio-covers-v1";
const MAX_COVER_ENTRIES = 240;
const STATIC_ASSETS = [
  "/styles.css",
  "/app.js",
  "/device-policy.mjs",
  "/mobile.mjs",
  "/player-morph.mjs",
  "/waveform.mjs",
  "/settings.mjs",
  "/listening.mjs",
  "/agent.mjs",
  "/radio.mjs",
  "/network.mjs",
  "/data-cache.mjs",
  "/sync-policy.mjs",
  "/media-session.mjs",
  "/assets/phosphor.svg",
  "/manifest.webmanifest",
  "/fonts/google-fonts.css",
  "/fonts/font-01.woff2",
  "/fonts/font-02.woff2",
  "/fonts/font-03.woff2",
  "/fonts/font-04.woff2",
  "/fonts/font-05.woff2",
  "/fonts/font-06.woff2",
  "/fonts/font-07.woff2",
  "/fonts/font-08.woff2",
  "/fonts/font-09.woff2",
  "/fonts/font-10.woff2",
  "/fonts/font-11.woff2",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key.startsWith("awudio-workspace-") && key !== CACHE_NAME).map((key) => caches.delete(key))),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (url.origin !== self.location.origin || event.request.method !== "GET") return;

  if (url.pathname === "/api/music/cover") {
    event.respondWith(cacheCover(event.request));
    return;
  }
  if (!STATIC_ASSETS.includes(url.pathname)) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok && !response.redirected && !response.headers.get("Cache-Control")?.includes("no-store")) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request)),
  );
});

async function cacheCover(request) {
  let cache;
  try {
    cache = await caches.open(COVER_CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) return cached;
  } catch {
    return fetch(request);
  }

  const response = await fetch(request, { cache: "no-store" });
  if (!response.ok || !response.headers.get("Content-Type")?.toLowerCase().startsWith("image/")) return response;
  try {
    await cache.put(request, response.clone());
    const keys = await cache.keys();
    while (keys.length > MAX_COVER_ENTRIES) await cache.delete(keys.shift());
  } catch {
    // Quota/private-mode failures must not block cover loading.
  }
  return response;
}
