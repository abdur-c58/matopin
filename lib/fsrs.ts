/**
 * FSRS-6 memory model and Anki's interval helpers (ankitects/anki rslib/src/scheduler,
 * open-spaced-repetition/fsrs-rs). Ratings are Again=1, Hard=2, Good=3, Easy=4.
 */

export type Rating = 1 | 2 | 3 | 4;
export type FsrsState = "new" | "learning" | "review" | "relearning";
export type Memory = { stability: number; difficulty: number };

const W = [
  0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796,
  1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542,
] as const;

const DECAY = -W[20];
const FACTOR = 0.9 ** (1 / DECAY) - 1;
const S_MIN = 0.001;
export const DAY = 86_400_000;
export const DESIRED_RETENTION = 0.9;

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

function initialDifficulty(rating: Rating, clamped = true): number {
  const value = W[4] - Math.exp(W[5] * (rating - 1)) + 1;
  return clamped ? clamp(value, 1, 10) : value;
}

function nextDifficulty(difficulty: number, rating: Rating): number {
  const delta = -W[6] * (rating - 3);
  const next = difficulty + ((10 - difficulty) * delta) / 9;
  return clamp(W[7] * initialDifficulty(4, false) + (1 - W[7]) * next, 1, 10);
}

function shortTermStability(stability: number, rating: Rating): number {
  let increase = Math.exp(W[17] * (rating - 3 + W[18])) * stability ** -W[19];
  if (rating >= 2) increase = Math.max(increase, 1);
  return Math.max(stability * increase, S_MIN);
}

function recallStability(difficulty: number, stability: number, r: number, rating: Rating): number {
  const hard = rating === 2 ? W[15] : 1;
  const easy = rating === 4 ? W[16] : 1;
  return Math.max(stability * (1 + Math.exp(W[8]) * (11 - difficulty) * stability ** -W[9] * (Math.exp((1 - r) * W[10]) - 1) * hard * easy), S_MIN);
}

function forgetStability(difficulty: number, stability: number, r: number): number {
  const long = W[11] * difficulty ** -W[12] * ((stability + 1) ** W[13] - 1) * Math.exp((1 - r) * W[14]);
  const short = stability / Math.exp(W[17] * W[18]);
  return Math.max(Math.min(long, short), S_MIN);
}

export function retrievability(elapsedDays: number, stability: number): number {
  return (1 + (FACTOR * elapsedDays) / stability) ** DECAY;
}

/** One FSRS step. `elapsedDays` counts day boundaries since the last review; 0 means same day. */
export function nextMemory(memory: Memory | null, elapsedDays: number, rating: Rating): Memory {
  if (!memory) return { stability: Math.max(W[rating - 1], S_MIN), difficulty: initialDifficulty(rating) };
  const { stability, difficulty } = memory;
  let next: number;
  if (elapsedDays === 0) next = shortTermStability(stability, rating);
  else {
    const r = retrievability(elapsedDays, stability);
    next = rating === 1 ? forgetStability(difficulty, stability, r) : recallStability(difficulty, stability, r, rating);
  }
  return { stability: next, difficulty: nextDifficulty(difficulty, rating) };
}

/** Unrounded days until recall probability falls to `retention`. */
export function intervalDays(stability: number, retention = DESIRED_RETENTION): number {
  return (stability / FACTOR) * (retention ** (1 / DECAY) - 1);
}

/** fsrs-rs `memory_state_from_sm2`: the state implied by reaching `interval` at `retention`. */
export function memoryFromSm2(easeFactor: number, interval: number, retention: number): Memory {
  const stability = (Math.max(interval, S_MIN) * FACTOR) / (retention ** (1 / DECAY) - 1);
  const difficulty = 11 - (easeFactor - 1) / (Math.exp(W[8]) * stability ** -W[9] * Math.expm1((1 - retention) * W[10]));
  return { stability, difficulty: clamp(difficulty, 1, 10) };
}

const FUZZ_RANGES = [
  { start: 2.5, end: 7, factor: 0.15 },
  { start: 7, end: 20, factor: 0.1 },
  { start: 20, end: Infinity, factor: 0.05 },
];

function fuzzDelta(interval: number): number {
  if (interval < 2.5) return 0;
  return FUZZ_RANGES.reduce((delta, range) => delta + range.factor * Math.max(Math.min(interval, range.end) - range.start, 0), 1);
}

/** fuzz.rs `constrained_fuzz_bounds`. */
export function fuzzBounds(interval: number, minimum: number, maximum: number): [number, number] {
  const min = Math.min(minimum, maximum);
  const ivl = clamp(interval, min, maximum);
  const delta = fuzzDelta(ivl);
  const lower = clamp(Math.round(ivl - delta), min, maximum);
  let upper = clamp(Math.round(ivl + delta), min, maximum);
  if (upper === lower && upper > 2 && upper < maximum) upper = lower + 1;
  return [lower, upper];
}

export function withFuzz(factor: number | null, interval: number, minimum: number, maximum: number): number {
  if (factor == null) return clamp(Math.round(interval), minimum, maximum);
  const [lower, upper] = fuzzBounds(interval, minimum, maximum);
  return Math.floor(lower + factor * (1 + upper - lower));
}

/** fuzz.rs `minimum_review_fuzz_interval`: fuzz never shortens an interval that grew. */
export function minimumReviewFuzzInterval(interval: number, previous: number, maximum: number): number {
  const [, upper] = fuzzBounds(interval, 1, maximum);
  if (Math.round(interval) > previous) return previous + 1;
  if (previous <= upper) return previous;
  return 0;
}

export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function formatInterval(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(ms / 3_600_000);
  if (hours < 24) return `${hours}h`;
  const days = Math.max(1, Math.round(ms / DAY));
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  const years = days / 365;
  return years < 10 ? `${years.toFixed(1)}y` : `${Math.round(years)}y`;
}
