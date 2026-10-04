"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Compass, Search, Users } from "lucide-react";
import type { Person, SharedDeck } from "@/lib/social";
import { store } from "@/lib/store-client";
import { PersonAvatar } from "./avatar";
import { useProfile } from "./profiles";
import { DeckTile, errorText, PersonRow } from "./social";
import { Chips, Panel } from "./ui";

type DeckFilter = "all" | "following" | "joined";

function SearchBox({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <label className="flex h-10 items-center gap-2 rounded-full border border-line bg-porcelain pr-4 pl-3 transition focus-within:border-volt-500/60">
      <Search className="size-4 shrink-0 text-muted" />
      <input className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted/80" placeholder={label} aria-label={label} value={value}
        onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") onChange(""); }} />
    </label>
  );
}

export function SocialPage() {
  const { profile, name, avatar, avatarCrop, color } = useProfile();
  const [people, setPeople] = useState<Person[] | null>(null);
  const [decks, setDecks] = useState<SharedDeck[] | null>(null);
  const [error, setError] = useState("");
  const [deckQuery, setDeckQuery] = useState("");
  const [personQuery, setPersonQuery] = useState("");
  const [filter, setFilter] = useState<DeckFilter>("all");

  useEffect(() => {
    let live = true;
    store<{ people: Person[]; decks: SharedDeck[] }>("social").then(
      (data) => { if (live) { setPeople(data.people); setDecks(data.decks); } },
      (e: unknown) => { if (live) setError(errorText(e, "Couldn't load Social.")); },
    );
    return () => { live = false; };
  }, []);

  const following = new Set(people?.filter((p) => p.isFollowing).map((p) => p.id));
  const dq = deckQuery.trim().toLowerCase();
  const shownDecks = (decks ?? []).filter((d) =>
    (filter === "following" ? following.has(d.owner.id) : filter === "joined" ? d.role != null && d.role !== "owner" : true)
    && (!dq || d.name.toLowerCase().includes(dq) || d.owner.name.toLowerCase().includes(dq)));
  const pq = personQuery.trim().toLowerCase();
  const shownPeople = (people ?? []).filter((p) => !pq || p.name.toLowerCase().includes(pq));
  const updatePerson = (next: Person) => setPeople((list) => list?.map((p) => (p.id === next.id ? next : p)) ?? list);
  const markFollowed = (id: string) => setDecks((list) => list?.map((d) => (d.id === id ? { ...d, role: "follower", followers: d.followers + 1 } : d)) ?? list);

  if (error) return <main className="px-4 pt-5 pb-10 md:px-8"><Panel><p className="text-sm text-tone-1">{error}</p></Panel></main>;

  return (
    <main className="grid gap-4 px-4 pt-5 pb-10 md:px-8 xl:grid-cols-[minmax(0,1fr)_24rem]">
      <section className="min-w-0 space-y-4">
        <div className="surface flex flex-wrap items-center justify-between gap-3 p-4">
          <h2 className="flex items-center gap-2 text-base font-semibold"><Compass className="size-4 text-volt-500" />Public decks</h2>
          <div className="flex w-full flex-wrap items-center gap-3 sm:w-auto">
            <Chips<DeckFilter> label="Filter public decks" value={filter} onChange={setFilter}
              options={[{ value: "all", label: "All" }, { value: "following", label: "From people you follow" }, { value: "joined", label: "In your decks" }]} />
            <div className="w-full sm:w-60"><SearchBox value={deckQuery} onChange={setDeckQuery} label="Search decks or people" /></div>
          </div>
        </div>
        {!decks && <p className="text-sm text-muted">Loading decks…</p>}
        {decks && shownDecks.length === 0 && (
          <div className="surface p-10 text-center">
            <p className="font-semibold">{decks.length === 0 ? "No public decks yet" : "Nothing matches"}</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
              {decks.length === 0 ? "Make one of your decks public in its settings and it shows up here for everyone to follow." : "Try another search or filter."}
            </p>
          </div>
        )}
        <ul className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
          {shownDecks.map((deck) => <DeckTile key={deck.id} deck={deck} onFollowed={markFollowed} />)}
        </ul>
      </section>

      <aside className="space-y-4">
        <Link href={`/u/${profile}`} className="surface flex items-center gap-3 p-4 transition hover:bg-raised/60">
          <PersonAvatar person={{ name, avatar, avatarCrop, color }} className="size-12 text-lg" />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold">{name}</span>
            <span className="block text-xs text-muted">View your profile and shared decks</span>
          </span>
        </Link>
        <Panel title={<span className="flex items-center gap-2"><Users className="size-4 text-volt-500" />People</span>} action={people && <span className="text-xs text-muted">{following.size} following</span>}>
          <SearchBox value={personQuery} onChange={setPersonQuery} label="Find people" />
          {!people && <p className="mt-3 text-sm text-muted">Loading people…</p>}
          {people && shownPeople.length === 0 && <p className="mt-3 text-sm text-muted">{people.length ? "No one matches that name." : "No one else is here yet."}</p>}
          <ul className="mt-3 space-y-1">
            {shownPeople.map((p) => <PersonRow key={p.id} person={p} self={false} onChange={updatePerson} />)}
          </ul>
        </Panel>
      </aside>
    </main>
  );
}
