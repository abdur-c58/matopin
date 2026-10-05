import Papa from "papaparse";
import JSZip from "jszip";
import { toHiragana } from "wanakana";
import { DEFAULT_LANG, furiganaPieces, hasCjk, hasKana, isKanaOnly, isLang, LANG_INFO, type Lang, type RubyPiece } from "./lang";
import { isSyllableAt } from "./pinyin-syllables";
import { conversationVoice, voiceFor, type Voice } from "./voice";

export const CARD_KINDS = ["term", "phrase", "sentence"] as const;
export type CardKind = (typeof CARD_KINDS)[number];
export const CARD_KIND_LABELS: Record<CardKind, string> = { term: "Term", phrase: "Phrase", sentence: "Sentence" };
export const isCardKind = (v: unknown): v is CardKind => CARD_KINDS.includes(v as CardKind);

/** A recording that came with the card (from an Anki package) and the text it was recorded for. Editing that text drops it. */
export type AudioRef = { clip: string; text: string };
export type CardAudio = { word?: AudioRef; example?: AudioRef };
export type Card = {
  id: string; kind: CardKind; term: string; reading: string; meaning: string;
  example: string; exampleReading: string; exampleMeaning: string;
  notes: string; tags: string; audio?: CardAudio;
};
export type CardField = Exclude<keyof Card, "id" | "kind" | "audio">;
/** Stored card recordings are named by a hash of their bytes. */
export const CARD_CLIP = /^[a-f0-9]{40}\.(mp3|ogg|wav|m4a|webm|flac)$/;
export type Notetype = "Basic" | "Basic (and reversed card)";
export const FLUENCY_LEVELS = ["beginner", "elementary", "intermediate", "advanced"] as const;
export type Fluency = (typeof FLUENCY_LEVELS)[number];
export const fluencyLabels = (lang: Lang): Record<Fluency, string> => LANG_INFO[lang].levels;
/** For places that cover every language at once, such as the profile. */
export const FLUENCY_LABELS: Record<Fluency, string> = {
  beginner: "Beginner (HSK 1–2 · N5)",
  elementary: "Elementary (HSK 3 · N4)",
  intermediate: "Intermediate (HSK 4–5 · N3–N2)",
  advanced: "Advanced (HSK 6+ · N1)",
};
export const DEFAULT_FLUENCY: Fluency = "elementary";
export const isFluency = (v: unknown): v is Fluency => FLUENCY_LEVELS.includes(v as Fluency);
/** "profile" means the deck follows the profile's fluency level. Decks saved before languages existed are Mandarin. */
export type Settings = { deck: string; notetype: Notetype; voiceExample: boolean; autoVoice: boolean; fluency: Fluency | "profile"; language: Lang };
export const deckLanguage = (settings: { language?: unknown } | null | undefined): Lang => (isLang(settings?.language) ? settings.language : DEFAULT_LANG);
export type Clip = { blob: Blob; name: string };
export type Clips = Record<string, Clip>;

/** Left-to-right CSV order. The first two columns are required. */
export const CSV_COLUMNS: { header: string; field: CardField }[] = [
  { header: "pinyin", field: "reading" },
  { header: "meaning", field: "meaning" },
  { header: "hanzi", field: "term" },
  { header: "example", field: "example" },
  { header: "notes", field: "notes" },
  { header: "tags", field: "tags" },
  { header: "example_pinyin", field: "exampleReading" },
  { header: "example_translation", field: "exampleMeaning" },
];
/** CSV_COLUMNS with the headers a deck in `lang` uses: hanzi/pinyin or japanese/reading. */
export function csvColumns(lang: Lang): { header: string; field: CardField }[] {
  const names = LANG_INFO[lang].csv;
  return CSV_COLUMNS.map((col) => ({
    field: col.field,
    header: col.field === "term" ? names.term : col.field === "reading" ? names.reading : col.field === "exampleReading" ? names.exampleReading : col.header,
  }));
}
/** What each field is called in a deck of `lang`: Hanzi and Pinyin, or Word and Reading. */
export function fieldLabels(lang: Lang): Record<CardField, string> {
  const info = LANG_INFO[lang];
  return {
    term: info.termLabel, reading: info.readingLabel, meaning: "Meaning", example: "Example",
    exampleReading: `Example ${info.readingLabel.toLowerCase()}`, exampleMeaning: "Example translation", notes: "Notes", tags: "Tags",
  };
}
export const DEFAULT_SETTINGS: Settings = { deck: "Mandarin", notetype: "Basic", voiceExample: false, autoVoice: true, fluency: "profile", language: DEFAULT_LANG };
export const newCard = (): Card => ({
  id: crypto.randomUUID(), kind: "term", term: "", reading: "", meaning: "", example: "", exampleReading: "", exampleMeaning: "", notes: "", tags: "",
});

