import { hasCjk, isLang, type Lang } from "./lang";

/**
 * Hover notes for the Chinese and Japanese inside one of Bao's replies. Written alongside the reply
 * (lib/bot-notes-ai.ts), stored with the message (supabase/008_bot_reply_notes.sql) and shown by components/bot-notes.tsx.
 *
 * To add a field: add it here, to the schema and prompt in bot-notes-ai.ts, to `cleanNote` below, and show it in the card.
 * Old messages simply lack it, so every field past `text` must be optional to read.
 */
export const NOTES_VERSION = 1;

export type NoteWord = {
  text: string;
  /** Pinyin with tone marks, or kana. */
  reading: string;
  meaning: string;
  /** Short part of speech or job in the sentence, e.g. "verb", "topic particle", "measure word". */
  role: string;
};

export type Register = "casual" | "neutral" | "polite" | "formal" | "written";
const REGISTERS: Register[] = ["casual", "neutral", "polite", "formal", "written"];

export type Note = {
  /** Exactly as it appears in the reply. */
  text: string;
  lang: Lang;
  reading: string;
  translation: string;
  /** Word for word, when that differs enough from the translation to help. */
  literal: string;
  words: NoteWord[];
  /** One short line on grammar, nuance or usage. */
  tip: string;
  register: Register | "";
};

/** The language a reply teaches, from Bao's answer itself; "mixed" when it covers both. Voices and fonts follow it. */
export type ReplyLang = Lang | "mixed";
const isReplyLang = (v: unknown): v is ReplyLang => isLang(v) || v === "mixed";

export type BotNotes = { v: number; lang: ReplyLang | null; items: Note[] };

const MAX_ITEMS = 40;
const MAX_WORDS = 16;
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

function cleanWord(raw: unknown): NoteWord | null {
  if (!raw || typeof raw !== "object") return null;
  const w = raw as Record<string, unknown>;
  const text = str(w.text, 40);
  if (!text || !hasCjk(text)) return null;
  return { text, reading: str(w.reading, 80), meaning: str(w.meaning, 160), role: str(w.role, 40) };
}

function cleanNote(raw: unknown, body: string): Note | null {
  if (!raw || typeof raw !== "object") return null;
  const n = raw as Record<string, unknown>;
  const text = str(n.text, 300);
  if (!text || !hasCjk(text) || !body.includes(text)) return null;
  const words = Array.isArray(n.words) ? n.words.map(cleanWord).filter((w): w is NoteWord => w !== null).slice(0, MAX_WORDS) : [];
  return {
    text,
    lang: isLang(n.lang) ? n.lang : "zh",
    reading: str(n.reading, 400),
    translation: str(n.translation, 400),
    literal: str(n.literal, 400),
    words,
    tip: str(n.tip, 300),
    register: REGISTERS.includes(n.register as Register) ? (n.register as Register) : "",
  };
}

/** Only notes whose text really is in `body`, longest first so a sentence wins over a word inside it. */
export function cleanNotes(raw: unknown, body: string): BotNotes | null {
  if (!raw || typeof raw !== "object") return null;
  const { items, lang } = raw as { items?: unknown; lang?: unknown };
  const seen = new Set<string>();
  const clean = (Array.isArray(items) ? items : []).map((i) => cleanNote(i, body)).filter((n): n is Note => {
    if (!n || seen.has(n.text)) return false;
    seen.add(n.text);
    return true;
  });
  clean.sort((a, b) => b.text.length - a.text.length);
  const replyLang = isReplyLang(lang) ? lang : null;
  return clean.length || replyLang ? { v: NOTES_VERSION, lang: replyLang, items: clean.slice(0, MAX_ITEMS) } : null;
}
export type Segment = { text: string; note?: Note };

/** Splits `body` into plain runs and noted spans. Each occurrence is matched once; longer notes claim text first. */
export function segmentNotes(body: string, notes: BotNotes | null): Segment[] {
  if (!notes?.items.length) return [{ text: body }];
  const owner: (Note | undefined)[] = new Array(body.length);
  const start = new Set<number>();
  for (const note of notes.items) {
    let from = 0;
    for (;;) {
      const at = body.indexOf(note.text, from);
      if (at < 0) break;
      from = at + note.text.length;
      let free = true;
      for (let i = at; i < from; i++) if (owner[i]) { free = false; break; }
      if (!free) continue;
      for (let i = at; i < from; i++) owner[i] = note;
      start.add(at);
    }
  }
  const out: Segment[] = [];
  let i = 0;
  while (i < body.length) {
    const note = owner[i];
    let j = i + 1;
    while (j < body.length && owner[j] === note && !(note && start.has(j))) j++;
    out.push(note ? { text: body.slice(i, j), note } : { text: body.slice(i, j) });
    i = j;
  }
  return out;
}
