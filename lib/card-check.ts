/** Server-only deck scan: an AI proofread, a dictionary reading check, and a guaranteed fix for garbled fields. */
import { applyRepairs, brokenFields, type CardDraft, type CardIssue, checkRequest, repairRequest, sanitizeIssues } from "./ai";
import { type DictSummary, hanOnly, parsePinyin, spacedPinyin } from "./dictionary";
import { numberedSyllables } from "./dictionary-audio";
import { dictionary } from "./dictionary-route";
import { jaReadingIssues } from "./jdict-check";
import { DEFAULT_LANG, type Lang } from "./lang";
import { generateJson } from "./openai";
import type { CardKind } from "./zige";

/** 一 and 不 change tone with what follows, so either spelling is right. */
const SANDHI = new Set(["一", "不"]);
const split = (s: string) => [s.slice(0, -1), s.slice(-1)] as const;

const sameSyllables = (entry: DictSummary, mine: string[]) => {
  const theirs = numberedSyllables(entry.pinyinNumeric);
  return theirs.length === mine.length && theirs.every((t, i) => split(t)[0] === split(mine[i])[0]);
};

function sameTones(entry: DictSummary, mine: string[], chars: string[]): boolean {
  return numberedSyllables(entry.pinyinNumeric).every((t, i) => {
    const tt = split(t)[1];
    const mt = split(mine[i])[1];
    return tt === mt || tt === "5" || mt === "5" || SANDHI.has(chars[i]);
  });
}

/** "piāoliang" → ["piao1", "liang5"]: joined or spaced, marked or numbered; a syllable without a tone counts as neutral. */
function cardSyllables(reading: string): string[] {
  return parsePinyin(reading)?.parts.map((p) => p.replace(/_$/, "5")) ?? [];
}

/**
 * Compares the tones of each card's pinyin with CC-CEDICT. Only cards whose syllables match an entry are judged, so
 * an unusual spelling or split is left to the AI. `judged` lists those rows, so the AI's view of their pinyin can be
 * set aside. Untoned pinyin and unknown words are left alone too.
 */
export async function readingIssues(rows: CardDraft[]): Promise<{ issues: CardIssue[]; judged: Set<number> }> {
  const issues: CardIssue[] = [];
  const judged = new Set<number>();
  await Promise.all(rows.map(async (row, i) => {
    const term = row.term.trim();
    const chars = [...term];
    if (!term || hanOnly(term) !== term || !row.reading.trim()) return;
    const mine = cardSyllables(row.reading);
    if (mine.length !== chars.length || mine.every((s) => s.endsWith("5"))) return;
    const found = await dictionary.search(term).catch(() => null);
    const entries = (found?.groups ?? []).flatMap((g) => g.results).filter((e) => e.simplified === term || e.traditional === term);
    const comparable = entries.filter((e) => sameSyllables(e, mine));
    if (!comparable.length) return;
    judged.add(i);
    if (comparable.some((e) => sameTones(e, mine, chars))) return;
    const best = comparable[0];
    const value = /\s/.test(row.reading.trim()) ? spacedPinyin(best.pinyinNumeric) : best.pinyin;
    issues.push({ row: i, field: "reading", value, reason: `The dictionary (CC-CEDICT) reads ${term} as ${value}.` });
  }));
  return { issues, judged };
}

export async function checkBatch(key: string, model: string, rows: (CardDraft & { kind: CardKind })[], lang: Lang = DEFAULT_LANG): Promise<CardIssue[]> {
  const spec = checkRequest(rows, lang);
  const [json, dict] = await Promise.all([
    generateJson(key, model, spec.system, spec.user, spec.schema, 120_000, true),
    lang === "ja" ? jaReadingIssues(rows) : readingIssues(rows),
  ]);
  const fromAi = sanitizeIssues(json, rows, lang);
  // The dictionary rules on pinyin wherever it knows the word, unless the AI is changing the word itself.
  const termFixed = new Set(fromAi.filter((i) => i.field === "term").map((i) => i.row));
  const issues = [
    ...fromAi.filter((i) => i.field !== "reading" || termFixed.has(i.row) || !dict.judged.has(i.row)),
    ...dict.issues.filter((i) => !termFixed.has(i.row)),
  ];
  // Garbled fields are always reported, even when the AI overlooked them.
  const covered = new Set(issues.map((i) => `${i.row}:${i.field}`));
  const missed = rows.map((r, row) => ({ row, fields: brokenFields(r, lang).filter((f) => !covered.has(`${row}:${f}`)) })).filter((m) => m.fields.length);
  if (missed.length) {
    const fix = repairRequest(missed.map((m) => ({ ...m, draft: rows[m.row] })), lang);
    const repaired = applyRepairs(rows, await generateJson(key, model, fix.system, fix.user, fix.schema).catch(() => null), lang);
    for (const m of missed) for (const field of m.fields) {
      const value = repaired[m.row][field];
      if (value) issues.push({ row: m.row, field, value, reason: "This field has words from another language mixed in." });
    }
  }
  return issues.sort((a, b) => a.row - b.row);
}
