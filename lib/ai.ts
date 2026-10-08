import { DEFAULT_LANG, isKanaOnly, LANG_INFO, type Lang } from "./lang";
import { CARD_KINDS, type Card, type CardField, type CardKind, type Fluency, hasExample, hasTone, isCardKind, isConversation } from "./cards";

export type WordMatch = { hanzi: string; pinyin: string; meaning: string; kind?: CardKind };
export type CardDraft = Record<CardField, string>;

export function splitTags(s: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of s.split(/[\s,]+/)) {
    const tag = part.trim().toLowerCase().replace(/[^\p{L}\p{N}_-]+/gu, "");
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}

export function uniqueTags(tags: string[]): string[] {
  return splitTags(tags.join(" "));
}

const fillable = (c: Card) => (hasExample(c)
  ? (["term", "meaning", "example", "exampleReading", "exampleMeaning", "notes", "tags"] as const)
  : (["term", "meaning", "notes", "tags"] as const));

/**
 * Mandarin words need pinyin to pin down the word; a sentence can start from hanzi or English too. Japanese words are
 * pinned down by their written form as well as their reading.
 */
export function canFill(c: Pick<Card, "kind" | "term" | "reading" | "meaning">, lang: Lang = DEFAULT_LANG): boolean {
  if (lang === "ja") return Boolean(c.reading?.trim() || c.term?.trim() || (c.kind === "sentence" && c.meaning?.trim()));
  return Boolean(c.reading?.trim() || (c.kind === "sentence" && (c.term?.trim() || c.meaning?.trim())));
}

export function needsFill(c: Card): boolean {
  return fillable(c).some((f) => !c[f].trim());
}

export function sanitizeDraft(raw: Partial<CardDraft> | null | undefined): CardDraft {
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  return {
    term: str(raw?.term),
    reading: str(raw?.reading),
    meaning: str(raw?.meaning),
    example: str(raw?.example),
    exampleReading: str(raw?.exampleReading),
    exampleMeaning: str(raw?.exampleMeaning),
    notes: str(raw?.notes),
    tags: splitTags(str(raw?.tags)).slice(0, 3).join(" "),
  };
}

/** Letters from any script but Latin and Han, e.g. a stray Hindi or Russian word the model slipped in. */
const FOREIGN = /(?![\p{Script=Latin}\p{Script=Han}])\p{L}/u;
/** The same for Japanese, where kana belong too. ー is a letter in no script. */
const FOREIGN_JA = /(?![\p{Script=Latin}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー])\p{L}/u;
const HAN_CHAR = /\p{Script=Han}/u;
const KANA_CHAR = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
const garbled = (v: string) => FOREIGN.test(v);
const notLatin = (v: string) => FOREIGN.test(v) || HAN_CHAR.test(v);
const garbledJa = (v: string) => FOREIGN_JA.test(v);
const notLatinJa = (v: string) => FOREIGN.test(v) || HAN_CHAR.test(v);
/** A kana reading: no kanji, and no letters from a third script. */
const notKana = (v: string) => FOREIGN_JA.test(v) || HAN_CHAR.test(v);
/** Meanings and notes may name a related word; translations and readings never contain hanzi. */
const FIELD_CHECKS: Record<Lang, Record<CardField, (v: string) => boolean>> = {
  zh: {
    term: garbled, reading: notLatin, meaning: garbled,
    example: garbled, exampleReading: notLatin, exampleMeaning: notLatin,
    notes: garbled, tags: () => false,
  },
  ja: {
    term: garbledJa, reading: notKana, meaning: garbledJa,
    example: garbledJa, exampleReading: notKana, exampleMeaning: (v) => notLatinJa(v) || KANA_CHAR.test(v),
    notes: garbledJa, tags: () => false,
  },
};

/** Fields that came back in the wrong script. */
export function brokenFields(draft: CardDraft, lang: Lang = DEFAULT_LANG): CardField[] {
  const checks = FIELD_CHECKS[lang];
  return (Object.keys(checks) as CardField[]).filter((f) => draft[f] && checks[f](draft[f]));
}

const REPAIRABLE = ["term", "reading", "meaning", "example", "exampleReading", "exampleMeaning", "notes"] as const;

const REPAIR_SYSTEM: Record<Lang, string> = {
  zh:
    "Some Mandarin flashcard fields came back garbled, with words from the wrong language mixed in. Reply with JSON only. " +
    "Rewrite only the fields listed after rewrite:, keeping the meaning the rest of the card gives. " +
    "meaning, exampleMeaning, and notes are plain English; exampleMeaning has no Chinese characters at all. " +
    "reading and exampleReading are Hanyu Pinyin with tone marks only, one space-separated syllable per Chinese character. " +
    "term and example are simplified Chinese. exampleReading and exampleMeaning copy the example's line breaks and A：/B： labels.",
  ja:
    "Some Japanese flashcard fields came back garbled, with words from the wrong language mixed in. Reply with JSON only. " +
    "Rewrite only the fields listed after rewrite:, keeping the meaning the rest of the card gives. " +
    "meaning, exampleMeaning, and notes are plain English; exampleMeaning has no Japanese characters at all. " +
    "reading and exampleReading are the full reading in hiragana (katakana words may stay katakana), with no kanji and no romaji. " +
    "term and example are natural Japanese in kanji and kana. exampleReading and exampleMeaning copy the example's line breaks and A：/B： labels.",
};

/** One request that rewrites only the garbled fields of the given drafts. */
export function repairRequest(items: { row: number; draft: CardDraft; fields: CardField[] }[], lang: Lang = DEFAULT_LANG) {
  const body = items.map(({ row, draft, fields }) => {
    const lines = REPAIRABLE.filter((f) => draft[f]).map((f) => `${f}: ${draft[f]}`);
    return `#${row}\n${lines.join("\n")}\nrewrite: ${fields.join(", ")}`;
  }).join("\n\n");
  return {
    system: REPAIR_SYSTEM[lang],
    user: `Fix these cards.\n\n${body}`,
    schema: {
      type: "object",
      properties: {
        fixes: {
          type: "array",
          items: {
            type: "object",
            properties: { row: { type: "integer" }, field: { type: "string", enum: [...REPAIRABLE] }, value: { type: "string" } },
            required: ["row", "field", "value"],
            additionalProperties: false,
          },
        },
      },
      required: ["fixes"],
      additionalProperties: false,
    },
  };
}

