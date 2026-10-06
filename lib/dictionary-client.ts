"use client";
import { isOffline, reportOffline, reportOnline } from "./connection";
import type { DictEntry, DictExamples, DictSearch } from "./dictionary";
import { DICT_CACHE, dictFileUrl, OFFLINE_DICT_FILES } from "./dictionary-offline";
import type { DictReply, DictRequest } from "./dictionary-worker";
import type { JDictEntry, JDictExamples, JDictSearch } from "./jdict";
import type { Lang } from "./lang";

export class DictError extends Error {
  constructor(message: string, readonly code: "not_imported" | "offline" | "failed") {
    super(message);
  }
}

/** Answers for this tab. The data only changes on re-import, so nothing here goes stale in practice. */
const cache = new Map<string, Promise<unknown>>();
const MAX_CACHED = 300;

async function get<T>(url: string, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { signal });
  } catch (e) {
    if (signal?.aborted) throw e;
    reportOffline();
    throw new DictError("You’re offline. Searches you’ve already made still work, and downloading the dictionary in Settings makes every search work offline.", "offline");
  }
  reportOnline();
  const body = (await res.json().catch(() => null)) as ({ error?: string; code?: string } & T) | null;
  if (!res.ok) throw new DictError(body?.error || "The dictionary couldn’t answer that.", body?.code === "not_imported" ? "not_imported" : "failed");
  return body as T;
}

/** Downloaded dictionaries, by language: when and how many bytes. Kept per device, not per account. */
const SAVED_KEY = "matopin:offline-dict";
export const DICT_SAVED_CHANGED = "matopin:offline-dict-changed";
export type SavedDictionaries = Partial<Record<Lang, { at: number; bytes: number }>>;

export function savedDictionaries(): SavedDictionaries {
  try {
    return (JSON.parse(localStorage.getItem(SAVED_KEY) ?? "{}") as SavedDictionaries | null) ?? {};
  } catch {
    return {};
  }
}

function writeSaved(saved: SavedDictionaries) {
  localStorage.setItem(SAVED_KEY, JSON.stringify(saved));
  window.dispatchEvent(new Event(DICT_SAVED_CHANGED));
}

let worker: Worker | null = null;
let nextRequest = 0;
const waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

function offlineWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./dictionary-worker.ts", import.meta.url), { type: "module" });
  worker.addEventListener("message", (e: MessageEvent<DictReply>) => {
    const pending = waiting.get(e.data.id);
    waiting.delete(e.data.id);
    if (e.data.error) pending?.reject(new DictError(e.data.error, "failed"));
    else pending?.resolve(e.data.result);
  });
  worker.addEventListener("error", () => {
    for (const pending of waiting.values()) pending.reject(new DictError("The offline dictionary couldn’t be opened. Download it again in Settings.", "failed"));
    waiting.clear();
    worker = null;
  });
  return worker;
}

function askOffline<T>(lang: Lang, op: DictRequest["op"], args: unknown[]): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = ++nextRequest;
    waiting.set(id, { resolve: resolve as (v: unknown) => void, reject });
    offlineWorker().postMessage({ id, lang, op, args } satisfies DictRequest);
  });
}

/** From the server, or from the downloaded copy when the server can't be reached. */
async function answer<T>(url: string, lang: Lang, op: DictRequest["op"], args: unknown[]): Promise<T> {
  const saved = Boolean(savedDictionaries()[lang]);
  if (saved && isOffline()) return askOffline<T>(lang, op, args);
  try {
    return await get<T>(url);
  } catch (e) {
    if (saved && e instanceof DictError && e.code === "offline") return askOffline<T>(lang, op, args);
    throw e;
  }
}

/** Saves a language's dictionary on this device. `onProgress` gets a fraction from 0 to 1. */
export async function downloadDictionary(lang: Lang, onProgress?: (done: number) => void) {
  if (!("caches" in window)) throw new Error("This browser can’t save the dictionary for offline use.");
  void navigator.storage?.persist?.().catch(() => false);
  const names = [OFFLINE_DICT_FILES[lang].words, OFFLINE_DICT_FILES[lang].sentences];
  const store = await caches.open(DICT_CACHE);
  let bytes = 0;
  for (const [i, name] of names.entries()) {
    const parts: ArrayBuffer[] = [];
    let total = Infinity;
    for (let part = 0, got = 0; got < total; part++) {
      const res = await fetch(`${dictFileUrl(name)}?part=${part}`, { cache: "no-store" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || "Couldn’t download the dictionary. Try again in a moment.");
      }
      total = Number(res.headers.get("x-total-size")) || 0;
      const chunk = await res.arrayBuffer();
      if (!chunk.byteLength) break;
      parts.push(chunk);
      got += chunk.byteLength;
      onProgress?.((i + Math.min(1, got / (total || got))) / names.length);
    }
    const file = new Blob(parts, { type: "application/gzip" });
    bytes += file.size;
    await store.put(dictFileUrl(name), new Response(file, { headers: { "Content-Type": "application/gzip" } }));
  }
  writeSaved({ ...savedDictionaries(), [lang]: { at: Date.now(), bytes } });
  // Opens the copy once, which checks it and saves the worker's own code for offline use, then frees the memory.
  try {
    await askOffline(lang, "search", [lang === "zh" ? "你好" : "食べる"]);
  } finally {
    worker?.terminate();
    worker = null;
  }
}

