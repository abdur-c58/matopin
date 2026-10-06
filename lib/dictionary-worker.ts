/**
 * Offline dictionary lookups, off the main thread. Runs the same search code as the server over the copy of the
 * dictionary files saved on this device; a language's words load on its first lookup, its sentences on its first
 * example request.
 */
import type { JaSentence, JaWords, ZhSentence, ZhWords } from "./dictionary-files";
import { createJaCall, createZhCall, type DictSource } from "./dictionary-memory";
import { DICT_CACHE, dictFileUrl, OFFLINE_DICT_FILES } from "./dictionary-offline";
import { createDictionary } from "./dictionary-server";
import { createJDictionary } from "./jdict-server";
import type { Lang } from "./lang";

async function readFile<T>(name: string): Promise<T | null> {
  const saved = await (await caches.open(DICT_CACHE)).match(dictFileUrl(name));
  if (!saved?.body) return null;
  return (await new Response(saved.body.pipeThrough(new DecompressionStream("gzip"))).json()) as T;
}

const source = <W, S>(lang: Lang): DictSource<W, S> => ({
  words: () => readFile<W>(OFFLINE_DICT_FILES[lang].words),
  sentences: () => readFile<S>(OFFLINE_DICT_FILES[lang].sentences),
});

const services = {
  zh: createDictionary(createZhCall(source<ZhWords, ZhSentence[]>("zh"))),
  ja: createJDictionary(createJaCall(source<JaWords, JaSentence[]>("ja"))),
};

export type DictRequest = { id: number; lang: Lang; op: "search" | "entry" | "examples"; args: unknown[] };
export type DictReply = { id: number; result?: unknown; error?: string };

self.addEventListener("message", async (event: MessageEvent<DictRequest>) => {
  const { id, lang, op, args } = event.data;
  try {
    const service = services[lang] as unknown as Record<DictRequest["op"], (...a: unknown[]) => Promise<unknown>>;
    postMessage({ id, result: await service[op](...args) } satisfies DictReply);
  } catch (e) {
    postMessage({ id, error: e instanceof Error ? e.message : "The offline dictionary couldn’t answer that." } satisfies DictReply);
  }
});
