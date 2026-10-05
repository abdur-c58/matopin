"use client";
import Link from "next/link";
import { CalendarDays, Layers, Lock } from "lucide-react";
import { APP_NAME } from "@/lib/brand";
import { isLang, LANG_INFO } from "@/lib/lang";
import { deckStats, type PublicProfile } from "@/lib/social";
import { PersonAvatar } from "./avatar";
import { GoogleSignIn } from "./profiles";
import { ReachStats } from "./reach-stats";
import { Panel } from "./ui";
/** A profile for someone who isn't signed in: who they are and what they share, with nothing to click into. */
export function GuestProfile({ view }: { view: PublicProfile | null }) {
  if (!view) {
    return (
      <main className="grid min-h-[60dvh] place-items-center px-4">
        <section className="surface max-w-sm space-y-3 p-6 text-center">
          <p className="text-lg font-medium">Profile not found</p>
          <p className="text-sm text-muted">This link may be wrong, or the profile was deleted.</p>
          <Link href="/" className="btn btn-primary">Go to {APP_NAME}</Link>
        </section>
      </main>
    );
  }

  const { person, decks } = view;
  const joined = new Date(person.joinedAt).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const stats: [number, string][] = [[person.followers, "Followers"], [person.following, "Following"], [person.publicDecks, "Public decks"]];

  return (
    <main className="space-y-4 px-4 pt-6 pb-10 md:px-8">
      <section className="surface relative overflow-hidden p-6">
        <div aria-hidden className="pointer-events-none absolute -top-24 -right-16 size-72 rounded-full bg-volt-500/10 blur-3xl" />
        <div className="relative flex flex-wrap items-start gap-5">
          <PersonAvatar person={person} className="size-24 text-4xl ring-4 ring-surface" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-2xl font-bold">{person.name}</h1>
            <p className={`mt-1 max-w-xl text-sm ${person.bio ? "" : "text-muted"}`}>{person.bio || "No bio yet."}</p>
            <p className="mt-2 flex items-center gap-1.5 text-xs text-muted"><CalendarDays className="size-3.5" />Joined {joined}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {stats.map(([value, label]) => (
                <div key={label} className="flex flex-col-reverse rounded-2xl bg-raised px-4 py-2">
                  <span className="text-xs text-muted">{label}</span>
                  <span className="text-lg font-bold tabular-nums">{value.toLocaleString()}</span>
                </div>
              ))}
              <ReachStats reach={person.reach} />
            </div>
          </div>
        </div>
        <div className="relative mt-5 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-raised/60 p-3">
          <Lock className="size-5 shrink-0 text-muted" />
          <p className="min-w-0 flex-1 text-sm">
            <span className="font-semibold">Sign in to follow {person.name}, message them, or study their decks.</span>{" "}
            <span className="text-muted">It’s free with your Google account.</span>
          </p>
          <GoogleSignIn className="h-9" />
        </div>
      </section>

      <h2 className="px-1 text-sm font-semibold text-muted">Public decks</h2>
      {decks.length ? (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {decks.map((deck) => (
            <li key={deck.id} className="surface flex items-start gap-3 p-5">
              <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-raised text-volt-500"><Layers className="size-5" /></span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-bold">{deck.name}</p>
                <p className="text-xs text-muted">{deckStats(deck)}</p>
              </div>
              {isLang(deck.language) && (
                <span className="shrink-0 rounded-full bg-raised px-2 py-0.5 text-[11px] font-semibold text-muted">{LANG_INFO[deck.language].name}</span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <Panel className="text-center">
          <Layers className="mx-auto size-8 text-muted" />
          <p className="mt-2 font-semibold">{person.name} hasn’t shared a public deck yet</p>
        </Panel>
      )}
    </main>
  );
}
