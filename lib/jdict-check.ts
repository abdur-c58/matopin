/** Server-only: checks Japanese cards' kana readings against JMdict. */
import type { CardDraft, CardIssue } from "./ai";
import { kanaKey } from "./jdict";
import { jdict } from "./jdict-route";
import { hasHanChar, isKanaOnly } from "./lang";

const bare = (s: string) => kanaKey(s).replace(/[\s・　]/g, "");

/**
 * Compares each card's reading with the readings JMdict gives its word. Only cards whose word is in the dictionary
 * are judged; `judged` lists them, so the AI's view of their reading can be set aside.
 */
export async function jaReadingIssues(rows: CardDraft[]): Promise<{ issues: CardIssue[]; judged: Set<number> }> {
  const issues: CardIssue[] = [];
  const judged = new Set<number>();
  const usable = rows.map((r, i) => ({ i, term: r.term.trim(), reading: r.reading.trim() }))
    .filter((r) => r.term && hasHanChar(r.term) && r.reading && isKanaOnly(r.reading));
  if (!usable.length) return { issues, judged };
  const found = await jdict.lookup(usable.map((r) => r.term)).catch(() => null);
  if (!found) return { issues, judged };
  for (const r of usable) {
    const entries = found.get(kanaKey(r.term)) ?? [];
    if (!entries.length) continue;
    judged.add(r.i);
    const readings = new Set(entries.flatMap((e) => [e.reading, ...e.readings]).map(bare));
    if (readings.has(bare(r.reading))) continue;
    const best = entries[0];
    issues.push({ row: r.i, field: "reading", value: best.reading, reason: `The dictionary (JMdict) reads ${r.term} as ${best.reading}.` });
  }
  return { issues, judged };
}
