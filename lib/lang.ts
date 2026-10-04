import { toHiragana } from "wanakana";

/** The languages a profile can learn. Decks, the dictionary, voices and AI prompts all follow one of these. */
export const LANGS = ["zh", "ja"] as const;
export type Lang = (typeof LANGS)[number];
export const DEFAULT_LANG: Lang = "zh";
export const isLang = (v: unknown): v is Lang => LANGS.includes(v as Lang);

type LevelLabels = { beginner: string; elementary: string; intermediate: string; advanced: string };

export type LangInfo = {
  /** English name of the language. */
  name: string;
  /** Its own name, and a one-character badge. */
  native: string;
  badge: string;
  /** Labels for the term and reading fields, and the CSV headers that hold them. */
  termLabel: string;
  readingLabel: string;
  csv: { term: string; reading: string; exampleReading: string };
  hints: {
    term: string; phrase: string; sentence: string; reading: string; sentenceReading: string;
    example: string; exampleReading: string; meaning: string;
  };
  levels: LevelLabels;
  /** Default name for a new deck. */
  deckName: string;
  /** Google handwriting and browser speech language codes. */
  handwriting: string;
  speech: string;
  /** Used in AI prompts. */
  promptName: string;
};

export const LANG_INFO: Record<Lang, LangInfo> = {
  zh: {
    name: "Mandarin", native: "中文", badge: "中",
    termLabel: "Hanzi", readingLabel: "Pinyin",
    csv: { term: "hanzi", reading: "pinyin", exampleReading: "example_pinyin" },
    hints: {
      term: "你好", phrase: "没关系", sentence: "我饿了。", reading: "ni hao", sentenceReading: "wo e le",
      example: "One sentence, or:\nA：你好吗？\nB：我很好。", exampleReading: "A：nǐ hǎo ma\nB：wǒ hěn hǎo", meaning: "hello",
    },
    levels: { beginner: "Beginner (HSK 1–2)", elementary: "Elementary (HSK 3)", intermediate: "Intermediate (HSK 4–5)", advanced: "Advanced (HSK 6+)" },
    deckName: "Mandarin", handwriting: "zh_CN", speech: "zh-CN", promptName: "Mandarin Chinese",
  },
  ja: {
    name: "Japanese", native: "日本語", badge: "日",
    termLabel: "Word", readingLabel: "Reading",
    csv: { term: "japanese", reading: "reading", exampleReading: "example_reading" },
    hints: {
      term: "勉強", phrase: "大丈夫", sentence: "お腹が空いた。", reading: "benkyou", sentenceReading: "おなかがすいた",
      example: "One sentence, or:\nA：元気？\nB：うん、元気だよ。", exampleReading: "A：げんき？\nB：うん、げんきだよ。", meaning: "study",
    },
    levels: { beginner: "Beginner (JLPT N5)", elementary: "Elementary (JLPT N4)", intermediate: "Intermediate (JLPT N3–N2)", advanced: "Advanced (JLPT N1)" },
    deckName: "Japanese", handwriting: "ja", speech: "ja-JP", promptName: "Japanese",
  },
};

// Scripts ----------------------------------------------------------------------------------------------------------

