"use client";
import { createContext, useContext, useState } from "react";
import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
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

/** Chat and the dictionary as small windows docked bottom right, so they can be used over any page. */
export function QuickPanelsProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { lang: active } = useActiveLang();
  const { single } = useLearning();
  const [open, setOpen] = useState<PanelKind[]>([]);
  // Each look-up starts the dictionary window afresh with that search, in the language it was written in.
  const [lookup, setLookup] = useState<{ query: string; lang: Lang | null; run: number }>({ query: "", lang: null, run: 0 });
  const show = (kind: PanelKind) => setOpen((list) => (list.includes(kind) ? list : [...list, kind]));
  const hide = (kind: PanelKind) => setOpen((list) => list.filter((k) => k !== kind));
  const lookUp = (text: string, lang: Lang = active) => {
    if (onPage(pathname, "dictionary")) window.dispatchEvent(new CustomEvent<LookupDetail>(LOOKUP_EVENT, { detail: { text, lang } }));
    else if (window.matchMedia("(width >= 48rem)").matches) {
      setLookup((l) => ({ query: text, lang, run: l.run + 1 }));
      show("dictionary");
    } else router.push(`/dictionary?${new URLSearchParams({ q: text, lang })}`);
  };
  // A pop-up steps aside while its own full page is open.
  const shown = open.filter((kind) => !onPage(pathname, kind));
  const dictLang = single ?? lookup.lang ?? active;
  const closeDict = () => { hide("dictionary"); setLookup((l) => ({ ...l, query: "", lang: null })); };

  return (
    <QuickPanels value={{ open: show, lookUp }}>
      {children}
      {shown.length > 0 && (
        <div className="pointer-events-none fixed right-4 bottom-4 z-40 hidden items-end gap-3 md:flex">
          {shown.map((kind) => (kind === "chat"
            ? <ChatMini key={kind} onClose={() => hide(kind)} />
            : dictLang === "ja"
              ? <JDictMini key={`${kind}-ja-${lookup.run}`} initialQuery={lookup.query} onClose={closeDict} />
              : <DictionaryMini key={`${kind}-zh-${lookup.run}`} initialQuery={lookup.query} onClose={closeDict} />))}
        </div>
      )}
    </QuickPanels>
  );
}
