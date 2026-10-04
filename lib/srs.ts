import { dataKey } from "./profiles";
import { queuePush } from "./sync";
import { splitTags } from "./ai";
import { type Card, type Notetype } from "./cards";
import {
  DAY, formatInterval, intervalDays, memoryFromSm2, minimumReviewFuzzInterval, nextMemory, withFuzz, fuzzBounds,
  type FsrsState, type Memory, type Rating,
} from "./fsrs";

export type Side = "word" | "meaning";
export type InsertionOrder = "sequential" | "random";
export type LeechAction = "tag" | "suspend";
/** Anki's Easy Days values: Normal 1, Reduced 0.5, Minimum 0. Monday first. */
export type EasyDay = 1 | 0.5 | 0;

/** Anki deck options, using Anki's defaults. Steps are in seconds. */
export type ReviewSettings = {
  newPerDay: number;
  reviewsPerDay: number;
  /** Off by default: new cards studied count toward the review limit and stop when it is reached. */
  newIgnoresReviewLimit: boolean;
  learnSteps: number[];
  insertionOrder: InsertionOrder;
  relearnSteps: number[];
  leechThreshold: number;
  leechAction: LeechAction;
  easyDays: EasyDay[];
  maxInterval: number;
  historicalRetention: number;
  /** YYYY-MM-DD, or "" to keep every review. */
  ignoreBefore: string;
};

export const DEFAULT_REVIEW: ReviewSettings = {
  newPerDay: 20,
  reviewsPerDay: 200,
  newIgnoresReviewLimit: false,
  learnSteps: [60, 600],
  insertionOrder: "sequential",
  relearnSteps: [600],
  leechThreshold: 8,
  leechAction: "tag",
  easyDays: [1, 1, 1, 1, 1, 1, 1],
  maxInterval: 36_500,
  historicalRetention: 0.9,
  ignoreBefore: "",
};

export type Schedule = {
  key: string;
  cardId: string;
  side: Side;
  state: FsrsState;
  step: number | null;
  stability: number | null;
  difficulty: number | null;
  due: number;
  lastReview: number | null;
  /** Scheduled review interval in days. */
  interval: number;
  reps: number;
  lapses: number;
  suspended: boolean;
  /** New-card queue position, from the insertion order. */
  position: number;
};

/** One answer. `interval` follows Anki's revlog: days when positive, seconds when negative. */
export type RevlogEntry = {
  key: string;
  at: number;
  rating: Rating;
  kind: "learning" | "review" | "relearning";
  interval: number;
  difficulty: number;
  /** Milliseconds spent on the card, capped like Anki's answer time. Missing on older entries. */
  took?: number;
};

export const MAX_ANSWER_MS = 60_000;

export type Store = {
  cards: Record<string, Schedule>;
  settings: ReviewSettings;
  day: string;
  newToday: number;
  reviewsToday: number;
  nextPosition: number;
  revlog: RevlogEntry[];
};

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

export function reviewable(card: Card): boolean {
  return Boolean(card.term.trim() || card.reading.trim() || card.meaning.trim());
}

export function sidesFor(notetype: Notetype): Side[] {
  return notetype === "Basic (and reversed card)" ? ["word", "meaning"] : ["word"];
}

