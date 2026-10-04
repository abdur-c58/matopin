/**
 * Turns the downloaded open datasets into rows for the matopin_dict_* tables (supabase/003_dictionary.sql).
 * Used by scripts/import-dictionary.mts and scripts/test-dictionary.mts.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import JSZip from "jszip";
import Bunzip from "seek-bzip";
import { displayPinyin, glossKeys, isHan, pinyinKey } from "../lib/dictionary";

export const CACHE_DIR = ".dict-cache";

export const DOWNLOADS: Record<string, string> = {
  "cedict.txt.gz": "https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz",
  "Unihan.zip": "https://www.unicode.org/Public/UCD/latest/ucd/Unihan.zip",
  "CJKRadicals.txt": "https://www.unicode.org/Public/UCD/latest/ucd/CJKRadicals.txt",
  "cmn_sentences.tsv.bz2": "https://downloads.tatoeba.org/exports/per_language/cmn/cmn_sentences.tsv.bz2",
  "cmn_transcriptions.tsv.bz2": "https://downloads.tatoeba.org/exports/per_language/cmn/cmn_transcriptions.tsv.bz2",
  "cmn-eng_links.tsv.bz2": "https://downloads.tatoeba.org/exports/per_language/cmn/cmn-eng_links.tsv.bz2",
  "eng_sentences.tsv.bz2": "https://downloads.tatoeba.org/exports/per_language/eng/eng_sentences.tsv.bz2",
};

export type EntryRow = {
  id: number; simplified: string; traditional: string; pinyin: string; pinyin_numeric: string; py_key: string;
  definitions: string[]; classifiers: { simplified: string; traditional: string; pinyin: string }[];
  def_keys: string[]; english: string; freq: number; proper: boolean; variant: boolean;
};
export type CharRow = {
  ch: string; pinyin: string[]; definition: string | null; radical: string | null; radical_number: number | null;
  extra_strokes: number | null; strokes: number | null; simplified: string[]; traditional: string[];
};
export type SentenceRow = {
  id: number; simplified: string; traditional: string | null; pinyin: string | null; english: string; english_id: number; tokens: string[];
};
export type Built = { entries: EntryRow[]; chars: CharRow[]; sentences: SentenceRow[]; meta: Record<string, string> };

/** Downloads any dataset that isn't cached yet. Pass refresh to fetch everything again. */
export async function download(refresh = false) {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  for (const [name, url] of Object.entries(DOWNLOADS)) {
    const path = join(CACHE_DIR, name);
    if (!refresh && existsSync(path)) continue;
    console.log(`Downloading ${url}`);
    const res = await fetch(url, { signal: AbortSignal.timeout(300_000) });
    if (!res.ok) throw new Error(`${url} returned ${res.status}`);
    writeFileSync(path, Buffer.from(await res.arrayBuffer()));
  }
}

const read = (name: string) => readFileSync(join(CACHE_DIR, name));
const bz2Lines = (name: string) => Bunzip.decode(read(name)).toString("utf8").split("\n");

// CC-CEDICT -------------------------------------------------------------------------------------------------------

const LINE = /^(\S+) (\S+) \[([^\]]*)\] \/(.*)\/\s*$/;
const REF_PAIR = /([^\s[\]|,;/()]+)\|([^\s[\]|,;/()]+)\[([^\]]+)\]/g;
const REF_ONE = /([^\s[\]|,;/()a-zA-Z0-9]+)\[([^\]]+)\]/g;
const BRACKET = /\[([a-zA-Z:]+[1-5](?: [a-zA-Z:]+[1-5])*)\]/g;
const POINTER = /^(?:(?:old|ancient|archaic|Japanese|erhua) )?variant of |^see |^used in |^also written |^see also /i;

