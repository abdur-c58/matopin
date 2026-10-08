import { splitTags, uniqueTags } from "./ai";
import { DEFAULT_SETTINGS, normalizeCard, type Card, type Settings } from "./cards";
import { createDeck, deckScope, notifyDecks, readSaved } from "./decks";
import type { Lang } from "./lang";
import { dataKey } from "./profiles";
import { loadStore, saveStore } from "./srs";
import { pushNow, queuePush } from "./sync";

export type TransferMode = "move" | "copy";

/** Makes an empty deck with this name. Call `pushNow` once its cards are in. */
export function createNamedDeck(profile: string, name: string, language: Lang): string {
  const id = createDeck(profile, language);
  const scope = deckScope(profile, id);
  const saved = readSaved(scope);
  const settings: Settings = { ...DEFAULT_SETTINGS, ...saved?.settings, deck: name.trim() || saved?.settings?.deck || DEFAULT_SETTINGS.deck, language };
  localStorage.setItem(dataKey(scope, "v2"), JSON.stringify({ cards: [], settings }));
  return id;
}

function appendCards(scope: string, cards: Card[]) {
  const saved = readSaved(scope);
  const existing = (saved?.cards ?? []).map((c) => normalizeCard(c)).filter((c) => c.term.trim() || c.reading.trim() || c.meaning.trim());
  localStorage.setItem(dataKey(scope, "v2"), JSON.stringify({ cards: [...existing, ...cards], settings: { ...DEFAULT_SETTINGS, ...saved?.settings } }));
  let tags: string[] = [];
  try { tags = JSON.parse(localStorage.getItem(dataKey(scope, "tags")) ?? "[]") as string[]; } catch {}
  const next = uniqueTags([...(Array.isArray(tags) ? tags.filter((t) => typeof t === "string") : []), ...cards.flatMap((c) => splitTags(c.tags))]);
  localStorage.setItem(dataKey(scope, "tags"), JSON.stringify(next));
}

/**
 * Puts cards into another deck. Copies are new cards that start unlearned; moved cards keep their ids and take
 * their schedules and review history along. The caller removes moved cards from the deck they came from.
 */
export function transferCards(profile: string, fromId: string, toId: string, cards: Card[], mode: TransferMode) {
  const from = deckScope(profile, fromId);
  const to = deckScope(profile, toId);
  const moving = mode === "move";
  appendCards(to, moving ? cards : cards.map((c) => ({ ...c, id: crypto.randomUUID() })));
  if (moving) {
    const ids = new Set(cards.map((c) => c.id));
    const source = loadStore(from);
    const target = loadStore(to);
    const keys = new Set<string>();
    for (const [key, schedule] of Object.entries(source.cards)) {
      if (!ids.has(schedule.cardId)) continue;
      keys.add(key);
      target.cards[key] = { ...schedule, position: schedule.state === "new" ? target.nextPosition++ : schedule.position };
      delete source.cards[key];
    }
    if (keys.size) {
      target.revlog = [...target.revlog, ...source.revlog.filter((e) => keys.has(e.key))].sort((a, b) => a.at - b.at);
      source.revlog = source.revlog.filter((e) => !keys.has(e.key));
      saveStore(to, target);
      saveStore(from, source);
    }
  }
  queuePush(to, "deck");
  queuePush(to, "tags");
  notifyDecks();
}

/** Saves a deck made by `createNamedDeck` right away, or once the connection is back. */
export const saveNewDeck = (profile: string, id: string) => pushNow(deckScope(profile, id));
