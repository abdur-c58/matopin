"use client";
import { createContext, useContext, useState } from "react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { BookA, MessageCircle } from "lucide-react";
import { useChatBadge } from "@/lib/chat-client";
import type { Lang } from "@/lib/lang";
import { useActiveLang, useLearning } from "./lang-context";

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
  const { lang: active } = useActiveLang();
  const { single } = useLearning();
  const [open, setOpen] = useState<PanelKind[]>([]);
  // Each look-up starts the dictionary window afresh with that search, in the language it was written in.
  const [lookup, setLookup] = useState<{ query: string; lang: Lang | null; run: number }>({ query: "", lang: null, run: 0 });
  // A phone has room for one window at a time.
  const show = (kind: PanelKind) => setOpen((list) => (isPhone() ? [kind] : list.includes(kind) ? list : [...list, kind]));
  const hide = (kind: PanelKind) => setOpen((list) => list.filter((k) => k !== kind));
  const lookUp = (text: string, lang: Lang = active) => {
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
  const closeDict = () => { hide("dictionary"); setLookup((l) => ({ ...l, query: "", lang: null })); };
  const tabKinds = (["dictionary", "chat"] as const).filter((kind) => !onPage(pathname, kind) && !shown.includes(kind));

  return (
    <QuickPanels value={{ open: show, lookUp }}>
      {children}
      <SideTab kinds={shown.length ? [] : tabKinds} onOpen={show} />
      {shown.length > 0 && (
        <>
          <button type="button" aria-label="Close" className="fixed inset-0 z-40 animate-fade bg-black/50 md:hidden" onClick={() => setOpen([])} />
          <div className="pointer-events-none fixed inset-x-2 top-[calc(0.5rem+env(safe-area-inset-top))] bottom-[calc(0.5rem+env(safe-area-inset-bottom))] z-40 flex items-end gap-3 md:inset-auto md:right-4 md:bottom-4 max-md:[&>*:not(:last-child)]:hidden">
            {shown.map((kind) => (kind === "chat"
              ? <ChatMini key={kind} onClose={() => hide(kind)} />
              : dictLang === "ja"
                ? <JDictMini key={`${kind}-ja-${lookup.run}`} initialQuery={lookup.query} onClose={closeDict} />
                : <DictionaryMini key={`${kind}-zh-${lookup.run}`} initialQuery={lookup.query} onClose={closeDict} />))}
          </div>
        </>
      )}
    </QuickPanels>
  );
}
