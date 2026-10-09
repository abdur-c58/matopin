"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { isLang, type Lang } from "@/lib/lang";
import { guessLang } from "@/lib/lang-resolve";
import { DictionaryPage } from "./dictionary-page";
import { DictSwitchContext } from "./dict-lang";
import { JDictPage } from "./jdict-page";
import { useActiveLang, useLearning } from "./lang-context";
import { LOOKUP_EVENT, type LookupDetail } from "./quick-panels";

/**
 * The dictionary for the language being learned. A learner of both gets whichever one each search is in: ?lang= or
 * the search itself picks it, and the tabs above the results move between them without losing the search.
 */
export function DictionaryRouter() {
  const { single } = useLearning();
  // Read through Next rather than `window.location`: right after a client-side navigation, such as Look up on a
  // phone, the new page renders before the address bar has its query.
  const params = useSearchParams();
  const [start] = useState(() => new URLSearchParams(params.toString()));
  return single ? <SingleDictionary lang={single} params={start} /> : <BothDictionaries params={start} />;
}

/** One language learned: only its dictionary, whatever a link or lookup asks for. */
function SingleDictionary({ lang, params }: { lang: Lang; params: URLSearchParams }) {
  return lang === "ja" ? <JDictPage params={params} /> : <DictionaryPage params={params} />;
}

function BothDictionaries({ params }: { params: URLSearchParams }) {
  const { lang: active, setLang } = useActiveLang();
  const [state, setState] = useState<{ lang: Lang; run: number; params: URLSearchParams }>(() => {
    const lang = params.get("lang");
    const q = params.get("q")?.trim();
    return { lang: isLang(lang) ? lang : q ? guessLang(q, { fallback: active }).lang : active, run: 0, params };
  });
  const [manualFor, setManualFor] = useState<string | null>(null);
  const [followed, setFollowed] = useState(active);
  if (followed !== active) {
    setFollowed(active);
    if (state.lang !== active) {
      // The other dictionary starts empty: the old query and entry id belong to this one.
      setState((s) => ({ lang: active, run: s.run + 1, params: new URLSearchParams({ lang: active }) }));
    }
  }

  const switchTo = (lang: Lang, query: string, manual: boolean) => {
    setManualFor(manual ? query.trim() : null);
    setState((s) => (s.lang === lang ? s : { lang, run: s.run + 1, params: new URLSearchParams({ q: query, lang }) }));
    // The preferred language follows what was last searched, so the next unclear search starts here.
    setLang(lang);
  };

  useEffect(() => {
    const listen = (e: Event) => {
      const { text, lang } = (e as CustomEvent<LookupDetail>).detail;
      if (lang === state.lang) return;
      setState((s) => ({ lang, run: s.run + 1, params: new URLSearchParams({ q: text, lang }) }));
    };
    window.addEventListener(LOOKUP_EVENT, listen);
    return () => window.removeEventListener(LOOKUP_EVENT, listen);
  }, [state.lang]);

  return (
    <DictSwitchContext value={{ lang: state.lang, switchTo, manualFor }}>
      {state.lang === "ja"
        ? <JDictPage key={`ja-${state.run}`} params={state.params} />
        : <DictionaryPage key={`zh-${state.run}`} params={state.params} />}
    </DictSwitchContext>
  );
}
