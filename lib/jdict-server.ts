/**
 * Server-only Japanese dictionary service. Works out what kind of query it is, calls the matopin_jdict_* functions
 * (supabase/006_japanese_dictionary.sql) and turns their rows into the shared model in lib/jdict.ts.
 */
import { Cache, type DictCall } from "./dictionary-server";
import { englishKey, glossKeys } from "./dictionary";
import {
  deinflect, fitsType, type JDictEntry, type JDictExamples, type JDictGroup, type JDictSearch, type JDictSummary, type JKanji,
  kanaKey, MAX_QUERY, parseTatoebaFurigana, romajiToKana, sentencePatterns, tatoebaUrl,
} from "./jdict";
import { hasCjk } from "./lang";

const LIMIT = 40;
const MAX_PHRASE = 30;
const MAX_WORD = 12;

type RawKanji = Omit<JKanji, "character"> & { ch: string };
type RawEntry = Omit<JDictEntry, "kanji" | "sources"> & { kanji: RawKanji[] };
type RawExample = { id: number; japanese: string; furigana: string | null; english: string };
type Found = { entry: JDictSummary; reasons: string[] };

export const normalizeJa = (q: string) => q.normalize("NFKC").replace(/\s+/g, " ").trim().slice(0, MAX_QUERY);

const KANA_END = /[\u3040-\u309f]$/;
const writings = (e: JDictSummary) => [e.headword, e.reading, ...e.forms, ...e.readings].map(kanaKey);

