"use client";
import Link from "next/link";
import { Maximize2, X } from "lucide-react";

/** The small floating window that chat and the dictionary open in from the sidebar. */
export function PanelFrame({ title, zh, zhLang = "zh-CN", full, actions, onClose, children }: {
  title: string; zh: string; zhLang?: string; full: string;
  actions?: React.ReactNode; onClose: () => void; children: React.ReactNode;
}) {
  return (
    <section role="dialog" aria-label={title}
      className="pointer-events-auto flex h-full w-full animate-panel md:h-[min(38rem,calc(100dvh-2rem))] md:w-[min(24rem,calc(100vw-8rem))] flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-pop">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line pr-1.5 pl-3">
        <span className="truncate text-sm font-semibold">{title}</span>
        <span className="font-hanzi text-xs text-muted" lang={zhLang}>{zh}</span>
        <span className="ml-auto flex items-center">
          {actions}
          <Link href={full} onClick={onClose} className="icon-btn" aria-label="Open full page" title="Open full page"><Maximize2 className="size-4" /></Link>
          <button type="button" className="icon-btn" aria-label={`Close ${title}`} title="Close" onClick={onClose}><X className="size-4" /></button>
        </span>
      </header>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </section>
  );
}
