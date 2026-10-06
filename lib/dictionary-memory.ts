/**
 * Dictionary lookups run in memory over the dictionary files (lib/dictionary-files.ts): on the server from R2, and in
 * the browser's offline worker from a downloaded copy. Each lookup answers the way the old matopin_dict_* and
 * matopin_jdict_* SQL functions did, so lib/dictionary-server.ts and lib/jdict-server.ts only see a DictCall. A
 * language's words load on its first lookup and stay; its sentences load on its first example request.
 */
import { type DictSummary, glossKeys, isHan } from "./dictionary";
import type {
  JaKanji, JaSense, JaSentence, JaWord, JaWords, ZhChar, ZhSentence, ZhWord, ZhWords,
} from "./dictionary-files";
import type { DictCall } from "./dictionary-server";
import { EnglishIndex } from "./english-index";
import type { JDictSummary, JSense } from "./jdict";

export class DictionaryNotImported extends Error {}

export type DictSource<W, S> = { words: () => Promise<W | null>; sentences: () => Promise<S | null> };

/** Loads once and keeps the result. A missing file or a failure is tried again on the next call. */
function once<T>(load: () => Promise<T | null>): () => Promise<T | null> {
  let pending: Promise<T | null> | null = null;
  return () => {
    pending ??= load().then(
      (value) => {
        if (value === null) pending = null;
        return value;
      },
      (e) => {
        pending = null;
        throw e;
      },
    );
    return pending;
  };
}

type Args = Record<string, unknown>;
type Cmp = (a: number, b: number) => number;

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const int = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : fallback);
const limit = (v: unknown, fallback: number, max: number) => Math.min(Math.max(int(v, fallback), 1), max);

/** Length in characters, like Postgres's char_length: a surrogate pair counts once. */
function charLength(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0xdc00 || c > 0xdfff) n++;
  }
  return n;
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/** A test for a LIKE pattern: % is any run, _ any one character and \ escapes the next. */
function likeTest(pattern: string): (text: string) => boolean {
  let source = "";
  let literal = "";
  let wildcards = 0;
  let escaped = false;
  for (const ch of pattern) {
    if (escaped || (ch !== "\\" && ch !== "%" && ch !== "_")) {
      source += escapeRegex(ch);
      literal += ch;
      escaped = false;
    } else if (ch === "\\") escaped = true;
    else {
      source += ch === "%" ? "[\\s\\S]*" : "[\\s\\S]";
      wildcards++;
    }
  }
  const inner = `[\\s\\S]*${escapeRegex(literal)}[\\s\\S]*`;
  if (wildcards === 2 && source === inner) return (text) => text.includes(literal);
  const re = new RegExp(`^${source}$`, "u");
  return (text) => re.test(text);
}

/** Rows sorted by a text key, for exact and prefix matches. */
class Sorted {
  private order: Int32Array;
  constructor(count: number, private key: (row: number) => string) {
    this.order = Int32Array.from({ length: count }, (_, i) => i);
    let sorted = true;
    for (let k = 1; k < count && sorted; k++) sorted = key(k - 1) <= key(k);
    if (!sorted) this.order.sort((a, b) => compare(key(a), key(b)));
  }

  private rows(q: string, exact: boolean): number[] {
    let lo = 0;
    let hi = this.order.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.key(this.order[mid]) < q) lo = mid + 1;
      else hi = mid;
    }
    const out: number[] = [];
    for (let k = lo; k < this.order.length; k++) {
      const key = this.key(this.order[k]);
      if (exact ? key !== q : !key.startsWith(q)) break;
      out.push(this.order[k]);
    }
    return out;
  }

  equal = (q: string) => this.rows(q, true);
  prefix = (q: string) => this.rows(q, false);
}

const ranked = (rows: Iterable<number>, rank: (row: number) => number, order: Cmp, max: number) =>
  [...rows].sort((a, b) => rank(a) - rank(b) || order(a, b)).slice(0, max);

/** Distinct characters of `text` in order of first appearance. */
function distinctChars(text: string, keep: (ch: string) => boolean): string[] {
  const out: string[] = [];
  for (const ch of text) if (keep(ch) && !out.includes(ch)) out.push(ch);
  return out;
}