export function createJDictionary(call: DictCall) {
  const searches = new Cache<JDictSearch>();
  const entries = new Cache<JDictEntry | null>();
  const examples = new Cache<JDictExamples>();

  const lookup = async (forms: string[]) => {
    if (!forms.length) return new Map<string, JDictSummary[]>();
    const rows = await call<{ form: string; entries: JDictSummary[] }[]>("matopin_jdict_lookup", { p_forms: forms.slice(0, 4000) });
    return new Map(rows.map((r) => [r.form, r.entries]));
  };

  /** Dictionary forms of a conjugated word, the most likely first. */
  async function dictionaryForms(word: string): Promise<Found[]> {
    if (!KANA_END.test(word) || [...word].length < 2) return [];
    const cands = deinflect(word);
    const found = await lookup([...new Set(cands.map((c) => c.form))]);
    const best = new Map<number, Found>();
    for (const c of cands) {
      for (const entry of found.get(c.form) ?? []) {
        if (!fitsType(entry.posCodes, c.type)) continue;
        const had = best.get(entry.id);
        if (!had || c.reasons.length < had.reasons.length) best.set(entry.id, { entry, reasons: c.reasons });
      }
    }
    return [...best.values()].sort((a, b) => Number(b.entry.common) - Number(a.entry.common) || a.reasons.length - b.reasons.length);
  }

  /** Splits text into dictionary words, longest first, conjugated verbs and adjectives included. */
  async function segment(text: string): Promise<JDictSummary[]> {
    const chars = [...text].slice(0, MAX_PHRASE);
    const pieces = new Set<string>();
    for (let i = 0; i < chars.length; i++) for (let n = 1; n <= MAX_WORD && i + n <= chars.length; n++) pieces.add(chars.slice(i, i + n).join(""));
    const conjugated = new Map<string, { form: string; type: number }[]>();
    for (const p of pieces) {
      if (!KANA_END.test(p) || [...p].length < 2) continue;
      conjugated.set(p, deinflect(p).map(({ form, type }) => ({ form, type })));
    }
    const all = [...pieces, ...[...conjugated.values()].flat().map((c) => c.form)];
    const found = await lookup([...new Set(all)]);
    const out: JDictSummary[] = [];
    const seen = new Set<number>();
    let i = 0;
    while (i < chars.length) {
      if (!hasCjk(chars[i])) { i++; continue; }
      let take = 1;
      let hit: JDictSummary | undefined;
      for (let n = Math.min(MAX_WORD, chars.length - i); n >= 1 && !hit; n--) {
        const piece = chars.slice(i, i + n).join("");
        hit = found.get(piece)?.[0];
        for (const c of conjugated.get(piece) ?? []) {
          if (hit) break;
          hit = found.get(c.form)?.find((e) => fitsType(e.posCodes, c.type));
        }
        if (hit) take = n;
      }
      if (hit && !seen.has(hit.id)) { seen.add(hit.id); out.push(hit); }
      i += take;
    }
    return out;
  }

  async function searchJapanese(text: string): Promise<JDictGroup[]> {
    const key = kanaKey(text.replace(/\s+/g, ""));
    const results = await call<JDictSummary[]>("matopin_jdict_search", { p_query: key, p_limit: LIMIT });
    const exact = results.some((r) => writings(r).includes(key));
    const groups: JDictGroup[] = [];
    if (!exact) {
      const forms = await dictionaryForms(key);
      if (forms.length) groups.push({ kind: "deinflected", label: `${text} is a form of`, results: forms.map((f) => f.entry) });
      else if ([...key].length > 1) {
        const words = await segment(key);
        if (words.length > 1 || (words.length === 1 && !results.length)) groups.push({ kind: "phrase", label: `Words in ${text}`, results: words });
      }
    }
    if (results.length) groups.push({ kind: "word", label: exact ? "Words" : `Starting with ${text}`, results });
    return groups;
  }

  async function searchLatin(text: string): Promise<JDictGroup[]> {
    const kana = romajiToKana(text);
    const key = englishKey(text);
    const compact = text.replace(/\s+/g, "");
    const written = [...new Set([text, compact, text.toLowerCase(), compact.toLowerCase(), text.toUpperCase(), compact.toUpperCase()])];
    const [ro, en, forms, asWritten] = await Promise.all([
      kana ? call<JDictSummary[]>("matopin_jdict_search", { p_query: kana, p_limit: LIMIT }) : Promise.resolve([]),
      call<JDictSummary[]>("matopin_jdict_search_english", { p_key: key, p_query: text, p_limit: LIMIT }),
      kana ? dictionaryForms(kana) : Promise.resolve([]),
      lookup(written),
    ]);
    const seen = new Set<number>();
    const wordHits = written.flatMap((w) => asWritten.get(w) ?? []).filter((e) => !seen.has(e.id) && seen.add(e.id));
    const wordGroup: JDictGroup | null = wordHits.length ? { kind: "word", label: "Written in letters", results: wordHits } : null;
    const roExact = kana ? ro.some((r) => writings(r).includes(kana)) : false;
    let roGroup: JDictGroup | null = ro.length ? { kind: "romaji", label: roExact ? `Reading ${kana}` : `Readings starting with ${kana}`, results: ro } : null;
    if (!roExact && forms.length) roGroup = { kind: "deinflected", label: `${kana} is a form of`, results: forms.map((f) => f.entry) };
    const enGroup: JDictGroup | null = en.length ? { kind: "english", label: "English", results: en } : null;
    const enExact = en.some((r) => r.senses.some((s) => s.glosses.some((g) => glossKeys(g).includes(key))));
    const englishFirst = enExact || !roGroup;
    return [wordGroup, englishFirst ? enGroup : roGroup, englishFirst ? roGroup : enGroup].filter((g): g is JDictGroup => g !== null);
  }

  const self = {
    search(raw: string): Promise<JDictSearch> {
      const query = normalizeJa(raw);
      if (!query) return Promise.resolve({ query, groups: [] });
      return searches.get(query, async () => ({ query, groups: hasCjk(query) ? await searchJapanese(query) : await searchLatin(query) }), (r) => r.groups.length > 0);
    },

    entry(id: number): Promise<JDictEntry | null> {
      if (!Number.isInteger(id) || id <= 0) return Promise.resolve(null);
      return entries.get(String(id), async () => {
        const raw = await call<RawEntry | null>("matopin_jdict_entry", { p_id: id });
        if (!raw) return null;
        const kanji = raw.kanji.map(({ ch, ...k }) => ({ character: ch, ...k }));
        return { ...raw, kanji, sources: ["jmdict", ...(kanji.length ? (["kanjidic", "kanjivg"] as const) : [])] };
      }, (e) => e !== null);
    },

    examples(id: number, offset = 0, limit = 6): Promise<JDictExamples> {
      if (!Number.isInteger(id) || id <= 0) return Promise.resolve({ examples: [], hasMore: false });
      return examples.get(`${id}:${offset}:${limit}`, async () => {
        const found = await self.entry(id);
        if (!found) return { examples: [], hasMore: false };
        const e = found.entry;
        // Kana-only words are matched whole and only when long enough not to turn up inside other words.
        const exact = [e.headword, ...e.forms].filter((w) => /[\u3400-\u9fff\uf900-\ufaff々]/.test(w) || [...w].length >= 2);
        const raw = await call<{ examples: RawExample[]; hasMore: boolean }>("matopin_jdict_examples", {
          p_id: id, p_exact: exact, p_patterns: sentencePatterns(e), p_limit: limit, p_offset: offset,
        });
        return {
          hasMore: raw.hasMore,
          examples: raw.examples.map((x) => {
            const parsed = x.furigana ? parseTatoebaFurigana(x.furigana) : null;
            const fits = parsed && parsed.text === x.japanese;
            return {
              id: x.id, japanese: x.japanese, english: x.english, url: tatoebaUrl(x.id), source: "tatoeba" as const,
              reading: fits ? parsed.reading : null, ruby: fits ? parsed.ruby : null,
            };
          }),
        };
      }, (r) => r.examples.length > 0);
    },

    /** Exact matches for words as written, for checking cards. */
    lookup: (words: string[]) => lookup(words.map(kanaKey)),

    status: () => call<Record<string, string>>("matopin_jdict_status", {}),
  };
  return self;
}

export type JDictionary = ReturnType<typeof createJDictionary>;
