/**
 * The Japanese dictionary's shared model and helpers. Safe on the client and the server; the import script
 * (scripts/import-jdict.mts) and the search service (lib/jdict-server.ts) both use it.
 */
import { isKana, toHiragana } from "wanakana";
import type { RubyPiece } from "./lang";

export type JDictSource = "jmdict" | "kanjidic" | "tatoeba" | "kanjivg";

export const JDICT_SOURCES: Record<JDictSource, { name: string; url: string; license: string; licenseUrl: string; covers: string }> = {
  jmdict: {
    name: "JMdict (EDRDG)", url: "https://www.edrdg.org/wiki/index.php/JMdict-EDICT_Dictionary_Project", covers: "Words, readings, parts of speech and meanings",
    license: "CC BY-SA 4.0", licenseUrl: "https://www.edrdg.org/edrdg/licence.html",
  },
  kanjidic: {
    name: "KANJIDIC2 (EDRDG)", url: "https://www.edrdg.org/wiki/index.php/KANJIDIC_Project", covers: "Kanji meanings, on and kun readings, stroke counts, grades and JLPT levels",
    license: "CC BY-SA 4.0", licenseUrl: "https://www.edrdg.org/edrdg/licence.html",
  },
  tatoeba: {
    name: "Tatoeba", url: "https://tatoeba.org", covers: "Example sentences, their furigana and English translations",
    license: "CC BY 2.0 FR", licenseUrl: "https://creativecommons.org/licenses/by/2.0/fr/",
  },
  kanjivg: {
    name: "KanjiVG", url: "https://kanjivg.tagaini.net", covers: "Kanji stroke order",
    license: "CC BY-SA 3.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0/",
  },
};

/** One meaning of a word. `kanji` and `kana` list the forms it's limited to; empty means every form. */
export type JSense = {
  pos: string[]; glosses: string[]; info: string[]; misc: string[]; field: string[]; dialect: string[];
  kanji: string[]; kana: string[];
};
export type JForm = { text: string; common: boolean; tags: string[] };
/** A reading, and the kanji forms it belongs to (empty for all). */
export type JReading = JForm & { kanji: string[] };

/** One JMdict entry, cut down for result lists. */
export type JDictSummary = {
  id: number;
  /** The usual way to write it: its first ordinary kanji form, or its reading when it's usually written in kana. */
  headword: string;
  reading: string;
  /** Every other way of writing it, and every reading. */
  forms: string[];
  readings: string[];
  common: boolean;
  /** JMdict part-of-speech codes across all senses ("v1", "v5k", "adj-i"), for deinflection. */
  posCodes: string[];
  /** The first few senses. */
  senses: { pos: string[]; glosses: string[] }[];
};

export type JKanji = {
  character: string;
  meanings: string[];
  onyomi: string[];
  kunyomi: string[];
  nanori: string[];
  strokes: number | null;
  grade: number | null;
  jlpt: number | null;
  /** Rank among the 2,500 most used kanji in newspapers. */
  freq: number | null;
  radical: number | null;
};

export type JDictEntry = {
  entry: JDictSummary & { kanjiForms: JForm[]; kanaForms: JReading[]; allSenses: JSense[]; frequency: number };
  kanji: JKanji[];
  /** Common words that contain this one. */
  related: JDictSummary[];
  sources: JDictSource[];
};

export type JDictGroupKind = "word" | "romaji" | "english" | "deinflected" | "phrase";
export type JDictGroup = { kind: JDictGroupKind; label: string; results: JDictSummary[] };
export type JDictSearch = { query: string; groups: JDictGroup[] };

export type JDictExample = {
  id: number;
  japanese: string;
  /** The sentence in hiragana, from Tatoeba's furigana. */
  reading: string | null;
  /** Kanji with their readings, for ruby text. Null when the furigana doesn't line up with the sentence. */
  ruby: RubyPiece[] | null;
  english: string;
  url: string;
  source: JDictSource;
};
export type JDictExamples = { examples: JDictExample[]; hasMore: boolean };

export const MAX_QUERY = 64;

// Kana --------------------------------------------------------------------------------------------------------------

/** Katakana → hiragana, leaving ー and everything else alone. Forms are stored and searched this way. */
export function kanaKey(text: string): string {
  let out = "";
  for (const ch of text.normalize("NFKC")) {
    const cp = ch.codePointAt(0)!;
    out += cp >= 0x30a1 && cp <= 0x30f6 ? String.fromCodePoint(cp - 0x60) : ch;
  }
  return out;
}

