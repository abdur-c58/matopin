"use client";
import { useState } from "react";
import { Tooltip } from "radix-ui";

export type RailAction = { label: string; icon: React.ComponentType<{ className?: string }>; onClick: () => void };

/**
 * Sidebar hover label: the English name beside its Chinese, with a short connector back to the button.
 * An `action` springs out of the button as a second, smaller button between it and the label.
 */
export function RailTip({ label, zh, pinyin, lang = "zh-CN", tone = "volt", action, children }: {
  label: string; zh: string; pinyin: string; lang?: string; tone?: "volt" | "danger"; action?: RailAction; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [hot, setHot] = useState(false);
  const badge = tone === "danger" ? "bg-tone-1 text-white" : "bg-volt-500 text-on-volt";
  const line = tone === "danger" ? "bg-tone-1/70" : "bg-volt-500/70";
  const Icon = action?.icon;
  return (
    <Tooltip.Root open={open} onOpenChange={(next) => { setOpen(next); if (!next) setHot(false); }}>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content side="right" sideOffset={14} collisionPadding={12} aria-label={`${label}, ${zh} ${pinyin}`}
          className="z-50 flex animate-tip items-center gap-2 select-none data-[state=closed]:animate-tip-out">
          <span aria-hidden className={`absolute top-1/2 -left-3.5 h-px w-3.5 ${line}`} />
          <span aria-hidden className={`absolute top-1/2 -left-4 size-1.5 -translate-y-1/2 rounded-full ${line}`} />
          {action && Icon && (
            <button type="button" aria-label={action.label}
              className="grid size-9 animate-sprout place-items-center rounded-full bg-volt-500 text-on-volt shadow-pop ring-4 ring-volt-edge/15 transition hover:scale-110 hover:ring-volt-edge/30 active:scale-90"
              onPointerEnter={() => setHot(true)} onPointerLeave={() => setHot(false)} onFocus={() => setHot(true)} onBlur={() => setHot(false)}
              onClick={() => { setOpen(false); action.onClick(); }}>
              <Icon className="size-4" />
            </button>
          )}
          <span className="flex items-center gap-2.5 rounded-full border border-line bg-surface/90 py-1 pr-4 pl-1 shadow-pop backdrop-blur-xl">
            <span lang={lang} className={`grid h-7 place-items-center rounded-full px-2 font-hanzi text-sm leading-none ${badge}`}>{zh}</span>
            <span className="max-w-48 truncate text-sm font-semibold text-ink">{hot && action ? action.label : label}</span>
            {!(hot && action) && <span className="text-xs text-muted">{pinyin}</span>}
          </span>
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

export const RailTipProvider = ({ children }: { children: React.ReactNode }) => (
  <Tooltip.Provider delayDuration={120} skipDelayDuration={400}>{children}</Tooltip.Provider>
);
