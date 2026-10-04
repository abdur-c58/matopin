"use client";
import { createContext, useCallback, useContext } from "react";
import { toast } from "sonner";
import { LANG_INFO, type Lang } from "@/lib/lang";
import { useProfile } from "./profiles";

/** The language this profile is learning, saved with its preferences so every device opens on it. */
export function useActiveLang(): { lang: Lang; setLang: (lang: Lang) => void } {
  const { prefs, setPrefs } = useProfile();
  const setLang = useCallback((lang: Lang) => {
    if (lang === prefs.language) return;
    void setPrefs({ language: lang, botMode: "auto" }).catch(() => toast.error(`Couldn’t switch to ${LANG_INFO[lang].name}.`));
  }, [prefs.language, setPrefs]);
  return { lang: prefs.language, setLang };
}

/** The language Bao assumes when a question doesn't say. Follows the language being learned; a pick lasts until that language changes. */
export function useBotMode(): { mode: Lang; setMode: (mode: Lang) => void } {
  const { prefs, setPrefs } = useProfile();
  const mode = prefs.botMode === "auto" ? prefs.language : prefs.botMode;
  const setMode = useCallback((next: Lang) => {
    if (next === mode) return;
    void setPrefs({ botMode: next === prefs.language ? "auto" : next }).catch(() => toast.error(`Couldn’t switch to ${LANG_INFO[next].name} mode.`));
  }, [mode, prefs.language, setPrefs]);
  return { mode, setMode };
}

const DeckLang = createContext<Lang | null>(null);

/** Cards inside a deck follow the deck's language, whatever the profile is currently learning. */
export function DeckLangProvider({ lang, children }: { lang: Lang; children: React.ReactNode }) {
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
  const { prefs } = useProfile();
  return deck ?? prefs.language;
}
