/**
 * The dictionary's shared model and pinyin helpers. Safe on the client and the server; the import script
 * (scripts/import-dictionary.mts) and the search service (lib/dictionary-server.ts) both use it.
 */
import { isSyllableAt } from "./pinyin-syllables";

export type DictSource = "cc-cedict" | "tatoeba" | "unihan";

export const DICT_SOURCES: Record<DictSource, { name: string; url: string; license: string; licenseUrl: string; covers: string }> = {
  "cc-cedict": {
    name: "CC-CEDICT", url: "https://cc-cedict.org/wiki/", covers: "Words, pinyin, definitions and measure words",
    license: "CC BY-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
  },
  tatoeba: {
    name: "Tatoeba", url: "https://tatoeba.org", covers: "Example sentences, their pinyin and English translations",
    license: "CC BY 2.0 FR", licenseUrl: "https://creativecommons.org/licenses/by/2.0/fr/",
  },
  unihan: {
    name: "Unicode Unihan Database", url: "https://www.unicode.org/charts/unihan.html", covers: "Character readings, radicals, stroke counts and variants",
    license: "Unicode License v3", licenseUrl: "https://www.unicode.org/license.txt",
  },
};

export type DictClassifier = { simplified: string; traditional: string; pinyin: string };

/** One CC-CEDICT headword with one reading. CC-CEDICT has no parts of speech, so none are shown. */
export type DictSummary = {
  id: number;
  simplified: string;
  traditional: string;
  /** Tone marks, syllables joined: "xuéxí". */
  pinyin: string;
  /** CC-CEDICT form: "xue2 xi2". */
  pinyinNumeric: string;
  definitions: string[];
  classifiers: DictClassifier[];
};

export type DictGroupKind = "hanzi" | "pinyin" | "english" | "phrase";
export type DictGroup = { kind: DictGroupKind; label: string; results: DictSummary[] };
export type DictSearch = { query: string; groups: DictGroup[] };

export type DictCharacter = {
  character: string;
  /** Unihan's Mandarin readings, most common first. */
  pinyin: string[];
  /** Unihan's short English gloss, used only when CC-CEDICT has no entry for the character. */
  definition: string | null;
  radical: string | null;
  radicalNumber: number | null;
  strokes: number | null;
  simplified: string[];
  traditional: string[];
  /** CC-CEDICT entries for the character on its own. */
  entries: DictSummary[];
  sources: DictSource[];
};

export type DictEntry = {
  entry: DictSummary & { frequency: number; proper: boolean };
  /** Same characters, different reading (行 háng / xíng). */
  otherReadings: DictSummary[];
  characters: DictCharacter[];
  /** Common words that contain this one. */
  related: DictSummary[];
  sources: DictSource[];
};

export type DictExample = {
  id: number;
  simplified: string;
  traditional: string | null;
  /** Tone-marked pinyin grouped by word, as Tatoeba transcribed it. */
  pinyin: string | null;
  /** One lowercase syllable per character, the way flashcards store pinyin: "zhè shì shū". */
  syllables: string | null;
  english: string;
  /** The sentence split into dictionary words, punctuation as separate pieces. */
  tokens: string[];
  url: string;
  source: DictSource;
};

export type DictExamples = { examples: DictExample[]; hasMore: boolean };

export const MAX_QUERY = 64;

const HAN = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u{20000}-\u{3134F}]/u;
export const isHan = (ch: string) => HAN.test(ch);
export const hasHanChars = (s: string) => HAN.test(s);
export const hanOnly = (s: string) => [...s].filter(isHan).join("");

// Pinyin ---------------------------------------------------------------------------------------------------------

const MARKS: Record<string, string> = { a: "āáǎà", e: "ēéěè", i: "īíǐì", o: "ōóǒò", u: "ūúǔù", ü: "ǖǘǚǜ" };