/** Sentence cards are the example themselves, so they never carry one. */
export const hasExample = (c: Card) => c.kind !== "sentence";

// Breves are a common stand-in for the third-tone caron.
const BREVE_TO_CARON: Record<string, string> = { ă: "ǎ", ĕ: "ě", ĭ: "ǐ", ŏ: "ǒ", ŭ: "ǔ", Ă: "Ǎ", Ĕ: "Ě", Ĭ: "Ǐ", Ŏ: "Ǒ", Ŭ: "Ǔ" };
/** One precomposed character per toned vowel, so tone detection and fonts see ā rather than a + U+0304. */
export const cleanPinyin = (s: string) => s.normalize("NFC").replace(/[ăĕĭŏŭĂĔĬŎŬ]/g, (ch) => BREVE_TO_CARON[ch]);

export function normalizeCard(raw: Partial<Card>): Card {
  const card = { ...newCard(), ...raw };
  if (!card.id) card.id = crypto.randomUUID();
  if (!isCardKind(card.kind)) card.kind = "term";
  for (const col of CSV_COLUMNS) {
    if (typeof card[col.field] !== "string") card[col.field] = "";
  }
  card.reading = cleanPinyin(card.reading);
  card.exampleReading = cleanPinyin(card.exampleReading);
  const word = audioRef(card.audio?.word, card.term);
  const example = audioRef(card.audio?.example, card.example);
  if (word || example) card.audio = { ...(word && { word }), ...(example && { example }) };
  else delete card.audio;
  return card;
}

function audioRef(raw: unknown, text: string): AudioRef | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const { clip, text: said } = raw as Partial<AudioRef>;
  return typeof clip === "string" && CARD_CLIP.test(clip) && typeof said === "string" && said && said === text.trim() ? { clip, text: said } : undefined;
}

const HAN = /[\u3400-\u9fff]/;
export const hasHan = (s: string) => HAN.test(s);

const TONE_MARKS: [string, number][] = [["āēīōūǖ", 1], ["áéíóúǘ", 2], ["ǎěǐǒǔǚ", 3], ["àèìòùǜ", 4]];
export function toneOf(syllable: string): number {
  for (const ch of syllable) for (const [marks, tone] of TONE_MARKS) if (marks.includes(ch)) return tone;
  const digit = syllable.match(/[1-4]/);
  return digit ? Number(digit[0]) : 5;
}

/** Tone marks and numbered tones both count. Plain letters from an English keyboard do not. */
export const hasTone = (s: string) => /[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ1-4]/.test(s);

export type Speaker = "A" | "B";
/** `key` names the clip in a deck (and its Anki export); `text`, `lang` and `voice` are what gets voiced. `clip` is the card's own recording, played instead. */
export type Spoken = { key: string; text: string; speaker: Speaker; lang: Lang; voice: Voice; clip?: string };

const SPEAKER_LINE = /^([AB])\s*[:：]\s*(.*)$/;

