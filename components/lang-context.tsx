"use client";
import { createContext, useCallback, useContext, useEffect } from "react";
import { toast } from "sonner";
import { type BotMode, LANG_INFO, type Lang } from "@/lib/lang";
import type { Learning } from "@/lib/prefs";
import { useProfile } from "./profiles";

/**
 * Whether this profile learns one language or both. `single` is that one language, or null when learning both, in
 * which case the app can switch between them. Profiles from before the choice existed count as learning both.
 */
export function useLearning(): { chosen: boolean; learning: Learning; single: Lang | null; setLearning: (next: Learning) => Promise<void> } {
  const { prefs, setPrefs } = useProfile();
  const learning = prefs.learning ?? "both";
  const setLearning = useCallback(
    (next: Learning) => setPrefs({ learning: next, botMode: "auto", ...(next === "both" ? {} : { language: next }) }),
    [setPrefs],
  );
  return { chosen: prefs.learning != null, learning, single: learning === "both" ? null : learning, setLearning };
}

/** The language this profile is learning, saved with its preferences so every device opens on it. */
export function useActiveLang(): { lang: Lang; setLang: (lang: Lang) => void } {
  const { prefs, setPrefs } = useProfile();
  const { single } = useLearning();
  const lang = single ?? prefs.language;
  const setLang = useCallback((next: Lang) => {
    if (next === lang || single) return;
    void setPrefs({ language: next }).catch(() => toast.error(`Couldn’t switch to ${LANG_INFO[next].name}.`));
  }, [lang, single, setPrefs]);
  return { lang, setLang };
}

/**
 * Which language Bao answers about. "auto" (the default for learners of both) works it out from each question and
 * the conversation; a picked language settles questions that could be about either. `lean` is the likelier language,
 * for the starters and the typing indicator.
 */
export function useBotMode(): { mode: BotMode; lean: Lang; setMode: (mode: BotMode) => void } {
  const { prefs, setPrefs } = useProfile();
  const { single } = useLearning();
  const mode = single ?? prefs.botMode;
  const lean = single ?? (prefs.botMode === "auto" ? prefs.language : prefs.botMode);
  const setMode = useCallback((next: BotMode) => {
    if (next === mode) return;
    void setPrefs({ botMode: next }).catch(() => toast.error("Couldn’t change Bao’s language."));
  }, [mode, setPrefs]);
  return { mode, lean, setMode };
}

const DeckLang = createContext<Lang | null>(null);

/**
 * Cards inside a deck follow the deck's language, whatever the profile prefers. Opening a deck also makes its language
 * the preferred one, so look-ups afterwards lean the same way. `known` is false while the deck is still loading.
 */
export function DeckLangProvider({ lang, known = true, children }: { lang: Lang; known?: boolean; children: React.ReactNode }) {
  const { setLang } = useActiveLang();
  useEffect(() => { if (known) setLang(lang); }, [known, lang, setLang]);
  return <DeckLang.Provider value={lang}>{children}</DeckLang.Provider>;
}

/** A small chip naming a deck's language, e.g. 中 Mandarin. */
export function LangBadge({ lang, short = false, className = "" }: { lang: Lang; short?: boolean; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full bg-raised px-2 py-0.5 text-xs font-medium text-muted ${className}`} title={LANG_INFO[lang].name}>
      <span className="font-hanzi text-ink" lang={LANG_INFO[lang].speech}>{LANG_INFO[lang].badge}</span>{!short && LANG_INFO[lang].name}
    </span>
  );
}

/** The deck's language inside a deck, otherwise the profile's. */
export function useCardLang(): Lang {
  const deck = useContext(DeckLang);
  const { lang } = useActiveLang();
  return deck ?? lang;
}