/** Applies the fixes that pass the check, and blanks whatever is still garbled so it can be filled again. */
export function applyRepairs(drafts: CardDraft[], raw: unknown, lang: Lang = DEFAULT_LANG): CardDraft[] {
  const fixes = raw && typeof raw === "object" && Array.isArray((raw as { fixes?: unknown }).fixes) ? (raw as { fixes: unknown[] }).fixes : [];
  const out = drafts.map((d) => ({ ...d }));
  for (const fix of fixes) {
    const { row, field, value } = (fix ?? {}) as { row?: unknown; field?: unknown; value?: unknown };
    if (typeof row !== "number" || !out[row] || typeof value !== "string" || !(REPAIRABLE as readonly unknown[]).includes(field)) continue;
    const f = field as CardField;
    if (brokenFields(out[row], lang).includes(f) && !FIELD_CHECKS[lang][f](value.trim())) out[row][f] = value.trim();
  }
  for (const d of out) for (const f of brokenFields(d, lang)) d[f] = "";
  return out;
}

export const CHECK_BATCH = 20;
export type CardIssue = { row: number; field: CardField; value: string; reason: string };
const CHECKABLE = ["term", "reading", "meaning", "example", "exampleReading", "exampleMeaning", "notes"] as const;

const CHECK_SYSTEM: Record<Lang, string> = {
  zh:
    "You proofread a learner's Mandarin flashcards. Reply with JSON only. Report only clear, objective mistakes that would teach the learner something wrong. " +
    "A mistake is: reading with wrong syllables or tones for term; term with a wrong character (a typo or homophone) for its reading and meaning; " +
    "meaning that is wrong for the word; an example that does not use the word or is ungrammatical; exampleReading whose syllables or tones do not match the example's characters; " +
    "exampleMeaning that mistranslates the example, skips part of it, or mixes in another language; notes that state something false; any field listed after garbled:. " +
    "Not mistakes, never report these: style or wording preferences, a more natural alternative to correct Chinese, British or American spelling, " +
    "capitalisation, pinyin spacing or word grouping, punctuation, tone-sandhi spellings of 一 and 不 (either citation or changed tone is fine), and neutral-tone variants such as péngyou or péngyǒu. " +
    "When unsure, leave it out. Most cards are correct, and an empty list is a good answer. " +
    "For each mistake, value is the whole corrected field, changing only what is wrong and keeping the rest, its line breaks, and its A：/B： labels. " +
    "If you correct term to a different word, also correct reading, and exampleReading if the example changes. reason is one short English sentence naming the mistake.",
  ja:
    "You proofread a learner's Japanese flashcards. Reply with JSON only. Report only clear, objective mistakes that would teach the learner something wrong. " +
    "A mistake is: reading with the wrong kana for term (a wrong on/kun reading, a missing or wrong rendaku, a wrong long vowel or small っ); term with a wrong kanji (a typo or homophone) for its reading and meaning; " +
    "meaning that is wrong for the word; an example that does not use the word or is ungrammatical; exampleReading whose kana do not match the example; " +
    "exampleMeaning that mistranslates the example, skips part of it, or mixes in another language; notes that state something false; any field listed after garbled:. " +
    "Not mistakes, never report these: style or wording preferences, a more natural alternative to correct Japanese, writing a word in kana instead of kanji or the reverse, okurigana variants, " +
    "British or American spelling, capitalisation, spacing, punctuation, hiragana versus katakana in a reading, and pitch accent. " +
    "When unsure, leave it out. Most cards are correct, and an empty list is a good answer. " +
    "For each mistake, value is the whole corrected field, changing only what is wrong and keeping the rest, its line breaks, and its A：/B： labels. " +
    "If you correct term to a different word, also correct reading, and exampleReading if the example changes. reason is one short English sentence naming the mistake.",
};

/** Proofreads a batch of saved cards and reports only clear mistakes, each as a whole corrected field. */
export function checkRequest(rows: (CardDraft & { kind: CardKind })[], lang: Lang = DEFAULT_LANG) {
  const body = rows.map((row, i) => {
    const fields = CHECKABLE.filter((f) => row[f].trim() && (row.kind !== "sentence" || !f.startsWith("example")));
    const broken = brokenFields(row, lang);
    const garbledNote = broken.length ? `\ngarbled: ${broken.join(", ")}` : "";
    return `#${i}\nkind: ${row.kind}\n${fields.map((f) => `${f}: ${row[f].trim()}`).join("\n")}${garbledNote}`;
  }).join("\n\n");
  return {
    system: CHECK_SYSTEM[lang],
    user: `Check these ${rows.length} cards. row is the card's # number.\n\n${body}`,
    schema: {
      type: "object",
      properties: {
        issues: {
          type: "array",
          items: {
            type: "object",
            properties: { row: { type: "integer" }, field: { type: "string", enum: [...CHECKABLE] }, value: { type: "string" }, reason: { type: "string" } },
            required: ["row", "field", "value", "reason"],
            additionalProperties: false,
          },
        },
      },
      required: ["issues"],
      additionalProperties: false,
    },
  };
}

const sameText = (a: string, b: string) => a.normalize("NFC").replace(/\s+/g, " ").trim() === b.normalize("NFC").replace(/\s+/g, " ").trim();

/** Keeps one fix per field that really changes it and passes the script check. */
export function sanitizeIssues(raw: unknown, rows: CardDraft[], lang: Lang = DEFAULT_LANG): CardIssue[] {
  const list = raw && typeof raw === "object" && Array.isArray((raw as { issues?: unknown }).issues) ? (raw as { issues: unknown[] }).issues : [];
  const seen = new Set<string>();
  const out: CardIssue[] = [];
  for (const item of list) {
    const { row, field, value, reason } = (item ?? {}) as Record<string, unknown>;
    if (typeof row !== "number" || !rows[row] || typeof value !== "string" || !(CHECKABLE as readonly unknown[]).includes(field)) continue;
    const f = field as CardField;
    const next = value.trim();
    if (!next || sameText(next, rows[row][f]) || FIELD_CHECKS[lang][f](next) || seen.has(`${row}:${f}`)) continue;
    seen.add(`${row}:${f}`);
    out.push({ row, field: f, value: next, reason: typeof reason === "string" ? reason.trim().slice(0, 240) : "" });
  }
  return out;
}