/** One sentence, or lines marked A： / B：. At most two speakers. */
export function dialogueTurns(raw: string): { speaker: Speaker; text: string }[] {
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    .flatMap((line) => (SPEAKER_LINE.test(line) ? line.split(/\s*(?<=[\s。？！，.?!,])(?=[AB]\s*[:：])/) : [line]));
  if (!lines.length) return [];
  if (!lines.some((line) => SPEAKER_LINE.test(line))) return [{ speaker: "A", text: raw.trim() }];
  const turns: { speaker: Speaker; text: string }[] = [];
  for (const line of lines) {
    const match = line.match(SPEAKER_LINE);
    if (match?.[2].trim()) turns.push({ speaker: match[1] as Speaker, text: match[2].trim() });
  }
  return turns;
}

export function isConversation(raw: string): boolean {
  return new Set(dialogueTurns(raw).map((turn) => turn.speaker)).size > 1;
}

export function exampleLines(hanzi: string, pinyin: string): { speaker: Speaker; hanzi: string; pinyin: string }[] {
  const turns = dialogueTurns(hanzi);
  const readings = dialogueTurns(pinyin);
  return turns.map((turn, i) => ({
    speaker: turn.speaker,
    hanzi: turn.text,
    pinyin: readings.length === turns.length ? readings[i].text : turns.length === 1 ? pinyin.trim() : "",
  }));
}

/** Speaker B is stored apart from the word clip so the two Fish voices do not overwrite each other. */
export const clipKey = (text: string, speaker: Speaker) => (speaker === "B" ? `B\n${text}` : text);

/** Which text gets voiced: the term, otherwise the first field written in Chinese or Japanese. */
export function target(c: Card): string {
  const term = c.term.trim();
  if (hasCjk(term)) return term;
  const fromExample = dialogueTurns(c.example).map((turn) => turn.text).find(hasCjk);
  return [fromExample, c.meaning, c.reading].find((text) => text && hasCjk(text))?.trim() ?? term;
}

/**
 * `say` is what the voice actually reads. Japanese written only in kanji (学生) gets its kana reading instead, since
 * the voice would otherwise read it as Mandarin. The clip stays keyed by the text on the card.
 */
const spoken = (text: string, speaker: Speaker, lang: Lang, voice: Voice, say = text): Spoken =>
  ({ key: clipKey(text.trim(), speaker), text: say.trim(), speaker, lang, voice });
const kanaFor = (text: string, reading: string) => (!hasKana(text) && reading.trim() && isKanaOnly(reading) ? reading : text);

/** `lang` is the deck's language, so kanji-only Japanese isn't voiced as Mandarin. With `voices` off, only the card's own recordings are spoken. */
export function wordSpoken(c: Card, lang: Lang, voices = true): Spoken[] {
  const own = c.audio?.word;
  if (own && own.text === c.term.trim()) return [{ ...spoken(own.text, "A", lang, voiceFor(own.text)), clip: own.clip }];
  if (!voices) return [];
  const text = c.term.trim() ? target(c) : "";
  return text ? [spoken(text, "A", lang, voiceFor(text), text === c.term.trim() ? kanaFor(text, c.reading) : text)] : [];
}

/** A conversation's two speakers always get different voices (lib/voice.ts). */
export function exampleSpoken(c: Card, lang: Lang, voices = true): Spoken[] {
  if (!hasExample(c)) return [];
  const own = c.audio?.example;
  if (own && own.text === c.example.trim()) return [{ ...spoken(own.text, "A", lang, voiceFor(own.text)), clip: own.clip }];
  if (!voices) return [];
  const conversation = isConversation(c.example);
  return exampleLines(c.example, c.exampleReading).filter((line) => hasCjk(line.hanzi))
    .map((line) => spoken(line.hanzi, line.speaker, lang,
      conversation ? conversationVoice(c.example, line.speaker) : voiceFor(line.hanzi), kanaFor(line.hanzi, line.pinyin)));
}

export function spokenTexts(c: Card, withExample: boolean, lang: Lang, voices = true): Spoken[] {
  const all = [...wordSpoken(c, lang, voices), ...(withExample ? exampleSpoken(c, lang, voices) : [])];
  return all.filter((line, i) => all.findIndex((other) => other.key === line.key) === i);
}

