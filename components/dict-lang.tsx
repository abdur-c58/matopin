"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { isAbort, searchDictionary, searchJdict } from "@/lib/dictionary-client";
import { LANG_INFO, LANGS, type Lang } from "@/lib/lang";
import { guessLang } from "@/lib/lang-resolve";

/**
 * For a learner of both languages, the dictionary works out which one a search is in, so forgetting to switch costs
 * nothing. Whoever shows the dictionary (the page or the pop-up) provides this; learners of one language get none.
 */
export type DictSwitch = {
  lang: Lang;
  /** Opens the other dictionary with `query`. `manual` when the learner picked it, so it isn't switched back. */
  switchTo: (lang: Lang, query: string, manual: boolean) => void;
  /** The search the learner last picked a dictionary for by hand. */
  manualFor: string | null;
};

export const DictSwitchContext = createContext<DictSwitch | null>(null);

const SEARCH: Record<Lang, (q: string, signal?: AbortSignal) => Promise<{ groups: { results: unknown[] }[] }>> = {
  zh: searchDictionary,
  ja: searchJdict,
};
const countOf = (data: { groups: { results: unknown[] }[] }) => data.groups.reduce((n, g) => n + g.results.length, 0);

type Search = { query: string; q: string; flat: unknown[]; fresh: boolean; shown: { error?: unknown } | null };
/** A count, "…" while searching, or nothing when the search failed. */
type Count = number | "loading" | "failed";

/**
 * A tab per language with how many results each has, above the results. Switches to the other dictionary on its own
 * when the search is certainly in it (kana, tone marks, characters only it uses), or when only it has results.
 */
export function DictLangTabs({ s, className = "" }: { s: Search; className?: string }) {
  const ctx = useContext(DictSwitchContext);
  const [other, setOther] = useState<{ q: string; count: Count } | null>(null);
  const lang = ctx?.lang;
  const otherLang = LANGS.find((l) => l !== lang) ?? null;
  const { q, fresh, query } = s;
  const count = s.flat.length;
  const counts: Record<"this" | "other", Count> = {
    this: !fresh ? "loading" : s.shown?.error ? "failed" : count,
    other: other?.q === q ? other.count : "loading",
  };
  const otherCount = typeof counts.other === "number" ? counts.other : 0;

  useEffect(() => {
    if (!q || !otherLang) return;
    const ctrl = new AbortController();
    SEARCH[otherLang](q, ctrl.signal).then(
      (data) => setOther({ q, count: countOf(data) }),
      (e: unknown) => { if (!isAbort(e)) setOther({ q, count: "failed" }); },
    );
    return () => ctrl.abort();
  }, [q, otherLang]);

  useEffect(() => {
    if (!ctx || !lang || !otherLang || !q || ctx.manualFor === q) return;
    const guess = guessLang(q, { fallback: lang });
    if (guess.sure) {
      if (guess.lang !== lang) ctx.switchTo(guess.lang, query, false);
      return;
    }
    if (fresh && !s.shown?.error && count === 0 && otherCount > 0) ctx.switchTo(otherLang, query, false);
  }, [ctx, lang, otherLang, q, query, fresh, s.shown?.error, count, otherCount]);

  if (!ctx || !lang || !q) return null;
  return (
    <div role="tablist" aria-label="Dictionary language" className={`flex gap-1.5 ${className}`}>
      {LANGS.map((l) => {
        const on = l === lang;
        const n = on ? counts.this : counts.other;
        return (
          <button key={l} type="button" role="tab" aria-selected={on} onClick={() => { if (!on) ctx.switchTo(l, query, true); }}
            className={`chip gap-1.5 ${on ? "chip-on" : ""}`}>
            <span className="font-hanzi" lang={LANG_INFO[l].speech}>{LANG_INFO[l].badge}</span>
            {LANG_INFO[l].name}
            {n !== "failed" && <span className="tabular-nums opacity-70">{n === "loading" ? "…" : n}</span>}
          </button>
        );
      })}
    </div>
  );
}
