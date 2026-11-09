const CACHE = "swimtracker-v7"; // 版本号升至 v7，强制浏览器更新缓存！
const ASSETS = [
  "./",
  "index.html",
  "manifest.json",
  "icons/swimtracker.svg",
  "css/base.css",
  "css/layout.css",
  "css/components.css",
  "css/timer.css",
  "css/record-drawer.css",
  "js/modules/cloud-sync.js",
  "js/modules/exporter.js",
  "js/modules/plan-renderer.js",
  "js/modules/local-storage.js",
  "js/modules/record-panel.js",
  "js/modules/timer-engine.js",
  "js/config.js",
  "js/utils/time-parser.js",
  "js/utils/touch-helper.js",
  "js/app.js",
  "data/plans/2026-11.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE)
    .then((cache) => cache.addAll(ASSETS))
    .then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  // 1. 非 GET 请求（如 API 的 PUT/OPTIONS）直接放行，不走缓存
  if (event.request.method !== "GET") return;
  
  // 2. 跨域的 API 请求直接放行，不走缓存
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request, { cacheName: CACHE })
      .then((cachedResponse) => cachedResponse || fetch(event.request)
        .then((networkResponse) => {
          const responseToCache = networkResponse.clone();
          void caches.open(CACHE).then((cache) => cache.put(event.request, responseToCache));
          return networkResponse;
        })
        .catch(() => event.request.mode === "navigate"
          ? caches.match("index.html", { cacheName: CACHE })
          : Response.error())),
  );
});