/**
 * The dictionary files a device keeps for offline lookups: the same gzipped files the server searches
 * (lib/dictionary-files.ts), saved in Cache Storage and searched in lib/dictionary-worker.ts. Safe in a worker.
 */
import type { Lang } from "./lang";

export const DICT_CACHE = "matopin-dict";

export const OFFLINE_DICT_FILES: Record<Lang, { words: string; sentences: string }> = {
  zh: { words: "zh-words.json.gz", sentences: "zh-sentences.json.gz" },
  ja: { words: "ja-words.json.gz", sentences: "ja-sentences.json.gz" },
};

/** Vercel caps a response at 4.5 MB, so the route hands each file out in parts below that. */
export const DICT_PART_BYTES = 4 * 1024 * 1024;

export const dictFileUrl = (name: string) => `/api/dictionary/file/${name}`;
