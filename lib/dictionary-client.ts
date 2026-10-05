"use client";
import type { DictEntry, DictExamples, DictSearch } from "./dictionary";
import type { JDictEntry, JDictExamples, JDictSearch } from "./jdict";

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
    throw new DictError(navigator.onLine ? "Couldn’t reach the dictionary." : "You’re offline. Searches you’ve already made still work.", "offline");
  }
  const body = (await res.json().catch(() => null)) as ({ error?: string; code?: string } & T) | null;
  if (!res.ok) throw new DictError(body?.error || "The dictionary couldn’t answer that.", body?.code === "not_imported" ? "not_imported" : "failed");
  return body as T;
}

/**
 * The fetch is shared and cached; aborting only stops waiting, so a later identical lookup is still instant.
 * Empty answers aren't kept, in case they came from a moment when the data was being re-imported.
 */
function cached<T>(url: string, signal?: AbortSignal, empty: (body: T) => boolean = () => false): Promise<T> {
  let hit = cache.get(url) as Promise<T> | undefined;
  if (!hit) {
    hit = get<T>(url);
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

export const searchDictionary = (q: string, signal?: AbortSignal) =>
  cached<DictSearch>(`/api/dictionary/search?q=${encodeURIComponent(q)}`, signal, (r) => !r.groups.length);
export const loadEntry = (id: number, signal?: AbortSignal) =>
  cached<{ entry: DictEntry | null }>(`/api/dictionary/entry/${id}`, signal, (r) => !r.entry).then((r) => r.entry);
export const loadExamples = (word: string, offset: number, signal?: AbortSignal) =>
  cached<DictExamples>(`/api/dictionary/examples?word=${encodeURIComponent(word)}&offset=${offset}`, signal, (r) => !r.examples.length);

export const searchJdict = (q: string, signal?: AbortSignal) =>
  cached<JDictSearch>(`/api/jdict/search?q=${encodeURIComponent(q)}`, signal, (r) => !r.groups.length);
export const loadJdictEntry = (id: number, signal?: AbortSignal) =>
  cached<{ entry: JDictEntry | null }>(`/api/jdict/entry/${id}`, signal, (r) => !r.entry).then((r) => r.entry);
export const loadJdictExamples = (id: number, offset: number, signal?: AbortSignal) =>
  cached<JDictExamples>(`/api/jdict/examples?id=${id}&offset=${offset}`, signal, (r) => !r.examples.length);

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