export function dayKey(now = Date.now()): string {
  const date = new Date(now);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Local midnight `days` days after the day containing `at`. */
function dayStart(at: number, days = 0): number {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return date.getTime();
}

/** Whole days between the local dates of two times, ignoring daylight saving shifts. */
function daysBetween(later: number, earlier: number): number {
  const a = new Date(later);
  const b = new Date(earlier);
  return Math.max(0, Math.round((Date.UTC(a.getFullYear(), a.getMonth(), a.getDate()) - Date.UTC(b.getFullYear(), b.getMonth(), b.getDate())) / DAY));
}

/** Parses Anki step text such as "1m 10m 1d". A bare number is minutes. */
export function parseSteps(text: string): number[] | null {
  const parts = text.trim().split(/[\s,]+/).filter(Boolean);
  const out: number[] = [];
  for (const part of parts) {
    const match = part.match(/^(\d+(?:\.\d+)?)([smhd]?)$/i);
    if (!match) return null;
    const unit = { s: 1, m: 60, h: 3600, d: 86_400, "": 60 }[match[2].toLowerCase() as "s" | "m" | "h" | "d" | ""];
    const seconds = Number(match[1]) * unit;
    if (!(seconds > 0)) return null;
    out.push(Math.round(seconds));
  }
  return out;
}

export function formatSteps(steps: number[]): string {
  return steps.map((s) => (s % 86_400 === 0 ? `${s / 86_400}d` : s % 3600 === 0 ? `${s / 3600}h` : s % 60 === 0 ? `${s / 60}m` : `${s}s`)).join(" ");
}

function cleanSettings(raw: Partial<ReviewSettings> | undefined): ReviewSettings {
  const s = { ...DEFAULT_REVIEW, easyDays: [...DEFAULT_REVIEW.easyDays] };
  if (!raw) return s;
  const num = (v: unknown, fallback: number, min: number, max: number) => (typeof v === "number" && Number.isFinite(v) ? clamp(v, min, max) : fallback);
  const steps = (v: unknown, fallback: number[]) => (Array.isArray(v) && v.every((n) => typeof n === "number" && n > 0) ? (v as number[]) : fallback);
  s.newPerDay = Math.round(num(raw.newPerDay, s.newPerDay, 0, 9999));
  s.reviewsPerDay = Math.round(num(raw.reviewsPerDay, s.reviewsPerDay, 0, 9999));
  s.newIgnoresReviewLimit = raw.newIgnoresReviewLimit === true;
  s.learnSteps = steps(raw.learnSteps, s.learnSteps);
  s.relearnSteps = steps(raw.relearnSteps, s.relearnSteps);
  s.insertionOrder = raw.insertionOrder === "random" ? "random" : "sequential";
  s.leechThreshold = Math.round(num(raw.leechThreshold, s.leechThreshold, 1, 99));
  s.leechAction = raw.leechAction === "suspend" ? "suspend" : "tag";
  if (Array.isArray(raw.easyDays) && raw.easyDays.length === 7) s.easyDays = raw.easyDays.map((d) => (d === 0 || d === 0.5 ? d : 1));
  s.maxInterval = Math.round(num(raw.maxInterval, s.maxInterval, 1, 36_500));
  s.historicalRetention = num(raw.historicalRetention, s.historicalRetention, 0.5, 0.99);
  s.ignoreBefore = typeof raw.ignoreBefore === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.ignoreBefore) ? raw.ignoreBefore : "";
  return s;
}

function emptyStore(): Store {
  return { cards: {}, settings: cleanSettings(undefined), day: dayKey(), newToday: 0, reviewsToday: 0, nextPosition: 0, revlog: [] };
}

