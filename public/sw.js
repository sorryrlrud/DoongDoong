const CACHE_NAME = "doongdoong-v8";
const APP_SHELL = ["./manifest.webmanifest", "./icon-192.png", "./icon-512.png"];

const cacheAppShell = async () => {
  const cache = await caches.open(CACHE_NAME);
  const indexResponse = await fetch("./");
  const indexHtml = await indexResponse.clone().text();
  await cache.put("./", indexResponse.clone());
  await cache.put("./index.html", indexResponse);

  const compiledAssets = [...indexHtml.matchAll(/(?:src|href)="([^"#?]+)"/g)]
    .map(([, path]) => path)
    .filter((path) => path.includes("/assets/"));

  await Promise.all(
    [...APP_SHELL, ...compiledAssets].map(async (path) => {
      const request = new Request(new URL(path, self.registration.scope));
      const response = await fetch(request);
      if (response.ok) await cache.put(request, response);
    }),
  );
};

self.addEventListener("install", (event) => {
  event.waitUntil(cacheAppShell());
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(async () => (await caches.match("./index.html")) ?? caches.match("./")),
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached ?? network;
    }),
  );
});
