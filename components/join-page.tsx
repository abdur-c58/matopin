"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Layers, LoaderCircle, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";
import type { SharedDeck } from "@/lib/social";
import { store } from "@/lib/store-client";
import { pullDecks } from "@/lib/sync";
import { PersonAvatar } from "./avatar";
import { useProfile } from "./profiles";
import { errorText, plural } from "./social";

/** Where a collab invite link lands: who is inviting, to which deck, and a button to join as a collaborator. */
export function JoinPage({ code }: { code: string }) {
  const { profile } = useProfile();
  const router = useRouter();
  const [deck, setDeck] = useState<SharedDeck | null>(null);
  const [error, setError] = useState("");
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    let live = true;
    store<{ deck: SharedDeck }>("invitePreview", { code }).then(
      (data) => { if (live) setDeck(data.deck); },
      (e: unknown) => { if (live) setError(errorText(e, "This invite link is not valid any more.")); },
    );
    return () => { live = false; };
  }, [code]);

  async function join() {
    setJoining(true);
    try {
      const { id } = await store<{ id: string }>("inviteJoin", { code });
      await pullDecks(profile);
      toast.success(`You’re collaborating on ${deck?.name ?? "the deck"}.`);
      router.push(`/decks/${id}`);
    } catch (e) {
      toast.error(errorText(e, "Couldn't join this deck."));
      setJoining(false);
    }
  }

  return (
    <main className="grid min-h-[60dvh] place-items-center px-4 pb-10">
      <section className="surface relative w-full max-w-md overflow-hidden p-6 text-center">
        <div aria-hidden className="pointer-events-none absolute -top-20 left-1/2 size-64 -translate-x-1/2 rounded-full bg-second-500/20 blur-3xl" />
        {error ? (
          <div className="relative">
            <p className="text-lg font-semibold">Invite not available</p>
            <p className="mt-1 text-sm text-muted">{error} Ask the deck’s owner for a new link.</p>
            <Link href="/social" className="btn btn-primary mt-5">Go to Social</Link>
          </div>
        ) : !deck ? (
          <p className="relative py-8 text-sm text-muted">Checking the invite…</p>
        ) : (
          <div className="relative">
            <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-second-500 text-on-second"><Users className="size-7" /></span>
            <p className="mt-4 text-sm text-muted">You’re invited to collaborate on</p>
            <h2 className="mt-1 text-2xl font-bold">{deck.name}</h2>
            <Link href={`/u/${deck.owner.id}`} className="mx-auto mt-3 flex w-fit items-center gap-2 text-sm text-muted transition hover:text-ink">
              <PersonAvatar person={deck.owner} className="size-7 text-xs" />by <span className="font-semibold text-ink">{deck.owner.name}</span>
            </Link>
            <p className="mt-3 text-sm text-muted">{plural(deck.cards, "card")} · {plural(deck.followers, "member")}</p>
            <p className="mx-auto mt-4 max-w-xs text-xs text-muted">Collaborators can add and edit cards. Your review progress stays your own.</p>
            <div className="mt-6">
              {deck.role === "owner" ? (
                <Link href={`/decks/${deck.id}/settings`} className="btn btn-secondary w-full"><Layers className="size-4" />This is your deck</Link>
              ) : deck.role === "collaborator" ? (
                <Link href={`/decks/${deck.id}`} className="btn btn-shard w-full"><Layers className="size-4" />You’re already collaborating · Open</Link>
              ) : (
                <button type="button" className="btn btn-shard btn-shard-second h-11 w-full" disabled={joining} onClick={() => void join()}>
                  {joining ? <LoaderCircle className="size-4 animate-spin" /> : <UserPlus className="size-4" />}{deck.role === "follower" ? "Join as collaborator" : "Join deck"}
                </button>
              )}
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