/**
 * Copy only empty fields. When the term was missing, a reading typed on an English keyboard is replaced by the
 * standard one: toned pinyin, or kana for romaji.
 */
export function applyDraft(card: Card, draft: CardDraft, lang: Lang = DEFAULT_LANG): Card {
  const next = { ...card };
  for (const field of fillable(card)) {
    if (!next[field].trim() && draft[field].trim()) next[field] = draft[field].trim();
  }
  const typed = lang === "ja" ? isKanaOnly(card.reading) : hasTone(card.reading);
  if (!card.term.trim() && card.reading.trim() && !typed && draft.reading.trim()) next.reading = draft.reading.trim();
  if (lang === "ja" && card.reading.trim() && !isKanaOnly(card.reading) && draft.reading.trim() && isKanaOnly(draft.reading)) next.reading = draft.reading.trim();
  if (!card.reading.trim() && draft.reading.trim()) next.reading = draft.reading.trim();
  return next;
}

export function sanitizeMatches(raw: unknown): WordMatch[] {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();
  const out: WordMatch[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const hanzi = typeof row.hanzi === "string" ? row.hanzi.trim() : "";
    const pinyin = typeof row.pinyin === "string" ? row.pinyin.trim() : "";
    const meaning = typeof row.meaning === "string" ? row.meaning.trim() : "";
    if (!hanzi || !pinyin || !meaning) continue;
    const key = `${hanzi}\u0001${pinyin}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ hanzi, pinyin, meaning, ...(isCardKind(row.kind) ? { kind: row.kind } : {}) });
    if (out.length === 20) break;
  }
  return out;
}

const LEVEL_GUIDE: Record<Lang, Record<Fluency, string>> = {
  zh: {
    beginner:
      "The learner is a beginner (HSK 1–2). Apart from the target word, use only the most basic words. " +
      "Keep each line to about 4–8 characters with a plain subject-verb-object pattern. No idioms, no complements, no 把 or 被.",
    elementary:
      "The learner is elementary (HSK 3). Apart from the target word, stay within common everyday words. " +
      "Keep each line to about 8–12 characters. Simple 了, 过, measure words, and basic connectors are fine.",
    intermediate:
      "The learner is intermediate (HSK 4–5). Use natural everyday vocabulary and lines of about 12–20 characters. " +
      "Result and direction complements, 把, 被, and connectors such as 虽然…但是 are welcome when they sound natural.",
    advanced:
      "The learner is advanced (HSK 6+). Write the way a native speaker really talks, at natural length (up to about 30 characters a line). " +
      "Rich vocabulary, colloquial phrasing, and a chengyu or slang word are welcome when they fit.",
  },
  ja: {
    beginner:
      "The learner is a beginner (JLPT N5). Apart from the target word, use only the most basic words and kanji. " +
      "Keep each line to about 5–10 characters. Plain present, past, negative, and ～て forms only; no conditionals, passives, or causatives.",
    elementary:
      "The learner is elementary (JLPT N4). Apart from the target word, stay within common everyday words. " +
      "Keep each line to about 8–15 characters. ～たい, ～ている, ～から, ～けど, and simple potential forms are fine.",
    intermediate:
      "The learner is intermediate (JLPT N3–N2). Use natural everyday vocabulary and lines of about 12–25 characters. " +
      "Conditionals (～たら, ～ば), passives, causatives, ～そう, and ～らしい are welcome when they sound natural.",
    advanced:
      "The learner is advanced (JLPT N1). Write the way a native speaker really talks, at natural length (up to about 35 characters a line). " +
      "Rich vocabulary, casual contractions such as ～ちゃう and ～てる, and a yojijukugo or slang word are welcome when they fit.",
  },
};

function exampleGuide(level: Fluency, lang: Lang) {
  return `${EXAMPLE_GUIDE[lang]}Match the example to the learner's level. ${LEVEL_GUIDE[lang][level]} `;
}

/** Models left to choose almost always write one sentence, so the shape of a new example is picked here. */
const DIALOGUE_SHARE = 0.4;
export const pickDialogue = () => Math.random() < DIALOGUE_SHARE;

function exampleStyle(dialogue: boolean) {
  return dialogue
    ? "If you write a new example, make it a short two-line conversation: the first line starts with A：, the second with B：, and the word appears in at least one line. "
    : "If you write a new example, make it one sentence with no speaker labels. ";
}

const KIND_RULE: Record<Lang, string> = {
  zh:
    "kind classifies the card. term is a single word, including compounds such as 朋友 or 世界. " +
    "phrase is a multi-word expression or set phrase that is not a full sentence, such as 没关系 or 一路顺风. " +
    "sentence is a complete thing to say that stands alone, such as 我饿了. " +
    "Judge from the Chinese itself and correct the learner's choice when it is wrong. ",
  ja:
    "kind classifies the card. term is a single word, including compounds such as 友達 or 世界 and verbs or adjectives in dictionary form. " +
    "phrase is a multi-word expression or set phrase that is not a full sentence, such as 気をつけて or お疲れ様です. " +
    "sentence is a complete thing to say that stands alone, such as お腹が空いた. " +
    "Judge from the Japanese itself and correct the learner's choice when it is wrong. ",
};

const EXAMPLE_GUIDE: Record<Lang, string> = {
  zh:
    "Always include an example. If the learner left it blank, write one. " +
    "Use casual day-to-day spoken Mandarin, the way friends talk: loose and ordinary. " +
    "No 您, no speeches, no news style, and no stiff textbook lines. Particles such as 啊, 吧, 呢, and 嘛 are fine when they sound natural. " +
    "example is one sentence in simplified hanzi, or a two-line chat between at most two people. " +
    "A conversation is one turn per line, and every line starts with A： or B：. Never add a third speaker. " +
    "If the learner already wrote one sentence, keep one sentence. If they already wrote an A：/B： conversation, keep both speakers. Do not turn a sentence into a conversation or a conversation into a sentence. " +
    "If their wording is formal, ease it into casual speech without changing the situation. " +
    "A single sentence has no speaker label. " +
    "exampleReading copies the same line breaks and A：/B： labels. After a label, write one space-separated pinyin syllable per Chinese character on that line, and no syllable for punctuation or for the label. " +
    "exampleMeaning copies the same line breaks and labels, with a short English translation of each line. ",
  ja:
    "Always include an example. If the learner left it blank, write one. " +
    "Use casual day-to-day spoken Japanese, the way friends talk: plain form, loose and ordinary. " +
    "No keigo or です/ます unless the word itself is polite, no speeches, no news style, and no stiff textbook lines. Sentence-ending particles such as よ, ね, よね, and じゃん are fine when they sound natural. " +
    "example is one sentence in natural Japanese with kanji and kana, or a two-line chat between at most two people. " +
    "A conversation is one turn per line, and every line starts with A： or B：. Never add a third speaker. " +
    "If the learner already wrote one sentence, keep one sentence. If they already wrote an A：/B： conversation, keep both speakers. Do not turn a sentence into a conversation or a conversation into a sentence. " +
    "If their wording is formal, ease it into casual speech without changing the situation. " +
    "A single sentence has no speaker label. " +
    "exampleReading copies the same line breaks and A：/B： labels. After a label, write the full reading of that line in hiragana (katakana words may stay katakana), keeping its punctuation, with no spaces, no kanji, and no romaji. " +
    "exampleMeaning copies the same line breaks and labels, with a short English translation of each line. ",
};

function cardSchema(lang: Lang) {
  const zh = lang === "zh";
  return {
    type: "object",
    properties: {
      term: { type: "string", description: zh ? "Simplified hanzi only" : "Japanese as normally written, in kanji and kana" },
      reading: { type: "string", description: zh ? "Pinyin with tone marks" : "Full reading in hiragana (katakana for katakana words)" },
      meaning: { type: "string", description: "Short English meaning" },
      example: { type: "string", description: "Casual everyday sentence, or a two-person chat with lines starting A： and B：" },
      exampleReading: {
        type: "string",
        description: zh ? "Pinyin for the example, one syllable per character, same line breaks and A：/B： labels" : "Kana reading of the whole example, same line breaks and A：/B： labels",
      },
      exampleMeaning: { type: "string", description: "English translation, same line breaks and A：/B： labels" },
      notes: { type: "string", description: "One short English usage note" },
      tags: { type: "string", description: "Space-separated tags" },
    },
    required: ["term", "reading", "meaning", "example", "exampleReading", "exampleMeaning", "notes", "tags"],
    additionalProperties: false,
  };
}

function kindedSchema(lang: Lang) {
  const base = cardSchema(lang);
  return { ...base, properties: { ...base.properties, kind: { type: "string", enum: [...CARD_KINDS] } }, required: [...base.required, "kind"] };
}

const KIND_GUIDE: Record<Lang, Record<CardKind, string>> = {
  zh: {
    term: "term is the word or phrase itself.",
    phrase: "This card is a short phrase or set expression, not a full sentence. term is the whole phrase, reading its pinyin, meaning its English sense.",
    sentence:
      "This card is a complete sentence the learner wants to say. term is the whole sentence in simplified hanzi, reading its pinyin with one space-separated syllable per character, meaning its natural English translation. " +
      "A sentence card has no example: leave example, exampleReading, and exampleMeaning as empty strings. ",
  },
  ja: {
    term: "term is the word or phrase itself.",
    phrase: "This card is a short phrase or set expression, not a full sentence. term is the whole phrase, reading its hiragana reading, meaning its English sense.",
    sentence:
      "This card is a complete sentence the learner wants to say. term is the whole sentence in natural Japanese, reading its full hiragana reading with no spaces, meaning its natural English translation. " +
      "A sentence card has no example: leave example, exampleReading, and exampleMeaning as empty strings. ",
  },
};

const TAG_RULES =
  "Tag rules:\n" +
  "- If an existing tag clearly fits this word, use that exact tag.\n" +
  "- Use up to three tags only when each one is precise.\n" +
  "- If no existing tag fits, invent one new short lowercase token (letters, digits, hyphen) and use that.\n" +
  "- Do not invent a new tag when an existing tag fits, and do not reuse a tag that only loosely relates.\n\n";

const FILL_SYSTEM: Record<Lang, string> = {
  zh:
    "You fill Mandarin vocabulary cards for an adult learner. Reply with JSON only. " +
    "Pinyin may arrive without tone marks because the learner is using an English keyboard. Never reject untoned pinyin. " +
    "When several words share that spelling, pick the most common one unless the other fields already identify a different word. " +
    "Keep every field the learner already filled, unchanged, except reading: if reading has no tone marks and hanzi is empty, return the standard tone-marked pinyin of the word you chose.",
  ja:
    "You fill Japanese vocabulary cards for an adult learner. Reply with JSON only. " +
    "The reading may arrive in romaji (benkyou, taberu) because the learner is using an English keyboard. Never reject romaji. " +
    "When several words share that reading, pick the most common one unless the other fields already identify a different word. " +
    "Keep every field the learner already filled, unchanged, except reading: if reading is in romaji, return the word's reading in hiragana (katakana for katakana words).",
};

export function fillRequest(card: Card, tags: string[], level: Fluency, lang: Lang = DEFAULT_LANG, dialogue = pickDialogue()) {
  const catalog = uniqueTags(tags).slice(0, 150);
  const kind = isCardKind(card.kind) ? card.kind : "term";
  const known = (["term", "reading", "meaning", "example", "exampleReading", "exampleMeaning", "notes", "tags"] as const)
    .filter((f) => card[f].trim() && (kind !== "sentence" || !f.startsWith("example")))
    .map((f) => `${f}: ${card[f].trim()}`)
    .join("\n");
  const fields =
    `The learner marked this card as a ${kind}. ${KIND_RULE[lang]}` +
    `For a term or phrase: ${KIND_GUIDE[lang].term} Fill every empty field. Do not leave example, exampleReading, exampleMeaning, notes, or tags blank. ` +
    `${exampleGuide(level, lang)}${exampleStyle(dialogue)}notes is one short English note about everyday use. ` +
    `For a sentence: ${KIND_GUIDE[lang].sentence}Keep the sentence casual and spoken. ${LEVEL_GUIDE[lang][level]} notes is one short English note about grammar or usage in the sentence. ` +
    "tags is space-separated.";
  return {
    system: FILL_SYSTEM[lang],
    user:
      `Existing tags:\n${catalog.length ? catalog.join(", ") : "(none yet)"}\n\n` +
      TAG_RULES +
      `Fields already entered:\n${known || "(only treat reading as given if it appears above)"}\n\n` +
      fields,
    schema: kindedSchema(lang),
  };
}

const LOOKUP_SCHEMA = {
  type: "object",
  properties: {
    matches: {
      type: "array",
      items: {
        type: "object",
        properties: {
          hanzi: { type: "string" },
          pinyin: { type: "string" },
          meaning: { type: "string" },
          kind: { type: "string", enum: [...CARD_KINDS] },
        },
        required: ["hanzi", "pinyin", "meaning", "kind"],
        additionalProperties: false,
      },
    },
  },
  required: ["matches"],
  additionalProperties: false,
};

const KIND_LINE = "kind is term for a single word, phrase for a multi-word expression that is not a full sentence, or sentence for a complete thing to say.";

/** `reading` is pinyin for Mandarin and kana or romaji for Japanese. */
export function lookupRequest(reading: string, hint: string, meaning = "", lang: Lang = DEFAULT_LANG) {
  if (lang === "ja") {
    return {
      system:
        "You list real Japanese words. Reply with JSON only. " +
        "The learner may give a reading (in kana or romaji), an English meaning, or both. " +
        "The Reading line is always a Japanese reading, never an English word, even when it happens to look like English (kite, sake, mine). Search it only as a reading. " +
        "If only a reading is given, list the real words with that reading, most common first, including homophones written with different kanji (橋, 箸, 端 for hashi). " +
        "If only an English meaning is given, list the most common Japanese words for that meaning. " +
        "If both are given, put words that fit both first. " +
        "An extra clue narrows the list. If it names a different word than the entered meaning, rank the clue first. " +
        "Sort from the most relevant word to the least. Return at most 20 words, and fewer when fewer real words exist. Do not pad the list.",
      user:
        `Reading: ${reading.trim() || "(none)"}\n` +
        `Meaning: ${meaning.trim() || "(none)"}\n` +
        `Extra clue: ${hint.trim() || "(none)"}\n` +
        'Return {"matches":[{"hanzi":"","pinyin":"","meaning":"","kind":""}]}. hanzi is the word as normally written in Japanese (kanji and kana). ' +
        "pinyin is its reading in hiragana (katakana for katakana words), never romaji. meaning is a short English gloss. " + KIND_LINE,
      schema: LOOKUP_SCHEMA,
    };
  }
  return {
    system:
      "You list real Mandarin words. Reply with JSON only. " +
      "The learner may give a pinyin spelling, an English meaning, or both. " +
      "The Pinyin line is always a pinyin spelling, never an English word, even when it happens to look like English (man, fan, long, she). Search it only as pinyin. " +
      "Pinyin may omit tone marks or use digits (ni3 hao3). " +
      "If only pinyin is given, list the real words for that spelling, most common first. " +
      "If only an English meaning is given, list the most common Mandarin words for that meaning. " +
      "If both are given, put words that fit both first. Tone marks are a preference: a meaning that names another tone of the same spelling still belongs on the list. " +
      "An extra clue narrows the list. If it names a different word than the entered meaning, rank the clue first. " +
      "Sort from the most relevant word to the least. Return at most 20 words, and fewer when fewer real words exist. Do not pad the list.",
    user:
      `Pinyin: ${reading.trim() || "(none)"}\n` +
      `Meaning: ${meaning.trim() || "(none)"}\n` +
      `Extra clue: ${hint.trim() || "(none)"}\n` +
      'Return {"matches":[{"hanzi":"","pinyin":"","meaning":"","kind":""}]}. pinyin must use tone marks. meaning is a short English gloss. ' + KIND_LINE,
    schema: LOOKUP_SCHEMA,
  };
}

/** `pinyin` holds the reading of whichever side is Chinese or Japanese: pinyin, or kana. */
export type Translation = { translation: string; pinyin: string; direction: "to-en" | "from-en" };

/** A highlighted passage, only ever sent when the learner asks for a translation. */
export function translateRequest(text: string, lang: Lang = DEFAULT_LANG) {
  const ja = lang === "ja";
  return {
    system: ja
      ? "You translate between Japanese and English for a Japanese learner. Reply with JSON only. " +
        "If the text is mainly Japanese, translate it into natural English and set direction to to-en. " +
        "Otherwise translate it into natural, everyday Japanese and set direction to from-en. " +
        "Keep the meaning, tone and register. Do not explain or add notes."
      : "You translate between Chinese and English for a Mandarin learner. Reply with JSON only. " +
        "If the text is mainly Chinese, translate it into natural English and set direction to to-en. " +
        "Otherwise translate it into natural, everyday Simplified Chinese and set direction to from-en. " +
        "Keep the meaning, tone and register. Do not explain or add notes.",
    user:
      `Text:\n${text}\n` +
      (ja
        ? 'Return {"translation":"","pinyin":"","direction":""}. pinyin is the full reading in hiragana for whichever side is Japanese ' +
          "(the original for to-en, the translation for from-en), with the original punctuation and no romaji."
        : 'Return {"translation":"","pinyin":"","direction":""}. pinyin is Hanyu Pinyin with tone marks for whichever side is Chinese ' +
          "(the original for to-en, the translation for from-en), with spaces between words and the original punctuation."),
    schema: {
      type: "object",
      properties: {
        translation: { type: "string" },
        pinyin: { type: "string" },
        direction: { type: "string", enum: ["to-en", "from-en"] },
      },
      required: ["translation", "pinyin", "direction"],
      additionalProperties: false,
    },
  };
}

export function sanitizeTranslation(json: unknown): Translation {
  const t = (json ?? {}) as Partial<Translation>;
  return {
    translation: typeof t.translation === "string" ? t.translation.trim() : "",
    pinyin: typeof t.pinyin === "string" ? t.pinyin.trim() : "",
    direction: t.direction === "from-en" ? "from-en" : "to-en",
  };
}

/** An English translation with hanzi or another script in it, or a reading with hanzi in it. */
export function badTranslation(t: Translation, lang: Lang = DEFAULT_LANG): boolean {
  if (lang === "ja") {
    return (t.direction === "to-en" ? notLatinJa(t.translation) || KANA_CHAR.test(t.translation) : garbledJa(t.translation)) || notKana(t.pinyin);
  }
  return garbled(t.translation) || notLatin(t.pinyin) || (t.direction === "to-en" && HAN_CHAR.test(t.translation));
}

const PROMPT_SYSTEM: Record<Lang, string> = {
  zh:
    "You create one Mandarin card from a learner's description. Reply with JSON only. " +
    "Set kind to term for a single word, phrase for a short expression, or sentence when the learner wants to say a whole thing (for example \"how to say I'm hungry\"). " +
    "Choose the most natural common wording. reading uses tone marks.",
  ja:
    "You create one Japanese card from a learner's description. Reply with JSON only. " +
    "Set kind to term for a single word, phrase for a short expression, or sentence when the learner wants to say a whole thing (for example \"how to say I'm hungry\"). " +
    "Choose the most natural common wording, written the way Japanese people normally write it. reading is the full reading in hiragana.",
};

export function promptRequest(prompt: string, tags: string[], level: Fluency, lang: Lang = DEFAULT_LANG, dialogue = pickDialogue()) {
  const catalog = uniqueTags(tags).slice(0, 150);
  return {
    system: PROMPT_SYSTEM[lang],
    user:
      `Existing tags:\n${catalog.length ? catalog.join(", ") : "(none yet)"}\n\n` +
      "If an existing tag clearly fits, use that exact tag. If none fit, invent one short lowercase tag. At most three tags, space-separated.\n\n" +
      `Learner request: ${prompt.trim()}\n\n` +
      `For a term or phrase, fill every field, including a casual example, its ${lang === "ja" ? "kana reading" : "pinyin"}, its translation, a short English note, and tags. ${exampleGuide(level, lang)}${exampleStyle(dialogue)}` +
      `For a sentence: ${KIND_GUIDE[lang].sentence}${LEVEL_GUIDE[lang][level]}`,
    schema: kindedSchema(lang),
  };
}

export const MAX_EXTRACTED = 40;

const EXTRACT_SYSTEM: Record<Lang, string> = {
  zh:
    "You turn a tutor's message about Mandarin into flashcards for an adult learner. Reply with JSON only. " +
    "First read the whole message and list every Chinese item it presents to the learner: each word, phrase, or sentence that it glosses, translates, lists, compares, or recommends saying. " +
    "That includes every item in a list, both sides of a comparison, and words introduced in passing with a meaning. A long message with many items gets many cards; never stop after the first few. " +
    `Make one card per item, in the order they appear, up to ${MAX_EXTRACTED}. Merge exact duplicates. ` +
    "A sentence that only illustrates another item (\"X, like <sentence>\") becomes that item's example and never also a card of its own; a sentence the message presents as something to learn or say gets its own sentence card. " +
    "Skip chit-chat. If the message teaches no Chinese at all, return an empty list. " +
    "Every card must be complete: term is simplified hanzi (never pinyin), reading is standard pinyin with tone marks, meaning is a short English gloss, notes is one short English sentence, and tags are filled. ",
  ja:
    "You turn a tutor's message about Japanese into flashcards for an adult learner. Reply with JSON only. " +
    "First read the whole message and list every Japanese item it presents to the learner: each word, phrase, or sentence that it glosses, translates, lists, compares, or recommends saying. " +
    "That includes every item in a list, both sides of a comparison, and words introduced in passing with a meaning. A long message with many items gets many cards; never stop after the first few. " +
    `Make one card per item, in the order they appear, up to ${MAX_EXTRACTED}. Merge exact duplicates. ` +
    "A sentence that only illustrates another item (\"X, like <sentence>\") becomes that item's example and never also a card of its own; a sentence the message presents as something to learn or say gets its own sentence card. " +
    "Skip chit-chat. If the message teaches no Japanese at all, return an empty list. " +
    "Every card must be complete: term is Japanese as normally written in kanji and kana (never romaji), reading is its hiragana reading, meaning is a short English gloss, notes is one short English sentence, and tags are filled. ",
};

/** Cards for the language one of Bao's replies teaches, keeping its own examples and explanations where it gave them. */
export function extractRequest(text: string, tags: string[], level: Fluency, lang: Lang = DEFAULT_LANG) {
  const catalog = uniqueTags(tags).slice(0, 150);
  return {
    system:
      EXTRACT_SYSTEM[lang] +
      "Every term or phrase card must have example, exampleReading, and exampleMeaning, all filled. When the message gives an example for the item, reuse it; otherwise write one. " +
      "notes captures what the message says about how to use the item, e.g. how it differs from the other items; if it says nothing, write a short everyday-use note. " +
      `${KIND_RULE[lang]}${KIND_GUIDE[lang].sentence}${exampleGuide(level, lang)}`,
    user:
      `Existing tags:\n${catalog.length ? catalog.join(", ") : "(none yet)"}\n\n` +
      "If an existing tag clearly fits, use that exact tag. If none fit, invent one short lowercase tag. At most three tags per card, space-separated, and use the same tag on every card when the cards belong together (e.g. grammar).\n\n" +
      `Tutor's message:\n${text.trim().slice(0, 12000)}`,
    schema: {
      type: "object",
      properties: { cards: { type: "array", items: kindedSchema(lang) } },
      required: ["cards"],
      additionalProperties: false,
    },
  };
}

export function sanitizeExtracted(raw: unknown): { draft: CardDraft; kind: CardKind }[] {
  const list = raw && typeof raw === "object" && Array.isArray((raw as { cards?: unknown }).cards) ? (raw as { cards: unknown[] }).cards : [];
  const seen = new Set<string>();
  return list.slice(0, MAX_EXTRACTED).flatMap((item) => {
    const kind = draftKind(item);
    const draft = sanitizeDraft((item ?? null) as Partial<CardDraft> | null);
    if (!draft.term && !draft.reading) return [];
    const key = draft.term || draft.reading;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ draft: kind === "sentence" ? { ...draft, example: "", exampleReading: "", exampleMeaning: "" } : draft, kind }];
  });
}