/** "xue2" → "xué", "lu:4" / "lv4" → "lǜ", "ma5" → "ma". Keeps the capital of a proper noun. */
export function markSyllable(numbered: string): string {
  const m = numbered.match(/^([a-zA-ZüÜ:]+?)([1-5])$/);
  if (!m) return numbered.replace(/u:/g, "ü").replace(/U:/g, "Ü");
  const upper = /^[A-Z]/.test(m[1]);
  let syl = m[1].toLowerCase().replace(/u:/g, "ü").replace(/v/g, "ü");
  const tone = Number(m[2]);
  if (tone !== 5) {
    const at = syl.search(/[ae]/) >= 0 ? syl.search(/[ae]/) : syl.includes("ou") ? syl.indexOf("o") : Math.max(...[...syl].map((c, i) => ("iouü".includes(c) ? i : -1)));
    if (at >= 0) syl = syl.slice(0, at) + MARKS[syl[at]][tone - 1] + syl.slice(at + 1);
  }
  return upper ? syl[0].toUpperCase() + syl.slice(1) : syl;
}

const SYLLABLE_RE = /^[a-zA-ZüÜ:]+[1-5]$/;

/** CC-CEDICT "xue2 xi2" → "xuéxí", "Xi1 an1" → "Xī'ān". Anything that isn't a syllable stays separated by spaces. */
export function displayPinyin(numeric: string): string {
  let out = "";
  let prevSyllable = false;
  for (const part of numeric.trim().split(/\s+/)) {
    if (SYLLABLE_RE.test(part)) {
      const marked = markSyllable(part);
      if (prevSyllable && /^[aeoāáǎàēéěèōóǒò]/i.test(marked)) out += "'";
      else if (out && !prevSyllable) out += " ";
      out += marked;
      prevSyllable = true;
    } else {
      out += (out ? " " : "") + part.replace(/u:/g, "ü");
      prevSyllable = false;
    }
  }
  return out;
}

/** CC-CEDICT "xue2 xi2" → "xué xí": one syllable per character, the way flashcards store pinyin. */
export function spacedPinyin(numeric: string): string {
  return numeric.trim().split(/\s+/).map((p) => (SYLLABLE_RE.test(p) ? markSyllable(p) : p.replace(/u:/g, "ü"))).join(" ");
}

/** Tatoeba's "Wo3 de5 shu1." → "Wǒ de shū." */
export function markPinyinText(text: string): string {
  return text.replace(/([a-zA-ZüÜ:]+?)([1-5])(?![0-9])/g, (_, syl: string, tone: string) => markSyllable(syl + tone)).replace(/\s+([.,!?;:])/g, "$1").trim();
}

/** Tatoeba's "Wo3 de5 shu1." → "wǒ de shū": one lowercase syllable per character, punctuation dropped. */
export function syllablesOf(text: string): string {
  const out: string[] = [];
  for (const m of text.matchAll(/([a-zA-ZüÜ:]+?)([1-5])(?![0-9])/g)) out.push(markSyllable(m[1] + m[2]).toLowerCase());
  return out.join(" ");
}

/** "xue2 xi2" → "xue2xi2", lowercase with ü as v. This is the py_key column. */
export function pinyinKey(numeric: string): string {
  return numeric.toLowerCase().replace(/u:/g, "v").replace(/ü/g, "v").replace(/[^a-z0-9]/g, "");
}

const TONED: Record<string, [string, number]> = {};
for (const [base, marks] of Object.entries(MARKS)) [...marks].forEach((m, i) => { TONED[m] = [base, i + 1]; });

/** Splits letters into pinyin syllables, longest first with backtracking. Null when they aren't pinyin. */
function splitSyllables(letters: string): string[] | null {
  const split = (strict: boolean) => {
    const memo = new Map<number, string[] | null>();
    const go = (at: number): string[] | null => {
      if (at === letters.length) return [];
      if (memo.has(at)) return memo.get(at)!;
      let found: string[] | null = null;
      for (let len = Math.min(6, letters.length - at); len >= 1 && !found; len--) {
        if (!isSyllableAt(letters, at, at + len, strict)) continue;
        const rest = go(at + len);
        if (rest) found = [letters.slice(at, at + len), ...rest];
      }
      memo.set(at, found);
      return found;
    };
    return go(0);
  };
  return split(true) ?? split(false);
}

