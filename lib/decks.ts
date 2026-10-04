import { dataKey } from "./profiles";
import { isDeckRole, isVisibility, type DeckMeta } from "./social";
import { buildSession, loadStore, reviewable } from "./srs";
import { DEFAULT_LANG, LANG_INFO, type Lang } from "./lang";
import { DEFAULT_SETTINGS, deckLanguage, normalizeCard, type Card, type Notetype, type Settings } from "./zige";

export type DeckSummary = DeckMeta & {
  id: string;
  name: string;
  language: Lang;
  cards: number;
  due: { new: number; learning: number; review: number };
};

const KINDS = ["v2", "tags", "srs", "rev", "meta"] as const;

/** Decks made before sharing existed have no meta, so they read as this profile's own private deck. */
export function readMeta(scope: string): DeckMeta {
  const profile = scope.slice(0, scope.indexOf(":"));
  try {
    const raw = JSON.parse(localStorage.getItem(dataKey(scope, "meta")) ?? "null") as Partial<DeckMeta> | null;
    if (raw && isDeckRole(raw.role) && isVisibility(raw.visibility)) {
      return { role: raw.role, visibility: raw.visibility, ownerId: typeof raw.ownerId === "string" ? raw.ownerId : profile, ownerName: typeof raw.ownerName === "string" ? raw.ownerName : null };
    }
  } catch {}
  return { role: "owner", visibility: "private", ownerId: profile, ownerName: null };
}

export function writeMeta(scope: string, meta: DeckMeta) {
  localStorage.setItem(dataKey(scope, "meta"), JSON.stringify(meta));
}
const indexKey = (profile: string) => `zige:${profile}:decks`;

export const deckScope = (profile: string, deckId: string) => `${profile}:${deckId}`;

export const DECKS_CHANGED = "zige:decks-changed";
export function notifyDecks() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(DECKS_CHANGED));
}

export function writeIndex(profile: string, ids: string[]) {
  localStorage.setItem(indexKey(profile), JSON.stringify({ decks: ids }));
  notifyDecks();
}

export function readSaved(scope: string): { cards?: Partial<Card>[]; settings?: Partial<Settings> } | null {
  try {
    return JSON.parse(localStorage.getItem(dataKey(scope, "v2")) ?? "null") as { cards?: Partial<Card>[]; settings?: Partial<Settings> } | null;
  } catch {
    return null;
  }
}

/** Deck ids for a profile. The first call moves a deck saved before decks existed into the list. */
export function listDeckIds(profile: string): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(indexKey(profile)) ?? "null") as { decks?: unknown } | null;
    if (Array.isArray(raw?.decks)) return raw.decks.filter((id): id is string => typeof id === "string");
  } catch {}
  const legacy = readSaved(profile);
  const ids: string[] = [];
  if (legacy?.cards?.some((card) => reviewable(normalizeCard(card)))) {
    const id = crypto.randomUUID();
    for (const kind of KINDS) {
      const value = localStorage.getItem(dataKey(profile, kind));
      if (value != null) localStorage.setItem(dataKey(deckScope(profile, id), kind), value);
    }
    ids.push(id);
  }
  for (const kind of KINDS) localStorage.removeItem(dataKey(profile, kind));
  writeIndex(profile, ids);
  return ids;
}

/** Creates the deck in this browser. Call `pushNow` to save it to Supabase. */
export function createDeck(profile: string, language: Lang = DEFAULT_LANG): string {
  const ids = listDeckIds(profile);
  const names = new Set(ids.map((id) => readSaved(deckScope(profile, id))?.settings?.deck));
  const base = LANG_INFO[language].deckName;
  let name = base;
  for (let n = 2; names.has(name); n++) name = `${base} ${n}`;
  const id = crypto.randomUUID();
  localStorage.setItem(dataKey(deckScope(profile, id), "v2"), JSON.stringify({ cards: [], settings: { ...DEFAULT_SETTINGS, deck: name, language } }));
  writeIndex(profile, [...ids, id]);
  return id;
}

/** Creates a filled deck in this browser, such as one imported from Anki. Call `pushNow` to save it to Supabase. */
export function addDeck(profile: string, deck: { name: string; notetype: Notetype; cards: Card[]; srs: unknown; tags: string[]; language: Lang }): string {
  const id = crypto.randomUUID();
  const scope = deckScope(profile, id);
  try {
    localStorage.setItem(dataKey(scope, "v2"), JSON.stringify({ cards: deck.cards, settings: { ...DEFAULT_SETTINGS, deck: deck.name, notetype: deck.notetype, language: deck.language } }));
    localStorage.setItem(dataKey(scope, "tags"), JSON.stringify(deck.tags));
    if (deck.srs) localStorage.setItem(dataKey(scope, "srs"), JSON.stringify(deck.srs));
  } catch {
    for (const kind of KINDS) localStorage.removeItem(dataKey(scope, kind));
    throw new Error(`“${deck.name}” is too large to store in this browser. Try again without your review progress, or import fewer decks at once.`);
  }
  writeIndex(profile, [...listDeckIds(profile), id]);
  return id;
}

export function deleteLocalDeck(profile: string, id: string) {
  writeIndex(profile, listDeckIds(profile).filter((deckId) => deckId !== id));
  for (const kind of KINDS) localStorage.removeItem(dataKey(deckScope(profile, id), kind));
}

export function summarizeDecks(profile: string, now: number): DeckSummary[] {
  return listDeckIds(profile).map((id) => {
    const scope = deckScope(profile, id);
    const saved = readSaved(scope);
    const cards = (saved?.cards ?? []).map((card) => normalizeCard(card));
    const notetype: Notetype = saved?.settings?.notetype === "Basic (and reversed card)" ? "Basic (and reversed card)" : "Basic";
    const session = buildSession(cards, notetype, loadStore(scope), now);
    return { ...readMeta(scope), id, name: saved?.settings?.deck?.trim() || "Untitled deck", language: deckLanguage(saved?.settings), cards: cards.filter(reviewable).length, due: session.due };
  });
}