export function draftKind(raw: unknown): CardKind {
  const kind = raw && typeof raw === "object" ? (raw as { kind?: unknown }).kind : undefined;
  return isCardKind(kind) ? kind : "term";
}

const FORMAT_WORD: Record<Lang, string> = {
  zh:
    "You proofread Mandarin vocabulary rows for an adult learner. Reply with JSON only. " +
    "Return one corrected row per input row, in the same order. Never drop or merge rows. " +
    "Choose the word from the pinyin together with any meaning and hanzi already entered. A meaning the learner typed outranks a more common homophone. " +
    "reading must be the standard pinyin with tone marks for that word. If tone marks or tone digits are present and wrong, fix them. If they are absent, add them. Do not switch to a different word merely to add tones. " +
    "term is simplified hanzi for that same word. Fill it when it is blank. Replace it when it belongs to a different word. ",
  ja:
    "You proofread Japanese vocabulary rows for an adult learner. Reply with JSON only. " +
    "Return one corrected row per input row, in the same order. Never drop or merge rows. " +
    "Choose the word from the reading together with any meaning and term already entered. A meaning the learner typed outranks a more common homophone. " +
    "reading must be the standard reading of that word in hiragana (katakana for katakana words). If it is in romaji, convert it. If it is wrong for the word, fix it. Do not switch to a different word. " +
    "term is that same word as normally written in Japanese, in kanji and kana. Fill it when it is blank. Replace it when it belongs to a different word. ",
};