function dispatch(fns: Record<string, (args: Args) => Promise<unknown>>): DictCall {
  return async <T,>(fn: string, args: Args) => {
    const run = fns[fn];
    if (!run) throw new Error(`Unknown dictionary lookup: ${fn}`);
    return (await run(args)) as T;
  };
}

// Mandarin ------------------------------------------------------------------------------------------------------------

function zhData(w: ZhWords) {
  const rows = w.entries;
  let english: EnglishIndex | null = null;
  return {
    meta: w.meta,
    rows,
    summary: (i: number): DictSummary => {
      const e = rows[i];
      return {
        id: e.id, simplified: e.simplified, traditional: e.traditional, pinyin: e.pinyin, pinyinNumeric: e.pinyin_numeric,
        definitions: e.definitions, classifiers: e.classifiers,
      };
    },
    len: Int32Array.from(rows, (e) => charLength(e.simplified)),
    byId: new Map(rows.map((e, i) => [e.id, i])),
    simplified: new Sorted(rows.length, (i) => rows[i].simplified),
    traditional: new Sorted(rows.length, (i) => rows[i].traditional),
    pinyin: new Sorted(rows.length, (i) => rows[i].py_key),
    chars: new Map<string, ZhChar>(w.chars.map((c) => [c.ch, c])),
    english: () => (english ??= new EnglishIndex(rows.length, (i) => rows[i].definitions.join("; "), (i) => [...new Set(rows[i].definitions.flatMap(glossKeys))])),
  };
}
type ZhData = ReturnType<typeof zhData>;

/** Ordinary words before cross-references, then proper nouns never seen in the sentences last, then more frequent and shorter first. */
const zhOrder = (d: ZhData): Cmp => (a, b) => {
  const x: ZhWord = d.rows[a];
  const y: ZhWord = d.rows[b];
  return Number(x.variant) - Number(y.variant) || Number(x.proper && x.freq === 0) - Number(y.proper && y.freq === 0)
    || y.freq - x.freq || d.len[a] - d.len[b] || x.id - y.id;
};

