const CACHE_NAME = "awudio-mvp-v19";
const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
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
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (url.pathname.startsWith("/api/")) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request)),
  );
});
