/**
 * The dictionaries as gzipped JSON files in R2 (the dict/ folder), written by the import scripts and read by
 * lib/dictionary-memory.ts. Each language has a words file, loaded on its first lookup, and a sentences file, loaded
 * on its first example request. Fields that can be worked out from others are left out and rebuilt on load.
 */
import { promisify } from "node:util";
import { gunzip, gzip } from "node:zlib";
import type { JForm, JSense } from "./jdict";
import { readObject, uploadObject } from "./storage";

export const DICT_FOLDER = "dict";

export const DICT_FILES = {
  zh: { words: "zh-words.json.gz", sentences: "zh-sentences.json.gz" },
  ja: { words: "ja-words.json.gz", sentences: "ja-sentences.json.gz" },
} as const;

export type ZhWord = {
  id: number; simplified: string; traditional: string; pinyin: string; pinyin_numeric: string; py_key: string;
  definitions: string[]; classifiers: { simplified: string; traditional: string; pinyin: string }[];
  freq: number; proper: boolean; variant: boolean;
};
export type ZhChar = {
  ch: string; pinyin: string[]; definition: string | null; radical: string | null; radical_number: number | null;
  extra_strokes: number | null; strokes: number | null; simplified: string[]; traditional: string[];
};
export type ZhSentence = {
  id: number; simplified: string; traditional: string | null; pinyin: string | null; english: string; english_id: number; tokens: string[];
};
export type ZhWords = { entries: ZhWord[]; chars: ZhChar[]; meta: Record<string, string> };

/** Empty lists are left out of the file; these are JMdict's forms and senses with those keys optional. */
export type JaForm = Pick<JForm, "text" | "common"> & { tags?: string[] };
export type JaReading = JaForm & { kanji?: string[] };
export type JaSense = Pick<JSense, "pos" | "glosses"> & Partial<Omit<JSense, "pos" | "glosses">>;
export type JaWord = {
  id: number; headword: string; reading: string; common: boolean; freq: number; pos_codes: string[];
  kanji: JaForm[]; kana: JaReading[]; senses: JaSense[];
  /** The summary's other writings and readings (JDictSummary.forms and .readings). */
  forms?: string[]; readings?: string[];
};
export type JaKanji = {
  ch: string; meanings: string[]; onyomi: string[]; kunyomi: string[]; nanori: string[];
  strokes: number | null; grade: number | null; jlpt: number | null; freq: number | null; radical: number | null;
};
export type JaSentence = { id: number; japanese: string; furigana: string | null; english: string };
export type JaWords = {
  entries: JaWord[];
  /** Every way of writing each entry, katakana turned into hiragana, sorted; formIds[i] is forms[i]'s entry. */
  forms: string[]; formIds: number[];
  kanji: JaKanji[];
  /** Sentence ids JMdict itself gives as examples, by entry id. */
  examples: Record<string, number[]>;
  meta: Record<string, string>;
};

/** The parsed file, or null when it hasn't been uploaded. */
export async function readDictFile<T>(name: string): Promise<T | null> {
  const bytes = await readObject(DICT_FOLDER, name);
  if (!bytes) return null;
  return JSON.parse((await promisify(gunzip)(Buffer.from(bytes))).toString("utf8")) as T;
}

/** Uploads the file and returns its gzipped size in bytes. */
export async function writeDictFile(name: string, data: unknown): Promise<number> {
  const zipped = await promisify(gzip)(JSON.stringify(data), { level: 9 });
  await uploadObject(DICT_FOLDER, name, zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer, "application/gzip");
  return zipped.byteLength;
}