export function formatRequest(rows: CardDraft[], level: Fluency, kinds: (CardKind | undefined)[] = [], lang: Lang = DEFAULT_LANG) {
  const body = rows.map((row, i) => {
    const lines = (["reading", "meaning", "term", "example", "exampleReading", "exampleMeaning", "notes", "tags"] as const)
      .filter((field) => row[field].trim())
      .map((field) => `${field}: ${row[field].trim()}`);
    if (kinds[i]) lines.push(`kind: ${kinds[i]}`);
    if (!row.example.trim()) lines.push(`new example style: ${pickDialogue() ? "two-line A：/B： conversation" : "one sentence"}`);
    return `#${i + 1}\n${lines.join("\n") || "(empty)"}`;
  }).join("\n\n");
  return {
    system:
      FORMAT_WORD[lang] +
      "meaning is a short English gloss. Keep it when it is right. Correct it when it names a different word. " +
      `Fill every blank field. Each row needs example, exampleReading, exampleMeaning, notes, and tags, not only ${lang === "ja" ? "the word" : "hanzi"} and meaning. ` +
      `${exampleGuide(level, lang)}The word must appear in the example. ` +
      "When a row asks for a new example style, write its new example in that shape. " +
      "notes is one short English note about everyday use. Fill it when it is blank. Keep it when it is already about this word. " +
      "tags is space-separated, at most three. Fill them when they are blank. Keep tags that already fit this word. " +
      `${KIND_RULE[lang]}A sentence row has no example: leave example, exampleReading, and exampleMeaning empty.`,
    user: `Proofread these ${rows.length} rows.\n\n${body}`,
    schema: {
      type: "object",
      properties: { rows: { type: "array", items: kindedSchema(lang) } },
      required: ["rows"],
      additionalProperties: false,
    },
  };
}

