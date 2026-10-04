/**
 * Turns the downloaded open datasets into the Japanese dictionary files the app reads from R2 (lib/dictionary-files.ts).
 * Used by scripts/import-jdict.mts.
 *
 * - jmdict-simplified (github.com/scriptin/jmdict-simplified): JMdict with its examples, and KANJIDIC2, as JSON.
 * - Tatoeba: Japanese sentences, their furigana, and English translations.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import JSZip from "jszip";
import Bunzip from "seek-bzip";
import { glossKeys } from "../lib/dictionary";
import type { JaSentence, JaWords } from "../lib/dictionary-files";
import { type JDictSummary, type JForm, type JReading, type JSense, kanaKey } from "../lib/jdict";
import { CACHE_DIR, CRUDE_ENGLISH } from "./dictionary-build";

const TATOEBA: Record<string, string> = {
  "jpn_sentences.tsv.bz2": "https://downloads.tatoeba.org/exports/per_language/jpn/jpn_sentences.tsv.bz2",
  "jpn_transcriptions.tsv.bz2": "https://downloads.tatoeba.org/exports/per_language/jpn/jpn_transcriptions.tsv.bz2",
  "jpn-eng_links.tsv.bz2": "https://downloads.tatoeba.org/exports/per_language/jpn/jpn-eng_links.tsv.bz2",
  "eng_sentences.tsv.bz2": "https://downloads.tatoeba.org/exports/per_language/eng/eng_sentences.tsv.bz2",
};
/** jmdict-simplified release assets, matched by name in its latest release. */
const RELEASE_FILES: Record<string, RegExp> = {
  "jmdict-examples-eng.json.zip": /^jmdict-examples-eng-[\d.]+\+\d+\.json\.zip$/,
  "kanjidic2-en.json.zip": /^kanjidic2-en-[\d.]+\+\d+\.json\.zip$/,
};

export type JEntryRow = {
  id: number; headword: string; reading: string; common: boolean; freq: number; pos_codes: string[];
  kanji: JForm[]; kana: JReading[]; senses: JSense[]; summary: JDictSummary; def_keys: string[]; english: string;
};
export type JFormRow = { form: string; entry_id: number; kana: boolean };
export type JKanjiRow = {
  ch: string; meanings: string[]; onyomi: string[]; kunyomi: string[]; nanori: string[];
  strokes: number | null; grade: number | null; jlpt: number | null; freq: number | null; radical: number | null;
};
export type JSentenceRow = { id: number; japanese: string; furigana: string | null; english: string; english_id: number | null };
export type JExampleRow = { entry_id: number; sentence_id: number };
export type JBuilt = {
  entries: JEntryRow[]; forms: JFormRow[]; kanji: JKanjiRow[]; sentences: JSentenceRow[]; examples: JExampleRow[];
  meta: Record<string, string>;
};

async function save(url: string, path: string) {
  console.log(`Downloading ${url}`);
  const res = await fetch(url, { signal: AbortSignal.timeout(600_000) });
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  writeFileSync(path, Buffer.from(await res.arrayBuffer()));
}

/** Downloads any dataset that isn't cached yet. Pass refresh to fetch everything again. */
export async function download(refresh = false) {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  for (const [name, url] of Object.entries(TATOEBA)) {
    const path = join(CACHE_DIR, name);
    if (refresh || !existsSync(path)) await save(url, path);
  }
  const missing = Object.keys(RELEASE_FILES).filter((name) => refresh || !existsSync(join(CACHE_DIR, name)));
  if (!missing.length) return;
  const res = await fetch("https://api.github.com/repos/scriptin/jmdict-simplified/releases/latest", { headers: { Accept: "application/vnd.github+json" } });
  if (!res.ok) throw new Error(`GitHub answered ${res.status} for the jmdict-simplified release`);
  const release = (await res.json()) as { assets: { name: string; browser_download_url: string }[] };
  for (const name of missing) {
    const asset = release.assets.find((a) => RELEASE_FILES[name].test(a.name));
    if (!asset) throw new Error(`The latest jmdict-simplified release has no ${name}`);
    await save(asset.browser_download_url, join(CACHE_DIR, name));
  }
}

const read = (name: string) => readFileSync(join(CACHE_DIR, name));
const bz2Lines = (name: string) => Bunzip.decode(read(name)).toString("utf8").split("\n");

async function zipJson<T>(name: string): Promise<T> {
  const zip = await JSZip.loadAsync(read(name));
  const file = Object.values(zip.files).find((f) => f.name.endsWith(".json"));
  if (!file) throw new Error(`${name} has no JSON file in it`);
  return JSON.parse(await file.async("string")) as T;
}

