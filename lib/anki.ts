import JSZip from "jszip";
import { uniqueTags } from "./ai";
import { DAY, memoryFromSm2, type Rating } from "./fsrs";
import { DEFAULT_REVIEW, dayKey, MAX_ANSWER_MS, recomputeMemory, type RevlogEntry, type Schedule, type Side, type Store } from "./srs";
import { detectLanguage, hasCjk, hasKana, isKanaOnly, type Lang, parseBracketFurigana } from "./lang";
import { looksLikePinyin, newCard, normalizeCard, type Card, type CardField, type CardKind, type Notetype } from "./cards";

export type AnkiNotetype = { id: number; name: string; fields: string[]; templates: number };
export type AnkiNote = { id: number; type: number; tags: string; fields: string[] };
/** `deck` is the card's home deck, even while it sits in a filtered deck. `due` follows Anki: a queue position, epoch seconds, or days since `created`. */
export type AnkiCard = {
  id: number; note: number; deck: number; ord: number; type: number; queue: number; due: number; ivl: number; factor: number;
  reps: number; lapses: number; left: number; stability: number | null; difficulty: number | null; lastReview: number | null;
};
export type AnkiReview = { at: number; card: number; rating: number; ivl: number; type: number; took: number };
export type AnkiCollection = { created: number; notetypes: AnkiNotetype[]; decks: { id: number; name: string }[]; notes: AnkiNote[]; cards: AnkiCard[]; reviews: AnkiReview[] };

export type FieldRole = Exclude<CardField, "tags"> | "skip";
export const FIELD_ROLES: { value: FieldRole; label: string }[] = [
  { value: "term", label: "Word (hanzi / kanji)" },
  { value: "reading", label: "Reading (pinyin / kana)" },
  { value: "meaning", label: "Meaning" },
  { value: "example", label: "Example" },
  { value: "exampleReading", label: "Example reading" },
  { value: "exampleMeaning", label: "Example translation" },
  { value: "notes", label: "Notes" },
  { value: "skip", label: "Don’t import" },
];
/** Note type id to one role per field. */
export type Roles = Record<number, FieldRole[]>;

export const ANKI_ACCEPT = ".apkg,.colpkg";
const COLLECTIONS = ["collection.anki21b", "collection.anki21", "collection.anki2"];
const STUB = /please update to the latest anki version/i;
/** Review history kept per imported deck, newest first, so big collections still fit in the browser. */
const MAX_REVLOG = 25_000;

export const isAnkiFile = (name: string) => /\.(apkg|colpkg)$/i.test(name);

/** Unzips the package here so media never uploads, then lets the server read the SQLite collection. */
export async function readAnkiPackage(file: File): Promise<AnkiCollection> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch {
    throw new Error("That file isn’t an Anki package. In Anki, use File → Export → Anki Deck Package (.apkg).");
  }
  const entry = COLLECTIONS.map((name) => zip.file(name)).find((f) => f != null);
  if (!entry) throw new Error("That package has no Anki collection inside.");
  const res = await fetch("/api/anki", { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: await entry.async("blob") });
  const data = (await res.json().catch(() => null)) as (AnkiCollection & { error?: string }) | null;
  if (!res.ok || !data) throw new Error(data?.error ?? "Couldn’t read that Anki file.");
  if (data.notes.length === 1 && STUB.test(data.notes[0].fields.join(" "))) {
    throw new Error("That package needs a newer reader. In Anki’s export dialog, tick “Support older Anki versions” and export again.");
  }
  return data;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };

/** Anki fields are HTML. Sounds, images, and cloze markers are dropped; line breaks survive as newlines. */
export function cleanField(html: string): string {
  return html
    .replace(/\[sound:[^\]]*\]/gi, "")
    .replace(/\{\{c\d+::([\s\S]*?)(?:::[^}]*)?\}\}/g, "$1")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(div|p|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, e: string) => {
      if (e[0] !== "#") return ENTITIES[e.toLowerCase()] ?? match;
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1));
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    })
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