export function createZhCall(source: DictSource<ZhWords, ZhSentence[]>): DictCall {
  const data = once(async () => {
    const words = await source.words();
    return words && zhData(words);
  });
  const sentences = once(source.sentences);
  const need = async () => (await data()) ?? Promise.reject(new DictionaryNotImported());

  const wordRows = (d: ZhData, word: string) => [...new Set([...d.simplified.equal(word), ...d.traditional.equal(word)])];
  const bestThree = (d: ZhData, rows: number[]) => rows.sort(zhOrder(d)).slice(0, 3).map(d.summary);

  return dispatch({
    /** Exact headword matches first, then words that start with the query. */
    async search_hanzi(a) {
      const d = await need();
      const q = str(a.p_query);
      if (!q) return [];
      const rows = new Set([...d.simplified.prefix(q), ...d.traditional.prefix(q)]);
      const rank = (i: number) => (d.rows[i].simplified === q || d.rows[i].traditional === q ? 0 : 1);
      return ranked(rows, rank, zhOrder(d), limit(a.p_limit, 40, 100)).map(d.summary);
    },

    /** p_pattern is numbered pinyin with _ for an unknown tone ("ni_hao_"), p_prefix its literal start ("ni"). */
    async search_pinyin(a) {
      const d = await need();
      const prefix = str(a.p_prefix);
      if (!prefix) return [];
      const whole = likeTest(str(a.p_pattern));
      const start = likeTest(`${str(a.p_pattern)}%`);
      const rows = d.pinyin.prefix(prefix).filter((i) => start(d.rows[i].py_key));
      return ranked(rows, (i) => (whole(d.rows[i].py_key) ? 0 : 1), zhOrder(d), limit(a.p_limit, 40, 100)).map(d.summary);
    },

    /** Entries with a gloss exactly equal to p_key first, then any full-text match on the definitions. */
    async search_english(a) {
      const d = await need();
      const { exact, rows } = d.english().match(str(a.p_key), str(a.p_query));
      return ranked(rows, (i) => (exact.has(i) ? 0 : 1), zhOrder(d), limit(a.p_limit, 40, 100)).map(d.summary);
    },

    /** Splits text into words, longest known word first (up to 8 characters); non-Chinese runs stay together. */
    async segment(a) {
      const d = await need();
      const t = [...str(a.p_text)].slice(0, 200);
      const out: { text: string; entries: DictSummary[] }[] = [];
      let i = 0;
      while (i < t.length) {
        let take = 1;
        if (isHan(t[i])) {
          for (let k = Math.min(8, t.length - i); k > 1; k--) {
            if (wordRows(d, t.slice(i, i + k).join("")).length) { take = k; break; }
          }
        } else {
          while (i + take < t.length && !isHan(t[i + take])) take++;
        }
        const piece = t.slice(i, i + take).join("");
        out.push({ text: piece, entries: isHan(t[i]) ? bestThree(d, wordRows(d, piece)) : [] });
        i += take;
      }
      return out;
    },

    /** The same for pinyin syllables ({wo3, de_, shu1}): the longest run (up to 6) that is a common word. */
    async segment_pinyin(a) {
      const d = await need();
      const parts = strs(a.p_parts);
      const n = Math.min(parts.length, 12);
      const order: Cmp = (x, y) => {
        const e = d.rows[x];
        const f = d.rows[y];
        return Number(e.proper && e.freq === 0) - Number(f.proper && f.freq === 0) || f.freq - e.freq || e.id - f.id;
      };
      const out: DictSummary[] = [];
      let i = 0;
      while (i < n) {
        let take = 1;
        for (let k = Math.min(6, n - i); k >= 1; k--) {
          const pattern = parts.slice(i, i + k).join("");
          const prefix = pattern.split("_")[0];
          if (!prefix) continue;
          const fits = likeTest(pattern);
          const hits = d.pinyin.prefix(prefix).filter((r) => !d.rows[r].variant && (k === 1 || d.rows[r].freq > 0) && fits(d.rows[r].py_key));
          if (hits.length) {
            out.push(d.summary(hits.sort(order)[0]));
            take = k;
            break;
          }
        }
        i += take;
      }
      return out;
    },

    async entry(a) {
      const d = await need();
      const i = d.byId.get(int(a.p_id, 0));
      if (i === undefined) return null;
      const e = d.rows[i];
      const others = new Set([...d.simplified.equal(e.simplified), ...d.traditional.equal(e.traditional)]);
      others.delete(i);
      const related: number[] = [];
      d.rows.forEach((r, k) => {
        if (r.simplified !== e.simplified && r.simplified.includes(e.simplified) && !(r.proper && r.freq === 0) && !r.variant) related.push(k);
      });
      return {
        entry: { ...d.summary(i), frequency: e.freq, proper: e.proper },
        otherReadings: [...others].sort(zhOrder(d)).map(d.summary),
        characters: distinctChars(e.simplified, isHan).map((ch) => ({ character: ch, unihan: d.chars.get(ch) ?? null, entries: bestThree(d, wordRows(d, ch)) })),
        related: related
          .sort((x, y) => d.rows[y].freq - d.rows[x].freq || d.len[x] - d.len[y] || d.rows[x].id - d.rows[y].id)
          .slice(0, 16)
          .map(d.summary),
      };
    },

    /** Sentences where the word is a whole token first, then ones that merely contain it; shorter (but not tiny) first. */
    async examples(a) {
      const w = str(a.p_word);
      const lim = limit(a.p_limit, 6, 30);
      const offset = Math.max(int(a.p_offset, 0), 0);
      if (!w) return { examples: [], hasMore: false };
      const list = await sentences();
      if (!list) throw new DictionaryNotImported();
      const hits: { s: ZhSentence; rank: number; len: number }[] = [];
      for (const s of list) {
        const rank = s.tokens.includes(w) ? 0 : s.simplified.includes(w) ? 1 : -1;
        if (rank >= 0) hits.push({ s, rank, len: charLength(s.simplified) });
      }
      hits.sort((x, y) => x.rank - y.rank || Number(x.len < 4) - Number(y.len < 4) || x.len - y.len || x.s.id - y.s.id);
      return {
        examples: hits.slice(offset, offset + lim).map(({ s }) => ({
          id: s.id, simplified: s.simplified, traditional: s.traditional, pinyin: s.pinyin, english: s.english, englishId: s.english_id, tokens: s.tokens,
        })),
        hasMore: hits.length > offset + lim,
      };
    },

    status: async () => (await data())?.meta ?? {},
  });
}

