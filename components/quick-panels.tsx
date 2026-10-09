"use client";
import { createContext, useContext, useState } from "react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { BookA, MessageCircle } from "lucide-react";
import { useChatBadge } from "@/lib/chat-client";
import type { Lang } from "@/lib/lang";
import { guessLang } from "@/lib/lang-resolve";
import { DictSwitchContext } from "./dict-lang";
import { useActiveLang, useLearning } from "./lang-context";
import { type PanelDock, PanelDockContext } from "./panel-frame";

export type PanelKind = "chat" | "dictionary";
export const PANEL_PAGES: Record<PanelKind, string> = { chat: "/chat", dictionary: "/dictionary" };
/** Sent to the full dictionary page, when it's open, to search for something highlighted elsewhere on it. */
export const LOOKUP_EVENT = "matopin:lookup";
export type LookupDetail = { text: string; lang: Lang };

const ChatMini = dynamic(() => import("./chat-layout").then((m) => m.ChatMini));
const DictionaryMini = dynamic(() => import("./dictionary-page").then((m) => m.DictionaryMini));
const JDictMini = dynamic(() => import("./jdict-page").then((m) => m.JDictMini));

type Panels = { open: (kind: PanelKind) => void; lookUp: (text: string, lang?: Lang) => void };
const QuickPanels = createContext<Panels>({ open: () => {}, lookUp: () => {} });
export const useOpenPanel = () => useContext(QuickPanels).open;
export const useLookUp = () => useContext(QuickPanels).lookUp;

const PINS_KEY = "matopin:pinned-panels";
const readPins = (): PanelKind[] => {
  if (typeof window === "undefined") return [];
  try {
    const saved = JSON.parse(localStorage.getItem(PINS_KEY) ?? "[]") as unknown;
    return Array.isArray(saved) ? saved.filter((k): k is PanelKind => k === "chat" || k === "dictionary") : [];
  } catch {
    return [];
  }
};

const onPage = (pathname: string, kind: PanelKind) => pathname === PANEL_PAGES[kind] || pathname.startsWith(`${PANEL_PAGES[kind]}/`);
const isPhone = () => !window.matchMedia("(width >= 48rem)").matches;

/** On a phone: a slim tab on the screen's right edge that opens the dictionary or chats over any page. */
function SideTab({ kinds, onOpen }: { kinds: PanelKind[]; onOpen: (kind: PanelKind) => void }) {
  const unread = useChatBadge();
  if (!kinds.length) return null;
  return (
    <div className="fixed top-[58%] right-0 z-30 flex flex-col gap-0.5 rounded-l-lg border border-r-0 border-line bg-surface/95 p-0.5 pr-[max(0.125rem,env(safe-area-inset-right))] shadow-pop backdrop-blur-xs md:hidden">
      {kinds.map((kind) => (
        <button key={kind} type="button" onClick={() => onOpen(kind)} aria-label={kind === "chat" ? "Open chats" : "Open dictionary"}
          className="relative grid size-8 place-items-center rounded-md text-muted transition-colors active:bg-raised active:text-ink">
          {kind === "chat" ? <MessageCircle className="size-4" /> : <BookA className="size-4" />}
          {kind === "chat" && unread > 0 && <span className="absolute top-1 right-1 size-2 rounded-full bg-tone-1" aria-label={`${unread} unread`} />}
        </button>
      ))}
    </div>
  );
}

/**
 * Chat and the dictionary as small windows over any page: docked bottom right on wide screens, and on a phone a sheet
 * opened from the side tab.
 */