const MACRONS: Record<string, string> = { ā: "aa", ī: "ii", ū: "uu", ē: "ee", ō: "ou", â: "aa", î: "ii", û: "uu", ê: "ee", ô: "ou" };

/** "taberu", "tabemono", "tōkyō" → hiragana. Null when it isn't romaji. */
export function romajiToKana(text: string): string | null {
  const t = text.normalize("NFC").toLowerCase().replace(/[āīūēōâîûêô]/g, (c) => MACRONS[c]).replace(/[\s'-]+/g, "");
  if (!t || !/^[a-z]+$/.test(t)) return null;
  const kana = toHiragana(t);
  return isKana(kana) ? kana : null;
}

/** Tatoeba's furigana, "[学生|がく|せい]です", as plain text, its hiragana reading and ruby pieces. */
export function parseTatoebaFurigana(text: string): { text: string; reading: string; ruby: RubyPiece[] } {
  const ruby: RubyPiece[] = [];
  let plain = "";
  let reading = "";
  let at = 0;
  for (const m of text.matchAll(/\[([^|\]]+)((?:\|[^|\]]*)+)\]/g)) {
    if (m.index! > at) {
      const kana = text.slice(at, m.index);
      ruby.push({ zi: kana, py: "" });
      plain += kana;
      reading += kana;
    }
    const base = m[1];
    const parts = m[2].slice(1).split("|");
    const chars = [...base];
    if (parts.length === chars.length && parts.length > 1 && parts.every(Boolean)) chars.forEach((c, i) => ruby.push({ zi: c, py: parts[i] }));
    else ruby.push({ zi: base, py: parts.join("") });
    plain += base;
    reading += parts.join("");
    at = m.index! + m[0].length;
  }
  if (at < text.length) {
    const rest = text.slice(at);
    ruby.push({ zi: rest, py: "" });
    plain += rest;
    reading += rest;
  }
  return { text: plain, reading: kanaKey(reading), ruby };
}

// Deinflection ------------------------------------------------------------------------------------------------------

/** What a form can be: a dictionary form of some kind, or a stem the next rule builds on. */
const V1 = 1, V5 = 2, VK = 4, VS = 8, ADJ = 16, STEM_I = 32, STEM_A = 64, STEM_E = 128, TE = 256, NOUN_VS = 512;
const ANY = 0x3ff;

type Rule = { from: string; to: string; in: number; out: number; why?: string };

const ROWS = { u: "うくぐすつぬぶむる", a: "わかがさたなばまら", i: "いきぎしちにびみり", e: "えけげせてねべめれ", o: "おこごそとのぼもろ" };
const TE_FORMS: [string, string, string][] = [
  ["う", "って", "った"], ["つ", "って", "った"], ["る", "って", "った"], ["く", "いて", "いた"], ["ぐ", "いで", "いだ"],
  ["す", "して", "した"], ["ぬ", "んで", "んだ"], ["ぶ", "んで", "んだ"], ["む", "んで", "んだ"],
];