function parseClassifiers(text: string) {
  return text.replace(/^CL:/, "").split(",").flatMap((item) => {
    const m = item.trim().match(/^(?:([^|[]+)\|)?([^|[]+)\[([^\]]+)\]$/);
    return m ? [{ traditional: m[1] ?? m[2], simplified: m[2], pinyin: displayPinyin(m[3]) }] : [];
  });
}

/** Rewrites CC-CEDICT's cross-references ("書經|书经[Shu1 jing1]") as "书经 (Shūjīng)" and marks bare pinyin. */
function cleanDefinition(def: string): string {
  return def
    .replace(REF_PAIR, (_, _trad: string, simp: string, py: string) => `${simp} (${displayPinyin(py)})`)
    .replace(REF_ONE, (_, han: string, py: string) => `${han} (${displayPinyin(py)})`)
    .replace(BRACKET, (_, py: string) => displayPinyin(py))
    .replace(/\s+/g, " ")
    .trim();
}

function parseCedict(): { rows: Omit<EntryRow, "id" | "freq">[]; date: string } {
  const text = gunzipSync(read("cedict.txt.gz")).toString("utf8");
  const date = text.match(/^#! date=(\S+)/m)?.[1] ?? "";
  const byKey = new Map<string, Omit<EntryRow, "id" | "freq">>();
  for (const line of text.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const m = line.match(LINE);
    if (!m) continue;
    const [, traditional, simplified, numeric, body] = m;
    const classifiers: EntryRow["classifiers"] = [];
    const definitions: string[] = [];
    for (const raw of body.split("/")) {
      const def = raw.trim();
      if (!def) continue;
      if (/^CL:/.test(def)) { classifiers.push(...parseClassifiers(def)); continue; }
      const clean = cleanDefinition(def);
      if (clean && !definitions.includes(clean)) definitions.push(clean);
    }
    if (!definitions.length) continue;
    const key = `${traditional}\t${simplified}\t${numeric}`;
    const existing = byKey.get(key);
    if (existing) {
      for (const d of definitions) if (!existing.definitions.includes(d)) existing.definitions.push(d);
      for (const c of classifiers) if (!existing.classifiers.some((x) => x.simplified === c.simplified)) existing.classifiers.push(c);
      continue;
    }
    byKey.set(key, {
      simplified, traditional,
      pinyin: displayPinyin(numeric), pinyin_numeric: numeric, py_key: pinyinKey(numeric),
      definitions, classifiers, def_keys: [], english: "",
      proper: /^[A-Z]/.test(numeric.trim()),
      variant: definitions.every((d) => POINTER.test(d)),
    });
  }
  const rows = [...byKey.values()];
  for (const row of rows) {
    row.def_keys = [...new Set(row.definitions.flatMap(glossKeys))];
    row.english = row.definitions.join("; ");
  }
  return { rows, date };
}

// Unihan ------------------------------------------------------------------------------------------------------------

const codepoints = (value: string) => [...value.matchAll(/U\+([0-9A-F]{4,6})/g)].map((m) => String.fromCodePoint(parseInt(m[1], 16)));

async function parseUnihan(): Promise<Map<string, Record<string, string>>> {
  const zip = await JSZip.loadAsync(read("Unihan.zip"));
  const fields = new Set(["kMandarin", "kDefinition", "kRSUnicode", "kTotalStrokes", "kSimplifiedVariant", "kTraditionalVariant", "kHanyuPinlu"]);
  const data = new Map<string, Record<string, string>>();
  for (const name of Object.keys(zip.files)) {
    if (!name.endsWith(".txt")) continue;
    const text = await zip.file(name)!.async("string");
    for (const line of text.split("\n")) {
      if (!line.startsWith("U+")) continue;
      const [cp, field, value] = line.split("\t");
      if (!fields.has(field)) continue;
      const ch = String.fromCodePoint(parseInt(cp.slice(2), 16));
      const rec = data.get(ch) ?? {};
      rec[field] = value.trim();
      data.set(ch, rec);
    }
  }
  return data;
}

function parseRadicals(): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of read("CJKRadicals.txt").toString("utf8").split("\n")) {
    if (!line.trim() || line.startsWith("#")) continue;
    const [id, radical, unified] = line.split(";").map((s) => s.trim());
    const cp = unified || radical;
    if (cp) map.set(id, String.fromCodePoint(parseInt(cp, 16)));
  }
  return map;
}