// JMdict --------------------------------------------------------------------------------------------------------------

type RawWord = {
  id: string;
  kanji: { common: boolean; text: string; tags: string[] }[];
  kana: { common: boolean; text: string; tags: string[]; appliesToKanji: string[] }[];
  sense: {
    partOfSpeech: string[]; appliesToKanji: string[]; appliesToKana: string[]; field: string[]; dialect: string[];
    misc: string[]; info: string[]; gloss: { text: string }[];
    examples?: { source: { type: string; value: string }; text: string; sentences: { lang: string; text: string }[] }[];
  }[];
};
type RawJmdict = { dictDate: string; version: string; tags: Record<string, string>; words: RawWord[] };

/** Kanji forms that are only there so searches find them: rare, irregular, outdated or search-only spellings. */
const HIDDEN_KANJI = new Set(["sK", "iK", "oK", "rK"]);
const HIDDEN_KANA = new Set(["sk", "ik", "ok"]);
const all = (list: string[]) => (list.length === 1 && list[0] === "*" ? [] : list);

function entryOf(w: RawWord, tags: Record<string, string>) {
  const kanji: JForm[] = w.kanji.map((k) => ({ text: k.text, common: k.common, tags: k.tags }));
  const kana: JReading[] = w.kana.map((k) => ({ text: k.text, common: k.common, tags: k.tags, kanji: all(k.appliesToKanji) }));
  const senses: JSense[] = w.sense.map((s) => ({
    pos: s.partOfSpeech.map((p) => tags[p] ?? p),
    glosses: s.gloss.map((g) => g.text),
    info: s.info, misc: s.misc.map((m) => tags[m] ?? m), field: s.field.map((f) => tags[f] ?? f), dialect: s.dialect.map((d) => tags[d] ?? d),
    kanji: all(s.appliesToKanji), kana: all(s.appliesToKana),
  }));
  const posCodes = [...new Set(w.sense.flatMap((s) => s.partOfSpeech))];
  const shown = w.kanji.filter((k) => !k.tags.some((t) => HIDDEN_KANJI.has(t)));
  const usuallyKana = w.sense.length > 0 && w.sense[0].misc.includes("uk");
  const pickKanji = shown.find((k) => k.common) ?? shown[0];
  const fits = (k: RawWord["kana"][number], form?: string) => !form || k.appliesToKanji.includes("*") || k.appliesToKanji.includes(form);
  const readings = w.kana.filter((k) => !k.tags.some((t) => HIDDEN_KANA.has(t)));
  const pickKana = (form?: string) => readings.find((k) => fits(k, form) && k.common) ?? readings.find((k) => fits(k, form)) ?? w.kana[0];
  const headword = !pickKanji || usuallyKana ? pickKana()?.text ?? pickKanji!.text : pickKanji.text;
  const reading = (pickKanji && !usuallyKana ? pickKana(pickKanji.text) : pickKana())?.text ?? headword;
  const summary: JDictSummary = {
    id: Number(w.id), headword, reading,
    forms: [...new Set([...shown.map((k) => k.text), ...(usuallyKana && pickKanji ? [pickKanji.text] : [])])].filter((t) => t !== headword),
    readings: [...new Set(readings.map((k) => k.text))].filter((t) => t !== headword),
    common: w.kanji.some((k) => k.common) || w.kana.some((k) => k.common),
    posCodes,
    senses: senses.slice(0, 4).map((s) => ({ pos: s.pos, glosses: s.glosses })),
  };
  const glosses = senses.flatMap((s) => s.glosses);
  return {
    id: summary.id, headword, reading, common: summary.common, freq: 0, pos_codes: posCodes, kanji, kana, senses, summary,
    def_keys: [...new Set(glosses.flatMap(glossKeys))], english: glosses.join("; "),
    usuallyKana,
  };
}

// KANJIDIC2 -----------------------------------------------------------------------------------------------------------

type RawKanji = {
  literal: string;
  radicals: { type: string; value: number }[];
  misc: { grade: number | null; strokeCounts: number[]; frequency: number | null; jlptLevel: number | null };
  readingMeaning: { groups: { readings: { type: string; value: string }[]; meanings: { lang: string; value: string }[] }[]; nanori: string[] } | null;
};