const RULES: Rule[] = [
  // い-adjectives
  { from: "かった", to: "い", in: ANY, out: ADJ, why: "past" },
  { from: "くない", to: "い", in: ANY | ADJ, out: ADJ, why: "negative" },
  { from: "くて", to: "い", in: ANY, out: ADJ, why: "te-form" },
  { from: "く", to: "い", in: ANY, out: ADJ, why: "adverb" },
  { from: "ければ", to: "い", in: ANY, out: ADJ, why: "conditional" },
  { from: "かったら", to: "い", in: ANY, out: ADJ, why: "conditional" },
  { from: "さ", to: "い", in: ANY, out: ADJ, why: "noun" },
  { from: "そう", to: "い", in: ANY, out: ADJ, why: "looks like" },
  { from: "すぎる", to: "い", in: ANY | V1, out: ADJ, why: "too much" },
  { from: "くなる", to: "い", in: ANY | V5, out: ADJ, why: "becoming" },
  // Polite forms, and others built on the masu stem
  ...["ます", "ました", "ません", "ませんでした", "ましょう", "まして"].map((from) => ({ from, to: "", in: ANY, out: STEM_I, why: "polite" })),
  { from: "たい", to: "", in: ANY | ADJ, out: STEM_I, why: "want to" },
  { from: "ながら", to: "", in: ANY, out: STEM_I, why: "while" },
  { from: "なさい", to: "", in: ANY, out: STEM_I, why: "command" },
  { from: "そう", to: "", in: ANY, out: STEM_I, why: "looks like" },
  { from: "すぎる", to: "", in: ANY | V1, out: STEM_I, why: "too much" },
  { from: "やすい", to: "", in: ANY | ADJ, out: STEM_I, why: "easy to" },
  { from: "にくい", to: "", in: ANY | ADJ, out: STEM_I, why: "hard to" },
  // Forms built on the negative stem
  { from: "ない", to: "", in: ANY | ADJ, out: STEM_A, why: "negative" },
  { from: "ず", to: "", in: ANY, out: STEM_A, why: "negative" },
  { from: "ずに", to: "", in: ANY, out: STEM_A, why: "without" },
  { from: "せる", to: "", in: ANY | V1, out: STEM_A, why: "causative" },
  { from: "させる", to: "", in: ANY | V1, out: STEM_A, why: "causative" },
  { from: "れる", to: "", in: ANY | V1, out: STEM_A, why: "passive" },
  { from: "られる", to: "", in: ANY | V1, out: STEM_A, why: "passive / potential" },
  // Conditional and potential
  { from: "ば", to: "", in: ANY, out: STEM_E, why: "conditional" },
  { from: "る", to: "", in: ANY | V1, out: STEM_E, why: "potential" },
  // Built on the te-form
  ...["ている", "てる", "ていた", "ていない", "ています", "ておく", "とく", "てしまう", "てください", "てくれる", "てあげる", "てみる"].map((from) => ({
    from, to: "て", in: ANY | V1 | V5 | ADJ, out: TE, why: from === "てください" ? "please" : from.includes("しま") ? "completely" : from === "てみる" ? "try" : "progressive",
  })),
  ...["でいる", "でる", "でいた", "でいない", "でいます", "でおく", "どく", "でしまう", "でください", "でくれる", "であげる", "でみる"].map((from) => ({
    from, to: "で", in: ANY | V1 | V5 | ADJ, out: TE, why: "progressive",
  })),
  { from: "ちゃう", to: "て", in: ANY | V5, out: TE, why: "completely" },
  { from: "ちゃった", to: "て", in: ANY, out: TE, why: "completely" },
  { from: "じゃう", to: "で", in: ANY | V5, out: TE, why: "completely" },
  { from: "じゃった", to: "で", in: ANY, out: TE, why: "completely" },
  { from: "たら", to: "た", in: ANY, out: ANY, why: "conditional" },
  { from: "だら", to: "だ", in: ANY, out: ANY, why: "conditional" },
  { from: "たり", to: "た", in: ANY, out: ANY, why: "listing" },
  { from: "だり", to: "だ", in: ANY, out: ANY, why: "listing" },
  // Ichidan
  { from: "た", to: "る", in: ANY, out: V1, why: "past" },
  { from: "て", to: "る", in: ANY | TE, out: V1, why: "te-form" },
  { from: "よう", to: "る", in: ANY, out: V1, why: "volitional" },
  { from: "ろ", to: "る", in: ANY, out: V1, why: "command" },
  // Irregular
  { from: "した", to: "する", in: ANY, out: VS, why: "past" },
  { from: "して", to: "する", in: ANY | TE, out: VS, why: "te-form" },
  { from: "しよう", to: "する", in: ANY, out: VS, why: "volitional" },
  { from: "きた", to: "くる", in: ANY, out: VK, why: "past" },
  { from: "きて", to: "くる", in: ANY | TE, out: VK, why: "te-form" },
  { from: "来た", to: "来る", in: ANY, out: VK, why: "past" },
  { from: "来て", to: "来る", in: ANY | TE, out: VK, why: "te-form" },
  { from: "行った", to: "行く", in: ANY, out: V5, why: "past" },
  { from: "行って", to: "行く", in: ANY | TE, out: V5, why: "te-form" },
  { from: "いった", to: "いく", in: ANY, out: V5, why: "past" },
  { from: "いって", to: "いく", in: ANY | TE, out: V5, why: "te-form" },
  { from: "する", to: "", in: VS, out: NOUN_VS },
  // Godan te / ta
  ...TE_FORMS.flatMap(([u, te, ta]) => [
    { from: ta, to: u, in: ANY, out: V5, why: "past" },
    { from: te, to: u, in: ANY | TE, out: V5, why: "te-form" },
  ]),
  // Godan volitional
  ...[...ROWS.o].map((o, i) => ({ from: `${o}う`, to: ROWS.u[i], in: ANY, out: V5, why: "volitional" })),
  // Stems back to dictionary forms
  { from: "", to: "る", in: STEM_I | STEM_A, out: V1 },
  { from: "れ", to: "る", in: STEM_E, out: V1 },
  { from: "", to: "る", in: STEM_E, out: V1 },
  { from: "し", to: "する", in: STEM_I | STEM_A, out: VS },
  { from: "すれ", to: "する", in: STEM_E, out: VS },
  { from: "さ", to: "する", in: STEM_A, out: VS },
  { from: "き", to: "くる", in: STEM_I, out: VK },
  { from: "こ", to: "くる", in: STEM_A, out: VK },
  { from: "くれ", to: "くる", in: STEM_E, out: VK },
  ...[...ROWS.u].flatMap((u, i) => [
    { from: ROWS.i[i], to: u, in: STEM_I, out: V5 },
    { from: ROWS.a[i], to: u, in: STEM_A, out: V5 },
    { from: ROWS.e[i], to: u, in: STEM_E, out: V5 },
    { from: ROWS.e[i], to: u, in: ANY, out: V5, why: "command" },
  ]),
];

