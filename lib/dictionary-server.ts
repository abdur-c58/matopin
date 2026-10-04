/**
 * Server-only dictionary service. Works out what kind of query it is, runs the lookups (lib/dictionary-memory.ts)
 * and turns their rows into the shared model in lib/dictionary.ts.
 * `call` is injectable so scripts/test-dictionary.mts can run the same code on freshly built data.
 */
import {
  type DictCharacter, type DictEntry, type DictExample, type DictExamples, type DictGroup, type DictSearch, type DictSummary,
  englishKey, hanOnly, hasHanChars, markPinyinText, matchesEnglish, matchesPinyin, MAX_QUERY, parsePinyin, syllablesOf, tatoebaUrl,
} from "./dictionary";

export type DictCall = <T>(fn: string, args: Record<string, unknown>) => Promise<T>;

const LIMIT = 40;
const CACHE_SIZE = 1000;
const CACHE_MS = 6 * 60 * 60_000;

type Unihan = {
  ch: string; pinyin: string[]; definition: string | null; radical: string | null; radical_number: number | null;
  strokes: number | null; simplified: string[]; traditional: string[];
} | null;
type RawCharacter = { character: string; unihan: Unihan; entries: DictSummary[] };
type RawEntry = Omit<DictEntry, "characters" | "sources"> & { characters: RawCharacter[] };
type RawExample = Omit<DictExample, "url" | "source" | "syllables">;

/** Small least-recently-used cache. The data only changes when the dictionary is re-imported. */
export class Cache<T> {
  private map = new Map<string, { at: number; value: Promise<T> }>();
  /** `keep` says whether an answer may be reused; empty answers aren't, in case the data was mid-import. */
  get(key: string, load: () => Promise<T>, keep: (value: T) => boolean = () => true): Promise<T> {
    const hit = this.map.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) {
      this.map.delete(key);
      this.map.set(key, hit);
      return hit.value;
    }
    const value = load();
    this.map.set(key, { at: Date.now(), value });
    value.then((v) => { if (!keep(v)) this.map.delete(key); }, () => this.map.delete(key));
    if (this.map.size > CACHE_SIZE) this.map.delete(this.map.keys().next().value!);
    return value;
  }
}

export const normalizeQuery = (q: string) => q.normalize("NFC").replace(/\s+/g, " ").trim().slice(0, MAX_QUERY);

function character(raw: RawCharacter): DictCharacter {
  const u = raw.unihan;
  return {
    character: raw.character,
    pinyin: u?.pinyin ?? [],
    definition: u?.definition ?? null,
    radical: u?.radical ?? null,
    radicalNumber: u?.radical_number ?? null,
    strokes: u?.strokes ?? null,
    simplified: u?.simplified ?? [],
    traditional: u?.traditional ?? [],
    entries: raw.entries,
    sources: [...(u ? ["unihan" as const] : []), ...(raw.entries.length ? ["cc-cedict" as const] : [])],
  };
}

export function createDictionary(call: DictCall) {
  const searches = new Cache<DictSearch>();
  const entries = new Cache<DictEntry | null>();
  const examples = new Cache<DictExamples>();

  async function searchHanzi(text: string): Promise<DictGroup[]> {
    const han = hanOnly(text);
    const results = await call<DictSummary[]>("search_hanzi", { p_query: han, p_limit: LIMIT });
    const groups: DictGroup[] = [];
    const exact = results.some((r) => r.simplified === han || r.traditional === han);
    if (!exact && [...han].length > 1) {
      const pieces = await call<{ text: string; entries: DictSummary[] }[]>("segment", { p_text: han });
      const words = pieces.filter((p) => p.entries.length);
      if (words.length > 1 || (words.length === 1 && !results.length)) {
        const seen = new Set<number>();
        const list = words.map((p) => p.entries[0]).filter((e) => !seen.has(e.id) && seen.add(e.id));
        groups.push({ kind: "phrase", label: `Words in ${han}`, results: list });
      }
    }
    if (results.length) groups.push({ kind: "hanzi", label: exact ? "Words" : `Starting with ${han}`, results });
    return groups;
  }

  async function searchLatin(text: string): Promise<DictGroup[]> {
    const pinyin = parsePinyin(text);
    const key = englishKey(text);
    const [py, en] = await Promise.all([
      pinyin ? call<DictSummary[]>("search_pinyin", { p_pattern: pinyin.pattern, p_prefix: pinyin.prefix, p_limit: LIMIT }) : Promise.resolve([]),
      // Tone marks or numbers mean it's certainly pinyin, so English is skipped.
      pinyin?.toned ? Promise.resolve([]) : call<DictSummary[]>("search_english", { p_key: key, p_query: text, p_limit: LIMIT }),
    ]);
    let pyGroup: DictGroup | null = py.length ? { kind: "pinyin", label: "Pinyin", results: py } : null;
    if (!pyGroup && pinyin && pinyin.parts.length > 1) {
      const words = await call<DictSummary[]>("segment_pinyin", { p_parts: pinyin.parts });
      if (words.length > 1) pyGroup = { kind: "phrase", label: "Words in this phrase", results: words };
    }
    const enGroup: DictGroup | null = en.length ? { kind: "english", label: "English", results: en } : null;
    // Words like "she", "fan" or "change" are both. Pinyin wins unless only English has a real exact match.
    const pyExact = pinyin ? py.some((r) => matchesPinyin(r, pinyin) && !/^[A-Z]/.test(r.pinyinNumeric)) : false;
    const enExact = en.some((r) => matchesEnglish(r, key));
    const englishFirst = enExact && !pyExact;
    return [englishFirst ? enGroup : pyGroup, englishFirst ? pyGroup : enGroup].filter((g): g is DictGroup => g !== null);
  }

  return {
    search(raw: string): Promise<DictSearch> {
      const query = normalizeQuery(raw);
      if (!query) return Promise.resolve({ query, groups: [] });
      return searches.get(query, async () => ({ query, groups: hasHanChars(query) ? await searchHanzi(query) : await searchLatin(query) }), (r) => r.groups.length > 0);
    },

    entry(id: number): Promise<DictEntry | null> {
      if (!Number.isInteger(id) || id <= 0) return Promise.resolve(null);
      return entries.get(String(id), async () => {
        const raw = await call<RawEntry | null>("entry", { p_id: id });
        if (!raw) return null;
        const characters = raw.characters.map(character);
        return { ...raw, characters, sources: ["cc-cedict", ...(characters.some((c) => c.sources.includes("unihan")) ? ["unihan" as const] : [])] };
      }, (e) => e !== null);
    },

    examples(word: string, offset = 0, limit = 6): Promise<DictExamples> {
      const w = hanOnly(normalizeQuery(word));
      if (!w) return Promise.resolve({ examples: [], hasMore: false });
      return examples.get(`${w}:${offset}:${limit}`, async () => {
        const raw = await call<{ examples: RawExample[]; hasMore: boolean }>("examples", { p_word: w, p_limit: limit, p_offset: offset });
        return {
          hasMore: raw.hasMore,
          examples: raw.examples.map((e) => ({
            ...e, pinyin: e.pinyin ? markPinyinText(e.pinyin) : null, syllables: e.pinyin ? syllablesOf(e.pinyin) : null,
            url: tatoebaUrl(e.id), source: "tatoeba" as const,
          })),
        };
      }, (r) => r.examples.length > 0);
    },

    status: () => call<Record<string, string>>("status", {}),
  };
}

export type Dictionary = ReturnType<typeof createDictionary>;