// Japanese ------------------------------------------------------------------------------------------------------------

const NONE: string[] = [];

/** Fills the lists left out of the file back in, for the entry page. */
const fullSense = (s: JaSense): JSense => ({
  pos: s.pos, glosses: s.glosses, info: s.info ?? NONE, misc: s.misc ?? NONE, field: s.field ?? NONE, dialect: s.dialect ?? NONE,
  kanji: s.kanji ?? NONE, kana: s.kana ?? NONE,
});

function jaData(w: JaWords) {
  const rows = w.entries;
  // Tag lists repeat across thousands of senses ("noun (common) (futsuumeishi)"), so equal ones share one array.
  const lists = new Map<string, string[]>();
  const share = (list: string[] | undefined) => {
    if (!list?.length) return list;
    const key = list.join("\u0000");
    const hit = lists.get(key);
    if (hit) return hit;
    lists.set(key, list);
    return list;
  };
  for (const e of rows) {
    e.pos_codes = share(e.pos_codes)!;
    for (const s of e.senses) {
      s.pos = share(s.pos)!;
      s.misc = share(s.misc);
      s.field = share(s.field);
      s.dialect = share(s.dialect);
    }
  }
  const byId = new Map(rows.map((e, i) => [e.id, i]));
  let english: EnglishIndex | null = null;
  const glosses = (i: number) => rows[i].senses.flatMap((s) => s.glosses);
  return {
    meta: w.meta,
    rows,
    summary: (i: number): JDictSummary => {
      const e = rows[i];
      return {
        id: e.id, headword: e.headword, reading: e.reading, forms: e.forms ?? NONE, readings: e.readings ?? NONE, common: e.common,
        posCodes: e.pos_codes, senses: e.senses.slice(0, 4).map((s) => ({ pos: s.pos, glosses: s.glosses })),
      };
    },
    hlen: Int32Array.from(rows, (e) => charLength(e.headword)),
    byId,
    formText: w.forms,
    forms: new Sorted(w.forms.length, (p) => w.forms[p]),
    /** The entry row of each form, -1 when the entry is missing. */
    formRow: Int32Array.from(w.formIds, (id) => byId.get(id) ?? -1),
    kanji: new Map<string, JaKanji>(w.kanji.map((k) => [k.ch, k])),
    examples: new Map(Object.entries(w.examples).map(([id, list]) => [Number(id), new Set(list)])),
    common: rows.flatMap((e, i) => (e.common ? [i] : [])),
    english: () => (english ??= new EnglishIndex(rows.length, (i) => glosses(i).join("; "), (i) => [...new Set(glosses(i).flatMap(glossKeys))])),
  };
}
type JaData = ReturnType<typeof jaData>;

/** Common words first, then more frequent, then shorter headwords. */
const jaOrder = (d: JaData): Cmp => (a, b) => {
  const x: JaWord = d.rows[a];
  const y: JaWord = d.rows[b];
  return Number(!x.common) - Number(!y.common) || y.freq - x.freq || d.hlen[a] - d.hlen[b] || x.id - y.id;
};