function kanjiOf(k: RawKanji): JKanjiRow {
  const groups = k.readingMeaning?.groups ?? [];
  const readings = (type: string) => groups.flatMap((g) => g.readings.filter((r) => r.type === type).map((r) => r.value));
  return {
    ch: k.literal,
    meanings: groups.flatMap((g) => g.meanings.filter((m) => m.lang === "en").map((m) => m.value)),
    onyomi: readings("ja_on"), kunyomi: readings("ja_kun"), nanori: k.readingMeaning?.nanori ?? [],
    strokes: k.misc.strokeCounts[0] ?? null, grade: k.misc.grade, jlpt: k.misc.jlptLevel, freq: k.misc.frequency,
    radical: k.radicals.find((r) => r.type === "classical")?.value ?? null,
  };
}

// Tatoeba -------------------------------------------------------------------------------------------------------------

const MAX_SENTENCE = 50;
const CRUDE_JAPANESE = [
  "くそ", "クソ", "糞", "畜生", "ちくしょう", "チクショウ", "死ね", "ぶっ殺", "ぶち殺", "馬鹿野郎", "ばかやろう", "バカヤロー", "てめえ", "テメエ", "てめぇ",
  "ファック", "まんこ", "マンコ", "ちんこ", "チンコ", "ちんぽ", "売女", "淫売", "きちがい", "キチガイ", "気違い", "ガイジ", "カス野郎", "クズ野郎",
];
const isCrude = (japanese: string, english: string) => CRUDE_ENGLISH.test(english) || CRUDE_JAPANESE.some((w) => japanese.includes(w));

function parseTatoeba() {
  const japanese = new Map<number, string>();
  for (const line of bz2Lines("jpn_sentences.tsv.bz2")) {
    const [id, lang, text] = line.split("\t");
    if (lang === "jpn" && text) japanese.set(Number(id), text.trim());
  }
  const furigana = new Map<number, string>();
  for (const line of bz2Lines("jpn_transcriptions.tsv.bz2")) {
    const [id, , script, , text] = line.split("\t");
    if (script === "Hrkt" && text) furigana.set(Number(id), text.trim());
  }
  const links = new Map<number, number>();
  for (const line of bz2Lines("jpn-eng_links.tsv.bz2")) {
    const [a, b] = line.split("\t").map(Number);
    if (a && b && japanese.has(a) && !links.has(a)) links.set(a, b);
  }
  const wanted = new Set(links.values());
  const english = new Map<number, string>();
  for (const line of Bunzip.decode(read("eng_sentences.tsv.bz2")).toString("utf8").split("\n")) {
    const tab = line.indexOf("\t");
    if (tab < 0) continue;
    const id = Number(line.slice(0, tab));
    if (!wanted.has(id)) continue;
    const text = line.slice(line.indexOf("\t", tab + 1) + 1).trim();
    if (text) english.set(id, text);
  }
  return { japanese, furigana, links, english };
}

/** Counts how often each form appears in the sentences: every substring up to 10 characters that is a known form. */
function countForms(texts: Iterable<string>, forms: Set<string>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const text of texts) {
    const chars = [...kanaKey(text)];
    for (let i = 0; i < chars.length; i++) {
      let piece = "";
      for (let len = 1; len <= 10 && i + len <= chars.length; len++) {
        piece += chars[i + len - 1];
        if (forms.has(piece)) counts.set(piece, (counts.get(piece) ?? 0) + 1);
      }
    }
  }
  return counts;
}

// Everything ----------------------------------------------------------------------------------------------------------

const HAS_KANJI = /[\u3400-\u9fff\uf900-\ufaff々]/;

