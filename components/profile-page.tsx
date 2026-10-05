"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarDays, Layers, LoaderCircle, MessageCircle, MessageCircleOff, Pencil, UserSearch, Users } from "lucide-react";
import { toast } from "sonner";
import type { ChatLink, Person, ProfileView, PublicProfile, SharedDeck } from "@/lib/social";
import { store } from "@/lib/store-client";
import { PersonAvatar } from "./avatar";
import { GuestProfile } from "./guest-profile";
import { ProfileDialog, useProfile, useSignedIn } from "./profiles";
import { ReachStats } from "./reach-stats";
import { FindPeopleDialog, PublicDecks } from "./social-page";
import { DeckTile, errorText, FollowButton, PersonRow } from "./social";
import { Chips, Panel } from "./ui";

type Tab = "decks" | "followers" | "following" | "discover";

/** `guest` is what the server found for a visitor who isn't signed in; null if the profile doesn't exist. */
export function ProfilePage({ id, guest }: { id: string; guest: PublicProfile | null }) {
  return useSignedIn() ? <MemberProfile id={id} /> : <GuestProfile view={guest} />;
}

function MemberProfile({ id }: { id: string }) {
  const { profile, name, avatar, avatarCrop, color, bio } = useProfile();
  const self = id === profile;
  const [view, setView] = useState<ProfileView | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("decks");
  const [editing, setEditing] = useState(false);
  const [enabling, setEnabling] = useState(false);
  const [finding, setFinding] = useState(false);

  useEffect(() => {
    let live = true;
    store<ProfileView>("profileView", { id }).then(
      (data) => { if (live) { setView(data); setError(""); } },
      (e: unknown) => { if (live) setError(errorText(e, "Couldn't load this profile.")); },
    );
    return () => { live = false; };
  }, [id, name, avatar, color, bio]);

  if (error) {
    return (
      <main className="grid min-h-[50dvh] place-items-center px-4">
        <section className="surface max-w-sm space-y-3 p-6 text-center">
          <p className="text-lg font-medium">Profile not found</p>
          <p className="text-sm text-muted">{error}</p>
          <Link href="/social" className="btn btn-primary">Back to Social</Link>
        </section>
      </main>
    );
  }
  if (!view) return <p className="px-4 pt-5 text-sm text-muted md:px-8">Loading profile…</p>;

  const person = self ? { ...view.person, name, avatar, avatarCrop, color, bio } : view.person;
  const changePerson = (next: Person) => setView((v) => {
    if (!v) return v;
    const list = (people: Person[]) => people.map((p) => (p.id === next.id ? next : p));
    let followers = list(v.followers);
    if (next.id === v.person.id && !self) {
      // Following this profile adds you to its followers, and unfollowing takes you off.
      followers = next.isFollowing
        ? [{ ...next, id: profile, name, avatar, avatarCrop, color, bio, isFollowing: false, followsYou: false }, ...followers.filter((p) => p.id !== profile)]
        : followers.filter((p) => p.id !== profile);
    }
    return { ...v, person: next.id === v.person.id ? next : v.person, followers, following: list(v.following) };
  });
  async function allowMessages() {
    setEnabling(true);
    try {
      const { chat } = await store<{ chat: ChatLink }>("chatRespond", { with: id, accept: true });
      setView((v) => v && { ...v, chat: { myStatus: chat.myStatus, theirStatus: chat.theirStatus } });
      toast.success(`${person.name} can message you again.`);
    } catch (e) {
      toast.error(errorText(e, "Couldn't turn messages back on."));
    } finally {
      setEnabling(false);
    }
  }
  const markSaved = (next: SharedDeck) => setView((v) => v && { ...v, decks: v.decks.map((d) => (d.id === next.id ? next : d)) });
  const joined = new Date(person.joinedAt).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const stats: [Tab, number, string][] = [["followers", person.followers, "Followers"], ["following", person.following, "Following"], ["decks", view.decks.length, self ? "Shared decks" : "Public decks"]];

  return (
    <main className="space-y-4 px-4 pt-5 pb-10 md:px-8">
      <section className="surface relative overflow-hidden p-6">
        <div aria-hidden className="pointer-events-none absolute -top-24 -right-16 size-72 rounded-full bg-volt-500/10 blur-3xl" />
        <div className="relative flex flex-wrap items-start gap-5">
          <PersonAvatar person={person} className="size-24 text-4xl ring-4 ring-surface" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-2xl font-bold">{person.name}</h2>
              {person.followsYou && !self && <span className="rounded-full bg-raised px-2 py-0.5 text-xs text-muted">Follows you</span>}
            </div>
            <p className={`mt-1 max-w-xl text-sm ${person.bio ? "" : "text-muted"}`}>{person.bio || (self ? "Add a bio so people know what you’re learning." : "No bio yet.")}</p>
            <p className="mt-2 flex items-center gap-1.5 text-xs text-muted"><CalendarDays className="size-3.5" />Joined {joined}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {stats.map(([key, value, label]) => (
                <button key={key} type="button" onClick={() => setTab(key)} aria-pressed={tab === key}
                  className={`rounded-2xl px-4 py-2 text-left transition ${tab === key ? "bg-volt-50 ring-1 ring-volt-500/40" : "bg-raised hover:bg-ink/10"}`}>
                  <span className="block text-lg font-bold tabular-nums">{value.toLocaleString()}</span>
                  <span className="block text-xs text-muted">{label}</span>
                </button>
              ))}
              <ReachStats reach={view.person.reach} />
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            {self ? (
              <>
                <button type="button" className="btn btn-primary" onClick={() => setFinding(true)}><UserSearch className="size-4" />Find people</button>
                <button type="button" className="btn btn-shard" onClick={() => setEditing(true)}><Pencil className="size-4" />Edit profile</button>
              </>
            ) : (
              <>
                {view.chat?.myStatus !== "declined" && <Link href={`/chat/${person.id}`} className="btn btn-secondary h-10 px-4"><MessageCircle className="size-4" />Message</Link>}
                <FollowButton person={person} onChange={changePerson} className="h-10 px-4" />
              </>
            )}
          </div>
        </div>
        {!self && view.chat?.myStatus === "declined" && (
          <div className="relative mt-5 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-raised/60 p-3">
            <MessageCircleOff className="size-5 shrink-0 text-muted" />
            <p className="min-w-0 flex-1 text-sm"><span className="font-semibold">You turned off messages from {person.name}.</span> <span className="text-muted">They can’t message you until you turn them back on.</span></p>
            <button type="button" className="btn btn-primary h-9" disabled={enabling} onClick={() => void allowMessages()}>
              {enabling ? <LoaderCircle className="size-4 animate-spin" /> : <MessageCircle className="size-4" />}Turn messages back on
            </button>
          </div>
        )}
      </section>

      <Chips<Tab> label="Profile sections" value={tab} onChange={setTab}
        options={[
          { value: "decks", label: self ? "Shared decks" : "Public decks" }, { value: "followers", label: "Followers" }, { value: "following", label: "Following" },
          ...(self ? [{ value: "discover" as const, label: "Discover decks" }] : []),
        ]} />

      {tab === "discover" && self && <PublicDecks />}

      {tab === "decks" && (view.decks.length ? (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {view.decks.map((deck) => <DeckTile key={deck.id} deck={deck} showOwner={false} onSaved={markSaved} />)}
        </ul>
      ) : (
        <Panel className="text-center">
          <Layers className="mx-auto size-8 text-muted" />
          <p className="mt-2 font-semibold">{self ? "You haven’t shared a deck yet" : `${person.name} hasn’t shared a public deck yet`}</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted">{self ? "Open a deck’s settings and set it to Public for anyone to import, or Collab to invite people with a link." : "Follow them to see their decks first when they do."}</p>
          {self && <Link href="/decks" className="btn btn-shard mt-4">Choose a deck</Link>}
        </Panel>
      ))}
      {(tab === "followers" || tab === "following") && (
        <Panel title={<span className="flex items-center gap-2"><Users className="size-4 text-volt-500" />{tab === "followers" ? "Followers" : "Following"}</span>}>
          {(tab === "followers" ? view.followers : view.following).length === 0 ? (
            <div className="text-sm text-muted">
              {tab === "followers" ? (self ? "No one follows you yet." : "No followers yet.") : (self ? "You aren’t following anyone yet." : "Not following anyone yet.")}
              {self && <button type="button" className="btn btn-shard mt-3 flex" onClick={() => setFinding(true)}><UserSearch className="size-4" />Find people</button>}
            </div>
          ) : (
            <ul className="grid gap-1 md:grid-cols-2">
              {(tab === "followers" ? view.followers : view.following).map((p) => <PersonRow key={p.id} person={p} self={p.id === profile} onChange={changePerson} />)}
            </ul>
          )}
        </Panel>
      )}

      {self && <ProfileDialog open={editing} onOpenChange={setEditing} />}
      {self && <FindPeopleDialog open={finding} onOpenChange={setFinding} />}
    </main>
  );
}
