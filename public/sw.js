// CacheStorage is shared by every service worker on the same origin. Including
// the scope prevents a /dev/ deployment from deleting or serving /prod/ data.
const CACHE_SCOPE = new URL(self.registration.scope).pathname.replace(/[^a-z0-9]+/gi, "-");
const CACHE_PREFIX = `doongdoong-${CACHE_SCOPE}-`;
const CACHE_NAME = `${CACHE_PREFIX}v16`;
const LEGACY_CACHE_PATTERN = /^doongdoong-v\d+$/;
const APP_SHELL = ["./manifest.webmanifest", "./icon-192.png", "./icon-512.png"];
const DEFAULT_ARRIVAL_URL = "./#/catch";

const cacheAppShell = async () => {
  const cache = await caches.open(CACHE_NAME);
  const indexResponse = await fetch("./", { cache: "no-store" });
  const indexHtml = await indexResponse.clone().text();
  await cache.put("./", indexResponse.clone());
  await cache.put("./index.html", indexResponse);

  const compiledAssets = [...indexHtml.matchAll(/(?:src|href)="([^"#?]+)"/g)]
    .map(([, path]) => path)
    .filter((path) => path.includes("/assets/"));

  await Promise.all(
    [...APP_SHELL, ...compiledAssets].map(async (path) => {
      const request = new Request(new URL(path, self.registration.scope));
      const response = await fetch(request, { cache: "no-store" });
      if (response.ok) await cache.put(request, response);
    }),
  );
};

const scopedCatchUrl = (candidate) => {
  const fallback = new URL(DEFAULT_ARRIVAL_URL, self.registration.scope).href;
  if (typeof candidate !== "string") return fallback;
  try {
    const resolved = new URL(candidate, self.registration.scope);
    return resolved.href.startsWith(self.registration.scope) ? resolved.href : fallback;
  } catch {
    return fallback;
  }
};

const setArrivalBadge = async () => {
  if (typeof self.navigator.setAppBadge !== "function") return;
  await self.navigator.setAppBadge(1).catch(() => undefined);
};

const clearArrivalBadge = async () => {
  if (typeof self.navigator.clearAppBadge !== "function") return;
  await self.navigator.clearAppBadge().catch(() => undefined);
};

const readArrivalPayload = (event) => {
  try {
    const payload = event.data?.json();
    if (
      !payload
      || payload.version !== 1
      || payload.type !== "bottle_arrived"
      || typeof payload.title !== "string"
      || typeof payload.body !== "string"
      || typeof payload.notificationId !== "string"
    ) return null;

    return {
      title: payload.title.slice(0, 120),
      body: payload.body.slice(0, 240),
      tag: typeof payload.tag === "string" ? payload.tag.slice(0, 180) : `bottle-arrived:${payload.notificationId}`,
      url: scopedCatchUrl(payload.url),
    };
  } catch {
    return null;
  }
};

self.addEventListener("install", (event) => {
  event.waitUntil(cacheAppShell());
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => (
            (key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
            || LEGACY_CACHE_PATTERN.test(key)
          ))
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request, { cache: "no-store" })
        .catch(async () => {
          const cache = await caches.open(CACHE_NAME);
          return (await cache.match("./index.html")) ?? cache.match("./");
        }),
    );
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(event.request);
      const network = fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void cache.put(event.request, copy);
          }
          return response;
        })
        .catch(() => cached);
      return cached ?? network;
    }),
  );
});

self.addEventListener("push", (event) => {
  const payload = readArrivalPayload(event);
  if (!payload) return;

  event.waitUntil(Promise.all([
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag,
      data: { url: payload.url },
      icon: new URL("./icon-192.png", self.registration.scope).href,
      badge: new URL("./icon-192.png", self.registration.scope).href,
      renotify: false,
    }),
    setArrivalBadge(),
  ]));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = scopedCatchUrl(event.notification.data?.url);

  event.waitUntil((async () => {
    await clearArrivalBadge();
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find((client) => client.url.startsWith(self.registration.scope));
    if (existing) {
      if (typeof existing.navigate === "function") {
        await existing.navigate(targetUrl).catch(() => undefined);
      }
      return existing.focus();
    }
    return self.clients.openWindow(targetUrl);
  })());
});

self.addEventListener("pushsubscriptionchange", (event) => {
  // The Service Worker cannot safely access the authenticated Supabase session.
  // Tell an open client to refresh the subscription without ever prompting for
  // permission in the background.
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => clients.forEach((client) => client.postMessage({ type: "PUSH_SUBSCRIPTION_CHANGED" }))),
  );
});