export function loadStore(scope: string): Store {
  try {
    const raw = JSON.parse(localStorage.getItem(dataKey(scope, "srs")) ?? "null") as Partial<Store> | null;
    const store = emptyStore();
    store.settings = cleanSettings(raw?.settings);
    if (raw && raw.day === dayKey() && typeof raw.newToday === "number" && typeof raw.reviewsToday === "number") {
      store.day = raw.day;
      store.newToday = raw.newToday;
      store.reviewsToday = raw.reviewsToday;
    }
    if (typeof raw?.nextPosition === "number") store.nextPosition = raw.nextPosition;
    if (Array.isArray(raw?.revlog)) store.revlog = raw.revlog.filter((e) => e && typeof e.key === "string" && typeof e.at === "number");
    if (raw?.cards && typeof raw.cards === "object") {
      for (const [key, card] of Object.entries(raw.cards)) {
        if (!card || typeof card !== "object") continue;
        const state = card.state;
        if (state !== "new" && state !== "learning" && state !== "review" && state !== "relearning") continue;
        const n = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
        const due = n(card.due, 0);
        const lastReview = typeof card.lastReview === "number" ? card.lastReview : null;
        store.cards[key] = {
          key,
          cardId: typeof card.cardId === "string" ? card.cardId : key.split(":")[0] ?? key,
          side: card.side === "meaning" ? "meaning" : "word",
          state,
          step: typeof card.step === "number" ? card.step : null,
          stability: typeof card.stability === "number" ? card.stability : null,
          difficulty: typeof card.difficulty === "number" ? card.difficulty : null,
          due,
          lastReview,
          interval: n(card.interval, state === "review" && lastReview != null ? Math.max(1, Math.round((due - lastReview) / DAY)) : 0),
          reps: n(card.reps, 0),
          lapses: n(card.lapses, 0),
          suspended: card.suspended === true,
          position: n(card.position, store.nextPosition),
        };
      }
    }
    return store;
  } catch {
    return emptyStore();
  }
}

export function saveStore(scope: string, store: Store) {
  try { localStorage.setItem(dataKey(scope, "srs"), JSON.stringify(store)); } catch { /* the deck still works if storage is full */ }
  queuePush(scope, "srs");
}

function newPosition(store: Store, cardId: string): number {
  for (const side of ["word", "meaning"] as const) {
    const sibling = store.cards[`${cardId}:${side}`];
    if (sibling) return sibling.position;
  }
  if (store.settings.insertionOrder === "random") return Math.floor(Math.random() * 1_000_000);
  return store.nextPosition++;
}

function ensure(store: Store, card: Card, side: Side): Schedule {
  const key = `${card.id}:${side}`;
  const existing = store.cards[key];
  if (existing) return existing;
  const created: Schedule = {
    key, cardId: card.id, side, state: "new", step: null, stability: null, difficulty: null, due: 0, lastReview: null,
    interval: 0, reps: 0, lapses: 0, suspended: false, position: newPosition(store, card.id),
  };
  store.cards[key] = created;
  return created;
}

/** Anki repositions new cards when the insertion order changes. Sequential follows the deck's card order. */
export function repositionNew(store: Store, cards: Card[]) {
  const ids = cards.map((c) => c.id);
  const random = new Map(ids.map((id) => [id, Math.floor(Math.random() * 1_000_000)]));
  for (const schedule of Object.values(store.cards)) {
    if (schedule.state !== "new") continue;
    schedule.position = store.settings.insertionOrder === "random" ? random.get(schedule.cardId) ?? 0 : Math.max(0, ids.indexOf(schedule.cardId));
  }
  store.nextPosition = ids.length;
}

export type QueueItem = { card: Card; schedule: Schedule };

export type Session = {
  item: QueueItem | null;
  /** Everything due now in study order; `item` is its first. */
  queue: QueueItem[];
  waitMs: number | null;
  /** Learning cards still on their timer that come due before tomorrow, and how long until the last of them. */
  laterToday: { count: number; lastMs: number };
  newToday: number;
  reviewsToday: number;
  settings: ReviewSettings;
  counts: { new: number; learning: number; review: number };
  /** What is left today after the daily limits, like Anki's deck list. Learning includes cards still on their timer. */
  due: { new: number; learning: number; review: number };
  suspended: number;
};

const SIDE_ORDER: Record<Side, number> = { word: 0, meaning: 1 };
const isLearning = (s: Schedule) => s.state === "learning" || s.state === "relearning";

