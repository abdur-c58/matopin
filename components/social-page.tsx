"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Dialog } from "radix-ui";
import { LoaderCircle, MessageCircle, Search, X } from "lucide-react";
import type { Person, SharedDeck } from "@/lib/social";
import { store } from "@/lib/store-client";
import { PersonAvatar } from "./avatar";
import { DeckTile, errorText, FollowButton, plural } from "./social";
import { Chips } from "./ui";

type DeckFilter = "all" | "following" | "joined";

function SearchBox({ value, onChange, label, autoFocus = false }: { value: string; onChange: (v: string) => void; label: string; autoFocus?: boolean }) {
  return (
    <label className="flex h-10 items-center gap-2 rounded-lg border border-line bg-porcelain pr-4 pl-3 transition focus-within:border-volt-500/60">
      <Search className="size-4 shrink-0 text-muted" />
      <input className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted/80" placeholder={label} aria-label={label} value={value} autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape" && value) { e.stopPropagation(); onChange(""); } }} />
    </label>
  );
}

/** Every public deck, to browse and save a copy of. */
export function PublicDecks() {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [decks, setDecks] = useState<SharedDeck[] | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<DeckFilter>("all");

  useEffect(() => {
    let live = true;
    store<{ people: Person[]; decks: SharedDeck[] }>("social").then(
      (data) => { if (live) { setPeople(data.people); setDecks(data.decks); } },
      (e: unknown) => { if (live) setError(errorText(e, "Couldn't load public decks.")); },
    );
    return () => { live = false; };
  }, []);

  if (error) return <p className="text-sm text-tone-1">{error}</p>;

  const following = new Set(people?.filter((p) => p.isFollowing).map((p) => p.id));
  const q = query.trim().toLowerCase();
  const shown = (decks ?? []).filter((d) =>
    (filter === "following" ? following.has(d.owner.id) : filter === "joined" ? d.copyId != null || d.role === "collaborator" : d.role !== "owner")
    && (!q || d.name.toLowerCase().includes(q) || d.owner.name.toLowerCase().includes(q)));
  const markSaved = (next: SharedDeck) => setDecks((list) => list?.map((d) => (d.id === next.id ? next : d)) ?? list);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Chips<DeckFilter> label="Filter public decks" value={filter} onChange={setFilter}
          options={[{ value: "all", label: "All" }, { value: "following", label: "From people you follow" }, { value: "joined", label: "Imported" }]} />
        <div className="w-full sm:w-60"><SearchBox value={query} onChange={setQuery} label="Search decks or people" /></div>
      </div>
      {!decks && <p className="text-sm text-muted">Loading decks…</p>}
      {decks && shown.length === 0 && (
        <p className="max-w-md text-sm text-muted">
          {decks.length === 0 ? "No public decks yet. Make one of your decks public in its settings and it shows up here for everyone to import." : "Nothing matches. Try another search or filter."}
        </p>
      )}
      <ul className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
        {shown.map((deck) => <DeckTile key={deck.id} deck={deck} onSaved={markSaved} />)}
      </ul>
    </section>
  );
}

/** Search everyone by name, then follow or message them. People you follow come first. */
export function FindPeopleDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [query, setQuery] = useState("");
  const [people, setPeople] = useState<Person[] | null>(null);
  const [searched, setSearched] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    let live = true;
    const term = query.trim();
    const timer = setTimeout(() => {
      store<{ people: Person[] }>("peopleSearch", { query: term }).then(
        (data) => { if (live) { setPeople(data.people); setSearched(term); setError(""); } },
        (e: unknown) => { if (live) setError(errorText(e, "Couldn't search people.")); },
      );
    }, term ? 250 : 0);
    return () => { live = false; clearTimeout(timer); };
  }, [open, query]);

  const update = (next: Person) => setPeople((list) => list?.map((p) => (p.id === next.id ? next : p)) ?? list);
  const loading = !error && (people == null || searched !== query.trim());

  return (
    <Dialog.Root open={open} onOpenChange={(next) => { onOpenChange(next); if (!next) setQuery(""); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="popup fixed top-1/2 left-1/2 flex h-[min(36rem,calc(100dvh-1.5rem))] w-[min(30rem,calc(100vw-1.5rem))] -translate-x-1/2 -translate-y-1/2 flex-col p-5" aria-describedby={undefined}>
          <Dialog.Close className="icon-btn absolute top-4 right-4" aria-label="Close"><X className="size-4" /></Dialog.Close>
          <Dialog.Title className="pr-10 text-xl font-bold">Find people</Dialog.Title>
          <div className="mt-4"><SearchBox value={query} onChange={setQuery} label="Search by name" autoFocus /></div>
          <div className="mt-3 flex items-center justify-between px-1 text-xs text-muted">
            <span>{query.trim() ? `Results for “${query.trim()}”` : "People you follow first"}</span>
            {loading && <LoaderCircle className="size-3.5 animate-spin" />}
          </div>
          <ul className="mt-2 min-h-0 flex-1 space-y-1 overflow-y-auto">
            {error && <li className="p-4 text-center text-sm text-tone-1">{error}</li>}
            {!error && people?.length === 0 && !loading && (
              <li className="p-6 text-center text-sm text-muted">{query.trim() ? "No one matches that name." : "No one else is here yet."}</li>
            )}
            {people?.map((p) => (
              <li key={p.id} className="flex items-center gap-3 rounded-lg p-2 transition hover:bg-raised/60">
                <Link href={`/u/${p.id}`} className="flex min-w-0 flex-1 items-center gap-3" onClick={() => onOpenChange(false)}>
                  <PersonAvatar person={p} className="size-10 text-base" />
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-semibold hover:text-volt-500">{p.name}</span>
                      {p.followsYou && <span className="shrink-0 rounded-full bg-raised px-2 py-0.5 text-[11px] text-muted">Follows you</span>}
                    </span>
                    <span className="block truncate text-xs text-muted">{p.bio || `${plural(p.followers, "follower")} · ${plural(p.publicDecks, "public deck")}`}</span>
                  </span>
                </Link>
                <Link href={`/chat/${p.id}`} className="icon-btn shrink-0" aria-label={`Message ${p.name}`} title="Message" onClick={() => onOpenChange(false)}>
                  <MessageCircle className="size-4" />
                </Link>
                <FollowButton person={p} onChange={update} className="shrink-0" />
              </li>
            ))}
          </ul>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
