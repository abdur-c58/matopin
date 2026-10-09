"use client";
import Link from "next/link";
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
    <main className="space-y-6 px-page pt-6 pb-10">
      <section className="flex flex-wrap items-start gap-5">
        <PersonAvatar person={person} className="size-20 text-3xl" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-bold">{person.name}</h1>
          <p className="mt-0.5 text-xs text-muted">Joined {joined}</p>
          {person.bio && <p className="mt-2 max-w-xl text-sm">{person.bio}</p>}
          <div className="mt-3 flex flex-wrap items-baseline gap-x-5 gap-y-1 text-sm text-muted">
            {stats.map(([value, label]) => (
              <span key={label}><span className="font-semibold text-ink tabular-nums">{value.toLocaleString()}</span> {label.toLowerCase()}</span>
            ))}
            <ReachStats reach={person.reach} />
          </div>
        </div>
      </section>
      <p className="flex flex-wrap items-center gap-x-4 gap-y-2 border-y border-line py-3 text-sm">
        <span className="min-w-0 flex-1">Sign in to follow {person.name}, message them, or study their decks. <span className="text-muted">It’s free with your Google account.</span></span>
        <GoogleSignIn className="h-9" />
      </p>

      <Panel title="Public decks">
        {decks.length ? (
          <ul className="divide-y divide-line">
            {decks.map((deck) => (
              <li key={deck.id} className="flex items-baseline gap-3 py-3">
                <p className="min-w-0 flex-1 truncate font-semibold">{deck.name}</p>
                <p className="shrink-0 text-xs text-muted">{[isLang(deck.language) ? LANG_INFO[deck.language].name : "", deckStats(deck)].filter(Boolean).join(" · ")}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">{person.name} hasn’t shared a public deck yet.</p>
        )}
      </Panel>
    </main>
  );
}