function charRow(ch: string, rec: Record<string, string>, radicals: Map<string, string>): CharRow {
  const rs = rec.kRSUnicode?.split(/\s+/)[0]?.match(/^(\d+)('*)\.(-?\d+)$/);
  return {
    ch,
    pinyin: rec.kMandarin ? rec.kMandarin.split(/\s+/) : [],
    definition: rec.kDefinition || null,
    radical: rs ? radicals.get(rs[1] + rs[2]) ?? radicals.get(rs[1]) ?? null : null,
    radical_number: rs ? Number(rs[1]) : null,
    extra_strokes: rs ? Number(rs[3]) : null,
    strokes: rec.kTotalStrokes ? Number(rec.kTotalStrokes.split(/\s+/)[0]) : null,
    simplified: rec.kSimplifiedVariant ? codepoints(rec.kSimplifiedVariant).filter((c) => c !== ch) : [],
    traditional: rec.kTraditionalVariant ? codepoints(rec.kTraditionalVariant).filter((c) => c !== ch) : [],
  };
}

/** "xíng(5214) háng(400)" → Map { xíng → 5214, háng → 400 } */
function pinlu(value: string | undefined): Map<string, number> {
  const map = new Map<string, number>();
  for (const m of (value ?? "").matchAll(/(\S+?)\((\d+)\)/g)) map.set(m[1], Number(m[2]));
  return map;
}

// Tatoeba ---------------------------------------------------------------------------------------------------------

const MAX_SENTENCE = 40;

// Example sentences with swearing, slurs or crude insults are left out. The words themselves stay in the dictionary.
export const CRUDE_ENGLISH = new RegExp(
  "\\b(" + [
    "fuck\\w*", "motherfuck\\w*", "shit\\w*", "bullshit", "bitch\\w*", "bastards?", "ass(hole)?s?", "arse(hole)?s?", "cunts?",
    "dicks?", "cocks?", "pussy", "pussies", "whores?", "sluts?", "twats?", "wank\\w*", "piss(ed)?", "damn(ed|it)?", "goddamn\\w*",
    "hell", "crap\\w*", "bollocks", "douche\\w*", "jerk ?off", "screw (you|him|her|them|off)", "suck my", "son of a bitch",
    "nigg\\w*", "fag\\w*", "retard\\w*", "dyke", "slut\\w*",
  ].join("|") + ")\\b",
  "i",
);
const CRUDE_CHINESE = [
  "操你", "肏", "屌", "屄", "傻逼", "傻B", "牛逼", "装逼", "逼的", "妈的", "他妈", "你妈", "尼玛", "草泥马", "日你", "卧槽", "我靠",
  "婊子", "鸡巴", "王八蛋", "混蛋", "贱人", "贱货", "狗屎", "去死", "滚蛋", "白痴", "狗娘", "杂种", "畜生", "废物",
];
const isCrude = (chinese: string, english: string) => CRUDE_ENGLISH.test(english) || CRUDE_CHINESE.some((w) => chinese.includes(w));

/** Forward maximum matching against the dictionary's simplified words. */
export function segment(text: string, words: Set<string>, maxLen = 8): string[] {
  const chars = [...text];
  const out: string[] = [];
  let i = 0;
  while (i < chars.length) {
    if (!isHan(chars[i])) {
      let j = i + 1;
      while (j < chars.length && !isHan(chars[j])) j++;
      out.push(chars.slice(i, j).join(""));
      i = j;
      continue;
    }
    let take = 1;
    for (let len = Math.min(maxLen, chars.length - i); len > 1; len--) {
      if (words.has(chars.slice(i, i + len).join(""))) { take = len; break; }
    }
    out.push(chars.slice(i, i + take).join(""));
    i += take;
  }
  return out;
}

/**
 * Some sentences Tatoeba files as simplified still contain traditional-only characters (你在干什麼). Those are
 * converted with Unihan's simplified variant when there is exactly one; null means the sentence can't be trusted.
 */
function simplifier(rows: { simplified: string; traditional: string }[], unihan: Map<string, Record<string, string>>) {
  const simple = new Set<string>();
  const traditional = new Set<string>();
  for (const r of rows) {
    for (const ch of r.simplified) simple.add(ch);
    for (const ch of r.traditional) traditional.add(ch);
  }
  return (text: string): string | null => {
    let out = "";
    for (const ch of text) {
      if (!isHan(ch) || simple.has(ch) || !traditional.has(ch)) { out += ch; continue; }
      const variants = codepoints(unihan.get(ch)?.kSimplifiedVariant ?? "").filter((c) => c !== ch);
      if (variants.length !== 1) return null;
      out += variants[0];
    }
    return out;
  };
}

function parseTatoeba(words: Set<string>, toSimplified: (text: string) => string | null): { sentences: SentenceRow[]; counts: Map<string, number>; crude: number } {
  const original = new Map<number, string>();
  for (const line of bz2Lines("cmn_sentences.tsv.bz2")) {
    const [id, lang, text] = line.split("\t");
    if (lang === "cmn" && text) original.set(Number(id), text.trim());
  }
  const simplifiedOf = new Map<number, string>();
  const traditionalOf = new Map<number, string>();
  const latn = new Map<number, string>();
  for (const line of bz2Lines("cmn_transcriptions.tsv.bz2")) {
    const [id, , script, , text] = line.split("\t");
    if (!text) continue;
    const n = Number(id);
    if (script === "Hans") simplifiedOf.set(n, text.trim());
    else if (script === "Hant") traditionalOf.set(n, text.trim());
    else if (script === "Latn") latn.set(n, text.trim());
  }
  const links = new Map<number, number>();
  for (const line of bz2Lines("cmn-eng_links.tsv.bz2")) {
    const [a, b] = line.split("\t").map(Number);
    if (a && b && original.has(a) && !links.has(a)) links.set(a, b);
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

  const counts = new Map<string, number>();
  const sentences: SentenceRow[] = [];
  let crude = 0;
  for (const [id, text] of original) {
    // A Hans transcription means the sentence was written in traditional characters, and vice versa.
    const simplified = toSimplified(simplifiedOf.get(id) ?? text);
    if (!simplified) continue;
    const traditional = simplifiedOf.has(id) ? text : traditionalOf.get(id) ?? null;
    const tokens = segment(simplified, words);
    for (const t of tokens) if (isHan([...t][0])) counts.set(t, (counts.get(t) ?? 0) + 1);
    const engId = links.get(id);
    const eng = engId ? english.get(engId) : undefined;
    if (!eng || [...simplified].length > MAX_SENTENCE || !tokens.some((t) => isHan([...t][0]))) continue;
    if (isCrude(simplified + (traditional ?? ""), eng)) { crude++; continue; }
    sentences.push({ id, simplified, traditional: traditional && traditional !== simplified ? traditional : null, pinyin: latn.get(id) ?? null, english: eng, english_id: engId!, tokens });
  }
  return { sentences, counts, crude };
}

// Everything ------------------------------------------------------------------------------------------------------

export async function build(log: (msg: string) => void = console.log): Promise<Built> {
  log("Reading CC-CEDICT…");
  const { rows, date } = parseCedict();
  const words = new Set(rows.map((r) => r.simplified));
  log(`  ${rows.length} entries`);

  log("Reading Unihan…");
  const unihan = await parseUnihan();
  const radicals = parseRadicals();

  log("Reading Tatoeba…");
  const { sentences, counts, crude } = parseTatoeba(words, simplifier(rows, unihan));
  log(`  ${sentences.length} sentences with an English translation (${crude} crude ones left out)`);

  // A character read several ways (行 xíng/háng) splits its count by how often each reading is used.
  const readings = new Map<string, number>();
  // A proper noun spelled like a common word (书 Shū the surname, 书 shū book) leaves the count to the common word.
  const common = new Set<string>();
  for (const r of rows) {
    if (!r.proper) common.add(r.simplified);
    if ([...r.simplified].length === 1 && !r.proper) readings.set(r.simplified, (readings.get(r.simplified) ?? 0) + 1);
  }
  const entries: EntryRow[] = rows.map((row, i) => {
    let freq = row.proper && common.has(row.simplified) ? 0 : counts.get(row.simplified) ?? 0;
    if ((readings.get(row.simplified) ?? 0) > 1 && !row.proper) {
      const usage = pinlu(unihan.get(row.simplified)?.kHanyuPinlu);
      const total = [...usage.values()].reduce((a, b) => a + b, 0);
      const mine = usage.get(row.pinyin.toLowerCase()) ?? 0;
      if (total) freq = Math.round(freq * Math.max(mine / total, 0.02));
    }
    return { id: i + 1, ...row, freq };
  });

  const wanted = new Set<string>();
  for (const r of rows) for (const ch of r.simplified + r.traditional) if (isHan(ch)) wanted.add(ch);
  const chars = [...wanted].filter((ch) => unihan.has(ch)).map((ch) => charRow(ch, unihan.get(ch)!, radicals));
  log(`  ${chars.length} characters`);

  return {
    entries, chars, sentences,
    meta: {
      cedict_date: date, entries: String(entries.length), sentences: String(sentences.length), chars: String(chars.length),
      imported_at: new Date().toISOString(),
    },
  };
}