export function buildSession(cards: Card[], notetype: Notetype, store: Store, now = Date.now()): Session {
  if (store.day !== dayKey(now)) {
    store.day = dayKey(now);
    store.newToday = 0;
    store.reviewsToday = 0;
  }
  const live = new Set(cards.filter(reviewable).map((card) => card.id));
  for (const key of Object.keys(store.cards)) {
    if (!live.has(store.cards[key].cardId)) delete store.cards[key];
  }
  if (store.revlog.some((e) => !store.cards[e.key])) store.revlog = store.revlog.filter((e) => store.cards[e.key]);
  const all: QueueItem[] = [];
  for (const card of cards) {
    if (!reviewable(card)) continue;
    for (const side of sidesFor(notetype)) all.push({ card, schedule: ensure(store, card, side) });
  }
  const items = all.filter((item) => !item.schedule.suspended);

  const learning = items.filter((item) => isLearning(item.schedule) && item.schedule.due <= now).sort((a, b) => a.schedule.due - b.schedule.due);
  const review = items.filter((item) => item.schedule.state === "review" && item.schedule.due <= now).sort((a, b) => a.schedule.due - b.schedule.due);
  const fresh = items
    .filter((item) => item.schedule.state === "new" && item.schedule.due <= now)
    .sort((a, b) => a.schedule.position - b.schedule.position || SIDE_ORDER[a.schedule.side] - SIDE_ORDER[b.schedule.side]);
  // limits.rs RemainingLimits: unless new cards ignore the review limit, new cards studied use up review
  // capacity, and new cards are capped by what the review limit leaves after today's reviews.
  const { settings } = store;
  const reviewLeft = Math.max(0, settings.reviewsPerDay - store.reviewsToday - (settings.newIgnoresReviewLimit ? 0 : store.newToday));
  const reviewsShown = review.slice(0, reviewLeft);
  const newCap = Math.max(0, settings.newPerDay - store.newToday);
  const newLeft = settings.newIgnoresReviewLimit ? newCap : Math.min(newCap, reviewLeft - reviewsShown.length);
  const queue = [...learning, ...reviewsShown, ...fresh.slice(0, newLeft)];
  const waitingAll = items.filter((item) => isLearning(item.schedule) && item.schedule.due > now).sort((a, b) => a.schedule.due - b.schedule.due);
  const waiting = waitingAll[0];
  const today = waitingAll.filter((item) => item.schedule.due < dayStart(now, 1));

  return {
    item: queue[0] ?? null,
    queue,
    waitMs: queue.length || !waiting ? null : waiting.schedule.due - now,
    laterToday: { count: today.length, lastMs: today.length ? today[today.length - 1].schedule.due - now : 0 },
    newToday: store.newToday,
    reviewsToday: store.reviewsToday,
    settings: store.settings,
    counts: { new: fresh.length, learning: items.filter((item) => isLearning(item.schedule)).length, review: review.length },
    due: {
      new: Math.min(fresh.length, newLeft),
      learning: items.filter((item) => isLearning(item.schedule) && item.schedule.due < dayStart(now, 1)).length,
      review: Math.min(review.length, reviewLeft),
    },
    suspended: all.length - items.length,
  };
}

/** review.rs: a leech at the threshold, then every half threshold (rounded up). */
export function leechThresholdMet(lapses: number, threshold: number): boolean {
  if (threshold <= 0) return false;
  const half = Math.max(1, Math.ceil(threshold / 2));
  return lapses >= threshold && (lapses - threshold) % half === 0;
}

/** steps.rs: the delay for an answer while on learning step `step`, or graduation. */
function stepDelay(steps: number[], step: number, rating: Rating): { graduate: boolean; step: number; delay: number } {
  if (!steps.length) return { graduate: true, step: 0, delay: 0 };
  if (rating === 1) return { graduate: false, step: 0, delay: steps[0] };
  if (rating === 2) {
    if (step === 0) {
      const delay = steps.length === 1 ? Math.min(steps[0] * 1.5, steps[0] + 86_400) : (steps[0] + steps[1]) / 2;
      return { graduate: false, step, delay };
    }
    return { graduate: false, step, delay: steps[Math.min(step, steps.length - 1)] };
  }
  if (rating === 4 || step + 1 >= steps.length) return { graduate: true, step: 0, delay: 0 };
  return { graduate: false, step: step + 1, delay: steps[step + 1] };
}