export function QuickPanelsProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { lang: active, setLang } = useActiveLang();
  const { single } = useLearning();
  const [open, setOpen] = useState<PanelKind[]>([]);
  // Each look-up starts the dictionary window afresh with that search, in the language it was written in.
  const [lookup, setLookup] = useState<{ query: string; lang: Lang | null; run: number; typed?: boolean }>({ query: "", lang: null, run: 0 });
  const [manualFor, setManualFor] = useState<string | null>(null);
  // With both windows open on a wide screen they share the space like an accordion: `focus` is the one expanded when
  // neither is pinned, and `peek` an unpinned one opened beside a pinned one, until the pointer leaves it.
  const [focus, setFocus] = useState<PanelKind>("dictionary");
  const [peek, setPeek] = useState<PanelKind | null>(null);
  const [pins, setPins] = useState<PanelKind[]>(readPins);
  // A phone has room for one window at a time.
  const show = (kind: PanelKind) => {
    setOpen((list) => (isPhone() ? [kind] : list.includes(kind) ? list : [...list, kind]));
    setFocus(kind);
    setPeek(kind);
  };
  const hide = (kind: PanelKind) => setOpen((list) => list.filter((k) => k !== kind));
  const lookUp = (text: string, lang: Lang = guessLang(text, { fallback: active }).lang) => {
    if (onPage(pathname, "dictionary")) {
      window.dispatchEvent(new CustomEvent<LookupDetail>(LOOKUP_EVENT, { detail: { text, lang } }));
      return;
    }
    setLookup((l) => ({ query: text, lang, run: l.run + 1 }));
    show("dictionary");
  };
  // A pop-up steps aside while its own full page is open.
  const shown = open.filter((kind) => !onPage(pathname, kind));
  const dictLang = single ?? lookup.lang ?? active;
  const closeDict = () => { hide("dictionary"); setManualFor(null); setLookup((l) => ({ ...l, query: "", lang: null })); };
  // Moving between the two dictionaries keeps the search but doesn't open its entry: the learner may still be typing.
  const switchDict = (lang: Lang, query: string, manual: boolean) => {
    setManualFor(manual ? query.trim() : null);
    if (lang !== dictLang) setLookup((l) => ({ query, lang, run: l.run + 1, typed: true }));
    setLang(lang);
  };
  const dict = (lang: Lang, key: string) => (lang === "ja"
    ? <JDictMini key={key} initialQuery={lookup.query} openMatch={!lookup.typed} onClose={closeDict} />
    : <DictionaryMini key={key} initialQuery={lookup.query} openMatch={!lookup.typed} onClose={closeDict} />);
  const tabKinds = (["dictionary", "chat"] as const).filter((kind) => !onPage(pathname, kind) && !shown.includes(kind));

  const pinnedShown = pins.filter((kind) => shown.includes(kind));
  // Pinned windows sit on the right, the first pinned against the screen edge, so pinning another moves nothing.
  const order = [...shown.filter((k) => !pins.includes(k)), ...pinnedShown.toReversed()];
  const dockFor = (kind: PanelKind): PanelDock => {
    const pinned = pins.includes(kind);
    return {
      pinned,
      collapsed: shown.length > 1 && !pinned && (pinnedShown.length ? peek !== kind : focus !== kind),
      togglePin: () => {
        const next = pinned ? pins.filter((k) => k !== kind) : [...pins, kind];
        setPins(next);
        localStorage.setItem(PINS_KEY, JSON.stringify(next));
        // Unpinning happens with the pointer on the window, so it stays open until the pointer leaves.
        setPeek(pinned ? kind : null);
        if (pinned) setFocus(kind);
      },
      enter: () => {
        if (!pinnedShown.length) setFocus(kind);
        else if (!pinned) setPeek(kind);
      },
      leave: () => setPeek((p) => (p === kind ? null : p)),
    };
  };
  const panel = (kind: PanelKind) => (kind === "chat"
    ? <ChatMini onClose={() => hide(kind)} />
    : single
      ? dict(single, `${kind}-${single}-${lookup.run}`)
      : (
        <DictSwitchContext key={`${kind}-${dictLang}-${lookup.run}`} value={{ lang: dictLang, switchTo: switchDict, manualFor }}>
          {dict(dictLang, "dict")}
        </DictSwitchContext>
      ));

  return (
    <QuickPanels value={{ open: show, lookUp }}>
      {children}
      <SideTab kinds={shown.length ? [] : tabKinds} onOpen={show} />
      {shown.length > 0 && (
        <>
          <button type="button" aria-label="Close" className="fixed inset-0 z-40 animate-fade bg-black/50 md:hidden" onClick={() => setOpen([])} />
          <div className="pointer-events-none fixed inset-x-2 top-[calc(0.5rem+env(safe-area-inset-top))] bottom-[calc(0.5rem+env(safe-area-inset-bottom))] z-40 flex items-end gap-3 md:inset-auto md:right-4 md:bottom-4 max-md:[&>*:not(:last-child)]:hidden">
            {order.map((kind) => <PanelDockContext key={kind} value={dockFor(kind)}>{panel(kind)}</PanelDockContext>)}
          </div>
        </>
      )}
    </QuickPanels>
  );
}