export const CONVERT_BATCH = 12;

const FALSE_FRIENDS: Record<Lang, string> = {
  zh: "Mandarin and Japanese share many characters with different meanings, such as 手紙 (Mandarin: toilet paper, Japanese: letter), 勉強 (Mandarin: reluctantly, Japanese: study), and 大丈夫 (Mandarin: real man, Japanese: all right). ",
  ja: "Japanese and Mandarin share many characters with different meanings, such as 手紙 (Japanese: letter, Mandarin: toilet paper), 勉強 (Japanese: study, Mandarin: reluctantly), and 大丈夫 (Japanese: all right, Mandarin: real man). ",
};

/** Cards from a deck in `from`, rewritten as the closest everyday cards in `to`. */
export function convertRequest(rows: (CardDraft & { kind: CardKind })[], from: Lang, to: Lang, level: Fluency) {
  const source = LANG_INFO[from].promptName;
  const target = LANG_INFO[to].promptName;
  const body = rows.map((row, i) => {
    const lines = (["term", "reading", "meaning", "example", "exampleMeaning", "notes", "tags"] as const)
      .filter((field) => row[field].trim())
      .map((field) => `${field}: ${row[field].trim()}`);
    lines.push(`kind: ${row.kind}`);
    if (row.kind !== "sentence") {
      lines.push(`example style: ${isConversation(row.example) ? "conversation, exactly two lines: an A： line, then a B： line" : "one sentence with no speaker label"}`);
    }
    return `#${i + 1}\n${lines.join("\n")}`;
  }).join("\n\n");
  return {
    system:
      `You turn cards from a ${source} vocabulary deck into ${target} cards for an adult learner who is starting a ${target} deck with the same words. Reply with JSON only. ` +
      "Return one card per input row, in the same order. Never drop or merge rows. " +
      `For each row, pick the ${target} word, phrase, or sentence a native speaker would really use for the same meaning. The English meaning decides the sense; the ${source} term only helps tell senses apart. ` +
      `Never copy the ${source} characters just because they also exist in ${target}. ${FALSE_FRIENDS[from]}` +
      `Keep the row's kind unless the natural ${target} equivalent clearly is another kind. ${KIND_RULE[to]}` +
      `term is the ${target} word. ${cardSchema(to).properties.term.description}. reading is ${to === "ja" ? "its full reading in hiragana (katakana for katakana words)" : "its pinyin with tone marks"}. ` +
      `For a sentence: ${KIND_GUIDE[to].sentence}` +
      "meaning is a short English gloss of the new word. Keep the original meaning when it fits the new word; adjust it when the new word's sense is narrower or wider. " +
      `For a term or phrase, write a new ${target} example in the row's example style, for the same everyday situation as the original example when that sounds natural. ` +
      "A conversation always has both lines, each on its own line; exampleReading and exampleMeaning have the same two lines. " +
      `${exampleGuide(level, to)}The word must appear in the example. ` +
      `notes is one short English note about how the ${target} word is used. Mention a difference from the ${source} word only when it would trip the learner up. ` +
      "tags copies the row's tags exactly, and is empty when the row has none.",
    user: `Turn these ${rows.length} ${source} cards into ${target} cards.\n\n${body}`,
    schema: {
      type: "object",
      properties: { rows: { type: "array", items: kindedSchema(to) } },
      required: ["rows"],
      additionalProperties: false,
    },
  };
}

