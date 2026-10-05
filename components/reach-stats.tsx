"use client";
import { Tooltip } from "radix-ui";
import { LANG_INFO, LANGS } from "@/lib/lang";
import type { Reach } from "@/lib/social";

const ITEMS = [
  { key: "imports", label: "Imports", detail: "people saved a copy" },
  { key: "remixes", label: "Remixes", detail: "people changed their copy" },
] as const;

/** Total imports and remixes of a person's decks. Hovering or focusing one shows the split by language. */
export function ReachStats({ reach }: { reach: Reach | undefined }) {
  if (!reach) return null;
  return (
    <Tooltip.Provider delayDuration={120}>
      {ITEMS.map(({ key, label, detail }) => {
        const split = reach[key];
        const total = LANGS.reduce((sum, l) => sum + (split[l] ?? 0), 0);
        return (
          <Tooltip.Root key={key}>
            <Tooltip.Trigger asChild>
              <span tabIndex={0} className="cursor-default rounded-sm text-muted underline decoration-line decoration-dotted underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-volt-500/50">
                <span className="font-semibold text-ink tabular-nums">{total.toLocaleString()}</span> {label.toLowerCase()}
              </span>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content side="bottom" sideOffset={6} className="z-50 min-w-44 rounded-lg border border-line bg-surface px-3 py-2 text-xs text-ink shadow-pop">
                <p className="mb-1.5 text-muted">{total.toLocaleString()} {detail}</p>
                {LANGS.map((l) => (
                  <p key={l} className="flex items-center gap-2 py-0.5">
                    <span className="font-hanzi w-5 text-center">{LANG_INFO[l].badge}</span>
                    <span className="flex-1">{LANG_INFO[l].name} decks</span>
                    <span className="font-semibold tabular-nums">{(split[l] ?? 0).toLocaleString()}</span>
                  </p>
                ))}
                <Tooltip.Arrow className="fill-surface" />
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        );
      })}
    </Tooltip.Provider>
  );
}
