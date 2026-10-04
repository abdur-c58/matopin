import { deckScope, listDeckIds, readSaved } from "./decks";
import { buildSession, dayKey, loadStore, reviewable, sidesFor, type RevlogEntry, type Session, type Store } from "./srs";
import { normalizeCard, type Card, type Notetype } from "./cards";

export type DeckData = {
  id: string;
  name: string;
  cards: Card[];
  notetype: Notetype;
  store: Store;
  session: Session;
};

export type Entry = RevlogEntry & { deck: string };

/** Answers saved before timing was recorded count as this long, close to Anki's typical answer time. */
export const ESTIMATED_ANSWER_MS = 8_000;
export const MATURE_DAYS = 21;

export function loadProfileData(profile: string, now = Date.now()): DeckData[] {
  return listDeckIds(profile).map((id) => {
    const scope = deckScope(profile, id);
    const saved = readSaved(scope);
    const cards = (saved?.cards ?? []).map((card) => normalizeCard(card)).filter(reviewable);
    const notetype: Notetype = saved?.settings?.notetype === "Basic (and reversed card)" ? "Basic (and reversed card)" : "Basic";
    const store = loadStore(scope);
    const session = buildSession(cards, notetype, store, now);
    return { id, name: saved?.settings?.deck?.trim() || "Untitled deck", cards, notetype, store, session };
  });
}

export function entriesOf(decks: DeckData[]): Entry[] {
  return decks.flatMap((deck) => deck.store.revlog.map((e) => ({ ...e, deck: deck.id }))).sort((a, b) => a.at - b.at);
}

export const answerMs = (e: RevlogEntry) => e.took ?? ESTIMATED_ANSWER_MS;
export const studyMs = (entries: RevlogEntry[]) => entries.reduce((sum, e) => sum + answerMs(e), 0);

export function startOfDay(at: number, offset = 0): number {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + offset);
  return date.getTime();
}

export type Day = {
  key: string;
  start: number;
  reviews: number;
  learning: number;
  review: number;
  relearning: number;
  again: number;
  ms: number;
};

function emptyDay(start: number): Day {
  return { key: dayKey(start), start, reviews: 0, learning: 0, review: 0, relearning: 0, again: 0, ms: 0 };
}

export function groupByDay(entries: RevlogEntry[]): Map<string, Day> {
  const days = new Map<string, Day>();
  for (const e of entries) {
    const key = dayKey(e.at);
    const day = days.get(key) ?? emptyDay(startOfDay(e.at));
    day.reviews += 1;
    day[e.kind] += 1;
    if (e.rating === 1) day.again += 1;
    day.ms += answerMs(e);
    days.set(key, day);
  }
  return days;
}

/** The last `count` days, oldest first, ending today. */
export function lastDays(entries: RevlogEntry[], count: number, now = Date.now()): Day[] {
  const days = groupByDay(entries);
  return Array.from({ length: count }, (_, i) => {
    const start = startOfDay(now, i - count + 1);
    return days.get(dayKey(start)) ?? emptyDay(start);
  });
}

export function streaks(entries: RevlogEntry[], now = Date.now()): { current: number; longest: number } {
  const active = new Set(entries.map((e) => dayKey(e.at)));
  let current = 0;
  // A streak survives until the end of today, so it counts back from yesterday when today has no reviews yet.
  for (let offset = active.has(dayKey(now)) ? 0 : -1; active.has(dayKey(startOfDay(now, offset))); offset--) current++;
  const sorted = [...active].sort();
  let longest = 0;
  let run = 0;
  let previous: number | null = null;
  for (const key of sorted) {
    const start = new Date(`${key}T00:00:00`).getTime();
    run = previous != null && startOfDay(previous, 1) === start ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = start;
  }
  return { current, longest };
}

/** Share of review-state answers that were not Again, like Anki's true retention. */
export function retention(entries: RevlogEntry[]): number | null {
  const reviews = entries.filter((e) => e.kind === "review");
  if (!reviews.length) return null;
  return reviews.filter((e) => e.rating > 1).length / reviews.length;
}

export function ratingCounts(entries: RevlogEntry[]): Record<1 | 2 | 3 | 4, number> {
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const e of entries) counts[e.rating] += 1;
  return counts;
}

export type CardStates = { new: number; learning: number; young: number; mature: number; suspended: number };

export function cardStates(decks: DeckData[]): CardStates {
  const states: CardStates = { new: 0, learning: 0, young: 0, mature: 0, suspended: 0 };
  for (const deck of decks) {
    for (const card of deck.cards) {
      for (const side of sidesFor(deck.notetype)) {
        const s = deck.store.cards[`${card.id}:${side}`];
        if (!s || s.state === "new") states.new += s?.suspended ? 0 : 1;
        if (!s) continue;
        if (s.suspended) states.suspended += 1;
        else if (s.state === "learning" || s.state === "relearning") states.learning += 1;
        else if (s.state === "review") states[s.interval >= MATURE_DAYS ? "mature" : "young"] += 1;
      }
    }
  }
  return states;
}

/** Cards already in learning or review that fall due on each of the next `count` days. Overdue cards count today. */
export function forecast(decks: DeckData[], count: number, now = Date.now()): number[] {
  const out = Array.from({ length: count }, () => 0);
  const today = startOfDay(now);
  for (const deck of decks) {
    for (const s of Object.values(deck.store.cards)) {
      if (s.suspended || s.state === "new") continue;
      const offset = Math.max(0, Math.round((startOfDay(s.due) - today) / 86_400_000));
      if (offset < count) out[offset] += 1;
    }
  }
  return out;
}

export function byHour(entries: RevlogEntry[]): number[] {
  const hours = Array.from({ length: 24 }, () => 0);
  for (const e of entries) hours[new Date(e.at).getHours()] += 1;
  return hours;
}

export function dueToday(decks: DeckData[]): number {
  return decks.reduce((sum, d) => sum + d.session.due.new + d.session.due.learning + d.session.due.review, 0);
}

export function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}