type Balancer = (interval: number, minimum: number, maximum: number) => number | null;
type Ctx = { settings: ReviewSettings; now: number; fuzz: boolean; balance: Balancer | null };

/** load_balancer.rs `find_interval`, with Easy Days and sibling spreading. */
function makeBalancer(store: Store, schedule: Schedule, now: number): Balancer {
  const MAX_BALANCE = 90;
  const counts = new Map<number, number>();
  const siblingDays = new Set<number>();
  for (const other of Object.values(store.cards)) {
    if (other.key === schedule.key || other.state !== "review" || other.suspended) continue;
    const day = daysBetween(other.due, dayStart(now));
    if (day > MAX_BALANCE * 1.1) continue;
    counts.set(day, (counts.get(day) ?? 0) + 1);
    if (other.cardId === schedule.cardId) siblingDays.add(day);
  }
  const STEPS = [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5];
  const RANGE = [1, 0.8, 0.6, 0.4, 0.2, 0.000001, 0.2, 0.4, 0.6, 0.8, 1];
  const load = (d: EasyDay) => (d === 1 ? 1 : d === 0 ? 0.0001 : 0.5);

  return (interval, minimum, maximum) => {
    if (interval > MAX_BALANCE || minimum > MAX_BALANCE) return null;
    const [lower, upper] = fuzzBounds(interval, minimum, maximum);
    const days = Array.from({ length: upper - lower + 1 }, (_, i) => lower + i);
    const reviewCounts = days.map((d) => counts.get(d) ?? 0);
    const weekdays = days.map((d) => (new Date(dayStart(now, d)).getDay() + 6) % 7);
    const easy = weekdays.map((w) => store.settings.easyDays[w]);
    const total = reviewCounts.reduce((a, b) => a + b, 0);
    const totalPercent = easy.reduce<number>((a, d) => a + load(d), 0);
    const easyMod = easy.map((d, i) => {
      if (d !== 0.5) return load(d);
      const threshold = (total - reviewCounts[i]) / (totalPercent - 0.5);
      return reviewCounts[i] / 0.5 > threshold ? load(0) : load(1);
    });
    const sibling = days.map(() => 1);
    for (const sd of siblingDays) {
      STEPS.forEach((step, j) => {
        const index = sd + step - lower;
        if (index >= 0 && index < sibling.length) sibling[index] *= RANGE[j];
      });
    }
    const weights = days.map((d, i) => (reviewCounts[i] === 0 ? 1 : (1 / reviewCounts[i]) ** 2.15 * (1 / d) ** 3 * sibling[i] * easyMod[i]));
    const sum = weights.reduce((a, b) => a + b, 0);
    if (!(sum > 0)) return null;
    let pick = Math.random() * sum;
    for (let i = 0; i < days.length; i++) {
      pick -= weights[i];
      if (pick <= 0) return days[i];
    }
    return days[days.length - 1];
  };
}

/** review.rs `constrain_passing_interval`. */
function passing(ctx: Ctx, interval: number, minimum: number): number {
  const maximum = Math.max(1, ctx.settings.maxInterval);
  const min = clamp(minimum, 1, maximum);
  if (!ctx.fuzz) return clamp(Math.round(interval), min, maximum);
  return ctx.balance?.(interval, min, maximum) ?? withFuzz(Math.random(), interval, min, maximum);
}

type Outcome = { next: Schedule; leeched: boolean; kind: RevlogEntry["kind"] };

function memoryOf(s: Schedule): Memory | null {
  return s.stability == null || s.difficulty == null ? null : { stability: s.stability, difficulty: s.difficulty };
}