const KANA = /[\u3040-\u309f\u30a0-\u30ff\u31f0-\u31ff\uff66-\uff9f]/;
const HAN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u{20000}-\u{3134f}]/u;
/** Kanji plus the marks that behave like one: 々 (repeat), 〆, ヶ. */
const KANJI_LIKE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u{20000}-\u{3134f}々〆ヶ]/u;
const TONED = /[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/;

export const hasKana = (s: string) => KANA.test(s);
export const hasHanChar = (s: string) => HAN.test(s);
/** Chinese or Japanese writing: anything there is to voice. */
export const hasCjk = (s: string) => HAN.test(s) || KANA.test(s);
export const isKanaOnly = (s: string) => /^[\u3040-\u309f\u30a0-\u30ff\u31f0-\u31ff\uff66-\uff9fー・\s、。？！?!.,　]+$/.test(s.trim());

/**
 * Which language a piece of text is in. Kana can only be Japanese and tone-marked pinyin only Mandarin; hanzi alone
 * could be either, so it goes to `fallback`.
 */
export function textLang(text: string, fallback: Lang): Lang {
  if (KANA.test(text)) return "ja";
  if (TONED.test(text)) return "zh";
  return fallback;
}

/** The language a set of cards is clearly written in, or null when they don't say. */
export function detectLanguage(cards: { term?: string; reading?: string; example?: string; exampleReading?: string }[]): Lang | null {
  let ja = 0;
  let zh = 0;
  for (const c of cards) {
    const text = `${c.term ?? ""}${c.reading ?? ""}${c.example ?? ""}${c.exampleReading ?? ""}`;
    if (KANA.test(text)) ja++;
    else if (TONED.test(`${c.reading ?? ""}${c.exampleReading ?? ""}`) || /[a-z]+[1-5]\b/i.test(c.reading ?? "")) zh++;
  }
  if (!ja && !zh) return null;
  return ja >= zh ? "ja" : "zh";
}

// Furigana ---------------------------------------------------------------------------------------------------------

const BRACKET = /[ \u00a0]?([^\s[\]]*)\[([^\]]*)\]/g;

/**
 * Anki's furigana format, 日本語[にほんご]を 勉強[べんきょう]する, split into the plain text and its kana reading. A
 * space only marks where a reading starts. Null when the text has no bracketed readings.
 */
export function parseBracketFurigana(text: string): { text: string; reading: string } | null {
  if (!/[^\s[\]]\[[^\]]+\]/.test(text) || !hasKana(text.replace(/[^[\]]*(\[[^\]]*\])?/g, "$1"))) return null;
  const plain = text.replace(BRACKET, "$1");
  const reading = text.replace(BRACKET, (_, base: string, kana: string) => {
    const run = base.match(/^(.*?)((?:[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff々〆ヶ])+)$/u);
    if (!run) return kana;
    const prefix = run[1];
    return prefix && !hira(kana).startsWith(hira(prefix)) ? prefix + kana : kana;
  });
  return { text: plain.trim(), reading: reading.replace(/[ \u00a0]+/g, "").trim() };
}

export type RubyPiece = { py: string; zi: string };

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function hira(s: string) { return toHiragana(s, { passRomaji: true }); }

/**
 * Lines a kana reading up with the kanji in the text it reads: 食べ物 + たべもの → 食(た)べ物(もの). Kana in the text
 * must match the reading; punctuation and spaces may be missing from it. Null when they don't line up.
 */
export function furiganaPieces(text: string, reading: string): RubyPiece[] | null {
  const runs: { text: string; kind: "kanji" | "kana" | "other" }[] = [];
  for (const ch of text) {
    const kind = KANJI_LIKE.test(ch) ? "kanji" : KANA.test(ch) || ch === "ー" ? "kana" : "other";
    const last = runs[runs.length - 1];
    if (last?.kind === kind) last.text += ch;
    else runs.push({ text: ch, kind });
  }
  if (!runs.some((r) => r.kind === "kanji")) return runs.map((r) => ({ py: "", zi: r.text }));
  const target = hira(reading.normalize("NFC")).replace(/[\s　]+/g, "");
  const pattern = runs.map((r) => {
    if (r.kind === "kanji") return "(.+?)";
    if (r.kind === "kana") return `(${escape(hira(r.text))})`;
    const bare = r.text.replace(/[\s　]+/g, "");
    return bare ? `((?:${escape(bare)})?)` : "()";
  }).join("");
  const match = new RegExp(`^${pattern}$`, "u").exec(target);
  if (!match) return null;
  return runs.map((r, i) => ({ zi: r.text, py: r.kind === "kanji" ? match[i + 1] : "" }));
}
