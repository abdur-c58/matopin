/**
 * English full-text search over dictionary definitions, in memory. Works like Postgres's english text search did:
 * lowercase words, stopwords dropped, the rest stemmed, and queries read like websearch_to_tsquery ("or", "-word").
 */
import { stemmer } from "stemmer";

const STOPWORDS = new Set((
  "i me my myself we our ours ourselves you your yours yourself yourselves he him his himself she her hers herself it its " +
  "itself they them their theirs themselves what which who whom this that these those am is are was were be been being " +
  "have has had having do does did doing a an the and but if or because as until while of at by for with about against " +
  "between into through during before after above below to from up down in out on off over under again further then once " +
  "here there when where why how all any both each few more most other some such no nor not only own same so than too very " +
  "s t can will just don should now"
).split(" "));

const WORD = /[\p{L}\p{N}]+/gu;

function lexemes(text: string, stems?: Map<string, string>): string[] {
  const out: string[] = [];
  for (const [word] of text.toLowerCase().matchAll(WORD)) {
    if (STOPWORDS.has(word)) continue;
    let stem = stems?.get(word);
    if (stem === undefined) {
      stem = stemmer(word);
      stems?.set(word, stem);
    }
    out.push(stem);
  }
  return out;
}

type Clause = { all: string[]; none: string[] };

function parseQuery(query: string): Clause[] {
  const clauses: Clause[] = [];
  let clause: Clause = { all: [], none: [] };
  for (const m of query.matchAll(/(-?)(?:"([^"]*)"?|(\S+))/g)) {
    const negated = m[1] === "-";
    if (!negated && m[3]?.toLowerCase() === "or") {
      clauses.push(clause);
      clause = { all: [], none: [] };
      continue;
    }
    (negated ? clause.none : clause.all).push(...lexemes(m[2] ?? m[3]));
  }
  clauses.push(clause);
  return clauses.filter((c) => c.all.length);
}

function intersect(lists: number[][]): number[] {
  const [first, ...rest] = [...lists].sort((a, b) => a.length - b.length);
  const sets = rest.map((l) => new Set(l));
  return first.filter((i) => sets.every((s) => s.has(i)));
}

export class EnglishIndex {
  private words = new Map<string, number[]>();
  private keys = new Map<string, number[]>();

  /** Row i is searched by its full `text(i)` and matched exactly by each of `keys(i)`. */
  constructor(count: number, text: (i: number) => string, keys: (i: number) => string[]) {
    const stems = new Map<string, string>();
    for (let i = 0; i < count; i++) {
      for (const lex of new Set(lexemes(text(i), stems))) {
        const list = this.words.get(lex);
        if (list) list.push(i);
        else this.words.set(lex, [i]);
      }
      for (const key of keys(i)) {
        const list = this.keys.get(key);
        if (list) list.push(i);
        else this.keys.set(key, [i]);
      }
    }
  }

  /** Rows with a key exactly equal to `key`, and every row matching `query` as full text (exact ones included). */
  match(key: string, query: string): { exact: Set<number>; rows: number[] } {
    const exact = new Set(this.keys.get(key) ?? []);
    const found = new Set(exact);
    for (const clause of parseQuery(query)) {
      const lists = clause.all.map((lex) => this.words.get(lex) ?? []);
      const excluded = new Set(clause.none.flatMap((lex) => this.words.get(lex) ?? []));
      for (const i of intersect(lists)) if (!excluded.has(i)) found.add(i);
    }
    return { exact, rows: [...found] };
  }
}