export function sanitizeFormatRows(raw: unknown, count: number): { rows: CardDraft[]; kinds: CardKind[] } {
  const list = raw && typeof raw === "object" && Array.isArray((raw as { rows?: unknown }).rows) ? (raw as { rows: unknown[] }).rows : [];
  const kinds = Array.from({ length: count }, (_, i) => draftKind(list[i]));
  const rows = Array.from({ length: count }, (_, i) => {
    const draft = sanitizeDraft((list[i] ?? null) as Partial<CardDraft> | null);
    return kinds[i] === "sentence" ? { ...draft, example: "", exampleReading: "", exampleMeaning: "" } : draft;
  });
  return { rows, kinds };
}

export const SPLIT_STYLES = ["auto", "topic", "place", "grammar", "situation", "level", "custom"] as const;
export type SplitStyle = (typeof SPLIT_STYLES)[number];
export const isSplitStyle = (v: unknown): v is SplitStyle => SPLIT_STYLES.includes(v as SplitStyle);
export const SPLIT_STYLE_INFO: Record<SplitStyle, { label: string; hint: string }> = {
  auto: { label: "Let AI decide", hint: "Whatever grouping fits these cards best" },
  topic: { label: "Topics", hint: "Food, travel, work, family…" },
  place: { label: "Places and rooms", hint: "Kitchen, bedroom, office, street…" },
  grammar: { label: "Parts of speech", hint: "Verbs, nouns, adjectives…" },
  situation: { label: "Situations", hint: "Ordering food, small talk, shopping…" },
  level: { label: "Difficulty", hint: "Beginner, intermediate, advanced" },
  custom: { label: "My own idea", hint: "Describe it below" },
};
export const SPLIT_MAX = 800;
export type SplitGroup = { name: string; description: string; rows: number[] };

