"use client";
import { useEffect, useState } from "react";
import { isLang, type Lang } from "@/lib/lang";
import { DictionaryPage } from "./dictionary-page";
import { JDictPage } from "./jdict-page";
import { useActiveLang } from "./lang-context";
import { LOOKUP_EVENT, type LookupDetail } from "./quick-panels";

/**
 * The dictionary for the language being learned. ?lang= opens the other one (a link from a Japanese deck, say), and
 * switching languages in the sidebar or looking up text in the other language swaps over.
 */
export function DictionaryRouter() {
  const { lang: active } = useActiveLang();
  const [state, setState] = useState<{ lang: Lang; run: number }>(() => {
    const lang = new URLSearchParams(window.location.search).get("lang");
    return { lang: isLang(lang) ? lang : active, run: 0 };
  });
  const [followed, setFollowed] = useState(active);
  if (followed !== active) {
    setFollowed(active);
    if (state.lang !== active) {
      // The other dictionary starts empty: the old query and entry id belong to this one. It reads the URL as it
      // first renders, so this can't wait for an effect.
      window.history.replaceState(window.history.state, "", `?lang=${active}`);
      setState((s) => ({ lang: active, run: s.run + 1 }));
    }
  }

  useEffect(() => {
    const listen = (e: Event) => {
      const { text, lang } = (e as CustomEvent<LookupDetail>).detail;
      if (lang === state.lang) return;
      window.history.replaceState(window.history.state, "", `?${new URLSearchParams({ q: text, lang })}`);
      setState((s) => ({ lang, run: s.run + 1 }));
    };
    window.addEventListener(LOOKUP_EVENT, listen);
    return () => window.removeEventListener(LOOKUP_EVENT, listen);
  }, [state.lang]);

  return state.lang === "ja" ? <JDictPage key={`ja-${state.run}`} /> : <DictionaryPage key={`zh-${state.run}`} />;
}