export async function build(log: (msg: string) => void = console.log): Promise<JBuilt> {
  log("Reading JMdict…");
  const jmdict = await zipJson<RawJmdict>("jmdict-examples-eng.json.zip");
  const built = jmdict.words.map((w) => entryOf(w, jmdict.tags));
  log(`  ${built.length} entries`);

  const forms: JFormRow[] = [];
  for (const e of built) {
    const seen = new Set<string>();
    for (const k of e.kanji) {
      const form = kanaKey(k.text);
      if (!seen.has(form)) { seen.add(form); forms.push({ form, entry_id: e.id, kana: false }); }
    }
    for (const k of e.kana) {
      const form = kanaKey(k.text);
      if (!seen.has(form)) { seen.add(form); forms.push({ form, entry_id: e.id, kana: true }); }
    }
  }

  log("Reading KANJIDIC2…");
  const kanjidic = await zipJson<{ characters: RawKanji[] }>("kanjidic2-en.json.zip");
  const kanji = kanjidic.characters.map(kanjiOf);
  log(`  ${kanji.length} kanji`);

  log("Reading Tatoeba…");
  const tatoeba = parseTatoeba();
  const sentences = new Map<number, JSentenceRow>();
  let crude = 0;
  for (const [id, text] of tatoeba.japanese) {
    const engId = tatoeba.links.get(id);
    const eng = engId ? tatoeba.english.get(engId) : undefined;
    if (!eng || [...text].length > MAX_SENTENCE) continue;
    if (isCrude(text, eng)) { crude++; continue; }
    sentences.set(id, { id, japanese: text, furigana: tatoeba.furigana.get(id) ?? null, english: eng, english_id: engId! });
  }

  // JMdict's own examples point at Tatoeba sentences; ones Tatoeba no longer pairs with English come from JMdict.
  const examples: JExampleRow[] = [];
  const linked = new Set<string>();
  const ids = new Set(built.map((e) => e.id));
  for (const w of jmdict.words) {
    const entryId = Number(w.id);
    if (!ids.has(entryId)) continue;
    for (const s of w.sense) for (const ex of s.examples ?? []) {
      if (ex.source.type !== "tatoeba") continue;
      const sid = Number(ex.source.value);
      if (!sentences.has(sid)) {
        const jp = ex.sentences.find((x) => x.lang === "jpn")?.text?.trim();
        const en = ex.sentences.find((x) => x.lang === "eng")?.text?.trim();
        if (!jp || !en || isCrude(jp, en)) continue;
        sentences.set(sid, { id: sid, japanese: jp, furigana: tatoeba.furigana.get(sid) ?? null, english: en, english_id: null });
      }
      if (linked.has(`${entryId}:${sid}`)) continue;
      linked.add(`${entryId}:${sid}`);
      examples.push({ entry_id: entryId, sentence_id: sid });
    }
  }
  log(`  ${sentences.size} sentences with an English translation (${crude} crude ones left out), ${examples.length} linked to words`);

  log("Counting words in the sentences…");
  // Single kana and two-kana forms show up inside everything, so only kanji forms and longer kana forms are counted.
  const countable = new Set(forms.filter((f) => !f.kana || [...f.form].length >= 3 || HAS_KANJI.test(f.form)).map((f) => f.form));
  const counts = countForms(tatoeba.japanese.values(), countable);
  const entries: JEntryRow[] = built.map(({ usuallyKana, ...e }) => {
    const kanjiCount = Math.max(0, ...e.kanji.map((k) => counts.get(kanaKey(k.text)) ?? 0));
    const kanaCount = Math.max(0, ...e.kana.map((k) => counts.get(kanaKey(k.text)) ?? 0));
    return { ...e, freq: e.kanji.length && !usuallyKana ? kanjiCount : Math.max(kanjiCount, kanaCount) };
  });

  return {
    entries, forms, kanji, sentences: [...sentences.values()], examples,
    meta: {
      jmdict_date: jmdict.dictDate, jmdict_version: jmdict.version, entries: String(entries.length),
      sentences: String(sentences.size), kanji: String(kanji.length), imported_at: new Date().toISOString(),
    },
  };
}

/** Leaves out the keys whose value is an empty list. */
const dropEmpty = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => !(Array.isArray(v) && !v.length))) as T;

/** The built rows as the two files in R2. The summary, def_keys and english are rebuilt from the entry on load. */
export function pack(data: JBuilt): { words: JaWords; sentences: JaSentence[] } {
  const forms = [...data.forms].sort((a, b) => (a.form < b.form ? -1 : a.form > b.form ? 1 : a.entry_id - b.entry_id));
  const examples: Record<string, number[]> = {};
  for (const x of data.examples) (examples[x.entry_id] ??= []).push(x.sentence_id);
  return {
    words: {
      entries: data.entries.map((e) => ({
        id: e.id, headword: e.headword, reading: e.reading, common: e.common, freq: e.freq, pos_codes: e.pos_codes,
        kanji: e.kanji.map(dropEmpty), kana: e.kana.map(dropEmpty), senses: e.senses.map(dropEmpty),
        ...dropEmpty({ forms: e.summary.forms, readings: e.summary.readings }),
      })),
      forms: forms.map((f) => f.form),
      formIds: forms.map((f) => f.entry_id),
      kanji: data.kanji,
      examples,
      meta: data.meta,
    },
    sentences: data.sentences.map(({ id, japanese, furigana, english }) => ({ id, japanese, furigana, english })),
  };
}