function schedule(card: Schedule, rating: Rating, ctx: Ctx): Outcome {
  const { now, settings } = ctx;
  const elapsed = card.lastReview == null ? 0 : daysBetween(now, card.lastReview);
  const memories = ([1, 2, 3, 4] as Rating[]).map((r) => nextMemory(memoryOf(card), elapsed, r));
  const memory = memories[rating - 1];
  const next: Schedule = { ...card, stability: memory.stability, difficulty: memory.difficulty, lastReview: now, reps: card.reps + 1 };
  let leeched = false;
  const kind: RevlogEntry["kind"] = card.state === "review" ? "review" : card.state === "relearning" ? "relearning" : "learning";
  const toReview = (days: number) => { next.state = "review"; next.step = null; next.interval = days; next.due = dayStart(now, days); };

  if (card.state === "review") {
    if (rating === 1) {
      next.lapses = card.lapses + 1;
      leeched = leechThresholdMet(next.lapses, settings.leechThreshold);
      const againDays = clamp(Math.max(1, Math.round(intervalDays(memory.stability))), 1, settings.maxInterval);
      if (settings.relearnSteps.length) {
        next.state = "relearning";
        next.step = 0;
        next.interval = againDays;
        const first = settings.relearnSteps[0];
        next.due = first >= 86_400 ? dayStart(now + first * 1000) : now + first * 1000;
      } else toReview(againDays);
    } else {
      const raw = memories.map((m) => intervalDays(m.stability));
      const hard = passing(ctx, raw[1], Math.max(1, minimumReviewFuzzInterval(raw[1], card.interval, settings.maxInterval)));
      const good = passing(ctx, raw[2], Math.max(hard + 1, minimumReviewFuzzInterval(raw[2], card.interval, settings.maxInterval)));
      const easy = passing(ctx, raw[3], Math.max(good + 1, minimumReviewFuzzInterval(raw[3], card.interval, settings.maxInterval)));
      toReview(rating === 2 ? hard : rating === 3 ? good : easy);
    }
  } else {
    const steps = card.state === "relearning" ? settings.relearnSteps : settings.learnSteps;
    const step = card.state === "new" ? 0 : card.step ?? 0;
    const moved = stepDelay(steps, step, rating);
    if (moved.graduate) {
      const goodGraduates = stepDelay(steps, step, 3).graduate;
      let minimum = 1;
      if (rating === 4 && goodGraduates) minimum = passing({ ...ctx, fuzz: false }, intervalDays(memories[2].stability), 1) + 1;
      toReview(passing(ctx, intervalDays(memory.stability), minimum));
    } else {
      next.state = card.state === "relearning" ? "relearning" : "learning";
      next.step = moved.step;
      // Interday learning: a step of a day or more is due from the start of its day, not to the second.
      next.due = moved.delay >= 86_400 ? dayStart(now + moved.delay * 1000) : now + moved.delay * 1000;
    }
  }
  return { next, leeched, kind };
}

export type AnswerResult = { schedule: Schedule; leeched: boolean };

export function answer(store: Store, item: QueueItem, rating: Rating, now = Date.now(), took?: number): AnswerResult {
  const before = item.schedule.state;
  const { next, leeched, kind } = schedule(item.schedule, rating, { settings: store.settings, now, fuzz: true, balance: makeBalancer(store, item.schedule, now) });
  if (leeched && store.settings.leechAction === "suspend") next.suspended = true;
  store.cards[next.key] = next;
  store.revlog.push({
    key: next.key, at: now, rating, kind,
    interval: next.state === "review" ? next.interval : -Math.round((next.due - now) / 1000),
    difficulty: next.difficulty ?? 5,
    ...(took != null && { took: Math.round(Math.min(Math.max(0, took), MAX_ANSWER_MS)) }),
  });
  if (before === "new") store.newToday += 1;
  if (before === "review") store.reviewsToday += 1;
  const sibling = store.cards[`${item.card.id}:${item.schedule.side === "word" ? "meaning" : "word"}`];
  if (sibling && (sibling.state === "new" || sibling.state === "review") && sibling.due <= dayStart(now, 1)) sibling.due = dayStart(now, 1);
  return { schedule: next, leeched };
}