function hash(s: string): string {
  let h = 5381;
  for (const ch of s) h = ((h << 5) + h + ch.codePointAt(0)!) >>> 0;
  return h.toString(16);
}
export const clipName = (text: string) => `matopin_${hash(text)}.mp3`;
const ALIASES: Record<string, CardField> = {
  term: "term", hanzi: "term", chinese: "term", word: "term", front: "term", japanese: "term", kanji: "term", expression: "term", vocab: "term",
  reading: "reading", pinyin: "reading", kana: "reading", furigana: "reading", yomi: "reading",
  meaning: "meaning", english: "meaning", translation: "meaning", back: "meaning",
  example: "example", sentence: "example", notes: "notes", note: "notes", tags: "tags", tag: "tags",
  example_pinyin: "exampleReading", examplepinyin: "exampleReading", example_reading: "exampleReading", examplereading: "exampleReading", example_kana: "exampleReading",
  example_translation: "exampleMeaning", exampletranslation: "exampleMeaning",
};

/** Parsed clipboard or file. Header rows are aligned to CSV_COLUMNS; other rows stay positional. */
export function readCsvTable(text: string): { header: boolean; rows: string[][] } | null {
  // Anki's plain-text export starts with lines such as "#separator:tab".
  const trimmed = text.replace(/^\uFEFF/, "").replace(/^(?:#[a-z ]+:.*(?:\r?\n|$))+/i, "").trim();
  if (!trimmed) return null;
  const data = Papa.parse<string[]>(trimmed, { skipEmptyLines: "greedy" }).data.filter((row) => row.some((cell) => cell.trim()));
  if (!data.length) return null;
  const header = data[0].some((cell) => ALIASES[cell.trim().toLowerCase()]);
  if (!header) return { header: false, rows: data.map((row) => row.map((cell) => cell.trim())) };
  const index = data[0].map((cell) => {
    const field = ALIASES[cell.trim().toLowerCase()];
    return field ? CSV_COLUMNS.findIndex((col) => col.field === field) : -1;
  });
  return {
    header: true,
    rows: data.slice(1).map((row) => {
      const cells = CSV_COLUMNS.map(() => "");
      row.forEach((value, i) => { const dest = index[i]; if (dest >= 0) cells[dest] = value.trim(); });
      return cells;
    }),
  };
}

export function isTablePaste(text: string): boolean {
  const table = readCsvTable(text);
  if (!table) return false;
  return table.header || table.rows.length > 1 || (table.rows[0]?.length ?? 0) > 1;
}

export function sheetToCsv(rows: string[][], lang: Lang = DEFAULT_LANG): string {
  const body = rows.filter((row) => row.some((cell) => cell.trim()));
  if (!body.length) return "";
  return Papa.unparse([csvColumns(lang).map((col) => col.header), ...body], { newline: "\n" });
}

export function parseCsv(text: string): Card[] {
  const table = readCsvTable(text);
  if (!table) return [];
  return table.rows
    .map((row) => {
      const c = newCard();
      CSV_COLUMNS.forEach((col, i) => { c[col.field] = row[i]?.trim() ?? ""; });
      return c;
    })
    .filter((c) => c.reading.trim());
}
export const toCsv = (cards: Card[], lang: Lang = DEFAULT_LANG) =>
  "\ufeff" + csvColumns(lang).map((c) => c.header).join(",") + "\n" + Papa.unparse(cards.map((c) => CSV_COLUMNS.map((col) => c[col.field])), { newline: "\n" }) + "\n";

const html = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\t/g, " ").replace(/\r?\n/g, "<br>");

export type { RubyPiece };

/** Same length as the input: lowercase, tone marks dropped, ü as v. */
function pinyinBase(word: string): string {
  return [...word].map((ch) => {
    const lower = ch.toLowerCase();
    return "ǖǘǚǜü".includes(lower) ? "v" : lower.normalize("NFD").replace(/[\u0300-\u036f]/g, "") || lower;
  }).join("");
}

const searchText = (s: string) => pinyinBase(s).replace(/[\s'’1-5]+/g, "");

/** Case, tone marks, tone numbers, and spaces are ignored, so "nihao" finds nǐ hǎo. Romaji also finds kana. */
export function cardMatches(card: Card, query: string): boolean {
  const q = searchText(query.trim());
  if (!q) return true;
  const kana = /^[a-z' -]+$/i.test(query.trim()) ? toHiragana(query.trim().replace(/[\s']+/g, "")) : "";
  const fields = [card.term, card.reading, card.meaning, card.example, card.exampleReading, card.exampleMeaning, card.notes, card.tags];
  return fields.some((field) => searchText(field).includes(q) || (kana && hasKana(kana) && toHiragana(field, { passRomaji: true }).includes(kana)));
}

/** Split pinyin into exactly `count` syllables, keeping spaces and apostrophes as boundaries. */
export function splitSyllables(pinyin: string, count: number): string[] | null {
  const words = pinyin.split(/[\s'’]+/).map((w) => w.replace(/[^\p{L}1-5]/gu, "")).filter(Boolean);
  if (words.length === count) return words;
  if (words.length > count) return null;
  const bases = words.map(pinyinBase);
  return splitWords(words, bases, count, true) ?? splitWords(words, bases, count, false);
}

/** A syllable carries one tone mark at most, so nǚér can't be nǚé + r. */
const toneMarks = (s: string) => [...s].filter((ch) => /[\u0300\u0301\u0304\u030c]/.test(ch.normalize("NFD"))).length;

function splitWords(words: string[], bases: string[], count: number, strict: boolean): string[] | null {
  const memo = new Map<string, string[] | null>();
  const go = (w: number, pos: number, left: number): string[] | null => {
    if (w === words.length) return left === 0 ? [] : null;
    if (pos === words[w].length) return go(w + 1, 0, left);
    if (left === 0) return null;
    const key = `${w}:${pos}:${left}`;
    if (memo.has(key)) return memo.get(key)!;
    let found: string[] | null = null;
    for (let end = Math.min(words[w].length, pos + 7); end > pos && !found; end--) {
      if (!isSyllableAt(bases[w], pos, end, strict) || toneMarks(words[w].slice(pos, end)) > 1) continue;
      const rest = go(w, end, left - 1);
      if (rest) found = [words[w].slice(pos, end), ...rest];
    }
    memo.set(key, found);
    return found;
  };
  return go(0, 0, count);
}

/** Fewest valid syllables each word splits into, or null when some word is not pinyin. */
function syllableCounts(text: string): number[] | null {
  const words = text.trim().split(/[\s'’]+/).map((w) => w.replace(/[^\p{L}1-5]/gu, "")).filter(Boolean);
  if (!words.length) return null;
  const counts: number[] = [];
  for (const word of words) {
    const base = pinyinBase(word);
    const best: number[] = [0, ...Array<number>(base.length).fill(Infinity)];
    for (let end = 1; end <= base.length; end++) {
      for (let start = Math.max(0, end - 7); start < end; start++) {
        if (best[start] + 1 < best[end] && isSyllableAt(base, start, end, false)) best[end] = best[start] + 1;
      }
    }
    if (!Number.isFinite(best[base.length])) return null;
    counts.push(best[base.length]);
  }
  return counts;
}

export const isPinyin = (text: string) => syllableCounts(text) !== null;

/** Stricter than isPinyin, so ordinary English such as "a long time" is not flagged. */
export function looksLikePinyin(text: string): boolean {
  const counts = syllableCounts(text);
  if (!counts) return false;
  if (hasTone(text)) return true;
  return counts.length === 1 ? counts[0] >= 2 : counts.every((n) => n === 1);
}

/** Pair each character with the syllable above it. Punctuation stays put. A length mismatch keeps the whole pinyin together. */
export function rubyPieces(hanzi: string, pinyin: string): RubyPiece[] {
  const text = hanzi.trim();
  if (!text) return pinyin.trim().split(/\s+/).filter(Boolean).map((py) => ({ py, zi: "" }));
  const chars = [...text];
  if (!pinyin.trim()) return chars.map((zi) => ({ py: "", zi }));
  if (hasKana(pinyin) || hasKana(text)) return furiganaPieces(text, pinyin) ?? [{ py: pinyin.trim(), zi: text }];
  const syllables = splitSyllables(pinyin, chars.filter(hasHan).length);
  if (syllables) {
    let i = 0;
    return chars.map((zi) => (hasHan(zi) ? { py: syllables[i++], zi } : { py: "", zi }));
  }
  return [{ py: pinyin.trim(), zi: text }];
}

export function rubyHtml(hanzi: string, pinyin: string, size: number): string {
  const pySize = Math.max(11, Math.round(size * 0.28));
  const body = rubyPieces(hanzi, pinyin).map((piece) => {
    if (!piece.zi) return `<span style="font-size:${size}px;line-height:1.2">${html(piece.py)}</span>`;
    return `<span style="display:inline-flex;flex-direction:column;align-items:center;vertical-align:bottom;margin:0 0.05em"><span style="font-size:${pySize}px;line-height:1.1;font-weight:500">${piece.py ? html(piece.py) : "&nbsp;"}</span><span style="font-size:${size}px;line-height:1.15">${html(piece.zi)}</span></span>`;
  }).join("");
  return `<span style="display:inline-flex;flex-wrap:wrap;justify-content:center;align-items:flex-end">${body}</span>`;
}

export async function buildExport(cards: Card[], clips: Clips, s: Settings): Promise<{ blob: Blob; name: string; audioCount: number }> {
  const used = new Set<string>();
  const sound = (t: string) => { const c = clips[t]; if (!c) return ""; used.add(t); return `[sound:${c.name}]`; };
  let txt = `#separator:tab\n#html:true\n#notetype:${s.notetype}\n#deck:${s.deck}\n#tags column:3\n`;
  for (const c of cards) {
    let back = "";
    if (c.meaning) back += `<div class="m">${html(c.meaning)}</div>`;
    const a = sound(target(c));
    if (a) back += `<div class="a">${a}</div>`;
    if (hasExample(c) && (c.example.trim() || c.exampleMeaning.trim())) {
      const lines = exampleLines(c.example, c.exampleReading);
      const glosses = dialogueTurns(c.exampleMeaning);
      const conversation = isConversation(c.example);
      back += `<div class="e" style="margin-top:12px">`;
      for (const line of lines) {
        back += `<div style="margin-top:8px;text-align:center">`;
        if (conversation) back += `<span style="font-size:12px;margin-right:6px">${line.speaker}</span>`;
        back += rubyHtml(line.hanzi, line.pinyin, 22);
        back += sound(clipKey(line.hanzi, line.speaker));
        back += `</div>`;
      }
      for (const gloss of glosses) {
        back += `<div style="margin-top:4px;text-align:center">${isConversation(c.exampleMeaning) ? `${gloss.speaker} ` : ""}${html(gloss.text)}</div>`;
      }
      back += `</div>`;
    }
    if (c.notes) back += `<div class="n">${html(c.notes)}</div>`;
    const front = c.term.trim()
      ? `<div style="text-align:center">${rubyHtml(c.term, c.reading, c.kind === "sentence" ? 32 : 56)}</div>`
      : `<div style="text-align:center;font-size:32px">${html(c.reading)}</div>`;
    txt += `${front}\t${back}\t${c.tags.trim().replace(/\t/g, " ")}\n`;
  }
  const safe = s.deck.replace(/[^\w-]+/g, "_") || "deck";
  if (!used.size) return { blob: new Blob([txt], { type: "text/plain" }), name: `${safe}.txt`, audioCount: 0 };
  const zip = new JSZip();
  zip.file(`${safe}.txt`, txt);
  for (const t of used) zip.file(`media/${clips[t].name}`, clips[t].blob);
  return { blob: await zip.generateAsync({ type: "blob" }), name: `${safe}.zip`, audioCount: used.size };
}