const NAME_RULES: [RegExp, FieldRole][] = [
  [/audio|sound|image|picture|\bpic|img|media|video|stroke|gif|freq|rank|^id$|^sort/i, "skip"],
  [/(sentence|example|例文).*(pinyin|reading|kana|furigana|yomi|読み)/i, "exampleReading"],
  [/(sentence|example|例文).*(english|meaning|translation|definition|gloss|英訳)/i, "exampleMeaning"],
  [/sentence|example|例句|例文/i, "example"],
  [/pinyin|reading|kana|furigana|yomi|romaji|romani[sz]ation|拼音|読み|よみ/i, "reading"],
  // Before the word rule, so "Word Meaning" or "Vocabulary-English" is the meaning, not a second word field.
  [/meaning|english|definition|translation|gloss|back|英文|意思|意味|英訳/i, "meaning"],
  [/hanzi|simplified|chinese|character|word|expression|vocab|front|term|traditional|kanji|japanese|汉字|简体|繁体|中文|単語|漢字|日本語/i, "term"],
  [/note|comment|extra|hint|mnemonic|remark/i, "notes"],
];

/** `han` counts Chinese or Japanese writing; `kana` counts fields written only in kana, which is how readings look. */
type FieldStats = { filled: number; han: number; kana: number; pinyin: number; length: number };

function fieldStats(notes: AnkiNote[], count: number): FieldStats[] {
  const stats = Array.from({ length: count }, () => ({ filled: 0, han: 0, kana: 0, pinyin: 0, length: 0 }));
  for (const note of notes.slice(0, 200)) {
    for (let i = 0; i < count; i++) {
      const value = cleanField(note.fields[i] ?? "").replace(/\n/g, " ");
      if (!value) continue;
      const s = stats[i];
      s.filled++;
      if (hasCjk(value)) s.han++;
      else if (looksLikePinyin(value)) s.pinyin++;
      if (isKanaOnly(value) || parseBracketFurigana(value)) s.kana++;
      s.length += [...value].length;
    }
  }
  const sampled = Math.min(notes.length, 200) || 1;
  const share = (n: number, of: number) => (of ? n / of : 0);
  return stats.map((s) => ({ filled: s.filled / sampled, han: share(s.han, s.filled), kana: share(s.kana, s.filled), pinyin: share(s.pinyin, s.filled), length: share(s.length, s.filled) }));
}

/** Field names decide first, then the content: hanzi, kana, pinyin, and English look different enough to tell apart. */
export function guessRoles(type: AnkiNotetype, notes: AnkiNote[]): FieldRole[] {
  const stats = fieldStats(notes, type.fields.length);
  const roles: (FieldRole | null)[] = type.fields.map(() => null);
  const taken = new Set<FieldRole>();
  const order = type.fields.map((_, i) => i).sort((a, b) => Number(/simpl/i.test(type.fields[b])) - Number(/simpl/i.test(type.fields[a])));
  for (const i of order) {
    const rule = NAME_RULES.find(([pattern]) => pattern.test(type.fields[i]));
    if (!rule) continue;
    const [, role] = rule;
    if (role === "skip" || role === "notes") { roles[i] = role; continue; }
    if (taken.has(role)) { roles[i] = "skip"; continue; }
    const s = stats[i];
    const fits = !s.filled
      || (role === "term" || role === "example" ? s.han >= 0.3 : role === "reading" || role === "exampleReading" ? s.pinyin >= 0.3 || s.kana >= 0.3 : s.han < 0.5);
    if (!fits) continue;
    roles[i] = role;
    taken.add(role);
  }
  const open = () => roles.flatMap((role, i) => (role === null && stats[i].filled > 0 ? [i] : []));
  const claim = (role: FieldRole, pick: number | undefined) => {
    if (pick === undefined || taken.has(role)) return;
    roles[pick] = role;
    taken.add(role);
  };
  // A Japanese reading is written in kana, so it is told apart from the word before the word is picked.
  const words = () => open().filter((i) => stats[i].han >= 0.6);
  const hasKanji = words().some((i) => stats[i].kana < 0.6);
  if (hasKanji) claim("reading", open().filter((i) => stats[i].kana >= 0.6).sort((a, b) => stats[a].length - stats[b].length)[0]);
  claim("term", words().sort((a, b) => stats[a].length - stats[b].length)[0]);
  claim("example", words().sort((a, b) => stats[b].length - stats[a].length)[0]);
  claim("reading", open().filter((i) => stats[i].pinyin >= 0.6).sort((a, b) => stats[b].filled - stats[a].filled)[0]);
  claim("meaning", open().filter((i) => stats[i].filled >= 0.3 && stats[i].han < 0.3 && stats[i].pinyin < 0.5).sort((a, b) => stats[b].filled - stats[a].filled)[0]);
  return roles.map((role) => role ?? "skip");
}

