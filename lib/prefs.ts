import { DEFAULT_LANG, isLang, type Lang } from "./lang";
import { DEFAULT_ACCENT, DEFAULT_SECOND, normalizeHex } from "./theme";

/** Profile preferences saved in Supabase, so every device shares them. */
export type Prefs = {
  dailyGoal: number;
  playbackSpeed: number;
  accent: string;
  /** The second colour, used by Bao, secondary buttons and badges. */
  second: string;
  /** Card editing shows only pinyin and meaning until a card is expanded. */
  simplified: boolean;
  /** Recent dictionary lookups, newest first. */
  dictRecent: string[];
  /** Recent Japanese dictionary lookups, newest first. */
  dictRecentJa: string[];
  /** The language being learned: which dictionary, rail labels and deck filter the app opens with. */
  language: Lang;
  /** Which language Bao assumes when a question doesn't say. "auto" follows `language`. */
  botMode: Lang | "auto";
};

export const PLAYBACK_SPEEDS = [0.5, 0.75, 1, 1.25];
export const MAX_DICT_RECENT = 12;
export const DEFAULT_PREFS: Prefs = { dailyGoal: 50, playbackSpeed: 1, accent: DEFAULT_ACCENT, second: DEFAULT_SECOND, simplified: true, dictRecent: [], dictRecentJa: [], language: DEFAULT_LANG, botMode: "auto" };

const recent = (raw: unknown[]) => {
  const words = raw.filter((w): w is string => typeof w === "string").map((w) => w.trim().slice(0, 64)).filter(Boolean);
  return [...new Set(words)].slice(0, MAX_DICT_RECENT);
};

function pick(raw: unknown): Partial<Prefs> {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out: Partial<Prefs> = {};
  if (typeof o.dailyGoal === "number" && Number.isFinite(o.dailyGoal) && o.dailyGoal >= 1) out.dailyGoal = Math.min(9999, Math.round(o.dailyGoal));
  if (typeof o.playbackSpeed === "number" && PLAYBACK_SPEEDS.includes(o.playbackSpeed)) out.playbackSpeed = o.playbackSpeed;
  const accent = typeof o.accent === "string" ? normalizeHex(o.accent) : null;
  if (accent) out.accent = accent;
  const second = typeof o.second === "string" ? normalizeHex(o.second) : null;
  if (second) out.second = second;
  if (typeof o.simplified === "boolean") out.simplified = o.simplified;
  if (Array.isArray(o.dictRecent)) out.dictRecent = recent(o.dictRecent);
  if (Array.isArray(o.dictRecentJa)) out.dictRecentJa = recent(o.dictRecentJa);
  if (isLang(o.language)) out.language = o.language;
  if (isLang(o.botMode) || o.botMode === "auto") out.botMode = o.botMode;
  return out;
}

/** Known keys with valid values only. `partial` keeps just the keys given, for saving a change. */
export function cleanPrefs(raw: unknown): Prefs;
export function cleanPrefs(raw: unknown, partial: true): Partial<Prefs>;
export function cleanPrefs(raw: unknown, partial = false): Prefs | Partial<Prefs> {
  return partial ? pick(raw) : { ...DEFAULT_PREFS, ...pick(raw) };
}