export async function removeDictionary(lang: Lang) {
  const saved = savedDictionaries();
  delete saved[lang];
  writeSaved(saved);
  worker?.terminate();
  worker = null;
  if (!("caches" in window)) return;
  const store = await caches.open(DICT_CACHE);
  await Promise.all([OFFLINE_DICT_FILES[lang].words, OFFLINE_DICT_FILES[lang].sentences].map((name) => store.delete(dictFileUrl(name))));
}

/**
 * The fetch is shared and cached; aborting only stops waiting, so a later identical lookup is still instant.
 * Empty answers aren't kept, in case they came from a moment when the data was being re-imported.
 */
function cached<T>(url: string, signal?: AbortSignal, empty: (body: T) => boolean = () => false, offline?: () => Promise<T>): Promise<T> {
  let hit = cache.get(url) as Promise<T> | undefined;
  if (!hit) {
    hit = offline ? offline() : get<T>(url);
    cache.set(url, hit);
    hit.then((body) => { if (empty(body)) cache.delete(url); }, () => cache.delete(url));
    if (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value!);
  }
  if (!signal) return hit;
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new DOMException("Aborted", "AbortError"));
    if (signal.aborted) return abort();
    signal.addEventListener("abort", abort, { once: true });
    hit.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

/** A lookup that falls back to the downloaded dictionary. */
function lookup<T>(url: string, lang: Lang, op: DictRequest["op"], args: unknown[], signal: AbortSignal | undefined, empty: (body: T) => boolean) {
  return cached<T>(url, signal, empty, () => answer<T>(url, lang, op, args));
}

export const searchDictionary = (q: string, signal?: AbortSignal) =>
  lookup<DictSearch>(`/api/dictionary/search?q=${encodeURIComponent(q)}`, "zh", "search", [q], signal, (r) => !r.groups.length);
export const loadEntry = (id: number, signal?: AbortSignal) =>
  lookup<{ entry: DictEntry | null }>(`/api/dictionary/entry/${id}`, "zh", "entry", [id], signal, (r) => !r.entry).then((r) => r.entry);
export const loadExamples = (word: string, offset: number, signal?: AbortSignal) =>
  lookup<DictExamples>(`/api/dictionary/examples?word=${encodeURIComponent(word)}&offset=${offset}`, "zh", "examples", [word, offset], signal, (r) => !r.examples.length);

export const searchJdict = (q: string, signal?: AbortSignal) =>
  lookup<JDictSearch>(`/api/jdict/search?q=${encodeURIComponent(q)}`, "ja", "search", [q], signal, (r) => !r.groups.length);
export const loadJdictEntry = (id: number, signal?: AbortSignal) =>
  lookup<{ entry: JDictEntry | null }>(`/api/jdict/entry/${id}`, "ja", "entry", [id], signal, (r) => !r.entry).then((r) => r.entry);
export const loadJdictExamples = (id: number, offset: number, signal?: AbortSignal) =>
  lookup<JDictExamples>(`/api/jdict/examples?id=${id}&offset=${offset}`, "ja", "examples", [id, offset], signal, (r) => !r.examples.length);

export type Pronunciation = { clips: { url: string; credit: string }[] };

/**
 * Japanese words and sentences: `reading` is the kana, which Fish Audio is given for kanji-only text. The server
 * leaves Fish Audio out when the account has AI voices off; `ai` keeps the two answers apart in caches.
 */
export function loadPronunciationJa(text: string, reading: string, sentence: number | undefined, ai: boolean) {
  const params = new URLSearchParams({ lang: "ja", text, reading });
  if (sentence) params.set("sentence", String(sentence));
  if (!ai) params.set("ai", "0");
  return cached<Pronunciation>(`/api/dictionary/audio?${params}`, undefined, (r) => !r.clips.length);
}

/**
 * The recordings for a word, character or Tatoeba sentence (with its words); the server fetches and stores any it
 * doesn't have yet.
 */
export function loadPronunciation(text: string, pinyin: string, sentence: { id: number; words: string[] } | undefined, ai: boolean) {
  const params = new URLSearchParams({ text, pinyin });
  if (sentence) {
    params.set("sentence", String(sentence.id));
    for (const w of sentence.words) params.append("w", w);
    params.set("v", "fish");
  }
  if (!ai) params.set("ai", "0");
  return cached<Pronunciation>(`/api/dictionary/audio?${params}`, undefined, (r) => !r.clips.length);
}

export const isAbort = (e: unknown) => e instanceof DOMException && e.name === "AbortError";
