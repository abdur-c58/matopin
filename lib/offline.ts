"use client";
import { readSaved } from "./decks";

/**
 * Offline use. The service worker (public/sw.js) answers from these caches when the network is down; this module
 * fills them. App pages are kept as they're visited; a deck's pages and recordings only once it's downloaded.
 * Card data itself always lives in localStorage (lib/sync.ts), so a downloaded deck studies and syncs like any other.
 */
export const PAGES = "matopin-pages";
export const STATIC = "matopin-static";
export const MEDIA = "matopin-media";
/** Kept in public/sw.js too. */
export const CORE_PAGES = ["/app", "/decks", "/dictionary", "/stats", "/calendar", "/settings", "/offline"];

export const OFFLINE_CHANGED = "matopin:offline-changed";
const downloadsKey = (profile: string) => `matopin:${profile}:offline`;

export const isStandalone = () =>
  typeof window !== "undefined" && (window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true);

const canCache = () => typeof window !== "undefined" && "caches" in window;

export function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  // The dev server rebuilds files constantly, so only a production build gets the worker.
  if (process.env.NODE_ENV !== "production") {
    void navigator.serviceWorker.getRegistrations().then((all) => all.forEach((r) => void r.unregister()));
    return;
  }
  void navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
}

/** Scripts, styles and preloaded fonts a page needs, including chunks named only inside its inline data. */
const ASSET = /\/_next\/static\/[^"'\\\s)<>]+/g;

async function saveAssets(html: string) {
  const cache = await caches.open(STATIC);
  const urls = [...new Set(html.match(ASSET) ?? [])];
  await Promise.all(urls.map(async (url) => {
    if (await cache.match(url)) return;
    const res = await fetch(url);
    if (res.ok) await cache.put(url, res);
  }));
}

async function savePage(path: string) {
  const res = await fetch(path, { cache: "no-store", headers: { Accept: "text/html" } });
  if (!res.ok || !res.headers.get("content-type")?.includes("text/html")) throw new Error(`Couldn’t save ${path} (${res.status}).`);
  const html = await res.clone().text();
  await (await caches.open(PAGES)).put(path, res);
  await saveAssets(html);
}

const deckPages = (id: string) => [`/decks/${id}`, `/decks/${id}/review`, `/decks/${id}/settings`];

function deckClips(scope: string): string[] {
  const clips = new Set<string>();
  for (const card of readSaved(scope)?.cards ?? []) {
    for (const ref of [card.audio?.word, card.audio?.example]) if (ref?.clip) clips.add(`/api/card-audio/${ref.clip}`);
  }
  return [...clips];
}

async function saveClips(urls: string[], onSaved?: () => void) {
  const cache = await caches.open(MEDIA);
  for (const url of urls) {
    if (!(await cache.match(url))) {
      const res = await fetch(url);
      if (res.ok) await cache.put(url, res);
    }
    onSaved?.();
  }
}

export function downloadedDecks(profile: string): string[] {
  try {
    const ids = JSON.parse(localStorage.getItem(downloadsKey(profile)) ?? "[]") as unknown;
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function writeDownloads(profile: string, ids: string[]) {
  localStorage.setItem(downloadsKey(profile), JSON.stringify(ids));
  window.dispatchEvent(new Event(OFFLINE_CHANGED));
}

/** Saves the deck's pages and recordings for offline use. `onProgress` gets a fraction from 0 to 1. */
export async function downloadDeck(profile: string, id: string, onProgress?: (done: number) => void) {
  if (!canCache()) throw new Error("This browser can’t save pages for offline use.");
  const pages = deckPages(id);
  const clips = deckClips(`${profile}:${id}`);
  const total = pages.length + clips.length;
  let done = 0;
  const step = () => onProgress?.(++done / total);
  for (const page of pages) {
    await savePage(page);
    step();
  }
  await saveClips(clips, step);
  writeDownloads(profile, [...new Set([...downloadedDecks(profile), id])]);
}

export async function removeDeckDownload(profile: string, id: string) {
  writeDownloads(profile, downloadedDecks(profile).filter((d) => d !== id));
  if (!canCache()) return;
  const cache = await caches.open(PAGES);
  await Promise.all(deckPages(id).map((page) => cache.delete(page)));
}

/**
 * Re-saves the app's pages and downloaded decks once per visit, so a new release and cards added since the
 * download (with their recordings) are there offline too.
 */
export async function refreshOffline(profile: string) {
  if (!canCache() || process.env.NODE_ENV !== "production" || sessionStorage.getItem("matopin:offline-fresh")) return;
  sessionStorage.setItem("matopin:offline-fresh", "1");
  try {
    for (const page of CORE_PAGES) await savePage(page);
    for (const id of downloadedDecks(profile)) {
      for (const page of deckPages(id)) await savePage(page);
      await saveClips(deckClips(`${profile}:${id}`));
    }
  } catch {
    sessionStorage.removeItem("matopin:offline-fresh");
  }
}

/** Drops the account's saved decks from this device on logout. App pages and the dictionary stay. */
export async function forgetOffline(profile: string) {
  if (!canCache()) return;
  const cache = await caches.open(PAGES);
  for (const request of await cache.keys()) {
    if (new URL(request.url).pathname.startsWith("/decks/")) await cache.delete(request);
  }
  localStorage.removeItem(downloadsKey(profile));
}

/** Card voices heard before, so they still play offline. Keyed by a made-up URL since the voice service is a POST. */
const VOICE_LIMIT = 3000;

async function voiceUrl(key: string) {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(key));
  return `/offline-voice/${[...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export async function cachedVoice(key: string): Promise<Blob | null> {
  if (!canCache()) return null;
  const hit = await (await caches.open(MEDIA)).match(await voiceUrl(key));
  return hit ? hit.blob() : null;
}

export async function keepVoice(key: string, blob: Blob) {
  if (!canCache()) return;
  const cache = await caches.open(MEDIA);
  await cache.put(await voiceUrl(key), new Response(blob, { headers: { "Content-Type": blob.type || "audio/mpeg" } }));
  if (Math.random() > 0.02) return;
  const keys = (await cache.keys()).filter((r) => new URL(r.url).pathname.startsWith("/offline-voice/"));
  for (const old of keys.slice(0, Math.max(0, keys.length - VOICE_LIMIT))) await cache.delete(old);
}
