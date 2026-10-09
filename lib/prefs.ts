import { DEFAULT_LANG, isLang, type Lang } from "./lang";
import { DEFAULT_ACCENT, DEFAULT_SECOND, normalizeHex } from "./theme";

/** One language, or both with a switch between them. */
export type Learning = Lang | "both";
export const isLearning = (v: unknown): v is Learning => isLang(v) || v === "both";

/** Each AI service the app offers, so a learner can turn any of them off. */
export const AI_FEATURES = ["create", "check", "convert", "translate", "bao", "voice"] as const;
export type AiFeature = (typeof AI_FEATURES)[number];
export const isAiFeature = (v: unknown): v is AiFeature => AI_FEATURES.includes(v as AiFeature);
export type AiMode = "all" | "some" | "none";
const isAiMode = (v: unknown): v is AiMode => v === "all" || v === "some" || v === "none";

export const AI_FEATURE_INFO: Record<AiFeature, { label: string; detail: string }> = {
  create: { label: "Card writing", detail: "Fill in card details, make cards from a prompt or text, look up words, and format imports." },
  check: { label: "Card checking", detail: "Find mistakes in a deck’s cards and suggest fixes." },
  convert: { label: "Deck conversion", detail: "Make a Mandarin deck from a Japanese one, or the other way round." },
  translate: { label: "Translation", detail: "Translate text you select anywhere in the app." },
  bao: { label: "Bao, the study bot", detail: "Chat with Bao, and ask it questions in your chats with @ask." },
  voice: { label: "AI voices", detail: "Spoken audio for cards and selected text. Recordings that came with imported decks still play." },
};

/** Profile preferences saved in Supabase, so every device shares them. */
export type Prefs = {
  /** What this profile learns. Null until the learner picks, which the first sign-in asks for. */
  learning: Learning | null;
  dailyGoal: number;
  playbackSpeed: number;
  accent: string;
  /** The second colour, used by Bao, secondary buttons and badges. */
  second: string;
  /** Studying shows pinyin or furigana before the answer. Off hides it until the answer is shown. */
  studyReading: boolean;
  /** Review cards come in a random order instead of by due date. New cards keep their order. */
  studyShuffle: boolean;
  /** Card editing shows only pinyin and meaning until a card is expanded. */
  simplified: boolean;
  /** Recent dictionary lookups, newest first. */
  dictRecent: string[];
  /** Recent Japanese dictionary lookups, newest first. */
  dictRecentJa: string[];
  /**
   * For learners of both, the language to prefer when something could be either. Follows what was used last (a deck
   * opened, a dictionary search), so it rarely needs setting by hand.
   */
  language: Lang;
  /** Which language Bao answers about. "auto" works it out from each question; a language settles unclear ones. */
  botMode: Lang | "auto";
  /** Which AI services this account uses. With "some", only those in `aiFeatures`. */
  aiMode: AiMode;
  aiFeatures: AiFeature[];
};

export function aiAllowed(prefs: Pick<Prefs, "aiMode" | "aiFeatures">, feature: AiFeature): boolean {
  return prefs.aiMode === "all" || (prefs.aiMode === "some" && prefs.aiFeatures.includes(feature));
}

export const PLAYBACK_SPEEDS = [0.5, 0.75, 1, 1.25];
export const MAX_DICT_RECENT = 12;
export const DEFAULT_PREFS: Prefs = { learning: null, dailyGoal: 50, playbackSpeed: 1, accent: DEFAULT_ACCENT, second: DEFAULT_SECOND, studyReading: true, studyShuffle: false, simplified: true, dictRecent: [], dictRecentJa: [], language: DEFAULT_LANG, botMode: "auto", aiMode: "all", aiFeatures: [...AI_FEATURES] };

const recent = (raw: unknown[]) => {
  const words = raw.filter((w): w is string => typeof w === "string").map((w) => w.trim().slice(0, 64)).filter(Boolean);
  return [...new Set(words)].slice(0, MAX_DICT_RECENT);
};

function pick(raw: unknown): Partial<Prefs> {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out: Partial<Prefs> = {};
  if (isLearning(o.learning)) out.learning = o.learning;
  if (typeof o.dailyGoal === "number" && Number.isFinite(o.dailyGoal) && o.dailyGoal >= 1) out.dailyGoal = Math.min(9999, Math.round(o.dailyGoal));
  if (typeof o.playbackSpeed === "number" && PLAYBACK_SPEEDS.includes(o.playbackSpeed)) out.playbackSpeed = o.playbackSpeed;
  const accent = typeof o.accent === "string" ? normalizeHex(o.accent) : null;
  if (accent) out.accent = accent;
  const second = typeof o.second === "string" ? normalizeHex(o.second) : null;
  if (second) out.second = second;
  if (typeof o.simplified === "boolean") out.simplified = o.simplified;
  if (typeof o.studyReading === "boolean") out.studyReading = o.studyReading;
  if (typeof o.studyShuffle === "boolean") out.studyShuffle = o.studyShuffle;
  if (Array.isArray(o.dictRecent)) out.dictRecent = recent(o.dictRecent);
  if (Array.isArray(o.dictRecentJa)) out.dictRecentJa = recent(o.dictRecentJa);
  if (isLang(o.language)) out.language = o.language;
  if (isLang(o.botMode) || o.botMode === "auto") out.botMode = o.botMode;
  if (isAiMode(o.aiMode)) out.aiMode = o.aiMode;
  if (Array.isArray(o.aiFeatures)) out.aiFeatures = AI_FEATURES.filter((f) => (o.aiFeatures as unknown[]).includes(f));
  return out;
}

/** Known keys with valid values only. `partial` keeps just the keys given, for saving a change. */
export function cleanPrefs(raw: unknown): Prefs;
export function cleanPrefs(raw: unknown, partial: true): Partial<Prefs>;
export function cleanPrefs(raw: unknown, partial = false): Prefs | Partial<Prefs> {
  return partial ? pick(raw) : { ...DEFAULT_PREFS, ...pick(raw) };
}