export function createJaCall(source: DictSource<JaWords, JaSentence[]>): DictCall {
  const data = once(async () => {
    const words = await source.words();
    return words && jaData(words);
  });
  const sentences = once(source.sentences);
  const need = async () => (await data()) ?? Promise.reject(new DictionaryNotImported());
  const formRows = (d: JaData, positions: number[]) => [...new Set(positions.map((p) => d.formRow[p]).filter((r) => r >= 0))];

  return dispatch({
    /** p_query is already katakana-free (lib/jdict.ts kanaKey). Exact forms first, then forms that start with it. */
    async search(a) {
      const d = await need();
      const q = str(a.p_query);
      if (!q) return [];
      const rank = new Map<number, number>();
      for (const p of d.forms.prefix(q)) {
        const row = d.formRow[p];
        if (row < 0) continue;
        const r = d.formText[p] === q ? 0 : 1;
        if ((rank.get(row) ?? 2) > r) rank.set(row, r);
      }
      return ranked(rank.keys(), (i) => rank.get(i)!, jaOrder(d), limit(a.p_limit, 40, 100)).map(d.summary);
    },

    /** Exact matches for many forms at once, the best five entries for each: [{"form": "たべる", "entries": [...]}]. */
    async lookup(a) {
      const d = await need();
      const order: Cmp = (x, y) => Number(!d.rows[x].common) - Number(!d.rows[y].common) || d.rows[y].freq - d.rows[x].freq || d.rows[x].id - d.rows[y].id;
      return [...new Set(strs(a.p_forms).slice(0, 4000))].flatMap((form) => {
        const rows = formRows(d, d.forms.equal(form));
        return rows.length ? [{ form, entries: rows.sort(order).slice(0, 5).map(d.summary) }] : [];
      });
    },

    /** Entries with a gloss exactly equal to p_key first, then any full-text match on the meanings. */
    async search_english(a) {
      const d = await need();
      const { exact, rows } = d.english().match(str(a.p_key), str(a.p_query));
      return ranked(rows, (i) => (exact.has(i) ? 0 : 1), jaOrder(d), limit(a.p_limit, 40, 100)).map(d.summary);
    },

    async entry(a) {
      const d = await need();
      const i = d.byId.get(int(a.p_id, 0));
      if (i === undefined) return null;
      const e = d.rows[i];
      return {
        entry: {
          ...d.summary(i),
          kanjiForms: e.kanji.map((k) => ({ text: k.text, common: k.common, tags: k.tags ?? NONE })),
          kanaForms: e.kana.map((k) => ({ text: k.text, common: k.common, tags: k.tags ?? NONE, kanji: k.kanji ?? NONE })),
          allSenses: e.senses.map(fullSense),
          frequency: e.freq,
        },
        kanji: distinctChars(e.headword, (ch) => d.kanji.has(ch)).map((ch) => d.kanji.get(ch)!),
        related: d.common
          .filter((k) => k !== i && d.rows[k].headword.includes(e.headword))
          .sort((x, y) => d.rows[y].freq - d.rows[x].freq || d.hlen[x] - d.hlen[y] || d.rows[x].id - d.rows[y].id)
          .slice(0, 16)
          .map(d.summary),
      };
    },

    /**
     * JMdict's own examples for the entry first, then sentences with one of its exact forms (p_exact), then ones
     * matching p_patterns (LIKE patterns for its conjugated forms). Shorter (but not tiny) sentences first.
     */
    async examples(a) {
      const d = await need();
      const lim = limit(a.p_limit, 6, 30);
      const offset = Math.max(int(a.p_offset, 0), 0);
      const linked = d.examples.get(int(a.p_id, 0)) ?? new Set<number>();
      const exact = strs(a.p_exact).filter((x) => x !== "");
      const patterns = strs(a.p_patterns).map(likeTest);
      const list = await sentences();
      if (!list) throw new DictionaryNotImported();
      const hits: { s: JaSentence; rank: number; len: number }[] = [];
      for (const s of list) {
        const rank = linked.has(s.id) ? 0 : exact.some((x) => s.japanese.includes(x)) ? 1 : patterns.some((fits) => fits(s.japanese)) ? 2 : -1;
        if (rank >= 0) hits.push({ s, rank, len: charLength(s.japanese) });
      }
      hits.sort((x, y) => x.rank - y.rank || Number(x.len < 4) - Number(y.len < 4) || x.len - y.len || x.s.id - y.s.id);
      return {
        examples: hits.slice(offset, offset + lim).map(({ s }) => ({ id: s.id, japanese: s.japanese, furigana: s.furigana, english: s.english })),
        hasMore: hits.length > offset + lim,
      };
    },

    status: async () => (await data())?.meta ?? {},
  });
}