export type Deinflected = { form: string; type: number; reasons: string[] };

/** The dictionary forms a conjugated word could come from: 食べなかった → 食べる (negative, past). */
export function deinflect(word: string): Deinflected[] {
  const seen = new Map<string, Deinflected>();
  let frontier: Deinflected[] = [{ form: word, type: ANY, reasons: [] }];
  for (let depth = 0; depth < 5 && frontier.length; depth++) {
    const next: Deinflected[] = [];
    for (const cand of frontier) {
      for (const rule of RULES) {
        if (!(rule.in & cand.type) || !cand.form.endsWith(rule.from)) continue;
        const stem = cand.form.slice(0, cand.form.length - rule.from.length);
        const form = stem + rule.to;
        if (!form || form === cand.form && rule.out === cand.type) continue;
        const key = `${form}:${rule.out}`;
        if (seen.has(key)) continue;
        const found = { form, type: rule.out, reasons: rule.why ? [rule.why, ...cand.reasons] : cand.reasons };
        seen.set(key, found);
        next.push(found);
      }
    }
    frontier = next;
  }
  return [...seen.values()].filter((d) => d.type & (V1 | V5 | VK | VS | ADJ | NOUN_VS));
}

/** Whether an entry's parts of speech fit a deinflected type. */
export function fitsType(posCodes: string[], type: number): boolean {
  return posCodes.some((p) =>
    (type & V1 && /^v1/.test(p)) || (type & V5 && /^v5/.test(p)) || (type & VK && p === "vk") ||
    (type & VS && /^vs-[is]$/.test(p)) || (type & ADJ && /^adj-ix?$/.test(p)) || (type & NOUN_VS && p === "vs"),
  );
}

// English ---------------------------------------------------------------------------------------------------------

export const tatoebaUrl = (id: number) => `https://tatoeba.org/en/sentences/show/${id}`;
export const kanjiVgUrl = (ch: string) => `https://cdn.jsdelivr.net/gh/KanjiVG/kanjivg@master/kanji/${ch.codePointAt(0)!.toString(16).padStart(5, "0")}.svg`;

/** Plain text of an entry's meanings for flashcards: the first few senses. */
export function shortMeaningJa(entry: Pick<JDictSummary, "senses">, senses = 3): string {
  return entry.senses.slice(0, senses).map((s) => s.glosses.join(", ")).join("; ");
}

/** LIKE patterns that find a word in a sentence however it's conjugated: 書く → 書か%, 書き%, 書い%…. */
export function sentencePatterns(entry: Pick<JDictSummary, "headword" | "posCodes">): string[] {
  const w = entry.headword;
  const like = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
  const last = w.slice(-1);
  const stem = like(w.slice(0, -1));
  const out = new Set<string>();
  // Kana-only stems (あ for ある) would match half of every sentence.
  if (!/[\u3400-\u9fff\uf900-\ufaff々]/.test(stem)) return [];
  for (const p of entry.posCodes) {
    if (/^v1/.test(p)) out.add(`%${stem}%`);
    else if (/^v5/.test(p)) {
      const i = ROWS.u.indexOf(last);
      if (i < 0) continue;
      for (const row of [ROWS.a, ROWS.i, ROWS.u, ROWS.e, ROWS.o]) out.add(`%${stem}${row[i]}%`);
      const te = TE_FORMS.find(([u]) => u === last);
      if (te) out.add(`%${stem}${te[1][0]}%`);
    } else if (/^adj-i$/.test(p) && last === "い") for (const k of "いくかけさそ") out.add(`%${stem}${k}%`);
    else if (p === "vs-i" && w.endsWith("する")) for (const k of ["し", "す", "さ", "せ"]) out.add(`%${like(w.slice(0, -2))}${k}%`);
  }
  return [...out];
}