export function kindOf(term: string): CardKind {
  const text = term.trim();
  // Kana make Japanese words long (恥ずかしい, 立ち上がる), so length says little; punctuation and polite endings say more.
  if (hasKana(text)) {
    if (/[。？！?!]$/.test(text) || [...text].length >= 16) return "sentence";
    if (/[、，,\s]/.test(text) || /.(します|ございます|ください)$/.test(text)) return "phrase";
    return "term";
  }
  const han = [...text].filter(hasCjk).length;
  if (/[。？！?!]$/.test(text) || han >= 10) return "sentence";
  if (han >= 5 || /[，,\s]/.test(text)) return "phrase";
  return "term";
}

export function noteToCard(note: AnkiNote, roles: FieldRole[]): Card {
  const parts: Partial<Record<FieldRole, string[]>> = {};
  note.fields.forEach((raw, i) => {
    const role = roles[i] ?? "skip";
    if (role === "skip") return;
    const value = cleanField(raw);
    if (value) (parts[role] ??= []).push(value);
  });
  const joined = (role: FieldRole, sep: string) => (parts[role] ?? []).join(sep);
  const line = (role: FieldRole, sep: string) => joined(role, sep).replace(/\n/g, sep);
  let term = line("term", " ");
  let reading = line("reading", " ");
  let example = joined("example", "\n");
  let exampleReading = joined("exampleReading", "\n");
  // Japanese decks often write readings as furigana in brackets: 勉強[べんきょう]する.
  const termRuby = parseBracketFurigana(term);
  if (termRuby) { term = termRuby.text; reading ||= termRuby.reading; }
  const readingRuby = parseBracketFurigana(reading);
  if (readingRuby) reading = readingRuby.reading;
  const exampleRuby = parseBracketFurigana(example);
  if (exampleRuby) { example = exampleRuby.text; exampleReading ||= exampleRuby.reading; }
  const exampleReadingRuby = parseBracketFurigana(exampleReading);
  if (exampleReadingRuby) exampleReading = exampleReadingRuby.reading;
  // Decks often put the pinyin in the same field as the hanzi, e.g. "喜欢<br>xǐhuan".
  const words = term.split(" ");
  const latin = words.filter((w) => !hasCjk(w));
  if (!reading && latin.length && latin.length < words.length && looksLikePinyin(latin.join(" "))) {
    term = words.filter(hasCjk).join("");
    reading = latin.join(" ");
  }
  return normalizeCard({
    ...newCard(),
    kind: kindOf(term),
    term,
    reading,
    meaning: line("meaning", "; "),
    example,
    exampleReading,
    exampleMeaning: joined("exampleMeaning", "\n"),
    notes: joined("notes", "\n"),
    tags: uniqueTags(note.tags.split(/\s+/).map((tag) => tag.replaceAll("::", "-"))).join(" "),
  });
}

/** A word with no Chinese or Japanese in it and no reading is a deck's welcome or info note, not vocabulary. */
export const filledCard = (card: Card) =>
  Boolean(card.term.trim() || card.reading.trim() || card.meaning.trim()) && !(card.term.trim() && !hasCjk(card.term) && !card.reading.trim());