const SPLIT_GUIDE: Record<SplitStyle, string> = {
  auto: "Pick the grouping that makes the most useful study decks for these particular cards, such as topics, situations or word types.",
  topic: "Group by topic or subject area, such as food, travel, work, family, health or weather.",
  place: "Group by the place or room where the word is used, such as kitchen, bedroom, bathroom, office, school, street or shop.",
  grammar: "Group by part of speech or grammatical role, such as verbs, nouns, adjectives, adverbs, measure words, particles and set phrases.",
  situation: "Group by real-life situation, such as ordering food, small talk, shopping, asking directions or at work.",
  level: "Group by difficulty for an adult learner: beginner, intermediate and advanced.",
  custom: "Group the way the learner describes.",
};

/** `rows` are the deck's cards; each group lists the indexes of its cards. */
export function splitRequest(rows: { term: string; reading: string; meaning: string; kind: CardKind; tags: string }[], style: SplitStyle, prompt: string, count: number | null, lang: Lang) {
  const body = rows.map((r, i) => `${i}: ${[r.term, r.reading, r.meaning].filter((s) => s.trim()).join(" | ")}${r.kind !== "term" ? ` (${r.kind})` : ""}${r.tags.trim() ? ` [${r.tags.trim()}]` : ""}`).join("\n");
  return {
    system:
      `You sort the cards of a ${LANG_INFO[lang].promptName} vocabulary deck into smaller themed decks for an adult learner. Reply with JSON only. ` +
      `${SPLIT_GUIDE[style]} ` +
      (count ? `Make exactly ${count} groups. ` : "Make between 2 and 10 groups, enough that each is a coherent deck, and avoid groups of only one or two cards when a broader group fits. ") +
      "Every card goes in exactly one group; a card that fits nowhere goes in a group named Other. Use the row numbers given. " +
      "name is a short English deck name of one to three words, in title case. description is one short English sentence saying what the deck covers.",
    user:
      (prompt.trim() ? `What the learner is looking for: ${prompt.trim()}\n\n` : "") +
      `Sort these ${rows.length} cards.\n\n${body}`,
    schema: {
      type: "object",
      properties: {
        groups: {
          type: "array",
          items: {
            type: "object",
            properties: { name: { type: "string" }, description: { type: "string" }, rows: { type: "array", items: { type: "integer" } } },
            required: ["name", "description", "rows"],
            additionalProperties: false,
          },
        },
      },
      required: ["groups"],
      additionalProperties: false,
    },
  };
}

/** Drops unknown rows and repeats, so each card is in at most one group, and drops groups left empty. */
export function sanitizeSplit(raw: unknown, count: number): SplitGroup[] {
  const list = raw && typeof raw === "object" && Array.isArray((raw as { groups?: unknown }).groups) ? (raw as { groups: unknown[] }).groups : [];
  const used = new Set<number>();
  const out: SplitGroup[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const g = item as Partial<SplitGroup>;
    const rows = (Array.isArray(g.rows) ? g.rows : []).filter((n): n is number => Number.isInteger(n) && n >= 0 && n < count && !used.has(n));
    rows.forEach((n) => used.add(n));
    const name = typeof g.name === "string" ? g.name.trim().slice(0, 60) : "";
    if (rows.length && name) out.push({ name, description: typeof g.description === "string" ? g.description.trim().slice(0, 200) : "", rows });
  }
  return out;
}