export function previews(store: Store, card: Schedule, now = Date.now()): Record<Rating, string> {
  const ctx: Ctx = { settings: store.settings, now, fuzz: false, balance: null };
  const label = (r: Rating) => formatInterval(schedule(card, r, ctx).next.due - now);
  return { 1: label(1), 2: label(2), 3: label(3), 4: label(4) };
}

export function patchSettings(store: Store, patch: Partial<ReviewSettings>) {
  store.settings = cleanSettings({ ...store.settings, ...patch });
}

export function unsuspend(store: Store, key: string) {
  const card = store.cards[key];
  if (card) card.suspended = false;
}

/** Adds Anki's "leech" tag to the card in the deck. */
export function tagLeech(scope: string, cardId: string) {
  try {
    const key = dataKey(scope, "v2");
    const saved = JSON.parse(localStorage.getItem(key) ?? "null") as { cards?: Card[] } | null;
    const card = saved?.cards?.find((c) => c.id === cardId);
    if (!saved || !card) return;
    const tags = splitTags(card.tags ?? "");
    if (tags.includes("leech")) return;
    card.tags = [...tags, "leech"].join(" ");
    localStorage.setItem(key, JSON.stringify(saved));
    queuePush(scope, "deck");
  } catch {}
}

/**
 * memory_state.rs `fsrs_item_for_memory_state` with reviews_for_fsrs (not training).
 * Reviews before `ignoreBefore` are dropped; a history that no longer starts with learning
 * begins from the SM-2 state implied by its first interday review at the historical retention.
 */
function memoryFromHistory(entries: RevlogEntry[], settings: ReviewSettings, card: Schedule): Memory | null | undefined {
  if (!entries.length) return undefined;
  const cutoff = settings.ignoreBefore ? new Date(`${settings.ignoreBefore}T00:00:00`).getTime() : 0;
  let firstLearn: number | null = null;
  let firstGrade: number | null = null;
  let complete = false;
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.at > cutoff && (e.interval >= 1 || e.interval <= -86_400)) firstGrade = i;
    if (e.kind === "learning") { firstLearn = i; complete = true; }
    else if (firstLearn != null) break;
  }
  if (firstLearn != null && entries[firstLearn].at < cutoff && firstLearn < entries.length - 1) {
    complete = false;
    firstLearn = null;
  }
  const fromCard = () => (card.state === "new" || card.interval === 0 ? null : memoryFromSm2(2.5, card.interval, settings.historicalRetention));
  let kept: RevlogEntry[];
  if (firstLearn != null) kept = entries.slice(firstLearn);
  else if (firstGrade != null) kept = entries.slice(firstGrade);
  else return fromCard();
  let memory: Memory | null = null;
  let start = 0;
  if (!complete) {
    // memory_state.rs: a truncated history starts from SM-2 at the first kept review, which is then dropped.
    if (kept.length < 2) return fromCard();
    memory = memoryFromSm2(2.5, Math.max(1, kept[0].interval), settings.historicalRetention);
    start = 1;
  }
  for (let i = start; i < kept.length; i++) {
    const elapsed = i === 0 ? 0 : daysBetween(kept[i].at, kept[i - 1].at);
    memory = nextMemory(memory, elapsed, kept[i].rating);
  }
  return memory;
}

/** Recomputes every card's stability and difficulty from its history, like saving Anki's deck options. Due dates stay. */
export function recomputeMemory(store: Store) {
  const byKey = new Map<string, RevlogEntry[]>();
  for (const e of [...store.revlog].sort((a, b) => a.at - b.at)) {
    const list = byKey.get(e.key) ?? [];
    list.push(e);
    byKey.set(e.key, list);
  }
  for (const card of Object.values(store.cards)) {
    const memory = memoryFromHistory(byKey.get(card.key) ?? [], store.settings, card);
    if (memory === undefined) continue;
    card.stability = memory?.stability ?? null;
    card.difficulty = memory?.difficulty ?? null;
  }
}

export type { FsrsState, Rating };
