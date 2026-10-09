"use client";
import { createContext, useContext } from "react";
import Link from "next/link";
import { Maximize2, Pin, X } from "lucide-react";

/**
 * How a window sits beside the other one on wide screens. Missing when it's alone or on a phone, where it simply
 * fills its space.
 */
export type PanelDock = {
  collapsed: boolean;
  pinned: boolean;
  togglePin: () => void;
  /** The pointer came in, or the collapsed strip was clicked. */
  enter: () => void;
  leave: () => void;
};
export const PanelDockContext = createContext<PanelDock | null>(null);

const WIDTH = "md:w-[min(24rem,calc(100vw-8rem))]";

/** The small floating window that chat and the dictionary open in from the sidebar. */
export function PanelFrame({ title, zh, zhLang = "zh-CN", full, actions, onClose, children }: {
  title: string; zh: string; zhLang?: string; full: string;
  actions?: React.ReactNode; onClose: () => void; children: React.ReactNode;
}) {
  const dock = useContext(PanelDockContext);
  const collapsed = dock?.collapsed ?? false;
  const mouse = (e: React.PointerEvent) => e.pointerType === "mouse";
  return (
    <section role="dialog" aria-label={title}
      onPointerEnter={(e) => { if (mouse(e)) dock?.enter(); }}
      onPointerLeave={(e) => { if (mouse(e)) dock?.leave(); }}
      className={`pointer-events-auto relative flex h-full w-full shrink-0 animate-panel overflow-hidden rounded-xl border border-line bg-surface shadow-pop transition-[width] duration-300 ease-out md:h-[min(38rem,calc(100dvh-2rem))] ${collapsed ? "md:w-14" : WIDTH}`}>
      {/* Keeps its full width while collapsed, so the content is only clipped, never squeezed. */}
      <div className={`flex h-full w-full shrink-0 flex-col ${WIDTH}`} inert={collapsed || undefined}>
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line pr-1.5 pl-3">
          <span className="truncate text-sm font-semibold">{title}</span>
          <span className="font-hanzi text-xs text-muted" lang={zhLang}>{zh}</span>
          <span className="ml-auto flex items-center">
            {actions}
            {dock && (
              <button type="button" className={`icon-btn max-md:hidden ${dock.pinned ? "text-volt-500" : ""}`} aria-pressed={dock.pinned}
                aria-label={dock.pinned ? `Unpin ${title}` : `Pin ${title} open`} title={dock.pinned ? "Unpin" : "Pin open"} onClick={dock.togglePin}>
<Pin className={`size-4 ${dock.pinned ? "fill-current" : ""}`} />
              </button>
            )}
            <Link href={full} onClick={onClose} className="icon-btn" aria-label="Open full page" title="Open full page"><Maximize2 className="size-4" /></Link>
            <button type="button" className="icon-btn" aria-label={`Close ${title}`} title="Close" onClick={onClose}><X className="size-4" /></button>
          </span>
        </header>
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </div>
      {collapsed && (
        <button type="button" onClick={dock?.enter} aria-label={`Expand ${title}`}
          className="absolute inset-0 flex animate-fade flex-col items-center gap-3 bg-surface pt-4 text-muted transition-colors hover:text-ink max-md:hidden">
          <span className="font-hanzi text-base text-ink" lang={zhLang}>{zh}</span>
          <span className="text-xs font-semibold tracking-wide [writing-mode:vertical-rl]">{title}</span>
        </button>
      )}
    </section>
  );
}
