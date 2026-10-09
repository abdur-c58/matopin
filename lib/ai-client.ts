import { type CardDraft, type CardIssue, type SplitGroup, type SplitStyle, type Translation, type WordMatch } from "./ai";
import type { Lang } from "./lang";
import { voiceFor, type Voice } from "./voice";
import type { Card, CardKind, Fluency } from "./cards";

async function readError(res: Response, fallback: string): Promise<string> {
  const data = (await res.json().catch(() => null)) as { error?: string } | null;
  return data?.error || fallback;
}

async function ai<T>(body: Record<string, unknown>, fallback: string): Promise<T> {
  const res = await fetch("/api/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res, fallback));
  return (await res.json()) as T;
}

/** `lang` picks the language's voices; `voice` defaults to the one picked from the text (lib/voice.ts). */
export async function speak(text: string, { lang, voice }: { lang: Lang; voice?: Voice }): Promise<Blob> {
  const res = await fetch("/api/voice", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, lang, voice: voice ?? voiceFor(text) }),
  });
  if (!res.ok) throw new Error(await readError(res, "Could not generate audio."));
  return res.blob();
}

/** Like `speak`, but only a clip that was already voiced: null instead of generating one. */
export async function storedVoice(text: string, { lang, voice }: { lang: Lang; voice?: Voice }): Promise<Blob | null> {
  const res = await fetch("/api/voice", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, lang, voice: voice ?? voiceFor(text), storedOnly: true }),
  });
  return res.status === 200 ? res.blob() : null;
}

export function fillCard(card: Card, tags: string[], level: Fluency, lang: Lang): Promise<{ draft: CardDraft; kind: CardKind }> {
  return ai({ task: "fill", card, tags, level, lang }, "Could not fill this card.");
}

/** `reading` is pinyin for Mandarin and kana or romaji for Japanese. */
export async function lookupWord(reading: string, hint: string, meaning: string, lang: Lang): Promise<WordMatch[]> {
  return (await ai<{ matches: WordMatch[] }>({ task: "lookup", pinyin: reading, hint, meaning, lang }, "Could not look up that word.")).matches;
}

export function cardFromPrompt(prompt: string, tags: string[], level: Fluency, lang: Lang): Promise<{ draft: CardDraft; kind: CardKind }> {
  return ai({ task: "prompt", prompt, tags, level, lang }, "Could not create a card from that prompt.");
}

export async function cardsFromText(text: string, tags: string[], level: Fluency, lang: Lang): Promise<{ draft: CardDraft; kind: CardKind }[]> {
  return (await ai<{ cards: { draft: CardDraft; kind: CardKind }[] }>({ task: "extract", text, tags, level, lang }, "Couldn’t make cards from that.")).cards;
}

/** Groups for splitting a deck; each group's rows are indexes into `cards`. */
export async function splitDeck(cards: Card[], style: SplitStyle, prompt: string, count: number | null, lang: Lang): Promise<SplitGroup[]> {
  const rows = cards.map((c) => ({ term: c.term, reading: c.reading, meaning: c.meaning, kind: c.kind, tags: c.tags }));
  return (await ai<{ groups: SplitGroup[] }>({ task: "split", rows, style, prompt, count, lang }, "Couldn’t split this deck.")).groups;
}

/** Up to CHECK_BATCH cards; each issue's row is the card's index in `cards`. */
export async function checkCards(cards: Card[], lang: Lang): Promise<CardIssue[]> {
  return (await ai<{ issues: CardIssue[] }>({ task: "check", rows: cards, lang }, "Couldn’t check these cards.")).issues;
}

export function translateText(text: string, lang: Lang): Promise<Translation> {
  return ai({ task: "translate", text, lang }, "Couldn’t translate that.");
}

/** Up to CONVERT_BATCH cards from a `from` deck, rewritten as `to` cards in the same order. */
export async function convertCards(cards: Card[], from: Lang, to: Lang, level: Fluency): Promise<{ rows: CardDraft[]; kinds: CardKind[] }> {
  const data = await ai<{ rows: CardDraft[]; kinds: CardKind[] }>({ task: "convert", rows: cards, from, lang: to, level }, "Couldn’t convert these cards.");
  if (!Array.isArray(data.rows) || data.rows.length !== cards.length) throw new Error("The AI returned a different number of cards.");
  return data;
}

export async function formatRows(rows: (CardDraft & { kind?: CardKind })[], level: Fluency, lang: Lang): Promise<{ rows: CardDraft[]; kinds: CardKind[] }> {
  const data = await ai<{ rows: CardDraft[]; kinds: CardKind[] }>({ task: "format", rows, level, lang }, "Could not format these rows.");
  if (!Array.isArray(data.rows) || data.rows.length !== rows.length) throw new Error("The AI returned a different number of rows.");
  return data;
}
