"use client";
import { useState } from "react";
import { HoverCard } from "radix-ui";
import { Check } from "lucide-react";
import { LANG_INFO, LANGS, type Lang } from "@/lib/lang";
import { useDecks } from "./decks-context";
import { useActiveLang } from "./lang-context";

/** Each language with how many decks this profile has in it. */
function LanguageOptions({ onPicked, compact = false }: { onPicked?: () => void; compact?: boolean }) {
  const { lang, setLang } = useActiveLang();
  const { decks } = useDecks();
  const count = (l: Lang) => decks?.filter((d) => d.language === l).length ?? 0;
  return (
    <div role="radiogroup" aria-label="Language you’re learning" className="grid gap-1">
      {LANGS.map((l) => {
        const on = l === lang;
        const n = count(l);
        return (
          <button key={l} type="button" role="radio" aria-checked={on} onClick={() => { setLang(l); onPicked?.(); }}
            className={`group flex items-center gap-3 rounded-2xl p-2 text-left transition-colors ${on ? "bg-volt-50" : "hover:bg-raised"}`}>
            <span lang={LANG_INFO[l].speech}
              className={`grid shrink-0 place-items-center rounded-xl font-hanzi leading-none transition-colors ${compact ? "size-9 text-base" : "size-10 text-lg"} ${on ? "bg-volt-500 text-on-volt" : "bg-raised text-ink group-hover:bg-ink/10"}`}>
              {LANG_INFO[l].badge}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">{LANG_INFO[l].name}</span>
              <span className="block text-xs text-muted">
                <span lang={LANG_INFO[l].speech}>{LANG_INFO[l].native}</span> · {n} deck{n === 1 ? "" : "s"}
              </span>
            </span>
            {on && <Check className="size-4 shrink-0 text-volt-500" />}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Hovering the sidebar logo opens the language picker beside it. The logo itself still goes home when clicked.
 * Decks, the dictionary and new cards follow the language picked; theme and settings are shared by both.
 */
export function RailLanguageSwitcher({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const { lang } = useActiveLang();
  return (
    <HoverCard.Root open={open} onOpenChange={setOpen} openDelay={80} closeDelay={180}>
      <HoverCard.Trigger asChild>{children}</HoverCard.Trigger>
      <HoverCard.Portal>
        <HoverCard.Content side="right" align="start" sideOffset={14} collisionPadding={12}
          className="relative z-50 w-72 animate-tip rounded-3xl border border-line bg-surface/95 p-2 shadow-pop backdrop-blur-xl data-[state=closed]:animate-tip-out">
          <span aria-hidden className="absolute top-5 -left-3.5 h-px w-3.5 bg-volt-500/70" />
          <span aria-hidden className="absolute top-5 -left-4 size-1.5 -translate-y-1/2 rounded-full bg-volt-500/70" />
          <div className="flex items-baseline justify-between px-2 pt-1 pb-2">
            <p className="text-[11px] font-semibold tracking-wide text-muted uppercase">I’m learning</p>
            <p className="font-hanzi text-xs text-muted" lang={LANG_INFO[lang].speech}>{LANG_INFO[lang].native}</p>
          </div>
          <LanguageOptions onPicked={() => setOpen(false)} />
        </HoverCard.Content>
      </HoverCard.Portal>
    </HoverCard.Root>
  );
}

/** The same picker for the mobile menu. */
export function LanguageMenu({ onPicked }: { onPicked?: () => void }) {
  return (
    <section aria-label="Language" className="mt-5">
      <p className="mb-1.5 px-2 text-[11px] font-semibold tracking-wide text-muted uppercase">I’m learning</p>
      <LanguageOptions compact onPicked={onPicked} />
    </section>
  );
}
