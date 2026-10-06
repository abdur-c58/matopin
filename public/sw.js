/*
 * Matopin's offline worker. lib/offline.ts fills the caches; this answers from them when the network is down.
 * - App pages: network first, falling back to the saved copy. Only the core pages and downloaded decks are saved, so
 *   the landing page, chats and social pages always need the network.
 * - Built files under /_next/static never change once deployed, so they come from the cache first.
 * - Card recordings never change either.
 * Everything else, including every other API call, goes straight to the network.
 */
const PAGES = "matopin-pages";
const STATIC = "matopin-static";
const MEDIA = "matopin-media";
const CORE_PAGES = ["/app", "/decks", "/dictionary", "/stats", "/calendar", "/settings", "/offline"];
const ICONS = ["/icon.svg", "/apple-icon", "/favicon.ico", "/manifest.webmanifest", "/pwa-icon/192", "/pwa-icon/512", "/pwa-icon/maskable"];
/** On a connection that is up but barely moving, a saved page is shown after this long instead of waiting. */
const SLOW_MS = 4000;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === "navigate") return event.respondWith(page(request, url.pathname));
  if (url.pathname.startsWith("/_next/static/")) return event.respondWith(cacheFirst(STATIC, request));
  if (/^\/api\/card-audio\/[^/]+$/.test(url.pathname)) return event.respondWith(cacheFirst(MEDIA, request));
  if (ICONS.includes(url.pathname)) return event.respondWith(staleWhileRevalidate(STATIC, request));
});

async function page(request, path) {
  const cache = await caches.open(PAGES);
  const saved = await cache.match(path);
  const network = fetch(request).then((res) => {
    if (res.ok && res.type === "basic" && (CORE_PAGES.includes(path) || saved)) void cache.put(path, res.clone());
    return res;
  });
  try {
    if (!saved) return await network;
    network.catch(() => {});
    const slow = new Promise((resolve) => setTimeout(() => resolve(null), SLOW_MS));
    return (await Promise.race([network, slow])) ?? saved;
  } catch {
    return saved
      ?? (path === "/" ? await cache.match("/app") : undefined)
      ?? (await cache.match("/offline"))
      ?? new Response("You’re offline.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
}

async function cacheFirst(name, request) {
  const cache = await caches.open(name);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) void cache.put(request, res.clone());
  return res;
}

async function staleWhileRevalidate(name, request) {
  const cache = await caches.open(name);
  const hit = await cache.match(request);
  const fresh = fetch(request).then((res) => {
    if (res.ok) void cache.put(request, res.clone());
    return res;
  });
  if (hit) {
    fresh.catch(() => {});
    return hit;
  }
  return fresh;
}
