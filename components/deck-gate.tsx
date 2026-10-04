"use client";
import { createContext, useContext, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { deckScope, listDeckIds } from "@/lib/decks";
import { ROLE_LABELS } from "@/lib/social";
import { deckLinks } from "./app-shell";
import { dueTotal, useDecks } from "./decks-context";
import { LangBadge } from "./lang-context";
import { useProfile } from "./profiles";
import { VisibilityBadge } from "./social";

type Deck = { id: string; scope: string };
const DeckCtx = createContext<Deck | null>(null);

export function useDeck() {
  const value = useContext(DeckCtx);
  if (!value) throw new Error("useDeck must be used inside a deck page");
  return value;
}

/** Renders the deck only if it belongs to the open profile. */
export function DeckGate({ children }: { children: React.ReactNode }) {
  const { id } = useParams<{ id: string }>();
  const { profile } = useProfile();
  const [found, setFound] = useState<boolean | null>(null);

  useEffect(() => {
    // localStorage is only readable after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFound(listDeckIds(profile).includes(id));
  }, [profile, id]);

  if (found === null) return <p className="grid min-h-[60dvh] place-items-center text-sm text-muted">Loading deck…</p>;
  if (!found) {
    return (
      <div className="grid min-h-[60dvh] place-items-center px-4">
        <section className="surface max-w-sm space-y-3 p-6 text-center">
          <p className="text-lg font-medium">Deck not found</p>
          <p className="text-sm text-muted">It may have been deleted, it belongs to another profile, or its owner stopped sharing it with you.</p>
          <Link href="/decks" className="btn btn-primary">All decks</Link>
        </section>
      </div>
    );
  }
  return <DeckCtx.Provider value={{ id, scope: deckScope(profile, id) }}>{children}</DeckCtx.Provider>;
}

/** This profile's summary of the open deck, including its role and sharing. */
export function useDeckSummary() {
  const { id } = useDeck();
  return useDecks().decks?.find((d) => d.id === id);
}

export function DeckHeader() {
  const { id } = useDeck();
  const pathname = usePathname();
  const deck = useDeckSummary();
  const due = deck ? dueTotal(deck) : 0;

  return (
    <header className="px-4 pt-5 md:px-8">
      <div className="surface flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted"><Link href="/decks" className="hover:text-ink">Decks</Link> <span aria-hidden>/</span></p>
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="truncate text-xl font-bold md:text-2xl">{deck?.name ?? "Deck"}</h2>
            {deck && <LangBadge lang={deck.language} short className="shrink-0" />}
            {deck && deck.visibility !== "private" && <VisibilityBadge visibility={deck.visibility} className="shrink-0" />}
          </div>
          <p className="mt-0.5 text-sm text-muted">
            {deck ? `${deck.cards} card${deck.cards === 1 ? "" : "s"} · ${due ? `${due} to study today` : "nothing due right now"}` : "\u00a0"}
            {deck && deck.role !== "owner" && (
              <> · {ROLE_LABELS[deck.role]} of <Link href={`/u/${deck.ownerId}`} className="font-semibold text-ink hover:text-volt-500">{deck.ownerName ?? "its owner"}</Link>’s deck</>
            )}
          </p>
        </div>
        <nav className="flex w-full gap-1 rounded-full bg-porcelain p-1 sm:w-auto" aria-label="Deck sections">
          {deckLinks(id).map(({ href, label, icon: Icon }) => {
            const active = pathname === href;
            return (
              <Link
                key={href} href={href} aria-current={active ? "page" : undefined}
                className={`flex h-9 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-full px-3 text-sm font-semibold sm:flex-none sm:px-4 transition-colors ${active ? "bg-volt-500 text-on-volt hover:bg-volt-700" : "text-muted hover:bg-raised hover:text-ink"}`}
              >
                <Icon className="size-4" />{label}
                {label === "Study" && due > 0 && <span className={`rounded-full px-1.5 text-xs tabular-nums ${active ? "bg-on-volt/15" : "bg-volt-50 text-volt-700"}`}>{due}</span>}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