export type PinyinQuery = {
  /** Numbered syllables with _ where no tone was given: "ni_hao3". */
  pattern: string;
  /** The literal start of the pattern, for the index range: "ni". */
  prefix: string;
  /** One pattern per syllable: ["ni_", "hao3"]. */
  parts: string[];
  /** True when the learner typed a tone mark or number. */
  toned: boolean;
};

/** Reads "shū", "shu1", "ni hao", "xuexi", "lü" or "lv" as pinyin. Null when it can't be pinyin. */
export function parsePinyin(raw: string): PinyinQuery | null {
  const text = raw.normalize("NFC").toLowerCase().replace(/u:/g, "ü").trim();
  if (!text || /[^a-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü1-5\s']/.test(text)) return null;
  const parts: string[] = [];
  let toned = false;
  for (const chunk of text.split(/[\s']+/).filter(Boolean)) {
    for (const piece of chunk.match(/[^1-5]+[1-5]?|[1-5]/g) ?? []) {
      const digit = /[1-5]$/.test(piece) ? Number(piece.slice(-1)) : 0;
      const body = digit ? piece.slice(0, -1) : piece;
      if (!body) return null;
      const tones: number[] = [];
      let letters = "";
      for (const ch of body) {
        const t = TONED[ch];
        letters += (t ? t[0] : ch) === "ü" ? "v" : t ? t[0] : ch;
        tones.push(t ? t[1] : 0);
      }
      const syllables = splitSyllables(letters);
      if (!syllables) return null;
      let at = 0;
      syllables.forEach((syl, i) => {
        let tone = Math.max(0, ...tones.slice(at, at + syl.length));
        if (!tone && digit && i === syllables.length - 1) tone = digit;
        if (tone) toned = true;
        parts.push(syl + (tone ? String(tone) : "_"));
        at += syl.length;
      });
    }
  }
  if (!parts.length || parts.length > 20) return null;
  const pattern = parts.join("");
  return { pattern, prefix: pattern.split("_")[0], parts, toned };
}

/** Whether an entry's numbered pinyin fits a pinyin query exactly (same syllables, given tones). */
export function matchesPinyin(entry: Pick<DictSummary, "pinyinNumeric">, query: PinyinQuery): boolean {
  const re = new RegExp(`^${query.pattern.replace(/_/g, "[1-5]")}$`);
  return re.test(pinyinKey(entry.pinyinNumeric));
}

// English ---------------------------------------------------------------------------------------------------------

/** "to learn; to study (formal)" → ["learn", "study"]. The same rule builds def_keys and reads English queries. */
export function glossKeys(definition: string): string[] {
  const keys: string[] = [];
  const text = definition.toLowerCase().replace(/\([^)]*\)/g, " ");
  for (const part of text.split(/[;,]/)) {
    const key = part.trim().replace(/^(to|a|an|the)\s+/, "").replace(/[.!?"']+$/g, "").replace(/\s+/g, " ").trim();
    if (key && key.length <= 40 && !hasHanChars(key) && !keys.includes(key)) keys.push(key);
  }
  return keys;
}

export const englishKey = (query: string) => glossKeys(query)[0] ?? query.trim().toLowerCase();

export function matchesEnglish(entry: Pick<DictSummary, "definitions">, key: string): boolean {
  return entry.definitions.some((d) => glossKeys(d).includes(key));
}

/** Plain text of a definition list for flashcards: the first few senses. */
export function shortMeaning(entry: Pick<DictSummary, "definitions">, senses = 3): string {
  return entry.definitions.slice(0, senses).join("; ");
}

export const tatoebaUrl = (id: number) => `https://tatoeba.org/en/sentences/show/${id}`;