/** The deck a note belongs to: its first card's home deck. */
function noteDecks(collection: AnkiCollection): Map<number, number> {
  const first = new Map<number, AnkiCard>();
  for (const card of collection.cards) {
    const seen = first.get(card.note);
    if (!seen || card.ord < seen.ord) first.set(card.note, card);
  }
  return new Map([...first].map(([note, card]) => [note, card.deck]));
}

export type DeckChoice = { id: number; name: string; notes: number; studied: number };

/** Decks that hold notes, in Anki's tree order. */
export function deckChoices(collection: AnkiCollection): DeckChoice[] {
  const homes = noteDecks(collection);
  const notes = new Map<number, number>();
  for (const deck of homes.values()) notes.set(deck, (notes.get(deck) ?? 0) + 1);
  const studied = new Map<number, number>();
  for (const card of collection.cards) if (card.type !== 0) studied.set(card.deck, (studied.get(card.deck) ?? 0) + 1);
  return collection.decks
    .filter((deck) => notes.has(deck.id))
    .map((deck) => ({ id: deck.id, name: deck.name, notes: notes.get(deck.id) ?? 0, studied: studied.get(deck.id) ?? 0 }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export const deckLabel = (name: string) => name.split("::").map((part) => part.trim()).filter(Boolean).join(" › ");

/** `language` is used for decks whose cards don't show which language they are in. */
export type ImportPlan = { decks: number[]; combine: boolean; roles: Roles; progress: boolean; fallbackName: string; language: Lang };
export type ImportedDeck = { name: string; notetype: Notetype; cards: Card[]; srs: Store | null; tags: string[]; skipped: number; language: Lang };

function localDay(at: number, days = 0): number {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return date.getTime();
}

function emptyStore(now: number): Store {
  return {
    cards: {},
    settings: { ...DEFAULT_REVIEW, learnSteps: [...DEFAULT_REVIEW.learnSteps], relearnSteps: [...DEFAULT_REVIEW.relearnSteps], easyDays: [...DEFAULT_REVIEW.easyDays] },
    day: dayKey(now), newToday: 0, reviewsToday: 0, nextPosition: 0, revlog: [],
  };
}

const STATES = ["new", "learning", "review", "relearning"] as const;
const REVIEW_KINDS: RevlogEntry["kind"][] = ["learning", "review", "relearning", "review"];

/** Anki's card states, due dates, and review log, carried onto this app's matching schedule fields. */
function buildStore(collection: AnkiCollection, notes: AnkiNote[], cardOf: Map<number, Card>, sides: Side[], now: number): Store {
  const store = emptyStore(now);
  const noteIds = new Set(notes.map((n) => n.id));
  const ankiCards = collection.cards.filter((k) => noteIds.has(k.note) && k.ord < sides.length);
  const history = new Map<number, AnkiReview[]>();
  for (const review of collection.reviews) {
    const list = history.get(review.card);
    if (list) list.push(review);
    else history.set(review.card, [review]);
  }
  const firstNew = new Map<number, number>();
  for (const k of ankiCards) if (k.type === 0) firstNew.set(k.note, Math.min(firstNew.get(k.note) ?? Infinity, k.due));
  const positions = new Map([...firstNew].sort((a, b) => a[1] - b[1]).map(([note], i) => [note, i]));
  store.nextPosition = positions.size;

  const fromAnki = new Map<string, { stability: number; difficulty: number }>();
  const factors = new Map<string, number>();
  for (const k of ankiCards) {
    const card = cardOf.get(k.note);
    if (!card) continue;
    const side = sides[k.ord];
    const key = `${card.id}:${side}`;
    const state = STATES[k.type] ?? "new";
    const learning = state === "learning" || state === "relearning";
    const due = state === "new" ? 0
      : learning && k.due > 1_000_000_000 ? k.due * 1000
      : localDay(collection.created + k.due * DAY);
    const reviews = history.get(k.id) ?? [];
    const steps = state === "relearning" ? store.settings.relearnSteps : store.settings.learnSteps;
    const remaining = k.left % 1000;
    const interval = state === "review" || state === "relearning" ? Math.max(1, k.ivl) : 0;
    const schedule: Schedule = {
      key, cardId: card.id, side, state,
      step: learning ? Math.min(Math.max(0, steps.length - remaining), Math.max(0, steps.length - 1)) : null,
      stability: null, difficulty: null, due,
      lastReview: state === "new" ? null : k.lastReview ?? reviews.at(-1)?.at ?? (state === "review" ? due - interval * DAY : now),
      interval, reps: k.reps, lapses: k.lapses, suspended: k.queue === -1, position: positions.get(k.note) ?? 0,
    };
    store.cards[key] = schedule;
    factors.set(key, k.factor);
    if (k.stability != null && k.difficulty != null && state !== "new") fromAnki.set(key, { stability: k.stability, difficulty: k.difficulty });
    for (const r of reviews) {
      store.revlog.push({
        key, at: r.at, rating: r.rating as Rating, kind: REVIEW_KINDS[r.type] ?? "review", interval: r.ivl, difficulty: 5,
        took: Math.round(Math.min(Math.max(0, r.took), MAX_ANSWER_MS)),
      });
    }
  }
  store.revlog.sort((a, b) => a.at - b.at);
  recomputeMemory(store);
  for (const schedule of Object.values(store.cards)) {
    const anki = fromAnki.get(schedule.key);
    if (anki) Object.assign(schedule, anki);
    else if (schedule.state !== "new" && schedule.stability == null) {
      const factor = factors.get(schedule.key) ?? 0;
      Object.assign(schedule, memoryFromSm2(factor > 0 ? factor / 1000 : 2.5, Math.max(1, schedule.interval), store.settings.historicalRetention));
    }
  }
  if (store.revlog.length > MAX_REVLOG) store.revlog = store.revlog.slice(-MAX_REVLOG);
  return store;
}

/** One deck per chosen Anki deck, or a single deck when `combine` is set. */
export function buildDecks(collection: AnkiCollection, plan: ImportPlan, now = Date.now()): ImportedDeck[] {
  const homes = noteDecks(collection);
  const types = new Map(collection.notetypes.map((t) => [t.id, t]));
  const names = new Map(collection.decks.map((d) => [d.id, d.name]));
  const ords = new Map<number, Set<number>>();
  for (const k of collection.cards) {
    const set = ords.get(k.note);
    if (set) set.add(k.ord);
    else ords.set(k.note, new Set([k.ord]));
  }
  const chosen = plan.decks.filter((id) => names.has(id));
  const groups = plan.combine ? [chosen] : chosen.map((id) => [id]);

  return groups.flatMap((group) => {
    const inGroup = new Set(group);
    const notes = collection.notes.filter((n) => plan.roles[n.type] && inGroup.has(homes.get(n.id) ?? -1));
    const cardOf = new Map<number, Card>();
    let skipped = 0;
    for (const note of notes) {
      const card = noteToCard(note, plan.roles[note.type]);
      if (filledCard(card)) cardOf.set(note.id, card);
      else skipped++;
    }
    if (!cardOf.size) return [];
    const kept = notes.filter((n) => cardOf.has(n.id));
    const reversed = kept.some((n) => (types.get(n.type)?.templates ?? 1) >= 2 && ords.get(n.id)?.has(1));
    const sides: Side[] = reversed ? ["word", "meaning"] : ["word"];
    const cards = [...cardOf.values()];
    const paths = group.map((id) => (names.get(id) ?? "").split("::"));
    const shared = paths.reduce((a, b) => {
      let i = 0;
      while (i < a.length && i < b.length && a[i] === b[i]) i++;
      return a.slice(0, i);
    });
    const label = deckLabel(shared.join("::"));
    const name = !label || /^default$/i.test(label) ? plan.fallbackName : label;
    return [{
      name: name.slice(0, 80),
      notetype: reversed ? "Basic (and reversed card)" : "Basic",
      cards,
      srs: plan.progress ? buildStore(collection, kept, cardOf, sides, now) : null,
      tags: uniqueTags(cards.flatMap((c) => c.tags.split(" "))),
      skipped,
      language: detectLanguage(cards) ?? plan.language,
    }];
  });
}
