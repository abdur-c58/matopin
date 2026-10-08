"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { isLang, type Lang } from "@/lib/lang";
import { DictionaryPage } from "./dictionary-page";
import { JDictPage } from "./jdict-page";
import { useActiveLang, useLearning } from "./lang-context";
import { LOOKUP_EVENT, type LookupDetail } from "./quick-panels";

/**
 * The dictionary for the language being learned. ?lang= opens the other one (a link from a Japanese deck, say), and
 * switching languages in the sidebar or looking up text in the other language swaps over.
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
  const { lang: active } = useActiveLang();
  const [state, setState] = useState<{ lang: Lang; run: number; params: URLSearchParams }>(() => {
    const lang = params.get("lang");
    return { lang: isLang(lang) ? lang : active, run: 0, params };
  });
  const [followed, setFollowed] = useState(active);
  if (followed !== active) {
    setFollowed(active);
    if (state.lang !== active) {
      // The other dictionary starts empty: the old query and entry id belong to this one.
      setState((s) => ({ lang: active, run: s.run + 1, params: new URLSearchParams({ lang: active }) }));
    }
  }

  useEffect(() => {
    const listen = (e: Event) => {
      const { text, lang } = (e as CustomEvent<LookupDetail>).detail;
      if (lang === state.lang) return;
      setState((s) => ({ lang, run: s.run + 1, params: new URLSearchParams({ q: text, lang }) }));
    };
    window.addEventListener(LOOKUP_EVENT, listen);
    return () => window.removeEventListener(LOOKUP_EVENT, listen);
  }, [state.lang]);

  return state.lang === "ja"
    ? <JDictPage key={`ja-${state.run}`} params={state.params} />
    : <DictionaryPage key={`zh-${state.run}`} params={state.params} />;
}
